/**
 * useChat
 * Live message stream for the OPEN conversation. Mirrors useNotifications.js:
 *   - postgres_changes (INSERT + UPDATE) on `messages` filtered to this
 *     conversation, JWT-authed via setRealtimeAuth
 *   - jittered poll fallback (30–42 s + backoff) so chat survives a dropped WS
 *   - AbortController + in-flight guard, channel auto-reconnect on error
 *   - cursor pagination (load older on demand), optimistic send
 *   - ephemeral typing indicator over Supabase Broadcast (never hits the DB)
 * Tears down and re-subscribes whenever the conversation id changes.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import client from '../api/client';
import { supabase, setRealtimeAuth } from '../api/supabase';
import { useAuth } from '../contexts/AuthContext';
import { playNotificationSound } from './useNotifications';

const POLL_BASE = 30_000;
const POLL_JITTER = 12_000;
const TYPING_TTL = 4_000;

const sortByTime = (a, b) => new Date(a.created_at) - new Date(b.created_at);
const dedupe = (list) => {
  const seen = new Map();
  for (const m of list) seen.set(m.id, m);
  return [...seen.values()].sort(sortByTime);
};

export const useChat = (conversationId, { meId, resolveName } = {}) => {
  const { token } = useAuth();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [typingNames, setTypingNames] = useState([]);

  const channelRef = useRef(null);
  const pollRef = useRef(null);
  const retryRef = useRef(null);
  const abortRef = useRef(null);
  const backoffRef = useRef(0);
  const fetchingRef = useRef(false);
  const oldestRef = useRef(null);
  const typingRef = useRef(new Map());
  const tokenRef = useRef(token);
  useEffect(() => { tokenRef.current = token; }, [token]);

  const mapRow = useCallback((row) => ({
    id: row.id,
    conversation_id: row.conversation_id,
    sender_id: row.sender_id,
    sender_name: resolveName?.(row.sender_id) || 'User',
    body: row.deleted_at ? null : row.body,
    deleted: !!row.deleted_at,
    edited: !!row.edited_at,
    created_at: row.created_at,
  }), [resolveName]);

  // ── fetch newest page, merge into state ───────────────────────────────────
  const fetchLatest = useCallback(async (silent = false) => {
    if (!conversationId) return;
    if (silent && fetchingRef.current) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    fetchingRef.current = true;
    if (!silent) setLoading(true);
    try {
      const res = await client.get(`chat/conversations/${conversationId}/messages`, {
        params: { limit: 30 }, signal: abortRef.current.signal,
      });
      const fetched = res.data.messages || [];
      // Merge into existing state (keeps older pages already loaded via loadOlder
      // and lets fresh server rows overwrite stale/edited/deleted copies); never
      // collapse the scrollback to just the newest page.
      setMessages(prev => {
        const merged = dedupe([...prev, ...fetched]);
        oldestRef.current = merged.length ? merged[0].created_at : null;
        // Only the first page reliably tells us whether older history remains.
        if (!prev.length) setHasMore(!!res.data.has_more);
        return merged;
      });
      backoffRef.current = 0;
    } catch (err) {
      if (err?.code !== 'ERR_CANCELED' && err?.name !== 'CanceledError') {
        backoffRef.current = backoffRef.current ? Math.min(backoffRef.current * 2, 120_000) : 15_000;
      }
    } finally {
      fetchingRef.current = false;
      if (!silent) setLoading(false);
    }
  }, [conversationId]);

  const loadOlder = useCallback(async () => {
    if (!conversationId || !hasMore || loadingOlder || !oldestRef.current) return;
    setLoadingOlder(true);
    try {
      const res = await client.get(`chat/conversations/${conversationId}/messages`, {
        params: { limit: 30, before: oldestRef.current },
      });
      const older = res.data.messages || [];
      setHasMore(!!res.data.has_more);
      if (older.length) oldestRef.current = older[0].created_at;
      setMessages(prev => dedupe([...older, ...prev]));
    } catch { /* ignore */ }
    finally { setLoadingOlder(false); }
  }, [conversationId, hasMore, loadingOlder]);

  // ── optimistic send ────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (text) => {
    const bodyText = (text || '').trim();
    if (!bodyText || !conversationId) return;
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic = {
      id: tempId, conversation_id: conversationId, sender_id: meId,
      sender_name: 'You', body: bodyText, deleted: false, edited: false,
      created_at: new Date().toISOString(), pending: true,
    };
    setMessages(prev => dedupe([...prev, optimistic]));
    try {
      const res = await client.post(`chat/conversations/${conversationId}/messages`, { body: bodyText });
      const saved = res.data.message;
      setMessages(prev => dedupe(prev.filter(m => m.id !== tempId).concat(saved)));
    } catch (err) {
      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, pending: false, error: true } : m));
      throw err;
    }
  }, [conversationId, meId]);

  const editMessage = useCallback(async (id, text) => {
    const res = await client.patch(`chat/messages/${id}`, { body: text.trim() });
    setMessages(prev => prev.map(m => m.id === id ? { ...m, ...res.data.message } : m));
  }, []);

  const deleteMessage = useCallback(async (id) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, deleted: true, body: null } : m));
    try { await client.delete(`chat/messages/${id}`); } catch { /* ignore */ }
  }, []);

  const markRead = useCallback(() => {
    if (conversationId) client.patch(`chat/conversations/${conversationId}/read`).catch(() => {});
  }, [conversationId]);

  // ── typing broadcast ─────────────────────────────────────────────────────────
  const sendTyping = useCallback(() => {
    channelRef.current?.send({
      type: 'broadcast', event: 'typing',
      payload: { user_id: meId, name: resolveName?.(meId) || 'Someone' },
    });
  }, [meId, resolveName]);

  // ── poll scheduler ────────────────────────────────────────────────────────────
  const schedulePoll = useCallback(() => {
    clearTimeout(pollRef.current);
    if (document.hidden || !conversationId) return;
    const delay = POLL_BASE + Math.random() * POLL_JITTER + backoffRef.current;
    pollRef.current = setTimeout(async () => { await fetchLatest(true); schedulePoll(); }, delay);
  }, [conversationId, fetchLatest]);

  // ── realtime + polling lifecycle, keyed on conversation id ────────────────────
  useEffect(() => {
    if (!conversationId) { setMessages([]); return; }
    oldestRef.current = null;
    setMessages([]);
    fetchLatest();
    schedulePoll();
    setRealtimeAuth(tokenRef.current || localStorage.getItem('token'));

    const setupChannel = () => {
      if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null; }
      const ch = supabase
        .channel(`chat:conv:${conversationId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
          (payload) => {
            if (!payload.new) return;
            const msg = mapRow(payload.new);
            setMessages(prev => dedupe([...prev, msg]));
            if (msg.sender_id !== meId) { playNotificationSound(); markRead(); }
          })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
          (payload) => {
            if (!payload.new) return;
            const msg = mapRow(payload.new);
            setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, ...msg } : m));
          })
        .on('broadcast', { event: 'typing' }, ({ payload }) => {
          if (!payload || payload.user_id === meId) return;
          typingRef.current.set(payload.user_id, { name: payload.name, at: Date.now() });
          setTypingNames([...typingRef.current.values()].map(v => v.name));
        })
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            retryRef.current = setTimeout(setupChannel, 3000 + Math.random() * 2000);
          }
        });
      channelRef.current = ch;
    };
    setupChannel();

    // Expire stale typing entries.
    const typingTimer = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [k, v] of typingRef.current) if (now - v.at > TYPING_TTL) { typingRef.current.delete(k); changed = true; }
      if (changed) setTypingNames([...typingRef.current.values()].map(v => v.name));
    }, 2000);

    const onVis = () => { if (document.hidden) clearTimeout(pollRef.current); else { fetchLatest(true); schedulePoll(); } };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      clearTimeout(retryRef.current);
      clearTimeout(pollRef.current);
      clearInterval(typingTimer);
      abortRef.current?.abort();
      typingRef.current.clear();
      document.removeEventListener('visibilitychange', onVis);
      if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null; }
    };
  }, [conversationId, meId, mapRow, fetchLatest, schedulePoll, markRead]);

  return { messages, loading, loadingOlder, hasMore, typingNames, sendMessage, editMessage, deleteMessage, loadOlder, markRead, sendTyping };
};
