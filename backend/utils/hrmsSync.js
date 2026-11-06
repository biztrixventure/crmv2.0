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
// Env:
//   HRMS_URL        https://hr.vertexpakistan.com
//   HRMS_API_KEYS   slug=key,slug=key   (one HRMS API key per HRMS company,
//                                         scope sales.write)
//   HRMS_SYNC_MINUTES  default 60; 0 turns the job off
// Nothing runs unless both HRMS_URL and HRMS_API_KEYS are set.
// ============================================================================
const { supabaseAdmin } = require('../config/database');
const logger = require('./logger');

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

async function post(url, key, body) {
  const res = await fetch(url + '/api/v1/connect/crm/sales', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + ((json && json.message) || text.slice(0, 200)));
  return json;
}

let _running = false;
let _last = null;

/** One full push. Returns a summary per HRMS company. Safe to call any time. */
async function pushSalesToHrms() {
  const cfg = config();
  if (!cfg.enabled) return { skipped: 'HRMS_URL and HRMS_API_KEYS are not set' };
  if (_running) return { skipped: 'already running' };
  _running = true;
  const started = Date.now();
  try {
    const win = windowNow();
    const { items, approved, noAgent } = await collect(win);
    const parts = pieces(win, items);
    const companies = {};
    for (const { slug, key } of cfg.keys) {
      const sum = { received: 0, inserted: 0, updated: 0, unchanged: 0, voided: 0, locked: 0, unknown: 0 };
      try {
        for (const p of parts) {
          const r = await post(cfg.url, key, {
            context: '',
            window: { from: p.from, to: p.to },
            accounts: { system: 'vicidial', context: '' },
            items: p.items,
          });
          for (const k of ['received', 'inserted', 'updated', 'unchanged', 'voided', 'locked']) sum[k] += Number((r && r[k]) || 0);
          sum.unknown += Array.isArray(r && r.unknown) ? r.unknown.length : Number((r && r.unknown) || 0);
        }
        companies[slug] = sum;
      } catch (e) {
        companies[slug] = { error: e.message };
        logger.warn('HRMS', 'sales push to ' + slug + ' failed: ' + e.message);
      }
    }
    _last = { at: new Date().toISOString(), ms: Date.now() - started, window: win, approved, sent: items.length, noAgent, companies };
    logger.info('HRMS', 'sales push ' + win.from + '..' + win.to + ': ' + approved + ' approved, ' + items.length + ' sent, ' + noAgent + ' with no dialer user | ' +
      Object.entries(companies).map(([s, r]) => s + ' ' + (r.error ? 'ERROR ' + r.error : '+' + r.inserted + ' ~' + r.updated + ' -' + r.voided + ' (' + r.unknown + ' not employees)')).join(' | '));
    return _last;
  } finally {
    _running = false;
  }
}

function lastHrmsPush() {
  const cfg = config();
  return { enabled: cfg.enabled, url: cfg.url || null, companies: cfg.keys.map((k) => k.slug), everyMinutes: cfg.minutes, last: _last };
}

module.exports = { pushSalesToHrms, lastHrmsPush, hrmsConfig: config };
