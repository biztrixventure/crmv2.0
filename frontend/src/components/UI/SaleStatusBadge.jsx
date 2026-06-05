import { Badge } from './index';
import { useComplianceStatuses } from '../../hooks/useComplianceStatuses';
import { fmtSaleDate } from '../../utils/timezone';

/*
 * SaleStatusBadge
 *
 * Shared display component for sales status. Renders the existing Badge
 * with the compliance-catalog label + color, then appends a small red
 * chip showing cancellation_date when the status is cancellation-like.
 * For every non-cancellation status the chip is hidden — the caller does
 * NOT need to gate the render.
 *
 * Goal: one place to change the status-display contract so the
 * compliance dashboard, manager shell, staff shell, admin panels, and
 * detail drawers all render identically.
 *
 * Props:
 *   sale            — required, must have { status, cancellation_date? }
 *   size            — 'sm' | 'md' (forwarded to Badge), defaults to 'sm'
 *   showDateAlways  — boolean. When true, render the chip for any sale
 *                     that has a cancellation_date even if the current
 *                     status isn't cancel-like (useful in audit views).
 */

// Cancellation-like statuses that gate the date chip. Same set the
// backend uses to require cancellation_date — keeping the rule in sync
// here means the UI never shows the chip on rows the backend wouldn't
// stamp.
const CANCEL_LIKE = new Set([
  'cancelled', 'compliance_cancelled', 'closed_lost', 'chargeback', 'dispute',
]);

export default function SaleStatusBadge({ sale, size = 'sm', showDateAlways = false }) {
  const { labelOf, badgeOf } = useComplianceStatuses();
  if (!sale) return null;
  const status = sale.status || '';
  const cancelDate = sale.cancellation_date || null;
  const showChip = !!cancelDate && (showDateAlways || CANCEL_LIKE.has(status));

  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <Badge variant={badgeOf(status)} size={size}>{labelOf(status)}</Badge>
      {showChip && (
        <span
          title={`Cancelled on ${cancelDate}`}
          className="inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap"
          style={{
            backgroundColor: 'var(--color-error-50, #fef2f2)',
            color:           'var(--color-error-700, #b91c1c)',
            border:          '1px solid var(--color-error-200, #fecaca)',
          }}
        >
          {fmtSaleDate(cancelDate)}
        </span>
      )}
    </span>
  );
}
