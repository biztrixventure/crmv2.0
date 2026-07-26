// ============================================================================
// kit/tokens.js — the ONE place the kit resolves radii, padding and tones.
//
// Everything maps onto CSS variables already defined in styles/global.css
// (--radius-*, --color-*), so every kit component follows the active theme in
// light AND dark with zero per-theme code. Never inline a hex literal in a kit
// component (or in a surface migrated to the kit) — add a tone here instead.
// ============================================================================

// Radius scale — matches --radius-* in global.css:128-134.
//   lg  8px  → controls, chips, small buttons
//   xl  12px → nested / inset panels
//   2xl 16px → top-level page cards, modals, KPI tiles
export const RADIUS = {
  lg:    'rounded-lg',
  xl:    'rounded-xl',
  '2xl': 'rounded-2xl',
  full:  'rounded-full',
};

// Padding scale for panels. `md` is the default for nested panels, `lg` for
// top-level page cards. Anything needing something else takes pad="none" and
// lays itself out.
export const PAD = {
  none: '',
  xs:   'p-2',
  sm:   'p-3',
  md:   'p-4',
  lg:   'p-5',
};

// Surface tones. The nesting rule is: a `surface` panel contains `inset`
// panels — never surface inside surface (they become invisible against each
// other) and never inset inside inset.
export const TONE = {
  surface: { background: 'var(--color-surface)', border: '1px solid var(--color-border)' },
  inset:   { background: 'var(--color-bg)',      border: '1px solid var(--color-border)' },
  ghost:   { background: 'transparent',          border: '1px solid transparent' },
};

// Semantic accents — for icons, values, badges, action rows. `fg` is the text/
// icon color; `soft` is a translucent fill derived from the same token so it
// stays legible on either theme (color-mix, no hardcoded rgba).
const mix = (v, pct) => `color-mix(in srgb, ${v} ${pct}%, transparent)`;
export const ACCENT = {
  default: { fg: 'var(--color-text)',           soft: 'var(--color-bg-secondary)' },
  muted:   { fg: 'var(--color-text-secondary)', soft: 'var(--color-bg-secondary)' },
  primary: { fg: 'var(--color-primary-600)',    soft: mix('var(--color-primary-600)', 12) },
  success: { fg: 'var(--color-success-600)',    soft: mix('var(--color-success-600)', 12) },
  warn:    { fg: 'var(--color-warning-600)',    soft: mix('var(--color-warning-600)', 14) },
  danger:  { fg: 'var(--color-error-600)',      soft: mix('var(--color-error-600)',   12) },
  info:    { fg: 'var(--color-info-600)',       soft: mix('var(--color-info-600)',    12) },
};

export const accent = (tone) => ACCENT[tone] || ACCENT.default;
