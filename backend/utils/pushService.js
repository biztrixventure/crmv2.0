/**
 * Push Notification Service
 * Sends Web Push (VAPID) notifications to subscribed browsers.
 * Notifications appear in the OS notification center (Windows, macOS, Android, etc.)
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

/**
 * Send a push notification to all subscriptions for a user.
 * Automatically removes stale/expired subscriptions from DB.
 */
async function sendPushToUser(userId, { title, body, icon, tag, data = {} }) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;

  const { data: subs, error } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth_key')
    .eq('user_id', userId);

  if (error || !subs?.length) return;

  const payload = JSON.stringify({
    title,
    body,
    icon:  icon  || '/favicon.svg',
    badge: '/favicon.svg',
    tag:   tag   || 'biztrix-notification',
    data,
    timestamp: Date.now(),
  });

  const staleIds = [];

  await Promise.allSettled(subs.map(async sub => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
        payload,
        { TTL: 86400 } // 24h TTL
      );
    } catch (err) {
      // 410 Gone or 404 = subscription is no longer valid
      if (err.statusCode === 410 || err.statusCode === 404) {
        staleIds.push(sub.id);
      } else {
        logger.warn('PUSH', `Push failed for sub ${sub.id}: ${err.message}`);
      }
    }
  }));

  // Prune stale subscriptions
  if (staleIds.length > 0) {
    await supabaseAdmin.from('push_subscriptions').delete().in('id', staleIds);
    logger.info('PUSH', `Pruned ${staleIds.length} stale subscription(s)`);
  }
}

/**
 * Send push to multiple users at once.
 */
async function sendPushToUsers(userIds, payload) {
  await Promise.allSettled(userIds.map(uid => sendPushToUser(uid, payload)));
}

module.exports = { sendPushToUser, sendPushToUsers };
