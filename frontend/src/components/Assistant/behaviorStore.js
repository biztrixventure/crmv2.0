/**
 * behaviorStore — framework-agnostic behavior tracking core for the CRM mascot.
 * No AI: just lightweight rolling counters + recent-event log persisted to
 * localStorage, with multi-tab sync (BroadcastChannel) and idle detection.
 *
 * Public API:
 *   track(type, meta)      record an event   (e.g. track('lead_opened', { lead_id }))
 *   getData()              computed snapshot the rule engine reads
 *   subscribe(fn)          notified on change; returns an unsubscribe fn
 *   markTipShown(id)       remember the last tip + when
 *   markTipIgnored(id)     suppress a tip the user dismissed
 *   setPage(name)          current route context
 *   resetIdle()           mark activity now
 */

const DATA_KEY = 'crm_assistant_behavior_v1';
const CHANNEL  = 'crm_assistant';
const RECENT_CAP = 50;
const isBrowser = typeof window !== 'undefined';

const todayKey = () => new Date().toISOString().slice(0, 10);

const DEFAULT = {
  recent: [],            // [{ type, ts, meta }]
  missedCallbacks: 0,
  notesAdded: 0,
  leadsOpened: 0,
  pageVisits: {},        // { [page]: count }
  ignoredTips: {},       // { [tipId]: ts }
  lastTipId: null,
  lastTipAt: 0,
  day: todayKey(),
  eventsToday: 0,
};

let state = load();
let lastActivity = Date.now();
let page = 'unknown';
const listeners = new Set();
let saveTimer = null;
let bc = null;

function load() {
  if (!isBrowser) return { ...DEFAULT };
  try {
    const raw = localStorage.getItem(DATA_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const merged = { ...DEFAULT, ...parsed, pageVisits: { ...(parsed.pageVisits || {}) }, ignoredTips: { ...(parsed.ignoredTips || {}) } };
    if (merged.day !== todayKey()) { merged.day = todayKey(); merged.eventsToday = 0; }  // daily roll-over
    return merged;
  } catch { return { ...DEFAULT }; }
}

// Debounced persist (avoid hammering localStorage on bursty events).
function save() {
  if (!isBrowser) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(DATA_KEY, JSON.stringify(state)); } catch { /* quota */ }
  }, 300);
}

function notify() { listeners.forEach(fn => { try { fn(); } catch { /* ignore */ } }); }

// ── multi-tab sync ──────────────────────────────────────────────────────────
if (isBrowser && 'BroadcastChannel' in window) {
  bc = new BroadcastChannel(CHANNEL);
  bc.onmessage = (e) => {
    if (e?.data?.type === 'sync') { state = load(); notify(); }
  };
}
function broadcast() { try { bc?.postMessage({ type: 'sync' }); } catch { /* ignore */ } }

// ── activity / idle ─────────────────────────────────────────────────────────
let activityThrottle = 0;
function onActivity() {
  const now = Date.now();
  if (now - activityThrottle < 1000) { lastActivity = now; return; }
  activityThrottle = now;
  lastActivity = now;
}
if (isBrowser) {
  ['pointerdown', 'keydown', 'mousemove', 'wheel', 'touchstart'].forEach(ev =>
    window.addEventListener(ev, onActivity, { passive: true }));
}

// ── public API ────────────────────────────────────────────────────────────────
export function resetIdle() { lastActivity = Date.now(); }

export function setPage(name) {
  if (!name || name === page) return;
  page = name;
  state.pageVisits[name] = (state.pageVisits[name] || 0) + 1;
  save(); notify();
}

export function track(type, meta = {}) {
  if (!type) return;
  const ts = Date.now();
  state.recent.unshift({ type, ts, meta });
  if (state.recent.length > RECENT_CAP) state.recent.length = RECENT_CAP;
  state.eventsToday += 1;
  if (type === 'callback_missed') state.missedCallbacks += 1;
  if (type === 'callback_done')   state.missedCallbacks = Math.max(0, state.missedCallbacks - 1);
  if (type === 'note_added')      state.notesAdded += 1;
  if (type === 'lead_opened')     state.leadsOpened += 1;
  lastActivity = ts;
  save(); broadcast(); notify();
}

export function markTipShown(id) {
  state.lastTipId = id;
  state.lastTipAt = Date.now();
  save();
}

export function markTipIgnored(id) {
  if (!id) return;
  state.ignoredTips[id] = Date.now();
  save(); notify();
}

export function getData() {
  const idleTime = Math.floor((Date.now() - lastActivity) / 1000);
  const recentTypes = state.recent.slice(0, 12).map(r => r.type);
  return {
    page,
    idleTime,
    missedCallbacks: state.missedCallbacks,
    notesAdded: state.notesAdded,
    leadsOpened: state.leadsOpened,
    pageVisits: state.pageVisits,
    eventsToday: state.eventsToday,
    recent: state.recent,
    recentTypes,
    ignoredTips: state.ignoredTips,
    lastTipId: state.lastTipId,
    lastTipAt: state.lastTipAt,
  };
}

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
