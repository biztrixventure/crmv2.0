import { accent } from './tokens';

// KpiTile — one number, stated once, at instrument-panel density.
//
// The first version put a large icon chip beside a big value, which left each
// tile ~90px tall and mostly empty — four of them shouting "0" and using a
// third of the viewport before any real content. This version leads with the
// LABEL (you read what it is, then the number), drops the value to a size that
// still dominates without inflating the box, and demotes the icon to a quiet
// mark in the corner. Same information, roughly half the height.
//
// The left accent rail is the signature: a 3px bar in the metric's tone, so a
// strip of tiles is scannable by color before you read a word. It is the one
// decorative element here and it encodes the metric's status, so it earns its
// place.
//
//   <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
//     <KpiTile icon={Users} label="Active users" value={412} sub="+8 this week" tone="primary" />
//   </div>
//
// `value` renders as-is — format at the call site (toLocaleString) so the tile
// never guesses a locale or currency.
// `active` marks a tile that is ALSO a filter and is currently applied (the FAQ
// and Script tiles work this way). It reads as selected through a tone tint +
// tone border + tone value — deliberately NOT a flood-fill of the tone color:
// with four tiles in a row, filling one solid turns the strip into a single loud
// block, and it's the same reason the tab track lifts the active tab instead of
// saturating it. Selected still survives without color (border weight + value
// color both shift).
export default function KpiTile({
  icon: Icon,
  label,
  value,
  sub,
  tone = 'primary',
  onClick,
  active,
  className = '',
}) {
  const a = accent(tone);
  const interactive = typeof onClick === 'function';
  const isToggle = interactive && active !== undefined;
  const Tag = interactive ? 'button' : 'div';

  // Note: no w-full here. Grid parents stretch the tile to its cell anyway,
  // whereas in a flex-wrap row w-full forces one tile per line — that stacked
  // the FAQ filter tiles vertically. Flex callers pass flex-1 + a min-width.
  return (
    <Tag
      type={interactive ? 'button' : undefined}
      className={`relative overflow-hidden rounded-xl pl-4 pr-3 py-2.5 text-left ${interactive ? 'cursor-pointer transition-colors' : ''} ${className}`}
      style={{
        background: active ? a.soft : 'var(--color-surface)',
        border: `1px solid ${active ? a.fg : 'var(--color-border)'}`,
      }}
      onClick={onClick}
      aria-pressed={isToggle ? !!active : undefined}
      onMouseEnter={interactive && !active ? (e) => { e.currentTarget.style.borderColor = a.fg; } : undefined}
      onMouseLeave={interactive && !active ? (e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; } : undefined}
    >
      {/* tone rail — scan a strip of tiles by color before reading */}
      <span aria-hidden className="absolute left-0 top-0 bottom-0" style={{ width: active ? 4 : 3, background: a.fg }} />

      {/* leading-none matters here: Tailwind's arbitrary text-[10px] sets the
          font size ONLY, so the label keeps the inherited 24px line-height and
          a 10px label silently occupies a 24px+ row — which is what made these
          tiles ~40px taller than intended. */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wider truncate leading-none"
          style={{ color: active ? a.fg : 'var(--color-text-secondary)' }}>
          {label}
        </p>
        {Icon && <Icon size={13} className="flex-shrink-0 -mt-0.5" style={{ color: a.fg, opacity: active ? 1 : 0.55 }} />}
      </div>

      <p className="font-bold leading-none mt-2 tabular-nums"
        style={{ color: active ? a.fg : 'var(--color-text)', fontSize: 24, letterSpacing: '-0.02em' }}>
        {value}
      </p>

      {sub && (
        <p className="text-[11px] mt-1.5 truncate leading-none" style={{ color: 'var(--color-text-tertiary)' }}>{sub}</p>
      )}
    </Tag>
  );
}
