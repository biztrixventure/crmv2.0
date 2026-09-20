// ============================================================================
// dialers/accounts.js — load, cache and guard a connected dialer.
//
// The webhook is a HOT PATH: a dialer fires it once per disposition for every
// agent on the floor, and a slow answer makes the dialer retry, which doubles
// the traffic. So the account (credentials + mapping + rules) is read once and
// held for a few seconds, exactly like hasPermission/isFeatureEnabled do in
// utils/cache.js. Any write through the admin route calls invalidate() — the
// TTL is a safety net, not the mechanism.
//
// Two secrets live on an account and neither ever reaches the browser in full:
//   webhook_token   IS the URL. Leaking it lets anyone post calls into the CRM.
//   webhook_secret  optional HMAC key. When present, a signature is REQUIRED —
//                   an account with a secret set can never be posted to
//                   unsigned, because "the secret is configured but the sender
//                   forgot to sign" is indistinguishable from an attacker.
// ============================================================================

const crypto = require('crypto');
const { supabaseAdmin } = require('../../config/database');
const logger = require('../logger');
const { getProvider } = require('./providers');

const TTL_MS = 15 * 1000;
const _byToken = new Map();   // webhook_token -> { row, until }
const _byId = new Map();      // id            -> { row, until }

function invalidate() { _byToken.clear(); _byId.clear(); }

function remember(row) {
  if (!row) return row;
  const until = Date.now() + TTL_MS;
  if (row.webhook_token) _byToken.set(row.webhook_token, { row, until });
  _byId.set(row.id, { row, until });
  return row;
}

async function byToken(token) {
  const t = String(token || '').trim();
  if (!t) return null;
  const hit = _byToken.get(t);
  if (hit && hit.until > Date.now()) return hit.row;
  const { data } = await supabaseAdmin.from('dialer_accounts').select('*').eq('webhook_token', t).maybeSingle();
  return remember(data || null);
}

async function byId(id) {
  if (!id) return null;
  const hit = _byId.get(id);
  if (hit && hit.until > Date.now()) return hit.row;
  const { data } = await supabaseAdmin.from('dialer_accounts').select('*').eq('id', id).maybeSingle();
  return remember(data || null);
}

async function listActive(provider) {
  let q = supabaseAdmin.from('dialer_accounts').select('*').eq('is_active', true);
  if (provider) q = q.eq('provider', provider);
  const { data } = await q;
  (data || []).forEach(remember);
  return data || [];
}

// A new URL secret. 32 bytes of hex is long enough that guessing it is not a
// threat model, and it is URL-safe with no escaping.
const newWebhookToken = () => crypto.randomBytes(32).toString('hex');

// Merge the provider preset UNDER whatever the account already has, so an
// account created from a preset and then edited never has its edits undone by
// a later preset change, and a field the operator has not touched still gets
// the preset's answer.
function withPreset(row) {
  if (!row) return row;
  const preset = getProvider(row.provider).preset || {};
  return {
    ...row,
    field_map: { ...(preset.field_map || {}), ...(row.field_map || {}) },
    settings: {
      ...(preset.settings || {}),
      ...(row.settings || {}),
      api: { ...(preset.api || {}), ...((row.settings || {}).api || {}) },
    },
    auth: { ...(preset.auth || {}), ...(row.auth || {}) },
    base_url: row.base_url || preset.base_url || '',
  };
}

// ── signatures ──────────────────────────────────────────────────────────────
// Providers disagree about how to sign a webhook, so accept the three shapes
// that cover nearly everything, all HMAC-SHA256 over the RAW body:
//   X-Signature: <hex>            (also X-Hub-Signature-256, X-Webhook-Signature)
//   X-Signature: sha256=<hex>
//   a plain shared secret in a header, when settings.signature.mode = 'plain'
const SIGNATURE_HEADERS = [
  'x-signature', 'x-webhook-signature', 'x-hub-signature-256',
  'x-calltools-signature', 'signature',
];

function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Returns { ok, reason }. Called only when the account HAS a webhook_secret.
function verifySignature(account, req) {
  const secret = account.webhook_secret;
  if (!secret) return { ok: true, reason: 'no secret configured' };

  const cfg = (account.settings || {}).signature || {};
  const headerName = String(cfg.header || '').toLowerCase();
  const names = headerName ? [headerName] : SIGNATURE_HEADERS;
  let sent = null;
  for (const n of names) {
    const v = req.headers[n];
    if (v) { sent = String(v).trim(); break; }
  }
  if (!sent) return { ok: false, reason: `no signature header (looked for ${names.join(', ')})` };

  // A shared secret sent verbatim — some dialers only offer a static header.
  if (cfg.mode === 'plain') {
    return timingSafeEqual(sent, secret)
      ? { ok: true, reason: 'plain secret matched' }
      : { ok: false, reason: 'plain secret mismatch' };
  }

  const raw = req.rawBody != null ? req.rawBody : JSON.stringify(req.body || {});
  const digest = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const bare = sent.replace(/^sha256=/i, '').trim();
  if (timingSafeEqual(bare, digest)) return { ok: true, reason: 'hmac matched' };
  // Base64 is the other common encoding of the same digest.
  const b64 = crypto.createHmac('sha256', secret).update(raw).digest('base64');
  if (timingSafeEqual(bare, b64)) return { ok: true, reason: 'hmac matched (base64)' };
  return { ok: false, reason: 'hmac mismatch' };
}

// ── masking ─────────────────────────────────────────────────────────────────
// What the admin UI is allowed to see. The webhook TOKEN is shown in full (it
// is the URL the operator has to paste into the dialer, and only a superadmin
// reaches this page), everything else is reduced to a tail so a screenshot
// cannot leak an API key.
const maskTail = (v) => {
  const s = String(v || '');
  if (!s) return '';
  return s.length <= 4 ? '••••' : `••••${s.slice(-4)}`;
};

function publicView(row, { includeToken = true } = {}) {
  if (!row) return null;
  const auth = { ...(row.auth || {}) };
  ['token', 'pass', 'password', 'key', 'secret'].forEach(k => { if (auth[k]) auth[k] = maskTail(auth[k]); });
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    company_id: row.company_id,
    prefix: row.prefix,
    base_url: row.base_url,
    auth,
    settings: row.settings || {},
    field_map: row.field_map || {},
    webhook_token: includeToken ? row.webhook_token : maskTail(row.webhook_token),
    has_secret: !!row.webhook_secret,
    is_active: row.is_active,
    last_event_at: row.last_event_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// The namespace a provider's clips live under in qa2_call.box_id. VICIdial rows
// keep their real box id ('wavetechpk'), so the two never collide and
// uq_qa2_call_recording (box_id, recording_id) keeps meaning what it meant.
const boxNamespace = (account) => `${account.provider}:${String(account.id).slice(0, 8)}`;
const isProviderBox = (boxId) => /^[a-z0-9_]+:[0-9a-f]{8}$/i.test(String(boxId || ''));

// Best-effort stamp so the UI can show "last heard from" without reading the
// event table. Never blocks the webhook.
function touch(accountId) {
  supabaseAdmin.from('dialer_accounts')
    .update({ last_event_at: new Date().toISOString() })
    .eq('id', accountId)
    .then(() => {}, (e) => logger.warn('DIALER_ACCT', `touch failed: ${e.message}`));
}

module.exports = {
  byToken, byId, listActive, invalidate, remember,
  withPreset, newWebhookToken, verifySignature, publicView, maskTail,
  boxNamespace, isProviderBox, touch,
};
