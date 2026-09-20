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
const { parseVendorCode, normalizeLeadCode, hangupLabel, annotateHangups } = require('../utils/dialerBoxes');
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

// The columns migration 320 adds. Kept in one place so the deploy-order retry
// below and the duplicate-update path strip exactly the same set.
const DIALER_COLS = ['dialer_provider', 'dialer_account_id', 'dialer_call_id'];
const MISSING_COLUMN = /column|schema cache/i;
const withoutDialerCols = (obj) => {
  const copy = { ...obj };
  DIALER_COLS.forEach(k => delete copy[k]);
  return copy;
};

async function findExistingCall({ companyId, agentUserId, leg, code, norm }) {
  // A lead code names a LEAD, not a call: the dialer recycles it, and the same
  // fronter dials the same customer again hours or days later. Matching on the
  // code with no time bound folded every later call into the FIRST row for that
  // lead, so a genuine redial never got its own QA row (and, before the
  // downgrade guard below, overwrote the original). Same window as the phone
  // branch: inside it, it is a retried webhook; outside it, it is a new call.
  if (code) {
    const since = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();
    const { data } = await supabaseAdmin
      .from('qa2_call').select('id').eq('company_id', companyId).eq('leg', leg).eq('vendor_code', code)
      .gte('created_at', since).order('created_at', { ascending: false }).limit(1).maybeSingle();
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

  // A call bridged in from a NON-VICIdial dialer (migration 320) carries its
  // account here. Set in-process by utils/dialers/bridge.js — it can never
  // arrive over HTTP, so a dialer cannot claim to be another provider. When
  // absent this is a VICIdial ingest and everything below behaves as before.
  const ev = req.__dialerEvent || null;

  const { userId, companyId } = await resolveAgent(agent, ev ? { accountId: ev.account_id } : undefined);
  if (!userId || !companyId) return; // unmapped agent — the real routes skip these too

  const phone = String(p.phone || '').trim();
  const norm = normPhone(phone) || null;
  const dispoRaw = String(p.dispo || '').trim() || null;
  const talkParsed = parseInt(p.talk_time, 10);
  const talkSec = Number.isFinite(talkParsed) ? talkParsed : null;

  // WHO HUNG UP — captured NOW, not later. The box archives its call log every
  // night, so phone_number_log answers for a call that ended minutes ago and
  // "NO RECORDS" for the same call the next morning; 10,253 rows had been
  // stamped unavailable by a poller asking a day late. Two sources, in order:
  //   1. the dispo webhook itself — the closer campaign's Dispo Call URL already
  //      sends &term=--A--term_reason--B-- (AGENT / CALLER / QUEUETIMEOUT…),
  //      which IS the answer with no lookup at all;
  //   2. otherwise one immediate phone-log lookup while the call is seconds old.
  const term = String(p.term || p.term_reason || '').trim().toUpperCase() || null;
  let hangup = term ? { label: hangupLabel(term), reason: term, status: dispoRaw || null } : null;
  if (!hangup && (phone || norm)) {
    try {
      const [ann] = await annotateHangups([{ start_time: new Date().toISOString(), agent_user: agent }], phone || norm);
      if (ann && ann.hangup_label) hangup = { label: ann.hangup_label, reason: ann.hangup_reason || null, status: ann.call_status || null };
    } catch { /* best-effort — the poller's sibling-copy pass is the fallback */ }
  }

  // Recover the box prefix on a bare numeric lead_id before anything derives
  // from it. Without this the box could never be resolved for those calls:
  // parseVendorCode(...).exact is false for a bare code, so box_id stayed null
  // and the recording poller had to widen to every box and match on the phone
  // instead of looking the clip up directly on the lead's own cluster.
  const code = normalizeLeadCode(String(p.code || p.alt_code || '').trim(), agent) || null;
  const parsed = code ? parseVendorCode(code) : null;
  // Only stamp box_id when the code names exactly ONE box. A bare lead_id, or
  // a prefix two boxes share (wavetechpk + wti_flexo both send WTI, and each
  // numbers its leads from 1), names a different customer on each box, so it
  // stays null until the recording poller finds the clip (mig 239). Taking
  // boxes[0] here labelled every old-dialer call as the new dialer the minute
  // the two prefixes matched (2026-09-15).
  const boxId = parsed && parsed.exact && parsed.boxes.length === 1 ? parsed.boxes[0].id : null;
  const dialerLeadId = parsed ? parsed.leadId : null;

  const leg = source === 'ingest_fronter' ? 'fronter' : 'closer';
  let transferId = leg === 'fronter' && body && body.transfer_id ? body.transfer_id : null;

  // A CLOSER'S OWN DIAL BELONGS TO THE TRANSFER IT CAME FROM. Closers call
  // customers back themselves (manual dial, callback) — no fronter XFER fires,
  // so this row had no transfer and was filed under the closer's grouping
  // company, invisible to the QA team that reviews the fronter company. The
  // customer's number names the transfer: adopt the latest one (30 days, any
  // fronter company) so the call lands beside the original as another closer
  // leg — Unclosed or Closed by its dispo — for QA to listen to.
  let ownerCompanyId = companyId;
  if (leg === 'closer' && !transferId && norm) {
    const { data: tr } = await supabaseAdmin.from('transfers')
      .select('id, company_id').eq('normalized_phone', norm).eq('dialer_ghost', false)
      .gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString())
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (tr) { transferId = tr.id; ownerCompanyId = tr.company_id; }
  }

  const method_id = await classifyCall({ source, dispo: dispoRaw, leg, hasTransfer: !!transferId });
  const now = new Date().toISOString();

  // A provider call has no VICIdial box, so it gets its account's namespace
  // ("calltools:1a2b3c4d") instead. That keeps uq_qa2_call_recording
  // (box_id, recording_id) meaningful for provider clips too — one recording
  // can still only be owned by one call row — while never colliding with a
  // real box id.
  const providerBox = ev && ev.box_id ? ev.box_id : null;

  const row = {
    box_id: boxId || providerBox,
    dialer_lead_id: dialerLeadId,
    vendor_code: code,
    method_id,
    classified_by: null,
    classified_at: method_id ? now : null,
    leg,
    agent_user: agent,
    agent_user_id: userId,
    company_id: ownerCompanyId,
    transfer_id: transferId,
    customer_phone: phone || null,
    normalized_phone: norm,
    dispo_raw: dispoRaw,
    // A provider tells us when the call actually happened; VICIdial's webhook
    // fires at hangup, so "now" is the honest answer there.
    call_at: (ev && ev.call_at) || now,
    talk_sec: talkSec,
    hangup_label: hangup?.label || null,
    hangup_reason: hangup?.reason || null,
    hangup_status: hangup?.status || null,
    recording_state: 'pending',
    source: 'ingest',
    dialer_provider: ev ? ev.provider : 'vicidial',
    dialer_account_id: ev ? ev.account_id : null,
    dialer_call_id: ev ? ev.external_call_id : null,
  };

  // THE RECORDING CAN ARRIVE WITH THE WEBHOOK. A VICIdial clip has to be
  // hunted for afterwards (the poller: it appears on the box 60-90s after
  // hangup), but a provider that puts the audio link in the payload has
  // already answered the question — take it now, so the call is reviewable the
  // moment it lands instead of waiting a poll cycle. No URL means the row stays
  // 'pending' and the poller asks the provider's API for it later.
  if (ev && ev.recording_url) {
    row.recording_id = String(ev.recording_id || ev.external_call_id || '').trim() || null;
    row.recording_location = ev.recording_url;
    row.recording_state = row.recording_id ? 'found' : 'pending';
    row.recorded_at = row.call_at;
  }

  const existingId = await findExistingCall({ companyId: ownerCompanyId, agentUserId: userId, leg, code, norm });
  if (existingId) {
    // A retried/duplicate webhook for the same event — refresh what may have
    // changed (dispo, talk time, transfer match) rather than duplicate it.
    const { dialer_lead_id, vendor_code, agent_user, agent_user_id, company_id, ...updatable } = row;
    // NEVER DOWNGRADE A CLASSIFIED CALL. The "duplicate" here is often not a
    // retry at all but the fronter's LATER dispo on the same lead (they redial
    // and mark it A / N / CALLBK). Refreshing the row with that payload wiped
    // dispo_raw (XFER → A), method_id (TRA → null) and transfer_id (→ null) on
    // calls a QA agent had already been assigned — 61 rows showed up in the
    // Unclassified tab out of nowhere. A classification, a transfer link and
    // the XFER dispo are facts about the ORIGINAL event; a later dispo on the
    // lead does not unmake them. Only fields that can legitimately arrive later
    // are refreshed.
    const { data: existing } = await supabaseAdmin.from('qa2_call')
      .select('method_id, transfer_id, dispo_raw').eq('id', existingId).maybeSingle();
    if (existing?.method_id) {
      delete updatable.method_id; delete updatable.classified_at; delete updatable.classified_by;
      delete updatable.dispo_raw; delete updatable.call_at;
    } else if (!updatable.method_id) {
      delete updatable.method_id; delete updatable.classified_at;
    }
    if (existing?.transfer_id || !updatable.transfer_id) delete updatable.transfer_id;
    if (!updatable.hangup_label) { delete updatable.hangup_label; delete updatable.hangup_reason; delete updatable.hangup_status; }
    if (updatable.talk_sec == null) delete updatable.talk_sec;
    delete updatable.recording_state;   // the poller owns this once the row exists
    // Same rule for the clip itself: whoever attached audio first keeps it, and
    // uq_qa2_call_recording would reject a second row claiming it anyway.
    delete updatable.recording_id; delete updatable.recording_location; delete updatable.recorded_at;
    if (Object.keys(updatable).length) {
      const { error: upErr } = await supabaseAdmin.from('qa2_call').update(updatable).eq('id', existingId);
      if (upErr && MISSING_COLUMN.test(upErr.message || '')) {
        await supabaseAdmin.from('qa2_call').update(withoutDialerCols(updatable)).eq('id', existingId);
      }
    }
  } else {
    let { error } = await supabaseAdmin.from('qa2_call').insert(row);
    // DEPLOY-ORDER SAFETY, same pattern as transfers.xfer_seq in vicidial.js:
    // the dialer columns arrive with migration 320. If the backend ships first,
    // an unknown-column error here would silently drop EVERY QA row — far worse
    // than losing the provider label on them. Retry once without those columns.
    if (error && MISSING_COLUMN.test(error.message || '')) {
      logger.warn('QA2_INGEST', 'qa2_call.dialer_* missing — migration 320 not applied yet; inserting without them');
      ({ error } = await supabaseAdmin.from('qa2_call').insert(withoutDialerCols(row)));
    }
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
