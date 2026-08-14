// ============================================================================
// qa2VicidialIngestHook.js — QA v2's call-population hook (build brief 7.1).
// Observes /api/vicidial/fronter-xfer and /api/vicidial/closer-dispo traffic
// WITHOUT touching vicidial.js's internals at all — mounted as middleware
// ahead of the real ingest router (server.js), wraps res.json so the REAL
// response is sent first, unchanged, and only THEN does a fire-and-forget,
// try/catch-guarded qa2_call insert run. If this hook throws, the dialer
// never even sees it — ground rule: never break or slow the existing path.
//
// "Record every ingested call, not just sampled ones" — a row is written
// whenever the request carries a resolvable agent, REGARDLESS of whether the
// underlying route created/matched a transfer. A non-transfer dispo
// (NI/DNC/no-answer) on the fronter side is still a real call a QA manager
// may want to pull up later.
//
// Reuses resolveAgent (now exported from routes/vicidial.js) and
// parseVendorCode (already exported from utils/dialerBoxes.js) — no
// re-implementation of agent/box resolution, per ground rule 2.
// ============================================================================

const { supabaseAdmin } = require('../config/database');
const logger = require('../utils/logger');
const { normPhone } = require('../utils/uploadService');
const { parseVendorCode, normalizeLeadCode } = require('../utils/dialerBoxes');
const { classifyCall } = require('../utils/qa2ClassifyResolver');
const { checkUnclassifiedThreshold } = require('../utils/qa2UnclassifiedAlert');

// The dialer retries webhooks and fires the SAME event more than once (the
// real routes handle this by matching on vendor_code / phone) — qa2_call
// needs the same idempotency so a retry doesn't spawn a second reviewable
// "call" for the same real event. Match on vendor_code first (durable,
// globally unique when present); fall back to a tight recent-window match
// on (company, agent, phone, leg) when the dialer sent no usable code — this
// mirrors the "merge into hand-entered transfer within 30 min" pattern
// vicidial.js's own fronter-xfer handler already uses.
const DEDUP_WINDOW_MS = 10 * 60 * 1000;

async function findExistingCall({ companyId, agentUserId, leg, code, norm }) {
  if (code) {
    const { data } = await supabaseAdmin
      .from('qa2_call').select('id').eq('company_id', companyId).eq('leg', leg).eq('vendor_code', code).maybeSingle();
    if (data) return data.id;
  }
  if (norm) {
    const since = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();
    const { data } = await supabaseAdmin
      .from('qa2_call').select('id')
      .eq('company_id', companyId).eq('leg', leg).eq('agent_user_id', agentUserId).eq('normalized_phone', norm)
      .gte('created_at', since).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (data) return data.id;
  }
  return null;
}

async function recordCall(source, req, body) {
  // Lazy require: avoids a require-cycle at module-load time between this
  // file and routes/vicidial.js (server.js requires both independently;
  // this file only needs resolveAgent once a request actually arrives).
  const { resolveAgent } = require('../routes/vicidial');

  const p = { ...req.query, ...req.body };
  const agent = String(p.agent || '').trim();
  if (!agent) return; // no agent context — nothing meaningful to record

  const { userId, companyId } = await resolveAgent(agent);
  if (!userId || !companyId) return; // unmapped agent — the real routes skip these too

  const phone = String(p.phone || '').trim();
  const norm = normPhone(phone) || null;
  const dispoRaw = String(p.dispo || '').trim() || null;
  const talkParsed = parseInt(p.talk_time, 10);
  const talkSec = Number.isFinite(talkParsed) ? talkParsed : null;

  // Recover the box prefix on a bare numeric lead_id before anything derives
  // from it. Without this the box could never be resolved for those calls:
  // parseVendorCode(...).exact is false for a bare code, so box_id stayed null
  // and the recording poller had to widen to every box and match on the phone
  // instead of looking the clip up directly on the lead's own cluster.
  const code = normalizeLeadCode(String(p.code || p.alt_code || '').trim(), agent) || null;
  const parsed = code ? parseVendorCode(code) : null;
  // Only trust box_id when the prefix resolved to exactly the boxes that
  // carry it (parsed.exact) — a bare numeric lead_id with no prefix is
  // ambiguous across boxes and must stay null until the recording poller
  // (Phase 5.2) resolves it by actually finding the clip (mig 239).
  const boxId = parsed && parsed.exact && parsed.boxes.length ? parsed.boxes[0].id : null;
  const dialerLeadId = parsed ? parsed.leadId : null;

  const leg = source === 'ingest_fronter' ? 'fronter' : 'closer';
  const transferId = leg === 'fronter' && body && body.transfer_id ? body.transfer_id : null;

  const method_id = await classifyCall({ source, dispo: dispoRaw, leg });
  const now = new Date().toISOString();

  const row = {
    box_id: boxId,
    dialer_lead_id: dialerLeadId,
    vendor_code: code,
    method_id,
    classified_by: null,
    classified_at: method_id ? now : null,
    leg,
    agent_user: agent,
    agent_user_id: userId,
    company_id: companyId,
    transfer_id: transferId,
    customer_phone: phone || null,
    normalized_phone: norm,
    dispo_raw: dispoRaw,
    call_at: now,
    talk_sec: talkSec,
    recording_state: 'pending',
    source: 'ingest',
  };

  const existingId = await findExistingCall({ companyId, agentUserId: userId, leg, code, norm });
  if (existingId) {
    // A retried/duplicate webhook for the same event — refresh what may have
    // changed (dispo, talk time, transfer match) rather than duplicate it.
    const { dialer_lead_id, vendor_code, agent_user, agent_user_id, company_id, ...updatable } = row;
    await supabaseAdmin.from('qa2_call').update(updatable).eq('id', existingId);
  } else {
    const { error } = await supabaseAdmin.from('qa2_call').insert(row);
    if (error) { logger.warn('QA2_INGEST', `insert failed: ${error.message}`); return; }
  }

  if (!method_id) {
    checkUnclassifiedThreshold(companyId).catch(() => {});
  }
}

function qa2IngestHook(source) {
  return function (req, res, next) {
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      const result = originalJson(body); // real response goes out first, untouched
      // res.statusCode is set by the time .json() runs (res.status(401).json(...)
      // sets it first). A rejected request (bad/missing ingest token -> 401, or a
      // DB error -> 500) never represents a real call worth recording — only
      // record on the same success path the dialer itself treats as handled.
      if (res.statusCode < 400) {
        setImmediate(() => {
          recordCall(source, req, body).catch(e => {
            logger.warn('QA2_INGEST', `hook failed (${source}): ${e.message}`);
          });
        });
      }
      return result;
    };
    next();
  };
}

module.exports = { qa2IngestHook };
