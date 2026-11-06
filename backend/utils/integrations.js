// ============================================================================
// utils/integrations.js -- the pure parts of Connections (mig 348): keys,
// scopes, event names, signatures, retry schedule, paging. No database, no
// network, so every rule here is unit-tested (integrations.test.js).
//
// The moving parts that DO touch the database:
//   middleware/integrationKey.js   Bearer crm_... -> req.integration
//   routes/ext.js                  the machine API, /api/ext/v1
//   routes/connections.js          superadmin screen API, /api/connections
//   utils/webhookDispatcher.js     outbox producer + sender (scheduler, 30s)
//   utils/extData.js               the sale / transfer shapes both share
// ============================================================================
const crypto = require('crypto');

const MIGRATION = '348_connections.sql';
const NOT_READY = 'Connections are not set up yet: run migration 348';

// crm_ + 32 random bytes as base64url = 43 chars.
const KEY_PREFIX = 'crm_';
const KEY_RE = /^crm_[A-Za-z0-9_-]{43}$/;

const SCOPES = [
  { key: 'companies.read',     label: 'Read companies',             hint: 'GET /companies' },
  { key: 'agents.read',        label: 'Read agents',                hint: 'GET /agents: people, VICIdial users, memberships' },
  { key: 'sales.read',         label: 'Read sales',                 hint: 'GET /sales, no customer contact details' },
  { key: 'sales.read_pii',     label: 'Sales: customer name/phone', hint: 'Adds customer_name and customer_phone to /sales' },
  { key: 'transfers.read',     label: 'Read transfers',             hint: 'GET /transfers, no form data' },
  { key: 'transfers.read_pii', label: 'Transfers: form data',       hint: 'Adds form_data (customer details) to /transfers' },
  { key: 'metrics.write',      label: 'Push metrics',               hint: 'POST /metrics: scores, hours, ... per agent' },
];
const SCOPE_KEYS = new Set(SCOPES.map((s) => s.key));

// Every event a webhook can subscribe to. sale.<x> mirrors policy_events
// event_type (mig 087), so a new lifecycle type there needs a row here too.
const SALE_EVENT_TYPES = [
  'sold', 'submitted', 'approved', 'returned', 'cancelled', 'reinstated',
  'renewed', 'replaced', 'resold', 'superseded', 'expired', 'lost',
  'chargeback', 'charged', 'post_dated', 'dispute', 'refunded', 'note',
];
const EVENTS = [
  ...SALE_EVENT_TYPES.map((t) => ({ key: `sale.${t}`, group: 'sale' })),
  { key: 'transfer.created', group: 'transfer' },
  { key: 'ping', group: 'system' },
];
const EVENT_KEYS = new Set(EVENTS.map((e) => e.key));

// 1m, 5m, 30m, 2h, 6h, 12h -- about 21 hours of trying, then it gives up.
const RETRY_DELAYS_MS = [60e3, 5 * 60e3, 30 * 60e3, 2 * 3600e3, 6 * 3600e3, 12 * 3600e3];

function generateKey() {
  return KEY_PREFIX + crypto.randomBytes(32).toString('base64url');
}

function hashKey(key) {
  return crypto.createHash('sha256').update(String(key), 'utf8').digest('hex');
}

function looksLikeKey(key) {
  return typeof key === 'string' && KEY_RE.test(key);
}

/** The key from an Authorization header, or null. */
function bearerKey(header) {
  if (typeof header !== 'string') return null;
  const m = header.match(/^Bearer\s+(\S+)\s*$/i);
  return m ? m[1] : null;
}

function generateSecret() {
  return 'whsec_' + crypto.randomBytes(32).toString('base64url');
}

function hasScope(scopes, needed) {
  return Array.isArray(scopes) && scopes.includes(needed);
}

/** Unknown scopes, if any. */
function invalidScopes(list) {
  return (Array.isArray(list) ? list : []).filter((s) => !SCOPE_KEYS.has(s));
}

/** '*' matches all; 'sale.*' matches every sale.<x>; anything else is exact. */
function eventMatches(patterns, event) {
  if (!Array.isArray(patterns) || !event) return false;
  return patterns.some((p) => {
    if (typeof p !== 'string' || !p) return false;
    if (p === '*') return true;
    if (p.endsWith('.*')) return event.startsWith(p.slice(0, -1));
    return p === event;
  });
}

/** A subscription pattern is valid if it is '*', a known event, or <group>.* */
function invalidEventPatterns(list) {
  const groups = new Set(EVENTS.map((e) => e.group));
  return (Array.isArray(list) ? list : []).filter((p) => {
    if (p === '*' || EVENT_KEYS.has(p)) return false;
    if (typeof p === 'string' && p.endsWith('.*') && groups.has(p.slice(0, -2))) return false;
    return true;
  });
}

/** NULL company list = every company. */
function companyAllowed(companyIds, companyId) {
  if (companyIds == null) return true;
  return Array.isArray(companyIds) && companyIds.includes(companyId);
}

function sign(secret, timestamp, rawBody) {
  return crypto.createHmac('sha256', String(secret)).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex');
}

/** What a receiver runs. toleranceSec guards against replays. */
function verifySignature(secret, timestamp, rawBody, signature, { toleranceSec = 300, now = Date.now() } = {}) {
  if (!secret || !timestamp || typeof signature !== 'string') return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > toleranceSec) return false;
  const expected = sign(secret, timestamp, rawBody);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** ms until the next try after `attempts` failed tries; null = give up. */
function retryDelayMs(attempts) {
  if (!Number.isInteger(attempts) || attempts < 1) return RETRY_DELAYS_MS[0];
  return attempts <= RETRY_DELAYS_MS.length ? RETRY_DELAYS_MS[attempts - 1] : null;
}

/** The table does not exist yet (migration not applied). */
function isMissingTable(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const msg = String(error.message || '');
  return code === '42P01' || code === 'PGRST205'
    || /relation .* does not exist/i.test(msg) || /could not find the table/i.test(msg);
}

class NotReadyError extends Error {
  constructor() { super(NOT_READY); this.status = 503; }
}

// -- paging -------------------------------------------------------------------
const MAX_LIMIT = 1000;

function encodeCursor(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

function decodeCursor(str) {
  if (!str || typeof str !== 'string') return null;
  try {
    const o = JSON.parse(Buffer.from(str, 'base64url').toString('utf8'));
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

/** limit (1..1000, default 100), offset, cursor. Throws a 400-able message. */
function parsePaging(query = {}) {
  let limit = query.limit == null || query.limit === '' ? 100 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1) throw badRequest('limit must be an integer from 1 to 1000');
  limit = Math.min(limit, MAX_LIMIT);
  let offset = null;
  if (query.offset != null && query.offset !== '') {
    offset = Number(query.offset);
    if (!Number.isInteger(offset) || offset < 0) throw badRequest('offset must be a non-negative integer');
  }
  let cursor = null;
  if (query.cursor) {
    cursor = decodeCursor(query.cursor);
    if (!cursor) throw badRequest('cursor is not valid');
  }
  return { limit, offset, cursor };
}

function badRequest(msg) {
  const e = new Error(msg);
  e.status = 400;
  return e;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A date or timestamp query value, or throws 400. */
function parseTime(value, name) {
  if (value == null || value === '') return null;
  const s = String(value);
  if (ISO_DAY.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw badRequest(`${name} must be YYYY-MM-DD or an ISO timestamp`);
  return d.toISOString();
}

const upper = (v) => (typeof v === 'string' && v.trim() ? v.trim().toUpperCase() : null);

module.exports = {
  MIGRATION, NOT_READY, KEY_PREFIX, KEY_RE, SCOPES, SCOPE_KEYS, EVENTS, EVENT_KEYS, SALE_EVENT_TYPES,
  RETRY_DELAYS_MS, MAX_LIMIT,
  generateKey, hashKey, looksLikeKey, bearerKey, generateSecret,
  hasScope, invalidScopes, eventMatches, invalidEventPatterns, companyAllowed,
  sign, verifySignature, retryDelayMs, isMissingTable, NotReadyError,
  encodeCursor, decodeCursor, parsePaging, parseTime, badRequest, upper,
};
