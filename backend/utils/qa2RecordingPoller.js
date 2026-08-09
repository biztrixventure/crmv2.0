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
// ============================================================================

const { supabaseAdmin } = require('../config/database');
const logger = require('../utils/logger');
const { recordingLookup, parseVendorCode, getBoxes, phoneTail, onlyDigits } = require('./dialerBoxes');

const MAX_ATTEMPTS = 10;
const BATCH_SIZE = 25; // capped per tick

async function pollOne(row) {
  if (!row.dialer_lead_id) {
    await supabaseAdmin.from('qa2_call').update({ recording_state: 'missing' }).eq('id', row.id);
    return;
  }

  const parsed = parseVendorCode(row.vendor_code || row.dialer_lead_id);
  const exactBoxes = parsed && parsed.boxes && parsed.boxes.length ? parsed.boxes : [];
  const exactResults = exactBoxes.length
    ? (await Promise.all(exactBoxes.map(b => recordingLookup(b, { lead_id: row.dialer_lead_id })))).flat()
    : [];
  let hit = exactResults.find(r => r && r.recording_id && r.location);

  if (!hit) {
    const tail = phoneTail(row.normalized_phone || row.customer_phone || '');
    if (tail) {
      const wideResults = (await Promise.all(getBoxes().map(b => recordingLookup(b, { lead_id: row.dialer_lead_id })))).flat();
      hit = wideResults.find(r => r && r.recording_id && r.location && onlyDigits(r.location).includes(tail));
    }
  }
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
    await supabaseAdmin.from('qa2_call').update(updates).eq('id', row.id);
    return;
  }

  const state = attempts >= MAX_ATTEMPTS ? 'missing' : 'pending';
  await supabaseAdmin.from('qa2_call').update({ recording_attempts: attempts, recording_state: state }).eq('id', row.id);
}

async function pollPendingRecordings() {
  const { data: rows, error } = await supabaseAdmin
    .from('qa2_call')
    .select('id, vendor_code, dialer_lead_id, recording_attempts, normalized_phone, customer_phone')
    .eq('recording_state', 'pending')
    .lt('recording_attempts', MAX_ATTEMPTS)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE);
  if (error) { logger.warn('QA2_REC_POLL', error.message); return; }
  if (!rows || !rows.length) return;

  for (const row of rows) {
    try {
      await pollOne(row);
    } catch (e) {
      logger.warn('QA2_REC_POLL', `row ${row.id}: ${e.message}`);
    }
  }
}

module.exports = { pollPendingRecordings };
