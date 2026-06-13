/**
 * usePresence — back-compat shim over the app-wide PresenceContext.
 *
 * Presence used to live on a chat-only channel that existed solely while the
 * chat panel was open, so a user reading the dashboard looked "offline".
 * The global PresenceProvider (mounted in App) now tracks the entire login
 * session — "Active now" means in the CRM, and the dot flips the instant the
 * websocket drops. The `active` arg is kept for callers but no longer gates
 * the channel.
 *
 * Returns the same `Set` of online user ids as before.
 */
import { usePresenceContext } from '../contexts/PresenceContext';

export const usePresence = (_active = true) => usePresenceContext().onlineIds;
