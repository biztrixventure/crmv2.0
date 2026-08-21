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

// Fixed-size worker pool — runs `limit` items at once instead of the whole
// array simultaneously (which would fire 100+ dialer HTTP calls in one burst)
// or one at a time (which is what made a full day take minutes).
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

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
// Which of THIS DAY's transfers/sales already have a qa2_call row.
//
// This used to select every qa2_call row for the company with no filter and no
// limit, purely to build a lookup set. That was survivable when qa2_call was
// small; it is not now — The Mejor alone has 135,744 rows, Wavetech 110,450 —
// and "load a day" started failing outright with a 500 because the request
// never came back. Ask only about the few hundred ids the day actually has.
async function existingKeys(companyId, transferIds = [], saleIds = []) {
  const keys = new Set();
  const CH = 150;   // keep the PostgREST .in() URL well under any length cap

  for (let i = 0; i < transferIds.length; i += CH) {
    const { data, error } = await supabaseAdmin.from('qa2_call')
      .select('transfer_id, leg').eq('company_id', companyId)
      .in('transfer_id', transferIds.slice(i, i + CH));
    if (error) throw new Error(`existingKeys(transfers): ${error.message}`);
    for (const r of (data || [])) if (r.transfer_id) keys.add(`t:${r.transfer_id}:${r.leg}`);
  }
  for (let i = 0; i < saleIds.length; i += CH) {
    const { data, error } = await supabaseAdmin.from('qa2_call')
      .select('sale_id, leg').eq('company_id', companyId)
      .in('sale_id', saleIds.slice(i, i + CH));
    if (error) throw new Error(`existingKeys(sales): ${error.message}`);
    for (const r of (data || [])) if (r.sale_id) keys.add(`s:${r.sale_id}:${r.leg}`);
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

  const saleIds = [
    ...[...salesByTransfer.values()].map(s => s.id),
    ...(standaloneSales || []).map(s => s.id),
  ].filter(Boolean);
  const existing = await existingKeys(companyId, tids, saleIds);
  const tasks = [];

  for (const t of (transfers || [])) {
    if (existing.has(`t:${t.id}:fronter`)) continue;
    tasks.push({
      companyId, leg: 'fronter', transferId: t.id, saleId: null,
      vendorCode: t.vicidial_vendor_code, phone: t.normalized_phone, callAt: t.created_at,
      agentUserId: t.created_by, dispoRaw: t.latest_disposition,
    });
  }

  for (const t of (transfers || [])) {
    const sale = salesByTransfer.get(t.id);
    if (!sale && !t.assigned_closer_id) continue; // nothing on the closer side to review yet
    const key = sale ? `s:${sale.id}:closer` : `t:${t.id}:closer`;
    if (existing.has(key)) continue;
    tasks.push({
      companyId, leg: 'closer', transferId: t.id, saleId: sale?.id || null,
      // The sale's own code first (most precise), falling back to the
      // TRANSFER's code — the same lead_id almost always carries both legs,
      // and findSaleRecording is specifically built to pick the closer's own
      // leg off a shared lead_id via agentIds. Without this fallback every
      // closer row with no sale (or a sale that never got its own code)
      // never even attempts a lookup — confirmed live: 100% of closer-leg
      // crm_day rows had vendor_code NULL before this fix.
      vendorCode: sale?.vicidial_vendor_code || t.vicidial_vendor_code || null,
      phone: sale?.normalized_phone || sale?.customer_phone || t.normalized_phone,
      callAt: sale?.created_at || t.created_at, dialerAt: t.created_at,
      agentUserId: sale?.closer_id || t.assigned_closer_id,
      dispoRaw: sale?.closer_disposition || t.latest_disposition,
    });
  }

  for (const s of (standaloneSales || [])) {
    if (existing.has(`s:${s.id}:closer`)) continue;
    tasks.push({
      companyId, leg: 'closer', transferId: null, saleId: s.id,
      vendorCode: s.vicidial_vendor_code, phone: s.normalized_phone || s.customer_phone,
      callAt: s.created_at || s.sale_date, agentUserId: s.closer_id, dispoRaw: s.closer_disposition,
    });
  }

  // Bounded concurrency, not sequential — each task does an agent lookup PLUS
  // a dialer recording search (itself potentially several HTTP round-trips),
  // and a full day can be 100+ calls. Sequential awaits made "load a day"
  // take minutes; a small worker pool keeps it from hammering the dialer
  // boxes (which are also serving live calls) while still running in parallel.
  const CONCURRENCY = 6;
  const results = await mapWithConcurrency(tasks, CONCURRENCY, insertCrmDayCall);
  const created = results.filter(Boolean).length;
  const sawUnclassified = results.includes('unclassified');

  if (sawUnclassified) checkUnclassifiedThreshold(companyId).catch(() => {});
  return { created };
}

// One-off repair for calls populated BEFORE the closer-leg vendor_code
// fallback existed — populateCrmDay's own dedup means simply re-loading a
// day never retries an already-created row, so those need fixing in place.
// Only touches rows still recording_state='pending'/'missing' with a NULL
// vendor_code and a transfer link — never overwrites a code or state that's
// already resolved. Doesn't re-run the recording search itself; resets the
// row to 'pending' with a real lead_id so the existing 60s poller
// (qa2RecordingPoller.js) picks it up on its own next tick.
async function repairMissingVendorCodes(companyId, date) {
  const start = etDateToUtcStart(date);
  const end = etDateToUtcEnd(date);
  if (!start || !end) return { repaired: 0, error: 'invalid date' };

  const { data: rows } = await supabaseAdmin
    .from('qa2_call')
    .select('id, transfer_id')
    .eq('company_id', companyId).gte('call_at', start).lte('call_at', end)
    .eq('source', 'crm_day').eq('leg', 'closer')
    .is('vendor_code', null).not('transfer_id', 'is', null)
    .in('recording_state', ['pending', 'missing']);
  if (!rows || !rows.length) return { repaired: 0 };

  const transferIds = [...new Set(rows.map(r => r.transfer_id))];
  const { data: transfers } = await supabaseAdmin
    .from('transfers').select('id, vicidial_vendor_code').in('id', transferIds).not('vicidial_vendor_code', 'is', null);
  const codeByTransfer = new Map((transfers || []).map(t => [t.id, t.vicidial_vendor_code]));

  let repaired = 0;
  for (const row of rows) {
    const code = codeByTransfer.get(row.transfer_id);
    if (!code) continue; // the transfer itself has no code either — nothing to fix here
    const leadId = (String(code).match(/(\d+)$/) || [])[1] || null;
    const { error } = await supabaseAdmin.from('qa2_call')
      .update({ vendor_code: code, dialer_lead_id: leadId, recording_state: 'pending', recording_attempts: 0 })
      .eq('id', row.id);
    if (!error) repaired++;
  }
  return { repaired, checked: rows.length };
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

module.exports = { populateCrmDay, runCrmDayForAllCompanies, yesterdayEt, repairMissingVendorCodes };
