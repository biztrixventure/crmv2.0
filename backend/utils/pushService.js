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

// ── Build JSON payload string ─────────────────────────────────────────────────
function buildPayload({ title, body, icon, badge, tag, data = {}, requireInteraction = false }) {
  return JSON.stringify({
    title,
    body:               body || '',
    icon:               icon  || '/favicon.svg',
    badge:              badge || '/favicon.svg',
    tag:                tag   || 'biztrix-notification',
    data,
    requireInteraction,
    timestamp:          Date.now(),
  });
}

// ── Single send with 1 retry on transient error ───────────────────────────────
// Returns stale subscription id if the subscription is no longer valid, null otherwise.
async function trySend(sub, payloadStr, attempt = 0) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
      payloadStr,
      { TTL: 86400 }
    );
    return null;
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      return sub.id; // stale — caller will prune
    }
    // Retry once on server-side errors or rate limiting
    if (attempt === 0 && (!err.statusCode || err.statusCode >= 500 || err.statusCode === 429)) {
      await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));
      return trySend(sub, payloadStr, 1);
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

  const payloadStr = buildPayload(notifOpts);
  const staleIds   = [];

  await Promise.allSettled(
    subs.map(sub =>
      runLimited(() => trySend(sub, payloadStr)).then(staleId => {
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

  const payloadStr = buildPayload(notifOpts);
  const staleIds   = [];

  await Promise.allSettled(
    allSubs.map(sub =>
      runLimited(() => trySend(sub, payloadStr)).then(staleId => {
        if (staleId) staleIds.push(staleId);
      })
    )
  );

  await pruneStale(staleIds, allSubs);
}

module.exports = { sendPushToUser, sendPushToUsers };
