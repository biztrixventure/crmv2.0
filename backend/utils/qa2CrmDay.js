// ============================================================================
// qa2CrmDay.js — "day-1" QA population: reads yesterday's transfers + sales
// straight from the CRM, the same records Compliance's Records > Transfers/
// Sales tabs already show, instead of sweeping raw dialer recordings.
//
// Informed by v1's buildCrmDay (backend/routes/qa.js:1771-1806) — same three
// shapes (fronter leg from every transfer, closer leg from the linked sale or
// bare transfer) — but v1's own file is frozen and untouched; this is fresh
// v2 code, not an import from it. Two deliberate improvements over v1:
//   1. ET-aware day bounds (etUtils.js), matching how Compliance's own
//      Transfers tab windows a day — v1's buildCrmDay used a plain UTC day,
//      a real discrepancy from what "yesterday" means to a manager reading
//      the Compliance shell.
//   2. sales.transfer_id is UNIQUE (at most one sale per transfer), so ONE
//      query covers both "closed" and "not yet closed" closer outcomes —
//      the sale's own id/dispo is used whenever a sale row exists at all,
//      falling back to the bare transfer only when the closer never made one.
//
// RECORDING RESOLUTION reuses findSaleRecording (dialerBoxes.js) — the exact
// phone+agent+day search portal.js already uses for "no confirmed lead code
// yet" cases — resolved UPFRONT at population time rather than deferred like
// v1, since by the time this runs (the next day) the recording has had all
// night to land, unlike a live ingest hook's 60-90s-after-hangup problem.
//
// CLASSIFICATION deliberately reuses the 'ingest_fronter'/'ingest_closer'
// rule sets, NOT a new crm_day-specific one — qa2_call.source='crm_day' is a
// provenance/audit fact, separate from which qa2_method_rule.source a row
// classifies against. A manager's rules, already configured for live
// ingest, apply unchanged; no duplicate rule set to maintain.
// ============================================================================

const { supabaseAdmin } = require('../config/database');
const logger = require('./logger');
const { etDateToUtcStart, etDateToUtcEnd } = require('./etUtils');
const { findSaleRecording } = require('./dialerBoxes');
const { classifyCall } = require('./qa2ClassifyResolver');
const { checkUnclassifiedThreshold } = require('./qa2UnclassifiedAlert');

// A sale can exist without ever closing (a "Callback"/other non-sale dispo
// still creates a sales row) — no status filter here on purpose, so the
// closer leg always prefers the sale's own dispo/id when one exists at all.
async function agentIdsFor(userId) {
  if (!userId) return [];
  const { data } = await supabaseAdmin.from('user_profiles').select('vicidial_agent_ids').eq('user_id', userId).maybeSingle();
  return (data?.vicidial_agent_ids || []).filter(Boolean);
}

async function resolveRecording({ vendorCode, phone, agentIds, date, dialerAt }) {
  if (!agentIds.length) return null;
  try {
    return await findSaleRecording({ code: vendorCode || null, phone: phone || null, agentIds, date, dialerAt });
  } catch (e) { logger.warn('QA2_CRM_DAY', `recording lookup failed: ${e.message}`); return null; }
}

// Every qa2_call row (any source) that already carries this company's
// transfer_id/sale_id — the dedup guard so a re-run, or a call that ALSO
// landed via live ingest, never gets a second review task.
async function existingKeys(companyId) {
  const { data } = await supabaseAdmin.from('qa2_call').select('transfer_id, sale_id, leg').eq('company_id', companyId);
  const keys = new Set();
  for (const r of (data || [])) {
    if (r.transfer_id) keys.add(`t:${r.transfer_id}:${r.leg}`);
    if (r.sale_id) keys.add(`s:${r.sale_id}:${r.leg}`);
  }
  return keys;
}

async function insertCrmDayCall({ companyId, leg, transferId, saleId, vendorCode, phone, callAt, agentUserId, dispoRaw, dialerAt }) {
  const agentIds = await agentIdsFor(agentUserId);
  const rec = await resolveRecording({ vendorCode, phone, agentIds, date: (callAt || '').slice(0, 10) || null, dialerAt: dialerAt || callAt });
  const parsedLeadId = vendorCode ? (String(vendorCode).match(/(\d+)$/) || [])[1] : null;

  // Classify against the LIVE-ingest rule sets — see file header.
  const classifySource = leg === 'fronter' ? 'ingest_fronter' : 'ingest_closer';
  const methodId = await classifyCall({ source: classifySource, dispo: dispoRaw, leg });

  const now = new Date().toISOString();
  const row = {
    box_id: rec?.box || null,
    dialer_lead_id: rec?.lead_id ? String(rec.lead_id) : parsedLeadId,
    vendor_code: vendorCode || null,
    method_id: methodId,
    classified_by: null,
    classified_at: methodId ? now : null,
    leg,
    agent_user: rec?.user || null,
    agent_user_id: agentUserId || null,
    company_id: companyId,
    transfer_id: transferId,
    sale_id: saleId,
    customer_phone: phone || null,
    normalized_phone: phone || null,
    dispo_raw: dispoRaw || null,
    call_at: callAt || null,
    talk_sec: Number.isFinite(rec?.duration) ? rec.duration : null,
    recording_id: rec?.recording_id ? String(rec.recording_id) : null,
    recording_location: rec?.location || null,
    // A row with no lead code at all can never resolve later either — the
    // poller (qa2RecordingPoller.js) only ever retries by dialer_lead_id, so
    // marking it 'missing' immediately is honest, not a missed retry.
    recording_state: rec ? 'found' : (parsedLeadId ? 'pending' : 'missing'),
    qa_relevant: true,
    source: 'crm_day',
  };
  const { error } = await supabaseAdmin.from('qa2_call').insert(row);
  if (error) {
    if (/duplicate key|unique/i.test(error.message)) return false; // race with another run
    logger.warn('QA2_CRM_DAY', `insert failed (transfer ${transferId || '-'} / sale ${saleId || '-'}): ${error.message}`);
    return false;
  }
  return !!methodId ? true : 'unclassified';
}

async function populateCrmDay(companyId, date) {
  const start = etDateToUtcStart(date);
  const end = etDateToUtcEnd(date);
  if (!start || !end) return { created: 0, error: 'invalid date' };

  const { data: transfers } = await supabaseAdmin.from('transfers')
    .select('id, vicidial_vendor_code, vicidial_agent, normalized_phone, created_at, created_by, assigned_closer_id, latest_disposition')
    .eq('company_id', companyId).gte('created_at', start).lte('created_at', end);
  const tids = (transfers || []).map(t => t.id);

  const salesByTransfer = new Map();
  for (let i = 0; i < tids.length; i += 150) {
    const { data } = await supabaseAdmin.from('sales')
      .select('id, transfer_id, customer_phone, normalized_phone, sale_date, created_at, closer_id, status, vicidial_vendor_code, closer_disposition')
      .in('transfer_id', tids.slice(i, i + 150));
    for (const s of (data || [])) if (s.transfer_id) salesByTransfer.set(s.transfer_id, s);
  }

  // Standalone sales with no transfer link at all (sales.transfer_id is
  // nullable) that closed on THIS calendar day — same sale_date convention
  // Compliance's own Sales tab and v1's buildCrmDay both already use.
  const { data: standaloneSales } = await supabaseAdmin.from('sales')
    .select('id, customer_phone, normalized_phone, sale_date, created_at, closer_id, status, vicidial_vendor_code, closer_disposition')
    .eq('company_id', companyId).is('transfer_id', null).eq('sale_date', date);

  const existing = await existingKeys(companyId);
  let created = 0, sawUnclassified = false;

  for (const t of (transfers || [])) {
    if (existing.has(`t:${t.id}:fronter`)) continue;
    const r = await insertCrmDayCall({
      companyId, leg: 'fronter', transferId: t.id, saleId: null,
      vendorCode: t.vicidial_vendor_code, phone: t.normalized_phone, callAt: t.created_at,
      agentUserId: t.created_by, dispoRaw: t.latest_disposition,
    });
    if (r) { created++; if (r === 'unclassified') sawUnclassified = true; }
  }

  for (const t of (transfers || [])) {
    const sale = salesByTransfer.get(t.id);
    if (!sale && !t.assigned_closer_id) continue; // nothing on the closer side to review yet
    const key = sale ? `s:${sale.id}:closer` : `t:${t.id}:closer`;
    if (existing.has(key)) continue;
    const r = await insertCrmDayCall({
      companyId, leg: 'closer', transferId: t.id, saleId: sale?.id || null,
      vendorCode: sale?.vicidial_vendor_code || null,
      phone: sale?.normalized_phone || sale?.customer_phone || t.normalized_phone,
      callAt: sale?.created_at || t.created_at, dialerAt: t.created_at,
      agentUserId: sale?.closer_id || t.assigned_closer_id,
      dispoRaw: sale?.closer_disposition || t.latest_disposition,
    });
    if (r) { created++; if (r === 'unclassified') sawUnclassified = true; }
  }

  for (const s of (standaloneSales || [])) {
    if (existing.has(`s:${s.id}:closer`)) continue;
    const r = await insertCrmDayCall({
      companyId, leg: 'closer', transferId: null, saleId: s.id,
      vendorCode: s.vicidial_vendor_code, phone: s.normalized_phone || s.customer_phone,
      callAt: s.created_at || s.sale_date, agentUserId: s.closer_id, dispoRaw: s.closer_disposition,
    });
    if (r) { created++; if (r === 'unclassified') sawUnclassified = true; }
  }

  if (sawUnclassified) checkUnclassifiedThreshold(companyId).catch(() => {});
  return { created };
}

// ET "yesterday" — noon-UTC arithmetic sidesteps DST-boundary edge cases from
// a naive 24h subtraction. No wall-clock cron in this codebase's scheduler
// (everything runs on a fixed interval since boot, see scheduler.js), so this
// is called from a periodic tick, not a once-daily trigger — populateCrmDay's
// own dedup makes repeat calls for the same day a fast no-op either way.
function yesterdayEt() {
  const { todayEt } = require('./etUtils');
  const d = new Date(`${todayEt()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function runCrmDayForAllCompanies() {
  const { data: rows } = await supabaseAdmin.from('qa2_manager_company').select('company_id');
  const companyIds = [...new Set((rows || []).map(r => r.company_id))];
  if (!companyIds.length) return { companies: 0, created: 0 };

  const date = yesterdayEt();
  let created = 0;
  for (const companyId of companyIds) {
    try {
      const r = await populateCrmDay(companyId, date);
      created += r.created || 0;
    } catch (e) { logger.warn('QA2_CRM_DAY', `company ${companyId}: ${e.message}`); }
  }
  if (created) logger.info('QA2_CRM_DAY', `${date}: created ${created} qa2_call row(s) across ${companyIds.length} compan${companyIds.length === 1 ? 'y' : 'ies'}`);
  return { companies: companyIds.length, created, date };
}

module.exports = { populateCrmDay, runCrmDayForAllCompanies, yesterdayEt };
