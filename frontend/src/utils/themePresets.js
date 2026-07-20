// ============================================================================
// themePresets — the 4 pickable theme directions. Each carries the 7 core
// tokens per mode (see CORE_TOKENS in themeApply.js); buildCssVars() derives
// the rest. "Obsidian & Amber" mirrors the current global.css default, so
// picking it reproduces today's look. The others are fully theme-var driven and
// work in both light and dark.
// ============================================================================

export const THEME_PRESETS = [
  {
    id: 'obsidian_amber',
    name: 'Obsidian & Amber',
    desc: 'Warm amber on obsidian — the current default.',
    light: { bg: '#F5EDE4', surface: '#FDFBF8', border: '#D4C0A5', text: '#241C11', textSecondary: '#5A4F45', primary: '#8B7049', accent: '#A67720' },
    dark:  { bg: '#0D0A07', surface: '#1A1108', border: '#2C1E10', text: '#F0E6D8', textSecondary: '#C0A282', primary: '#C4894A', accent: '#D4905A' },
  },
  {
    id: 'midnight_indigo',
    name: 'Midnight Indigo',
    desc: 'Cool indigo with a deep blue-black night mode.',
    light: { bg: '#F4F5FB', surface: '#FFFFFF', border: '#D5D9EC', text: '#1A1B2E', textSecondary: '#4A4E6B', primary: '#4F46E5', accent: '#6366F1' },
    dark:  { bg: '#0B0C1A', surface: '#14162B', border: '#262A47', text: '#E6E8F5', textSecondary: '#A4A9C9', primary: '#818CF8', accent: '#A5B4FC' },
  },
  {
    id: 'slate_indigo',
    name: 'Slate & Indigo',
    desc: 'Neutral slate greys with an indigo brand.',
    light: { bg: '#F1F5F9', surface: '#FFFFFF', border: '#CBD5E1', text: '#0F172A', textSecondary: '#475569', primary: '#4338CA', accent: '#6D28D9' },
    dark:  { bg: '#0A0F1A', surface: '#131A2A', border: '#24304A', text: '#E2E8F0', textSecondary: '#94A3B8', primary: '#6366F1', accent: '#8B5CF6' },
  },
  {
    id: 'nordic_calm',
    name: 'Nordic Calm',
    desc: 'Muted teal-green, soft and low-contrast.',
    light: { bg: '#F0F4F3', surface: '#FFFFFF', border: '#CBDAD5', text: '#1B2B27', textSecondary: '#4B615B', primary: '#2F7D6B', accent: '#3E9C86' },
    dark:  { bg: '#08110F', surface: '#10201C', border: '#1F332D', text: '#E1EDE9', textSecondary: '#9BB5AD', primary: '#4FB89E', accent: '#63D0B3' },
  },
];

export const DEFAULT_PRESET_ID = 'obsidian_amber';

export const getPreset = (id) =>
  THEME_PRESETS.find((p) => p.id === id) || THEME_PRESETS[0];

// A fresh theme object from a preset id (deep-cloned so edits don't mutate the
// preset constant).
export function themeFromPreset(id) {
  const p = getPreset(id);
  return {
    preset: p.id,
    light: { ...p.light },
    dark: { ...p.dark },
  };
}
