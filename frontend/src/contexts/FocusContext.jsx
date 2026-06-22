/**
 * FocusContext — one place that turns "a notification was clicked" into
 * "navigate to that record + highlight it for ~5s", for both:
 *   • the in-app bell (NotificationBell → openFromNotification)
 *   • the OS push notification (service worker → postMessage / openWindow)
 *
 * It does NOT know each shell's tab layout. It only holds the current focus
 * target { kind, id, ts }; shells subscribe via useFocus() and switch to the
 * matching tab, and rows highlight themselves via useFocusHighlight(kind, id).
 */
import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { resolveNotificationTarget } from '../utils/notificationNav';

const FocusContext = createContext(null);

// How long a focus target stays "hot" — drives both the highlight ring and the
// window for a late-mounting row (tab just switched, list still loading) to
// still catch it and scroll into view.
const FOCUS_TTL_MS = 6000;

export function FocusProvider({ children }) {
  const [focus, setFocus] = useState(null); // { kind, id, ref, ts } | null
  const timer = useRef(null);

  const requestFocus = useCallback((target) => {
    if (!target || !target.kind) return;
    clearTimeout(timer.current);
    setFocus({
      kind: target.kind,
      id:   target.id != null ? String(target.id) : null,
      ref:  target.ref || null,
      ts:   Date.now(),
    });
    timer.current = setTimeout(() => setFocus(null), FOCUS_TTL_MS);
  }, []);

  const openFromNotification = useCallback((n) => {
    requestFocus(resolveNotificationTarget(n));
  }, [requestFocus]);

  // OS notification clicked while a tab is open → SW posts NOTIFICATION_CLICK.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMsg = (e) => {
      if (e.data?.type === 'NOTIFICATION_CLICK') {
        requestFocus(resolveNotificationTarget({ type: e.data.data?.type, data: e.data.data }));
      }
    };
    navigator.serviceWorker.addEventListener('message', onMsg);
    return () => navigator.serviceWorker.removeEventListener('message', onMsg);
  }, [requestFocus]);

  // Cold open from SW openWindow('/dashboard?fkind=&fid=') → consume the params
  // once, then strip them so a refresh doesn't re-focus.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const kind = sp.get('fkind');
    if (kind) {
      requestFocus({ kind, id: sp.get('fid') });
      sp.delete('fkind'); sp.delete('fid');
      const q = sp.toString();
      window.history.replaceState({}, '', window.location.pathname + (q ? `?${q}` : '') + window.location.hash);
    }
  }, [requestFocus]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <FocusContext.Provider value={{ focus, requestFocus, openFromNotification }}>
      {children}
    </FocusContext.Provider>
  );
}

export function useFocus() {
  return useContext(FocusContext) || { focus: null, requestFocus: () => {}, openFromNotification: () => {} };
}

/**
 * Row/card helper. Returns { ref, focused }. When this row is the focus target,
 * focused flips true (apply a ring), and the row scrolls into view. The shell is
 * responsible for already being on the right tab.
 */
export function useFocusHighlight(kind, id) {
  const { focus } = useFocus();
  const ref = useRef(null);
  const focused = !!focus && focus.kind === kind && id != null && String(focus.id) === String(id);
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
