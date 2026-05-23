/**
 * usePresence
 * Tracks which users are online via Supabase Presence on a single shared
 * channel. Ephemeral — never written to the DB. Returns a Set of online user
 * ids. Mounted once while the chat panel is open.
 */
import { useState, useEffect, useRef } from 'react';
import { supabase, setRealtimeAuth } from '../api/supabase';
import { useAuth } from '../contexts/AuthContext';

export const usePresence = (active = true) => {
  const { user, token } = useAuth();
  const [onlineIds, setOnlineIds] = useState(() => new Set());
  const channelRef = useRef(null);

  useEffect(() => {
    if (!active || !user?.id) return;
    setRealtimeAuth(token || localStorage.getItem('token'));

    const ch = supabase.channel('presence:chat-online', { config: { presence: { key: user.id } } });

    const sync = () => {
      const state = ch.presenceState();
      setOnlineIds(new Set(Object.keys(state)));
    };

    ch.on('presence', { event: 'sync' }, sync)
      .on('presence', { event: 'join' }, sync)
      .on('presence', { event: 'leave' }, sync)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') ch.track({ user_id: user.id, online_at: new Date().toISOString() });
      });

    channelRef.current = ch;
    return () => { supabase.removeChannel(ch); channelRef.current = null; };
  }, [active, user?.id, token]);

  return onlineIds;
};
