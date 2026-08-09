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
// Fans out across EVERY box for the vendor code's prefix — two production
// boxes share the WTI prefix (see dialerBoxes.js), so trusting "one box per
// prefix" would silently miss half the recordings on that prefix.
//
// A row with no dialer_lead_id (phone-only match, no usable code from the
// dialer) can never succeed via a lead_id-based lookup — marked 'missing'
// immediately rather than burning 10 attempt-cycles searching for nothing.
// ============================================================================

const { supabaseAdmin } = require('../config/database');
const logger = require('../utils/logger');
const { recordingLookup, parseVendorCode, getBoxes } = require('./dialerBoxes');

const MAX_ATTEMPTS = 10;
const BATCH_SIZE = 25; // capped per tick

async function pollOne(row) {
  if (!row.dialer_lead_id) {
    await supabaseAdmin.from('qa2_call').update({ recording_state: 'missing' }).eq('id', row.id);
    return;
  }

  const parsed = parseVendorCode(row.vendor_code || row.dialer_lead_id);
  const boxes = parsed && parsed.boxes && parsed.boxes.length ? parsed.boxes : getBoxes();
  const results = (await Promise.all(boxes.map(b => recordingLookup(b, { lead_id: row.dialer_lead_id })))).flat();
  const hit = results.find(r => r && r.recording_id && r.location);
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
    .select('id, vendor_code, dialer_lead_id, recording_attempts')
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
