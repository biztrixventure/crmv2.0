/**
 * useNotifications
 * Fetches in-app notifications via REST + subscribes to Supabase Realtime
 * for instant delivery. Plays a soft sound on new notification.
 * Works in tandem with usePushNotifications for OS-level alerts.
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

export const useNotifications = () => {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount,   setUnreadCount]   = useState(0);
  const [loading,       setLoading]       = useState(false);
  const channelRef = useRef(null);
  const userIdRef  = useRef(null);

  const fetchNotifications = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await client.get('notifications', { params: { limit: 40 } });
      setNotifications(res.data.notifications || []);
      setUnreadCount(res.data.unread_count    || 0);
      // Capture userId for realtime filter (stored in first notification or from auth)
      if (res.data.notifications?.length && !userIdRef.current) {
        userIdRef.current = res.data.notifications[0]?.user_id;
      }
    } catch {
      // non-critical
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Mark one as read
  const markRead = useCallback(async (id) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    setUnreadCount(prev => Math.max(0, prev - 1));
    try { await client.patch(`notifications/${id}/read`); } catch {}
  }, []);

  // Mark all read
  const markAllRead = useCallback(async () => {
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnreadCount(0);
    try { await client.patch('notifications/read-all'); } catch {}
  }, []);

  // Delete one
  const deleteNotification = useCallback(async (id) => {
    const n = notifications.find(x => x.id === id);
    setNotifications(prev => prev.filter(x => x.id !== id));
    if (n && !n.is_read) setUnreadCount(prev => Math.max(0, prev - 1));
    try { await client.delete(`notifications/${id}`); } catch {}
  }, [notifications]);

  // Clear all
  const clearAll = useCallback(async () => {
    setNotifications([]);
    setUnreadCount(0);
    try { await client.delete('notifications'); } catch {}
  }, []);

  // ── Realtime + 30s polling fallback ─────────────────────────────────────
  // Realtime requires the notifications table to have Realtime enabled in
  // Supabase Dashboard → Database → Replication. The 30s poll ensures
  // notifications appear even if Realtime is off or the WS drops.
  useEffect(() => {
    fetchNotifications();

    const storedUser = localStorage.getItem('user');
    const uid = storedUser ? JSON.parse(storedUser)?.id : null;
    if (!uid) return;
    userIdRef.current = uid;

    // Realtime subscription
    const channel = supabase
      .channel(`notifications-${uid}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` },
        (payload) => {
          const newNotif = payload.new;
          if (!newNotif) return;
          setNotifications(prev => [newNotif, ...prev].slice(0, 40));
          setUnreadCount(prev => prev + 1);
          playNotificationSound();
        }
      )
      .subscribe();

    channelRef.current = channel;

    // Polling fallback — silent refetch every 30 s
    const pollInterval = setInterval(() => fetchNotifications(true), 30_000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(pollInterval);
    };
  }, [fetchNotifications]);

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
