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

// ═══════════════════════════════════════════════════════════════════════════
// App-shell caching — everything below is ADDITIVE to the push layer above.
// The push handlers stay first and untouched on purpose: they shipped first and
// are load-bearing, so if this caching layer ever has to be ripped out, push
// keeps working without being edited.
//
// THE RULE THAT CANNOT BE BROKEN: /api is NEVER cached. This is a live
// multi-tenant CRM — a cached authenticated response replayed to the wrong
// tenant, or after a permission change, is a data-leak class bug. Every /api
// request is network-only: no fallback, no exceptions.
//
// Caching also stays OFF unless the superadmin enabled it, so a fresh install
// behaves exactly as it did before this file grew.
// ═══════════════════════════════════════════════════════════════════════════

const CACHE_PREFIX = 'bsx-shell-v';
const OFFLINE_URL  = '/offline.html';

// Bumped server-side when caching config changes; re-read on activate so an
// existing worker adopts the new rules instead of holding the old ones forever.
let cacheVersion = 1;
let cachingOn    = false;
let offlineOn    = true;

const cacheName = () => `${CACHE_PREFIX}${cacheVersion}`;

async function loadConfig() {
  try {
    const res = await fetch('/api/pwa/public', { cache: 'no-store' });
    if (!res.ok) return;
    const cfg = await res.json();
    cacheVersion = Number(cfg.cache_version) || 1;
    cachingOn    = !!cfg.enabled && !!cfg.cache_enabled;
    offlineOn    = !!cfg.offline_fallback;
  } catch {
    // Network down at activate: stay conservative and serve nothing from cache.
    cachingOn = false;
  }
}

// ── Install ────────────────────────────────────────────────────────────────
// The unconditional skipWaiting() is gone. The old worker called it on every
// install, which — now that this file also controls caching — could swap the
// app bundle under someone mid-form. The PAGE decides now, via the SKIP_WAITING
// message, so this reconciles with the existing useVersionCheck()/UpdateBanner
// prompt instead of racing it.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await loadConfig();
    if (!cachingOn || !offlineOn) return;
    try {
      const cache = await caches.open(cacheName());
      await cache.addAll([OFFLINE_URL]);
    } catch { /* the offline page is a nicety, never a reason to fail install */ }
  })());
});

// ── Activate ───────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await loadConfig();
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== cacheName())
          .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// ── Message channel ────────────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  const type = event.data && event.data.type;
  if (type === 'SKIP_WAITING') self.skipWaiting();
  if (type === 'CLEAR_CACHES') {
    event.waitUntil(caches.keys().then(ks =>
      Promise.all(ks.filter(k => k.startsWith(CACHE_PREFIX)).map(k => caches.delete(k)))));
  }
});

// ── Fetch ──────────────────────────────────────────────────────────────────
const isApi = (url) =>
  url.pathname.startsWith('/api/') ||
  url.pathname === '/manifest.webmanifest';   // always fresh: it IS config

// Build output is content-hashed and therefore immutable, so cache-first is
// safe there — and that is where nearly all of the offline benefit comes from.
const isHashedAsset = (url) =>
  url.pathname.startsWith('/assets/') &&
  /\.[a-zA-Z0-9_-]{8,}\.(js|css|woff2?|png|svg|jpg|jpeg|webp)$/.test(url.pathname);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                  // never touch writes

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;   // third-party: not ours to manage

  // THE INVARIANT. Returning without respondWith leaves it a plain network
  // request, which is exactly what an authenticated, tenant-scoped call needs.
  if (isApi(url)) return;

  if (!cachingOn) return;

  // Navigations: network-first. index.html carries per-request branding/OG meta
  // injected by server.cjs, so a cached copy goes stale the moment branding
  // changes — but a stale shell still beats a dinosaur when the network is out.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(cacheName());
        cache.put(req, fresh.clone()).catch(() => {});
        return fresh;
      } catch {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (offlineOn) {
          const offline = await caches.match(OFFLINE_URL);
          if (offline) return offline;
        }
        throw new Error('offline');
      }
    })());
    return;
  }

  if (isHashedAsset(url)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const fresh = await fetch(req);
      if (fresh.ok) {
        const cache = await caches.open(cacheName());
        cache.put(req, fresh.clone()).catch(() => {});
      }
      return fresh;
    })());
  }
});
