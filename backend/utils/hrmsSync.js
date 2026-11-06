// ============================================================================
// utils/hrmsSync.js -- approved CRM sales into the HRMS (hr.vertexpakistan.com)
// for agent sales incentives. DESIRED-STATE, like revenueSync.
//
// Every hour: every sale compliance approved (status closed_won, not
// superseded) from the 1st of last month to today is sent to the HRMS sales
// connector, credited to its closer and its fronter. The HRMS window rule does
// the rest: a sale that left closed_won (cancelled, chargeback, returned) is
// missing from the list, so the HRMS voids it; months whose payroll is
// approved there are never changed.
//
// People are matched by their VICIdial users, which are the HRMS SIP IDs: the
// dialer user on the deal first (sales.vicidial_agent for the closer,
// transfers.vicidial_agent for the fronter), then every id on the person's
// profile (user_profiles.vicidial_agent_ids). The HRMS takes the first that is
// one of its employees.
//
// One HRMS company per key. Every key receives every sale; each HRMS company
// credits only its own employees and reports the rest as "unknown", so a
// fronter in one company and a closer in another are both paid where they
// work.
//
// Where it goes (the "targets"), two sources, merged:
//   1. Outgoing links (mig 349, table outgoing_links, kind 'hrms_sales'),
//      set up by a superadmin under Admin -> System -> Connections ->
//      Outgoing links. Read on every run, so a link added there is used at
//      the next run with no restart. Disabled links are skipped.
//   2. Server settings (the original setup, still honoured):
//        HRMS_URL        https://hr.vertexpakistan.com
//        HRMS_API_KEYS   slug=key,slug=key   (one HRMS API key per HRMS
//                                             company, scope sales.write)
// A link that is in both (same URL and key) is sent once. Before migration
// 349 the table is missing: the push uses the server settings only and warns
// once. With no target at all a run is one tiny query and nothing else.
//
//   HRMS_SYNC_MINUTES  default 60; 0 turns the job off
// ============================================================================
const { supabaseAdmin } = require('../config/database');
const logger = require('./logger');
const { isMissingTable } = require('./integrations');

const TZ = 'Asia/Karachi';
const PAGE = 1000;
const CHUNK = 2000; // HRMS limit per call

function config() {
  const url = (process.env.HRMS_URL || '').replace(/\/+$/, '');
  const keys = (process.env.HRMS_API_KEYS || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const i = p.indexOf('=');
      return i > 0 ? { slug: p.slice(0, i).trim(), key: p.slice(i + 1).trim() } : null;
    })
    .filter((k) => k && k.key);
  const minutes = Number(process.env.HRMS_SYNC_MINUTES ?? 60);
  return { url, keys, minutes: Number.isFinite(minutes) ? minutes : 60, enabled: !!url && keys.length > 0 };
}

// YYYY-MM-DD in Pakistan time
function pkDay(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function windowNow() {
  const today = pkDay();
  const [y, m] = today.split('-').map(Number);
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  return { from: `${prev.y}-${String(prev.m).padStart(2, '0')}-01`, to: today };
}

const upper = (v) => (typeof v === 'string' && v.trim() ? v.trim().toUpperCase() : null);
const uniq = (list) => [...new Set(list.filter(Boolean))].slice(0, 10);

async function pageAll(build) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out;
  }
}

async function inChunks(ids, fn) {
  const out = [];
  for (let i = 0; i < ids.length; i += 150) out.push(...(await fn(ids.slice(i, i + 150))));
  return out;
}

/** The approved sales in the window, as HRMS sale items. */
async function collect(win) {
  const sales = await pageAll(() =>
    supabaseAdmin
      .from('sales')
      .select('id, sale_date, reference_no, closer_id, fronter_id, transfer_id, vicidial_agent, superseded_at')
      .eq('status', 'closed_won')
      .gte('sale_date', win.from)
      .lte('sale_date', win.to)
      .order('id'),
  );
  const live = sales.filter((s) => !s.superseded_at && s.sale_date);

  const transferIds = [...new Set(live.map((s) => s.transfer_id).filter(Boolean))];
  const transfers = transferIds.length
    ? await inChunks(transferIds, async (ids) => {
        const { data, error } = await supabaseAdmin.from('transfers').select('id, vicidial_agent').in('id', ids);
        if (error) throw new Error(error.message);
        return data || [];
      })
    : [];
  const fronterDialerUser = new Map(transfers.map((t) => [t.id, upper(t.vicidial_agent)]));

  const userIds = [...new Set(live.flatMap((s) => [s.closer_id, s.fronter_id]).filter(Boolean))];
  const profiles = userIds.length
    ? await inChunks(userIds, async (ids) => {
        const { data, error } = await supabaseAdmin.from('user_profiles').select('user_id, vicidial_agent_ids').in('user_id', ids);
        if (error) throw new Error(error.message);
        return data || [];
      })
    : [];
  const idsOf = new Map(profiles.map((p) => [p.user_id, (p.vicidial_agent_ids || []).map(upper)]));

  const items = [];
  let noAgent = 0;
  for (const s of live) {
    const closer = uniq([upper(s.vicidial_agent), ...(idsOf.get(s.closer_id) || [])]);
    const fronter = uniq([fronterDialerUser.get(s.transfer_id) || null, ...(idsOf.get(s.fronter_id) || [])]);
    if (!closer.length && !fronter.length) {
      noAgent++;
      continue;
    }
    const item = { externalRef: s.id, saleDate: String(s.sale_date).slice(0, 10), reference: s.reference_no || null };
    if (closer.length) item.closer = closer;
    if (fronter.length) item.fronter = fronter;
    items.push(item);
  }
  return { items, approved: live.length, noAgent };
}

// Split the window so no call carries more than CHUNK sales; each piece is
// its own window, so the HRMS voids correctly inside every piece.
function pieces(win, items) {
  const days = [];
  for (let d = new Date(win.from + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= win.to; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  const perDay = new Map(days.map((d) => [d, []]));
  for (const i of items) perDay.get(i.saleDate)?.push(i);
  const out = [];
  let cur = null;
  for (const d of days) {
    const list = perDay.get(d);
    if (cur && cur.items.length + list.length > CHUNK) {
      out.push(cur);
      cur = null;
    }
    if (!cur) cur = { from: d, to: d, items: [] };
    cur.to = d;
    cur.items.push(...list);
  }
  if (cur) out.push(cur);
  return out;
}

const SALES_PATH = '/api/v1/connect/crm/sales';
const LINK_KIND = 'hrms_sales';
const LINKS_MIGRATION = '349_outgoing_links.sql';
const LINKS_NOT_READY = 'Outgoing links are not set up yet: run migration 349';

/** One HTTP call to the HRMS sales connector. Never throws on an HTTP status. */
async function request(url, key, body, timeoutMs = 60_000) {
  const res = await fetch(url + SALES_PATH, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: res.status, ok: res.ok, json, text };
}

async function post(url, key, body) {
  const r = await request(url, key, body);
  if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + ((r.json && r.json.message) || r.text.slice(0, 200)));
  return r.json;
}

// -- targets --------------------------------------------------------------------

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * The base address of an HRMS, cleaned: https only (http only for localhost),
 * no username/password, no query or #fragment, no trailing slash. Throws an
 * Error whose message can be shown to the operator.
 */
function normalizeHrmsUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) throw new Error('url is required, e.g. https://hr.vertexpakistan.com');
  let u;
  try { u = new URL(raw); } catch { throw new Error('url must be a full address, e.g. https://hr.vertexpakistan.com'); }
  const local = LOCAL_HOSTS.has(u.hostname.toLowerCase());
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) {
    throw new Error('url must start with https:// (http:// only for localhost)');
  }
  if (u.username || u.password) throw new Error('url must not contain a username or password');
  if (u.search || u.hash) throw new Error('url must not contain ? or #');
  const path = u.pathname.replace(/\/+$/, '');
  return (u.protocol + '//' + u.host + path);
}

/** Same address + same key = same HRMS company: send once. */
function targetKey(url, key) {
  return String(url || '').replace(/\/+$/, '').toLowerCase() + '\u0000' + String(key || '');
}

/** Last 4 characters of a key, only when the key is long enough to spare them. */
function keyLast4(key) {
  const k = typeof key === 'string' ? key.trim() : '';
  return k.length >= 12 ? k.slice(-4) : '';
}

/** A web link as the screen may see it: never the key. */
function redactLink(row) {
  if (!row) return row;
  const { api_key: apiKey, ...rest } = row;
  return { ...rest, source: 'web', hasKey: !!(apiKey && String(apiKey).trim()), key_last4: keyLast4(apiKey) };
}

/** HRMS_URL + HRMS_API_KEYS as targets. */
function envTargets(cfg = config()) {
  if (!cfg.url) return [];
  return cfg.keys.map((k) => ({ source: 'env', slug: k.slug, name: k.slug, url: cfg.url, key: k.key }));
}

/**
 * Pure. Enabled web links + env keys -> the list to send to, one entry per
 * distinct (url, key). Each entry: { name, url, key, ids (web link ids),
 * slugs (env slugs), sources }.
 */
function mergeTargets(webRows, envList) {
  const out = [];
  const byKey = new Map();
  const add = (t) => {
    const k = targetKey(t.url, t.key);
    let cur = byKey.get(k);
    if (!cur) {
      cur = { name: t.name, url: t.url.replace(/\/+$/, ''), key: t.key, ids: [], slugs: [], sources: [] };
      byKey.set(k, cur);
      out.push(cur);
    }
    if (t.id) cur.ids.push(t.id);
    if (t.slug) cur.slugs.push(t.slug);
    if (!cur.sources.includes(t.source)) cur.sources.push(t.source);
  };
  for (const r of webRows || []) {
    if (!r || r.enabled === false) continue;
    const key = typeof r.api_key === 'string' ? r.api_key.trim() : '';
    const url = typeof r.url === 'string' ? r.url.trim() : '';
    if (!key || !url) continue;
    add({ source: 'web', id: r.id, name: r.name || url, url, key });
  }
  for (const e of envList || []) {
    if (!e || !e.url || !e.key) continue;
    add({ source: 'env', slug: e.slug, name: e.slug, url: e.url, key: e.key });
  }
  return out;
}

let _warnedMissing = false;

/**
 * The HRMS links saved on screen (with keys: server use only).
 * { ready: false } before migration 349. Never throws: a read error is logged
 * and treated as "no web links", so the env targets still get their push.
 */
async function loadWebLinks() {
  try {
    const { data, error } = await supabaseAdmin
      .from('outgoing_links')
      .select('id, name, url, api_key, enabled')
      .eq('kind', LINK_KIND);
    if (error) {
      if (isMissingTable(error)) {
        if (!_warnedMissing) {
          _warnedMissing = true;
          logger.warn('HRMS', 'outgoing_links table missing (run migration 349): using HRMS_URL / HRMS_API_KEYS only');
        }
        return { ready: false, rows: [] };
      }
      logger.warn('HRMS', 'could not read outgoing links: ' + error.message);
      return { ready: true, rows: [], error: error.message };
    }
    _warnedMissing = false;
    return { ready: true, rows: data || [] };
  } catch (e) {
    logger.warn('HRMS', 'could not read outgoing links: ' + e.message);
    return { ready: true, rows: [], error: e.message };
  }
}

async function resolveTargets() {
  const web = await loadWebLinks();
  return { ready: web.ready, targets: mergeTargets(web.rows, envTargets()) };
}

/** Write each web link's result; failures only log. */
async function saveResults(perTarget, at) {
  for (const { target, result } of perTarget) {
    for (const id of target.ids) {
      try {
        const { error } = await supabaseAdmin
          .from('outgoing_links')
          .update({ last_run_at: at, last_result: result })
          .eq('id', id);
        if (error) logger.warn('HRMS', 'could not save link result: ' + error.message);
      } catch (e) {
        logger.warn('HRMS', 'could not save link result: ' + e.message);
      }
    }
  }
}

let _running = false;
let _last = null;

/**
 * One full push to every target. Safe to call any time. Returns
 * { at, ms, window, approved, sent, noAgent, companies, links } where
 * companies is keyed by env slug / link name (as before) and links has one
 * entry per target: { name, url, ids, slugs, sources, result }.
 */
async function pushSalesToHrms() {
  if (_running) return { skipped: 'already running' };
  _running = true;
  const started = Date.now();
  try {
    const { targets } = await resolveTargets();
    if (!targets.length) {
      return { skipped: 'no HR links: add one under Connections -> Outgoing links (or set HRMS_URL and HRMS_API_KEYS)' };
    }
    const win = windowNow();
    const { items, approved, noAgent } = await collect(win);
    const parts = pieces(win, items);
    const companies = {};
    const links = [];
    const perTarget = [];
    for (const t of targets) {
      const sum = { received: 0, inserted: 0, updated: 0, unchanged: 0, voided: 0, locked: 0, unknown: 0 };
      let result;
      try {
        for (const p of parts) {
          const r = await post(t.url, t.key, {
            context: '',
            window: { from: p.from, to: p.to },
            accounts: { system: 'vicidial', context: '' },
            items: p.items,
          });
          for (const k of ['received', 'inserted', 'updated', 'unchanged', 'voided', 'locked']) sum[k] += Number((r && r[k]) || 0);
          sum.unknown += Array.isArray(r && r.unknown) ? r.unknown.length : Number((r && r.unknown) || 0);
        }
        result = sum;
      } catch (e) {
        result = { error: e.message };
        logger.warn('HRMS', 'sales push to ' + t.name + ' failed: ' + e.message);
      }
      let label = t.slugs[0] || t.name;
      for (let n = 2; Object.prototype.hasOwnProperty.call(companies, label); n++) label = (t.slugs[0] || t.name) + ' (' + n + ')';
      companies[label] = result;
      links.push({ name: t.name, url: t.url, ids: t.ids, slugs: t.slugs, sources: t.sources, result });
      perTarget.push({ target: t, result: { ...result, approved, sent: items.length, noAgent, window: win } });
    }
    const at = new Date().toISOString();
    await saveResults(perTarget, at);
    _last = { at, ms: Date.now() - started, window: win, approved, sent: items.length, noAgent, companies, links };
    logger.info('HRMS', 'sales push ' + win.from + '..' + win.to + ': ' + approved + ' approved, ' + items.length + ' sent, ' + noAgent + ' with no dialer user | ' +
      Object.entries(companies).map(([s, r]) => s + ' ' + (r.error ? 'ERROR ' + r.error : '+' + r.inserted + ' ~' + r.updated + ' -' + r.voided + ' (' + r.unknown + ' not employees)')).join(' | '));
    return _last;
  } finally {
    _running = false;
  }
}

/**
 * Connection test: an EMPTY sales list with NO window. The HRMS only voids
 * when a window is given, and an empty list inserts nothing, so this changes
 * nothing on the HRMS side. 200 = connected, 401 = wrong key, 403 = the key
 * lacks sales.write.
 */
async function testHrmsLink(url, key) {
  const started = Date.now();
  try {
    const r = await request(url, key, { context: '', items: [] }, 15_000);
    const ms = Date.now() - started;
    const detail = (r.json && r.json.message) || (r.ok ? '' : r.text.slice(0, 200));
    if (r.ok) return { ok: true, status: r.status, ms, result: 'connected', message: 'Connected' };
    if (r.status === 401) return { ok: false, status: 401, ms, result: 'wrong_key', message: 'The HR system did not accept this key (wrong or revoked key)' };
    if (r.status === 403) return { ok: false, status: 403, ms, result: 'no_permission', message: 'The key works but lacks the sales.write permission' };
    if (r.status === 404) return { ok: false, status: 404, ms, result: 'not_found', message: 'Nothing answers at this address: check the HR URL' };
    return { ok: false, status: r.status, ms, result: 'error', message: 'HTTP ' + r.status + (detail ? ': ' + detail : '') };
  } catch (e) {
    return { ok: false, status: null, ms: Date.now() - started, result: 'unreachable', message: 'Could not reach the HR system: ' + e.message };
  }
}

function lastHrmsPush() {
  const cfg = config();
  return { enabled: cfg.enabled, jobOn: cfg.minutes > 0, url: cfg.url || null, companies: cfg.keys.map((k) => k.slug), everyMinutes: cfg.minutes, last: _last, running: _running };
}

module.exports = {
  pushSalesToHrms, lastHrmsPush, hrmsConfig: config, testHrmsLink,
  // used by routes/connections.js and the tests
  LINK_KIND, LINKS_MIGRATION, LINKS_NOT_READY,
  normalizeHrmsUrl, keyLast4, redactLink, envTargets, mergeTargets, loadWebLinks, resolveTargets, targetKey,
};
