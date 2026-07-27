// ============================================================================
// pwaPolicy — the single gate every notification passes through.
//
// The settings live in business_config scope 'global', key `pwa`, written by
// PUT /api/pwa. This module only READS them, and only through getConfig, whose
// 60s in-process cache means the default path costs nothing per event.
//
// THE INVARIANT THAT MAKES THIS SAFE TO SHIP: an event with no stored entry, a
// missing config row, or a failed read all resolve to { inapp: true, push: true,
// roles: null } — which is byte-for-byte what the code did before this existed.
// Notifications are the mechanism by which a closer learns their sale came back
// and compliance learns a sale arrived, so every failure mode here fails OPEN.
// A config hiccup that silently muted the queue would be far worse than one
// that ignored an admin's preference for sixty seconds.
//
// `roles` narrows the recipients an event ALREADY computed; it never adds
// anyone. That direction is deliberate. The recipient lists in
// notificationService are meaningful — "the assigned closer", "the submitting
// fronter", "this sale's compliance queue" — and replacing one with "everybody
// holding role X" would turn a private outcome into a broadcast. Narrowing can
// only ever mean fewer people learning something they were already entitled to
// learn, which is not a disclosure decision. So: null = today's recipients,
// a list = that subset of them, an empty list = nobody.
// ============================================================================
const { supabaseAdmin } = require('../config/database');
const { getConfig } = require('./businessConfig');
const { sendPushToUsers } = require('./pushService');

const CONFIG_KEY = 'pwa';

// What every event does when nothing says otherwise — i.e. what the code did
// before the matrix existed.
const DEFAULT_POLICY = Object.freeze({ inapp: true, push: true, roles: null });

const DEFAULT_PUSH = Object.freeze({
  require_interaction: false,
  vibrate:             true,
  urgency:             'high',
  ttl:                 86400,
});

async function readPwa() {
  try {
    const s = await getConfig(null, CONFIG_KEY, null);
    return s && typeof s === 'object' ? s : null;
  } catch {
    return null;
  }
}

/**
 * The delivery policy for one event type.
 * `type` is the same string written to notifications.type and used as the push
 * tag, so the UI, the stored rows and this gate all speak one vocabulary.
 */
async function eventPolicy(type) {
  const s = await readPwa();
  const e = s && s.events && s.events[type];
  if (!e || typeof e !== 'object') return DEFAULT_POLICY;
  return {
    // `!== false` rather than truthiness: a settings object written before a
    // field existed must read as ON, not as OFF.
    inapp: e.inapp !== false,
    push:  e.push  !== false,
    roles: Array.isArray(e.roles) ? e.roles : null,
  };
}

/** Delivery options shared by every push (urgency, TTL, vibrate, stickiness). */
async function pushOptions() {
  const s = await readPwa();
  const p = (s && s.push) || {};
  return {
    requireInteraction: p.require_interaction === true,
    vibrate:            p.vibrate !== false,
    urgency:            typeof p.urgency === 'string' ? p.urgency : DEFAULT_PUSH.urgency,
    ttl:                Number.isFinite(Number(p.ttl)) ? Number(p.ttl) : DEFAULT_PUSH.ttl,
  };
}

// A window is [start, end) on the server clock. A window that crosses midnight
// (22:00 → 07:00) is read as overnight rather than as an empty range, and a
// zero-width window means "off" rather than "always", because the alternative
// silences everything from one careless pair of identical dropdowns.
function inWindow(start, end, now = new Date()) {
  const parse = (t) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ''));
    if (!m) return null;
    const h = Number(m[1]), min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  };
  const s = parse(start), e = parse(end);
  if (s === null || e === null || s === e) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  return s < e ? (cur >= s && cur < e) : (cur >= s || cur < e);
}

/** True when device pushes are currently suppressed by quiet hours. */
async function pushMutedNow() {
  const s = await readPwa();
  const q = (s && s.push && s.push.quiet_hours) || {};
  if (!q.enabled) return false;
  return inWindow(q.start, q.end);
}

/**
 * Narrow a recipient list to the roles the policy allows.
 *
 * Returns the list unchanged when there is nothing to apply (`levels` null) and
 * — deliberately — also when the lookup FAILS. A transient database error must
 * not silently mute a compliance queue; the worst case of failing open is that
 * an admin's narrowing preference is ignored for one event.
 */
async function narrowToRoles(userIds, levels, companyId) {
  const ids = (userIds || []).filter(Boolean);
  if (!ids.length || !Array.isArray(levels)) return ids;
  if (!levels.length) return [];          // an explicit empty list means nobody

  try {
    let q = supabaseAdmin
      .from('user_company_roles')
      .select('user_id, custom_roles(level)')
      .in('user_id', ids)
      .eq('is_active', true);
    // Scope to the company when the event has one. Several events legitimately
    // reach across companies (a fronter in the fronting company hearing that
    // their lead closed), and those pass that company's id, not the closer's.
    if (companyId) q = q.eq('company_id', companyId);

    const { data, error } = await q;
    if (error || !data) return ids;
    const allowed = new Set(
      data.filter(r => levels.includes(r.custom_roles?.level)).map(r => r.user_id),
    );
    return ids.filter(id => allowed.has(id));
  } catch {
    return ids;
  }
}

// ─── superadmin oversight ────────────────────────────────────────────────────
// The ONE control that widens a recipient list. Per-event `roles` only ever
// subtracts, for the reasons at the top of this file; this is the deliberate
// exception, because a superadmin sits outside every company's manager list and
// would otherwise never hear about a sale in a tenant they are not a member of.
//
// Cached for a minute: it is a two-query lookup and sale events can arrive in
// bursts. A newly promoted superadmin starts receiving within that minute.
let saCache = { ids: null, at: 0 };
const SA_TTL = 60_000;

async function superadminIds() {
  if (saCache.ids && Date.now() - saCache.at < SA_TTL) return saCache.ids;
  const ids = new Set();
  try {
    const { data } = await supabaseAdmin
      .from('user_company_roles')
      .select('user_id, custom_roles(level)')
      .eq('is_active', true);
    for (const r of data || []) if (r.custom_roles?.level === 'superadmin') ids.add(r.user_id);
  } catch { /* fall through to the env path */ }

  // A system superadmin can have no company assignment at all — isSuperAdmin()
  // has the same fallback. Without this they would be invisible here.
  //
  // Email lives in auth.users, NOT in user_profiles (which has no email column
  // at all — an earlier version of this queried one and silently found nobody).
  // There is no email→id lookup in the admin API, so this pages through users;
  // it runs only when the role-row path found nothing, which is the rare case.
  if (!ids.size) {
    try {
      const emails = (process.env.SUPERADMIN_EMAIL || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
      if (emails.length) {
        const { data } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        for (const u of data?.users || []) {
          if (u.email && emails.includes(u.email.toLowerCase())) ids.add(u.id);
        }
      }
    } catch { /* best effort */ }
  }

  const out = [...ids];
  // Never cache an empty result: it is far more likely to be a failed query
  // than a system with no superadmin, and caching it would mute oversight for
  // a minute at a time, repeatedly.
  if (out.length) saCache = { ids: out, at: Date.now() };
  return out;
}

/** True when superadmins should be added as recipients for this event type. */
async function superadminWatches(type) {
  const s = await readPwa();
  const list = s && s.push && s.push.superadmin_events;
  return Array.isArray(list) && list.includes(type);
}

/**
 * Union the caller's recipients with the superadmins, when this event is one
 * the superadmin has opted into watching. Used by the sale events, where the
 * existing list is company-scoped by construction.
 */
async function withSuperadmins(type, userIds) {
  const base = (userIds || []).filter(Boolean);
  try {
    if (!(await superadminWatches(type))) return base;
    const sa = await superadminIds();
    return [...new Set([...base, ...sa])];
  } catch {
    return base;
  }
}

/**
 * The one call every emitter makes: given an event type and the recipients it
 * already computed, say who still gets it and by which channels.
 *
 * Returns { inappIds, pushIds } — two lists, not one list plus two booleans,
 * because a per-user override can mute push while leaving the bell entry, so
 * the two channels no longer reach the same set of people.
 *
 * On the default path (no stored entry, quiet hours off, roles null, no user
 * overrides) both lists equal the ids passed in, and the whole thing costs two
 * cached config reads — no database query, no behaviour change.
 */
// Per-user overrides live in ONE config key (a map keyed by user id), so this
// is a single cached read no matter how many recipients an event has.
async function userOverrides() {
  try {
    const m = await getConfig(null, 'pwa_users', null);
    return m && typeof m === 'object' ? m : {};
  } catch { return {}; }
}

async function resolveDelivery(type, userIds, companyId) {
  const [policy, muted, overrides] = await Promise.all([
    eventPolicy(type), pushMutedNow(), userOverrides(),
  ]);
  const base = (userIds || []).filter(Boolean);
  const ids  = policy.roles ? await narrowToRoles(base, policy.roles, companyId) : base;

  // Quiet hours mute the DEVICE, never the in-app record: the notification is
  // still there in the bell when they look, it just doesn't buzz at 3am.
  const globalInapp = policy.inapp;
  const globalPush  = policy.push && !muted;

  // A per-user override can only ever REDUCE what the global matrix decided.
  // There is deliberately no per-user "turn it on": that could create a
  // delivery the event has no channel for, and would silently contradict the
  // switch the superadmin set globally.
  const inappIds = [];
  const pushIds  = [];
  for (const id of ids) {
    const o = overrides[id];
    if (o && o.mute_all === true) continue;
    const choice = (o && o.events && o.events[type]) || 'inherit';
    if (choice === 'off') continue;
    if (globalInapp) inappIds.push(id);
    if (globalPush && choice !== 'inapp' && !(o && o.push_off === true)) pushIds.push(id);
  }
  return { inappIds, pushIds };
}

/**
 * Send a push with the admin's delivery preferences applied. Gating is the
 * caller's job (via resolveDelivery) — this only decorates and sends.
 * An explicit `requireInteraction` on the payload wins, because a caller that
 * asks for a sticky notification (a due callback) means it.
 */
async function pushNow(userIds, payload) {
  const ids = (Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean);
  if (!ids.length) return;
  const opts = await pushOptions();
  return sendPushToUsers(ids, {
    ...payload,
    requireInteraction: payload.requireInteraction === undefined
      ? opts.requireInteraction
      : payload.requireInteraction,
    vibrate: opts.vibrate,
    urgency: opts.urgency,
    ttl:     opts.ttl,
  });
}

module.exports = {
  eventPolicy,
  pushOptions,
  pushMutedNow,
  narrowToRoles,
  resolveDelivery,
  withSuperadmins,
  superadminIds,
  pushNow,
  inWindow,          // exported for tests — the midnight-crossing case is the point
  DEFAULT_POLICY,
};
