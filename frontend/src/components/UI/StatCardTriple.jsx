import { Card } from './index';

/* StatCardTriple — compact three-segment stat card used across all dashboards.
 *
 * Each segment is independently clickable so a closer/fronter/manager can click
 * Today, MTD (this month), or Total to drill into that exact range. Modern,
 * dense layout — number on top (primary tinted), label beneath:
 *   ┌──────────────────────────────┐
 *   │ LABEL                  [icon] │
 *   │   0   │   866   │    0        │
 *   │ TODAY │  MONTH  │  TOTAL      │
 *   └──────────────────────────────┘
 *
 * Props (unchanged — drop-in):
 *   label, icon (lucide), color (Tailwind family: success/info/primary/warning/
 *   error), loading, today/month/total = { value, onClick, title? }, caption,
 *   accent, gradientFrom (kept for API compat; gradient is now a subtle tint).
 *   segments (optional) — ordered array (1–3) of { label, value, onClick?,
 *   title?, isPrimary? } that overrides the today/month/total trio.
 */
const StatCardTriple = ({
  label,
  icon: Icon,
  color = 'primary',
  loading = false,
  today,
  month,
  total,
  segments,
  caption,
  accent,
  gradientFrom, // eslint-disable-line no-unused-vars
}) => {
  const stripe   = accent || `var(--color-${color}-500, #6366f1)`;
  const chipBg   = `var(--color-${color}-100, #ede9fe)`;
  const iconClr  = `var(--color-${color}-600, #4f46e5)`;
  const primClr  = `var(--color-${color}-600, #4f46e5)`;

  const resolved = Array.isArray(segments)
    ? segments.filter(Boolean)
    : [
        today && { label: 'Today',         ...today, isPrimary: true },
        month && { label: 'Current Month', ...month, isPrimary: !today },
        total && { label: 'Total',         ...total, isPrimary: !today && !month },
      ].filter(Boolean);

  const Segment = ({ data, isPrimary, first }) => {
    const segLabel = data?.label ?? '';
    const value = loading ? '—' : (data?.value ?? 0);
    const clickable = !!data?.onClick;
    return (
      <button
        type="button"
        onClick={clickable ? data.onClick : undefined}
        disabled={!clickable}
        title={data?.title || `${segLabel}: ${value}`}
        aria-label={`${label} ${segLabel} ${value}${clickable ? ', click to filter' : ''}`}
        className={`flex-1 min-w-0 flex flex-col items-center justify-center py-1.5 px-1.5 rounded-lg transition-colors ${clickable ? 'cursor-pointer hover:bg-bg-secondary' : 'cursor-default'}`}
        style={{ borderLeft: first ? 'none' : '1px solid var(--color-border)' }}
      >
        <span
          className="font-extrabold leading-none"
          style={{
            fontSize: isPrimary ? '1.4rem' : '1.05rem',
            color: isPrimary ? primClr : 'var(--color-text)',
            fontFamily: 'var(--font-display)',
            letterSpacing: '-0.02em',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {value}
        </span>
        <span className="text-[9px] font-bold uppercase tracking-wider text-text-tertiary mt-1 truncate max-w-full">
          {segLabel}
        </span>
      </button>
    );
  };

  return (
    <Card
      className="p-3.5 flex flex-col gap-2.5 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5"
      style={{ borderTop: `2px solid ${stripe}` }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-text-secondary truncate">
          {label}
        </p>
        {Icon && (
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: chipBg }}>
            <Icon size={14} style={{ color: iconClr }} />
          </div>
        )}
      </div>

      {resolved.length > 0 && (
        <div className="flex items-stretch" role="group" aria-label={`${label} stats`}>
          {resolved.map((seg, i) => (
            <Segment key={seg.key || seg.label || i} data={seg} isPrimary={seg.isPrimary} first={i === 0} />
          ))}
        </div>
      )}

      {caption && <p className="text-[10px] text-text-tertiary leading-tight">{caption}</p>}
    </Card>
  );
};

export default StatCardTriple;
