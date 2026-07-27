// ============================================================================
// /pwa — Progressive Web App configuration + the push-notification matrix.
//
//   GET  /api/pwa/manifest      PUBLIC — the web app manifest, merged with
//                               Branding. Served as application/manifest+json
//                               so the browser can install the app.
//   GET  /api/pwa/public        PUBLIC — the handful of flags the SPA needs
//                               before it has a token (is the PWA on, versions).
//   GET  /api/pwa               superadmin — full settings + the event catalog.
//   PUT  /api/pwa               superadmin — save settings.
//   GET  /api/pwa/devices       superadmin — subscribed devices.
//   DELETE /api/pwa/devices/:id superadmin — revoke one device.
//   POST /api/pwa/test-push     superadmin — send a test push to yourself.
//
// Storage: business_config GLOBAL key `pwa` — the same mechanism Branding uses
// (mig 068), so this needs no migration and no new table.
//
// IMPORTANT — why the defaults are all ON. notifyUsers() calls
// sendPushToUsers() unconditionally, so every event it handles already pushes
// to every subscribed device. Defaulting to on is therefore what "preserve
// current behaviour" actually means. The value of this matrix is being able to
// turn things DOWN and re-target them, not up.
//
// "On" means on for the channels an event HAS — see `channels` on each catalog
// entry. Five events only write an in-app row and one only pushes; those are
// not new restrictions, they are what the emitting code has always done.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { isSuperAdmin } = require('../models/helpers');
const { getConfig, setConfig } = require('../utils/businessConfig');
const { sendPushToUser } = require('../utils/pushService');
const logger = require('../utils/logger');

const router = express.Router();
const CONFIG_KEY = 'pwa';

// ─── Event catalog ──────────────────────────────────────────────────────────
// Single source of truth for what the admin can tune. `id` matches the `type`
// written to notifications.type and used as the push tag, so the UI, the gate
// and the stored rows all speak the same vocabulary.
//
// `legacyKey` maps an event onto a notification flag that ALREADY gates it in
// notificationService (there were exactly three). Those keep working as before
// and this UI becomes another way to set the same value — no silent behaviour
// change, and no second setting that can disagree with the first.
//
// `channels` is what the emitting code ACTUALLY sends today, and it is the
// reason this list is trustworthy. Five of these events only ever wrote an
// in-app row and one only ever pushed; offering a "push" switch on an event
// that has no push would be a control that silently does nothing — the exact
// failure where a screen looks right and the behaviour isn't. Turning those on
// would also mean making the floor NOISIER, which is the opposite of the point.
// If an emitter later gains a channel, widen it here and the UI follows.
const EVENT_CATALOG = [
  { id: 'transfer_created',      group: 'Transfers',  label: 'Transfer created',        detail: 'A fronter sent a new transfer.',            channels: ['inapp', 'push'] },
  { id: 'transfer_assigned',     group: 'Transfers',  label: 'Transfer assigned',       detail: 'A transfer landed on a closer.',            channels: ['inapp', 'push'], legacyKey: 'transfer_assigned_notify_closer' },
  { id: 'transfer_rejected',     group: 'Transfers',  label: 'Transfer rejected',       detail: 'A closer rejected a transfer.',             channels: ['inapp', 'push'], legacyKey: 'transfer_reject_notify_fronter' },
  { id: 'transfer_edited',       group: 'Transfers',  label: 'Transfer edited',         detail: 'A transfer was edited after the fact.',     channels: ['inapp'] },
  { id: 'transfer_refresh',      group: 'Transfers',  label: 'Duplicate — refreshed',   detail: 'Re-transfer inside the dedup window.',      channels: ['inapp'] },
  { id: 'transfer_reengaged',    group: 'Transfers',  label: 'Duplicate — re-engaged',  detail: 'Old lead transferred again.',               channels: ['inapp'] },
  { id: 'transfer_sale_overlap', group: 'Transfers',  label: 'Duplicate — sale exists', detail: 'New transfer despite a completed sale.',    channels: ['inapp'] },

  // `superadmin: true` = this event can additionally notify superadmins across
  // every company (push.superadmin_events). Only these three are wired for it,
  // and the flag is what stops the UI offering a switch the code would ignore.
  { id: 'sale_pending_review',   group: 'Sales',      label: 'Sale submitted',           detail: 'A sale entered the compliance queue.',     channels: ['inapp', 'push'], superadmin: true },
  { id: 'sale_approved',         group: 'Sales',      label: 'Sale approved',            detail: 'Compliance approved a sale.',              channels: ['inapp', 'push'], superadmin: true },
  { id: 'sale_needs_revision',   group: 'Sales',      label: 'Sale returned',            detail: 'Compliance sent a sale back.',             channels: ['inapp', 'push'], superadmin: true },
  { id: 'compliance_updated',    group: 'Sales',      label: 'Compliance edited a sale', detail: 'A sale was changed by compliance.',        channels: ['inapp', 'push'] },
  { id: 'resell_created',        group: 'Sales',      label: 'Resell created',           detail: 'A customer was sold again.',               channels: ['inapp', 'push'], legacyKey: 'resell_notify_compliance' },
  { id: 'disposition_submitted', group: 'Sales',      label: 'Disposition submitted',    detail: 'A non-sale disposition was logged.',       channels: ['inapp', 'push'] },

  { id: 'callback_due',          group: 'Callbacks',  label: 'Callback due',            detail: 'A scheduled callback came due.',            channels: ['inapp', 'push'] },
  { id: 'number_claimable',      group: 'Numbers',    label: 'Number claimable',        detail: 'An assigned number became claimable.',      channels: ['inapp'] },
  // Chat has its own unread badge, so it has never written a bell notification.
  { id: 'chat_message',          group: 'Messaging',  label: 'Chat message',            detail: 'A new chat message arrived.',               channels: ['push'] },
  { id: 'email_received',        group: 'Messaging',  label: 'Internal email',          detail: 'A new internal email arrived.',             channels: ['inapp', 'push'] },
];

// Recipient targeting. `roles: null` means "whoever this event already
// notifies" — the existing routing in notificationService, untouched. Anything
// else is an explicit override the admin chose.
const ROLE_CHOICES = [
  'superadmin', 'readonly_admin', 'compliance_manager',
  'company_admin', 'operations_manager',
  'closer_manager', 'fronter_manager', 'manager',
  'closer', 'fronter',
];

// Every channel an event actually has, switched on — i.e. exactly what the code
// does today. An event with no push channel defaults to push:false because a
// stored `true` there would be a claim the emitter cannot honour.
const defaultEvents = () => Object.fromEntries(
  EVENT_CATALOG.map(e => [e.id, {
    inapp: e.channels.includes('inapp'),
    push:  e.channels.includes('push'),
    roles: null,
  }]),
);

// Code defaults — a fresh install behaves exactly like today: the PWA layer is
// OFF (no service worker at boot, no manifest link) and every event still
// notifies + pushes exactly the way it already does.
const DEFAULTS = {
  enabled: false,
  install: {
    name:             '',            // '' → falls back to branding.site_name
    short_name:       '',
    description:      '',
    theme_color:      '',            // '' → branding.theme_color
    background_color: '#0B1F1A',
    display:          'standalone',
    orientation:      'any',
    start_url:        '/dashboard',
    scope:            '/',
    icon_192:         '',
    icon_512:         '',
    icon_maskable:    '',
    // Who is OFFERED the install prompt in-app. 'everyone' | 'superadmin'.
    // This gates our own affordance only — the browser's own Install menu item
    // is a browser feature and cannot be taken away by an app.
    audience:         'everyone',
  },
  sw: {
    cache_enabled:    true,
    cache_version:    1,
    offline_fallback: true,
    auto_update:      false,         // false → prompt through the existing UpdateBanner
  },
  push: {
    quiet_hours:         { enabled: false, start: '22:00', end: '07:00' },
    require_interaction: false,
    vibrate:             true,
    urgency:             'high',
    ttl:                 86400,
    // Events superadmins are ADDED to, across every company. This is the one
    // control that widens a recipient list rather than narrowing it, which is
    // why it is separate from per-event `roles` (those only ever subtract).
    // Superadmins are oversight: they are not in a company's manager list, so
    // without this they never hear about a sale in a tenant they don't sit in.
    superadmin_events:   [],
  },
  events: defaultEvents(),
};

// Deep-merge saved values over the defaults, so a settings object written
// before a field existed never renders as undefined in the UI.
function merge(saved) {
  const s = saved && typeof saved === 'object' ? saved : {};
  return {
    ...DEFAULTS, ...s,
    install: {
      ...DEFAULTS.install, ...(s.install || {}),
      // Anything unrecognised means 'everyone' — an audience typo must not
      // silently hide the prompt from the whole company.
      audience: (s.install || {}).audience === 'superadmin' ? 'superadmin' : 'everyone',
    },
    sw:      { ...DEFAULTS.sw,      ...(s.sw      || {}) },
    push:    {
      ...DEFAULTS.push, ...(s.push || {}),
      quiet_hours: { ...DEFAULTS.push.quiet_hours, ...((s.push || {}).quiet_hours || {}) },
      // Only ids that exist in the catalog, so a stale entry from a renamed
      // event cannot quietly widen some other event's audience.
      superadmin_events: (Array.isArray((s.push || {}).superadmin_events) ? s.push.superadmin_events : [])
        .filter(id => EVENT_CATALOG.some(e => e.id === id)),
    },
    // Clamp every stored event to the channels its emitter actually has, so a
    // value saved before `channels` existed (or hand-edited in the table) can
    // never claim a delivery the code does not perform.
    events: clampEvents({ ...defaultEvents(), ...(s.events || {}) }),
  };
}

function clampEvents(events) {
  const out = {};
  for (const e of EVENT_CATALOG) {
    const v = events[e.id] || {};
    out[e.id] = {
      inapp: e.channels.includes('inapp') && v.inapp !== false,
      push:  e.channels.includes('push')  && v.push  !== false,
      roles: Array.isArray(v.roles) ? v.roles : null,
    };
  }
  return out;
}

const readSettings = async () => merge(await getConfig(null, CONFIG_KEY, null));

// ─── per-user overrides ──────────────────────────────────────────────────────
// ONE config key holding a map of userId → override, rather than a row per
// user. A single cached read then covers every recipient of a bulk notify; a
// per-user key would mean N lookups for an event that fans out to N people.
// Only users who actually have an override appear here, so it stays small.
//
// An override can only ever REDUCE what the global matrix decided. There is no
// 'turn it on for this one person' — that would let a per-user setting create a
// delivery the event's channels do not support, and would quietly contradict
// the switch the superadmin set globally.
const USERS_KEY = 'pwa_users';

const USER_DEFAULT = { install_prompt: 'inherit', mute_all: false, push_off: false, events: {} };
const EVENT_CHOICES = ['inherit', 'inapp', 'off'];

function mergeUser(saved) {
  const s = saved && typeof saved === 'object' ? saved : {};
  const events = {};
  for (const [k, v] of Object.entries(s.events || {})) {
    if (EVENT_CATALOG.some(e => e.id === k) && EVENT_CHOICES.includes(v) && v !== 'inherit') events[k] = v;
  }
  return {
    install_prompt: ['show', 'hide'].includes(s.install_prompt) ? s.install_prompt : 'inherit',
    mute_all: s.mute_all === true,
    push_off: s.push_off === true,
    events,
  };
}

const readUsers = async () => {
  const raw = await getConfig(null, USERS_KEY, null);
  return raw && typeof raw === 'object' ? raw : {};
};

// An override that says nothing is not stored — it would grow the map forever
// with rows that mean "default".
const isEmptyOverride = (o) =>
  o.install_prompt === 'inherit' && !o.mute_all && !o.push_off && Object.keys(o.events).length === 0;

// ─── PUBLIC: manifest ───────────────────────────────────────────────────────
// Merged with Branding so the installed app carries the same identity as the
// site — one place to rename the product, not two.
//
// Exported standalone (not on the router) because server.js mounts the whole
// router behind authMiddleware — same split branding.js uses for publicGet.
const publicManifest = asyncHandler(async (req, res) => {
  const [pwa, branding] = await Promise.all([
    readSettings(),
    getConfig(null, 'branding', {}),
  ]);
  const b = branding || {};
  const i = pwa.install;

  const iconEntry = (url, size, purpose) => url
    ? [{
        src:   url,
        sizes: `${size}x${size}`,
        type:  url.endsWith('.svg') ? 'image/svg+xml' : 'image/png',
        ...(purpose ? { purpose } : {}),
      }]
    : [];

  const icons = [
    ...iconEntry(i.icon_192, 192),
    ...iconEntry(i.icon_512, 512),
    ...iconEntry(i.icon_maskable, 512, 'maskable'),
  ];
  // Always ship at least one icon, or the browser refuses to offer install.
  if (!icons.length) icons.push({ src: b.favicon_url || '/favicon.svg', sizes: 'any', type: 'image/svg+xml' });

  res.type('application/manifest+json').json({
    name:             i.name || b.site_name || 'BizTrix CRM',
    short_name:       i.short_name || (b.site_name || 'BizTrix').split(' ')[0],
    description:      i.description || b.meta_description || '',
    start_url:        i.start_url || '/dashboard',
    scope:            i.scope || '/',
    display:          i.display || 'standalone',
    orientation:      i.orientation || 'any',
    theme_color:      i.theme_color || b.theme_color || '#6E5838',
    background_color: i.background_color || '#0B1F1A',
    icons,
  });
});

// ─── PUBLIC: the flags the SPA needs before it has a token ──────────────────
const publicFlags = asyncHandler(async (req, res) => {
  const s = await readSettings();
  res.json({
    enabled:          !!s.enabled,
    cache_enabled:    !!s.sw.cache_enabled,
    cache_version:    s.sw.cache_version || 1,
    auto_update:      !!s.sw.auto_update,
    offline_fallback: !!s.sw.offline_fallback,
    // Not sensitive: it says who is OFFERED the prompt, not who anyone is. The
    // SPA needs it before it has a token, same as every other flag here.
    install_audience: s.install.audience,
  });
});

// ─── the caller's own effective install answer ──────────────────────────────
// Authenticated but NOT superadmin-gated: every user needs to know whether the
// install prompt is for them. Resolving it here rather than in the browser means
// the rule lives in one place and the client cannot get it subtly wrong.
router.get('/me', asyncHandler(async (req, res) => {
  const [s, users] = await Promise.all([readSettings(), readUsers()]);
  const mine = mergeUser(users[req.user.id]);
  const superadmin = await isSuperAdmin(req.user.id);

  const byAudience = s.install.audience !== 'superadmin' || superadmin;
  const show = mine.install_prompt === 'show' ? true
             : mine.install_prompt === 'hide' ? false
             : byAudience;

  res.json({
    install_prompt: !!(s.enabled && show),
    // Why, so the admin UI can explain the answer instead of just asserting it.
    reason: mine.install_prompt !== 'inherit' ? 'user' : (byAudience ? 'audience' : 'audience_excluded'),
    muted: mine.mute_all,
  });
}));

// ─── superadmin guard ───────────────────────────────────────────────────────
const superadminOnly = asyncHandler(async (req, res, next) => {
  if (!(await isSuperAdmin(req.user.id))) return res.status(403).json({ error: 'Superadmin only' });
  next();
});

// ─── full settings + catalog ────────────────────────────────────────────────
router.get('/', superadminOnly, asyncHandler(async (req, res) => {
  res.json({
    settings: await readSettings(),
    catalog:  EVENT_CATALOG,
    roles:    ROLE_CHOICES,
    vapid_configured: !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
  });
}));

router.put('/', superadminOnly, asyncHandler(async (req, res) => {
  const incoming = merge(req.body?.settings);
  const prev = await readSettings();

  // Bump the cache version when the caching rules change, so clients already
  // holding an old app shell pick up the new rules instead of sitting on a
  // stale one forever.
  if (prev.sw.cache_enabled !== incoming.sw.cache_enabled) {
    incoming.sw.cache_version = (Number(prev.sw.cache_version) || 1) + 1;
  }
  // 'global' is the SCOPE string, not a company id. getConfig(companyId, …)
  // takes a company and falls back to the global scope internally; setConfig
  // takes the scope directly. Passing null here wrote rows under scope=null,
  // which nothing could ever read back.
  await setConfig('global', CONFIG_KEY, incoming, req.user.id);

  // Keep the three pre-existing notification flags in lockstep, so the older
  // Business Rules panel and this one can never disagree about one setting.
  for (const e of EVENT_CATALOG) {
    if (!e.legacyKey) continue;
    const ev = incoming.events[e.id];
    if (ev) await setConfig('global', `notifications.${e.legacyKey}`, !!(ev.inapp || ev.push), req.user.id);
  }

  logger.info('PWA', `Settings saved by ${req.user.email || req.user.id}`);
  res.json({ settings: incoming });
}));

// ─── devices ────────────────────────────────────────────────────────────────
router.get('/devices', superadminOnly, asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, user_id, endpoint, user_agent, created_at')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) return res.status(500).json({ error: error.message });

  const ids = [...new Set((data || []).map(d => d.user_id).filter(Boolean))];
  let profiles = {};
  let emails   = {};
  if (ids.length) {
    // `user_id` is the FK to auth.users; `id` is the table's OWN primary key, a
    // separate random uuid. Joining on `id` matched nothing — and since
    // user_profiles has no `email` column either, the whole select errored and
    // every row fell back to "Unknown".
    const { data: rows, error: pErr } = await supabaseAdmin
      .from('user_profiles').select('user_id, first_name, last_name').in('user_id', ids);
    if (pErr) logger.warn('PWA', `device profiles: ${pErr.message}`);
    profiles = Object.fromEntries((rows || []).map(p => [p.user_id, p]));

    // Email lives in auth, not in user_profiles. Resolve it ONLY for users with
    // no name — a fully-named org costs zero auth calls, and nobody has to read
    // "Unknown" just because their profile was never filled in.
    const unnamed = ids.filter(id => {
      const p = profiles[id];
      return !p || !(p.first_name || p.last_name);
    });
    if (unnamed.length) {
      const results = await Promise.allSettled(unnamed.map(uid => supabaseAdmin.auth.admin.getUserById(uid)));
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value.data?.user?.email) emails[unnamed[i]] = r.value.data.user.email;
      });
    }
  }

  res.json({
    devices: (data || []).map(d => {
      const p = profiles[d.user_id] || {};
      const email = emails[d.user_id] || null;
      return {
        id:         d.id,
        user_id:    d.user_id,
        // Last resort is the user id, not the word "Unknown": a truncated uuid
        // is at least something you can search for.
        user:       [p.first_name, p.last_name].filter(Boolean).join(' ')
                      || email
                      || (d.user_id ? `User ${String(d.user_id).slice(0, 8)}` : 'Unknown'),
        email,
        user_agent: d.user_agent || null,
        // A push endpoint is a capability URL — anyone holding it can push to
        // that device. Only the host is returned; the token never leaves here.
        provider:   (() => { try { return new URL(d.endpoint).host; } catch { return 'unknown'; } })(),
        created_at: d.created_at,
      };
    }),
  });
}));

router.delete('/devices/:id', superadminOnly, asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin.from('push_subscriptions').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
}));

// ─── per-user overrides (User Control Center) ───────────────────────────────
// The effective answer is always computed here, never in the browser, so the
// admin screen shows the same verdict the notification pipeline will reach.
router.get('/user/:userId', superadminOnly, asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const [s, users, subs] = await Promise.all([
    readSettings(),
    readUsers(),
    supabaseAdmin.from('push_subscriptions')
      .select('id, endpoint, user_agent, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
  ]);

  const override = mergeUser(users[userId]);
  const superadmin = await isSuperAdmin(userId);

  // What the GLOBAL matrix would do for this user, per event — so the UI can
  // label "Inherit" with what inheriting actually means instead of leaving the
  // admin to cross-reference two screens.
  const effective = {};
  for (const e of EVENT_CATALOG) {
    const g = s.events[e.id] || {};
    const choice = override.events[e.id] || 'inherit';
    const inapp = g.inapp && !override.mute_all && choice !== 'off';
    const push  = g.push && !override.mute_all && !override.push_off
                  && choice !== 'off' && choice !== 'inapp';
    effective[e.id] = {
      global: { inapp: !!g.inapp, push: !!g.push },
      result: { inapp: !!inapp, push: !!push },
      choice,
    };
  }

  const byAudience = s.install.audience !== 'superadmin' || superadmin;
  res.json({
    override,
    effective,
    catalog: EVENT_CATALOG,
    install: {
      audience: s.install.audience,
      by_audience: byAudience,
      result: override.install_prompt === 'show' ? true
            : override.install_prompt === 'hide' ? false
            : byAudience,
    },
    pwa_enabled: !!s.enabled,
    devices: (subs.data || []).map(d => ({
      id: d.id,
      user_agent: d.user_agent || null,
      provider: (() => { try { return new URL(d.endpoint).host; } catch { return 'unknown'; } })(),
      created_at: d.created_at,
    })),
  });
}));

router.put('/user/:userId', superadminOnly, asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const users = await readUsers();
  const next = mergeUser(req.body?.override);
  // Storing "everything is default" would grow this map forever with rows that
  // mean nothing. An override that says nothing is a deletion.
  if (isEmptyOverride(next)) delete users[userId];
  else users[userId] = next;
  await setConfig('global', USERS_KEY, users, req.user.id);
  res.json({ override: next });
}));

// ─── test push ──────────────────────────────────────────────────────────────
// Sends only to the caller. A "send to everyone" button on a live CRM is a
// footgun with no undo, so it deliberately does not exist.
router.post('/test-push', superadminOnly, asyncHandler(async (req, res) => {
  const s = await readSettings();
  let sent = true, detail = null;
  try {
    await sendPushToUser(req.user.id, {
      title: 'Test notification',
      body:  'If you can see this, instant push is working on this device.',
      tag:   'pwa_test',
      data:  { type: 'pwa_test' },
      requireInteraction: !!s.push.require_interaction,
    });
  } catch (e) { sent = false; detail = e.message; }
  res.json({ sent, detail });
}));

// `loadManifest` lets the frontend meta-injection server (server.cjs) build the
// <link rel="manifest"> + theme-color without a second HTTP hop back into us.
module.exports = {
  publicManifest,
  publicFlags,
  adminRouter: router,
  EVENT_CATALOG,
  readSettings,
};
