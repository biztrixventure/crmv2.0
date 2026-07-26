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
export default function KpiTile({
  icon: Icon,
  label,
  value,
  sub,
  tone = 'primary',
  onClick,
  className = '',
}) {
  const a = accent(tone);
  const interactive = typeof onClick === 'function';
  return (
    <div
      className={`relative overflow-hidden rounded-xl pl-4 pr-3 py-2.5 ${interactive ? 'cursor-pointer transition-colors' : ''} ${className}`}
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      onMouseEnter={interactive ? (e) => { e.currentTarget.style.borderColor = a.fg; } : undefined}
      onMouseLeave={interactive ? (e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; } : undefined}
    >
      {/* tone rail — scan a strip of tiles by color before reading */}
      <span aria-hidden className="absolute left-0 top-0 bottom-0" style={{ width: 3, background: a.fg }} />

      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wider truncate" style={{ color: 'var(--color-text-secondary)' }}>
          {label}
        </p>
        {Icon && <Icon size={13} className="flex-shrink-0 mt-px" style={{ color: a.fg, opacity: 0.55 }} />}
      </div>

      <p className="font-bold leading-none mt-1.5" style={{ color: 'var(--color-text)', fontSize: 24, letterSpacing: '-0.02em' }}>
        {value}
      </p>

      {sub && (
        <p className="text-[11px] mt-1 truncate" style={{ color: 'var(--color-text-tertiary)' }}>{sub}</p>
      )}
    </div>
  );
}
