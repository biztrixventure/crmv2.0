/**
 * PresenceContext — app-wide real-time presence.
 *
 * One Supabase Realtime Presence channel ('presence:global') joined for the
 * entire login session — not just while chat is open — so "Active now" means
 * "in the CRM". Join/leave events propagate over the websocket in
 * milliseconds: opening a tab flips a user online instantly, and closing the
 * last tab / losing the connection flips them offline the moment the socket
 * drops. No polling.
 *
 *   - Multi-tab/device: every tab tracks its own meta under the same user key;
 *     presenceState()[id].length = live session count. A user is offline only
 *     when their LAST tab is gone.
 *   - Idle: no pointer/key input for 5 min or tab hidden → that tab re-tracks
 *     idle:true. A user is "idle" when every one of their sessions is idle.
 *   - Last seen: a lightweight heartbeat POST (~2 min, plus one keepalive beat
 *     on tab-hide) persists last_seen_at / page / device server-side, powering
 *     "Last seen 5 minutes ago" once they're offline and the admin activity
 *     aggregates (DAU/WAU/MAU, session time, module time).
 */
import { createContext, useContext, useState, useEffect, useRef, useMemo } from 'react';
import { supabase, setRealtimeAuth } from '../api/supabase';
import { useAuth } from './AuthContext';
import client from '../api/client';

const IDLE_AFTER_MS  = 5 * 60 * 1000;   // no input → idle
const HEARTBEAT_MS   = 2 * 60 * 1000;   // server last-seen granularity

const PresenceCtx = createContext({ onlineIds: new Set(), idleIds: new Set(), sessions: {}, pages: {} });
export const usePresenceContext = () => useContext(PresenceCtx);

// Compact "Chrome · Windows" style device label from the UA.
function deviceLabel() {
  const ua = navigator.userAgent;
  const browser =
    /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os =
    /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown OS';
  return `${browser} · ${os}`;
}

export const PresenceProvider = ({ children }) => {
  const { user, token } = useAuth();
  const [state, setState] = useState({ onlineIds: new Set(), idleIds: new Set(), sessions: {}, pages: {} });
  // Global kill-switch (superadmin). null = not yet known; we DON'T start the
  // subsystem until we've confirmed it's on, so a disabled deployment never even
  // opens the channel or beats once.
  const [enabled, setEnabled] = useState(null);
  const idleRef    = useRef(false);
  const lastInput  = useRef(Date.now());
  const channelRef = useRef(null);

  // Read the switch once per login session (tiny payload, cached server-side).
  useEffect(() => {
    if (!user?.id) { setEnabled(null); return; }
    let alive = true;
    client.get('presence/config')
      .then(r => { if (alive) setEnabled(r.data?.enabled !== false); })
      .catch(() => { if (alive) setEnabled(true); });  // fail open — keep current behavior
    return () => { alive = false; };
  }, [user?.id]);

  useEffect(() => {
    // Presence itself — the realtime channel (green dots) + event-driven last-seen
    // — ALWAYS runs while logged in. It's cheap on the DB: the channel is
    // in-memory on Supabase Realtime (no DB writes/connections), and last-seen is
    // a single-row upsert only on login / tab-show / tab-hide. The HEAVY part (the
    // 2-min aggregate heartbeat) lives in its own effect below, gated by the
    // monitor switch.
    if (!user?.id) { setState({ onlineIds: new Set(), idleIds: new Set(), sessions: {}, pages: {} }); return; }
    setRealtimeAuth(token || localStorage.getItem('token'));

    const ch = supabase.channel('presence:global', { config: { presence: { key: user.id } } });

    const sync = () => {
      const ps = ch.presenceState();   // { userId: [meta, meta…] }
      const onlineIds = new Set(Object.keys(ps));
      const idleIds = new Set();
      const sessions = {}, pages = {};
      for (const [id, metas] of Object.entries(ps)) {
        sessions[id] = metas.length;
        const activeMeta = metas.find(m => !m.idle) || metas[0];
        pages[id] = activeMeta?.page || null;
        if (metas.every(m => m.idle)) idleIds.add(id);
      }
      setState({ onlineIds, idleIds, sessions, pages });
    };

    // Minimal presence meta — every track() fans out to ALL subscribers, so
    // smaller payload = less egress at O(N) per event. user_id is already the
    // presence KEY; online_at + page are redundant (the 2-min server heartbeat
    // persists last_seen + last_page, which the admin panel reads). Only `idle`
    // needs to ride the websocket.
    const track = () => ch.track({ idle: idleRef.current }).catch(() => {});

    ch.on('presence', { event: 'sync' }, sync)
      .on('presence', { event: 'join' }, sync)
      .on('presence', { event: 'leave' }, sync)
      .subscribe((status) => { if (status === 'SUBSCRIBED') track(); });
    channelRef.current = ch;

    // ── Last-seen → server (single-row upsert; aggregates skipped server-side
    //    unless the monitor is on). Event-driven only here — no periodic timer. ──
    const beat = (extra = {}) => client.post('presence/heartbeat', {
      page:   window.location.pathname,
      device: deviceLabel(),
      idle:   idleRef.current,
      ...extra,
    }).catch(() => {});
    beat({ boot: true });                                   // session start (last_seen)

    // Final beat when the tab hides/closes — fetch keepalive survives unload,
    // Last-seen keepalive when the tab hides (tab switch / minimize). Stays
    // ONLINE (just idle) — switching tabs isn't leaving the CRM.
    const sendLastSeen = (idle) => {
      const tok = token || localStorage.getItem('token');
      try {
        fetch(`${client.defaults.baseURL.replace(/\/$/, '')}/presence/heartbeat`, {
          method: 'POST', keepalive: true,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
          body: JSON.stringify({ page: window.location.pathname, device: deviceLabel(), idle }),
        });
      } catch { /* best effort */ }
    };

    // Tab/page is actually GOING AWAY (close / navigate / refresh). Untrack now
    // so Supabase fires 'leave' to every watcher IMMEDIATELY — offline shows
    // instantly instead of waiting out the socket heartbeat timeout. Other tabs
    // of the same user keep them online (presence is keyed per user, one meta
    // per tab). Fires on pagehide + beforeunload for cross-browser coverage.
    let unloaded = false;
    const onUnload = () => {
      if (unloaded) return;
      unloaded = true;
      // Send a clean channel LEAVE (phx_leave), not just an untrack. unsubscribe
      // makes Supabase drop this connection's presence and broadcast 'leave'
      // immediately — works the same whether the tab was open 5s or 5min. untrack
      // alone could fail to flush, leaving the user "stuck online" until the
      // heartbeat timeout. Belt-and-suspenders: untrack first, then unsubscribe.
      try { ch.untrack(); } catch { /* socket may already be closing */ }
      try { ch.unsubscribe(); } catch { /* ignore */ }
      sendLastSeen(true);
    };

    // ── Idle detection: input activity + visibility ─────────────────────────
    const onActivity = () => {
      lastInput.current = Date.now();
      if (idleRef.current && !document.hidden) { idleRef.current = false; track(); }
    };
    const idleTimer = setInterval(() => {
      const shouldIdle = document.hidden || (Date.now() - lastInput.current > IDLE_AFTER_MS);
      if (shouldIdle !== idleRef.current) { idleRef.current = shouldIdle; track(); }
    }, 30_000);
    // Tab switch must NOT broadcast presence — alt-tabbing fanned a diff to
    // every user and was the dominant realtime egress driver. The 30s idleTimer
    // marks a genuinely-hidden tab idle; onActivity re-marks active on first
    // input. Here we only refresh the cheap server-side last-seen.
    const onVis = () => {
      if (document.hidden) {
        sendLastSeen(true);                                          // server only, no fan-out
      } else {
        lastInput.current = Date.now();
        if (idleRef.current) { idleRef.current = false; track(); }   // returned from idle → one diff
        beat();
      }
    };

    window.addEventListener('pointerdown', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity);
    window.addEventListener('mousemove', onActivity, { passive: true });
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onUnload);
    window.addEventListener('beforeunload', onUnload);

    return () => {
      clearInterval(idleTimer);
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('mousemove', onActivity);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onUnload);
      window.removeEventListener('beforeunload', onUnload);
      ch.untrack().catch(() => {});
      supabase.removeChannel(ch);
      channelRef.current = null;
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Periodic heartbeat → the activity-monitor aggregates (session minutes, DAU,
  // module time). This is the heavy, continuous per-user DB write, so it runs
  // ONLY while the monitor is ON. Off → presence (above) keeps dots + last-seen
  // with no recurring DB load.
  useEffect(() => {
    if (!user?.id || enabled !== true) return;
    const t = setInterval(() => {
      if (!document.hidden) client.post('presence/heartbeat', {
        page: window.location.pathname, device: deviceLabel(), idle: idleRef.current,
      }).catch(() => {});
    }, HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [user?.id, enabled]);

  const value = useMemo(() => ({ ...state, enabled }), [state, enabled]);
  return <PresenceCtx.Provider value={value}>{children}</PresenceCtx.Provider>;
};
