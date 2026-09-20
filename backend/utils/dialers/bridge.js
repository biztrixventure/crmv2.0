// ============================================================================
// dialers/bridge.js — run a canonical call through the CRM's existing engine.
//
// THE POINT OF THIS FILE IS THAT IT CONTAINS NO BUSINESS LOGIC.
//
// Transfer creation and disposition matching are years of hard-won rules: the
// 2-minute duplicate-webhook window, the recycled-lead xfer_seq, the
// hand-entered merge, stripBlank (a dialer blank means "no news", never "clear
// this"), the closer-side guard that stops a fronter being stamped as the
// closer of their own transfer, the queued-dispo reconcile, the <12s duplicate
// disposition_actions guard. Writing a second copy of that for CallTools would
// mean two implementations drifting apart, and the second one would relearn
// every bug the first one already fixed.
//
// So a CallTools event is translated into the parameters the VICIdial ingest
// handlers already take, and THOSE handlers run — in-process, with a synthetic
// req/res, never a loopback HTTP call (which would need a token, a port and a
// second trip through the firewall). The QA v2 ingest hook is run over the same
// synthetic response, so provider calls appear in the QA queue exactly like
// VICIdial ones.
//
// What this file does own:
//   • the canonical -> ingest parameter translation
//   • which handler a given event_type/leg goes to
//   • stamping the provider/account/call-id columns on what gets created
// ============================================================================

const logger = require('../logger');
const { supabaseAdmin } = require('../../config/database');
const { boxNamespace } = require('./accounts');

// Lazy requires: routes/vicidial.js pulls in half the CRM, and this module is
// required from a route that is itself required at boot. Same reason the QA2
// ingest hook requires resolveAgent lazily.
const handlers = () => require('../../routes/vicidial');
const qa2Hook = () => require('../../middleware/qa2VicidialIngestHook').qa2IngestHook;

// Canonical call -> the parameter names the ingest handlers read. These names
// are not an accident: they are the VICIdial Dispo Call URL's token names, so
// the handlers need no translation layer of their own.
function toIngestParams(ev) {
  const c = ev.customer || {};
  const params = {
    agent: ev.agent || '',
    code: ev.code || '',
    alt_code: ev.code || '',
    phone: ev.phone || '',
    dispo: ev.dispo || '',
    talk_time: ev.talk_time == null ? '' : String(ev.talk_time),
    first: c.first || '', last: c.last || '',
    address: c.address || '', city: c.city || '', state: c.state || '', zip: c.zip || '',
    email: c.email || '', alt_phone: c.alt_phone || '', comments: c.comments || '',
    list_id: c.list_id || '', campaign: c.campaign || '',
    car_make: c.car_make || '', car_model: c.car_model || '', car_year: c.car_year || '',
    term: ev.term || '',
    uniqueid: ev.external_call_id || '',
  };
  // Custom fields the dialer sends that the CRM has no column for travel as
  // they are; the fronter handler copies its tokens into form_data.dialer, so
  // they stay visible on the transfer and to QA without a schema change.
  for (const [k, v] of Object.entries(ev.extras || {})) {
    if (!(k in params)) params[k] = v;
  }
  return params;
}

// A response object with just enough of express's surface for the handlers and
// the QA2 hook (which wraps res.json). Nothing is written to a socket.
// `answered` settles when the handler actually responds. THAT is the
// completion signal the bridge waits on — see runHandler for why the handler's
// return value cannot be trusted.
function makeRes() {
  let settle;
  const answered = new Promise(resolve => { settle = resolve; });
  const r = { statusCode: 200, headersSent: false, body: null, locals: {}, answered };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; r.headersSent = true; settle(b); return r; };
  r.send = r.json;
  r.end = () => { settle(r.body); return r; };
  r.setHeader = () => r;
  r.set = () => r;
  return r;
}

function makeReq(account, ev, params, { ip, isXfer }) {
  return {
    method: 'POST',
    originalUrl: `/api/dialer/hook/${account.provider}`,
    url: '/bridge',
    ip: ip || null,
    headers: {},
    query: {},
    body: params,
    // In-process only. A query string cannot set a property with this name on
    // the req object, so the XFER-gate verdict and the provider stamping can
    // never be driven from outside.
    __dialerBridge: true,
    __dialerXfer: !!isXfer,
    __dialerEvent: {
      provider: account.provider,
      account_id: account.id,
      box_id: boxNamespace(account),
      external_call_id: ev.external_call_id || null,
      recording_url: ev.recording_url || null,
      recording_id: ev.recording_id || ev.external_call_id || null,
      call_at: ev.call_at || null,
      leg: ev.leg,
    },
  };
}

const runMiddleware = (mw, req, res) => new Promise((resolve, reject) => {
  try { mw(req, res, (err) => (err ? reject(err) : resolve())); } catch (e) { reject(e); }
});

// WAIT FOR THE RESPONSE, NOT FOR THE RETURN VALUE.
//
// asyncHandler (middleware/errorHandler.js) wraps the handler and returns
// UNDEFINED — it keeps the promise to itself so it can route a rejection to
// next(). So `Promise.resolve(fn(...))` resolves on the next microtask, long
// before the handler has touched the database. Measured in production: the
// transfer was created correctly but the bridge had already moved on, so the
// webhook answered `transfer_id: null`, the event log recorded no outcome, and
// — the part that actually matters — stampTransfer never ran, leaving a
// CallTools transfer labelled as a VICIdial one.
//
// The response IS the completion signal. The timeout is a backstop so a
// handler that never answers cannot hold a dialer's connection open.
const HANDLER_TIMEOUT_MS = 20000;

const runHandler = (fn, req, res) => new Promise((resolve, reject) => {
  let settled = false;
  const done = () => { if (!settled) { settled = true; resolve(); } };
  const fail = (e) => { if (!settled) { settled = true; reject(e); } };

  const timer = setTimeout(() => fail(new Error('the handler did not answer within 20s')), HANDLER_TIMEOUT_MS);
  if (timer.unref) timer.unref();
  res.answered.then(() => { clearTimeout(timer); done(); });

  try {
    const out = fn(req, res, (err) => { clearTimeout(timer); return err ? fail(err) : done(); });
    // A handler that DOES return its promise still reports failures this way;
    // success is only ever concluded from the response above.
    if (out && typeof out.then === 'function') out.then(() => {}, fail);
  } catch (e) { clearTimeout(timer); fail(e); }
});

// Mark what the event created with the dialer it came from. Best-effort and
// wrapped: before migration 320 these columns do not exist, and a webhook must
// never fail because a column is missing — the transfer itself is already
// correct without them.
async function stampTransfer(transferId, account, ev) {
  if (!transferId) return;
  try {
    const { error } = await supabaseAdmin.from('transfers').update({
      dialer_provider: account.provider,
      dialer_account_id: account.id,
      dialer_call_id: ev.external_call_id || null,
    }).eq('id', transferId);
    if (error && !/column|schema cache/i.test(error.message || '')) {
      logger.warn('DIALER_BRIDGE', `stamp transfer ${transferId}: ${error.message}`);
    }
  } catch { /* pre-320 — ignore */ }
}

/**
 * Run one canonical event.
 * @returns {{ status:number, body:object, route:string, transfer_id:string|null }}
 */
async function dispatch(account, ev, { ip } = {}) {
  const params = toIngestParams(ev);
  const leg = ev.leg === 'closer' ? 'closer' : 'fronter';
  const isXfer = ev.event_type === 'xfer';
  const qaOnly = ev.event_type === 'call' || ev.event_type === 'ignored' || !ev.ok;

  const req = makeReq(account, ev, params, { ip, isXfer });
  const res = makeRes();

  // The QA hook records EVERY ingested call, transfer or not — a non-transfer
  // dispo is still a real call a QA manager may want to pull up. It wraps
  // res.json, so it has to be installed before the handler answers.
  const source = leg === 'fronter' ? 'ingest_fronter' : 'ingest_closer';
  try {
    await runMiddleware(qa2Hook()(source), req, res);
  } catch (e) {
    logger.warn('DIALER_BRIDGE', `qa2 hook install failed: ${e.message}`);
  }

  let route = 'qa_only';
  if (!qaOnly) {
    const { fronterXferHandler, closerDispoHandler } = handlers();
    // A fronter leg goes to the transfer handler (which, for a non-transfer
    // disposition, declines at the gate exactly as it does for VICIdial); a
    // closer leg goes to the disposition matcher.
    route = leg === 'fronter' ? 'fronter_xfer' : 'closer_dispo';
    const fn = leg === 'fronter' ? fronterXferHandler : closerDispoHandler;
    await runHandler(fn, req, res);
  } else {
    // Nothing for the transfer engine to do — answer anyway so the QA hook
    // fires and the call is still recorded for review.
    res.json({ ok: true, qa_only: true, reason: ev.reason || ev.event_type });
  }

  const body = res.body || {};
  const transferId = body.transfer_id || null;
  if (transferId) await stampTransfer(transferId, account, ev);

  return { status: res.statusCode || 200, body, route, transfer_id: transferId };
}

module.exports = { dispatch, toIngestParams, makeReq, makeRes };
