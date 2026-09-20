// ============================================================================
// dialerAdmin.js — superadmin surface for the multi-dialer layer.
//
//   /api/dialer-admin/providers             what can be connected + field catalog
//   /api/dialer-admin/accounts              CRUD, rotate token, test the API
//   /api/dialer-admin/accounts/:id/agents   dialer agent id -> CRM user
//   /api/dialer-admin/accounts/:id/events   what the dialer actually sent
//   /api/dialer-admin/accounts/:id/fields   flattened keys from the last payloads
//   /api/dialer-admin/accounts/:id/test     map a sample payload, write nothing
//   /api/dialer-admin/events/:id/replay     run a logged payload through again
//
// THE FIELD PICKER IS THE POINT. Wiring a new dialer up by reading its docs and
// guessing JSON paths is how integrations end up half-mapped: nobody notices
// that `talk_time` never resolved until a month of QA rows have no duration. So
// the flow here is the other way round — point the dialer at the webhook, let
// one real call land, then map each canonical field by picking from the keys
// that call actually contained, with its real value shown next to it.
//
// /test and /replay exist for the same reason: you can see what a mapping WOULD
// do before anything is written, and re-run a real payload after fixing the
// mapping instead of waiting for the next live call.
//
// Superadmin only, like the VICIdial box registry it sits beside.
// ============================================================================

const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const { isSuperAdmin } = require('../models/helpers');
const accounts = require('../utils/dialers/accounts');
const { PROVIDERS, CANONICAL_FIELDS, getProvider } = require('../utils/dialers/providers');
const { flatten, TRANSFORM_NAMES } = require('../utils/dialers/mapping');
const { normalizeEvent, mappingGaps } = require('../utils/dialers/normalize');
const { dispatch } = require('../utils/dialers/bridge');
const { testConnection, recordingForCall } = require('../utils/dialers/client');
const { recent } = require('./dialerHooks');

const router = express.Router();

const superOnly = asyncHandler(async (req, res, next) => {
  if (!(await isSuperAdmin(req.user.id))) return res.status(403).json({ error: 'Superadmin access required' });
  next();
});
router.use(superOnly);

// ── what can be connected ───────────────────────────────────────────────────
router.get('/providers', asyncHandler(async (req, res) => {
  res.json({
    providers: Object.values(PROVIDERS).map(p => ({
      key: p.key, label: p.label, docs: p.docs, supports: p.supports,
      preset: { settings: p.preset.settings, auth: p.preset.auth, base_url: p.preset.base_url },
    })),
    fields: CANONICAL_FIELDS,
    transforms: TRANSFORM_NAMES,
  });
}));

// ── accounts ────────────────────────────────────────────────────────────────
router.get('/accounts', asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin.from('dialer_accounts').select('*').order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });

  const ids = [...new Set((data || []).map(a => a.company_id).filter(Boolean))];
  const names = {};
  if (ids.length) {
    const { data: co } = await supabaseAdmin.from('companies').select('id, name').in('id', ids);
    (co || []).forEach(c => { names[c.id] = c.name; });
  }
  // A 24h event count per account answers "is this thing alive?" at a glance,
  // which is the first question anyone opening this page has.
  const since = new Date(Date.now() - 86400000).toISOString();
  const { data: evs } = await supabaseAdmin.from('dialer_webhook_events')
    .select('account_id, status, normalized, received_at')
    .gte('received_at', since).order('received_at', { ascending: false });
  const stats = {};
  const lastSummary = {};
  (evs || []).forEach(e => {
    const s = stats[e.account_id] || (stats[e.account_id] = { total: 0, accepted: 0, problems: 0 });
    s.total += 1;
    if (e.status === 'accepted') s.accepted += 1;
    else if (e.status !== 'ignored') s.problems += 1;
    // Newest first, so the first one seen per account is the latest.
    if (!(e.account_id in lastSummary)) lastSummary[e.account_id] = e.normalized || {};
  });

  // THE HONEST GAP CHECK. A mapping can look complete and still resolve to
  // nothing — a path that was right in the docs and wrong in this tenant's
  // payloads. So on top of "is it mapped at all", report which required fields
  // came out EMPTY on the last call that actually arrived. That is the number
  // an operator can act on, and it is what the warning strip shows.
  const REQUIRED = ['agent', 'phone', 'dispo'];
  const unresolved = (accountId) => {
    const s = lastSummary[accountId];
    if (!s) return [];   // nothing has arrived yet — nothing to conclude
    return REQUIRED.filter(k => !s[k]);
  };

  res.json({
    accounts: (data || []).map(a => ({
      ...accounts.publicView(a),
      company_name: a.company_id ? (names[a.company_id] || null) : null,
      // Unmapped fields and fields that mapped to nothing are the same problem
      // to the person reading the page, so they are reported as one list.
      gaps: [...new Set([...mappingGaps(a), ...unresolved(a.id)])],
      last_24h: stats[a.id] || { total: 0, accepted: 0, problems: 0 },
    })),
  });
}));

// Only these may be written from the browser. `webhook_token` is deliberately
// absent — it is generated here and rotated through its own endpoint, never
// set by a client.
const WRITABLE = ['provider', 'name', 'company_id', 'prefix', 'base_url', 'auth', 'settings', 'field_map', 'is_active', 'webhook_secret'];

function pickWritable(body) {
  const out = {};
  for (const k of WRITABLE) if (k in body) out[k] = body[k];
  if (out.prefix) out.prefix = String(out.prefix).trim().toUpperCase();
  if (out.base_url) out.base_url = String(out.base_url).trim().replace(/\/+$/, '');
  if (out.company_id === '') out.company_id = null;
  return out;
}

// A masked secret must never be saved back over the real one. The UI shows
// "••••7f3a" for anything sensitive, and a save that echoes it means "leave it
// alone" — writing it verbatim would destroy the credential.
function keepExistingSecrets(next, prev) {
  if (typeof next.webhook_secret === 'string' && next.webhook_secret.startsWith('••••')) delete next.webhook_secret;
  if (!next.auth || !prev) return next;
  const merged = { ...(prev.auth || {}), ...next.auth };
  for (const k of ['token', 'pass', 'password', 'key', 'secret']) {
    if (typeof merged[k] === 'string' && merged[k].startsWith('••••')) merged[k] = (prev.auth || {})[k] || '';
  }
  next.auth = merged;
  return next;
}

router.post('/accounts', asyncHandler(async (req, res) => {
  const body = pickWritable(req.body || {});
  if (!body.name) return res.status(400).json({ error: 'A name is required' });
  const provider = getProvider(body.provider);
  const row = {
    provider: provider.key,
    name: String(body.name).trim(),
    company_id: body.company_id || null,
    prefix: body.prefix || null,
    base_url: body.base_url || provider.preset.base_url || null,
    auth: body.auth || provider.preset.auth || {},
    settings: body.settings || provider.preset.settings || {},
    // Start from the preset so a new account is usable immediately; the
    // operator then corrects it against a real payload.
    field_map: body.field_map || provider.preset.field_map || {},
    webhook_secret: body.webhook_secret || null,
    is_active: body.is_active !== false,
    webhook_token: accounts.newWebhookToken(),
  };
  const { data, error } = await supabaseAdmin.from('dialer_accounts').insert(row).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  accounts.invalidate();
  logger.success('DIALER_ADMIN', `Created ${provider.key} account "${row.name}"`);
  res.json({ account: accounts.publicView(data) });
}));

router.patch('/accounts/:id', asyncHandler(async (req, res) => {
  const { data: prev } = await supabaseAdmin.from('dialer_accounts').select('*').eq('id', req.params.id).maybeSingle();
  if (!prev) return res.status(404).json({ error: 'Account not found' });
  const patch = keepExistingSecrets(pickWritable(req.body || {}), prev);
  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('dialer_accounts').update(patch).eq('id', req.params.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  accounts.invalidate();
  res.json({ account: accounts.publicView(data) });
}));

router.delete('/accounts/:id', asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from('dialer_accounts').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  accounts.invalidate();
  res.json({ ok: true });
}));

// Rotating the token changes the URL — the old one stops working the moment
// this returns, which is the entire point of having it.
router.post('/accounts/:id/rotate-token', asyncHandler(async (req, res) => {
  const token = accounts.newWebhookToken();
  const { data, error } = await supabaseAdmin.from('dialer_accounts')
    .update({ webhook_token: token, updated_at: new Date().toISOString() })
    .eq('id', req.params.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  accounts.invalidate();
  logger.warn('DIALER_ADMIN', `Rotated the webhook token for "${data.name}" — the old URL is now dead`);
  res.json({ account: accounts.publicView(data) });
}));

router.post('/accounts/:id/test-api', asyncHandler(async (req, res) => {
  const account = await accounts.byId(req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  res.json(await testConnection(account));
}));

// ── the field picker ────────────────────────────────────────────────────────
// Every key the last few payloads contained, with an example value. This is
// what makes mapping a point-and-click job instead of a documentation exercise.
router.get('/accounts/:id/fields', asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 5, 20);
  const { data } = await supabaseAdmin.from('dialer_webhook_events')
    .select('id, received_at, payload, event_type, status, outcome')
    .eq('account_id', req.params.id).order('received_at', { ascending: false }).limit(limit);

  const seen = new Map();   // path -> { path, samples: [] }
  for (const ev of (data || [])) {
    const flat = flatten(ev.payload || {});
    for (const [k, v] of Object.entries(flat)) {
      if (k.startsWith('__query') || k.startsWith('__body')) continue;
      if (!seen.has(k)) seen.set(k, { path: k, samples: [] });
      const entry = seen.get(k);
      const s = v == null ? '' : String(v);
      if (s && entry.samples.length < 3 && !entry.samples.includes(s)) entry.samples.push(s.slice(0, 120));
    }
  }
  res.json({
    fields: [...seen.values()].sort((a, b) => a.path.localeCompare(b.path)),
    events: (data || []).map(e => ({ id: e.id, received_at: e.received_at, event_type: e.event_type, status: e.status, outcome: e.outcome })),
    sample_payload: (data || [])[0]?.payload || null,
  });
}));

// Map a payload and report what it produced — writes NOTHING. Takes either a
// pasted payload or the id of a logged event.
router.post('/accounts/:id/test', asyncHandler(async (req, res) => {
  const account = await accounts.byId(req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  let payload = req.body?.payload;
  if (!payload && req.body?.event_id) {
    const { data } = await supabaseAdmin.from('dialer_webhook_events').select('payload').eq('id', req.body.event_id).maybeSingle();
    payload = data?.payload;
  }
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { return res.status(400).json({ error: 'That payload is not valid JSON' }); }
  }
  if (!payload || typeof payload !== 'object') return res.status(400).json({ error: 'Paste a payload, or pick an event to test against' });

  // An account can be tested with an UNSAVED mapping, so the operator sees the
  // effect of an edit before committing it.
  const draft = req.body?.field_map ? { ...account, field_map: req.body.field_map } : account;
  const ev = normalizeEvent(draft, { body: payload, query: {}, headers: {} });

  // Would this create a transfer, land a disposition, or only be recorded for
  // QA? Say so plainly — "event_type: xfer" means little at 2am.
  const verdict = !ev.ok
    ? `Nothing would happen — ${ev.reason}`
    : ev.event_type === 'xfer'
      ? `Creates a PENDING TRANSFER for the fronter mapped to agent "${ev.agent}"`
      : ev.leg === 'closer'
        ? `Applies disposition "${ev.dispo}" to the matching transfer (or queues it for the closer)`
        : `Recorded for QA only — "${ev.dispo}" is not one of this account's transfer dispositions`;

  res.json({
    ok: ev.ok, reason: ev.reason, verdict,
    normalized: {
      event_type: ev.event_type, leg: ev.leg, agent: ev.agent, phone: ev.phone,
      normalized_phone: ev.normalized_phone, dispo: ev.dispo, code: ev.code,
      external_call_id: ev.external_call_id, talk_time: ev.talk_time, call_at: ev.call_at,
      recording_url: ev.recording_url, term: ev.term, customer: ev.customer, extras: ev.extras,
    },
    gaps: mappingGaps(draft),
  });
}));

// ── the event log ───────────────────────────────────────────────────────────
router.get('/accounts/:id/events', asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  let q = supabaseAdmin.from('dialer_webhook_events')
    .select('id, received_at, method, source_ip, event_type, leg, normalized, status, outcome, error, transfer_id, duration_ms, payload')
    .eq('account_id', req.params.id).order('received_at', { ascending: false }).limit(limit);
  if (req.query.status) q = q.eq('status', req.query.status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ events: data || [], live: recent.slice(0, 20) });
}));

// Re-run a logged payload through the CURRENT mapping. The fix-and-retry loop:
// a call that landed while the mapping was wrong does not have to be lost, and
// the dedup rules in the transfer engine stop a replay from double-counting
// anything that did work.
router.post('/events/:id/replay', asyncHandler(async (req, res) => {
  const { data: ev } = await supabaseAdmin.from('dialer_webhook_events').select('*').eq('id', req.params.id).maybeSingle();
  if (!ev) return res.status(404).json({ error: 'Event not found' });
  const account = await accounts.byId(ev.account_id);
  if (!account) return res.status(404).json({ error: 'That account no longer exists' });

  const normalized = normalizeEvent(account, { body: ev.payload || {}, query: {}, headers: {} });
  if (!normalized.ok) return res.json({ ok: false, reason: normalized.reason });

  const result = await dispatch(account, normalized, { ip: ev.source_ip });
  await supabaseAdmin.from('dialer_webhook_events').insert({
    account_id: account.id, provider: account.provider, method: 'REPLAY',
    source_ip: ev.source_ip, headers: {}, payload: ev.payload,
    event_type: normalized.event_type, leg: normalized.leg,
    normalized: { agent: normalized.agent, phone: normalized.phone, dispo: normalized.dispo, code: normalized.code },
    status: 'accepted',
    outcome: `replay of ${ev.id} · ${result.route}${result.transfer_id ? ` · transfer ${result.transfer_id}` : ''}`,
    transfer_id: result.transfer_id,
  });
  res.json({ ok: true, result: result.body, route: result.route });
}));

// ── agent map ───────────────────────────────────────────────────────────────
// A dialer's agent ids are its own; this is where they become CRM people. The
// unmapped list comes from the events themselves, so the operator is told which
// ids are actually arriving rather than having to ask the dialer.
router.get('/accounts/:id/agents', asyncHandler(async (req, res) => {
  const { data: links } = await supabaseAdmin.from('dialer_agent_links')
    .select('id, external_agent_id, user_id, company_id, note, created_at')
    .eq('account_id', req.params.id).order('external_agent_id');

  const userIds = [...new Set((links || []).map(l => l.user_id).filter(Boolean))];
  const people = {};
  if (userIds.length) {
    const { data: profs } = await supabaseAdmin.from('user_profiles')
      .select('user_id, first_name, last_name').in('user_id', userIds);
    (profs || []).forEach(p => { people[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim(); });
  }

  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: evs } = await supabaseAdmin.from('dialer_webhook_events')
    .select('normalized').eq('account_id', req.params.id).gte('received_at', since).limit(500);
  const known = new Set((links || []).map(l => String(l.external_agent_id).toUpperCase()));
  const unmapped = new Map();
  (evs || []).forEach(e => {
    const a = e.normalized && e.normalized.agent;
    if (!a) return;
    const key = String(a).toUpperCase();
    if (known.has(key)) return;
    unmapped.set(key, (unmapped.get(key) || 0) + 1);
  });

  res.json({
    links: (links || []).map(l => ({ ...l, user_name: people[l.user_id] || null })),
    unmapped: [...unmapped.entries()].map(([agent, calls]) => ({ agent, calls })).sort((a, b) => b.calls - a.calls),
  });
}));

router.post('/accounts/:id/agents', asyncHandler(async (req, res) => {
  const { external_agent_id, user_id, company_id, note } = req.body || {};
  if (!external_agent_id || !user_id) return res.status(400).json({ error: 'An agent id and a CRM user are both required' });
  const row = {
    account_id: req.params.id,
    external_agent_id: String(external_agent_id).trim(),
    user_id,
    company_id: company_id || null,
    note: note || null,
  };
  // One id per account: re-saving an id moves it to the new person rather than
  // creating a second link that would make routing ambiguous.
  const { data: existing } = await supabaseAdmin.from('dialer_agent_links')
    .select('id').eq('account_id', req.params.id).ilike('external_agent_id', row.external_agent_id).maybeSingle();
  const q = existing
    ? supabaseAdmin.from('dialer_agent_links').update(row).eq('id', existing.id).select('*').single()
    : supabaseAdmin.from('dialer_agent_links').insert(row).select('*').single();
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ link: data });
}));

router.delete('/agents/:linkId', asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from('dialer_agent_links').delete().eq('id', req.params.linkId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

// ── recordings ──────────────────────────────────────────────────────────────
// "Why has this call got no audio?" answered directly against the dialer's API,
// without waiting for the poller's next tick.
router.post('/accounts/:id/recording-probe', asyncHandler(async (req, res) => {
  const account = await accounts.byId(req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  const callId = String(req.body?.call_id || '').trim();
  if (!callId) return res.status(400).json({ error: 'A call id is required' });
  res.json(await recordingForCall(account, callId));
}));

module.exports = router;
