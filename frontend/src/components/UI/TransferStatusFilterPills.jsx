import { useMemo } from 'react';
import { useTransferStatuses } from '../../hooks/useTransferStatuses';

/*
 * TransferStatusFilterPills
 *
 * Dynamic, scrollable pill row mirroring the admin-configured
 * transfer.status_catalog (Business Rules → Transfer Lifecycle). Replaces
 * the static pill arrays previously hardcoded in StaffShell + ManagerShell
 * so any rename/disable/reorder in the SuperAdmin catalog flows here
 * automatically.
 *
 * Transfer status is a linear lifecycle (pending → assigned → completed,
 * with rejected/cancelled as off-ramps), so the pills render in the
 * catalog's declared order — no group captions, just a small colored
 * status dot per pill for visual scanning.
 */

const DOT_COLOR = {
  success:   'var(--color-success-500)',
  error:     'var(--color-error-500)',
  warning:   'var(--color-warning-500)',
  info:      'var(--color-info-500)',
  primary:   'var(--color-primary-500)',
  secondary: 'var(--color-border)',
};
const dotFor = (badge) => DOT_COLOR[badge] || 'var(--color-border)';

export default function TransferStatusFilterPills({ value = '', onChange, className = '' }) {
  const { catalog } = useTransferStatuses();

  const items = useMemo(
    () => (catalog || []).filter(s => s && s.key && s.enabled !== false),
    [catalog],
  );

  const pill = (k, l, badge, title) => {
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
      {pill('', 'All', null, 'Show every status')}
      {items.length > 0 && (
        <span
          aria-hidden
          className="h-5 w-px mx-1 flex-shrink-0"
          style={{ backgroundColor: 'var(--color-border)' }}
        />
      )}
      {items.map(s => pill(s.key, s.label, s.badge, s.label))}
    </div>
  );
}
