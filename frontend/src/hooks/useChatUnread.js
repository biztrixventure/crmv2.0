/**
 * useChatUnread
 * Lightweight total-unread badge for the header chat icon.
 * Polls /chat/conversations on a jittered interval (so 350+ clients don't all
 * fire on the same second) and on tab focus. Intentionally does NOT open a
 * Realtime channel — opening one channel per conversation would not scale; the
 * open conversation gets its own channel via useChat instead.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import client from '../api/client';
import { useAuth } from '../contexts/AuthContext';

// Header unread badge — not latency-critical. 60s (was 25s) more than halves
// these polls; opening the chat still loads live via useChat's realtime channel.
const POLL_BASE = 60_000;
const POLL_JITTER = 15_000;

export const useChatUnread = (enabled = true) => {
  const { user } = useAuth();
  const [total, setTotal] = useState(0);
  const [banned, setBanned] = useState(false);
  const pollRef = useRef(null);
  const fetchingRef = useRef(false);
  const abortRef = useRef(null);

  const refresh = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    try {
      const res = await client.get('chat/conversations', { signal: abortRef.current.signal });
      const sum = (res.data.conversations || []).reduce((n, c) => n + (c.unread || 0), 0);
      setTotal(sum);
    } catch { /* leave stale */ }
    finally { fetchingRef.current = false; }
  }, []);

  // One-off ban check for the banner.
  useEffect(() => {
    if (!user?.id || !enabled) return;
    client.get('chat/me').then(r => setBanned(!!r.data.is_chat_banned)).catch(() => {});
  }, [user?.id, enabled]);

  const schedule = useCallback(() => {
    clearTimeout(pollRef.current);
    if (document.hidden) return;
    pollRef.current = setTimeout(async () => { await refresh(); schedule(); }, POLL_BASE + Math.random() * POLL_JITTER);
  }, [refresh]);

  useEffect(() => {
    if (!user?.id || !enabled) return;
    refresh();
    schedule();
    const onVis = () => { if (!document.hidden) { refresh(); schedule(); } else clearTimeout(pollRef.current); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearTimeout(pollRef.current); abortRef.current?.abort(); document.removeEventListener('visibilitychange', onVis); };
  }, [user?.id, enabled, refresh, schedule]);

  return { total, banned, refresh };
};
