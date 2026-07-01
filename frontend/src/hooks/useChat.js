/**
 * useChat
 * Live message stream for the OPEN conversation. Mirrors useNotifications.js:
 *   - postgres_changes (INSERT + UPDATE) on `messages` filtered to this
 *     conversation, JWT-authed via setRealtimeAuth
 *   - jittered poll fallback so chat survives a dropped WS
 *   - optimistic send, cursor pagination, emoji reactions (instant via Broadcast)
 *   - typing indicator over Broadcast (never hits the DB)
 *
 * The realtime/poll lifecycle is keyed ONLY on conversationId + meId. Volatile
 * inputs (resolveName, markRead) are read through refs, so the channel is NOT
 * torn down and the scrollback is NOT reset when the parent re-renders (e.g. the
 * conversation-list poll) — that churn was the "keeps refreshing" bug.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import client from '../api/client';
import { supabase, setRealtimeAuth } from '../api/supabase';
import { useAuth } from '../contexts/AuthContext';
import { playNotificationSound } from './useNotifications';

const POLL_BASE = 25_000;
const POLL_JITTER = 10_000;
const TYPING_TTL = 3_500;

// Build the little "replying to" preview from a parent message already in state.
const previewFromParent = (parent) => parent ? {
  id: parent.id, sender_id: parent.sender_id, sender_name: parent.sender_name,
  body: parent.deleted ? null : (parent.body || (parent.attachments?.length ? `📎 ${parent.attachments.length} attachment${parent.attachments.length > 1 ? 's' : ''}` : null)),
  deleted: !!parent.deleted,
} : null;

const sortByTime = (a, b) => new Date(a.created_at) - new Date(b.created_at);
const dedupe = (list) => {
  const seen = new Map();
  for (const m of list) seen.set(m.id, { ...seen.get(m.id), ...m });
  return [...seen.values()].sort(sortByTime);
};

// True when two message arrays are visually identical — lets us keep the SAME
// array reference after a poll so React doesn't repaint (the "flicker").
const sameMessages = (a, b) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x.id !== y.id || x.body !== y.body || x.deleted !== y.deleted || x.edited !== y.edited
      || x.pending !== y.pending || (x.reactions?.length || 0) !== (y.reactions?.length || 0)) return false;
  }
  return true;
};

// Apply a reaction toggle to a message list immutably.
const applyReaction = (list, { message_id, emoji, user_id, reacted }) =>
  list.map(m => {
    if (m.id !== message_id) return m;
    const reactions = (m.reactions || []).map(r => ({ ...r, user_ids: [...r.user_ids] }));
    let group = reactions.find(r => r.emoji === emoji);
    if (reacted) {
      if (!group) reactions.push({ emoji, user_ids: [user_id] });
      else if (!group.user_ids.includes(user_id)) group.user_ids.push(user_id);
    } else if (group) {
      group.user_ids = group.user_ids.filter(u => u !== user_id);
    }
    return { ...m, reactions: reactions.filter(r => r.user_ids.length) };
  });

export const useChat = (conversationId, { meId, resolveName, myName } = {}) => {
  const { token } = useAuth();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [typingNames, setTypingNames] = useState([]);
  const [peerReadAt, setPeerReadAt] = useState(null);   // newest "a peer read" time (instant, via broadcast)

  const channelRef = useRef(null);
  const pollRef = useRef(null);
  const retryRef = useRef(null);
  const abortRef = useRef(null);
  const backoffRef = useRef(0);
  const fetchingRef = useRef(false);
  const oldestRef = useRef(null);
  const typingRef = useRef(new Map());
  const messagesRef = useRef([]); useEffect(() => { messagesRef.current = messages; }, [messages]);
  // The conversation currently in view. Set synchronously on switch so any
  // in-flight fetch/poll/realtime from the PREVIOUS conversation is ignored —
  // this is what stops one chat's messages bleeding into another.
  const activeConvRef = useRef(conversationId);

  // Volatile values accessed inside the long-lived effect via refs.
  const tokenRef = useRef(token);   useEffect(() => { tokenRef.current = token; }, [token]);
  const resolveRef = useRef(resolveName); useEffect(() => { resolveRef.current = resolveName; }, [resolveName]);
  const myNameRef  = useRef(myName);      useEffect(() => { myNameRef.current = myName; }, [myName]);
  const nameOf = useCallback((id) => (resolveRef.current?.(id)) || 'User', []);

  const markRead = useCallback(() => {
    if (!conversationId) return;
    client.patch(`chat/conversations/${conversationId}/read`).catch(() => {});
    // Tell peers instantly that I've read — drives the sender's blue double tick
    // immediately (WhatsApp-style), without waiting on a DB poll.
    channelRef.current?.send({ type: 'broadcast', event: 'read', payload: { user_id: meId, at: new Date().toISOString() } });
  }, [conversationId, meId]);
  const markReadRef = useRef(markRead); useEffect(() => { markReadRef.current = markRead; }, [markRead]);
  // Debounced read-receipt: a burst of incoming messages collapses into ONE
  // PATCH (+ broadcast) after a short quiet, instead of one request per message
  // — that per-message PATCH was a big chunk of the chat request volume that
  // tripped the rate limiter in busy conversations.
  const markReadTimer = useRef(null);
  const markReadSoon = useCallback(() => {
    clearTimeout(markReadTimer.current);
    markReadTimer.current = setTimeout(() => markReadRef.current(), 1200);
  }, []);

  // Reset the live peer-read marker when switching conversations.
  useEffect(() => { setPeerReadAt(null); }, [conversationId]);

  const mapRow = useCallback((row) => ({
    id: row.id, conversation_id: row.conversation_id, sender_id: row.sender_id,
    guest_id: row.guest_id || null, is_guest: !!row.guest_id,
    // A guest (outsider) message has no sender_id; its name resolves on the next
    // full fetch (server-side). Live, it shows "Guest" with the badge.
    sender_name: row.guest_id ? 'Guest' : nameOf(row.sender_id),
    body: row.deleted_at ? null : row.body,
    body_html: row.deleted_at ? null : (row.body_html || null),
    attachments: row.deleted_at ? null : (row.attachments || null),
    mentions: row.mentions || null,
    deleted: !!row.deleted_at, edited: !!row.edited_at,
    created_at: row.created_at, reactions: [],
  }), [nameOf]);

  // ── fetch newest page, merge (never collapse the scrollback) ───────────────
  const fetchLatest = useCallback(async (silent = false) => {
    if (!conversationId) return;
    if (silent && fetchingRef.current) return;
    const cid = conversationId;                 // pin the target conversation
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    fetchingRef.current = true;
    if (!silent) setLoading(true);
    try {
      const res = await client.get(`chat/conversations/${cid}/messages`, {
        params: { limit: 30 }, signal: abortRef.current.signal,
      });
      if (cid !== activeConvRef.current) return; // switched away mid-fetch → drop it
      const fetched = res.data.messages || [];
      setMessages(prev => {
        // Drop anything not from this conversation (stale optimistic/realtime).
        const base = prev.filter(m => m.conversation_id === cid);
        const merged = dedupe([...base, ...fetched]);
        oldestRef.current = merged.length ? merged[0].created_at : null;
        if (!base.length) setHasMore(!!res.data.has_more);
        // Keep the same reference when nothing changed → no needless repaint.
        return sameMessages(prev, merged) ? prev : merged;
      });
      backoffRef.current = 0;
    } catch (err) {
      if (err?.code !== 'ERR_CANCELED' && err?.name !== 'CanceledError') {
        backoffRef.current = backoffRef.current ? Math.min(backoffRef.current * 2, 120_000) : 12_000;
      }
    } finally {
      fetchingRef.current = false;
      if (!silent) setLoading(false);
    }
  }, [conversationId]);

  const loadOlder = useCallback(async () => {
    if (!conversationId || !hasMore || loadingOlder || !oldestRef.current) return;
    const cid = conversationId;
    setLoadingOlder(true);
    try {
      const res = await client.get(`chat/conversations/${cid}/messages`, {
        params: { limit: 30, before: oldestRef.current },
      });
      if (cid !== activeConvRef.current) return;  // switched away → ignore
      const older = res.data.messages || [];
      setHasMore(!!res.data.has_more);
      if (older.length) oldestRef.current = older[0].created_at;
      setMessages(prev => dedupe([...older, ...prev.filter(m => m.conversation_id === cid)]));
    } catch { /* ignore */ }
    finally { setLoadingOlder(false); }
  }, [conversationId, hasMore, loadingOlder]);

  // ── optimistic send (accepts a rich payload or a plain string) ──────────────
  const sendMessage = useCallback(async (payload) => {
    const p = typeof payload === 'string' ? { body: payload } : (payload || {});
    const bodyText = (p.body || '').trim();
    const hasAttachments = Array.isArray(p.attachments) && p.attachments.length > 0;
    if ((!bodyText && !p.body_html && !hasAttachments) || !conversationId) return;
    const replyTo = p.reply_to || null;
    const replyPreview = replyTo ? previewFromParent(messagesRef.current.find(x => x.id === replyTo)) : null;
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setMessages(prev => dedupe([...prev, {
      id: tempId, conversation_id: conversationId, sender_id: meId, sender_name: 'You',
      body: bodyText || null, body_html: p.body_html || null, attachments: p.attachments || null, mentions: p.mentions || null,
      reply_to: replyTo, reply_preview: replyPreview,
      deleted: false, edited: false, created_at: new Date().toISOString(), reactions: [], pending: true,
    }]));
    try {
      const res = await client.post(`chat/conversations/${conversationId}/messages`, {
        body: bodyText, body_html: p.body_html || null, attachments: p.attachments || null, mentions: p.mentions || null, reply_to: replyTo,
      });
      setMessages(prev => dedupe(prev.filter(m => m.id !== tempId).concat({ ...res.data.message, reactions: [] })));
    } catch (err) {
      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, pending: false, error: true } : m));
      throw err;
    }
  }, [conversationId, meId]);

  // Push a mutation (edit/delete) to peers INSTANTLY over Broadcast — the same
  // channel reactions/typing/read use — so recipients update without waiting on
  // (or depending on the reliability of) the postgres_changes UPDATE.
  const broadcastUpdate = useCallback((payload) => {
    channelRef.current?.send({ type: 'broadcast', event: 'message_update', payload: { by: meId, ...payload } });
  }, [meId]);

  const editMessage = useCallback(async (id, text) => {
    const res = await client.patch(`chat/messages/${id}`, { body: text.trim() });
    const patch = res.data.message;   // body + body_html:null + edited:true
    setMessages(prev => prev.map(m => m.id === id ? { ...m, ...patch } : m));
    broadcastUpdate({ id, body: patch.body ?? null, body_html: patch.body_html ?? null, deleted: false, edited: true });
  }, [broadcastUpdate]);

  // Delete for everyone (soft delete) — shows "message deleted" to all.
  const deleteMessage = useCallback(async (id) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, deleted: true, body: null } : m));
    try {
      await client.delete(`chat/messages/${id}`);
      broadcastUpdate({ id, deleted: true, body: null, body_html: null, attachments: null });
    } catch (e) {
      // window passed / disabled → restore + surface why.
      setMessages(prev => prev.map(m => m.id === id ? { ...m, deleted: false } : m));
      throw e;
    }
  }, [broadcastUpdate]);

  // Delete for me — hide locally + persist so it stays hidden for this user only.
  const hideMessage = useCallback(async (id) => {
    setMessages(prev => prev.filter(m => m.id !== id));
    try { await client.post(`chat/messages/${id}/hide`); } catch { /* best-effort */ }
  }, []);

  // ── reactions (optimistic + persisted + broadcast for instant peers) ───────
  const addReaction = useCallback(async (messageId, emoji) => {
    if (String(messageId).startsWith('temp-')) return; // not saved yet
    const msg = messagesRef.current.find(m => m.id === messageId);
    const had = !!msg?.reactions?.find(r => r.emoji === emoji)?.user_ids.includes(meId);
    const next = !had;
    setMessages(prev => applyReaction(prev, { message_id: messageId, emoji, user_id: meId, reacted: next }));
    try {
      const res = await client.post(`chat/messages/${messageId}/react`, { emoji });
      setMessages(prev => applyReaction(prev, { message_id: messageId, emoji, user_id: meId, reacted: res.data.reacted }));
      channelRef.current?.send({ type: 'broadcast', event: 'reaction', payload: { message_id: messageId, emoji, user_id: meId, reacted: res.data.reacted } });
    } catch {
      setMessages(prev => applyReaction(prev, { message_id: messageId, emoji, user_id: meId, reacted: had })); // revert
    }
  }, [meId]);

  const sendTyping = useCallback(() => {
    // Broadcast my REAL name — nameOf(meId) resolves to 'You', which would make
    // peers show "You is typing".
    channelRef.current?.send({ type: 'broadcast', event: 'typing', payload: { user_id: meId, name: myNameRef.current || 'Someone' } });
  }, [meId, nameOf]);

  const schedulePoll = useCallback(() => {
    clearTimeout(pollRef.current);
    if (document.hidden || !conversationId) return;
    const delay = POLL_BASE + Math.random() * POLL_JITTER + backoffRef.current;
    pollRef.current = setTimeout(async () => { await fetchLatest(true); schedulePoll(); }, delay);
  }, [conversationId, fetchLatest]);

  // ── realtime + polling lifecycle (keyed ONLY on conversationId + meId) ─────
  useEffect(() => {
    activeConvRef.current = conversationId;       // mark the active conversation first
    if (!conversationId) { setMessages([]); return; }
    oldestRef.current = null;
    setMessages([]);                              // never carry the previous chat over
    fetchLatest();
    schedulePoll();
    setRealtimeAuth(tokenRef.current || localStorage.getItem('token'));

    const dropTyping = (userId) => {
      if (typingRef.current.delete(userId)) setTypingNames([...typingRef.current.values()].map(v => v.name));
    };

    const setupChannel = () => {
      if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null; }
      const ch = supabase
        .channel(`chat:conv:${conversationId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
          (payload) => {
            if (!payload.new) return;
            if (payload.new.conversation_id !== activeConvRef.current) return; // stale channel from a prior conversation
            const msg = { id: payload.new.id, conversation_id: payload.new.conversation_id, sender_id: payload.new.sender_id,
              guest_id: payload.new.guest_id || null, is_guest: !!payload.new.guest_id,
              sender_name: payload.new.guest_id ? 'Guest' : nameOf(payload.new.sender_id), body: payload.new.deleted_at ? null : payload.new.body,
              body_html: payload.new.deleted_at ? null : (payload.new.body_html || null),
              attachments: payload.new.deleted_at ? null : (payload.new.attachments || null),
              mentions: payload.new.mentions || null,
              reply_to: payload.new.reply_to || null,
              reply_preview: payload.new.reply_to ? previewFromParent(messagesRef.current.find(x => x.id === payload.new.reply_to)) : null,
              deleted: !!payload.new.deleted_at, edited: !!payload.new.edited_at, created_at: payload.new.created_at, reactions: [] };
            setMessages(prev => dedupe([...prev, msg]));
            dropTyping(msg.sender_id);
            if (msg.sender_id !== meId) { playNotificationSound(); markReadSoon(); }
          })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
          (payload) => {
            if (!payload.new) return;
            setMessages(prev => prev.map(m => m.id === payload.new.id
              ? { ...m, body: payload.new.deleted_at ? null : payload.new.body,
                  body_html: payload.new.deleted_at ? null : (payload.new.body_html || null),
                  attachments: payload.new.deleted_at ? null : (payload.new.attachments || null),
                  deleted: !!payload.new.deleted_at, edited: !!payload.new.edited_at }
              : m));
          })
        .on('broadcast', { event: 'typing' }, ({ payload }) => {
          if (!payload || payload.user_id === meId) return;
          typingRef.current.set(payload.user_id, { name: payload.name || 'Someone', at: Date.now() });
          setTypingNames([...typingRef.current.values()].map(v => v.name));
        })
        .on('broadcast', { event: 'reaction' }, ({ payload }) => {
          if (!payload || payload.user_id === meId) return;
          setMessages(prev => applyReaction(prev, payload));
        })
        // Instant edit/delete propagation to peers (patches the ONE message in
        // place → no re-fetch, no scroll jump, no flicker/dupes). Mirrors the
        // postgres_changes UPDATE handler but delivered immediately over Broadcast.
        .on('broadcast', { event: 'message_update' }, ({ payload }) => {
          if (!payload || payload.by === meId || !payload.id) return;
          setMessages(prev => prev.map(m => m.id === payload.id ? {
            ...m,
            body: payload.deleted ? null : (payload.body ?? m.body),
            body_html: payload.deleted ? null : (payload.body_html ?? null),
            attachments: payload.deleted ? null : m.attachments,
            deleted: !!payload.deleted,
            edited: payload.edited != null ? !!payload.edited : m.edited,
          } : m));
        })
        .on('broadcast', { event: 'read' }, ({ payload }) => {
          if (!payload || payload.user_id === meId || !payload.at) return;
          setPeerReadAt(prev => (!prev || payload.at > prev) ? payload.at : prev);
        })
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            retryRef.current = setTimeout(setupChannel, 3000 + Math.random() * 2000);
          }
        });
      channelRef.current = ch;
    };
    setupChannel();

    const typingTimer = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [k, v] of typingRef.current) if (now - v.at > TYPING_TTL) { typingRef.current.delete(k); changed = true; }
      if (changed) setTypingNames([...typingRef.current.values()].map(v => v.name));
    }, 1500);

    const onVis = () => { if (document.hidden) clearTimeout(pollRef.current); else { fetchLatest(true); schedulePoll(); } };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      clearTimeout(retryRef.current);
      clearTimeout(pollRef.current);
      clearTimeout(markReadTimer.current);
      clearInterval(typingTimer);
      abortRef.current?.abort();
      typingRef.current.clear();
      document.removeEventListener('visibilitychange', onVis);
      if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null; }
    };
  }, [conversationId, meId, nameOf, fetchLatest, schedulePoll]);

  return { messages, loading, loadingOlder, hasMore, typingNames, peerReadAt, sendMessage, editMessage, deleteMessage, hideMessage, addReaction, loadOlder, markRead, sendTyping };
};
