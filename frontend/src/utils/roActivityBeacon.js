// ============================================================================
// roActivityBeacon — batches a readonly_admin's navigation telemetry (tab
// opens, record views, blocked copies) and flushes it to /api/activity/beacon
// on a timer + on pagehide (navigator.sendBeacon). Soft, best-effort signal:
// the superadmin's activity timeline merges it with the HARD server-side
// signals (exports, blocked writes). A handful of writes per session, never
// per interaction, so it never gets in the way.
//
// Import once (AdminPanel) and call roBeacon.push({...}) at capture points.
// ============================================================================
import client from '../api/client';

const QUEUE = [];
const FLUSH_MS = 8000;
let timer = null;
let installed = false;

function apiBase() {
  // client.defaults.baseURL already ends with /api (or the configured value).
  return (client.defaults?.baseURL || '/api').replace(/\/$/, '');
}

async function flush(useBeacon = false) {
  if (!QUEUE.length) return;
  const events = QUEUE.splice(0, QUEUE.length);
  const payload = JSON.stringify({ events });
  try {
    if (useBeacon) {
      // On pagehide use a keepalive fetch with the auth token (sendBeacon can't
      // set Authorization). If no token, drop — losing a few nav events is fine.
      const token = localStorage.getItem('token');
      if (token) {
        await fetch(`${apiBase()}/activity/beacon`, {
          method: 'POST', keepalive: true,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: payload,
        });
      }
      return;
    }
    await client.post('activity/beacon', { events });
  } catch { /* best-effort telemetry — never surface an error to the RO */ }
}

function ensureTimer() {
  if (timer) return;
  timer = setInterval(() => flush(false), FLUSH_MS);
}

export const roBeacon = {
  // Enable batching + install the pagehide flush once. No-op if already done.
  install() {
    if (installed) return;
    installed = true;
    ensureTimer();
    window.addEventListener('pagehide', () => flush(true));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(false); });
  },
  push(evt) {
    if (!evt || !evt.action_type) return;
    QUEUE.push(evt);
    if (QUEUE.length >= 25) flush(false);   // cap in-memory backlog
  },
  tabOpen(tabId)                         { this.push({ action_type: 'tab_open', surface: tabId }); },
  recordView(dataset, recordId, surface) { this.push({ action_type: 'record_view', dataset, record_id: recordId, surface }); },
  copyBlocked(surface)                   { this.push({ action_type: 'copy_blocked', surface }); },
};
