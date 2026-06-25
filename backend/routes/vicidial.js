/**
 * VICIdial -> CRM integration (one-directional).
 *
 * Ingest (no CRM session — the VICIdial server fires these; guarded by a shared
 * token in the URL, set VICIDIAL_INGEST_TOKEN):
 *   GET|POST /api/vicidial/fronter-xfer  ?key=&code=&phone=&agent=
 *       On XFER → create a PENDING transfer (code + phone), routed to the CRM
 *       user mapped from the VICIdial agent.
 *   GET|POST /api/vicidial/closer-dispo   ?key=&code=&dispo=&talk_time=&agent=
 *       On a closer disposition → match the code → record the disposition onto
 *       that transfer so the fronter sees the outcome.
 *
 * API (CRM session — the fronter's app):
 *   GET  /api/vicidial/pending            — my pending-from-dialer transfers
 *   POST /api/vicidial/pending/:id/confirm— fill remaining fields + confirm
 *
 * Matching is exact on transfers.vicidial_vendor_code (idempotent — a duplicate
 * fire updates, never duplicates). Routing is by user_profiles.vicidial_agent_id.
 */
const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const { normPhone } = require('../utils/uploadService');
const { titleCaseFormData } = require('../utils/titleCase');
const { expandStateInFormData } = require('../utils/stateMap');
const { isSuperAdmin } = require('../models/helpers');
const { latestDisposition, leadStatusByCode } = require('../utils/dialerBoxes');

const ingest = express.Router();
const api = express.Router();

// ── shared-secret guard for the public ingest endpoints ──────────────────────
const requireToken = (req, res, next) => {
  const expected = process.env.VICIDIAL_INGEST_TOKEN;
  const got = req.query.key || req.headers['x-vici-key'];
  if (!expected || got !== expected) return res.status(401).json({ ok: false, error: 'unauthorized' });
  next();
};

// Resolve a VICIdial agent id → CRM user + their (active) company.
async function resolveAgent(agentId) {
  if (!agentId) return { userId: null, companyId: null };
  const a = String(agentId).trim();
  // A user may have several dialer ids (one per box) in vicidial_agent_ids[];
  // match any of them. Fall back to the legacy single column if the array isn't
  // migrated yet (111) or wasn't populated.
  let prof = null;
  const arr = await supabaseAdmin
    .from('user_profiles').select('user_id').contains('vicidial_agent_ids', [a]).limit(1).maybeSingle();
  if (arr.data?.user_id) prof = arr.data;
  if (!prof) {
    const one = await supabaseAdmin
      .from('user_profiles').select('user_id').eq('vicidial_agent_id', a).maybeSingle();
    prof = one.data || null;
  }
  if (!prof?.user_id) return { userId: null, companyId: null };
  const { data: ucr } = await supabaseAdmin
    .from('user_company_roles').select('company_id').eq('user_id', prof.user_id).eq('is_active', true)
    .order('created_at', { ascending: true }).limit(1).maybeSingle();
  return { userId: prof.user_id, companyId: ucr?.company_id || null };
}

// A GLOBAL dispo-map row (company_id IS NULL) applies to every company — map a
// dialer code once and it resolves regardless of which company the closer's
// agent lands in. Company-specific rows still win when present.
async function globalDispoName(rawCode) {
  if (!rawCode) return null;
  const { data } = await supabaseAdmin.from('vicidial_dispo_map')
    .select('disposition_name').is('company_id', null).eq('vici_code', rawCode).not('disposition_name', 'is', null).maybeSingle();
  return data?.disposition_name || null;
}

// Resolve a raw dialer code → mapped CRM disposition, bumping the per-company hit
// counter (auto-records unmapped codes for the inbox). Falls back to a global
// mapping when the company has none. Returns { disposition_name } or null.
async function bumpDispoMap(companyId, rawCode) {
  if (!rawCode) return null;
  const now = new Date().toISOString();
  let companyRow = null;
  if (companyId) {
    const { data: m } = await supabaseAdmin.from('vicidial_dispo_map')
      .select('id, disposition_name, hits').eq('company_id', companyId).eq('vici_code', rawCode).maybeSingle();
    companyRow = m || null;
    if (companyRow) {
      await supabaseAdmin.from('vicidial_dispo_map').update({ hits: (companyRow.hits || 0) + 1, last_seen_at: now }).eq('id', companyRow.id);
    } else {
      await supabaseAdmin.from('vicidial_dispo_map')
        .insert({ company_id: companyId, vici_code: rawCode, hits: 1, last_seen_at: now }).then(() => {}, () => {});
    }
  }
  if (companyRow?.disposition_name) return { disposition_name: companyRow.disposition_name };
  const g = await globalDispoName(rawCode);
  return g ? { disposition_name: g } : null;
}

// Does this disposition require the closer to fill the sale form before it
// counts (disposition_configs.opens_sale_form)? Company-specific row wins, else
// global. Drives the "Confirm → open sale form" closer flow instead of auto-apply.
async function dispoOpensSaleForm(companyId, dispoName) {
  if (!dispoName) return false;
  const { data } = await supabaseAdmin.from('disposition_configs')
    .select('opens_sale_form, company_id').eq('name', dispoName).eq('is_active', true)
    .or(`company_id.is.null,company_id.eq.${companyId}`)
    .order('company_id', { ascending: true, nullsFirst: false }).limit(1).maybeSingle();
  return !!data?.opens_sale_form;
}

// Timing-race reconcile: a closer can disposition a transferred call BEFORE the
// fronter dispositions their leg (which is what fires fronter-xfer + creates the
// transfer). That dispo queues with no transfer. When the transfer finally
// lands, attach the most recent pending dispo for the same phone. Fault-tolerant
// — never blocks the transfer write.
async function reconcileQueuedDispoForTransfer(transfer, norm) {
  if (!norm || !transfer?.id) return;
  try {
    const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: pend } = await supabaseAdmin.from('vicidial_closer_dispo_queue')
      .select('*').eq('status', 'pending').is('transfer_id', null)
      .eq('normalized_phone', norm).gte('created_at', since)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!pend) return;
    // A sale-form disposition just links to the transfer → the closer still gets
    // the "Confirm → open sale form" prompt. Everything else applies straight.
    if (await dispoOpensSaleForm(pend.company_id, pend.disposition_name)) {
      await supabaseAdmin.from('vicidial_closer_dispo_queue').update({ transfer_id: transfer.id }).eq('id', pend.id);
    } else {
      // Use the transfer's REAL state so applyCloserDispo never overwrites an
      // existing closer or downgrades a completed/rejected transfer to assigned
      // (the new manual-create / confirm call sites can pass a worked transfer).
      const { data: real } = await supabaseAdmin.from('transfers')
        .select('id, company_id, assigned_closer_id, status').eq('id', transfer.id).maybeSingle();
      const tgt = real || { id: transfer.id, company_id: transfer.company_id, assigned_closer_id: null, status: 'pending' };
      await applyCloserDispo({
        transfer: tgt,
        dispoCompanyId: pend.company_id, closerUserId: pend.closer_user_id,
        dispoName: pend.disposition_name, rawDispo: pend.raw_dispo,
      });
      await supabaseAdmin.from('vicidial_closer_dispo_queue')
        .update({ status: 'applied', transfer_id: transfer.id }).eq('id', pend.id);
    }
    logger.success('VICIDIAL_XFER', `Reconciled queued dispo ${pend.id} → transfer ${transfer.id} (phone ${norm})`);
  } catch { /* non-critical */ }
}

// Read-only mapped-name lookup (no hit bump) — company-specific then global.
async function lookupDispoName(companyId, rawCode) {
  if (!rawCode) return null;
  if (companyId) {
    const { data: m } = await supabaseAdmin.from('vicidial_dispo_map')
      .select('disposition_name').eq('company_id', companyId).eq('vici_code', rawCode).maybeSingle();
    if (m?.disposition_name) return m.disposition_name;
  }
  return await globalDispoName(rawCode);
}

// Apply a closer disposition onto a transfer: stamp vicidial fields, claim the
// closer (so the fronter sees the name), and log a disposition_action with the
// matching config's colour/id (mirrors a manual CRM disposition).
async function applyCloserDispo({ transfer, dispoCompanyId, closerUserId, dispoName, rawDispo, talk }) {
  const now = new Date().toISOString();
  const updates = {
    vicidial_dispo: rawDispo || null,
    vicidial_dispo_at: now,
    vicidial_talk_time: Number.isFinite(talk) ? talk : null,
    vicidial_agent: undefined,
  };
  if (closerUserId && !transfer.assigned_closer_id) {
    updates.assigned_closer_id = closerUserId;
    updates.assigned_to = closerUserId;
    // Mirror the manual flow: a transfer a closer has worked is "assigned", not
    // "pending" — so it shows in the closer's assigned tab + compliance + admin.
    // Only promote a still-pending transfer (never downgrade completed/rejected).
    if (!transfer.status || transfer.status === 'pending') updates.status = 'assigned';
  }
  const { error } = await supabaseAdmin.from('transfers').update(updates).eq('id', transfer.id);
  if (error) throw new Error(error.message);

  if (dispoName) {
    try {
      const { data: cfg } = await supabaseAdmin.from('disposition_configs')
        .select('id, color').eq('name', dispoName).eq('is_active', true)
        .or(`company_id.is.null,company_id.eq.${dispoCompanyId}`)
        .order('company_id', { ascending: true, nullsFirst: false }).limit(1).maybeSingle();
      await supabaseAdmin.from('disposition_actions').insert({
        transfer_id: transfer.id, company_id: dispoCompanyId, user_id: closerUserId || null,
        disposition_config_id: cfg?.id || null, disposition_name: dispoName,
        color: cfg?.color || null, note: `From dialer (${rawDispo})`, setter_role: 'closer',
      });
    } catch { /* non-critical */ }
  }
}

// Ring buffer of recent fronter-xfer hits — the symmetric diagnostic to
// dispo-debug, so we can SEE which fronter transfers did/didn't create a CRM
// transfer (agent not mapped / non-transfer dispo / created). In-memory only.
const recentXfer = [];
ingest.get('/xfer-debug', requireToken, (req, res) => res.json({ recent: recentXfer }));

// ── INGEST: fronter XFER → pending transfer (code + phone only) ──────────────
ingest.all('/fronter-xfer', requireToken, asyncHandler(async (req, res) => {
  const p = { ...req.query, ...req.body };
  const code  = String(p.code || '').trim();
  const phone = String(p.phone || '').trim();
  const agent = String(p.agent || '').trim();
  const norm  = normPhone(phone);
  const xdbg = {
    at: new Date().toISOString(), code, phone, normalized: norm || '',
    agent, dispo: String(p.dispo || ''), agent_mapped: null, company_id: null, outcome: 'pending',
  };
  recentXfer.unshift(xdbg); if (recentXfer.length > 500) recentXfer.pop();
  if (!code || !phone) { xdbg.outcome = 'rejected — missing code or phone'; return res.status(400).json({ ok: false, error: 'code and phone required' }); }

  // Idempotent on the correlation code.
  const { data: existing } = await supabaseAdmin
    .from('transfers').select('id').eq('vicidial_vendor_code', code).maybeSingle();

  if (existing) {
    await supabaseAdmin.from('transfers')
      .update({ vicidial_agent: agent || null, normalized_phone: norm || null })
      .eq('id', existing.id);
    await reconcileQueuedDispoForTransfer({ id: existing.id }, norm);
    xdbg.outcome = `updated existing transfer ${existing.id}`;
    return res.json({ ok: true, transfer_id: existing.id, updated: true });
  }

  // Route to the fronter the VICIdial agent maps to. Unmapped agent → capture
  // is skipped (200 so the dialer doesn't retry) and logged for the superadmin.
  const { userId, companyId } = await resolveAgent(agent);
  xdbg.agent_mapped = !!userId; xdbg.company_id = companyId;
  if (!userId || !companyId) {
    logger.warn('VICIDIAL_XFER', `Unmapped agent "${agent}" (code ${code}) — pending transfer not created`);
    xdbg.outcome = `NO TRANSFER — fronter agent "${agent}" not mapped`;
    return res.json({ ok: false, reason: 'agent not mapped', code });
  }

  // The fronter campaign's Dispo Call URL fires on EVERY disposition. Only the
  // configured transfer dispositions (config.field_map.xfer_dispos) create a
  // pending transfer — otherwise NI/DNC/no-answer calls would spam the CRM.
  // No list configured → accept any (back-compat).
  const dispo = String(p.dispo || '').trim().toUpperCase();
  if (dispo) {
    const { data: cfg } = await supabaseAdmin
      .from('vicidial_config').select('field_map').eq('company_id', companyId).maybeSingle();
    const xferDispos = Array.isArray(cfg?.field_map?.xfer_dispos)
      ? cfg.field_map.xfer_dispos.map(s => String(s).trim().toUpperCase()).filter(Boolean) : [];
    if (xferDispos.length && !xferDispos.includes(dispo)) {
      xdbg.outcome = `NO TRANSFER — "${dispo}" not in xfer_dispos [${xferDispos.join(',')}]`;
      return res.json({ ok: false, reason: 'non-transfer disposition', dispo });   // 200 → no dialer retry
    }
  }

  // DEDUP: a fronter who ALSO typed the transfer into the CRM by hand creates a
  // richer, code-less transfer seconds before the dialer's XFER fires here. Those
  // two never merged (idempotency keys on the code, which the manual one lacks),
  // so the lead showed up twice. Before inserting, look for that just-created
  // hand-entered transfer (same phone + company, NO dialer code, last 30 min) and
  // STAMP the code onto it instead of making a second row. We keep its richer
  // form_data/status untouched — only attach the code + agent so closer-dispos
  // can match it. Scoped tight (code-less + 30 min) so it never merges a genuine
  // separate transfer or a repeat customer from another day.
  if (norm) {
    const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: manual } = await supabaseAdmin
      .from('transfers')
      .select('id')
      .eq('company_id', companyId)
      .eq('normalized_phone', norm)
      .is('vicidial_vendor_code', null)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (manual) {
      await supabaseAdmin.from('transfers')
        .update({ vicidial_vendor_code: code, vicidial_agent: agent || null })
        .eq('id', manual.id);
      await reconcileQueuedDispoForTransfer({ id: manual.id }, norm);
      logger.success('VICIDIAL_XFER', `Merged dialer XFER into hand-entered transfer ${manual.id} (code ${code})`);
      xdbg.outcome = `merged into hand-entered transfer ${manual.id} (no duplicate)`;
      return res.json({ ok: true, transfer_id: manual.id, merged: true });
    }
  }

  const { data, error } = await supabaseAdmin.from('transfers').insert({
    company_id: companyId,
    created_by: userId,
    status: 'pending',
    vicidial_pending: true,
    vicidial_vendor_code: code,
    vicidial_agent: agent || null,
    normalized_phone: norm || null,
    form_data: { cli_number: norm || null, customer_phone: phone, Phone: phone },
  }).select('id').single();
  if (error) { xdbg.outcome = `DB error: ${error.message}`; return res.status(500).json({ ok: false, error: error.message }); }

  logger.success('VICIDIAL_XFER', `Pending transfer ${data.id} for agent ${agent} (code ${code})`);
  await reconcileQueuedDispoForTransfer({ id: data.id }, norm);
  xdbg.outcome = `created transfer ${data.id}`;
  res.json({ ok: true, transfer_id: data.id });
}));

// Ring buffer of the last 20 closer-dispo hits — lets the superadmin SEE exactly
// what the dialer sent (token substitution + match outcome) without server logs.
const recentDispo = [];
ingest.get('/dispo-debug', requireToken, (req, res) => res.json({ recent: recentDispo }));

// ── INGEST: closer disposition → map onto the transfer ───────────────────────
ingest.all('/closer-dispo', requireToken, asyncHandler(async (req, res) => {
  const p = { ...req.query, ...req.body };
  const dispo = String(p.dispo || '').trim();
  // Rich debug entry — captures exactly what the dialer sent + how it resolved,
  // so the dispo-debug URL alone explains every match/queue. In-memory only.
  const dbg = {
    at: new Date().toISOString(),
    code: String(p.code || ''), alt_code: String(p.alt_code || ''),
    phone: String(p.phone || ''), normalized: normPhone(String(p.phone || '')) || '',
    dispo, agent: String(p.agent || ''),
    agent_mapped: null, closer_company_id: null,
    outcome: 'pending',
  };
  recentDispo.unshift(dbg); if (recentDispo.length > 500) recentDispo.pop();
  // One closer URL works for both topologies: it sends vendor_lead_code (set on
  // different-box leads) AND lead_id as a fallback (matches same-box leads).
  // Try each in order; first hit wins.
  // No code/alt_code is normal for the closer URL (dispo+agent only) — VICIdial
  // can't send lead tokens for the closer's calls. We fall through to the queue.
  const inCode  = String(p.code || '').trim();
  const inAlt   = String(p.alt_code || '').trim();
  // Exact codes carry the box prefix (WTI/ETC/TMC + lead_id) → globally unique.
  const exactCodes = [...new Set([inCode, inAlt].filter(Boolean))];
  // Prefixed variants of a BARE numeric id — used when the fronter never pressed
  // the webform so vendor_lead_code is empty and the dialer only sent the bare
  // lead_id. The bare id is NOT unique across boxes, so these are matched ONLY
  // together with the customer phone (below), never on their own.
  const prefixedCodes = [...new Set(
    [inCode, inAlt].filter(v => /^\d+$/.test(v)).flatMap(v => ['WTI' + v, 'ETC' + v, 'TMC' + v])
  )];
  const candidates = [...new Set([...exactCodes, ...prefixedCodes])];
  logger.info('VICIDIAL_DISPO_IN', `code="${p.code || ''}" alt_code="${p.alt_code || ''}" dispo="${dispo}" agent="${p.agent || ''}"`);

  // Closer identity from the dialing agent — drives company scoping + the queue.
  const closerAgent = String(p.agent || '').trim();
  let closerUserId = null, closerCompanyId = null;
  if (closerAgent) {
    const { userId, companyId } = await resolveAgent(closerAgent);
    closerUserId = userId; closerCompanyId = companyId;
  }
  dbg.agent_mapped = !!closerUserId;
  dbg.closer_company_id = closerCompanyId;

  let tr = null, code = candidates[0];
  // 1. Exact (prefixed) code — globally unique, trust it directly.
  if (exactCodes.length) {
    const { data } = await supabaseAdmin
      .from('transfers').select('id, company_id, assigned_closer_id, status, vicidial_vendor_code')
      .in('vicidial_vendor_code', exactCodes)
      .order('created_at', { ascending: false }).limit(1);
    if (data && data.length) { tr = data[0]; code = data[0].vicidial_vendor_code; }
  }
  // 2. Prefixed bare lead_id — ambiguous across boxes, so REQUIRE the customer
  //    phone to also match (lead_id + phone together is unambiguous). Prevents a
  //    same numeric lead_id on another box stealing this disposition.
  if (!tr && prefixedCodes.length) {
    const ph = normPhone(String(p.phone || ''));
    if (ph) {
      const { data } = await supabaseAdmin
        .from('transfers').select('id, company_id, assigned_closer_id, status, vicidial_vendor_code')
        .in('vicidial_vendor_code', prefixedCodes).eq('normalized_phone', ph)
        .order('created_at', { ascending: false }).limit(1);
      if (data && data.length) { tr = data[0]; code = data[0].vicidial_vendor_code; }
    }
  }
  // Phone fallback — the customer phone is identical on both sides even when the
  // closer's lead_id differs (same-box transfers that spawn a fresh closer lead).
  if (!tr) {
    const ph = normPhone(String(p.phone || ''));
    if (ph) {
      const { data: byPhone } = await supabaseAdmin
        .from('transfers').select('id, company_id, assigned_closer_id, status')
        .eq('normalized_phone', ph).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (byPhone) { tr = byPhone; code = `phone:${ph}`; }
    }
  }
  // NOTE: a "recency" fallback used to live here — attach the dispo to the most
  // recent in-flight lead from any linked fronter company. REMOVED: that pool is
  // shared across ALL closers, so with concurrent calls one closer's disposition
  // landed on another closer's lead (cross-contamination). The in-group Dispo URL
  // reliably sends vendor_lead_code + phone now, so matching is keyed on the lead
  // id / the customer's own number above. If neither matches we queue it (below)
  // for the closer to attach to the right lead by hand — never guess.

  const talk = parseInt(p.talk_time, 10);
  const rawCode = dispo.toUpperCase();

  // No lead context (no code AND no phone) — the dialer fired the URL with no
  // lead tokens. ONLY ignore the clearly no-customer-contact codes (answering
  // machine / no-answer / dead air / busy / disconnected …). A REAL outcome
  // (SALE, CALLBK, NI, DNC, post-date…) must NEVER be silently dropped — it
  // falls through to the queue so the closer can attach it to a lead by hand.
  const NO_CONNECT = new Set([
    'A', 'N', 'NA', 'DAIR', 'DROP', 'AFTHRS', 'B', 'DC', 'AB', 'ADC',
    'PDROP', 'AA', 'NANQUE', 'TIMEOT', 'CXHNGP',
  ]);
  if (!tr && !candidates.length && !dbg.normalized && NO_CONNECT.has(rawCode)) {
    dbg.outcome = `ignored — no-connect "${dispo}" (no customer contact, no code/phone)`;
    return res.json({ ok: true, ignored: true });
  }

  // ── matched a lead → apply straight away (scoped to the closer's company) ──
  if (tr) {
    const dispoCompanyId = closerCompanyId || tr.company_id;
    const mapped = await bumpDispoMap(dispoCompanyId, rawCode);
    const dispoName = mapped?.disposition_name || dispo || rawCode || null;

    // Sale-form dispositions (admin toggle) don't auto-apply: drop a
    // "Confirm → open sale form" item (WITH the matched transfer) into the
    // closer's dialer-dispositions banner. The closer fills the sale + submits
    // to compliance, exactly like the manual search → sale flow.
    if (closerUserId && await dispoOpensSaleForm(dispoCompanyId, dispoName)) {
      const { data: q } = await supabaseAdmin.from('vicidial_closer_dispo_queue').insert({
        closer_user_id: closerUserId, company_id: dispoCompanyId,
        vici_code: rawCode, disposition_name: dispoName, raw_dispo: dispo, transfer_id: tr.id,
      }).select('id').single();
      dbg.outcome = `matched transfer ${tr.id} → sale-form pending (closer confirms)`;
      logger.success('VICIDIAL_DISPO', `Sale-form pending: transfer ${tr.id} ← "${dispo}" for closer ${closerUserId}`);
      return res.json({ ok: true, sale_form_pending: true, transfer_id: tr.id, id: q?.id, mapped: dispoName });
    }

    // Always log a disposition_action so the outcome shows everywhere (compliance,
    // closer tab, admin) like a manual one. Mapped → friendly name; unmapped →
    // the raw dialer code (still visible; admin can map it later to rename).
    await applyCloserDispo({ transfer: tr, dispoCompanyId, closerUserId, dispoName, rawDispo: dispo, talk });
    dbg.outcome = `matched transfer ${tr.id} on "${code}"`;
    logger.success('VICIDIAL_DISPO', `Transfer ${tr.id} ← "${dispo}" → ${mapped?.disposition_name || '(unmapped)'}`);
    return res.json({ ok: true, transfer_id: tr.id, mapped: mapped?.disposition_name || null });
  }

  // ── no lead match → queue it for the closer to assign in the CRM ──
  // VICIdial's closer Dispo URL can't tell us which lead, so the closer picks it
  // from their CRM (mirrors the fronter's pending-transfer confirm). Works for
  // both same-box and different-box without any lead/phone token.
  if (closerUserId) {
    const mapped = await bumpDispoMap(closerCompanyId, rawCode);
    const { data: q } = await supabaseAdmin.from('vicidial_closer_dispo_queue').insert({
      closer_user_id: closerUserId, company_id: closerCompanyId,
      vici_code: rawCode, disposition_name: mapped?.disposition_name || null, raw_dispo: dispo,
      normalized_phone: dbg.normalized || null,   // lets a late fronter-xfer reconcile this by phone
    }).select('id').single();
    // Spell out WHY it didn't match so the debug log is self-diagnosing:
    // which codes were tried + whether a phone was even sent.
    const why = candidates.length
      ? `tried code=[${candidates.join(',')}]${dbg.normalized ? ` + phone=${dbg.normalized}` : ' + NO PHONE SENT'} → no transfer`
      : (dbg.normalized ? `phone=${dbg.normalized} not found in any transfer` : 'NO code AND NO phone sent by the dialer');
    dbg.outcome = `queued (no lead match) · ${why}`;
    logger.success('VICIDIAL_DISPO', `Queued "${dispo}" for closer ${closerUserId} — ${why}`);
    return res.json({ ok: true, queued: true, id: q?.id, mapped: mapped?.disposition_name || null });
  }

  dbg.outcome = `NO MATCH + agent "${closerAgent}" not mapped (phone=${dbg.normalized || 'none'})`;
  logger.warn('VICIDIAL_DISPO', `No transfer for ${candidates.join('/')} and agent "${closerAgent}" not mapped`);
  return res.json({ ok: false, reason: 'no matching transfer and agent not mapped', sent: candidates });
}));

// ── API: closer's pending dialer dispositions (awaiting a lead) ───────────────
api.get('/closer-dispos', asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('vicidial_closer_dispo_queue')
    .select('id, vici_code, disposition_name, raw_dispo, created_at, transfer_id')
    .eq('closer_user_id', req.user.id).eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  // ONLY sale-form dispositions (Sale / Post Date) need the closer — they open
  // the sale form. Every other disposition the dialer fires is recorded
  // automatically (matched immediately, or reconciled when the transfer appears),
  // so it must NOT clutter the closer's banner. Show only sale-form dispositions.
  const { data: saleCfgs } = await supabaseAdmin
    .from('disposition_configs').select('name').eq('opens_sale_form', true).eq('is_active', true);
  const saleNames = new Set((saleCfgs || []).map(d => (d.name || '').trim().toLowerCase()));
  // A queue row is a sale-form item if it already carries a transfer (only the
  // sale-form branch ever queues WITH a transfer_id) OR its disposition is a
  // sale-form one. The transfer_id check keeps matched sales visible even if the
  // config lookup momentarily returns nothing — never silently hide a sale.
  const saleRows = (data || []).filter(d =>
    !!d.transfer_id || saleNames.has((d.disposition_name || '').trim().toLowerCase()));

  // Sale-form items already carry the matched transfer — hydrate its form_data
  // so the closer's banner can open the pre-filled sale form in one click.
  const tids = [...new Set(saleRows.map(d => d.transfer_id).filter(Boolean))];
  let tmap = {};
  if (tids.length) {
    const { data: tfs } = await supabaseAdmin
      .from('transfers').select('id, form_data, company_id, assigned_closer_id, status').in('id', tids);
    (tfs || []).forEach(t => { tmap[t.id] = t; });
  }
  const dispos = saleRows.map(d => ({ ...d, transfer: d.transfer_id ? (tmap[d.transfer_id] || null) : null }));
  res.json({ dispos });
}));

// Recent transfers the closer can attach a queued disposition to — assigned to
// them OR recent leads from their linked fronter companies.
api.get('/closer-assignable', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const since = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
  // Fronter companies linked to the closer's companies.
  const { data: myCos } = await supabaseAdmin
    .from('user_company_roles').select('company_id').eq('user_id', req.user.id).eq('is_active', true);
  const closerCoIds = (myCos || []).map(c => c.company_id).filter(Boolean);
  let fronterCoIds = [];
  if (closerCoIds.length) {
    const { data: links } = await supabaseAdmin
      .from('company_links').select('fronter_company_id').in('closer_company_id', closerCoIds);
    fronterCoIds = [...new Set((links || []).map(l => l.fronter_company_id).filter(Boolean))];
  }

  // Include BOTH confirmed and still-pending (unconfirmed) leads — the closer may
  // disposition before the fronter confirms the transfer.
  let query = supabaseAdmin.from('transfers')
    .select('id, form_data, normalized_phone, created_at, assigned_closer_id, company_id, vicidial_vendor_code, vicidial_pending')
    .gte('created_at', since)
    .order('created_at', { ascending: false }).limit(40);
  // scope: mine OR from a linked fronter company
  if (fronterCoIds.length) query = query.or(`assigned_closer_id.eq.${req.user.id},company_id.in.(${fronterCoIds.join(',')})`);
  else query = query.eq('assigned_closer_id', req.user.id);
  if (q) {
    const s = q.replace(/[%,]/g, '');
    query = query.or(`normalized_phone.ilike.%${s}%,vicidial_vendor_code.ilike.%${s}%,form_data->>customer_name.ilike.%${s}%,form_data->>FirstName.ilike.%${s}%,form_data->>Phone.ilike.%${s}%`);
  }
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  const rows = (data || []).map(t => {
    const fd = t.form_data || {};
    const name = fd.customer_name || (fd.FirstName ? `${fd.FirstName} ${fd.LastName || ''}`.trim() : 'Lead');
    const phone = fd.Phone || fd.customer_phone || t.normalized_phone || '';
    return { id: t.id, name, phone, created_at: t.created_at, code: t.vicidial_vendor_code || null, pending: !!t.vicidial_pending };
  });
  res.json({ transfers: rows });
}));

// ── Fetch Dispo: pull a record's closer disposition on demand ─────────────────
// Any CRM user can hit this on a transfer that shows no disposition. It first
// attaches a closer disposition already sitting in the CRM queue (the common
// case); if none, it asks the dialer for the latest real disposition on that
// phone and attaches that. Idempotent-ish: re-running just re-applies the latest.
api.post('/fetch-dispo/:transferId', asyncHandler(async (req, res) => {
  const { data: tr } = await supabaseAdmin
    .from('transfers').select('id, company_id, normalized_phone, assigned_closer_id, status, vicidial_vendor_code').eq('id', req.params.transferId).maybeSingle();
  if (!tr) return res.status(404).json({ error: 'Transfer not found' });
  const norm = tr.normalized_phone;
  if (!norm) return res.status(400).json({ error: 'This transfer has no phone number to look up' });

  // 1) Queue-first — a closer disposition may already be queued (fired by the
  //    dialer but unattached because the transfer was created the manual way).
  const { data: q } = await supabaseAdmin
    .from('vicidial_closer_dispo_queue').select('*')
    .eq('normalized_phone', norm).eq('status', 'pending').is('transfer_id', null)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (q) {
    const dispoName = q.disposition_name || await lookupDispoName(q.company_id || tr.company_id, q.vici_code);
    await applyCloserDispo({ transfer: tr, dispoCompanyId: q.company_id || tr.company_id, closerUserId: q.closer_user_id, dispoName, rawDispo: q.raw_dispo, talk: NaN });
    await supabaseAdmin.from('vicidial_closer_dispo_queue').update({ status: 'applied', transfer_id: tr.id }).eq('id', q.id);
    return res.json({ ok: true, source: 'queue', disposition_name: dispoName || q.vici_code });
  }

  // 2) By lead code — the lead's STATUS persists in vicidial_list even after the
  //    call log archives, so a coded transfer can fetch an OLD disposition by its
  //    lead_id (no-connect/XFER are filtered out inside leadStatusByCode).
  if (tr.vicidial_vendor_code) {
    const code = await leadStatusByCode(tr.vicidial_vendor_code);
    if (code) {
      const dispoName = await lookupDispoName(tr.company_id, code) || code;
      await applyCloserDispo({ transfer: tr, dispoCompanyId: tr.company_id, closerUserId: null, dispoName, rawDispo: code, talk: NaN });
      return res.json({ ok: true, source: 'lead', disposition_name: dispoName });
    }
  }

  // 3) Dialer call log — latest real disposition on this phone. Only sees the
  //    ACTIVE log (the dialer archives old calls), so this is a same-day backstop.
  const found = await latestDisposition(norm);
  if (!found) return res.json({ ok: false, message: 'No disposition found yet — the call may have archived (old) and this transfer has no dialer code to look up.' });

  const dispoName = await lookupDispoName(tr.company_id, found.code) || found.code;
  const { userId: closerUserId } = await resolveAgent(found.user);
  await applyCloserDispo({ transfer: tr, dispoCompanyId: tr.company_id, closerUserId, dispoName, rawDispo: found.code, talk: NaN });
  res.json({ ok: true, source: 'dialer', disposition_name: dispoName, agent: found.user, at: found.at });
}));

// Attach a queued disposition to a chosen transfer.
api.post('/closer-dispos/:id/assign', asyncHandler(async (req, res) => {
  const transferId = req.body.transfer_id;
  if (!transferId) return res.status(400).json({ error: 'transfer_id required' });
  const { data: qrow } = await supabaseAdmin
    .from('vicidial_closer_dispo_queue').select('*').eq('id', req.params.id).maybeSingle();
  if (!qrow || qrow.closer_user_id !== req.user.id || qrow.status !== 'pending') {
    return res.status(404).json({ error: 'Pending disposition not found' });
  }
  const { data: tr } = await supabaseAdmin
    .from('transfers').select('id, company_id, assigned_closer_id, status').eq('id', transferId).maybeSingle();
  if (!tr) return res.status(404).json({ error: 'Transfer not found' });

  const dispoCompanyId = qrow.company_id || tr.company_id;
  // Re-resolve the name in case the superadmin mapped the code after it was queued.
  const dispoName = qrow.disposition_name || await lookupDispoName(dispoCompanyId, qrow.vici_code);
  try {
    await applyCloserDispo({ transfer: tr, dispoCompanyId, closerUserId: req.user.id, dispoName, rawDispo: qrow.raw_dispo, talk: NaN });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
  await supabaseAdmin.from('vicidial_closer_dispo_queue')
    .update({ status: 'assigned', transfer_id: transferId, disposition_name: dispoName || null }).eq('id', qrow.id);
  res.json({ ok: true, transfer_id: transferId, disposition_name: dispoName || null });
}));

// Dismiss a queued disposition.
api.delete('/closer-dispos/:id', asyncHandler(async (req, res) => {
  const { data: qrow } = await supabaseAdmin
    .from('vicidial_closer_dispo_queue').select('id, closer_user_id').eq('id', req.params.id).maybeSingle();
  if (!qrow || qrow.closer_user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
  await supabaseAdmin.from('vicidial_closer_dispo_queue').update({ status: 'dismissed' }).eq('id', req.params.id);
  res.json({ ok: true });
}));

// ── API: my pending-from-dialer transfers ────────────────────────────────────
api.get('/pending', asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('transfers')
    .select('id, vicidial_vendor_code, normalized_phone, form_data, vicidial_dispo, vicidial_dispo_at, vicidial_agent, assigned_closer_id, created_at')
    .eq('created_by', req.user.id).eq('vicidial_pending', true)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  const rows = data || [];

  // Surface the closer's mapped CRM disposition + closer name on the pending card
  // (the closer can disposition before the fronter confirms — show it now).
  const ids = rows.map(r => r.id);
  const dispoByT = {};
  const closerIds = new Set();
  if (ids.length) {
    const { data: acts } = await supabaseAdmin
      .from('disposition_actions').select('transfer_id, disposition_name, color, user_id, created_at')
      .in('transfer_id', ids).order('created_at', { ascending: false });
    (acts || []).forEach(a => { if (!dispoByT[a.transfer_id]) dispoByT[a.transfer_id] = a; });
    rows.forEach(r => { if (r.assigned_closer_id) closerIds.add(r.assigned_closer_id); });
  }
  let nameById = {};
  if (closerIds.size) {
    const { data: profs } = await supabaseAdmin
      .from('user_profiles').select('user_id, first_name, last_name').in('user_id', [...closerIds]);
    (profs || []).forEach(p => { nameById[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim() || null; });
  }
  const pending = rows.map(r => ({
    ...r,
    closer_disposition: dispoByT[r.id]?.disposition_name || null,
    closer_disposition_color: dispoByT[r.id]?.color || null,
    closer_name: r.assigned_closer_id ? (nameById[r.assigned_closer_id] || null) : null,
  }));
  res.json({ pending });
}));

// ── API: fill remaining fields + confirm → becomes a normal transfer ─────────
api.post('/pending/:id/confirm', asyncHandler(async (req, res) => {
  const { data: tr } = await supabaseAdmin
    .from('transfers').select('id, created_by, form_data, vicidial_pending, assigned_closer_id').eq('id', req.params.id).maybeSingle();
  if (!tr || tr.created_by !== req.user.id || !tr.vicidial_pending) {
    return res.status(404).json({ error: 'Pending transfer not found' });
  }

  const incoming = (req.body.form_data && typeof req.body.form_data === 'object') ? req.body.form_data : {};
  const merged = { ...(tr.form_data || {}), ...titleCaseFormData(expandStateInFormData(incoming)) };
  const norm = normPhone(merged.cli_number || merged.Phone || merged.customer_phone || '');

  const { data, error } = await supabaseAdmin.from('transfers').update({
    vicidial_pending: false,
    // If the closer already dispositioned (claimed) it, confirm into "assigned"
    // so it lands in the closer's assigned tab + compliance + admin — same as a
    // manual closer-worked transfer. No closer yet → plain "pending".
    status: tr.assigned_closer_id ? 'assigned' : 'pending',
    form_data: { ...merged, cli_number: norm || merged.cli_number || null },
    normalized_phone: norm || null,
    updated_at: new Date().toISOString(),
  }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  // A closer may have dispositioned between the pending-create and this confirm
  // → attach that queued disposition now.
  await reconcileQueuedDispoForTransfer({ id: data.id, company_id: data.company_id }, norm);
  res.json({ transfer: data });
}));

// ── superadmin: prefix registry + agent mapping (config UI) ──────────────────
const superOnly = asyncHandler(async (req, res, next) => {
  if (!(await isSuperAdmin(req.user.id))) return res.status(403).json({ error: 'Superadmin access required' });
  next();
});

api.get('/config', superOnly, asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin.from('vicidial_config').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  const ids = [...new Set((data || []).map(c => c.company_id).filter(Boolean))];
  let names = {};
  if (ids.length) { const { data: co } = await supabaseAdmin.from('companies').select('id, name').in('id', ids); (co || []).forEach(c => { names[c.id] = c.name; }); }
  res.json({ configs: (data || []).map(c => ({ ...c, company_name: names[c.company_id] || null })) });
}));

api.post('/config', superOnly, asyncHandler(async (req, res) => {
  const prefix = String(req.body.prefix || '').trim();
  if (!prefix) return res.status(400).json({ error: 'Prefix is required' });
  const { data, error } = await supabaseAdmin.from('vicidial_config')
    .insert({ prefix, company_id: req.body.company_id || null, field_map: req.body.field_map || {} }).select().single();
  if (error) return res.status(error.code === '23505' ? 409 : 500).json({ error: error.code === '23505' ? 'That prefix is already in use' : error.message });
  res.status(201).json({ config: data });
}));

api.put('/config/:id', superOnly, asyncHandler(async (req, res) => {
  const upd = {};
  if (req.body.prefix !== undefined)     upd.prefix = String(req.body.prefix).trim();
  if (req.body.company_id !== undefined) upd.company_id = req.body.company_id || null;
  if (req.body.is_active !== undefined)  upd.is_active = !!req.body.is_active;
  if (req.body.field_map !== undefined)  upd.field_map = req.body.field_map;
  const { data, error } = await supabaseAdmin.from('vicidial_config').update(upd).eq('id', req.params.id).select().single();
  if (error) return res.status(error.code === '23505' ? 409 : 500).json({ error: error.code === '23505' ? 'That prefix is already in use' : error.message });
  if (!data) return res.status(404).json({ error: 'Config not found' });
  res.json({ config: data });
}));

api.delete('/config/:id', superOnly, asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from('vicidial_config').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'deleted' });
}));

// ── superadmin: backfill dispositions from a vicidial_list CSV export ─────────
// The dialer API can't dump a list's leads, but the admin UI "Download leads"
// can — that CSV carries phone_number + status for every lead, and vicidial_list
// persists (no archive wall), so even old code-less transfers are covered. The
// client parses the CSV and sends rows in batches; we match each to the newest
// CRM transfer on that phone still missing a dispo and fill it. Real outcomes
// only — no-connect / transfer / system codes are skipped.
const LIST_SKIP = new Set([
  'A','N','NA','DAIR','DROP','AFTHRS','B','DC','AB','ADC','PDROP','AA','NANQUE',
  'TIMEOT','CXHNGP','INCALL','QUEUE','CH','DISPO','NEW','XFER','TRANSFER','XDROP',
  'IVRXFR','RQXFER','','-',
]);
api.post('/backfill/from-list', superOnly, asyncHandler(async (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  const dryRun = req.body.dry_run === true;
  const batchId = (req.body.batch_id && /^[0-9a-f-]{36}$/i.test(req.body.batch_id)) ? req.body.batch_id : null;
  const source  = (req.body.source || '').toString().slice(0, 200) || 'list export';

  // Open the batch on the first chunk (idempotent — later chunks reuse it).
  // Best-effort: if migration 112 isn't applied the fill still works, just without
  // undo tracking (batchOk stays false).
  let batchOk = false;
  if (batchId && !dryRun) {
    try {
      await supabaseAdmin.from('vicidial_backfill_batches')
        .upsert({ id: batchId, source, created_by: req.user.id }, { onConflict: 'id', ignoreDuplicates: true });
      batchOk = true;
    } catch { /* 112 not applied → proceed without undo tracking */ }
  }

  let matched = 0, applied = 0, skippedStatus = 0, noMatch = 0;
  const now = new Date().toISOString();
  for (const r of rows) {
    const ph = normPhone(String(r.phone || r.phone_number || ''));
    const status = String(r.status || '').trim().toUpperCase();
    if (!ph) { noMatch++; continue; }
    if (LIST_SKIP.has(status)) { skippedStatus++; continue; }
    // newest CRM transfer on this phone still missing a disposition
    const { data: tr } = await supabaseAdmin
      .from('transfers').select('id, company_id, vicidial_dispo')
      .eq('normalized_phone', ph).is('vicidial_dispo', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!tr) { noMatch++; continue; }
    matched++;
    if (dryRun) continue;
    try {
      // Set ONLY the dialer-disposition fields (no status/closer cascade) so the
      // fill is self-contained + cleanly reversible.
      await supabaseAdmin.from('transfers')
        .update({ vicidial_dispo: status, vicidial_dispo_at: now }).eq('id', tr.id);
      // Mirror a closer dispo into the actions log; capture its id for undo.
      const dispoName = await lookupDispoName(tr.company_id, status) || status;
      let actionId = null;
      try {
        const { data: cfg } = await supabaseAdmin.from('disposition_configs')
          .select('id, color').eq('name', dispoName).eq('is_active', true)
          .or(`company_id.is.null,company_id.eq.${tr.company_id}`)
          .order('company_id', { ascending: true, nullsFirst: false }).limit(1).maybeSingle();
        const { data: da } = await supabaseAdmin.from('disposition_actions').insert({
          transfer_id: tr.id, company_id: tr.company_id, user_id: null,
          disposition_config_id: cfg?.id || null, disposition_name: dispoName,
          color: cfg?.color || null, note: `Backfill from list (${status})`, setter_role: 'closer',
        }).select('id').single();
        actionId = da?.id || null;
      } catch { /* actions log is non-critical */ }
      applied++;
      // Undo tracking — best-effort, never affects the fill or the count.
      if (batchOk) {
        try {
          await supabaseAdmin.from('vicidial_backfill_fills').insert({
            batch_id: batchId, transfer_id: tr.id, prev_dispo: tr.vicidial_dispo || null,
            new_dispo: status, dispo_action_id: actionId,
          });
        } catch { /* tracking is non-critical */ }
      }
    } catch { /* skip a bad row, keep going */ }
  }

  // Roll the running totals onto the batch (chunks are sequential → no race).
  if (batchOk) {
    try {
      const { data: b } = await supabaseAdmin.from('vicidial_backfill_batches')
        .select('total_rows, applied_count').eq('id', batchId).maybeSingle();
      await supabaseAdmin.from('vicidial_backfill_batches')
        .update({ total_rows: (b?.total_rows || 0) + rows.length, applied_count: (b?.applied_count || 0) + applied })
        .eq('id', batchId);
    } catch { /* tracking non-critical */ }
  }
  res.json({ ok: true, batch_id: batchId, received: rows.length, matched, applied, skipped_status: skippedStatus, no_match: noMatch });
}));

// List recent import batches (newest first) so the superadmin can review / undo.
api.get('/backfill/batches', superOnly, asyncHandler(async (req, res) => {
  const { data } = await supabaseAdmin.from('vicidial_backfill_batches')
    .select('id, source, created_at, total_rows, applied_count, undone_at, undone_count')
    .order('created_at', { ascending: false }).limit(50);
  res.json({ batches: data || [] });
}));

// Undo a batch: restore each filled transfer's disposition to its previous value
// and delete the disposition_actions row we inserted — but ONLY where the value
// still equals what this batch wrote (never clobber a change made since).
api.post('/backfill/batches/:id/undo', superOnly, asyncHandler(async (req, res) => {
  const id = req.params.id;
  const { data: batch } = await supabaseAdmin.from('vicidial_backfill_batches')
    .select('id, undone_at').eq('id', id).maybeSingle();
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  if (batch.undone_at) return res.status(400).json({ error: 'This batch is already undone' });

  const { data: fills } = await supabaseAdmin.from('vicidial_backfill_fills')
    .select('transfer_id, prev_dispo, new_dispo, dispo_action_id').eq('batch_id', id);
  let undone = 0, skipped = 0;
  for (const f of (fills || [])) {
    const { data: tr } = await supabaseAdmin.from('transfers')
      .select('id, vicidial_dispo').eq('id', f.transfer_id).maybeSingle();
    if (!tr || tr.vicidial_dispo !== f.new_dispo) { skipped++; continue; }  // changed since → leave it
    await supabaseAdmin.from('transfers')
      .update({ vicidial_dispo: f.prev_dispo || null, vicidial_dispo_at: null }).eq('id', f.transfer_id);
    if (f.dispo_action_id) await supabaseAdmin.from('disposition_actions').delete().eq('id', f.dispo_action_id);
    undone++;
  }
  await supabaseAdmin.from('vicidial_backfill_batches')
    .update({ undone_at: new Date().toISOString(), undone_count: undone }).eq('id', id);
  res.json({ ok: true, undone, skipped });
}));

// ── superadmin: backfill dispositions for OLD coded transfers ────────────────
// Only CODED transfers are recoverable: the lead's status persists in
// vicidial_list (archive-proof) so lead_field_info(status, lead_id) returns the
// real disposition. Code-LESS transfers have no lead_id and the phone call-log
// archives daily, so there is no source to read — they are intentionally skipped.
// Cursor-paged (created_at) + throttled so it never hammers the dialer; the
// client loops until done. Idempotent — re-running just re-applies the latest.
api.post('/backfill/coded', superOnly, asyncHandler(async (req, res) => {
  const batch  = Math.min(parseInt(req.body.batch, 10) || 25, 50);
  const before = req.body.before || null;  // created_at cursor — process OLDER than this
  let q = supabaseAdmin.from('transfers')
    .select('id, company_id, normalized_phone, assigned_closer_id, status, vicidial_vendor_code, created_at')
    .is('vicidial_dispo', null).not('vicidial_vendor_code', 'is', null)
    .order('created_at', { ascending: false }).limit(batch);
  if (before) q = q.lt('created_at', before);
  const { data: rows } = await q;

  let found = 0, lastCursor = before;
  for (const tr of (rows || [])) {
    lastCursor = tr.created_at;
    try {
      const code = await leadStatusByCode(tr.vicidial_vendor_code);   // real status or null
      if (code) {
        const dispoName = await lookupDispoName(tr.company_id, code) || code;
        await applyCloserDispo({ transfer: tr, dispoCompanyId: tr.company_id, closerUserId: null, dispoName, rawDispo: code, talk: NaN });
        found++;
      }
    } catch { /* skip a purged/bad lead, keep going */ }
    await new Promise(r => setTimeout(r, 250));  // gentle on the dialer
  }
  // total coded transfers still missing a dispo (informational progress denominator)
  const { count: remaining } = await supabaseAdmin.from('transfers')
    .select('*', { count: 'exact', head: true })
    .is('vicidial_dispo', null).not('vicidial_vendor_code', 'is', null);
  res.json({ ok: true, processed: rows?.length || 0, found, cursor: lastCursor, remaining: remaining || 0, done: (rows?.length || 0) < batch });
}));

// Agent-id map — list users (search) with their current mapping.
api.get('/agents', superOnly, asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  const buildQuery = (cols) => {
    let query = supabaseAdmin.from('user_profiles').select(cols).order('first_name').limit(100);
    if (q) { const s = q.replace(/[%,]/g, ''); query = query.or(`first_name.ilike.%${s}%,last_name.ilike.%${s}%,vicidial_agent_id.ilike.%${s}%`); }
    return query;
  };
  let { data: profs, error: pErr } = await buildQuery('user_id, first_name, last_name, vicidial_agent_id, vicidial_agent_ids');
  if (pErr && /vicidial_agent_ids|column/i.test(pErr.message || '')) {  // pre-111 fallback
    ({ data: profs } = await buildQuery('user_id, first_name, last_name, vicidial_agent_id'));
  }
  const ids = (profs || []).map(p => p.user_id);
  let meta = {};
  if (ids.length) {
    const { data: ucr } = await supabaseAdmin.from('user_company_roles')
      .select('user_id, companies(name), custom_roles(level)').in('user_id', ids).eq('is_active', true);
    (ucr || []).forEach(r => { if (!meta[r.user_id]) meta[r.user_id] = { company: r.companies?.name || '', role: r.custom_roles?.level || '' }; });
  }
  res.json({ agents: (profs || []).map(p => {
    // All dialer ids (multi-box) surfaced as a comma list; round-trips on save.
    const all = (p.vicidial_agent_ids && p.vicidial_agent_ids.length) ? p.vicidial_agent_ids : (p.vicidial_agent_id ? [p.vicidial_agent_id] : []);
    return {
      user_id: p.user_id, name: `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'User',
      vicidial_agent_id: all.join(', '), company: meta[p.user_id]?.company || '', role: meta[p.user_id]?.role || '',
    };
  }) });
}));

api.post('/agents', superOnly, asyncHandler(async (req, res) => {
  if (!req.body.user_id) return res.status(400).json({ error: 'user_id required' });
  // Accept one id or a comma/space-separated list (a user can work several boxes).
  const agentIds = [...new Set(String(req.body.agent_id || '').split(/[,\s]+/).map(s => s.trim()).filter(Boolean))];
  const primary = agentIds[0] || null;
  if (agentIds.length) {  // reject ids already mapped to ANOTHER user (both columns)
    const list = agentIds.join(',');
    const { data: clash } = await supabaseAdmin.from('user_profiles')
      .select('user_id, vicidial_agent_id, vicidial_agent_ids')
      .or(`vicidial_agent_id.in.(${list}),vicidial_agent_ids.ov.{${list}}`).limit(5);
    if ((clash || []).some(r => r.user_id !== req.body.user_id)) {
      return res.status(409).json({ error: 'One of those agent ids is already mapped to another user' });
    }
  }
  let { error } = await supabaseAdmin.from('user_profiles')
    .update({ vicidial_agent_id: primary, vicidial_agent_ids: agentIds }).eq('user_id', req.body.user_id);
  if (error && /vicidial_agent_ids|column/i.test(error.message || '')) {  // pre-111 fallback
    ({ error } = await supabaseAdmin.from('user_profiles').update({ vicidial_agent_id: primary }).eq('user_id', req.body.user_id));
  }
  if (error) return res.status(error.code === '23505' ? 409 : 500).json({ error: error.code === '23505' ? 'That agent id is already mapped to another user' : error.message });
  res.json({ ok: true });
}));

// ── superadmin: disposition map (raw dialer code → CRM disposition) ──────────
// CRM dispositions for the dropdown. Mirror the closer's actual dropdown: GLOBAL
// configs (company_id IS NULL) PLUS the selected company's own — many CRMs keep
// all dispositions global, so a strict company filter would show nothing.
api.get('/dispositions', superOnly, asyncHandler(async (req, res) => {
  let q = supabaseAdmin.from('disposition_configs').select('id, name, company_id').eq('is_active', true).order('name');
  const cid = req.query.company_id;
  if (cid && cid !== '__global__') q = q.or(`company_id.is.null,company_id.eq.${cid}`);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  // distinct names
  const seen = new Set(); const names = [];
  (data || []).forEach(d => { if (d.name && !seen.has(d.name)) { seen.add(d.name); names.push(d.name); } });
  res.json({ dispositions: names });
}));

api.get('/dispo-map', superOnly, asyncHandler(async (req, res) => {
  const cid = req.query.company_id;
  let q = supabaseAdmin.from('vicidial_dispo_map').select('*');
  if (cid === '__global__') q = q.is('company_id', null);
  else if (cid) q = q.or(`company_id.is.null,company_id.eq.${cid}`);   // company rows + global
  // Unmapped (pending) first, then by most-seen.
  const { data, error } = await q.order('disposition_name', { ascending: true, nullsFirst: true }).order('hits', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ map: data || [] });
}));

api.post('/dispo-map', superOnly, asyncHandler(async (req, res) => {
  const isGlobal = req.body.company_id === '__global__' || req.body.global === true;
  const company_id = isGlobal ? null : (req.body.company_id || null);
  const vici_code  = String(req.body.vici_code || '').trim().toUpperCase();
  if (!vici_code) return res.status(400).json({ error: 'vici_code is required' });
  if (!company_id && !isGlobal) return res.status(400).json({ error: 'Pick a company or Global' });
  const fields = {
    disposition_name: req.body.disposition_name ? String(req.body.disposition_name).trim() : null,
    category: req.body.category ? String(req.body.category).trim() : null,
  };
  // The UNIQUE(company_id, vici_code) index doesn't dedupe NULL company_id, so
  // handle global rows with an explicit find-then-write.
  if (isGlobal) {
    const { data: existing } = await supabaseAdmin.from('vicidial_dispo_map')
      .select('id').is('company_id', null).eq('vici_code', vici_code).maybeSingle();
    if (existing) {
      const { data, error } = await supabaseAdmin.from('vicidial_dispo_map').update(fields).eq('id', existing.id).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json({ entry: data });
    }
    const { data, error } = await supabaseAdmin.from('vicidial_dispo_map')
      .insert({ company_id: null, vici_code, ...fields }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ entry: data });
  }
  const { data, error } = await supabaseAdmin.from('vicidial_dispo_map')
    .upsert({ company_id, vici_code, ...fields }, { onConflict: 'company_id,vici_code' }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ entry: data });
}));

api.put('/dispo-map/:id', superOnly, asyncHandler(async (req, res) => {
  const upd = {};
  if (req.body.disposition_name !== undefined) upd.disposition_name = req.body.disposition_name ? String(req.body.disposition_name).trim() : null;
  if (req.body.category !== undefined)         upd.category = req.body.category ? String(req.body.category).trim() : null;
  const { data, error } = await supabaseAdmin.from('vicidial_dispo_map').update(upd).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Not found' });
  res.json({ entry: data });
}));

api.delete('/dispo-map/:id', superOnly, asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from('vicidial_dispo_map').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'deleted' });
}));

// Exported so the CRM transfer-create / confirm paths can attach a closer
// disposition that queued before the transfer existed (the fronter-xfer path
// already reconciles; the manual/webform paths did not, leaving the dispo stuck
// in the queue and the transfer showing no closer/disposition).
module.exports = { ingest, api, reconcileQueuedDispoForTransfer };
