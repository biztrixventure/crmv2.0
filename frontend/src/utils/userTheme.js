// ============================================================================
// userTheme — a PER-USER personal colour override, stored CLIENT-SIDE only
// (localStorage — never the DB). It layers ON TOP of the company/global theme
// (ThemeRuntime), so a user can recolour their own CRM without affecting anyone
// else and without a server round-trip.
//
// Why it always wins: the company theme injects `:root{…}` / `html.dark{…}`
// (themeApply.js). We inject a SEPARATE <style id="bsx-user-theme-vars"> using
// MORE SPECIFIC selectors — `:root:root{…}` / `html.dark:root{…}` — so the user
// layer beats the company layer regardless of <head> source order. Same 7-token
// theme shape + buildCssVars() as the app theme, so light AND dark both apply.
//
// Storage (per browser, keyed by user id so two logins don't share):
//   bsx.user.theme.<uid>  → the theme object {preset,light,dark,borders?}
//   bsx.user.theme.css    → last-applied CSS text (flash-free boot paint)
//   bsx.user.theme.uid    → which uid the cached css belongs to
// localStorage (not IndexedDB) is the right tool here: the payload is a tiny
// JSON blob read synchronously at boot to avoid a flash — exactly localStorage's
// sweet spot; IndexedDB's async API would reintroduce the flash it prevents.
// ============================================================================
import { buildCssVars } from './themeApply';

const STYLE_ID  = 'bsx-user-theme-vars';
const OBJ_KEY   = (uid) => `bsx.user.theme.${uid}`;
const CSS_KEY   = 'bsx.user.theme.css';
const UID_KEY   = 'bsx.user.theme.uid';

const serialize = (vars) => Object.entries(vars).map(([k, v]) => `${k}: ${v};`).join(' ');

function userThemeToCss(theme) {
  if (!theme || !theme.light || !theme.dark) return '';
  const b = theme.borders || 'normal';
  // Doubled :root / trailing :root raise specificity above the company layer.
  const light = serialize(buildCssVars(theme.light, 'light', b));
  const dark  = serialize(buildCssVars(theme.dark, 'dark', b));
  return `:root:root{${light}}\nhtml.dark:root{${dark}}`;
}

function upsertStyle(css) {
  let el = document.getElementById(STYLE_ID);
  if (!el) { el = document.createElement('style'); el.id = STYLE_ID; document.head.appendChild(el); }
  el.textContent = css;
}
function removeStyle() { document.getElementById(STYLE_ID)?.remove(); }

// Read the stored personal theme for a user (or null).
export function getUserTheme(uid) {
  if (!uid) return null;
  try { const s = localStorage.getItem(OBJ_KEY(uid)); return s ? JSON.parse(s) : null; }
  catch { return null; }
}

// Apply + persist a personal theme for a user. Pass cache:false for live preview
// (paints without persisting) so cancelling reverts on the next applyUserTheme.
export function applyUserTheme(theme, uid, { cache = true } = {}) {
  const css = userThemeToCss(theme);
  if (!css) { clearUserTheme(uid, { cache }); return; }
  upsertStyle(css);
  if (cache) {
    try {
      if (uid) localStorage.setItem(OBJ_KEY(uid), JSON.stringify(theme));
      localStorage.setItem(CSS_KEY, css);
      if (uid) localStorage.setItem(UID_KEY, uid);
    } catch { /* quota / private mode — non-fatal */ }
  }
}

// Remove the personal override (revert to the company/global theme).
export function clearUserTheme(uid, { cache = true } = {}) {
  removeStyle();
  if (cache) {
    try {
      if (uid) localStorage.removeItem(OBJ_KEY(uid));
      localStorage.removeItem(CSS_KEY);
      localStorage.removeItem(UID_KEY);
    } catch { /* noop */ }
  }
}

// Boot paint (main.jsx, before React) — re-inject the last-applied user CSS so a
// personal theme doesn't flash the company palette on cold load. The correct
// per-user reconciliation happens after auth in UserThemeRuntime.
export function applyCachedUserTheme() {
  try { const css = localStorage.getItem(CSS_KEY); if (css) upsertStyle(css); }
  catch { /* noop */ }
}

// After auth: apply THIS user's personal theme, or clear a stale one (e.g. the
// boot paint belonged to a different user who logged out on this browser).
export function reconcileUserTheme(uid) {
  const theme = getUserTheme(uid);
  if (theme) applyUserTheme(theme, uid);
  else {
    // No personal theme for this user — drop any lingering cached paint.
    let cachedUid = null;
    try { cachedUid = localStorage.getItem(UID_KEY); } catch { /* noop */ }
    removeStyle();
    if (cachedUid !== uid) { try { localStorage.removeItem(CSS_KEY); localStorage.removeItem(UID_KEY); } catch { /* noop */ } }
  }
}
