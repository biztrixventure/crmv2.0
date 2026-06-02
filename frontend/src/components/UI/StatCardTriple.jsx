import { Card } from './index';

/* StatCardTriple — three-segment stat card used across all dashboards.
 *
 * Each segment is independently clickable so a closer/fronter/manager can
 * click Today, MTD (this month), or Total to drill into that exact range.
 * Layout:
 *   ┌───────────────────────────────────────┐
 *   │ LABEL                          [icon] │
 *   │ ┌──────────┬──────────┬─────────────┐ │
 *   │ │ TODAY    │   MTD    │   TOTAL     │ │
 *   │ │  12      │   45     │   248       │ │
 *   │ └──────────┴──────────┴─────────────┘ │
 *   └───────────────────────────────────────┘
 *
 * Each segment has its own onClick + title for hover/aria, so the click is
 * fully discoverable and a screen reader user can announce each value.
 *
 * Props:
 *   label, icon (lucide), color (Tailwind family: success, info, primary,
 *   warning, error), loading (bool), tints (optional accent + gradient),
 *   today / month / total = { value, onClick, title? }
 */
const StatCardTriple = ({
  label,
  icon: Icon,
  color = 'primary',
  loading = false,
  today,
  month,
  total,
  caption,
  accent,
  gradientFrom,
}) => {
  const stripe = accent || `var(--color-${color}-500, #6366f1)`;
  const tint  = gradientFrom || `var(--color-${color}-50, #f5f3ff)`;

  const Segment = ({ data, label: segLabel, isPrimary }) => {
    const value = loading ? '—' : (data?.value ?? 0);
    const clickable = !!data?.onClick;
    return (
      <button
        type="button"
        onClick={clickable ? data.onClick : undefined}
        disabled={!clickable}
        title={data?.title || `${segLabel}: ${value}`}
        aria-label={`${label} ${segLabel} ${value}${clickable ? ', click to filter' : ''}`}
        className={`flex-1 flex flex-col items-center justify-center py-2.5 px-2 transition-colors text-center ${clickable ? 'cursor-pointer hover:bg-white/40 dark:hover:bg-white/5' : 'cursor-default'}`}
        style={{ minHeight: 64, minWidth: 0 }}
      >
        <span className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary mb-0.5">
          {segLabel}
        </span>
        <span
          className={`font-bold leading-none ${isPrimary ? 'text-2xl' : 'text-xl'}`}
          style={{
            color: `var(--color-${color}-600, #4f46e5)`,
            fontFamily: 'var(--font-display)',
            letterSpacing: '-0.03em',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {value}
        </span>
      </button>
    );
  };

  return (
    <Card
      className="p-4 min-h-[140px] flex flex-col justify-between transition-all hover:shadow-lg"
      style={{
        background: `linear-gradient(135deg, ${tint} 0%, var(--color-surface) 60%)`,
        borderTop: `3px solid ${stripe}`,
      }}
    >
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary truncate">
          {label}
        </p>
        {Icon && (
          <div
            className="p-2 rounded-xl shrink-0"
            style={{ backgroundColor: `var(--color-${color}-100, #ede9fe)` }}
          >
            <Icon size={16} style={{ color: `var(--color-${color}-600, #4f46e5)` }} />
          </div>
        )}
      </div>

      <div
        className="flex rounded-xl divide-x overflow-hidden"
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          // divide-x uses border-color; tailwind sets a CSS var fallback
        }}
        role="group"
        aria-label={`${label} stats`}
      >
        {today && <Segment data={today} label="Today" isPrimary />}
        {month && <Segment data={month} label="MTD"  isPrimary={!today} />}
        {total && <Segment data={total} label="Total" />}
      </div>

      {caption && (
        <p className="text-[10px] text-text-tertiary mt-1.5">{caption}</p>
      )}
    </Card>
  );
};

export default StatCardTriple;
