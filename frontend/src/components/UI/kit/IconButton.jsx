import { accent } from './tokens';

// IconButton — a square icon control that is 44px on touch and 36px on desktop.
//
// The header controls were a flat `w-9 h-9` (36px) everywhere, which is below
// the 44px touch minimum; a single admin screen at 390px measured 20 sub-44px
// targets. Growing them unconditionally would cost desktop density, so the size
// is a breakpoint: 44 below `sm`, today's 36 at `sm` and up.
//
//   <IconButton label="Open navigation" onClick={…}><Menu size={18} /></IconButton>
//
// Not UI/Button.jsx: that one is a padded TEXT button (px-4 py-2, variants and
// sizes) with no square form. This is the icon-only case, and `label` is what
// makes it announce as something other than "button" to a screen reader.
export default function IconButton({
  children,
  label,
  onClick,
  tone = 'default',
  variant = 'surface',   // 'surface' (bordered) | 'ghost' (bare) | 'solid'
  active = false,
  disabled = false,
  className = '',
  style,
  ...rest
}) {
  const a = accent(tone);

  const base = {
    surface: { backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' },
    ghost:   { backgroundColor: 'transparent',          border: '1px solid transparent' },
    solid:   { background: 'var(--gradient-sidebar)',   border: '1px solid transparent' },
  }[variant] || {};

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      className={`w-11 h-11 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105'} ${className}`}
      style={{
        color: variant === 'solid' ? 'white' : (active ? a.fg : 'var(--color-text-secondary)'),
        ...base,
        // Active tint uses the tone's soft fill + same-tone text. Never a solid
        // `-600` fill with white on it: dark mode inverts those scales.
        ...(active && variant !== 'solid' ? { backgroundColor: a.soft, borderColor: a.fg } : null),
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
