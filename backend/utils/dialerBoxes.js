/**
 * Read-only registry of the VICIdial boxes for on-demand lookups (e.g. the
 * "Fetch Dispo" button). Creds come from env; fall back to the known boxes.
 * Never used for writes — only call_log / status reads.
 */
// Hardcoded fallback — the seed values + what's used until the DB table loads
// (or if migration 120 isn't applied). The live values are refreshed from the
// vicidial_boxes table every 60s, so a superadmin can change a dialer's URL /
// creds / prefix from Settings with no code change.
const FALLBACK_BOXES = [
  { id: 'wavetech', base: process.env.WAVETECH_DIALER_URL || 'https://wavetechnew.i5.tel', user: process.env.WAVETECH_DIALER_USER || 'apiuser', pass: process.env.WAVETECH_DIALER_PASS || 'apiuser123', prefix: 'WTI' },
  { id: 'etc',      base: process.env.ETC_DIALER_URL      || 'https://wavetech3new.i5.tel', user: process.env.ETC_DIALER_USER      || 'ceo',     pass: process.env.ETC_DIALER_PASS      || 'ceo',        prefix: 'ETC' },
  { id: 'tmc',      base: process.env.TMC_DIALER_URL      || 'https://tmcsolihp.i5.tel',    user: process.env.TMC_DIALER_USER      || '1002',    pass: process.env.TMC_DIALER_PASS      || '1002',       prefix: 'TMC' },
];
// Mutable live copies (the functions below read these synchronously).
let BOXES = FALLBACK_BOXES.map(b => ({ ...b }));
let BOX_BY_PREFIX = Object.fromEntries(FALLBACK_BOXES.map(b => [b.prefix, b.id]));

// Statuses that are NOT a closer outcome — no customer contact (A/N/DAIR…),
// in-progress/system states, and the transfer event itself (XFER and friends).
// "Fetch dispo" wants the closer's actual disposition, so these are skipped; if
// only these exist, it reports "no disposition yet" rather than guessing XFER.
const NO_CONNECT = new Set([
  'A', 'N', 'NA', 'DAIR', 'DROP', 'AFTHRS', 'B', 'DC', 'AB', 'ADC', 'PDROP', 'AA',
  'NANQUE', 'TIMEOT', 'CXHNGP', 'INCALL', 'QUEUE', 'CH', 'DISPO', 'NEW',
  'XFER', 'TRANSFER', 'XDROP', 'IVRXFR', 'RQXFER',
]);

// In-progress / non-final system states that are NEVER a real disposition. Unlike
// NO_CONNECT, this does NOT exclude call-outcome codes (A/N/DAIR/B/DC…) — for a
// transferred lead those ARE the closer's recorded outcome, so the lead's STATUS
// field should surface them (the call-log path keeps the stricter NO_CONNECT).
const SYSTEM_SKIP = new Set([
  '', '-', 'INCALL', 'QUEUE', 'CH', 'DISPO', 'NEW', 'XFER', 'TRANSFER', 'XDROP', 'IVRXFR', 'RQXFER',
]);

const axios = require('axios');
const logger = require('./logger');

// phone_number_log on one box for a phone → parsed call rows (any order). Uses
// axios (always present) — bare global fetch isn't guaranteed on every Node.
// The phone-number variants a call may be logged under in vicidial_log: the bare
// last-10 AND the 11-digit 1+10. Manual dials and several campaigns store the
// full DIALED string (with a leading 1), so a bare-10 query silently misses them
// — the cause of "no records" and of manual calls not showing. phone_number_log
// accepts a comma list, so one call matches either form.
function phoneVariants(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  const t10 = d.length >= 10 ? d.slice(-10) : d;
  if (!t10) return [];
  return [...new Set([t10, '1' + t10])];
}

// phone_number_log on one box → { rows, error }. Unlike the old helper this does
// NOT swallow API failures: a permission / auth error (the classic "everything
// shows no records" cause — phone_number_log needs the api user at level 7 with
// 'view reports') is returned so the UI can say WHY the log is empty. A genuine
// "NO RECORDS FOUND" is a normal empty result, not an error.
async function phoneCallLogDetailed(box, phone) {
  const variants = phoneVariants(phone);
  if (!variants.length) return { rows: [], error: null };
  const params = {
    source: 'crm', user: box.user, pass: box.pass, function: 'phone_number_log',
    phone_number: variants.join(','), type: 'ALL', detail: 'ALL', stage: 'pipe',
  };
  try {
    const r = await axios.get(`${box.base}/vicidial/non_agent_api.php`, { params, timeout: 15000, responseType: 'text' });
    const text = (typeof r.data === 'string' ? r.data : String(r.data || '')).trim();
    if (!text) return { rows: [], error: null };
    if (/NO RECORDS FOUND/i.test(text)) return { rows: [], error: null };
    if (/^ERROR|^NOTICE/m.test(text)) {
      const msg = (text.split(/\r?\n/)[0] || '').replace(/^ERROR:\s*/i, '').trim();
      return { rows: [], error: { box: box.id, message: msg, permission: /PERMISSION/i.test(text) } };
    }
    const rows = text.split(/\r?\n/).filter(Boolean).map(l => {
      const [phone_number, call_date, list_id, length_in_sec, lead_status, hangup_reason, call_status, source_id, user] = l.split('|');
      return { box: box.id, phone_number, call_date, list_id, length: parseInt(length_in_sec, 10) || 0, lead_status, hangup_reason, call_status, user };
    }).filter(r => r.call_date);
    return { rows, error: null };
  } catch (e) {
    return { rows: [], error: { box: box.id, message: e.message, permission: false } };
  }
}

// Back-compat: rows only (fetch-dispo / latestDisposition path).
async function phoneCallLog(box, phone) {
  return (await phoneCallLogDetailed(box, phone)).rows;
}

// Refresh the live BOXES + BOX_BY_PREFIX from the vicidial_boxes table so a
// superadmin can change a dialer's URL / creds / prefix from Settings. Keeps the
// current (hardcoded/seed) values if the table is missing or empty.
async function refreshBoxes() {
  try {
    const { supabaseAdmin } = require('../config/database');
    const { data, error } = await supabaseAdmin
      .from('vicidial_boxes').select('name, prefix, base_url, api_user, api_pass, validation_url')
      .eq('is_active', true).order('sort_order', { ascending: true });
    if (error || !data || !data.length) return;
    BOXES = data.map(b => ({ id: b.name, base: String(b.base_url || '').replace(/\/+$/, ''), user: b.api_user, pass: b.api_pass, prefix: (b.prefix || '').toUpperCase(), validationUrl: String(b.validation_url || '').trim() }));
    BOX_BY_PREFIX = Object.fromEntries(BOXES.map(b => [b.prefix, b.id]));
  } catch { /* keep current values */ }
}
// Load once on boot, then keep fresh (60s) — cheap single-row read.
refreshBoxes();
setInterval(refreshBoxes, 60 * 1000).unref?.();

// The current vendor-code prefixes (for building dispo-match candidates).
const boxPrefixes = () => Object.keys(BOX_BY_PREFIX);

// The lead's CURRENT status persists in vicidial_list (NOT archived like the call
// log), so for a coded transfer we can read the disposition directly by lead_id —
// works for OLD transfers the call-log lookup can no longer see. Returns the raw
// status code, or null. (Cross-cluster note: this is the status on the lead's own
// box; for same-box closers it IS the closer's disposition.)
async function leadStatusByCode(code) {
  const m = String(code || '').match(/^([A-Za-z]*)(\d+)$/);
  if (!m) return null;
  const box = BOXES.find(b => b.id === BOX_BY_PREFIX[(m[1] || '').toUpperCase()]);
  const leadId = m[2];
  if (!box || !leadId) return null;
  try {
    const r = await axios.get(`${box.base}/vicidial/non_agent_api.php`, {
      params: { source: 'crm', user: box.user, pass: box.pass, function: 'lead_field_info', field_name: 'status', lead_id: leadId },
      timeout: 15000, responseType: 'text',
    });
    const text = (typeof r.data === 'string' ? r.data : String(r.data || '')).trim();
    if (!text || /^ERROR|^NOTICE/m.test(text)) return null;
    const status = text.split(/\r?\n/)[0].trim();
    // Surface the lead's real disposition INCLUDING call-outcome codes (A/N/DAIR…)
    // — only true in-progress/system states are skipped. This is the closer's
    // recorded outcome on a transferred lead; "no record without a dispo".
    return (status && !SYSTEM_SKIP.has(status.toUpperCase())) ? status : null;
  } catch { return null; }
}

// The lead's last agent (vicidial_list.user) by code — used to attribute a
// fetched-by-lead-code disposition to a closer so their name shows. Persists in
// vicidial_list like the status does, so it works for old leads too.
async function leadAgentByCode(code) {
  const m = String(code || '').match(/^([A-Za-z]*)(\d+)$/);
  if (!m) return null;
  const box = BOXES.find(b => b.id === BOX_BY_PREFIX[(m[1] || '').toUpperCase()]);
  const leadId = m[2];
  if (!box || !leadId) return null;
  try {
    const r = await axios.get(`${box.base}/vicidial/non_agent_api.php`, {
      params: { source: 'crm', user: box.user, pass: box.pass, function: 'lead_field_info', field_name: 'user', lead_id: leadId },
      timeout: 15000, responseType: 'text',
    });
    const text = (typeof r.data === 'string' ? r.data : String(r.data || '')).trim();
    if (!text || /^ERROR|^NOTICE/m.test(text)) return null;
    const user = text.split(/\r?\n/)[0].trim();
    // VICIdial's system/non-agent owners aren't real closers
    return (user && !/^(VDAD|VDCL|admin|-+)$/i.test(user)) ? user : null;
  } catch { return null; }
}

// Pull every call for a phone across all boxes, newest first.
async function lookupCallsByPhone(phone) {
  const all = (await Promise.all(BOXES.map(b => phoneCallLog(b, phone)))).flat();
  return all.sort((a, b) => (a.call_date < b.call_date ? 1 : -1));
}

// Diagnostic variant: the same calls PLUS per-box errors (permission / auth /
// unreachable). Lets the "number activity" view distinguish "no calls" from
// "couldn't query the dialer" and tell the superadmin exactly why.
async function lookupCallsByPhoneDiag(phone) {
  const results = await Promise.all(BOXES.map(b => phoneCallLogDetailed(b, phone)));
  const calls = results.flatMap(r => r.rows).sort((a, b) => (a.call_date < b.call_date ? 1 : -1));
  const errors = results.map(r => r.error).filter(Boolean);
  return { calls, errors };
}

// Best guess at the closer's disposition for a phone: the most recent call whose
// status is a real outcome (not a no-connect). Returns { code, user, box, at }.
//
// onDate ('YYYY-MM-DD', the transfer's dialer day) bounds the search to ±1 day so
// a REPEAT customer's later call never gets applied to an older transfer. When a
// day is given and nothing real falls in the window, returns null (no dispo yet)
// rather than reaching back to a different day's call. The returned `user` is the
// agent on that call — for a transferred lead that's the CLOSER (their dispo is
// the latest real outcome on the day, after the fronter's XFER).
async function latestDisposition(phone, { onDate } = {}) {
  const calls = await lookupCallsByPhone(phone);
  let pool = calls;
  if (onDate) {
    const center = new Date(onDate + 'T00:00:00').getTime();
    pool = calls.filter(c => {
      const day = String(c.call_date || '').slice(0, 10);
      if (!day) return false;
      return Math.abs(new Date(day + 'T00:00:00').getTime() - center) <= 86400000; // ±1 day (TZ slack)
    });
  }
  const real = pool.find(c => {
    const s = (c.call_status || c.lead_status || '').toUpperCase();
    return s && !NO_CONNECT.has(s);
  });
  if (!real) return null;
  return { code: (real.call_status || real.lead_status), user: real.user, box: real.box, at: real.call_date };
}

// ── Recording lookup (for the client portal) ───────────────────────────────
// recording_lookup returns: start_time|user|recording_id|lead_id|duration|location
// where `location` is the actual .mp3/.wav URL on the recording server.
// Short TTL cache so building a sales list (same closer-agent+date repeated, or
// the list endpoint immediately followed by a play) doesn't hammer the dialer.
const _recCache = new Map();   // key → { at, rows }
const REC_TTL = 5 * 60 * 1000;
async function recordingLookup(box, params) {
  const key = box.id + '|' + JSON.stringify(params);
  const hit = _recCache.get(key);
  if (hit && Date.now() - hit.at < REC_TTL) return hit.rows;
  const rows = await _recordingLookupRaw(box, params);
  _recCache.set(key, { at: Date.now(), rows });
  return rows;
}
async function _recordingLookupRaw(box, params) {
  try {
    const r = await axios.get(`${box.base}/vicidial/non_agent_api.php`, {
      params: { source: 'crm', user: box.user, pass: box.pass, function: 'recording_lookup', stage: 'pipe', duration: 'Y', ...params },
      timeout: 20000, responseType: 'text',
    });
    const text = (typeof r.data === 'string' ? r.data : String(r.data || '')).trim();
    if (!text || /NO RECORDINGS|ERROR|NOTICE|PERMISSION/i.test(text)) return [];
    return text.split(/\r?\n/).filter(Boolean).map(l => {
      const p = l.split('|');     // start|user|recording_id|lead_id|duration|location
      return { box: box.id, start: p[0], user: p[1], recording_id: p[2], lead_id: p[3], duration: parseInt(p[4], 10) || 0, location: p[5] };
    }).filter(x => x.location && /^https?:\/\//.test(x.location));
  } catch { return []; }
}

const onlyDigits = s => String(s || '').replace(/\D/g, '');
const phoneTail  = p => { const d = onlyDigits(p); return d.length >= 10 ? d.slice(-10) : d; };

// Find the ACTUAL sale-call recording for a sale. Precise path = by lead_id on
// the lead's own box; fallback = the closer's agent recordings for the sale date.
// BOTH paths are scoped to the CLOSER's own agent id(s): one lead_id carries
// recordings from the fronter's original call AND the closer's post-transfer
// call, and both are to the same customer phone — so the ONLY thing that
// separates the closer's leg from the fronter's is the recording's `user` (agent)
// field. Without the closer's agent id we can't tell them apart and must not
// guess. Among the closer's own legs we pick the LONGEST call — the substantive
// sale conversation, not a quick redial. Returns { location, recording_id,
// duration, start, box } or null (no match → the portal hides the sale, never
// plays a wrong recording).
async function findSaleRecording({ code, phone, agentIds = [], date, dialerAt, closerId } = {}) {
  const tail = phoneTail(phone);
  const matchesPhone = rec => tail && onlyDigits(rec.location).includes(tail);

  // The closer's dialer agent id(s) are what distinguish the closer's leg from
  // the fronter's on the same lead_id. Missing → do NOT fall back to a phone/
  // longest guess (that's exactly what served the fronter's call); skip + flag so
  // the closer's profile gets mapped instead of silently degrading.
  const agentSet = new Set(agentIds.filter(Boolean).map(a => String(a).toUpperCase()));
  if (!agentSet.size) {
    logger.warn('PORTAL_REC', `recording lookup skipped: closer ${closerId || 'unknown'} has no vicidial_agent_ids mapped`);
    return null;
  }
  const byCloser = rec => rec.user && agentSet.has(String(rec.user).toUpperCase());

  // Candidate DIALER days for the agent+date fallback. sale_date is NOT reliable
  // here — it can drift days from the real call (late data entry / manual date),
  // so anchoring the fallback on it misses the recording. We anchor instead on
  // the ACTUAL dialer day: the recording start_times on the lead (any leg) and
  // the transfer's created_at (with EDT/UTC-4 + ±1 day TZ slack), keeping
  // sale_date only as a last resort. Safe to widen: the agent+date branch is
  // scoped to the closer's agent AND requires a phone match, so extra days can
  // only ever match this closer's own calls to this exact customer.
  const days = new Set();
  const addDay = v => { const d = String(v || '').slice(0, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(d)) days.add(d); };
  if (dialerAt) {
    const base = new Date(dialerAt).getTime();
    if (Number.isFinite(base)) for (const off of [-4, -4 - 24, -4 + 24]) addDay(new Date(base + off * 3600000).toISOString());
  }
  addDay(date);

  // 1. Precise path: recordings for the lead_id on the lead's own box, then keep
  //    ONLY the closer's own legs (drops the fronter's original call).
  let pool = [];
  let fromLeadId = false;
  const m = String(code || '').match(/^([A-Za-z]+)(\d+)$/);
  if (m) {
    const box = BOXES.find(b => b.id === BOX_BY_PREFIX[(m[1] || '').toUpperCase()]);
    if (box) {
      const raw = await recordingLookup(box, { lead_id: m[2] });
      raw.forEach(r => addDay(r.start));   // real call day, from ANY leg on this lead
      const mine = raw.filter(byCloser);
      if (mine.length) { pool = mine; fromLeadId = true; }
      // Cross-box transfer: the closer's leg is recorded on a DIFFERENT box than
      // the lead, so the lead_id lookup returns only the fronter's leg → filtering
      // to the closer empties the pool. Fall through to the agent+date branch
      // (queries every box by the closer's agent) instead of dead-ending on the
      // fronter's call.
      else if (raw.length) {
        logger.info('PORTAL_REC', `lead_id ${m[1]}${m[2]}: no closer leg on lead box (cross-box?) — falling through to agent+date`);
      }
    }
  }

  // 2. Fallback: the closer's agent recordings across all boxes, on every
  //    candidate dialer day. (agent_user already scopes per-agent; byCloser is
  //    belt-and-braces.)
  if (!pool.length && days.size) {
    const ids = [...agentSet];
    const dl = [...days];
    const results = await Promise.all(BOXES.flatMap(b => ids.flatMap(a => dl.map(d => recordingLookup(b, { agent_user: a, date: d })))));
    pool = results.flat().filter(byCloser);
  }
  if (!pool.length) return null;

  const phoneMatched = pool.filter(matchesPhone);
  // lead_id path is precise (already agent-scoped) → fall back to all if no phone
  // in filename; agent+date path is broad → REQUIRE a phone match so we never
  // serve another of the closer's calls from the same day.
  const cand = phoneMatched.length ? phoneMatched : (fromLeadId ? pool : []);
  if (!cand.length) return null;
  cand.sort((a, b) => b.duration - a.duration);
  return cand[0];
}

// ── Compliance review: candidate listing (UNFILTERED, cross-box) ────────────
// All recording legs related to a sale — fronter + closer + redials — with NO
// agent filter and NO longest-pick, for a human to eyeball. Unions the lead_id
// lookup (every leg on the lead's box) with the closer's agent+date recordings
// across all boxes (catches the closer's cross-box leg, narrowed to this
// customer's phone so it doesn't dump the closer's whole day). Each row carries
// phone_matches; the route adds agent name + is_closer_agent.
async function listCandidatesForSale({ code, phone, agentIds = [], date, dialerAt } = {}) {
  const tail = phoneTail(phone);
  const agentSet = new Set((agentIds || []).filter(Boolean).map(a => String(a).toUpperCase()));
  const days = new Set();
  const addDay = v => { const d = String(v || '').slice(0, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(d)) days.add(d); };
  if (dialerAt) { const b = new Date(dialerAt).getTime(); if (Number.isFinite(b)) for (const o of [-4, -28, 20]) addDay(new Date(b + o * 3600000).toISOString()); }
  addDay(date);

  const byId = new Map();   // box|recording_id -> row
  const add = (r, boxId) => { const k = boxId + '|' + r.recording_id; if (!byId.has(k)) byId.set(k, { ...r, box_id: boxId }); };

  const m = String(code || '').match(/^([A-Za-z]+)(\d+)$/);
  if (m) {
    const box = BOXES.find(b => b.id === BOX_BY_PREFIX[m[1].toUpperCase()]);
    if (box) { const raw = await recordingLookup(box, { lead_id: m[2] }); raw.forEach(r => { addDay(r.start); add(r, box.id); }); }
  }
  if (agentSet.size && days.size && tail) {
    const ids = [...agentSet], dl = [...days];
    const res = await Promise.all(BOXES.flatMap(b => ids.flatMap(a => dl.map(d => recordingLookup(b, { agent_user: a, date: d }).then(rows => ({ b, rows }))))));
    res.forEach(({ b, rows }) => rows.forEach(r => { if (onlyDigits(r.location).includes(tail)) add(r, b.id); }));
  }
  return [...byId.values()]
    .map(r => ({
      box_id: r.box_id, start_time: r.start, recording_id: r.recording_id, lead_id: r.lead_id,
      duration: r.duration, location: r.location, agent_user: r.user,
      phone_matches: !!(tail && onlyDigits(r.location).includes(tail)),
    }))
    .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
}

// Direct phone search (not tied to a sale) for the reviewer's manual tool. The
// recording API can't search by phone, so first pull the phone's call log
// (agents + dates across boxes), then recording_lookup per (box, agent, day) in
// range and keep the legs whose filename contains the phone.
async function listCandidatesByPhone({ phone, dateFrom, dateTo } = {}) {
  const tail = phoneTail(phone);
  if (!tail) return [];
  const calls = await lookupCallsByPhone(phone);
  const keys = new Map();
  for (const c of calls) {
    const day = String(c.call_date || '').slice(0, 10);
    if (!day) continue;
    if (dateFrom && day < String(dateFrom).slice(0, 10)) continue;
    if (dateTo && day > String(dateTo).slice(0, 10)) continue;
    if (!c.user || /^(VDAD|VDCL|admin|-+)$/i.test(c.user)) continue;
    keys.set(c.box + '|' + c.user + '|' + day, { boxId: c.box, user: c.user, day });
  }
  const byId = new Map();
  await Promise.all([...keys.values()].map(async ({ boxId, user, day }) => {
    const box = BOXES.find(b => b.id === boxId); if (!box) return;
    const rows = await recordingLookup(box, { agent_user: user, date: day });
    rows.forEach(r => { if (onlyDigits(r.location).includes(tail)) { const k = boxId + '|' + r.recording_id; if (!byId.has(k)) byId.set(k, { ...r, box_id: boxId }); } });
  }));
  return [...byId.values()]
    .map(r => ({
      box_id: r.box_id, start_time: r.start, recording_id: r.recording_id, lead_id: r.lead_id,
      duration: r.duration, location: r.location, agent_user: r.user, phone_matches: true,
    }))
    .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
}

// Direct LEAD-ID search across ALL boxes — recording_lookup accepts lead_id
// natively, so this returns EVERY leg on the lead (fronter + closer + redials)
// with NO agent-mapping requirement and NO phone filter: pure raw data straight
// off each dialer. Optional date range filters on the recording start day.
async function listCandidatesByLeadId(leadId, { dateFrom, dateTo } = {}) {
  const id = onlyDigits(leadId);
  if (!id) return [];
  const from = dateFrom ? String(dateFrom).slice(0, 10) : null;
  const to   = dateTo   ? String(dateTo).slice(0, 10)   : null;
  const byId = new Map();
  const res = await Promise.all(BOXES.map(b => recordingLookup(b, { lead_id: id }).then(rows => ({ b, rows }))));
  res.forEach(({ b, rows }) => rows.forEach(r => {
    const day = String(r.start || '').slice(0, 10);
    if (from && day && day < from) return;
    if (to && day && day > to) return;
    const k = b.id + '|' + r.recording_id;
    if (!byId.has(k)) byId.set(k, { ...r, box_id: b.id });
  }));
  return [...byId.values()]
    .map(r => ({
      box_id: r.box_id, start_time: r.start, recording_id: r.recording_id, lead_id: r.lead_id,
      duration: r.duration, location: r.location, agent_user: r.user, phone_matches: false,
    }))
    .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
}

// Deterministically re-derive a confirmed clip's stream URL from its reference
// (used when the stored location URL is stale/404s). recording_lookup by lead_id
// on the stored box, matched on recording_id. Returns the URL or null.
async function locationForRecording({ box_id, lead_id, recording_id } = {}) {
  if (!recording_id) return null;
  const box = BOXES.find(b => b.id === box_id); if (!box) return null;
  if (lead_id) {
    const rows = await recordingLookup(box, { lead_id });
    const hit = rows.find(r => String(r.recording_id) === String(recording_id));
    if (hit) return hit.location;
  }
  return null;
}

// Resolve the dialer lead_id for an un-coded (manual) transfer: recording_lookup
// by the closer's agent + the call date on that box, then match the customer
// phone inside the recording filename. Returns { lead_id, box, prefix } or null.
// Lets a manual lead get a proper vendor_lead_code (prefix+lead_id) so it becomes
// fully linked to the dialer. Best-effort — needs a recording to exist.
async function resolveLeadIdByAgentDate({ boxId, agent, date, phone }) {
  if (!boxId || !agent || !date || !phone) return null;
  const box = BOXES.find(b => b.id === boxId);
  if (!box) return null;
  const tail = phoneTail(phone);
  if (!tail) return null;
  const rows = await recordingLookup(box, { agent_user: agent, date: String(date).slice(0, 10) });
  const hit = (rows || []).find(r => r.lead_id && onlyDigits(r.location).includes(tail));
  return hit ? { lead_id: hit.lead_id, box: box.id, prefix: box.prefix } : null;
}

// ── Phone number from a recording filename ──────────────────────────────────
// e.g. .../20260703-111359_7137754668-all.mp3 → 7137754668. The basename holds
// yyyymmdd (8) + hhmmss (6) + PHONE (10-11) + optional agent ext (≤4); pick the
// 10/11-digit group (the phone), last one wins.
function phoneFromLocation(loc) {
  const base = String(loc || '').split(/[/\\]/).pop() || '';
  const groups = base.match(/\d{7,15}/g) || [];
  const phones = groups.filter(g => g.length === 10 || g.length === 11);
  return phones.length ? phones[phones.length - 1] : null;
}

// ── Whole-day recording browser (QA) ────────────────────────────────────────
// VICIdial's recording_lookup has NO date-only mode (returns INVALID SEARCH
// PARAMETERS), so a full day is built by fanning out agent_user × box × date.
// Concurrency-pooled; deduped by box|recording_id; a 15-min day-cache keyed on
// (date + agent set) makes re-opening instant (past days are immutable anyway).
// Returns rows enriched with the customer phone parsed from the filename.
const _dayCache = new Map();   // key → { at, rows }
const DAY_TTL = 15 * 60 * 1000;
// ttlMs overrides the default cache lifetime — the QA day browser passes the
// compliance-configured window (qa.day_cache_days) so a fetched day is kept and
// re-served for N days without hitting the dialer again.
async function listDayRecordings({ date, agentIds = [], concurrency = 15, ttlMs } = {}) {
  const day = String(date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return [];
  const ids = [...new Set((agentIds || []).filter(Boolean).map(a => String(a).toUpperCase()))];
  if (!ids.length) return [];

  const ttl = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : DAY_TTL;
  const key = day + '|' + ids.slice().sort().join(',');
  const hit = _dayCache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.rows;

  const boxes = BOXES;
  const tasks = [];
  for (const box of boxes) for (const a of ids) tasks.push({ box, a });
  const byId = new Map();
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const { box, a } = tasks[idx++];
      const rows = await recordingLookup(box, { agent_user: a, date: day });
      for (const r of rows) { const k = box.id + '|' + r.recording_id; if (!byId.has(k)) byId.set(k, { ...r, box_id: box.id }); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));

  const rows = [...byId.values()].map(r => ({
    box_id: r.box_id, start_time: r.start, agent_user: r.user, recording_id: r.recording_id,
    lead_id: r.lead_id, duration: r.duration, location: r.location, phone: phoneFromLocation(r.location),
  })).sort((a, b) => String(b.start_time).localeCompare(String(a.start_time)));   // newest first
  _dayCache.set(key, { at: Date.now(), rows });
  return rows;
}

// ── Bulk dispositions for a day (lead_status_search) ────────────────────────
// The efficient RCM path: instead of one API call per number, we call
// lead_status_search(status, date) ONCE per outcome status (returns up to ~2000
// leads that had that status that day) and map recordings → dispo by lead_id on
// the server. ~a dozen calls for a whole day instead of thousands.
//
// IMPORTANT: the disposition of a call = the STATUS WE SEARCHED UNDER (the
// call-log outcome), keyed by lead_id — NOT the returned `status` field (that's
// the lead's *current* status, which may differ after later redials).
// Response format: records separated by ";---------- START OF RECORD N ----------",
// each a block of "key => value" lines.
const _lssCache = new Map();   // `${boxId}|${status}|${date}` → { at, leadIds:Set }
const LSS_TTL = 15 * 60 * 1000;
// most-significant first — used to pick ONE dispo when a lead had several that day
const DISPO_RANK = ['SALE', 'XFER', 'TRANSFER', 'CALLBK', 'CB', 'CBHOLD', 'NI', 'NINTERESTED', 'DNQ', 'DEC', 'LVM', 'AM', 'DNC', 'DC', 'WN', 'NP'];
const rankOf = (s) => { const i = DISPO_RANK.indexOf(String(s || '').toUpperCase()); return i < 0 ? 999 : i; };

async function leadStatusSearch(box, status, date) {
  const key = `${box.id}|${status}|${date}`;
  const hit = _lssCache.get(key);
  if (hit && Date.now() - hit.at < LSS_TTL) return hit.leadIds;
  const leadIds = new Set();
  try {
    const r = await axios.get(`${box.base}/vicidial/non_agent_api.php`, {
      params: { source: 'crm', user: box.user, pass: box.pass, function: 'lead_status_search', status, date: String(date).slice(0, 10), custom_fields: 'N' },
      timeout: 30000, responseType: 'text',
    });
    const text = (typeof r.data === 'string' ? r.data : String(r.data || '')).trim();
    if (!/^ERROR|NO RESULTS|PERMISSION|INVALID/i.test(text)) {
      for (const block of text.split(/;-+\s*START OF RECORD\s+\d+\s*-+/i).slice(1)) {
        const m = block.match(/^\s*lead_id\s*=>\s*(\d+)/mi);
        if (m) leadIds.add(m[1]);
      }
    }
  } catch { /* box unreachable → empty */ }
  _lssCache.set(key, { at: Date.now(), leadIds });
  return leadIds;
}

// Per-lead status via lead_field_info (the completeness fallback: catches leads
// whose status code isn't in the bulk lead_status_search set — e.g. custom
// campaign codes — so EVERY recording can get a disposition). Cached like LSS.
async function _leadFieldOnBox(box, leadId) {
  const key = `lf|${box.id}|${leadId}`;
  const hit = _lssCache.get(key);
  if (hit && Date.now() - hit.at < LSS_TTL) return hit.status;
  let status = null;
  try {
    const r = await axios.get(`${box.base}/vicidial/non_agent_api.php`, {
      params: { source: 'crm', user: box.user, pass: box.pass, function: 'lead_field_info', field_name: 'status', lead_id: leadId },
      timeout: 15000, responseType: 'text',
    });
    const text = (typeof r.data === 'string' ? r.data : String(r.data || '')).trim();
    if (text && !/^ERROR|^NOTICE/i.test(text)) status = (text.split(/\r?\n/)[0].trim() || null);
  } catch { /* box unreachable → null */ }
  status = status ? status.toUpperCase() : null;
  _lssCache.set(key, { at: Date.now(), status });
  return status;
}

// A lead's status via lead_field_info. Tries the recording's own box first, then
// falls back to the OTHER boxes (cross-cluster leads whose lead_id resolves on a
// different box), so nothing is left blank.
async function leadFieldStatus(box, leadId) {
  let s = await _leadFieldOnBox(box, leadId);
  if (s) return s;
  for (const b of BOXES) { if (b.id === box.id) continue; s = await _leadFieldOnBox(b, leadId); if (s) return s; }
  return null;
}

// Customer identity fields for a lead via lead_field_info (VICIdial has no
// all-fields-by-lead_id call, so one request per field, run in parallel; cached
// like the status lookup). Best-effort FALLBACK — used by QA enrichment only when
// a recording has no CRM transfer/sale match.
const _CUST_FIELDS = ['first_name', 'last_name', 'phone_number', 'postal_code', 'state', 'address1'];
async function _leadFieldValue(box, leadId, field) {
  const key = `lfv|${box.id}|${leadId}|${field}`;
  const hit = _lssCache.get(key);
  if (hit && Date.now() - hit.at < LSS_TTL) return hit.val;
  let val = null;
  try {
    const r = await axios.get(`${box.base}/vicidial/non_agent_api.php`, {
      params: { source: 'crm', user: box.user, pass: box.pass, function: 'lead_field_info', field_name: field, lead_id: leadId },
      timeout: 12000, responseType: 'text',
    });
    const text = (typeof r.data === 'string' ? r.data : String(r.data || '')).trim();
    if (text && !/^ERROR|^NOTICE/i.test(text)) val = (text.split(/\r?\n/)[0].trim() || null);
  } catch { /* box unreachable → null */ }
  _lssCache.set(key, { at: Date.now(), val });
  return val;
}
async function _customerOnBox(box, leadId) {
  const [first, last, phone, zip, state, address] = await Promise.all(_CUST_FIELDS.map(f => _leadFieldValue(box, leadId, f)));
  const name = [first, last].filter(Boolean).join(' ').trim() || null;
  if (!name && !phone && !zip) return null;   // nothing useful on this box
  return { customer_name: name, customer_phone: phone || null, customer_zip: zip || null, customer_state: state || null, customer_address: address || null };
}
async function leadFieldCustomer(box, leadId) {
  if (!box || !leadId) return null;
  let c = await _customerOnBox(box, leadId);
  if (c) return c;
  for (const b of BOXES) { if (b.id === box.id) continue; c = await _customerOnBox(b, leadId); if (c) return c; }
  return null;
}

// ── VICIdial CUSTOM lead fields (the vehicle data etc. a campaign collects) ────
// The vehicle details a fronter takes — VIN, make, model, year, mileage — are not
// VICIdial standard lead columns. They live in the LIST's custom fields, which
// lead_field_info only returns when asked with custom_fields=Y (vici.md:596-615).
// There is no all-fields-by-lead call, so: ask the list which custom fields exist
// (list_custom_fields), then pull the wanted ones in parallel, cached.
//
// All best-effort. A box that is down, an archived lead, or an API user below
// level 7 resolves to null rather than throwing — scoring a call must never be
// blocked by the dialer being unreachable.

// A lead's list_id — the list_id override needed when reading a custom field.
const _leadListId = (box, leadId) => _leadFieldValue(box, leadId, 'list_id');

// Custom-field NAMES defined on a list. Lets the Scorecards editor offer a real
// mapping menu instead of asking somebody to type a field name from memory.
async function listCustomFieldNames(box, listId) {
  if (!box || !listId) return [];
  const key = `lcf|${box.id}|${listId}`;
  const hit = _lssCache.get(key);
  if (hit && Date.now() - hit.at < LSS_TTL) return hit.names;
  let names = [];
  try {
    const r = await axios.get(`${box.base}/vicidial/non_agent_api.php`, {
      params: { source: 'crm', user: box.user, pass: box.pass, function: 'list_custom_fields', list_id: listId },
      timeout: 15000, responseType: 'text',
    });
    const text = (typeof r.data === 'string' ? r.data : String(r.data || '')).trim();
    if (text && !/^ERROR|^NOTICE/i.test(text)) {
      // Rows are pipe- or comma-separated; the field name is the first column.
      // Drop the header row VICIdial prints before the records.
      for (const line of text.split(/\r?\n/)) {
        const first = line.split(/[|,]/)[0].trim();
        if (first && /^[a-z0-9_]+$/i.test(first) && !/^(field_label|field_name)$/i.test(first)) names.push(first);
      }
      names = [...new Set(names)];
    }
  } catch { /* box unreachable → no names */ }
  _lssCache.set(key, { at: Date.now(), names });
  return names;
}

// One field's value for a lead. Tries the plain read first (a field can be
// standard on one cluster and custom on another), then the custom_fields=Y form
// with the lead's own list_id.
async function _customFieldOnBox(box, leadId, field) {
  const plain = await _leadFieldValue(box, leadId, field);
  if (plain) return plain;
  const key = `lcv|${box.id}|${leadId}|${field}`;
  const hit = _lssCache.get(key);
  if (hit && Date.now() - hit.at < LSS_TTL) return hit.val;
  let val = null;
  try {
    const listId = await _leadListId(box, leadId);
    const r = await axios.get(`${box.base}/vicidial/non_agent_api.php`, {
      params: {
        source: 'crm', user: box.user, pass: box.pass, function: 'lead_field_info',
        field_name: field, lead_id: leadId, custom_fields: 'Y',
        ...(listId ? { list_id: listId } : {}),
      },
      timeout: 12000, responseType: 'text',
    });
    const text = (typeof r.data === 'string' ? r.data : String(r.data || '')).trim();
    if (text && !/^ERROR|^NOTICE/i.test(text)) val = (text.split(/\r?\n/)[0].trim() || null);
  } catch { /* box unreachable → null */ }
  _lssCache.set(key, { at: Date.now(), val });
  return val;
}

/**
 * Values for named lead fields (standard or custom) for ONE lead.
 * Tries the recording's own box first, then the others — a lead_id can resolve on
 * a different cluster. Returns { field: value } carrying only fields that had a
 * value, so an empty object means "nothing to fill", never an error.
 */
async function leadCustomFields(box, leadId, fields = []) {
  const want = [...new Set((fields || []).filter(Boolean))].slice(0, 20);   // bounded: 1 HTTP call per field
  if (!leadId || !want.length) return {};
  const boxes = [box, ...BOXES.filter(b => b && (!box || b.id !== box.id))].filter(Boolean);
  const out = {};
  for (const b of boxes) {
    const missing = want.filter(f => out[f] == null);
    if (!missing.length) break;
    const vals = await Promise.all(missing.map(f => _customFieldOnBox(b, leadId, f)));
    missing.forEach((f, i) => { if (vals[i]) out[f] = vals[i]; });
  }
  return out;
}

// ── Who hung up ─────────────────────────────────────────────────────────────
// recording_lookup returns start|user|recording_id|lead_id|duration|location and
// nothing else — no hangup information at all. That lives in phone_number_log,
// whose rows carry hangup_reason + call_status per call. So the two are matched
// up: same agent, and a start time within a couple of minutes of the logged call.
//
// Only the reasons that answer "who dropped the call" are translated; anything
// unrecognised passes through verbatim rather than being guessed at.
const HANGUP_LABELS = {
  AGENT: 'Agent hung up',
  CALLER: 'Customer hung up',
  QUEUETIMEOUT: 'Dropped in queue',
  AFTERHOURS: 'After hours',
  TIMEOUT: 'Timed out',
};
const hangupLabel = (r) => (r ? (HANGUP_LABELS[String(r).toUpperCase()] || String(r)) : null);

const _hangupCache = new Map();            // phone tail → { at, rows }
const HANGUP_TTL = 10 * 60 * 1000;

async function callLogRows(phone) {
  const tail = phoneTail(phone);
  if (!tail) return [];
  const hit = _hangupCache.get(tail);
  if (hit && Date.now() - hit.at < HANGUP_TTL) return hit.rows;
  const rows = (await Promise.all(BOXES.map(b => phoneCallLog(b, phone)))).flat();
  _hangupCache.set(tail, { at: Date.now(), rows });
  return rows;
}

/**
 * Attach hangup_reason / hangup_label / call_status to each recording.
 *
 * Matching is deliberately conservative: an unmatched clip gets NO label rather
 * than a plausible-looking wrong one — telling a reviewer the customer hung up
 * when the agent did would send coaching in exactly the wrong direction.
 */
async function annotateHangups(candidates = [], phone) {
  if (!candidates.length || !phone) return candidates;
  let rows = [];
  try { rows = await callLogRows(phone); } catch { return candidates; }
  // The dialer's call log keeps only recent calls (no archive is reachable
  // through the API). Say so on the clip rather than leaving a silent blank the
  // reviewer reads as "nobody hung up".
  if (!rows.length) return candidates.map(c => ({ ...c, hangup_unavailable: true }));
  const ts = (v) => { const t = Date.parse(String(v || '').replace(' ', 'T')); return Number.isFinite(t) ? t : null; };
  return candidates.map(c => {
    const start = ts(c.start_time || c.start);
    if (!start) return c;
    const au = String(c.agent_user || '').trim().toUpperCase();
    // Two passes so a clip is not left blank on a technicality. First the strict
    // match (same agent, within 2 minutes). If the log rows carry a different
    // agent spelling — or none — fall back to the nearest call in a wider window
    // on the same phone, which is still the same conversation.
    const pick = (window, sameAgent) => {
      let best = null, bestDelta = Infinity;
      for (const r of rows) {
        const rt = ts(r.call_date);
        if (rt == null) continue;
        const delta = Math.abs(rt - start);
        if (delta > window) continue;
        if (sameAgent && au && r.user && String(r.user).trim().toUpperCase() !== au) continue;
        if (delta < bestDelta) { best = r; bestDelta = delta; }
      }
      return best;
    };
    // Widening ladder. A back-dated task is the hard case: the clip is real, but
    // the log rows for it are older, sometimes recorded against a different
    // agent login, and phone_number_log has no archive mode at all (checked —
    // the API exposes only the live log). So: exact, then same-agent-any-time,
    // then the same DAY, then a lone row for that number. Each step is still the
    // same phone — never another customer's call.
    const sameDayRows = rows.filter(r => {
      const rt = ts(r.call_date);
      return rt != null && new Date(rt).toISOString().slice(0, 10) === new Date(start).toISOString().slice(0, 10);
    });
    const best = pick(120000, true)
      || pick(600000, false)
      || (sameDayRows.length === 1 ? sameDayRows[0] : null)
      || (rows.length === 1 ? rows[0] : null);
    if (!best) return c;
    return {
      ...c,
      hangup_reason: best.hangup_reason || null,
      hangup_label: hangupLabel(best.hangup_reason),
      call_status: best.call_status || null,
      log_length: best.length || null,
      // the disposition OF THIS CALL — already in the row we matched, so it
      // costs nothing extra and is more precise than the lead's current status
      disposition: (best.lead_status && !SYSTEM_SKIP.has(String(best.lead_status).trim().toUpperCase()))
        ? String(best.lead_status).trim() : null,
    };
  });
}

// ── The disposition of a call, by every route the dialer offers ─────────────
//
// Researched against the non_agent_api reference, function by function. What can
// actually answer "what was this call dispositioned as":
//
//   phone_number_log   per-CALL rows carrying lead_status + call_status. This is
//                      the disposition OF THE CALL — the best possible answer —
//                      but the log holds only recent calls (it has no archive
//                      mode; checked).
//   lead_field_info    the lead's CURRENT status from vicidial_list. Weaker (a
//                      later call can overwrite it) but never archived, so it
//                      still answers for old calls.
//   update_lead(no_update=Y)  phone → lead_id, when nothing else linked one.
//
// Ruled out, deliberately: call_dispo_report is an aggregate by ingroup/date,
// not per lead; callid_info and ccc_lead_info both key on a call_id the CRM
// never captures; lead_status_search searches BY status, which is backwards.
//
// Most specific first, and every route is scoped to this customer's own phone or
// lead — never a nearby call.
async function resolveDisposition({ phone, vendorCode, leadId, boxId, startTime, agentUser } = {}) {
  const usable = (s) => (s && !SYSTEM_SKIP.has(String(s).trim().toUpperCase()) ? String(s).trim() : null);

  // 1. the log row for THIS call — the disposition the agent actually set
  if (phone && startTime) {
    try {
      const rows = await callLogRows(phone);
      const ts = (v) => { const t = Date.parse(String(v || '').replace(' ', 'T')); return Number.isFinite(t) ? t : null; };
      const start = ts(startTime);
      const au = String(agentUser || '').trim().toUpperCase();
      if (start && rows.length) {
        let best = null, bestDelta = Infinity;
        for (const r of rows) {
          const rt = ts(r.call_date);
          if (rt == null) continue;
          const delta = Math.abs(rt - start);
          if (delta > 600000) continue;
          if (au && r.user && String(r.user).trim().toUpperCase() !== au) continue;
          if (delta < bestDelta) { best = r; bestDelta = delta; }
        }
        const s = usable(best && best.lead_status);
        if (s) return { code: s, source: 'call_log' };
      }
    } catch { /* fall through to the lead's own status */ }
  }

  // 2. the lead's current status — survives archiving, so old calls still answer
  try {
    if (vendorCode) { const s = usable(await leadStatusByCode(vendorCode)); if (s) return { code: s, source: 'lead_status' }; }
  } catch { /* next route */ }
  try {
    if (leadId) {
      const box = BOXES.find(b => b.id === boxId) || null;
      const s = usable(await leadFieldStatus(box, leadId));
      if (s) return { code: s, source: 'lead_status' };
    }
  } catch { /* next route */ }

  // 3. nothing linked a lead at all → find one by phone, then read its status
  if (phone && !leadId && !vendorCode) {
    try {
      const hit = await findLeadByPhone({ phone });
      if (hit && hit.confidence !== 'ambiguous') {
        const box = BOXES.find(b => b.id === hit.box) || null;
        const s = usable(await leadFieldStatus(box, hit.lead_id));
        if (s) return { code: s, source: `lead_lookup:${hit.confidence}` };
      }
    } catch { /* nothing more to try */ }
  }

  // 4. last resort — this number's most recent logged call, whenever it was
  if (phone) {
    try {
      const rows = await callLogRows(phone);
      const newest = rows.slice().sort((a, b) => String(b.call_date).localeCompare(String(a.call_date)))[0];
      const s = usable(newest && newest.lead_status);
      if (s) return { code: s, source: 'call_log_recent' };
    } catch { /* give up honestly */ }
  }
  return null;
}

// ── Phone → lead_id, without needing a recording ────────────────────────────
// update_lead with no_update=Y performs NO write: it only reports which leads
// match, and its NOTICE line carries the lead_id we cannot get any other way
// (phone_number_log returns call rows with no lead_id, and recording_lookup
// needs a recording to exist — many QA tasks have neither).
//
//   NOTICE: update_lead LEADS FOUND IN THE SYSTEM: |user|lead_id|vendor_lead_code|phone|list_id|entry_list_id
//
// `records` asks for more than the single most-recent match so an agent match is
// possible when a customer was dialled repeatedly.
async function leadsByPhoneOnBox(box, phone, { records = 10 } = {}) {
  const variants = phoneVariants(phone);
  if (!box || !variants.length) return [];
  const out = [];
  for (const v of variants) {
    try {
      const r = await axios.get(`${box.base}/vicidial/non_agent_api.php`, {
        params: {
          source: 'crm', user: box.user, pass: box.pass, function: 'update_lead',
          search_method: 'PHONE_NUMBER', search_location: 'SYSTEM',
          phone_number: v, records, no_update: 'Y',
        },
        timeout: 15000, responseType: 'text',
      });
      const text = (typeof r.data === 'string' ? r.data : String(r.data || '')).trim();
      if (!text || /NO MATCHES FOUND/i.test(text)) continue;
      for (const line of text.split(/\r?\n/)) {
        if (!/LEADS FOUND IN THE SYSTEM/i.test(line)) continue;
        // Split from the FIRST PIPE, not the first colon — "NOTICE:" carries a
        // colon of its own, and slicing there shifts every field by one, which
        // reads the API user id as the lead id.
        const pipe = line.indexOf('|');
        if (pipe < 0) continue;
        const cells = line.slice(pipe + 1).split('|').map(s => s.trim());
        const [user, lead_id, vendor_lead_code, lphone, list_id] = cells;
        if (!/^\d+$/.test(String(lead_id || ''))) continue;
        out.push({ box: box.id, prefix: box.prefix, user, lead_id: String(lead_id), vendor_lead_code, phone: lphone, list_id });
      }
      if (out.length) break;          // a 10-digit hit is enough; don't re-ask with 1+10
    } catch { /* box unreachable → try the next variant/box */ }
  }
  return out;
}

/**
 * Find the dialer lead for a phone across every box.
 *
 * Ambiguity is the whole problem: the same customer can exist on several boxes
 * and several lists. So a match is only reported as CONFIDENT when it is
 * unambiguous — either the lead's own agent is one of this agent's dialer ids,
 * or the phone matched exactly one lead in the whole estate. Anything else comes
 * back as confidence 'ambiguous' and the caller must not persist it: writing the
 * wrong vendor_lead_code onto a transfer would mislink a customer's call
 * history, which is far worse than an empty column.
 */
async function findLeadByPhone({ phone, agentIds = [], preferBoxId = null } = {}) {
  if (!phone) return null;
  const boxes = [...BOXES].sort((a, b) => (a.id === preferBoxId ? -1 : b.id === preferBoxId ? 1 : 0));
  const hits = (await Promise.all(boxes.map(b => leadsByPhoneOnBox(b, phone)))).flat();
  if (!hits.length) return null;

  const ids = new Set((agentIds || []).map(x => String(x).trim().toLowerCase()).filter(Boolean));
  const byAgent = ids.size ? hits.filter(h => ids.has(String(h.user || '').trim().toLowerCase())) : [];
  if (byAgent.length) {
    // same agent, same customer — if they dialled it more than once, the newest
    // lead is still that agent's call, so pick it rather than giving up
    const newest = byAgent.slice().sort((a, b) => Number(b.lead_id) - Number(a.lead_id))[0];
    return { ...newest, confidence: 'agent' };
  }
  const unique = [...new Map(hits.map(h => [`${h.box}|${h.lead_id}`, h])).values()];
  if (unique.length === 1) return { ...unique[0], confidence: 'unique' };
  return { ...unique.sort((a, b) => Number(b.lead_id) - Number(a.lead_id))[0], confidence: 'ambiguous', matches: unique.length };
}

/**
 * Split a vendor_lead_code into the box + lead_id it encodes.
 *
 * This is the SECOND way to reach a lead, and for QA it is the important one:
 * only a quarter of QA assignments carry a recording_ref (the RCM / day-recording
 * ones). The rest are materialised from a CRM transfer or sale and have no
 * recording attached — but their transfer carries vicidial_vendor_code, which is
 * box prefix + lead_id. Without this, every CRM-sourced task had no lead to look
 * up, so dialer-mapped columns silently filled nothing.
 *
 * Same parse as leadStatusByCode: letters = prefix, digits = lead_id.
 */
function leadFromVendorCode(code) {
  const m = String(code || '').match(/^([A-Za-z]*)(\d+)$/);
  if (!m) return null;
  const boxId = BOX_BY_PREFIX[(m[1] || '').toUpperCase()] || null;
  return m[2] ? { boxId, leadId: m[2] } : null;
}

/** Custom-field names across the boxes for the given lists — the mapping menu. */
async function discoverCustomFieldNames(sampleListIds = []) {
  const names = new Set();
  for (const b of BOXES) {
    for (const listId of sampleListIds) {
      for (const n of await listCustomFieldNames(b, listId)) names.add(n);
    }
  }
  return [...names].sort();
}

// Resolve dispositions for (boxId, leadId) pairs INCREMENTALLY. Cached-final
// leads (incl. resolved-null) are returned instantly; up to `budget` NEW leads
// are fetched this call. Returns { map, remaining, total } so the caller can
// poll until remaining === 0 — this keeps each request fast + avoids timeouts on
// a full company's day (thousands of leads = thousands of 1-call lookups).
const _dispoFinal = new Map();   // `${boxId}|${leadId}` → { at, status (may be null) }
const DISPO_FINAL_TTL = 30 * 60 * 1000;   // past days are immutable
async function resolveDispos(pairs = [], { budget = 800, concurrency = 30 } = {}) {
  const uniq = [...new Map((pairs || []).filter(p => p && p.boxId && p.leadId).map(p => [`${p.boxId}|${p.leadId}`, p])).values()];
  const map = new Map();
  const todo = [];
  for (const p of uniq) {
    const k = `${p.boxId}|${p.leadId}`;
    const c = _dispoFinal.get(k);
    if (c && Date.now() - c.at < DISPO_FINAL_TTL) { if (c.status) map.set(k, c.status); }
    else todo.push(p);
  }
  const batch = todo.slice(0, budget);
  let idx = 0;
  async function worker() {
    while (idx < batch.length) {
      const { boxId, leadId } = batch[idx++];
      const box = BOXES.find(b => b.id === boxId);
      if (!box) continue;
      const s = await leadFieldStatus(box, leadId);          // own box, then cross-box
      _dispoFinal.set(`${boxId}|${leadId}`, { at: Date.now(), status: s });   // cache final (incl null → no re-hammer)
      if (s) map.set(`${boxId}|${leadId}`, s);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batch.length) }, worker));
  return { map, remaining: todo.length - batch.length, total: uniq.length };
}

// Fill status for a set of pairs in one shot (uncapped) — thin wrapper over
// resolveDispos for the synchronous path. Returns Map<`${boxId}|${leadId}`, code>.
async function fillLeadStatuses(pairs = []) {
  const { map } = await resolveDispos(pairs, { budget: 100000 });
  return map;
}

// Returns Map<`${boxId}|${leadId}`, dispoCode>. Only queries the given boxes
// (those that actually had recordings) × the given statuses. Concurrency-pooled.
async function listDayDispositions({ date, statuses = [], boxIds = null, concurrency = 12 } = {}) {
  const day = String(date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return new Map();
  const boxes = boxIds ? BOXES.filter(b => boxIds.includes(b.id)) : BOXES;
  const codes = [...new Set((statuses || []).map(s => String(s || '').trim().toUpperCase()).filter(Boolean))];
  if (!boxes.length || !codes.length) return new Map();

  const tasks = [];
  for (const box of boxes) for (const code of codes) tasks.push({ box, code });
  const map = new Map();   // box|lead → dispo (best rank wins)
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const { box, code } = tasks[idx++];
      const leadIds = await leadStatusSearch(box, code, day);
      for (const lead of leadIds) {
        const k = `${box.id}|${lead}`;
        const cur = map.get(k);
        if (!cur || rankOf(code) < rankOf(cur)) map.set(k, code);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return map;
}

// ── Agent roster (agent_stats_export) ───────────────────────────────────────
// Pull the list of agents who were active on a box over a window, as
// { login, full_name, group, calls }. `login` is the dialer user UPPERCASED —
// exactly what vicidial_agent_ids stores — so the mapping UI can suggest + add
// it directly. One box or all; a dead box just contributes nothing.
async function fetchAgentRoster({ boxId = null, days = 7 } = {}) {
  const boxes = boxId ? BOXES.filter(b => b.id === boxId) : BOXES;
  const end = new Date();
  const start = new Date(end.getTime() - Math.max(1, days) * 86400000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const results = await Promise.all(boxes.map(async (box) => {
    try {
      const r = await axios.get(`${box.base}/vicidial/non_agent_api.php`, {
        params: { source: 'crm', user: box.user, pass: box.pass, function: 'agent_stats_export', stage: 'pipe', header: 'YES',
          datetime_start: `${fmt(start)} 00:00:00`, datetime_end: `${fmt(end)} 23:59:59` },
        timeout: 30000, responseType: 'text',
      });
      const text = typeof r.data === 'string' ? r.data : String(r.data || '');
      if (!text || /^ERROR|PERMISSION|INVALID|NO RECORDS/i.test(text.trim())) return [];
      const out = [];
      for (const line of text.split(/\r?\n/).slice(1)) {   // slice(1): drop the header row
        const p = line.split('|');
        const raw = (p[0] || '').trim();
        if (!raw || !(p[1] || '').trim()) continue;
        out.push({ box_id: box.id, prefix: box.prefix, login: raw.toUpperCase(), full_name: (p[1] || '').trim(), group: (p[2] || '').trim(), calls: parseInt(p[3], 10) || 0 });
      }
      return out;
    } catch { return []; }
  }));
  const seen = new Set(); const flat = [];
  for (const r of results.flat()) { const k = r.box_id + '|' + r.login; if (!seen.has(k)) { seen.add(k); flat.push(r); } }
  return flat;
}

// NOTE: BOXES is mutable (refreshed from DB). Export accessors so callers always
// get the LIVE list/prefixes, not a stale snapshot captured at require-time.
module.exports = {
  getBoxes: () => BOXES,
  fetchAgentRoster,
  boxPrefixes,
  refreshBoxes,
  lookupCallsByPhone, lookupCallsByPhoneDiag, latestDisposition, leadStatusByCode, leadAgentByCode, findSaleRecording,
  resolveLeadIdByAgentDate,
  listCandidatesForSale, listCandidatesByPhone, listCandidatesByLeadId, locationForRecording,
  listDayRecordings, phoneFromLocation, listDayDispositions, leadStatusSearch,
  leadFieldStatus, leadFieldCustomer, fillLeadStatuses, resolveDispos,
  leadCustomFields, listCustomFieldNames, discoverCustomFieldNames, leadFromVendorCode,
  leadsByPhoneOnBox, findLeadByPhone, annotateHangups, resolveDisposition,
};
