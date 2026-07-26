import { RADIUS, PAD, TONE } from './tokens';

// Panel — the ONE rounded surface. Replaces every hand-rolled
// `rounded-xl p-4 style={{ background: …, border: … }}` div.
//
//   <Panel>                          top-level page card  (surface / 2xl / md)
//   <Panel tone="inset" radius="xl"> a nested block inside a page card
//   <Panel pad="none">               panel that lays out its own padding
//
// Nesting rule: surface contains inset. Never surface-in-surface (they vanish
// against each other), never inset-in-inset.
export default function Panel({
  tone = 'surface',
  pad = 'md',
  radius = '2xl',
  as: Tag = 'div',
  className = '',
  style,
  children,
  ...rest
}) {
  return (
    <Tag
      className={`${RADIUS[radius] || RADIUS['2xl']} ${PAD[pad] ?? PAD.md} ${className}`}
      style={{ ...(TONE[tone] || TONE.surface), ...style }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
