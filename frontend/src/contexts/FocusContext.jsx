/**
 * FocusContext — one place that turns "a notification was clicked" into
 * "navigate to that record + highlight it for ~5s", for both:
 *   • the in-app bell (NotificationBell → openFromNotification)
 *   • the OS push notification (service worker → postMessage / openWindow)
 *
 * It does NOT know each shell's tab layout. It only holds the current focus
 * target { kind, id, ts }; shells subscribe via useNavFocus() and switch to the
 * matching tab, and rows highlight themselves via useFocusHighlight(kind, id).
 *
 * TWO LIFETIMES, NOT ONE. The target used to be nulled six seconds after the
 * click, which quietly broke every cold open: the provider mounts above the
 * Router and reads the deep link at t=0, but the shell that consumes it is a
 * lazy chunk sitting behind an auth refresh and a feature-flag fetch. On a
 * phone that routinely takes longer than six seconds, so the shell mounted to
 * find the target already gone — indistinguishable from "tapping the
 * notification did nothing". The NAVIGATION target now lives for five minutes
 * (long enough for any cold start, short enough that a shell remounting an
 * hour later never jumps somewhere unasked); the HIGHLIGHT ring keeps its
 * original six seconds.
 */
import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { resolveNotificationTarget } from '../utils/notificationNav';

const FocusContext = createContext(null);

// How long the highlight ring stays lit, and the window for a late-mounting row
// (tab just switched, list still loading) to catch it and scroll into view.
const FOCUS_TTL_MS = 6000;

// How long the target stays worth NAVIGATING to. Sized for the worst realistic
// cold start of an installed PWA, not for the highlight.
const NAV_TTL_MS = 5 * 60 * 1000;

export function FocusProvider({ children }) {
  const [focus, setFocus] = useState(null);  // { kind, id, ref, ts } | null
  const [hot, setHot]     = useState(false); // drives the highlight ring only
  const timer = useRef(null);

  const requestFocus = useCallback((target) => {
    if (!target || !target.kind) return;

    // A payload naming an explicit url points at a page, not a record, so there
    // is no tab to switch to — just go there.
    if (target.kind === 'url') {
      if (target.url) window.location.assign(target.url);
      return;
    }

    clearTimeout(timer.current);
    setFocus({
      kind: target.kind,
      id:   target.id != null ? String(target.id) : null,
      ref:  target.ref || null,
      // Optional intent from the sender. 'drawer' = put the record itself on
      // screen, not just its tab. Only honoured when there IS an id to open,
      // so a kind-only target (the duplicate-phone alerts, which genuinely
      // point at no record) can never ask a shell to open a drawer on nothing.
      open: (target.open === 'drawer' && target.id != null) ? 'drawer' : null,
      ts:   Date.now(),
    });
    setHot(true);
    timer.current = setTimeout(() => setHot(false), FOCUS_TTL_MS);
  }, []);

  const openFromNotification = useCallback((n) => {
    requestFocus(resolveNotificationTarget(n));
  }, [requestFocus]);

  // OS notification clicked while a tab is open → SW posts NOTIFICATION_CLICK.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    const onMsg = (e) => {
      if (e.data?.type !== 'NOTIFICATION_CLICK') return;
      requestFocus(resolveNotificationTarget({ type: e.data.data?.type, data: e.data.data }));
      // ACK unconditionally: the ack means "a live page received this", which is
      // what stops the worker reloading the app as a fallback. It deliberately
      // does NOT mean "a target was resolved" — a notification with nothing to
      // point at should leave the user where they are, not bounce them to the
      // dashboard.
      if (e.data.nonce) {
        navigator.serviceWorker.controller?.postMessage({
          type: 'NOTIFICATION_CLICK_ACK', nonce: e.data.nonce,
        });
      }
    };
    navigator.serviceWorker.addEventListener('message', onMsg);
    return () => navigator.serviceWorker.removeEventListener('message', onMsg);
  }, [requestFocus]);

  // Cold open from SW openWindow('/dashboard?fkind=&fid=') → consume the params
  // once, then strip them so a refresh doesn't re-focus.
  //
  // Reading them HERE, above the Router, is deliberate: /dashboard immediately
  // redirects to the role route with <Navigate replace>, and react-router drops
  // the query string when it does. Capturing the target into memory before that
  // happens is what makes the deep link survive the redirect — no
  // query-forwarding through the redirect required.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const kind = sp.get('fkind');
    if (kind) {
      requestFocus({ kind, id: sp.get('fid'), open: sp.get('fopen') });
      sp.delete('fkind'); sp.delete('fid'); sp.delete('fopen');
      const q = sp.toString();
      window.history.replaceState({}, '', window.location.pathname + (q ? `?${q}` : '') + window.location.hash);
    }
  }, [requestFocus]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <FocusContext.Provider value={{ focus, hot, requestFocus, openFromNotification }}>
      {children}
    </FocusContext.Provider>
  );
}

export function useFocus() {
  return useContext(FocusContext)
    || { focus: null, hot: false, requestFocus: () => {}, openFromNotification: () => {} };
}

/**
 * Shell helper: the focus target, but only while it is still worth ACTING on.
 * Shells put this in an effect that switches tabs, so it must not fire for a
 * target from an hour ago just because the shell happened to remount.
 */
export function useNavFocus() {
  const { focus } = useFocus();
  if (!focus) return null;
  return (Date.now() - focus.ts) < NAV_TTL_MS ? focus : null;
}

/**
 * Row/card helper. Returns { ref, focused }. When this row is the focus target,
 * focused flips true (apply a ring), and the row scrolls into view. The shell is
 * responsible for already being on the right tab.
 */
export function useFocusHighlight(kind, id) {
  const { focus, hot } = useFocus();
  const ref = useRef(null);
  const focused = hot && !!focus && focus.kind === kind && id != null && String(focus.id) === String(id);
  useEffect(() => {
    if (focused && ref.current) {
      try { ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* older browsers */ }
    }
  }, [focused]);
  return { ref, focused };
}

// A ready-made highlight style for the 5s ring (consumers can spread this).
export const focusRingStyle = (focused, color = 'var(--color-primary-500, #6366f1)') =>
  focused
    ? { boxShadow: `0 0 0 2px ${color}, 0 0 0 6px ${color}22`, transition: 'box-shadow 0.3s', borderRadius: 8 }
    : { transition: 'box-shadow 0.3s' };
