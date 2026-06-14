import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// heartbeatIntervalMs: 30s (the library default). Each persistent websocket
// exchanges a keepalive at this cadence; 15s doubled that egress for no real
// gain. Clean closes (unsubscribe on unload) flip offline INSTANTLY regardless;
// this interval only bounds how fast an UNCLEAN disconnect (tab killed mid-flush)
// is noticed — ~30s worst case, which is imperceptible for "active now".
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: { heartbeatIntervalMs: 30000 },
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
