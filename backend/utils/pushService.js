/**
 * Push Notification Service
 * Sends Web Push (VAPID) notifications to subscribed browsers.
 *
 * Scalability fixes for 350+ simultaneous users:
 *   - Concurrency limiter (MAX_CONCURRENT=40): caps simultaneous HTTPS
 *     connections to push services. Without this, 350 users × 2 devices =
 *     700 concurrent connections → ERR_CONNECTION_CLOSED.
 *   - Subscription cache (SUB_CACHE_TTL=5 min): avoids N individual DB queries
 *     when notifying many users at once; sendPushToUsers does ONE batch query.
 *   - Retry (1 attempt): handles transient 429/5xx from push services.
 */
const webpush = require('web-push');
const { supabaseAdmin } = require('../config/database');
const logger = require('./logger');
const { getConfig } = require('./businessConfig');

const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT     = process.env.VAPID_SUBJECT || 'mailto:admin@biztrixventure.com';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  logger.warn('PUSH', 'VAPID keys not set — web push disabled');
}

// ── Subscription cache ────────────────────────────────────────────────────────
const subCache      = new Map(); // userId → { subs: Array, expiresAt: number }
const SUB_CACHE_TTL = 5 * 60 * 1000;

const getCachedSubs = (userId) => {
  const entry = subCache.get(userId);
  if (entry && Date.now() < entry.expiresAt) return entry.subs;
  subCache.delete(userId);
  return null;
};
const setCachedSubs = (userId, subs) =>
  subCache.set(userId, { subs, expiresAt: Date.now() + SUB_CACHE_TTL });
const invalidateSub = (userId) => subCache.delete(userId);

// Prune expired cache entries
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of subCache) if (now > v.expiresAt) subCache.delete(k);
}, SUB_CACHE_TTL).unref();

// ── Concurrency limiter ───────────────────────────────────────────────────────
const MAX_CONCURRENT = 40;
let   activeCount    = 0;
const pushQueue      = [];

function runLimited(fn) {
  return new Promise((resolve, reject) => {
    pushQueue.push({ fn, resolve, reject });
    drainQueue();
  });
}
function drainQueue() {
  while (activeCount < MAX_CONCURRENT && pushQueue.length > 0) {
    const { fn, resolve, reject } = pushQueue.shift();
    activeCount++;
    fn()
      .then(resolve, reject)
      .finally(() => { activeCount--; drainQueue(); });
  }
}

// ── Notification icon ─────────────────────────────────────────────────────────
// The OS was showing a generic browser glyph instead of the configured logo,
// and the reason is a detail that is easy to miss: NOBODY was sending an icon.
// Every push fell through to sw.js's '/favicon.svg' default — and Chrome on
// Windows, which is 310 of the 318 subscribed devices here, does not render SVG
// notification icons at all. A PNG is required.
//
// So the icon is resolved here, at the one choke point every push passes
// through, rather than at each of the call sites (which would guarantee one of
// them is forgotten). Order matches what an admin would expect: the PWA icons
// they uploaded, then the branding favicon, then the built-in fallback.
//
// Cached for a minute: this runs per push, and a logo does not change often.
let iconCache = { at: 0, icon: null };
const ICON_TTL = 60_000;

const isSvg = (u) => /\.svg(\?|#|$)/i.test(String(u || ''));

async function brandIcon() {
  if (iconCache.icon && Date.now() - iconCache.at < ICON_TTL) return iconCache.icon;
  let icon = null;
  try {
    const [pwa, branding] = await Promise.all([
      getConfig(null, 'pwa', null),
      getConfig(null, 'branding', null),
    ]);
    const i = (pwa && pwa.install) || {};
    const b = branding || {};
    // 192 before 512: notification icons render around 64–128px, so the smaller
    // asset is the better fit and the cheaper download on a phone.
    const candidates = [i.icon_192, i.icon_512, i.icon_maskable, b.favicon_url].filter(Boolean);
    // An SVG here would silently show nothing on Windows, so it is only taken
    // when there is no raster alternative at all.
    icon = candidates.find(u => !isSvg(u)) || candidates[0] || null;
  } catch { /* fall through to the built-in default */ }

  const resolved = icon || '/favicon.svg';
  if (icon) iconCache = { at: Date.now(), icon: resolved };
  return resolved;
}

// ── Build JSON payload string ─────────────────────────────────────────────────
// `vibrate` is part of the PAYLOAD (the service worker reads it); `urgency` and
// `ttl` are transport options for the push service itself, so they are split
// out into sendOptions() below rather than serialized here.
function buildPayload({ title, body, icon, badge, tag, data = {}, requireInteraction = false, vibrate }) {
  return JSON.stringify({
    title,
    body:               body || '',
    icon:               icon  || '/favicon.svg',
    // The badge is the small monochrome glyph in an Android status bar; Windows
    // ignores it. Falling back to the same icon is better than the SVG default,
    // which renders as nothing.
    badge:              badge || icon || '/favicon.svg',
    tag:                tag   || 'biztrix-notification',
    data,
    requireInteraction,
    // Only emit the key when the caller has an opinion, so a payload built the
    // old way stays byte-identical and the worker keeps its own default pattern.
    ...(vibrate === undefined ? {} : { vibrate: vibrate ? [200, 100, 200] : [] }),
    timestamp:          Date.now(),
  });
}

// TTL: how long the push service holds an undelivered message for a device that
// is offline. Urgency: how hard it tries to wake one that is asleep. The
// defaults are exactly what this file has always sent.
const VALID_URGENCY = ['very-low', 'low', 'normal', 'high'];
function sendOptions({ ttl, urgency } = {}) {
  const n = Number(ttl);
  return {
    TTL: Number.isFinite(n) && n >= 0 ? n : 86400,
    ...(VALID_URGENCY.includes(urgency) ? { urgency } : {}),
  };
}

// ── Single send with 1 retry on transient error ───────────────────────────────
// Returns stale subscription id if the subscription is no longer valid, null otherwise.
async function trySend(sub, payloadStr, opts = { TTL: 86400 }, attempt = 0) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
      payloadStr,
      opts
    );
    return null;
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      return sub.id; // stale — caller will prune
    }
    // Retry once on server-side errors or rate limiting
    if (attempt === 0 && (!err.statusCode || err.statusCode >= 500 || err.statusCode === 429)) {
      await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));
      return trySend(sub, payloadStr, opts, 1);
    }
    logger.warn('PUSH', `Push failed sub ${sub.id}: ${err.message}`);
    return null;
  }
}

// ── Prune stale subscriptions and invalidate cache ───────────────────────────
async function pruneStale(staleIds, allSubs) {
  if (!staleIds.length) return;
  try {
    const staleUsers = [...new Set(
      allSubs.filter(s => staleIds.includes(s.id)).map(s => s.user_id)
    )];
    staleUsers.forEach(invalidateSub);
    await supabaseAdmin.from('push_subscriptions').delete().in('id', staleIds);
    logger.info('PUSH', `Pruned ${staleIds.length} stale sub(s) across ${staleUsers.length} user(s)`);
  } catch (err) {
    logger.warn('PUSH', `Failed to prune stale subs: ${err.message}`);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Send push to a single user's subscribed devices.
 * Uses cached subscriptions; fetches from DB on cache miss.
 */
async function sendPushToUser(userId, notifOpts) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;

  let subs = getCachedSubs(userId);
  if (!subs) {
    const { data, error } = await supabaseAdmin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth_key')
      .eq('user_id', userId);
    if (error || !data?.length) return;
    subs = data;
    setCachedSubs(userId, subs);
  }
  if (!subs.length) return;

  // An explicit icon from the caller still wins; otherwise every push now
  // carries the configured logo instead of an unrenderable SVG default.
  const payloadStr = buildPayload({ ...notifOpts, icon: notifOpts.icon || await brandIcon() });
  const opts       = sendOptions(notifOpts);
  const staleIds   = [];

  await Promise.allSettled(
    subs.map(sub =>
      runLimited(() => trySend(sub, payloadStr, opts)).then(staleId => {
        if (staleId) staleIds.push(staleId);
      })
    )
  );

  await pruneStale(staleIds, subs.map(s => ({ ...s, user_id: userId })));
}

/**
 * Send push to multiple users at once.
 * Fetches ALL subscriptions in a single batch DB query (not N individual queries).
 */
async function sendPushToUsers(userIds, notifOpts) {
  if (!userIds?.length || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;

  const { data: allSubs, error } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth_key')
    .in('user_id', userIds);

  if (error || !allSubs?.length) return;

  // Populate per-user cache from the batch result
  const byUser = {};
  for (const sub of allSubs) {
    (byUser[sub.user_id] = byUser[sub.user_id] || []).push(sub);
  }
  for (const [uid, subs] of Object.entries(byUser)) setCachedSubs(uid, subs);

  // An explicit icon from the caller still wins; otherwise every push now
  // carries the configured logo instead of an unrenderable SVG default.
  const payloadStr = buildPayload({ ...notifOpts, icon: notifOpts.icon || await brandIcon() });
  const opts       = sendOptions(notifOpts);
  const staleIds   = [];

  await Promise.allSettled(
    allSubs.map(sub =>
      runLimited(() => trySend(sub, payloadStr, opts)).then(staleId => {
        if (staleId) staleIds.push(staleId);
      })
    )
  );

  await pruneStale(staleIds, allSubs);
}

module.exports = { sendPushToUser, sendPushToUsers };
