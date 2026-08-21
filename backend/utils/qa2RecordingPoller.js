// ============================================================================
// qa2RecordingPoller.js — QA v2's recording attachment poller (build brief
// 7.2). Recordings appear on the dialer ~60-90s after hangup. Every 60s
// (registered in scheduler.js), take qa2_call rows still recording_state =
// 'pending' with recording_attempts < 10, oldest first, capped per tick, and
// try to find the clip via recordingLookup() — the exact same cached lookup
// every other recording-search path in this codebase already shares (never
// reimplemented). This replaces v1's hourly materialisation lag and is what
// makes same-day scoring possible.
//
// TWO-TIER SEARCH, same shape as findSaleRecording's own fallback:
//   1. The vendor code's prefix names an exact box (or boxes, when a prefix
//      is shared across boxes) — search only those, no phone check needed,
//      since a lead_id is unique WITHIN that cluster.
//   2. Nothing found there (or the prefix didn't resolve to a box at all) —
//      widen to EVERY box, but only trust a hit whose recording path
//      contains this call's own phone number. Searching everywhere without
//      that check risked returning a different customer's call: a lead_id
//      is only unique PER CLUSTER (parseVendorCode's own rule), not across
//      the whole dialer estate.
//
// A row with no dialer_lead_id (phone-only match, no usable code from the
// dialer) can never succeed via a lead_id-based lookup — marked 'missing'
// immediately rather than burning 10 attempt-cycles searching for nothing.
//
// PICKING THE RIGHT CLIP WHEN A LEAD HAS SEVERAL. WaveTech's fronters and
// closers share one dialer box, so both legs of a transfer hang off the SAME
// lead_id and the lookup returns both clips. Taking the first one gave both legs
// the same recording, which uq_qa2_call_recording (box_id, recording_id) then
// refused — and because that failed UPDATE was never checked, the second leg sat
// 'pending' forever, retrying the same doomed write. 621 pairs were stuck like
// that. So: drop clips another row already owns, then rank what is left by the
// AGENT the clip belongs to (the dialer returns the agent login with every
// recording, and a qa2_call knows its own agent), then by closeness to the
// call's own timestamp. The fronter's clip goes to the fronter row and the
// closer's to the closer row, on the same lead, deterministically.
// ============================================================================

const { supabaseAdmin } = require('../config/database');
const logger = require('../utils/logger');
const { recordingLookup, parseVendorCode, getBoxes, phoneTail, onlyDigits } = require('./dialerBoxes');

const MAX_ATTEMPTS = 10;
const BATCH_SIZE = 60; // capped per tick

// Rank the clips this lead returned and hand back the one that belongs to THIS
// leg: never a clip another row already owns, then the agent's own clip, then
// the one closest in time to the call.
async function chooseClip(candidates, row) {
  if (!candidates.length) return null;

  const byBox = new Map();
  candidates.forEach(c => {
    if (!byBox.has(c.box)) byBox.set(c.box, new Set());
    byBox.get(c.box).add(String(c.recording_id));
  });
  const taken = new Set();
  for (const [box, ids] of byBox) {
    const { data } = await supabaseAdmin.from('qa2_call')
      .select('recording_id').eq('box_id', box).in('recording_id', [...ids]).neq('id', row.id);
    (data || []).forEach(r => taken.add(`${box}|${r.recording_id}`));
  }
  const free = candidates.filter(c => !taken.has(`${c.box}|${c.recording_id}`));
  if (!free.length) return null;

  const want = String(row.agent_user || '').trim().toUpperCase();
  const mine = want ? free.filter(c => String(c.user || '').trim().toUpperCase() === want) : [];
  const pool = mine.length ? mine : free;

  const at = row.call_at ? new Date(row.call_at).getTime() : null;
  if (!at) return pool[0];
  return pool
    .map(c => ({ c, d: Math.abs(new Date(String(c.start).replace(' ', 'T')).getTime() - at) }))
    .filter(x => Number.isFinite(x.d))
    .sort((a, b) => a.d - b.d)[0]?.c || pool[0];
}

// A call with no dialer lead id can still be found: ask the dialer for that
// AGENT's recordings on that DAY and keep the clip whose file path carries this
// customer's number. Needed since transfers materialised from the CRM (mig 265)
// often have no vendor code at all — 40 of yesterday's TRA calls were marked
// missing on the spot for exactly this reason. Costlier than a lead_id lookup
// (one call per box per agent-day, though the lookup cache absorbs repeats), so
// it gets a shorter leash than the main path.
const MAX_ATTEMPTS_NO_LEAD = 3;

async function loginsFor(row) {
  if (row.agent_user) return [String(row.agent_user)];
  if (!row.agent_user_id) return [];
  const { data } = await supabaseAdmin.from('user_profiles')
    .select('vicidial_agent_ids').eq('user_id', row.agent_user_id).maybeSingle();
  return (data?.vicidial_agent_ids || []).map(String).filter(Boolean);
}

async function pollByAgentDay(row) {
  const tail = phoneTail(row.normalized_phone || row.customer_phone || '');
  if (!tail || !row.call_at) return null;
  const logins = await loginsFor(row);
  if (!logins.length) return null;
  const date = new Date(row.call_at).toISOString().slice(0, 10);

  const results = await Promise.all(
    getBoxes().flatMap(b => logins.map(a => recordingLookup(b, { agent_user: a, date }))),
  );
  const candidates = results.flat()
    .filter(r => r && r.recording_id && r.location && onlyDigits(r.location).includes(tail));
  return chooseClip(candidates, row);
}

async function pollOne(row) {
  if (!row.dialer_lead_id) {
    const attempts = (row.recording_attempts || 0) + 1;
    const hit = await pollByAgentDay(row);
    if (hit) {
      const updates = {
        box_id: hit.box, recording_id: String(hit.recording_id), recording_location: hit.location,
        recording_state: 'found', recording_attempts: attempts,
      };
      if (Number.isFinite(hit.duration)) updates.talk_sec = hit.duration;
      const { error } = await supabaseAdmin.from('qa2_call').update(updates).eq('id', row.id);
      if (!error) return;
    }
    await supabaseAdmin.from('qa2_call').update({
      recording_attempts: attempts,
      recording_state: attempts >= MAX_ATTEMPTS_NO_LEAD ? 'missing' : 'pending',
    }).eq('id', row.id);
    return;
  }

  const parsed = parseVendorCode(row.vendor_code || row.dialer_lead_id);
  const exactBoxes = parsed && parsed.boxes && parsed.boxes.length ? parsed.boxes : [];
  const exactResults = exactBoxes.length
    ? (await Promise.all(exactBoxes.map(b => recordingLookup(b, { lead_id: row.dialer_lead_id })))).flat()
    : [];
  let candidates = exactResults.filter(r => r && r.recording_id && r.location);

  if (!candidates.length) {
    const tail = phoneTail(row.normalized_phone || row.customer_phone || '');
    if (tail) {
      const wideResults = (await Promise.all(getBoxes().map(b => recordingLookup(b, { lead_id: row.dialer_lead_id })))).flat();
      candidates = wideResults.filter(r => r && r.recording_id && r.location && onlyDigits(r.location).includes(tail));
    }
  }

  const hit = await chooseClip(candidates, row);
  const attempts = (row.recording_attempts || 0) + 1;

  if (hit) {
    const updates = {
      box_id: hit.box,
      recording_id: String(hit.recording_id),
      recording_location: hit.location,
      recording_state: 'found',
      recording_attempts: attempts,
    };
    if (Number.isFinite(hit.duration)) updates.talk_sec = hit.duration;
    const { error: upErr } = await supabaseAdmin.from('qa2_call').update(updates).eq('id', row.id);
    if (!upErr) return;
    // Lost a race for this clip (the unique index did its job). Count the
    // attempt and stay pending so the next tick picks a different one — the old
    // code ignored this error and retried the same doomed write forever.
    logger.warn('QA2_REC_POLL', `row ${row.id}: clip ${hit.recording_id} taken (${upErr.message})`);
    await supabaseAdmin.from('qa2_call')
      .update({ recording_attempts: attempts, recording_state: attempts >= MAX_ATTEMPTS ? 'missing' : 'pending' })
      .eq('id', row.id);
    return;
  }

  const state = attempts >= MAX_ATTEMPTS ? 'missing' : 'pending';
  await supabaseAdmin.from('qa2_call').update({ recording_attempts: attempts, recording_state: state }).eq('id', row.id);
}

const COLS = 'id, vendor_code, dialer_lead_id, recording_attempts, normalized_phone, customer_phone, agent_user, agent_user_id, call_at, leg';

// QA-RELEVANT ROWS GO FIRST, NEWEST FIRST. Every dialed call becomes a qa2_call
// row, so 'pending' is a quarter of a million deep — at a batch a minute the
// queue can never be drained, and the original oldest-first order buried the
// calls QA actually reviews behind months of untouched dial attempts. A leg that
// belongs to a transfer (linked to its other leg, or carrying a transfer/sale)
// is what a reviewer opens today, so it is served first; the long tail is only
// worked with whatever capacity is left over in the same tick.
async function pollPendingRecordings() {
  const base = () => supabaseAdmin.from('qa2_call').select(COLS)
    .eq('recording_state', 'pending').lt('recording_attempts', MAX_ATTEMPTS);

  const { data: hot, error } = await base()
    .or('linked_call_id.not.is.null,transfer_id.not.is.null,sale_id.not.is.null')
    .order('call_at', { ascending: false })
    .limit(BATCH_SIZE);
  if (error) { logger.warn('QA2_REC_POLL', error.message); return; }

  let rows = hot || [];
  if (rows.length < BATCH_SIZE) {
    const { data: rest } = await base()
      .is('linked_call_id', null).is('transfer_id', null).is('sale_id', null)
      .order('call_at', { ascending: false })
      .limit(BATCH_SIZE - rows.length);
    rows = rows.concat(rest || []);
  }
  if (!rows.length) return;

  for (const row of rows) {
    try {
      await pollOne(row);
    } catch (e) {
      logger.warn('QA2_REC_POLL', `row ${row.id}: ${e.message}`);
    }
  }
}

module.exports = { pollPendingRecordings };
