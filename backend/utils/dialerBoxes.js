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

// phone_number_log on one box for a phone → parsed call rows (any order). Uses
// axios (always present) — bare global fetch isn't guaranteed on every Node.
async function phoneCallLog(box, phone) {
  const params = {
    source: 'crm', user: box.user, pass: box.pass, function: 'phone_number_log',
    phone_number: phone, type: 'ALL', detail: 'ALL', stage: 'pipe',
  };
  try {
    const r = await axios.get(`${box.base}/vicidial/non_agent_api.php`, { params, timeout: 15000, responseType: 'text' });
    const text = typeof r.data === 'string' ? r.data : String(r.data || '');
    if (!text || /^ERROR|^NOTICE/m.test(text)) return [];
    return text.trim().split(/\r?\n/).filter(Boolean).map(l => {
      const [phone_number, call_date, list_id, length_in_sec, lead_status, hangup_reason, call_status, source_id, user] = l.split('|');
      return { box: box.id, phone_number, call_date, length: parseInt(length_in_sec, 10) || 0, lead_status, hangup_reason, call_status, user };
    }).filter(r => r.call_date);
  } catch { return []; }
}

// Refresh the live BOXES + BOX_BY_PREFIX from the vicidial_boxes table so a
// superadmin can change a dialer's URL / creds / prefix from Settings. Keeps the
// current (hardcoded/seed) values if the table is missing or empty.
async function refreshBoxes() {
  try {
    const { supabaseAdmin } = require('../config/database');
    const { data, error } = await supabaseAdmin
      .from('vicidial_boxes').select('name, prefix, base_url, api_user, api_pass')
      .eq('is_active', true).order('sort_order', { ascending: true });
    if (error || !data || !data.length) return;
    BOXES = data.map(b => ({ id: b.name, base: String(b.base_url || '').replace(/\/+$/, ''), user: b.api_user, pass: b.api_pass, prefix: (b.prefix || '').toUpperCase() }));
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
// the lead's own box; fallback = the closer's agent recordings for the sale date,
// narrowed by the customer's phone in the filename. Among candidates we pick the
// LONGEST call — that's the substantive sale conversation, not a quick redial.
// Returns { location, recording_id, duration, start, box } or null (no match →
// the portal hides the sale, never plays a wrong recording).
async function findSaleRecording({ code, phone, agentIds = [], date } = {}) {
  const tail = phoneTail(phone);
  const matchesPhone = rec => tail && onlyDigits(rec.location).includes(tail);

  let pool = [];
  const m = String(code || '').match(/^([A-Za-z]+)(\d+)$/);
  if (m) {
    const box = BOXES.find(b => b.id === BOX_BY_PREFIX[(m[1] || '').toUpperCase()]);
    if (box) pool = await recordingLookup(box, { lead_id: m[2] });
  }
  if (!pool.length && date && agentIds.length) {
    const d = String(date).slice(0, 10);
    const ids = [...new Set(agentIds.filter(Boolean).map(String))];
    const results = await Promise.all(BOXES.flatMap(b => ids.map(a => recordingLookup(b, { agent_user: a, date: d }))));
    pool = results.flat();
  }
  if (!pool.length) return null;

  const phoneMatched = pool.filter(matchesPhone);
  // lead_id path is precise → fall back to all if no phone in filename; agent+date
  // path is broad → REQUIRE a phone match so we never serve someone else's call.
  const cand = phoneMatched.length ? phoneMatched : (m ? pool : []);
  if (!cand.length) return null;
  cand.sort((a, b) => b.duration - a.duration);
  return cand[0];
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

// NOTE: BOXES is mutable (refreshed from DB). Export accessors so callers always
// get the LIVE list/prefixes, not a stale snapshot captured at require-time.
module.exports = {
  getBoxes: () => BOXES,
  boxPrefixes,
  refreshBoxes,
  lookupCallsByPhone, latestDisposition, leadStatusByCode, leadAgentByCode, findSaleRecording,
  resolveLeadIdByAgentDate,
};
