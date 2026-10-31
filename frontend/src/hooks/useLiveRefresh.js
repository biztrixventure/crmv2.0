// ============================================================================
// useLiveRefresh — reload this list when the event it cares about arrives.
//
//   useLiveRefresh(SALE_EVENTS, load);
//
// `load` is the SAME function the list's Refresh button calls, so a live
// refresh can do nothing a user could not already do by hand. That is what
// makes this safe to add to a screen without reasoning about its internals.
//
// Three rules it exists to enforce:
//
//   COALESCE. A bulk upload, or compliance working through a queue, can land a
//   dozen notifications in a second. Reloading per event would turn one busy
//   moment into a dozen identical queries, which is exactly the load this is
//   supposed to avoid. Events inside the window collapse into ONE reload.
//
//   NEVER RELOAD A HIDDEN TAB. The websocket keeps delivering while the tab is
//   in the background, and refreshing a list nobody is looking at spends a
//   query to update pixels that are not on screen. The event is remembered
//   instead and spent once, on return.
//
//   STAY QUIET WHEN NOTHING HAPPENS. No interval, no heartbeat. A floor that
//   makes no sales issues no requests.
// ============================================================================
import { useEffect, useRef } from 'react';
import { subscribeLive } from '../utils/liveEvents';

const COALESCE_MS = 1200;

export function useLiveRefresh(types, reload, { enabled = true, coalesceMs = COALESCE_MS } = {}) {
  // Both held in refs so a new `load` identity (these are rebuilt whenever a
  // filter changes) re-points the subscription WITHOUT tearing the channel
  // subscription down and building it again on every keystroke.
  const reloadRef = useRef(reload);
  useEffect(() => { reloadRef.current = reload; }, [reload]);

  const typesRef = useRef(types);
  useEffect(() => { typesRef.current = types; }, [types]);

  const timerRef  = useRef(null);
  const missedRef = useRef(false);   // an event arrived while hidden

  useEffect(() => {
    if (!enabled) return;

    const fire = () => {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        // Checked again HERE, not only on arrival: the tab can be hidden
        // between the event and the end of the coalesce window.
        if (document.hidden) { missedRef.current = true; return; }
        try { reloadRef.current?.(); } catch { /* the list reports its own errors */ }
      }, coalesceMs);
    };

    const off = subscribeLive((type) => {
      const want = typesRef.current;
      if (want && want.length && !want.includes(type)) return;
      if (document.hidden) { missedRef.current = true; return; }
      fire();
    });

    // Back on screen with something owed — spend exactly one reload. Without
    // this, a notification that landed while the tab sat in the background
    // would leave the list stale for as long as it stays open, which is the
    // original complaint wearing a different hat.
    const onVisible = () => {
      if (document.hidden || !missedRef.current) return;
      missedRef.current = false;
      fire();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      off();
      clearTimeout(timerRef.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, coalesceMs]);
}

export default useLiveRefresh;
