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
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import client from '../api/client';
import { supabase } from '../api/supabase';

// Tiny sound via Web Audio API (shared with usePushNotifications)
export function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
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

// Base poll interval + jitter window (ms).
// 350 clients spread across 12 s instead of firing at the exact same second.
const POLL_BASE   = 30_000;
const POLL_JITTER = 12_000;

export const useNotifications = () => {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount,   setUnreadCount]   = useState(0);
  const [loading,       setLoading]       = useState(false);

  const channelRef  = useRef(null);
  const userIdRef   = useRef(null);
  const abortRef    = useRef(null);   // AbortController for the active request
  const fetchingRef = useRef(false);  // true while a fetch is in progress
  const backoffRef  = useRef(0);      // extra delay (ms) added after failures
  const pollRef     = useRef(null);   // setTimeout handle for the next poll

  // ── Core fetch ──────────────────────────────────────────────────────────────
  const fetchNotifications = useCallback(async (silent = false) => {
    // Background polls skip if a request is already in-flight
    if (silent && fetchingRef.current) return;

    // Cancel any previous in-flight request before starting a new one
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
      backoffRef.current = 0; // reset back-off on success

      if (res.data.notifications?.length && !userIdRef.current) {
        userIdRef.current = res.data.notifications[0]?.user_id;
      }
    } catch (err) {
      // Ignore intentional cancellations (unmount / next fetch)
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

  // ── Jittered scheduler ──────────────────────────────────────────────────────
  // Returns delay in ms: base + random jitter + current back-off penalty.
  // Tab-hidden clients use 60 s to minimise background load.
  const schedulePoll = useCallback(() => {
    clearTimeout(pollRef.current);
    if (document.hidden) return; // visibilitychange will reschedule
    const delay = POLL_BASE + Math.random() * POLL_JITTER + backoffRef.current;
    pollRef.current = setTimeout(async () => {
      await fetchNotifications(true);
      schedulePoll();
    }, delay);
  }, [fetchNotifications]);

  // ── Realtime + polling setup ─────────────────────────────────────────────────
  useEffect(() => {
    fetchNotifications();
    schedulePoll();

    const uid = (() => {
      try { return JSON.parse(localStorage.getItem('user'))?.id; } catch { return null; }
    })();
    if (!uid) return;
    userIdRef.current = uid;

    // Supabase Realtime — instant delivery without waiting for next poll
    const channel = supabase
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
      .subscribe();
    channelRef.current = channel;

    // Pause polling while tab is hidden; resume + immediate fetch on tab focus
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
      abortRef.current?.abort();
      clearTimeout(pollRef.current);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      supabase.removeChannel(channel);
    };
  }, [fetchNotifications, schedulePoll]);

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
