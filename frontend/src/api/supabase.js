import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// heartbeatIntervalMs: 15s (default 30s). Presence leave on an UNCLEAN
// disconnect (tab killed before the close frame flushes) is bounded by the
// server noticing the missed heartbeat — halving it halves the worst-case
// "stuck online" window. Clean closes (unsubscribe on unload) are still instant.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: { heartbeatIntervalMs: 15000 },
});

/**
 * Authenticate the Supabase Realtime WebSocket connection with the user's JWT.
 * Must be called after login and after every token refresh.
 * Without this, postgres_changes subscriptions are blocked by RLS (auth.uid() = null),
 * causing notifications to fall back to the 30-42 second polling interval.
 */
export const setRealtimeAuth = (token) => {
  if (token) supabase.realtime.setAuth(token);
};
