import { useState, useEffect } from 'react';
import { AlertTriangle, ShieldAlert, History } from 'lucide-react';
import client from '../../api/client';

// FIX 2 (sale-lifecycle audit) — "returning customer" banner. Wires the
// previously-unused GET /sales/customer-history/by-phone/:phone into the
// closer flow (PhoneSearch results + SaleForm open) so prior sales are
// visible at the exact moment a duplicate could be created.
//
// Informational, never blocking — the Resell flow handles legitimate repeats.
// The endpoint is ROLE-SCOPED server-side (a closer sees only their own prior
// sales with this customer; compliance sees all) and this component shows
// exactly what it returns — scope is deliberately NOT widened here.
//
// Strong (red) variant when an ACTIVE policy (closed_won/sold) exists — the
// double-selling risk case. Everything else renders the amber warning tokens
// (same callout pattern as RecordingReviewTab's "No recording found").

const ACTIVE_STATUSES = new Set(['closed_won', 'sold']);
const STATUS_LABEL = {
  open: 'Open', sold: 'Sold', follow_up: 'Follow Up', pending_review: 'In Review',
  needs_revision: 'Needs Revision', closed_won: 'Approved', closed_lost: 'Lost',
  cancelled: 'Cancelled', compliance_cancelled: 'Compliance Cancelled',
  chargeback: 'Chargeback', dispute: 'Dispute', expired: 'Expired',
};
const fmtD = (d) => { try { return d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'; } catch { return d || '—'; } };

export default function CustomerHistoryBanner({ phone, className = '' }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    setData(null);
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.length < 7) return;
    let cancelled = false;
    client.get(`sales/customer-history/by-phone/${digits}`)
      .then(r => { if (!cancelled) setData(r.data); })
      .catch(() => { /* 403 / offline — banner just doesn't render */ });
    return () => { cancelled = true; };
  }, [phone]);

  const rows = data?.history || [];
  const activeRows = rows.filter(r => ACTIVE_STATUSES.has(r.status));
  // Item 4 — cross-closer blind spot: the endpoint also returns scope-safe
  // COUNTS across the full customer history. When more active policies exist
  // than this viewer can see, a "details restricted" line renders — even when
  // the scoped list is completely empty (the exact case that used to hide the
  // banner entirely).
  const hiddenActive = Math.max(0, (data?.unscoped_active_count || 0) - activeRows.length);
  if (!data || (!rows.length && hiddenActive === 0)) return null;

  const hasActive = activeRows.length > 0 || hiddenActive > 0;
  const s = data.summary || { total: 0, active: 0, cancelled: 0, chargebacks: 0 };

  const bits = [];
  if (s.active) bits.push(`${s.active} active`);
  if (s.cancelled) bits.push(`${s.cancelled} cancelled`);
  if (s.chargebacks) bits.push(`${s.chargebacks} chargeback${s.chargebacks === 1 ? '' : 's'}`);

  return (
    <div className={`p-3 rounded-xl flex items-start gap-2.5 ${className}`}
      style={hasActive
        ? { background: 'var(--color-error-50, rgba(220,38,38,0.08))', border: '1px solid var(--color-error-300, rgba(220,38,38,0.35))' }
        : { background: 'var(--color-warning-50, rgba(217,119,6,0.08))', border: '1px solid var(--color-warning-200, rgba(217,119,6,0.25))' }}>
      {hasActive
        ? <ShieldAlert size={16} style={{ color: 'var(--color-error-600, #dc2626)' }} className="mt-0.5 flex-shrink-0" />
        : <History size={16} style={{ color: 'var(--color-warning-600, #d97706)' }} className="mt-0.5 flex-shrink-0" />}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold" style={{ color: hasActive ? 'var(--color-error-700, #b91c1c)' : 'var(--color-warning-700, #b45309)' }}>
          {hasActive
            ? `Active policy exists — this customer already holds ${(activeRows.length + hiddenActive) === 1 ? 'an approved policy' : `${activeRows.length + hiddenActive} approved policies`}`
            : `Returning customer — ${s.total} prior sale${s.total === 1 ? '' : 's'} on this number`}
        </p>
        {rows.length > 0 && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            {s.total} prior sale{s.total === 1 ? '' : 's'}{bits.length ? ` — ${bits.join(', ')}` : ''}.
            {hasActive
              ? ' Selling this customer again on the same coverage risks a duplicate — use the Resell flow on the existing sale for renewals, additional cars, or replacements.'
              : ' Review the history before creating a new sale; the Resell flow handles legitimate repeats.'}
          </p>
        )}
        {hiddenActive > 0 && (
          <p className="text-xs mt-1 font-bold" style={{ color: 'var(--color-error-700, #b91c1c)' }}>
            An active policy exists with this customer through another agent — details restricted. Use the Resell flow or ask a manager.
          </p>
        )}
        <div className="mt-1.5 flex flex-col gap-0.5">
          {rows.slice(0, 3).map(r => (
            <div key={r.id} className="flex items-center gap-2 text-[11px] flex-wrap" style={{ color: 'var(--color-text-secondary)' }}>
              <span className="font-bold px-1.5 py-0.5 rounded text-[10px] uppercase"
                style={ACTIVE_STATUSES.has(r.status)
                  ? { background: 'var(--color-error-100, #fee2e2)', color: 'var(--color-error-700, #b91c1c)' }
                  : { background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
                {STATUS_LABEL[r.status] || r.status}
              </span>
              <span>{fmtD(r.sale_date)}</span>
              {r.plan && <span>· {r.plan}</span>}
              {r.client_name && <span>· {r.client_name}</span>}
              {r.reference_no && <span className="font-mono" style={{ color: 'var(--color-text-tertiary)' }}>#{r.reference_no}</span>}
              {r.is_resell && <span style={{ color: '#6d28d9' }}>· resell</span>}
            </div>
          ))}
          {rows.length > 3 && <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>+ {rows.length - 3} more…</span>}
        </div>
      </div>
    </div>
  );
}
