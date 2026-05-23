/**
 * usePresence
 * Tracks which users are currently active (chat open) via Supabase Presence on
 * one shared channel. Ephemeral — never written to the DB. Returns a Set of
 * online user ids. A heartbeat re-tracks periodically and on tab focus so the
 * entry stays fresh; the entry is removed (→ offline) the moment the channel is
 * torn down (panel closed / logout), so the dot reflects real activity.
 */
import { useState, useEffect, useRef } from 'react';
import { supabase, setRealtimeAuth } from '../api/supabase';
import { useAuth } from '../contexts/AuthContext';

export const usePresence = (active = true) => {
  const { user, token } = useAuth();
  const [onlineIds, setOnlineIds] = useState(() => new Set());
  const channelRef = useRef(null);

  useEffect(() => {
    if (!active || !user?.id) { setOnlineIds(new Set()); return; }
    setRealtimeAuth(token || localStorage.getItem('token'));

    const ch = supabase.channel('presence:chat-online', { config: { presence: { key: user.id } } });
    const sync = () => setOnlineIds(new Set(Object.keys(ch.presenceState()))); // keyed by user id

    const track = () => ch.track({ user_id: user.id, online_at: new Date().toISOString() });

    ch.on('presence', { event: 'sync' }, sync)
      .on('presence', { event: 'join' }, sync)
      .on('presence', { event: 'leave' }, sync)
      .subscribe((status) => { if (status === 'SUBSCRIBED') track(); });

    // Heartbeat keeps the presence entry fresh; refresh immediately on focus.
    const beat = setInterval(track, 25_000);
    const onVis = () => { if (!document.hidden) track(); };
    document.addEventListener('visibilitychange', onVis);

    channelRef.current = ch;
    return () => {
      clearInterval(beat);
      document.removeEventListener('visibilitychange', onVis);
      ch.untrack().catch(() => {});
      supabase.removeChannel(ch);
      channelRef.current = null;
    };
  }, [active, user?.id, token]);

  return onlineIds;
};
