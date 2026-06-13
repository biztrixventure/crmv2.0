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
  const idleRef    = useRef(false);
  const lastInput  = useRef(Date.now());
  const channelRef = useRef(null);

  useEffect(() => {
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

    const track = () => ch.track({
      user_id:   user.id,
      online_at: new Date().toISOString(),
      idle:      idleRef.current,
      page:      window.location.pathname,
    }).catch(() => {});

    ch.on('presence', { event: 'sync' }, sync)
      .on('presence', { event: 'join' }, sync)
      .on('presence', { event: 'leave' }, sync)
      .subscribe((status) => { if (status === 'SUBSCRIBED') track(); });
    channelRef.current = ch;

    // ── Heartbeat → server (last seen + daily aggregates) ──────────────────
    const beat = (extra = {}) => client.post('presence/heartbeat', {
      page:   window.location.pathname,
      device: deviceLabel(),
      idle:   idleRef.current,
      ...extra,
    }).catch(() => {});
    beat({ boot: true });                                   // session start
    const beatTimer = setInterval(() => { if (!document.hidden) beat(); }, HEARTBEAT_MS);

    // Final beat when the tab hides/closes — fetch keepalive survives unload,
    // so "last seen" is accurate to the second they left, not the last timer.
    const onHide = () => {
      if (!document.hidden) return;
      idleRef.current = true; track();
      const tok = token || localStorage.getItem('token');
      try {
        fetch(`${client.defaults.baseURL.replace(/\/$/, '')}/presence/heartbeat`, {
          method: 'POST', keepalive: true,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
          body: JSON.stringify({ page: window.location.pathname, device: deviceLabel(), idle: true }),
        });
      } catch { /* best effort */ }
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
    const onVis = () => { if (document.hidden) onHide(); else { idleRef.current = false; track(); beat(); } };

    window.addEventListener('pointerdown', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity);
    window.addEventListener('mousemove', onActivity, { passive: true });
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onHide);

    return () => {
      clearInterval(beatTimer); clearInterval(idleTimer);
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('mousemove', onActivity);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onHide);
      ch.untrack().catch(() => {});
      supabase.removeChannel(ch);
      channelRef.current = null;
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo(() => state, [state]);
  return <PresenceCtx.Provider value={value}>{children}</PresenceCtx.Provider>;
};
