/**
 * BizTrix CRM — Service Worker
 * Handles Web Push notifications from the server (VAPID).
 * Shows OS-level notifications in Windows/macOS/Android notification center.
 */

// ── Push received from server ──────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = {};
  try { payload = event.data.json(); } catch { payload = { title: 'BizTrix', body: event.data.text() }; }

  const title   = payload.title || 'BizTrix CRM';

  // Use a unique tag per notification so each one fires a fresh OS sound.
  // Static tags cause the OS to silently replace the previous notification.
  const tag = payload.tag
    ? `${payload.tag}-${Date.now()}`
    : `biztrix-${Date.now()}`;

  const options = {
    body:               payload.body    || '',
    icon:               payload.icon    || '/favicon.svg',
    badge:              '/favicon.svg',
    tag,
    renotify:           true,   // always trigger OS sound even if same tag somehow repeats
    silent:             false,  // explicit: let OS play notification sound
    data:               payload.data    || {},
    vibrate:            [200, 100, 200],
    requireInteraction: payload.requireInteraction || false,
    actions:            payload.actions || [],
    timestamp:          payload.timestamp || Date.now(),
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      // Notify all open tabs to play in-page sound + update bell
      self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then(clients => {
        clients.forEach(client => client.postMessage({ type: 'PUSH_RECEIVED', payload }));
      }),
    ])
  );
});

// Mirror of resolveNotificationTarget() — kept tiny + dependency-free so the SW
// can build a cold-open deep link. Keep in sync with utils/notificationNav.js.
function focusParamsFromData(data) {
  const d = data || {};
  const type = String(d.type || '').toLowerCase();
  if (d.callback_id || type.includes('callback_due') || type === 'callback') return { fkind: 'callback', fid: d.callback_id };
  if (d.callback_number_id || type === 'number_claimable')                   return { fkind: 'number',   fid: d.callback_number_id };
  if (d.sale_id || type.indexOf('sale') === 0)                               return { fkind: 'sale',     fid: d.sale_id };
  if (d.transfer_id || type.indexOf('transfer') === 0)                       return { fkind: 'transfer', fid: d.transfer_id };
  if (d.conversation_id || d.chat_id || type.includes('chat') || type.includes('message')) return { fkind: 'chat', fid: d.conversation_id || d.chat_id };
  return null;
}

// ── Notification click ─────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // Focus existing tab if open — the page handles NOTIFICATION_CLICK live.
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.postMessage({ type: 'NOTIFICATION_CLICK', data });
          return;
        }
      }
      // No tab open → cold open with a deep link the app consumes on load.
      if (self.clients.openWindow) {
        const fp = focusParamsFromData(data);
        const url = fp && fp.fid
          ? `/dashboard?fkind=${encodeURIComponent(fp.fkind)}&fid=${encodeURIComponent(fp.fid)}`
          : '/dashboard';
        self.clients.openWindow(url);
      }
    })
  );
});

// ── Install / activate ────────────────────────────────────────────────────
self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
