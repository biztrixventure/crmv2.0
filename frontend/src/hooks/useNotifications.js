/**
 * useNotifications
 * Fetches in-app notifications via REST + subscribes to Supabase Realtime
 * for instant delivery. Plays a soft sound on new notification.
 *
 * Scalability design (handles 350+ simultaneous users):
 *   - Jittered poll interval (30–42 s) breaks up thundering-herd bursts where
 *     all clients would otherwise fire at the exact same second.
 *   - In-flight guard: a background poll that arrives while a fetch is already
 *     running is silently dropped rather than opening a second connection.
 *   - AbortController: stale in-flight requests are cancelled on unmount or
 *     when the next fetch starts, freeing server connections immediately.
 *   - Exponential back-off (15 s → 30 s → 60 s → 120 s cap): if the server
 *     returns errors, clients slow down automatically instead of hammering.
 *   - Visibility-aware: polling pauses when the browser tab is hidden and
 *     resumes with an immediate fetch on tab focus.
 *
 * Reliability improvements:
 *   - uid sourced from AuthContext (not localStorage parse) so Realtime
 *     subscribes reliably on login and tears down cleanly on logout.
 *   - Realtime channel auto-reconnects on CHANNEL_ERROR / TIMED_OUT with
 *     jittered backoff to avoid thundering herd on reconnect.
 *   - SW push listener triggers immediate fetch when OS push arrives, so the
 *     notification appears instantly even if Realtime is momentarily slow.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import client from '../api/client';
import { supabase, setRealtimeAuth } from '../api/supabase';
import { useAuth } from '../contexts/AuthContext';

// Tiny sound via Web Audio API
export function playNotificationSound() {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.35);
  } catch { /* browsers that block audio */ }
}

const POLL_BASE   = 30_000;
const POLL_JITTER = 12_000;

export const useNotifications = () => {
  const { user, token } = useAuth();

  const [notifications, setNotifications] = useState([]);
  const [unreadCount,   setUnreadCount]   = useState(0);
  const [loading,       setLoading]       = useState(false);

  const channelRef  = useRef(null);
  const abortRef    = useRef(null);
  const fetchingRef = useRef(false);
  const backoffRef  = useRef(0);
  const pollRef     = useRef(null);
  const retryRef    = useRef(null);  // Realtime channel reconnect timer
  // Keep latest token accessible in effects without re-running them on refresh.
  // AuthContext already calls setRealtimeAuth(newToken) on every refresh,
  // so effects don't need to react to token changes.
  const tokenRef    = useRef(token);
  useEffect(() => { tokenRef.current = token; }, [token]);

  // ── Core fetch ──────────────────────────────────────────────────────────────
  const fetchNotifications = useCallback(async (silent = false) => {
    if (silent && fetchingRef.current) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    fetchingRef.current = true;
    if (!silent) setLoading(true);

    try {
      const res = await client.get('notifications', {
        params: { limit: 40 },
        signal: abortRef.current.signal,
      });
      setNotifications(res.data.notifications || []);
      setUnreadCount(res.data.unread_count    || 0);
      backoffRef.current = 0;
    } catch (err) {
      if (err?.code !== 'ERR_CANCELED' && err?.name !== 'CanceledError') {
        backoffRef.current = backoffRef.current
          ? Math.min(backoffRef.current * 2, 120_000)
          : 15_000;
      }
    } finally {
      fetchingRef.current = false;
      if (!silent) setLoading(false);
    }
  }, []);

  // ── Jittered poll scheduler ─────────────────────────────────────────────────
  const schedulePoll = useCallback(() => {
    clearTimeout(pollRef.current);
    if (document.hidden) return;
    const delay = POLL_BASE + Math.random() * POLL_JITTER + backoffRef.current;
    pollRef.current = setTimeout(async () => {
      await fetchNotifications(true);
      schedulePoll();
    }, delay);
  }, [fetchNotifications]);

  // ── SW push → immediate fetch ───────────────────────────────────────────────
  // When the OS push arrives, the SW sends PUSH_RECEIVED to all tabs.
  // Triggering an immediate silent fetch here ensures the notification appears
  // right away even if the Realtime event hasn't arrived yet.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = ({ data }) => {
      if (data?.type === 'PUSH_RECEIVED') fetchNotifications(true);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [fetchNotifications]);

  // ── Realtime + polling setup ─────────────────────────────────────────────────
  // Depends on user.id so it re-runs on login/logout transitions.
  // Token changes are handled by AuthContext → setRealtimeAuth, not here.
  useEffect(() => {
    const uid = user?.id;
    if (!uid) return;

    fetchNotifications();
    schedulePoll();

    // Authenticate Realtime WebSocket — allows RLS postgres_changes events
    setRealtimeAuth(tokenRef.current || localStorage.getItem('token'));

    // Set up Realtime channel with auto-reconnect on error
    const setupChannel = () => {
      // Clean up any previous channel before creating a new one
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }

      const ch = supabase
        .channel(`notifications-${uid}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` },
          (payload) => {
            if (!payload.new) return;
            setNotifications(prev => [payload.new, ...prev].slice(0, 40));
            setUnreadCount(prev => prev + 1);
            playNotificationSound();
          }
        )
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            // Jittered backoff to avoid reconnect thundering herd
            const delay = 3000 + Math.random() * 2000;
            retryRef.current = setTimeout(setupChannel, delay);
          }
        });

      channelRef.current = ch;
    };

    setupChannel();

    const onVisibilityChange = () => {
      if (document.hidden) {
        clearTimeout(pollRef.current);
      } else {
        fetchNotifications(true);
        schedulePoll();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearTimeout(retryRef.current);
      abortRef.current?.abort();
      clearTimeout(pollRef.current);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [user?.id, fetchNotifications, schedulePoll]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mutations (optimistic-update, then sync server) ─────────────────────────
  const markRead = useCallback(async (id) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    setUnreadCount(prev => Math.max(0, prev - 1));
    try { await client.patch(`notifications/${id}/read`); } catch {}
  }, []);

  const markAllRead = useCallback(async () => {
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnreadCount(0);
    try { await client.patch('notifications/read-all'); } catch {}
  }, []);

  const deleteNotification = useCallback(async (id) => {
    const n = notifications.find(x => x.id === id);
    setNotifications(prev => prev.filter(x => x.id !== id));
    if (n && !n.is_read) setUnreadCount(prev => Math.max(0, prev - 1));
    try { await client.delete(`notifications/${id}`); } catch {}
  }, [notifications]);

  const clearAll = useCallback(async () => {
    setNotifications([]);
    setUnreadCount(0);
    try { await client.delete('notifications'); } catch {}
  }, []);

  return {
    notifications,
    unreadCount,
    loading,
    fetchNotifications,
    markRead,
    markAllRead,
    deleteNotification,
    clearAll,
  };
};
