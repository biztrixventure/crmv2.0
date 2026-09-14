// ============================================================================
// utils/requestContext.js -- who is making this database write, and why.
//
// The HR / Accounting change record (mig 313, module_audit_log) is written by a
// database trigger, and a trigger cannot see Express's `req`. What it CAN see
// is the HTTP request PostgREST received: PostgREST exposes the request headers
// to SQL as the `request.headers` setting. So the backend carries the actor
// with the request instead of in a column:
//
//   authMiddleware  -> runWithContext({ actorId, source: 'api' }, next)
//   a route handler -> setChangeReason('annual raise')        (optional)
//   supabaseAdmin   -> contextFetch() stamps x-actor-id / x-change-reason-b64 /
//                      x-change-source on every PostgREST call made while that
//                      request is being served
//   fn_module_audit -> reads them back                         (mig 313)
//
// AsyncLocalStorage is what makes "while that request is being served" true
// across awaits without threading `req` through 119 call sites -- the reason
// this is not a helper every route has to remember to call.
//
// Outside a request (boot, scheduler) there is no store and the fetch passes
// straight through; jobs that write audited tables wrap themselves in
// runWithContext({ source: 'job:<name>' }) so their rows say where they came
// from.
//
// Only the backend holds the service-role key, so these headers cannot be
// forged by a browser: a client talking to PostgREST directly with the anon
// key has no write access to any audited table.
// ============================================================================
const { AsyncLocalStorage } = require('node:async_hooks');

const als = new AsyncLocalStorage();

const runWithContext = (ctx, fn) => als.run({ ...(ctx || {}) }, fn);

const getContext = () => als.getStore() || null;

// Attach a "why" to every write made for the rest of this request. The trigger
// stores it next to the change. Empty clears it.
const setChangeReason = (reason) => {
  const store = als.getStore();
  if (!store) return;
  const r = reason == null ? '' : String(reason).trim();
  store.reason = r ? r.slice(0, 1000) : null;
};

// Scoped variant for one block of writes inside a longer request.
const withChangeReason = async (reason, fn) => {
  const store = als.getStore();
  const prev = store ? store.reason : undefined;
  setChangeReason(reason);
  try {
    return await fn();
  } finally {
    if (store) store.reason = prev;
  }
};

// The fetch handed to supabaseAdmin. supabase-js has already built a Headers
// object by the time this runs (fetchWithAuth), so copy it and add to it.
// Header values must be ISO-8859-1, which is why the reason travels base64 --
// an Urdu note would otherwise throw inside fetch.
const contextFetch = (input, init = {}) => {
  const store = als.getStore();
  if (!store || (!store.actorId && !store.reason && !store.source)) {
    return fetch(input, init);
  }
  const headers = new Headers(init.headers || undefined);
  if (store.actorId) headers.set('x-actor-id', String(store.actorId));
  if (store.source)  headers.set('x-change-source', String(store.source).slice(0, 60));
  if (store.reason)  headers.set('x-change-reason-b64', Buffer.from(store.reason, 'utf8').toString('base64'));
  return fetch(input, { ...init, headers });
};

// Refuse a sensitive change that arrived without a "why" -- pay, a correction
// to someone else's attendance, a deletion. Returns true when it has already
// answered, so a route reads:  if (needReason(req, res, 'changing pay')) return;
// `needs_reason` tells the frontend (api/client.js) to ask the person and
// resend the same request with change_reason attached.
const needReason = (req, res, what) => {
  const why = req.body?.change_reason ?? req.query?.change_reason;
  if (why && String(why).trim()) return false;
  res.status(400).json({ error: 'Please say why you are ' + what + '. It is kept in the record history.', needs_reason: true });
  return true;
};

module.exports = { runWithContext, getContext, setChangeReason, withChangeReason, contextFetch, needReason };
