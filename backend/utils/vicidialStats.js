// ============================================================================
// utils/vicidialStats.js — STATELESS proxy for VICIdial's admin user_stats.php.
//
// user_stats.php is the VICIdial ADMIN web page (NOT the non_agent_api). It sits
// behind HTTP Basic auth and returns an HTML report with several sections for a
// single agent + date range:
//   - Manual Outbound Calls  (phone, lead, dialed, call type …)
//   - Agent Activity         (pause/wait/talk/dispo seconds, status, lead …)
//   - Outbound Calls         (length, STATUS, PHONE, campaign, group, LIST, LEAD, hangup)
//   - Agent Webserver/URL Logins
//   - Agent Talk Time and Status  (per-status COUNT + HH:MM:SS summary)
//
// This module fetches that page (creds injected server-side from app_secrets so
// they never touch the browser) and parses the HTML into JSON. It PERSISTS
// NOTHING — the pulled report lives only in the caller's browser. Only a batch
// the superadmin deliberately creates is written, via the existing distribution
// flow (see routes/vicidial.js /stats/create-batch).
// ============================================================================
const axios = require('axios');
const { parse } = require('node-html-parser');
const { supabaseAdmin } = require('../config/database');
const { getBoxes } = require('./dialerBoxes');
const logger = require('./logger');

// app_secrets key for a box's user_stats.php Basic-auth creds (admin login —
// DIFFERENT from the non_agent_api creds on vicidial_boxes). Stored as JSON.
const authKey = (boxId) => `vici_stats.${boxId}`;

const onlyDigits = (s) => String(s || '').replace(/\D/g, '');
const tail10 = (d) => (d.length >= 10 ? d.slice(-10) : d);

// ── PROCESS-WIDE limiter ─────────────────────────────────────────────────────
// A single fetch+parse of a big user_stats.php report is memory-heavy. On a
// RAM-starved host, several running at once (many agents in one pull, or two
// superadmins at once) spike memory → GC thrash / OOM that stalls EVERY request
// (gateway timeouts app-wide). Cap heavy pulls to 2 concurrent across the whole
// process; the rest queue. Superadmin-only + low volume, so a short queue is fine.
let _active = 0;
const _queue = [];
const MAX_CONCURRENT_PULLS = 2;
function acquireSlot() {
  if (_active < MAX_CONCURRENT_PULLS) { _active++; return Promise.resolve(); }
  return new Promise(resolve => _queue.push(resolve));
}
function releaseSlot() {
  _active--;
  const next = _queue.shift();
  if (next) { _active++; next(); }
}

// Resolve the box for an agent id by its letter prefix (WTI1020 → WTI → wavetech).
// A bare-numeric id (no prefix) can't be resolved — the caller must pass a boxId.
function boxForAgent(agentId) {
  const letters = String(agentId || '').match(/^([A-Za-z]+)/);
  if (!letters) return null;
  const pfx = letters[1].toUpperCase();
  return getBoxes().find(b => (b.prefix || '').toUpperCase() === pfx) || null;
}

function boxById(boxId) {
  return getBoxes().find(b => b.id === boxId) || null;
}

// Read a box's user_stats Basic-auth creds. app_secrets wins; if none set there,
// fall back to the box's own api_user/api_pass (the non_agent_api creds — a
// best-effort default so the tool still works before creds are configured).
async function getStatsAuth(box) {
  if (!box) return null;
  try {
    const { data } = await supabaseAdmin.from('app_secrets').select('value').eq('key', authKey(box.id)).maybeSingle();
    if (data?.value) {
      const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
      if (parsed?.user) return { user: String(parsed.user), pass: String(parsed.pass || '') };
    }
  } catch { /* fall through to box creds */ }
  if (box.user) return { user: box.user, pass: box.pass || '' };
  return null;
}

async function setStatsAuth(boxId, user, pass, updatedBy) {
  const value = JSON.stringify({ user: String(user || '').trim(), pass: String(pass || '') });
  await supabaseAdmin.from('app_secrets')
    .upsert({ key: authKey(boxId), value, updated_at: new Date().toISOString(), updated_by: updatedBy || null }, { onConflict: 'key' });
}

// Per-box: is a dedicated user_stats cred set in app_secrets? (Never returns the
// secret itself — only a boolean, plus whether a box-cred fallback exists.)
async function authStatus() {
  const boxes = getBoxes();
  const { data } = await supabaseAdmin.from('app_secrets').select('key').in('key', boxes.map(b => authKey(b.id)));
  const configured = new Set((data || []).map(r => r.key));
  return boxes.map(b => ({
    id: b.id, prefix: b.prefix, base: b.base,
    stats_auth_set: configured.has(authKey(b.id)),
    box_auth_fallback: !!b.user,   // non_agent_api creds usable as a fallback
  }));
}

// Fetch the raw user_stats.php HTML for one agent + window. Basic auth injected
// here (server-side) — creds never reach the client. Returns { ok, html } / err.
async function fetchUserStatsHtml({ box, user, beginDate, endDate, callStatus, archived, db = 0 }) {
  const auth = await getStatsAuth(box);
  if (!auth) return { ok: false, error: `No credentials configured for ${box.id}` };
  const params = {
    DB: db,
    begin_date: beginDate,
    end_date: endDate,
    user,
    call_status: callStatus || '',
    submit: 'submit',
  };
  if (archived) params.search_archived_data = 'checked';
  try {
    const r = await axios.get(`${box.base}/vicidial/user_stats.php`, {
      params,
      auth: { username: auth.user, password: auth.pass },
      timeout: 30000,
      responseType: 'text',
      // HARD memory guard. The old 64MB ceiling let a big archived pull buffer a
      // huge string AND a parsed DOM on a RAM-starved host → OOM/GC thrash that
      // wedged the WHOLE event loop (every user got a gateway timeout, not just
      // the puller). 12MB is far above a normal day's report; a runaway archive
      // dump is rejected fast instead of taken the server down.
      maxContentLength: 12 * 1024 * 1024,
      maxBodyLength: 12 * 1024 * 1024,
      // user_stats.php returns 200 with an HTML login form on bad auth, and 401
      // when Apache guards it — treat <500 as "got a page", inspect below.
      validateStatus: (s) => s >= 200 && s < 500,
    });
    if (r.status === 401 || r.status === 403) return { ok: false, error: 'Dialer rejected the credentials (401/403)' };
    const html = typeof r.data === 'string' ? r.data : String(r.data || '');
    if (!html) return { ok: false, error: 'Empty response from the dialer' };
    // A VICIdial auth failure renders a tiny login page, not the report.
    if (/VICIDIAL_LOGIN|name=["']?login["']?/i.test(html) && !/user_stats|Talk Time/i.test(html)) {
      return { ok: false, error: 'Dialer returned a login page — credentials likely wrong' };
    }
    return { ok: true, html };
  } catch (e) {
    logger.warn('VICI_STATS', `fetch failed for ${user}@${box.id}: ${e.message}`);
    if (e.code === 'ERR_FR_MAX_CONTENT_LENGTH_EXCEEDED' || /maxContentLength/i.test(e.message || ''))
      return { ok: false, error: 'Report too large — narrow the date range (or turn off Archived)' };
    if (e.code === 'ECONNABORTED' || /timeout/i.test(e.message || ''))
      return { ok: false, error: 'Dialer timed out — narrow the date range (Archived scans are slow)' };
    return { ok: false, error: `Dialer unreachable: ${e.message}` };
  }
}

// ── HTML → JSON ─────────────────────────────────────────────────────────────
// Normalize a header cell to a stable key: "DATE/TIME" → "date/time",
// "HANGUP REASON" → "hangup reason".
const normHead = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

// Read a <table> as { headers:[normalized], rows:[[cellText,…]] }. The header is
// the first row with ≥2 non-empty cells; rows after it are data. Skips the
// leading "#" index column when present so field mapping lines up.
function readTable(tableEl) {
  const trs = tableEl.querySelectorAll('tr');
  if (!trs.length) return null;
  const cellsOf = (tr) => tr.querySelectorAll('th,td').map(td => td.text.replace(/ /g, ' ').trim());
  let headerIdx = -1, headers = null;
  for (let i = 0; i < Math.min(trs.length, 4); i++) {
    const c = cellsOf(trs[i]).filter(x => x !== '');
    if (c.length >= 2) { headerIdx = i; headers = cellsOf(trs[i]); break; }
  }
  if (headerIdx < 0) return null;
  // Drop a leading "#" counter column (present on the call tables).
  const drop0 = normHead(headers[0]) === '#';
  const H = (drop0 ? headers.slice(1) : headers).map(normHead);
  const rows = [];
  const ROW_CAP = 15000;   // > VICIdial's 10k record limit; bounds memory per table
  for (let i = headerIdx + 1; i < trs.length && rows.length < ROW_CAP; i++) {
    let c = cellsOf(trs[i]);
    if (drop0) c = c.slice(1);
    if (!c.length || c.every(x => x === '')) continue;
    rows.push(c);
  }
  return { headers: H, rows };
}

// Signature match: does this table's header contain ALL of `must`?
const hasAll = (H, must) => must.every(m => H.includes(m));

// Map a table's rows to objects using a field→header spec.
function mapRows(table, spec) {
  const idx = {};
  for (const [field, head] of Object.entries(spec)) idx[field] = table.headers.indexOf(head);
  return table.rows.map(cells => {
    const o = {};
    for (const [field, i] of Object.entries(idx)) o[field] = i >= 0 ? (cells[i] ?? '') : '';
    return o;
  });
}

// Parse the whole user_stats.php page into the sections we care about.
function parseUserStats(html) {
  const root = parse(html, { blockTextElements: { script: false, style: false } });
  // Cap the number of tables scanned — a report has ~6 data tables; anything past
  // a generous ceiling is layout/nesting and only costs memory to walk.
  const tables = root.querySelectorAll('table').slice(0, 80).map(readTable).filter(Boolean);

  const out = {
    outbound_calls: [], manual_outbound: [], agent_activity: [],
    url_logins: [], status_summary: [],
  };

  for (const t of tables) {
    const H = t.headers;
    // Outbound Calls: length | status | phone | campaign | group | list | lead | hangup reason
    if (hasAll(H, ['phone', 'status', 'lead']) && (H.includes('hangup reason') || H.includes('list')) && H.includes('length')) {
      out.outbound_calls.push(...mapRows(t, {
        datetime: 'date/time', length: 'length', status: 'status', phone: 'phone',
        campaign: 'campaign', group: 'group', list: 'list', lead: 'lead', hangup: 'hangup reason',
      }));
      continue;
    }
    // Manual Outbound: call type | server | phone | dialed | lead | callerid | alias | preset | c3hu
    if (hasAll(H, ['phone', 'lead']) && (H.includes('call type') || H.includes('dialed'))) {
      out.manual_outbound.push(...mapRows(t, {
        datetime: 'date/time', call_type: 'call type', server: 'server', phone: 'phone',
        dialed: 'dialed', lead: 'lead', callerid: 'callerid', alias: 'alias', preset: 'preset',
      }));
      continue;
    }
    // Agent Activity: pause | wait | talk | dispo | dead | customer | … | status | lead | type | campaign | pause code
    if (hasAll(H, ['pause', 'wait', 'talk', 'dispo'])) {
      out.agent_activity.push(...mapRows(t, {
        datetime: 'date/time', pause: 'pause', wait: 'wait', talk: 'talk', dispo: 'dispo',
        dead: 'dead', customer: 'customer', status: 'status', lead: 'lead', type: 'type',
        campaign: 'campaign', pause_code: 'pause code',
      }));
      continue;
    }
    // Agent Talk Time and Status summary: status | count | hours:mm:ss
    if (hasAll(H, ['status', 'count']) && H.some(h => h.startsWith('hours'))) {
      const hoursHead = H.find(h => h.startsWith('hours'));
      out.status_summary.push(...mapRows(t, { status: 'status', count: 'count', duration: hoursHead }));
      continue;
    }
    // Agent Webserver and URL Logins: date | campaign | group | dialer server | web server | login url
    if (H.includes('login url') || hasAll(H, ['web server', 'dialer server'])) {
      out.url_logins.push(...mapRows(t, {
        date: 'date', campaign: 'campaign', group: 'group',
        dialer_server: 'dialer server', web_server: 'web server', login_url: 'login url',
      }));
      continue;
    }
  }

  // Numbers feed = the customer phones the agent actually dialed, richest-first.
  // Outbound Calls carry the disposition/status + list; Manual Outbound adds any
  // manual-only dials. Deduped by last-10 digits, keeping the outbound (status-
  // bearing) row when both exist.
  const byPhone = new Map();
  const push = (row, kind) => {
    const d = onlyDigits(row.phone);
    if (d.length < 7) return;
    const key = tail10(d);
    const cur = byPhone.get(key);
    const rec = {
      phone: d,
      status: (row.status || '').trim() || null,
      length: row.length != null && row.length !== '' ? (parseInt(row.length, 10) || 0) : null,
      list: (row.list || '').trim() || null,
      lead: onlyDigits(row.lead) || null,
      campaign: (row.campaign || '').trim() || null,
      group: (row.group || '').trim() || null,
      hangup: (row.hangup || '').trim() || null,
      datetime: (row.datetime || '').trim() || null,
      call_type: (row.call_type || '').trim() || (kind === 'manual' ? 'MANUAL' : 'AUTO'),
      source: kind,
    };
    // Prefer a row that has a real disposition status; else keep the first seen.
    if (!cur) byPhone.set(key, rec);
    else if (!cur.status && rec.status) byPhone.set(key, { ...rec, call_type: cur.call_type || rec.call_type });
  };
  out.outbound_calls.forEach(r => push(r, 'auto'));
  out.manual_outbound.forEach(r => push(r, 'manual'));
  out.numbers = [...byPhone.values()];

  out.counts = {
    numbers: out.numbers.length,
    outbound_calls: out.outbound_calls.length,
    manual_outbound: out.manual_outbound.length,
    agent_activity: out.agent_activity.length,
  };
  return out;
}

// Full pull for one agent: resolve box → fetch → parse. Returns a self-describing
// result (never throws) so a multi-agent pull can report per-agent success.
async function pullAgent({ agentId, boxId, beginDate, endDate, callStatus, archived, db }) {
  const agent = String(agentId || '').trim();
  if (!agent) return { agent, ok: false, error: 'Missing agent id' };
  const box = boxId ? boxById(boxId) : boxForAgent(agent);
  if (!box) return { agent, ok: false, error: boxId ? `Unknown box "${boxId}"` : `Can't resolve a dialer for "${agent}" — pick a box` };
  // The fetch (big buffer) + parse (DOM in memory) are the heavy part — run them
  // under the process-wide limiter so app-wide memory can't be swamped.
  await acquireSlot();
  try {
    const fetched = await fetchUserStatsHtml({ box, user: agent, beginDate, endDate, callStatus, archived, db });
    if (!fetched.ok) return { agent, box: box.id, ok: false, error: fetched.error };
    const sections = parseUserStats(fetched.html);
    return { agent, box: box.id, box_prefix: box.prefix, ok: true, ...sections };
  } catch (e) {
    logger.warn('VICI_STATS', `pull failed for ${agent}@${box.id}: ${e.message}`);
    return { agent, box: box.id, ok: false, error: `Could not read the dialer report: ${e.message}` };
  } finally {
    releaseSlot();
  }
}

module.exports = {
  boxForAgent, boxById, getStatsAuth, setStatsAuth, authStatus,
  fetchUserStatsHtml, parseUserStats, pullAgent,
};
