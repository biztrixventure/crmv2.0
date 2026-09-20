// ============================================================================
// dialerHooks.js — the ONE public URL any dialer can be pointed at.
//
//   POST|GET  /api/dialer/hook/:token
//
// :token is dialer_accounts.webhook_token, so the URL itself names the account,
// carries its own secret, and can be rotated per dialer without touching a
// shared env value. (The VICIdial boxes keep using /api/vicidial/* with
// VICIDIAL_INGEST_TOKEN — nothing about that path changes.)
//
// THREE RULES THIS ROUTE LIVES BY
//
// 1. ANSWER FAST AND ANSWER 200. A dialer that gets a 4xx/5xx retries, often
//    immediately and often for ever. An event this CRM cannot use — unmapped
//    agent, half-finished mapping, disposition on the ignore list — is
//    RECORDED and answered 200 with a reason. The operator sees it in
//    Admin -> Dialers -> Events, which is also where they fix it. The only
//    non-200s are an unknown token (404) and a failed signature (401), because
//    both mean "you are not who this URL is for" and retrying cannot help.
//
// 2. EVERY HIT IS LOGGED, INCLUDING THE ONES THAT DID NOTHING. You cannot map a
//    payload you cannot see. The event log is the integration's debugger: it
//    holds the raw body, what the mapping made of it, and what the CRM then
//    did. It is pruned after 14 days (fn_prune_dialer_events) because it holds
//    customer detail.
//
// 3. THE CALL ITSELF IS NOT PROCESSED HERE. utils/dialers/bridge.js hands it to
//    the same transfer/disposition engine VICIdial calls go through. This file
//    only does: identify the account, check the signature, normalize, hand off,
//    log.
// ============================================================================

const express = require('express');
const logger = require('../utils/logger');
const { supabaseAdmin } = require('../config/database');
const accounts = require('../utils/dialers/accounts');
const { normalizeEvent } = require('../utils/dialers/normalize');
const { dispatch } = require('../utils/dialers/bridge');
const { resolveClientIp } = require('../utils/clientIp');

const router = express.Router();

// A ring buffer of the last hits, for the admin page's live strip — the same
// idea as vicidial.js's recentXfer/recentDispo, and for the same reason: the
// answer to "did my webhook arrive?" should not need a DB round trip or a
// server log.
const recent = [];
const REMEMBER = 200;

// Headers worth keeping. The whole header bag would store the signature and any
// bearer token the sender put on the request, which is exactly what should NOT
// be sitting in a table for 14 days.
const KEEP_HEADERS = ['content-type', 'user-agent', 'x-forwarded-for', 'x-request-id'];
function safeHeaders(req) {
  const out = {};
  for (const h of KEEP_HEADERS) if (req.headers[h]) out[h] = String(req.headers[h]).slice(0, 300);
  return out;
}

// Some dialers post JSON with a text/plain content type, and express hands that
// over as a string. Parse it rather than making the operator care.
function coerceBody(req) {
  if (typeof req.body === 'string' && req.body.trim().startsWith('{')) {
    try { req.body = JSON.parse(req.body); } catch { /* leave it */ }
  }
  if (!req.body || typeof req.body !== 'object') req.body = {};
  return req.body;
}

async function logEvent(row) {
  try {
    const { data, error } = await supabaseAdmin.from('dialer_webhook_events').insert(row).select('id').single();
    if (error) { logger.warn('DIALER_HOOK', `event log failed: ${error.message}`); return null; }
    return data?.id || null;
  } catch (e) {
    // A missing/again-migrating log table must never break ingestion.
    logger.warn('DIALER_HOOK', `event log failed: ${e.message}`);
    return null;
  }
}

function remember(entry) {
  recent.unshift(entry);
  if (recent.length > REMEMBER) recent.pop();
}

router.all('/hook/:token', async (req, res) => {
  const started = Date.now();
  const token = String(req.params.token || '').trim();
  const ip = resolveClientIp(req);
  coerceBody(req);

  const account = await accounts.byToken(token);
  if (!account) {
    // No account, so nothing to log against and nothing to tell the caller
    // beyond "this URL is not a thing" — a detailed answer here would let
    // someone probe for live tokens.
    logger.warn('DIALER_HOOK', `unknown webhook token from ${ip}`);
    return res.status(404).json({ ok: false, error: 'unknown webhook' });
  }

  const base = {
    account_id: account.id,
    provider: account.provider,
    method: req.method,
    source_ip: ip || null,
    headers: safeHeaders(req),
    payload: { ...(req.query || {}), ...(req.body || {}) },
  };

  // A signature is checked BEFORE anything else is believed about the payload.
  if (account.webhook_secret) {
    const sig = accounts.verifySignature(account, req);
    if (!sig.ok) {
      await logEvent({ ...base, status: 'rejected', outcome: `signature rejected — ${sig.reason}` });
      remember({ at: new Date().toISOString(), account: account.name, outcome: `signature rejected (${sig.reason})` });
      logger.warn('DIALER_HOOK', `${account.name}: signature rejected — ${sig.reason}`);
      return res.status(401).json({ ok: false, error: 'signature rejected' });
    }
  }

  if (!account.is_active) {
    await logEvent({ ...base, status: 'ignored', outcome: 'account is switched off' });
    return res.json({ ok: false, reason: 'account disabled' });
  }

  let ev = null;
  try {
    ev = normalizeEvent(account, req);
  } catch (e) {
    await logEvent({ ...base, status: 'error', error: e.message, outcome: 'mapping threw' });
    logger.error('DIALER_HOOK', `${account.name}: mapping threw — ${e.message}`);
    return res.json({ ok: false, reason: 'mapping error' });   // 200: a retry cannot fix a mapping
  }

  const summary = {
    event_type: ev.event_type, leg: ev.leg, agent: ev.agent, phone: ev.phone,
    dispo: ev.dispo, code: ev.code, call_id: ev.external_call_id,
    talk_time: ev.talk_time, recording: ev.recording_url ? 'yes' : 'no',
  };

  // A dry run maps and reports, and writes nothing. Handy when wiring a dialer
  // up: fire one real call with ?dry=1 on the end of the URL and read the
  // Events tab to see exactly what the CRM understood.
  const dry = String(req.query.dry || '') === '1';

  if (!ev.ok || dry) {
    const outcome = dry
      ? `DRY RUN — ${ev.reason || 'mapped, nothing written'}`
      : (ev.reason || 'not usable');
    await logEvent({
      ...base, event_type: dry ? ev.event_type : 'ignored', leg: ev.leg, normalized: summary,
      status: 'ignored', outcome, duration_ms: Date.now() - started,
    });
    remember({ at: new Date().toISOString(), account: account.name, outcome, ...summary });
    accounts.touch(account.id);
    return res.json({ ok: !!dry, dry_run: dry, reason: ev.reason || null, parsed: summary });
  }

  let result = null, error = null;
  try {
    result = await dispatch(account, ev, { ip });
  } catch (e) {
    error = e.message;
    logger.error('DIALER_HOOK', `${account.name}: dispatch failed — ${e.message}`);
  }

  const body = (result && result.body) || {};
  const outcome = error
    ? `error: ${error}`
    : [
        result.route,
        body.transfer_id ? `transfer ${body.transfer_id}` : null,
        body.queued ? 'queued for the closer' : null,
        body.sale_form_pending ? 'sale form pending' : null,
        body.duplicate ? 'duplicate webhook' : null,
        body.merged ? 'merged into a hand-entered transfer' : null,
        body.reason || null,
      ].filter(Boolean).join(' · ');

  const eventId = await logEvent({
    ...base,
    event_type: ev.event_type,
    leg: ev.leg,
    normalized: summary,
    status: error ? 'error' : 'accepted',
    error,
    outcome,
    transfer_id: body.transfer_id || null,
    duration_ms: Date.now() - started,
  });

  remember({ at: new Date().toISOString(), account: account.name, outcome, event_id: eventId, ...summary });
  accounts.touch(account.id);

  // Always 200 (see rule 1). The body still says what happened, for a dialer
  // whose automation log the operator can read.
  return res.json({ ok: !error, outcome, transfer_id: body.transfer_id || null, parsed: summary });
});

// Health/wiring check the operator can open in a browser or curl from the
// dialer host. It proves the URL, the token and the network path in one go,
// without creating anything.
router.get('/hook/:token/ping', async (req, res) => {
  const account = await accounts.byToken(String(req.params.token || '').trim());
  if (!account) return res.status(404).json({ ok: false, error: 'unknown webhook' });
  res.json({
    ok: true,
    account: account.name,
    provider: account.provider,
    active: account.is_active,
    signed: !!account.webhook_secret,
    last_event_at: account.last_event_at,
    hint: 'POST your dialer payload to this URL without /ping. Add ?dry=1 to map it without writing anything.',
  });
});

module.exports = { router, recent };
