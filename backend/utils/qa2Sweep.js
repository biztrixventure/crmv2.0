// ============================================================================
// qa2Sweep.js — QA v2's sweep adapter (build brief 7.3). A thin wrapper
// around qaDialerSampler.js's buildRawCallPool() — reuses its concurrency,
// caching, dedupe, and CRM-exclusion untouched, never reimplemented. Unlike
// v1's sampler, this records EVERY swept call into qa2_call (source='sweep'),
// not a sampled subset — sampling decides what gets ASSIGNED (Phase 8),
// never what gets RECORDED (build brief 7.1).
//
// A sweep carries no dispo (it's a raw recording, not a dialer webhook), so
// a manager's sweep rule is typically match_type='any' — "everything swept
// for this company is RCM material." No matching rule -> Unclassified pool,
// same as ingest.
//
// Classification is resolved PER LEG, not once for the whole pool — 'sweep'
// is a single source value covering BOTH fronter and closer calls in the
// same pool (unlike ingest, which already splits into ingest_fronter /
// ingest_closer), so without this a fronter call and a closer call could
// wrongly match the same rule (see qa2ClassifyResolver.js's leg filter).
// ============================================================================

const { supabaseAdmin } = require('../config/database');
const logger = require('./logger');
const { buildRawCallPool } = require('./qaDialerSampler');
const { resolveAgent } = require('../routes/vicidial');
const { normPhone } = require('./uploadService');
const { classifyCall } = require('./qa2ClassifyResolver');
const { checkUnclassifiedThreshold } = require('./qa2UnclassifiedAlert');

async function sweepCompanyIntoQa2({ companyId, covers = ['fronter', 'closer'], date } = {}) {
  const { day, roleByAgent, pool, reason } = await buildRawCallPool(companyId, { covers, date });
  if (!pool.length) return { day, written: 0, reason: reason || 'empty_pool' };

  // One classification lookup per leg (not per row) — a sweep call has no
  // per-row dispo, so every fronter-leg row classifies identically to every
  // other fronter-leg row, and likewise for closer.
  const [fronterMethodId, closerMethodId] = await Promise.all([
    classifyCall({ source: 'sweep', dispo: null, leg: 'fronter' }),
    classifyCall({ source: 'sweep', dispo: null, leg: 'closer' }),
  ]);

  // Resolve each unique dialer agent id to a CRM user once, not once per row.
  const agentCache = new Map();
  function agentFor(agentUser) {
    const key = String(agentUser || '').toUpperCase();
    if (!agentCache.has(key)) agentCache.set(key, resolveAgent(agentUser));
    return agentCache.get(key);
  }

  let written = 0;
  let sawUnclassified = false;

  for (const g of pool) {
    const { userId } = await agentFor(g.agent_user);
    if (!userId) continue; // unmapped agent — same skip rule the ingest hook uses

    const role = roleByAgent[String(g.agent_user || '').toUpperCase()];
    const leg = role === 'closer' ? 'closer' : 'fronter';
    const method_id = leg === 'closer' ? closerMethodId : fronterMethodId;

    g.parts.sort((a, b) => (b.duration || 0) - (a.duration || 0));
    const primary = g.parts[0];
    const norm = normPhone(g.phone) || null;
    const now = new Date().toISOString();

    const row = {
      box_id: primary.box_id || null,
      dialer_lead_id: primary.lead_id || null,
      vendor_code: null,
      method_id,
      classified_by: null,
      classified_at: method_id ? now : null,
      leg,
      agent_user: g.agent_user || null,
      agent_user_id: userId,
      company_id: companyId,
      customer_phone: g.phone || null,
      normalized_phone: norm,
      dispo_raw: null,
      call_at: primary.start_time || null,
      talk_sec: Number.isFinite(primary.duration) ? primary.duration : null,
      recording_id: primary.recording_id ? String(primary.recording_id) : null,
      recording_location: primary.location || null,
      // The sweep already found the recording via listDayRecordings — no
      // separate poller pass needed for these rows.
      recording_state: primary.recording_id ? 'found' : 'missing',
      qa_relevant: true,
      source: 'sweep',
    };

    const { error } = await supabaseAdmin.from('qa2_call').insert(row);
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) continue; // already swept — expected on a re-run
      logger.warn('QA2_SWEEP', `insert failed: ${error.message}`);
      continue;
    }
    written++;
    if (!method_id) sawUnclassified = true;
  }

  if (sawUnclassified) checkUnclassifiedThreshold(companyId).catch(() => {});
  logger.info('QA2_SWEEP', `${companyId}: wrote ${written}/${pool.length} raw dialer call(s) for ${day}`);
  return { day, written, pool: pool.length };
}

module.exports = { sweepCompanyIntoQa2 };
