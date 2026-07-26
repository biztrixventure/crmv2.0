import { accent } from './tokens';

// KpiTile — one number, stated once. The Compliance shell's KPI strip shape, made
// reusable so admin tabs stop inventing their own stat cards.
//
//   <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
//     <KpiTile icon={Users} label="Active users" value={412} sub="+8 this week" tone="primary" />
//   </div>
//
// `value` is rendered as-is — format numbers at the call site (toLocaleString) so
// the tile never guesses a locale or a currency. Unlike UI/StatCardTriple this is
// a single tile, so a surface can show 2, 4 or 6 of them in its own grid.
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
      className={`rounded-2xl p-4 flex items-start gap-3 ${interactive ? 'cursor-pointer transition-transform hover:-translate-y-0.5' : ''} ${className}`}
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      {Icon && (
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: a.soft }}>
          <Icon size={17} style={{ color: a.fg }} />
        </div>
      )}
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wider truncate" style={{ color: 'var(--color-text-secondary)' }}>{label}</p>
        <p className="text-2xl font-bold leading-tight" style={{ color: 'var(--color-text)' }}>{value}</p>
        {sub && <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--color-text-tertiary)' }}>{sub}</p>}
      </div>
    </div>
  );
}
