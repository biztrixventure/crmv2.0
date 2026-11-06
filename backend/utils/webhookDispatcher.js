// ============================================================================
// utils/webhookDispatcher.js -- CRM events out to other apps (mig 348).
//
// Every 30s (utils/scheduler.js) one tick does three things:
//
//  1. PRODUCE. Read what happened since the last tick and put one outbox row
//     (integration_deliveries) per event per subscribed webhook.
//       policy_events (trigger-fed, mig 087)  -> sale.<event_type>
//       transfers (new rows)                  -> transfer.created
//     Where each source stopped is kept in integration_cursors as
//     (created_at, id), so a restart neither misses nor repeats an event. A
//     source with no cursor yet starts from NOW: switching this on never
//     floods a receiver with history. Rows younger than LAG_MS are left for
//     the next tick, so a transaction that commits a moment late (its
//     created_at is its start time) is still seen.
//     The cursor moves even when no webhook is listening, for the same reason.
//
//  2. DELIVER. POST each due row: JSON body, headers x-crm-event,
//     x-crm-delivery, x-crm-timestamp, x-crm-signature (hex HMAC-SHA256 of
//     "<timestamp>.<body>" with the webhook's secret). 2xx = delivered.
//     Anything else retries after 1m, 5m, 30m, 2h, 6h, 12h, then gives up
//     (next_attempt_at NULL). 10s timeout, 4 at a time.
//
//  3. PRUNE, hourly: outbox rows older than 14 days.
//
// Delivery is AT-LEAST-ONCE: payload.id is stable per event (pe_<policy event
// id>, tr_<transfer id>), so a receiver dedupes on it.
//
// Before migration 348 is applied: one warning, then every tick is a no-op.
// Env: WEBHOOK_DISPATCH_SECONDS (default 30; 0 = off).
// ============================================================================
const { supabaseAdmin } = require('../config/database');
const logger = require('./logger');
const { eventMatches, companyAllowed, sign, retryDelayMs, isMissingTable } = require('./integrations');
const { salesByIds, shapeTransfers, TRANSFER_COLS } = require('./extData');

const LAG_MS = 15_000;
const PAGE = 500;
const MAX_PAGES = 10;          // per source per tick
const SEND_BATCH = 50;         // due rows per tick
const CONCURRENCY = 4;
const TIMEOUT_MS = 10_000;
const KEEP_DAYS = 14;
const PRUNE_EVERY_MS = 60 * 60_000;

let _running = false;
let _warned = false;
let _lastPrune = 0;
let _last = null;

function interval() {
  const s = Number(process.env.WEBHOOK_DISPATCH_SECONDS ?? 30);
  return Number.isFinite(s) && s >= 0 ? s : 30;
}

/** true once the tables exist; warns once if they do not. */
async function ready() {
  const { error } = await supabaseAdmin.from('integration_webhooks').select('id').limit(1);
  if (!error) { _warned = false; return true; }
  if (isMissingTable(error)) {
    if (!_warned) logger.warn('WEBHOOKS', 'Connections tables missing: apply migration 348_connections.sql. Webhooks are off until then.');
    _warned = true;
    return false;
  }
  throw new Error(error.message);
}

async function activeWebhooks() {
  const { data, error } = await supabaseAdmin.from('integration_webhooks')
    .select('id, events, company_ids').eq('active', true);
  if (error) throw new Error(error.message);
  return data || [];
}

async function getCursor(name) {
  const { data, error } = await supabaseAdmin.from('integration_cursors').select('name, last_at, last_id').eq('name', name).maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data;
  // First run: start from now, no backfill.
  const row = { name, last_at: new Date().toISOString(), last_id: null };
  const { error: insErr } = await supabaseAdmin.from('integration_cursors').upsert(row, { onConflict: 'name', ignoreDuplicates: true });
  if (insErr) throw new Error(insErr.message);
  logger.info('WEBHOOKS', `${name}: cursor started at ${row.last_at} (no backfill)`);
  return null;
}

async function setCursor(name, lastAt, lastId) {
  const { error } = await supabaseAdmin.from('integration_cursors')
    .upsert({ name, last_at: lastAt, last_id: lastId }, { onConflict: 'name' });
  if (error) throw new Error(error.message);
}

/** Rows strictly after (last_at, last_id), older than LAG_MS, oldest first. */
async function readAfter(table, cols, cur) {
  const until = new Date(Date.now() - LAG_MS).toISOString();
  let q = supabaseAdmin.from(table).select(cols).lte('created_at', until)
    .order('created_at', { ascending: true }).order('id', { ascending: true }).limit(PAGE);
  if (cur.last_id) {
    q = q.or(`created_at.gt."${cur.last_at}",and(created_at.eq."${cur.last_at}",id.gt.${cur.last_id})`);
  } else {
    q = q.gt('created_at', cur.last_at);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

async function enqueue(rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabaseAdmin.from('integration_deliveries').insert(rows.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }
}

/** events [{ id, event, company_id, at, body }] -> outbox rows per matching webhook */
function fanOut(events, hooks) {
  const out = [];
  for (const ev of events) {
    for (const h of hooks) {
      if (!eventMatches(h.events, ev.event)) continue;
      if (!companyAllowed(h.company_ids, ev.company_id)) continue;
      out.push({ webhook_id: h.id, event: ev.event, payload: ev.body, next_attempt_at: new Date().toISOString() });
    }
  }
  return out;
}

async function produceSource(name, hooks, readPage, toEvents) {
  const cur = await getCursor(name);
  if (!cur) return 0;
  let { last_at, last_id } = cur;
  let queued = 0;
  for (let p = 0; p < MAX_PAGES; p++) {
    const rows = await readPage({ last_at, last_id });
    if (!rows.length) break;
    const events = hooks.length ? await toEvents(rows) : [];
    const outbox = fanOut(events, hooks);
    if (outbox.length) await enqueue(outbox);
    queued += outbox.length;
    const last = rows[rows.length - 1];
    last_at = last.created_at;
    last_id = last.id;
    await setCursor(name, last_at, last_id);
    if (rows.length < PAGE) break;
  }
  return queued;
}

async function produce(hooks) {
  const sales = await produceSource('policy_events', hooks,
    (cur) => readAfter('policy_events', 'id, sale_id, event_type, at, created_at', cur),
    async (rows) => {
      const sales = await salesByIds(rows.map((r) => r.sale_id));
      return rows.map((r) => {
        const sale = sales.get(r.sale_id) || null;
        return {
          event: `sale.${r.event_type}`,
          company_id: sale?.company?.id || null,
          body: { id: `pe_${r.id}`, event: `sale.${r.event_type}`, at: r.at, sale },
        };
      });
    });

  const transfers = await produceSource('transfers', hooks,
    (cur) => readAfter('transfers', TRANSFER_COLS, cur),
    async (rows) => {
      const shaped = await shapeTransfers(rows);
      return shaped.map((t) => ({
        event: 'transfer.created',
        company_id: t.company?.id || null,
        body: { id: `tr_${t.id}`, event: 'transfer.created', at: t.created_at, transfer: t },
      }));
    });
  return { sales, transfers };
}

// -- sending ------------------------------------------------------------------
async function post(hook, delivery) {
  const body = JSON.stringify(delivery.payload);
  const ts = String(Math.floor(Date.now() / 1000));
  const started = Date.now();
  try {
    const res = await fetch(hook.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'BizTrix-CRM-Webhooks/1',
        'x-crm-event': delivery.event,
        'x-crm-delivery': delivery.id,
        'x-crm-timestamp': ts,
        'x-crm-signature': sign(hook.secret, ts, body),
      },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let text = '';
    try { text = (await res.text()).slice(0, 300); } catch { /* ignore */ }
    return { ok: res.status >= 200 && res.status < 300, status: res.status, error: res.ok ? null : `HTTP ${res.status}${text ? ': ' + text : ''}`, ms: Date.now() - started };
  } catch (e) {
    const msg = e.name === 'TimeoutError' || e.name === 'AbortError' ? `timed out after ${TIMEOUT_MS / 1000}s` : (e.cause?.code || e.message);
    return { ok: false, status: null, error: String(msg).slice(0, 300), ms: Date.now() - started };
  }
}

/** Send one outbox row and record the outcome. Returns the result. */
async function attempt(delivery, hook) {
  const r = await post(hook, delivery);
  const now = new Date().toISOString();
  const attempts = (delivery.attempts || 0) + 1;
  const patch = r.ok
    ? { attempts, delivered_at: now, next_attempt_at: null, last_status: r.status, last_error: null }
    : (() => {
        const wait = retryDelayMs(attempts);
        return { attempts, next_attempt_at: wait == null ? null : new Date(Date.now() + wait).toISOString(), last_status: r.status, last_error: r.error };
      })();
  await supabaseAdmin.from('integration_deliveries').update(patch).eq('id', delivery.id);
  const hookPatch = r.ok
    ? { last_status: r.status, last_error: null, last_delivery_at: now, failing_since: null }
    : { last_status: r.status, last_error: r.error, last_delivery_at: now, ...(hook.failing_since ? {} : { failing_since: now }) };
  await supabaseAdmin.from('integration_webhooks').update(hookPatch).eq('id', hook.id);
  if (!r.ok) hook.failing_since = hook.failing_since || now;
  return { ...r, attempts, gave_up: !r.ok && patch.next_attempt_at == null };
}

async function deliverDue() {
  const { data, error } = await supabaseAdmin.from('integration_deliveries')
    .select('id, webhook_id, event, payload, attempts, next_attempt_at, integration_webhooks!inner(id, url, secret, active, failing_since)')
    .is('delivered_at', null)
    .not('next_attempt_at', 'is', null)
    .lte('next_attempt_at', new Date().toISOString())
    .eq('integration_webhooks.active', true)
    .order('next_attempt_at', { ascending: true })
    .limit(SEND_BATCH);
  if (error) throw new Error(error.message);
  const rows = data || [];
  const hooks = new Map();
  let ok = 0; let failed = 0;
  let i = 0;
  const worker = async () => {
    while (i < rows.length) {
      const d = rows[i++];
      // Claim it: push next_attempt_at out so an overlapping run skips it.
      const { data: claimed } = await supabaseAdmin.from('integration_deliveries')
        .update({ next_attempt_at: new Date(Date.now() + 5 * 60_000).toISOString() })
        .eq('id', d.id).eq('attempts', d.attempts || 0).is('delivered_at', null).select('id');
      if (!claimed || !claimed.length) continue;
      const hook = hooks.get(d.webhook_id) || d.integration_webhooks;
      hooks.set(d.webhook_id, hook);
      const r = await attempt(d, hook);
      if (r.ok) ok++; else failed++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));
  return { due: rows.length, ok, failed };
}

async function prune() {
  if (Date.now() - _lastPrune < PRUNE_EVERY_MS) return 0;
  _lastPrune = Date.now();
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400_000).toISOString();
  const { error, count } = await supabaseAdmin.from('integration_deliveries')
    .delete({ count: 'exact' }).lt('created_at', cutoff);
  if (error) logger.warn('WEBHOOKS', `prune failed: ${error.message}`);
  return count || 0;
}

/** One full tick. Never throws. */
async function runWebhookDispatch() {
  if (_running) return { skipped: 'already running' };
  _running = true;
  try {
    if (!(await ready())) return { skipped: 'migration 348 not applied' };
    const hooks = await activeWebhooks();
    const produced = await produce(hooks);
    const sent = await deliverDue();
    const pruned = await prune();
    _last = { at: new Date().toISOString(), hooks: hooks.length, produced, sent, pruned };
    if (produced.sales || produced.transfers || sent.due) {
      logger.info('WEBHOOKS', `queued ${produced.sales} sale + ${produced.transfers} transfer event(s); sent ${sent.ok}/${sent.due}${sent.failed ? `, ${sent.failed} failed (will retry)` : ''}`);
    }
    return _last;
  } catch (e) {
    logger.warn('WEBHOOKS', `dispatch error: ${e.message}`);
    return { error: e.message };
  } finally {
    _running = false;
  }
}

/** Queue a `ping` for one webhook and send it right now (ignores its event filter). */
async function sendPing(webhookId) {
  const { data: hook, error } = await supabaseAdmin.from('integration_webhooks')
    .select('id, url, secret, active, failing_since').eq('id', webhookId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!hook) return null;
  const payload = { id: `ping_${Date.now()}`, event: 'ping', at: new Date().toISOString(), message: 'Test from the CRM Connections screen' };
  const { data: d, error: insErr } = await supabaseAdmin.from('integration_deliveries')
    .insert({ webhook_id: hook.id, event: 'ping', payload, attempts: 0, next_attempt_at: null })
    .select('id, webhook_id, event, payload, attempts').single();
  if (insErr) throw new Error(insErr.message);
  // A ping is a one-shot test: next_attempt_at stays NULL, so a failure is
  // recorded but never retried.
  const r = await post(hook, d);
  const now = new Date().toISOString();
  await supabaseAdmin.from('integration_deliveries').update({
    attempts: 1, last_status: r.status, last_error: r.error, delivered_at: r.ok ? now : null,
  }).eq('id', d.id);
  await supabaseAdmin.from('integration_webhooks').update(r.ok
    ? { last_status: r.status, last_error: null, last_delivery_at: now, failing_since: null }
    : { last_status: r.status, last_error: r.error, last_delivery_at: now, ...(hook.failing_since ? {} : { failing_since: now }) }).eq('id', hook.id);
  return { delivery_id: d.id, ok: r.ok, status: r.status, error: r.error, ms: r.ms };
}

function lastDispatch() {
  return { everySeconds: interval(), last: _last };
}

module.exports = { runWebhookDispatch, sendPing, lastDispatch, webhookInterval: interval, fanOut };
