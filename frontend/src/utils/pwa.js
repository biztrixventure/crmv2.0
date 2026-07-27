// ============================================================================
// pwa.js — boot-time service-worker registration and install-prompt capture.
//
// Two jobs, one module, because they share the same public config read and the
// same "only if the superadmin turned it on" rule.
//
// REGISTRATION. Until now the worker was registered by usePushNotifications
// only AFTER a notification permission grant. An app-shell worker has to be
// there at boot, which changes WHO has a worker — including people who declined
// notifications. That is exactly why it is gated on `enabled` from
// GET /api/pwa/public: with the switch off, nothing here registers anything and
// boot is byte-identical to before.
//
// WHAT OFF DOES NOT DO: it does not unregister an existing worker. A user who
// granted notifications has a worker precisely so push can reach them, and
// tearing it down would silently kill their notifications — a much bigger
// change than declining to add caching. The worker's own caching is already
// gated on the same flag it re-reads on activate, so with the switch off a
// leftover worker caches nothing. Off is off without collateral damage.
//
// INSTALL PROMPT. `beforeinstallprompt` can fire before React mounts, so the
// listener is installed from main.jsx ahead of the first render and the event
// is parked here. Chrome also only lets you call prompt() from inside a user
// gesture, and only once per captured event — so the deferred event is dropped
// after use rather than reused, which would throw.
// ============================================================================

let deferredPrompt = null;
let installed = false;
let publicFlags = null;
const listeners = new Set();

const emit = () => listeners.forEach(fn => { try { fn(); } catch { /* a bad listener is not our problem */ } });

/** True when the app is already running as an installed PWA. */
export function isStandalone() {
  try {
    return window.matchMedia?.('(display-mode: standalone)')?.matches
      || window.navigator.standalone === true;
  } catch { return false; }
}

/** Can we offer an install right now? */
export function canInstall() {
  return Boolean(deferredPrompt) && !installed && !isStandalone();
}

/**
 * The public config, fetched once and shared. initPwa() already reads it at
 * boot, so this hands out that same answer instead of making a second request.
 * Returns null until it lands — callers treat null as "don't know yet" and show
 * nothing, which is the right way round for an affordance nobody asked for.
 */
export function getFlags() {
  return publicFlags;
}

export async function loadFlags() {
  if (publicFlags) return publicFlags;
  try {
    const r = await fetch('/api/pwa/public', { cache: 'no-store' });
    if (r.ok) { publicFlags = await r.json(); emit(); }
  } catch { /* stays null — the prompt simply does not appear */ }
  return publicFlags;
}

/** Subscribe to install-availability changes. Returns an unsubscribe function. */
export function subscribeInstall(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Show the browser's install dialog. Must be called from a user gesture.
 * Resolves to 'accepted' | 'dismissed' | 'unavailable'.
 */
export async function promptInstall() {
  const e = deferredPrompt;
  if (!e) return 'unavailable';
  // Dropped BEFORE awaiting: a captured beforeinstallprompt can only be used
  // once, and a double-click would otherwise throw on the second call.
  deferredPrompt = null;
  emit();
  try {
    e.prompt();
    const { outcome } = await e.userChoice;
    return outcome || 'dismissed';
  } catch {
    return 'unavailable';
  }
}

let started = false;

/**
 * Called once from main.jsx, before React renders.
 * Listener registration is synchronous; the network-gated service-worker
 * registration happens after load so it never competes with first paint.
 */
export function initPwa() {
  if (started || typeof window === 'undefined') return;
  started = true;

  window.addEventListener('beforeinstallprompt', (e) => {
    // Without preventDefault the browser shows its own mini-infobar and the
    // event cannot be replayed later from our own button.
    e.preventDefault();
    deferredPrompt = e;
    emit();
  });

  window.addEventListener('appinstalled', () => {
    installed = true;
    deferredPrompt = null;
    emit();
  });

  const boot = () => { registerIfEnabled().catch(() => {}); };
  if (document.readyState === 'complete') boot();
  else window.addEventListener('load', boot, { once: true });
}

async function registerIfEnabled() {
  if (!('serviceWorker' in navigator)) return;

  // Shared with the install affordance rather than fetched twice.
  const flags = await loadFlags();
  // No config, no assumptions. Registering a worker on a failed read would be
  // choosing the irreversible option on the strength of a network error.
  if (!flags?.enabled) return;

  let reg;
  try {
    reg = await navigator.serviceWorker.register('/sw.js');
  } catch {
    return;
  }

  // Auto-update, when the superadmin has asked for it. Off by default, because
  // activating a new worker mid-session can swap the bundle under someone
  // filling in a form — the UpdateBanner exists to make that a deliberate click.
  if (flags.auto_update) {
    const applyWaiting = (worker) => {
      if (!worker) return;
      worker.postMessage({ type: 'SKIP_WAITING' });
    };
    if (reg.waiting) applyWaiting(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const next = reg.installing;
      if (!next) return;
      next.addEventListener('statechange', () => {
        if (next.state === 'installed' && navigator.serviceWorker.controller) applyWaiting(next);
      });
    });
    // Reload once the new worker is actually in control, so the page that comes
    // back is served by it rather than the outgoing one.
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  }
}

// A dismissal is remembered for a month rather than forever: someone who says
// "not now" on a shared desktop should not be silently opted out for good.
const DISMISS_KEY = 'biztrix.pwaInstallDismissed';
const DISMISS_MS  = 30 * 24 * 60 * 60 * 1000;

export function isInstallDismissed() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < DISMISS_MS;
  } catch { return false; }
}

export function dismissInstall() {
  try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* private mode */ }
  emit();
}
