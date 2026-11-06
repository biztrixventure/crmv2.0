// ============================================================================
// routes/connections.js -- the superadmin side of Connections (mig 348).
// Admin -> System -> Connections (components/Admin/Connections).
//
//   GET    /api/connections/catalog                 scopes, events, ready?, URLs
//   GET    /api/connections/keys                    list (never the key)
//   POST   /api/connections/keys                    create -> { key, secret } ONCE
//   POST   /api/connections/keys/:id/revoke         revoke (instant)
//   GET    /api/connections/webhooks                list (never the secret)
//   POST   /api/connections/webhooks                create -> { webhook, secret } ONCE
//   PATCH  /api/connections/webhooks/:id            name, url, events, company_ids, active
//   DELETE /api/connections/webhooks/:id            delete (its outbox goes too)
//   POST   /api/connections/webhooks/:id/rotate-secret   new secret, shown once
//   POST   /api/connections/webhooks/:id/test       send a `ping` now, return the result
//   GET    /api/connections/webhooks/:id/deliveries recent outbox rows
//   POST   /api/connections/deliveries/:id/retry    retry a failed / given-up row now
//
// Outgoing links (mig 349) -- the CRM -> HR sales push targets:
//   GET    /api/connections/links                   web links (never the key) + env ones (read-only)
//   POST   /api/connections/links                   { name, url, api_key, enabled }
//   PATCH  /api/connections/links/:id               name, url, enabled; api_key optional (absent = keep)
//   DELETE /api/connections/links/:id
//   POST   /api/connections/links/:id/test          no-op call to the HR system: connected / wrong key / no permission
//   POST   /api/connections/links/run               push approved sales to every HR link now
//
// Superadmin only (same gate as routes/hrmsSync.js). Every change is written
// to module_audit_log (module 'access') with secrets and hashes left out.
// Before migration 348: catalog says ready:false, everything else 503s.
// Before migration 349: /links lists the env targets with ready:false, writes
// 503 with "run migration 349".
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { isSuperAdmin } = require('../models/helpers');
const logger = require('../utils/logger');
const { integrationKey } = require('../middleware/integrationKey');
const {
  SCOPES, EVENTS, NOT_READY, MIGRATION, generateKey, hashKey, generateSecret,
  invalidScopes, invalidEventPatterns, isMissingTable,
} = require('../utils/integrations');
const { sendPing, lastDispatch } = require('../utils/webhookDispatcher');
const { externalUrls } = require('./externalModules');
const {
  pushSalesToHrms, lastHrmsPush, testHrmsLink, envTargets, redactLink, keyLast4, normalizeHrmsUrl, targetKey,
  LINK_KIND, LINKS_MIGRATION, LINKS_NOT_READY,
} = require('../utils/hrmsSync');

const router = express.Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_COLS = 'id, name, key_prefix, scopes, company_ids, created_by, created_at, last_used_at, revoked_at';
const HOOK_COLS = 'id, name, url, events, company_ids, active, created_by, created_at, last_status, last_error, last_delivery_at, failing_since';

router.use(async (req, res, next) => {
  try {
    if (!(await isSuperAdmin(req.user.id))) return res.status(403).json({ error: 'Superadmin access required' });
    next();
  } catch (e) {
    next(e);
  }
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch((e) => {
  if (e.notReady) return res.status(503).json({ error: e.notReadyMessage || NOT_READY, migration: e.migration || MIGRATION });
  if (e.status) return res.status(e.status).json({ error: e.message });
  next(e);
});

/** throw on a supabase error; a missing table becomes a 503 */
function check(error) {
  if (!error) return;
  if (isMissingTable(error)) throw Object.assign(new Error(NOT_READY), { notReady: true });
  throw new Error(error.message);
}

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

async function audit(req, table, recordId, operation, changes) {
  try {
    const { error } = await supabaseAdmin.from('module_audit_log').insert({
      module: 'access', company_id: null, table_name: table, record_id: recordId,
      operation, changes, changed_by: req.user.id, source: 'api',
    });
    if (error) logger.warn('CONNECTIONS', `audit write failed: ${error.message}`);
  } catch (e) {
    logger.warn('CONNECTIONS', `audit write failed: ${e.message}`);
  }
}

function companyIdsOf(v) {
  if (v == null) return null;   // every company
  if (!Array.isArray(v) || v.some((c) => !UUID.test(String(c)))) throw bad('company_ids must be null (all companies) or a list of company ids');
  return [...new Set(v)];
}

function name(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s || s.length > 100) throw bad('name is required (max 100 characters)');
  return s;
}

function webhookUrl(v) {
  let u;
  try { u = new URL(String(v || '').trim()); } catch { throw bad('url must be a full http(s) URL'); }
  if (!['https:', 'http:'].includes(u.protocol)) throw bad('url must start with https:// (or http:// for testing)');
  if (u.username || u.password) throw bad('url must not contain a username or password');
  return u.toString();
}

function eventsOf(v) {
  if (!Array.isArray(v) || !v.length) throw bad('pick at least one event');
  const badOnes = invalidEventPatterns(v);
  if (badOnes.length) throw bad(`unknown event(s): ${badOnes.join(', ')}`);
  return [...new Set(v)];
}

// -- catalog ------------------------------------------------------------------
router.get('/catalog', wrap(async (req, res) => {
  const { error } = await supabaseAdmin.from('integration_keys').select('id').limit(1);
  const ready = !error;
  if (error && !isMissingTable(error)) throw new Error(error.message);
  res.json({
    ready, migration: MIGRATION,
    scopes: SCOPES, events: EVENTS,
    api_base: '/api/ext/v1',
    external: externalUrls(),
    dispatcher: lastDispatch(),
  });
}));

// -- keys ---------------------------------------------------------------------
router.get('/keys', wrap(async (req, res) => {
  const { data, error } = await supabaseAdmin.from('integration_keys').select(KEY_COLS).order('created_at', { ascending: false });
  check(error);
  res.json({ keys: data || [] });
}));

router.post('/keys', wrap(async (req, res) => {
  const b = req.body || {};
  const scopes = Array.isArray(b.scopes) ? [...new Set(b.scopes)] : [];
  if (!scopes.length) throw bad('pick at least one scope');
  const badOnes = invalidScopes(scopes);
  if (badOnes.length) throw bad(`unknown scope(s): ${badOnes.join(', ')}`);
  const secret = generateKey();
  const row = {
    name: name(b.name), key_prefix: secret.slice(0, 8), key_hash: hashKey(secret),
    scopes, company_ids: companyIdsOf(b.company_ids), created_by: req.user.id,
  };
  const { data, error } = await supabaseAdmin.from('integration_keys').insert(row).select(KEY_COLS).single();
  check(error);
  await audit(req, 'integration_keys', data.id, 'INSERT', { snapshot: data });
  res.status(201).json({ key: data, secret });
}));

router.post('/keys/:id/revoke', wrap(async (req, res) => {
  if (!UUID.test(req.params.id)) throw bad('bad id');
  const { data, error } = await supabaseAdmin.from('integration_keys')
    .update({ revoked_at: new Date().toISOString() }).eq('id', req.params.id).is('revoked_at', null).select(KEY_COLS);
  check(error);
  if (!data || !data.length) return res.status(404).json({ error: 'Key not found or already revoked' });
  integrationKey.clear();
  await audit(req, 'integration_keys', data[0].id, 'UPDATE', { revoked_at: { old: null, new: data[0].revoked_at } });
  res.json({ key: data[0] });
}));

// -- webhooks -----------------------------------------------------------------
router.get('/webhooks', wrap(async (req, res) => {
  const { data, error } = await supabaseAdmin.from('integration_webhooks').select(HOOK_COLS).order('created_at', { ascending: false });
  check(error);
  res.json({ webhooks: data || [] });
}));

router.post('/webhooks', wrap(async (req, res) => {
  const b = req.body || {};
  const secret = generateSecret();
  const row = {
    name: name(b.name), url: webhookUrl(b.url), events: eventsOf(b.events),
    company_ids: companyIdsOf(b.company_ids), active: b.active !== false, secret, created_by: req.user.id,
  };
  const { data, error } = await supabaseAdmin.from('integration_webhooks').insert(row).select(HOOK_COLS).single();
  check(error);
  await audit(req, 'integration_webhooks', data.id, 'INSERT', { snapshot: data });
  res.status(201).json({ webhook: data, secret });
}));

router.patch('/webhooks/:id', wrap(async (req, res) => {
  if (!UUID.test(req.params.id)) throw bad('bad id');
  const b = req.body || {};
  const patch = {};
  if (b.name !== undefined) patch.name = name(b.name);
  if (b.url !== undefined) patch.url = webhookUrl(b.url);
  if (b.events !== undefined) patch.events = eventsOf(b.events);
  if (b.company_ids !== undefined) patch.company_ids = companyIdsOf(b.company_ids);
  if (b.active !== undefined) {
    patch.active = !!b.active;
    if (patch.active) patch.failing_since = null;
  }
  if (!Object.keys(patch).length) throw bad('nothing to change');
  const { data: before, error: e1 } = await supabaseAdmin.from('integration_webhooks').select(HOOK_COLS).eq('id', req.params.id).maybeSingle();
  check(e1);
  if (!before) return res.status(404).json({ error: 'Webhook not found' });
  const { data, error } = await supabaseAdmin.from('integration_webhooks').update(patch).eq('id', req.params.id).select(HOOK_COLS).single();
  check(error);
  const changes = {};
  for (const k of Object.keys(patch)) {
    if (JSON.stringify(before[k]) !== JSON.stringify(data[k])) changes[k] = { old: before[k], new: data[k] };
  }
  if (Object.keys(changes).length) await audit(req, 'integration_webhooks', data.id, 'UPDATE', changes);
  res.json({ webhook: data });
}));

router.delete('/webhooks/:id', wrap(async (req, res) => {
  if (!UUID.test(req.params.id)) throw bad('bad id');
  const { data, error } = await supabaseAdmin.from('integration_webhooks').delete().eq('id', req.params.id).select(HOOK_COLS);
  check(error);
  if (!data || !data.length) return res.status(404).json({ error: 'Webhook not found' });
  await audit(req, 'integration_webhooks', data[0].id, 'DELETE', { snapshot: data[0] });
  res.json({ deleted: true });
}));

router.post('/webhooks/:id/rotate-secret', wrap(async (req, res) => {
  if (!UUID.test(req.params.id)) throw bad('bad id');
  const secret = generateSecret();
  const { data, error } = await supabaseAdmin.from('integration_webhooks').update({ secret }).eq('id', req.params.id).select('id');
  check(error);
  if (!data || !data.length) return res.status(404).json({ error: 'Webhook not found' });
  await audit(req, 'integration_webhooks', data[0].id, 'UPDATE', { secret: { old: '(hidden)', new: '(rotated)' } });
  res.json({ secret });
}));

router.post('/webhooks/:id/test', wrap(async (req, res) => {
  if (!UUID.test(req.params.id)) throw bad('bad id');
  let r;
  try {
    r = await sendPing(req.params.id);
  } catch (e) {
    if (/does not exist|could not find the table/i.test(e.message)) throw Object.assign(new Error(NOT_READY), { notReady: true });
    throw e;
  }
  if (!r) return res.status(404).json({ error: 'Webhook not found' });
  res.json(r);
}));

router.get('/webhooks/:id/deliveries', wrap(async (req, res) => {
  if (!UUID.test(req.params.id)) throw bad('bad id');
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const { data, error } = await supabaseAdmin.from('integration_deliveries')
    .select('id, event, attempts, next_attempt_at, delivered_at, last_status, last_error, created_at, payload')
    .eq('webhook_id', req.params.id).order('created_at', { ascending: false }).limit(limit);
  check(error);
  // The payload only as far as the screen needs it: which record.
  const rows = (data || []).map(({ payload, ...d }) => ({
    ...d,
    event_id: payload?.id || null,
    record_id: payload?.sale?.id || payload?.transfer?.id || null,
    state: d.delivered_at ? 'delivered' : d.next_attempt_at ? (d.attempts ? 'retrying' : 'pending') : 'failed',
  }));
  res.json({ deliveries: rows });
}));

router.post('/deliveries/:id/retry', wrap(async (req, res) => {
  if (!UUID.test(req.params.id)) throw bad('bad id');
  const { data, error } = await supabaseAdmin.from('integration_deliveries')
    .update({ next_attempt_at: new Date().toISOString(), attempts: 0 })
    .eq('id', req.params.id).is('delivered_at', null).select('id');
  check(error);
  if (!data || !data.length) return res.status(404).json({ error: 'Delivery not found or already delivered' });
  res.json({ queued: true });
}));

// -- outgoing links (mig 349): CRM -> HR sales push ----------------------------
const LINK_COLS = 'id, kind, name, url, api_key, enabled, last_run_at, last_result, created_by, created_at, updated_at';

/** throw on a supabase error; a missing outgoing_links table becomes a 503 (349) */
function checkLinks(error) {
  if (!error) return;
  if (isMissingTable(error)) {
    throw Object.assign(new Error(LINKS_NOT_READY), { notReady: true, notReadyMessage: LINKS_NOT_READY, migration: LINKS_MIGRATION });
  }
  throw new Error(error.message);
}

function linkUrl(v) {
  try { return normalizeHrmsUrl(v); } catch (e) { throw bad(e.message); }
}

function linkKey(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw bad('api_key is required: create it in HR -> Admin -> Integrations -> CRM');
  if (s.length < 8 || s.length > 500 || /\s/.test(s)) throw bad('api_key does not look like an HR API key');
  return s;
}

/** What the audit log may keep about a link: no key, only whether it is set. */
const auditView = (row) => {
  const r = redactLink(row);
  delete r.last_result;
  return r;
};

router.get('/links', wrap(async (req, res) => {
  const { data, error } = await supabaseAdmin.from('outgoing_links').select(LINK_COLS)
    .eq('kind', LINK_KIND).order('created_at', { ascending: true });
  let ready = true;
  if (error) {
    if (!isMissingTable(error)) throw new Error(error.message);
    ready = false;
  }
  const rows = data || [];
  const webKeys = new Map(rows.filter((r) => r.enabled).map((r) => [targetKey(r.url, r.api_key), r.name]));
  const status = lastHrmsPush();
  const last = status.last;
  const web = rows.map(redactLink);
  const env = envTargets().map((t) => {
    const sentAs = webKeys.get(targetKey(t.url, t.key)) || null;
    const run = last && last.links ? last.links.find((l) => l.slugs.includes(t.slug)) : null;
    return {
      id: `env:${t.slug}`, source: 'env', readonly: true, kind: LINK_KIND,
      name: t.slug, url: t.url, enabled: true,
      hasKey: !!t.key, key_last4: keyLast4(t.key),
      same_as: sentAs,   // the web link it is merged with, if any (sent once)
      last_run_at: run ? last.at : null,
      last_result: run ? { ...run.result, approved: last.approved, sent: last.sent, noAgent: last.noAgent, window: last.window } : null,
    };
  });
  res.json({
    ready, migration: LINKS_MIGRATION,
    links: [...web, ...env],
    everyMinutes: status.everyMinutes, jobOn: status.jobOn, running: status.running,
    lastRun: last ? { at: last.at, ms: last.ms, window: last.window, approved: last.approved, sent: last.sent, noAgent: last.noAgent } : null,
  });
}));

router.post('/links', wrap(async (req, res) => {
  const b = req.body || {};
  const row = {
    kind: LINK_KIND, name: name(b.name), url: linkUrl(b.url), api_key: linkKey(b.api_key),
    enabled: b.enabled !== false, created_by: req.user.id,
  };
  const { data, error } = await supabaseAdmin.from('outgoing_links').insert(row).select(LINK_COLS).single();
  checkLinks(error);
  await audit(req, 'outgoing_links', data.id, 'INSERT', { snapshot: auditView(data) });
  res.status(201).json({ link: redactLink(data) });
}));

router.patch('/links/:id', wrap(async (req, res) => {
  if (!UUID.test(req.params.id)) throw bad('bad id');
  const b = req.body || {};
  const patch = {};
  if (b.name !== undefined) patch.name = name(b.name);
  if (b.url !== undefined) patch.url = linkUrl(b.url);
  if (b.api_key !== undefined && b.api_key !== null && String(b.api_key).trim() !== '') patch.api_key = linkKey(b.api_key);
  if (b.enabled !== undefined) patch.enabled = !!b.enabled;
  if (!Object.keys(patch).length) throw bad('nothing to change');
  patch.updated_at = new Date().toISOString();
  const { data: before, error: e1 } = await supabaseAdmin.from('outgoing_links').select(LINK_COLS)
    .eq('id', req.params.id).eq('kind', LINK_KIND).maybeSingle();
  checkLinks(e1);
  if (!before) return res.status(404).json({ error: 'Link not found' });
  const { data, error } = await supabaseAdmin.from('outgoing_links').update(patch).eq('id', req.params.id).select(LINK_COLS).single();
  checkLinks(error);
  const changes = {};
  for (const k of ['name', 'url', 'enabled']) {
    if (k in patch && before[k] !== data[k]) changes[k] = { old: before[k], new: data[k] };
  }
  if ('api_key' in patch && before.api_key !== data.api_key) changes.api_key = { old: '(hidden)', new: '(changed)' };
  if (Object.keys(changes).length) await audit(req, 'outgoing_links', data.id, 'UPDATE', changes);
  res.json({ link: redactLink(data) });
}));

router.delete('/links/:id', wrap(async (req, res) => {
  if (!UUID.test(req.params.id)) throw bad('bad id');
  const { data, error } = await supabaseAdmin.from('outgoing_links').delete()
    .eq('id', req.params.id).eq('kind', LINK_KIND).select(LINK_COLS);
  checkLinks(error);
  if (!data || !data.length) return res.status(404).json({ error: 'Link not found' });
  await audit(req, 'outgoing_links', data[0].id, 'DELETE', { snapshot: auditView(data[0]) });
  res.json({ deleted: true });
}));

router.post('/links/run', wrap(async (req, res) => {
  res.json(await pushSalesToHrms());
}));

router.post('/links/:id/test', wrap(async (req, res) => {
  if (!UUID.test(req.params.id)) throw bad('bad id');
  const { data, error } = await supabaseAdmin.from('outgoing_links').select('id, url, api_key')
    .eq('id', req.params.id).eq('kind', LINK_KIND).maybeSingle();
  checkLinks(error);
  if (!data) return res.status(404).json({ error: 'Link not found' });
  res.json(await testHrmsLink(data.url, data.api_key));
}));

module.exports = router;
