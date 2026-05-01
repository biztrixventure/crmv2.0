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

// ── Notification click ─────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // Focus existing tab if open
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.postMessage({ type: 'NOTIFICATION_CLICK', data });
          return;
        }
      }
      // Open new tab
      if (self.clients.openWindow) {
        self.clients.openWindow('/dashboard');
      }
    })
  );
});

// ── Install / activate ────────────────────────────────────────────────────
self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
