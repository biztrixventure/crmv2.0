/**
 * Read-only registry of the VICIdial boxes for on-demand lookups (e.g. the
 * "Fetch Dispo" button). Creds come from env; fall back to the known boxes.
 * Never used for writes — only call_log / status reads.
 */
const BOXES = [
  { id: 'wavetech', base: process.env.WAVETECH_DIALER_URL || 'https://wavetechnew.i5.tel', user: process.env.WAVETECH_DIALER_USER || 'apiuser', pass: process.env.WAVETECH_DIALER_PASS || 'apiuser123' },
  { id: 'etc',      base: process.env.ETC_DIALER_URL      || 'https://wavetech3new.i5.tel', user: process.env.ETC_DIALER_USER      || 'ceo',     pass: process.env.ETC_DIALER_PASS      || 'ceo' },
  { id: 'tmc',      base: process.env.TMC_DIALER_URL      || 'https://tmcsolihp.i5.tel',    user: process.env.TMC_DIALER_USER      || '1002',    pass: process.env.TMC_DIALER_PASS      || '1002' },
];

// Statuses that are NOT a closer outcome — no customer contact (A/N/DAIR…),
// in-progress/system states, and the transfer event itself (XFER and friends).
// "Fetch dispo" wants the closer's actual disposition, so these are skipped; if
// only these exist, it reports "no disposition yet" rather than guessing XFER.
const NO_CONNECT = new Set([
  'A', 'N', 'NA', 'DAIR', 'DROP', 'AFTHRS', 'B', 'DC', 'AB', 'ADC', 'PDROP', 'AA',
  'NANQUE', 'TIMEOT', 'CXHNGP', 'INCALL', 'QUEUE', 'CH', 'DISPO', 'NEW',
  'XFER', 'TRANSFER', 'XDROP', 'IVRXFR', 'RQXFER',
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

// Map a vendor-code prefix → the box that lead lives on.
const BOX_BY_PREFIX = { WTI: 'wavetech', ETC: 'etc', TMC: 'tmc' };

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
    return (status && !NO_CONNECT.has(status.toUpperCase())) ? status : null;
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
async function latestDisposition(phone) {
  const calls = await lookupCallsByPhone(phone);
  const real = calls.find(c => {
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

module.exports = { BOXES, lookupCallsByPhone, latestDisposition, leadStatusByCode, leadAgentByCode, findSaleRecording };
