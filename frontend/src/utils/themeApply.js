// ============================================================================
// themeApply — runtime CSS-variable theming.
//
// A "theme" is a compact object of 7 core tokens per mode:
//   { preset, light: {bg,surface,border,text,textSecondary,primary,accent},
//             dark:  { ...same keys } }
//
// From those 7, buildCssVars() derives the full --color-* set the app already
// consumes (primary 50..900 ramp, surfaces, text tiers, links, interactive
// states, scrollbar, gradients). We inject a single <style id="bsx-theme-vars">
// with :root { light } + html.dark { dark }; because it lands in <head> AFTER
// global.css it wins the cascade at equal specificity. Nothing is hard-coded in
// components, so overriding the vars re-themes everything — light AND dark — with
// no reload. When no theme is saved, global.css governs (current look untouched).
// ============================================================================

const STYLE_ID = 'bsx-theme-vars';
const CACHE_CSS = 'bsx.theme.css';   // last-applied CSS text — flash-free startup
const CACHE_OBJ = 'bsx.theme';       // last-applied theme object (debug / reuse)

// ── colour math ────────────────────────────────────────────────────────────
const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));

function hexToRgb(hex) {
  let h = String(hex || '').trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6 || /[^0-9a-f]/i.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const rgbToHex = (r, g, b) =>
  '#' + [r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('');

// Linear blend of two hex colours; t=0 → a, t=1 → b.
export function mix(a, b, t) {
  const ca = hexToRgb(a), cb = hexToRgb(b);
  if (!ca || !cb) return a;
  return rgbToHex(
    ca[0] + (cb[0] - ca[0]) * t,
    ca[1] + (cb[1] - ca[1]) * t,
    ca[2] + (cb[2] - ca[2]) * t,
  );
}

const WHITE = '#ffffff';
const BLACK = '#000000';
const lighten = (c, t) => mix(c, WHITE, t);
const darken = (c, t) => mix(c, BLACK, t);

// Generate the primary 50..900 ramp from a single base + mode. In light mode
// low stops are light tints, high stops dark shades. In dark mode the app uses
// the deep 800/900 stops as elevated dark surfaces (badges, table headers) and
// the low stops as light-on-dark text, so the ramp is inverted-ish.
function ramp(base, mode) {
  if (mode === 'dark') {
    return {
      50: lighten(base, 0.72), 100: lighten(base, 0.54), 200: lighten(base, 0.34),
      300: lighten(base, 0.16), 400: darken(base, 0.12), 500: base, 600: base,
      700: darken(base, 0.34), 800: darken(base, 0.66), 900: darken(base, 0.80),
    };
  }
  return {
    50: lighten(base, 0.92), 100: lighten(base, 0.82), 200: lighten(base, 0.64),
    300: lighten(base, 0.46), 400: lighten(base, 0.24), 500: base, 600: darken(base, 0.16),
    700: darken(base, 0.34), 800: darken(base, 0.52), 900: darken(base, 0.68),
  };
}

// Core tokens the editor exposes.
export const CORE_TOKENS = [
  { key: 'bg',            label: 'Background' },
  { key: 'surface',       label: 'Surface / cards' },
  { key: 'border',        label: 'Border' },
  { key: 'text',          label: 'Text' },
  { key: 'textSecondary', label: 'Muted text' },
  { key: 'primary',       label: 'Primary / brand' },
  { key: 'accent',        label: 'Accent' },
];

// Derive the full --color-* map (+ gradients) the stylesheet references, from
// the 7 core tokens. Everything not listed here (success/error/warning/info)
// intentionally falls through to global.css so status colours stay semantic.
export function buildCssVars(core, mode) {
  const { bg, surface, border, text, textSecondary, primary, accent } = core;
  const p = ramp(primary, mode);
  const bgSecondary = mix(bg, text, 0.06);
  const surfaceHover = mix(surface, text, 0.05);

  const vars = {
    '--color-bg': bg,
    '--color-bg-secondary': bgSecondary,
    '--color-surface': surface,
    '--color-surface-hover': surfaceHover,
    '--color-border': border,

    '--color-text': text,
    '--color-text-secondary': textSecondary,
    '--color-text-tertiary': mix(textSecondary, bg, 0.35),
    '--color-text-disabled': mix(textSecondary, bg, 0.6),
    '--color-text-inverse': bg,
    '--color-placeholder': mix(textSecondary, bg, 0.45),
    // Alias some components use as --color-text-muted; keep it in sync.
    '--color-text-muted': mix(textSecondary, bg, 0.15),

    '--color-primary': primary,
    '--color-primary-50': p[50], '--color-primary-100': p[100], '--color-primary-200': p[200],
    '--color-primary-300': p[300], '--color-primary-400': p[400], '--color-primary-500': p[500],
    '--color-primary-600': p[600], '--color-primary-700': p[700], '--color-primary-800': p[800],
    '--color-primary-900': p[900],

    '--color-accent': accent,
    '--color-cream-200': mode === 'dark' ? mix(border, BLACK, 0.1) : mix(bg, border, 0.5),
    '--color-cream-400': mode === 'dark' ? mix(border, primary, 0.3) : mix(border, text, 0.15),
    '--color-cream-500': mode === 'dark' ? mix(border, primary, 0.5) : mix(border, text, 0.3),

    '--color-link': mode === 'dark' ? lighten(primary, 0.2) : darken(primary, 0.2),
    '--color-link-hover': mode === 'dark' ? lighten(primary, 0.36) : darken(primary, 0.36),
    '--color-link-visited': primary,

    '--color-disabled-text': mix(textSecondary, bg, 0.5),
    '--color-disabled-bg': mix(bg, text, 0.08),
    '--color-interactive-hover': surfaceHover,
    '--color-interactive-active': mix(primary, bg, mode === 'dark' ? 0.78 : 0.82),
    '--color-focus-ring': mode === 'dark' ? accent : darken(primary, 0.2),

    '--scrollbar-track': bgSecondary,
    '--scrollbar-thumb': mix(border, text, 0.2),
    '--scrollbar-thumb-hover': mix(border, text, 0.4),

    '--color-skeleton': bgSecondary,
    '--color-skeleton-secondary': border,

    // Body background + sidebar gradients — must follow the palette or the old
    // amber gradient bleeds through on a cool theme.
    '--gradient-warm': `linear-gradient(135deg, ${mix(bg, primary, 0.05)} 0%, ${bg} 55%, ${mix(bg, accent, 0.05)} 100%)`,
    '--gradient-sidebar': `linear-gradient(180deg, ${darken(primary, 0.12)} 0%, ${darken(primary, 0.34)} 100%)`,
  };
  return vars;
}

const serialize = (vars) =>
  Object.entries(vars).map(([k, v]) => `${k}: ${v};`).join(' ');

// Full stylesheet text for a theme object.
export function themeToCss(theme) {
  if (!theme || !theme.light || !theme.dark) return '';
  const light = serialize(buildCssVars(theme.light, 'light'));
  const dark = serialize(buildCssVars(theme.dark, 'dark'));
  return `:root{${light}}\nhtml.dark{${dark}}`;
}

function upsertStyle(css) {
  let el = document.getElementById(STYLE_ID);
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = css;
}

// Apply a theme object to the live document. cache=true persists it for a
// flash-free next load; the editor's live preview passes cache=false so a
// scoped preview never overwrites the viewer's own cached theme.
export function applyTheme(theme, { cache = true } = {}) {
  const css = themeToCss(theme);
  if (!css) { clearTheme({ cache }); return; }
  upsertStyle(css);
  if (cache) {
    try {
      localStorage.setItem(CACHE_CSS, css);
      localStorage.setItem(CACHE_OBJ, JSON.stringify(theme));
    } catch { /* quota / private mode — non-fatal */ }
  }
}

// Remove any override so global.css governs again.
export function clearTheme({ cache = true } = {}) {
  document.getElementById(STYLE_ID)?.remove();
  if (cache) {
    try { localStorage.removeItem(CACHE_CSS); localStorage.removeItem(CACHE_OBJ); } catch { /* noop */ }
  }
}

// Re-inject the cached theme synchronously at startup (before React paints) so
// a saved theme doesn't flash the default palette on cold load.
export function applyCachedTheme() {
  try {
    const css = localStorage.getItem(CACHE_CSS);
    if (css) upsertStyle(css);
  } catch { /* noop */ }
}

export function getCachedTheme() {
  try { const s = localStorage.getItem(CACHE_OBJ); return s ? JSON.parse(s) : null; }
  catch { return null; }
}
