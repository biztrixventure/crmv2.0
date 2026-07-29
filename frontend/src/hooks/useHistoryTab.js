import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * A tab selector that leaves a REAL browser-history entry behind on every
 * change — which is the whole reason it exists.
 *
 * WHY. An installed PWA has no browser chrome and no back button, so the only
 * "go back" a phone user has is the edge swipe, and that swipe is history.back().
 * Every shell kept its active tab in localStorage and never touched the URL, so
 * a session that had visited a dozen tabs still sat at history.length === 1 —
 * measured on production — and the swipe fell straight through to the iOS
 * system gesture, which DISMISSES the app. That is the bug: not that back went
 * somewhere wrong, but that there was never anywhere to go back to.
 *
 * THE CONTRACT WITH usePersistedState IS UNCHANGED ON PURPOSE: the same
 * localStorage key, written in the same JSON shape. localStorage stays the
 * source of truth across a reload; the URL is only the carrier that gives the
 * back stack something to pop. A user's persisted tab choice therefore survives
 * this untouched, and no tab id is renamed or dropped — readonly-admin
 * governance stores those ids by name.
 *
 * Navigation goes through react-router's navigate() rather than a raw
 * history.pushState: the router keeps its own bookkeeping (`idx`, `key`) inside
 * window.history.state, and stamping over that by hand desynchronises it.
 *
 * @param key             localStorage key — the SAME one usePersistedState used
 * @param defaultValue    tab id to use when neither URL nor storage has one
 * @param options.param   query-string parameter to carry the tab in (default 't')
 * @param options.persist false for a shell whose tab was NEVER persisted (the
 *                        Compliance shell) — it gets the history entries without
 *                        silently gaining a restore behaviour it never had.
 */
export function useHistoryTab(key, defaultValue, options = {}) {
  const param    = options.param || 't';
  const persist  = options.persist !== false;
  const navigate = useNavigate();
  const location = useLocation();

  // URL beats localStorage. That ordering is what makes a deep link — a clicked
  // notification, a URL shared between two people — land on the tab it names
  // instead of on whatever tab this particular device happened to leave open.
  const [value, setValue] = useState(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get(param);
      if (fromUrl) return fromUrl;
    } catch { /* malformed query string — fall through to storage */ }
    if (persist && key) {
      try {
        const raw = window.localStorage.getItem(key);
        if (raw !== null) return JSON.parse(raw);
      } catch { /* quota, private mode, or corrupt JSON */ }
    }
    return defaultValue;
  });

  // What the FIRST history entry means. Swiping back to it — the one entry that
  // predates any push and so carries no param — has to restore this.
  const initial  = useRef(value);
  const valueRef = useRef(value);
  const stateRef = useRef(location.state);
  valueRef.current = value;
  stateRef.current = location.state;

  useEffect(() => {
    if (!persist || !key) return;
    try { window.localStorage.setItem(key, JSON.stringify(value)); }
    catch { /* quota or private mode — ignore */ }
  }, [key, value, persist]);

  // Back / forward (or an edge swipe): the URL moved under us, so follow it.
  useEffect(() => {
    const p = new URLSearchParams(location.search).get(param);
    if (p != null) {
      if (p !== valueRef.current) setValue(p);
    } else if (initial.current !== valueRef.current) {
      setValue(initial.current);
    }
  }, [location.search, param]);

  const set = useCallback((next, opts = {}) => {
    const prev     = valueRef.current;
    const resolved = typeof next === 'function' ? next(prev) : next;
    if (resolved === prev) return;

    const sp = new URLSearchParams(window.location.search);

    // Stamp the CURRENT tab onto the CURRENT entry before pushing the next one.
    // Without this the entry being left behind carries no param, so swiping
    // back to it would read "no tab" and land somewhere arbitrary.
    if (!opts.replace && sp.get(param) !== String(prev)) {
      sp.set(param, String(prev));
      navigate({ search: `?${sp.toString()}` }, { replace: true, state: stateRef.current });
    }

    sp.set(param, String(resolved));
    navigate({ search: `?${sp.toString()}` }, { replace: !!opts.replace, state: stateRef.current });

    valueRef.current = resolved;
    setValue(resolved);
  }, [navigate, param]);

  return [value, set];
}

/**
 * True while the app is running as an installed PWA (iOS home-screen, or an
 * Android/desktop installed window). Standalone is the mode with NO browser
 * chrome, so it is the only mode that needs an in-app back control — showing
 * one in a normal tab would just duplicate the browser's own.
 */
export function useStandalone() {
  const [standalone, setStandalone] = useState(() => isStandalone());
  useEffect(() => {
    let mq;
    try { mq = window.matchMedia('(display-mode: standalone)'); } catch { return undefined; }
    const on = () => setStandalone(isStandalone());
    // addEventListener on a MediaQueryList is missing in older WebKit, which is
    // exactly the platform this feature is for — so keep the addListener path.
    if (mq.addEventListener) mq.addEventListener('change', on);
    else if (mq.addListener) mq.addListener(on);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', on);
      else if (mq.removeListener) mq.removeListener(on);
    };
  }, []);
  return standalone;
}

/**
 * True when this SPA session has an entry behind the current one.
 *
 * `history.length` is useless for this: it counts the whole tab's history
 * including whatever was open before the app, and in an installed PWA it is
 * pinned at 1 until something pushes. react-router keeps its own position in
 * window.history.state.idx, which is exactly "how many entries deep into THIS
 * router session are we" — so idx > 0 means going back stays inside the app,
 * and idx === 0 means back would leave it. A back button that could exit the
 * app is worse than no back button, so this is the conservative signal.
 */
export function useCanGoBack() {
  const location = useLocation();          // re-render on every navigation
  const idx = typeof window !== 'undefined' ? window.history.state?.idx : 0;
  // location is read so the hook re-evaluates; the value itself is unused.
  void location;
  return typeof idx === 'number' && idx > 0;
}

export function isStandalone() {
  try {
    // navigator.standalone is iOS-only and is the ONLY signal iOS sets for a
    // home-screen app; display-mode covers Android and desktop installs.
    return window.navigator.standalone === true
      || window.matchMedia('(display-mode: standalone)').matches
      || window.matchMedia('(display-mode: fullscreen)').matches
      || window.matchMedia('(display-mode: minimal-ui)').matches;
  } catch { return false; }
}
