import { useState, useCallback, useEffect, useRef } from 'react';
import client from '../api/client';

/**
 * useNotifications — fetches, polls, and manages user notifications.
 * Polls every 30 seconds while the window is focused.
 */
export const useNotifications = () => {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef(null);

  const fetchNotifications = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await client.get('notifications', { params: { limit: 40 } });
      setNotifications(res.data.notifications || []);
      setUnreadCount(res.data.unread_count || 0);
    } catch {
      // silently ignore — notifications are non-critical
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Mark one as read
  const markRead = useCallback(async (id) => {
    setNotifications(prev =>
      prev.map(n => n.id === id ? { ...n, is_read: true } : n)
    );
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

  // Poll every 30 seconds when window is focused
  useEffect(() => {
    fetchNotifications();

    const startPolling = () => {
      intervalRef.current = setInterval(() => {
        if (document.visibilityState === 'visible') {
          fetchNotifications(true);
        }
      }, 30000);
    };

    startPolling();

    const onFocus = () => fetchNotifications(true);
    document.addEventListener('visibilitychange', onFocus);

    return () => {
      clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', onFocus);
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
