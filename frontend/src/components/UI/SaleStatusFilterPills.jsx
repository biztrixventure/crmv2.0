import { useMemo } from 'react';
import { useComplianceStatuses } from '../../hooks/useComplianceStatuses';

/*
 * SaleStatusFilterPills
 *
 * Dynamic, scrollable pill row that mirrors the admin-configured compliance
 * status catalog (Business Rules → Compliance Workflow). Replaces the static
 * pill arrays previously hardcoded in StaffShell + ManagerShell, so any
 * status SuperAdmin adds/disables/renames in the catalog flows here
 * automatically.
 *
 * UX rules (logical sequence, left → right):
 *   1. "All" — clears the filter, always first.
 *   2. Pending group — work that still needs action (open, follow_up,
 *      pending_review, needs_revision, dispute).
 *   3. Won group — closed sales that count toward revenue.
 *   4. Lost group — closed sales that did not convert.
 *
 * Each group is visually separated by a thin divider so the manager reads
 * the funnel left → right without scanning. Within each group, the
 * catalog's declared order is preserved (admin-defined priority wins).
 *
 * Props:
 *   value        — currently selected status key ('' = All)
 *   onChange(k)  — fired with the next status key
 *   className    — optional pass-through for the outer container
 */

const CATEGORY_ORDER = ['pending', 'won', 'lost'];

// Badge → CSS variable lookup for the tiny status dot on each pill. Falls
// back to a neutral border color when the catalog entry uses an unknown
// badge.
const DOT_COLOR = {
  success:   'var(--color-success-500)',
  error:     'var(--color-error-500)',
  warning:   'var(--color-warning-500)',
  info:      'var(--color-info-500)',
  primary:   'var(--color-primary-500)',
  secondary: 'var(--color-border)',
};
const dotFor = (badge) => DOT_COLOR[badge] || 'var(--color-border)';

export default function SaleStatusFilterPills({ value = '', onChange, className = '' }) {
  const { catalog } = useComplianceStatuses();

  // Bucket enabled statuses by category, keep declared order within each
  // bucket. Unknown categories land in a trailing "other" bucket so a future
  // admin-defined category still renders rather than vanishing.
  const groups = useMemo(() => {
    const buckets = { pending: [], won: [], lost: [], other: [] };
    (catalog || []).forEach(s => {
      if (!s || !s.key || s.enabled === false) return;
      const cat = CATEGORY_ORDER.includes(s.category) ? s.category : 'other';
      buckets[cat].push(s);
    });
    return [
      { key: 'pending', label: 'Pending', items: buckets.pending },
      { key: 'won',     label: 'Won',     items: buckets.won },
      { key: 'lost',    label: 'Lost',    items: buckets.lost },
      { key: 'other',   label: 'Other',   items: buckets.other },
    ].filter(g => g.items.length > 0);
  }, [catalog]);

  const pill = (k, l, title, badge) => {
    const active = value === k;
    return (
      <button
        key={k || '__all'}
        type="button"
        title={title || l}
        onClick={() => onChange?.(k)}
        className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap flex-shrink-0 flex items-center gap-1.5"
        style={{
          background: active ? 'var(--gradient-sidebar)' : 'transparent',
          color:      active ? 'white' : 'var(--color-text-secondary)',
          boxShadow:  active ? 'var(--shadow-sm)' : 'none',
        }}
      >
        {badge && (
          <span
            aria-hidden
            className="inline-block rounded-full flex-shrink-0"
            style={{ width: 7, height: 7, backgroundColor: dotFor(badge) }}
          />
        )}
        {l}
      </button>
    );
  };

  return (
    <div
      className={`flex gap-1 p-1 rounded-xl overflow-x-auto items-center ${className}`}
      style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
    >
      {pill('', 'All', 'Show every status')}

      {groups.map((g, gi) => (
        <div key={g.key} className="flex items-center gap-1 flex-shrink-0">
          <span
            aria-hidden
            className="h-5 w-px mx-1 flex-shrink-0"
            style={{ backgroundColor: 'var(--color-border)' }}
          />
          {/* Tiny category caption — keeps the funnel readable at a glance
              without crowding the pills. Hidden on the smallest screens via
              the parent's overflow-x scroll. */}
          <span
            className="text-[10px] uppercase tracking-widest font-bold px-1 flex-shrink-0"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            {g.label}
          </span>
          {g.items.map(s => pill(s.key, s.label, s.label, s.badge))}
        </div>
      ))}
    </div>
  );
}
