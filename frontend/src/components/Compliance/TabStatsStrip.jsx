import { useMemo } from 'react';
import { Layers, Clock, CheckCircle, XCircle, AlertCircle, Activity } from 'lucide-react';

/* TabStatsStrip — compact polished KPI row for the Compliance tabs.
 *
 * Counts come in two flavors:
 *   total    = backend's total (the full filtered dataset)
 *   loaded   = current-page records (so we can derive byStatus / byPriority
 *              without an extra round-trip).
 * Each card shows the loaded-page number prominently with a small
 * "of N total" caption so the user knows whether they are looking at a
 * single page or the whole dataset. When loaded === total there is no
 * caption and the number is authoritative.
 *
 * Props:
 *   kind: 'callback' | 'transfer' | 'sale'
 *   total: backend total
 *   records: current page array
 *   statusKey: 'status'    (default field on the row to count)
 *   labelOf?: optional (status) => label override
 *   badgeOf?: optional (status) => { bg, color } override
 */
const DEFAULT_PALETTE = {
  pending:           { bg: '#fef3c7', color: '#b45309', label: 'Pending' },
  assigned:          { bg: '#dbeafe', color: '#1d4ed8', label: 'Assigned' },
  completed:         { bg: '#d1fae5', color: '#047857', label: 'Completed' },
  cancelled:         { bg: '#fee2e2', color: '#b91c1c', label: 'Cancelled' },
  rejected:          { bg: '#fee2e2', color: '#b91c1c', label: 'Rejected' },
  missed:            { bg: '#fee2e2', color: '#b91c1c', label: 'Missed' },
  no_answer:         { bg: '#f3f4f6', color: '#6b7280', label: 'No Answer' },
  answering_machine: { bg: '#f3f4f6', color: '#6b7280', label: 'Voicemail' },
  open:              { bg: '#dbeafe', color: '#1d4ed8', label: 'Open' },
  sold:              { bg: '#d1fae5', color: '#047857', label: 'Sold' },
  closed_won:        { bg: '#d1fae5', color: '#047857', label: 'Approved' },
  closed_lost:       { bg: '#fee2e2', color: '#b91c1c', label: 'Lost' },
  pending_review:    { bg: '#fef3c7', color: '#b45309', label: 'In Review' },
  needs_revision:    { bg: '#fee2e2', color: '#b91c1c', label: 'Needs Revision' },
  compliance_cancelled: { bg: '#fee2e2', color: '#b91c1c', label: 'Comp. Cancelled' },
  dispute:           { bg: '#fef3c7', color: '#b45309', label: 'Dispute' },
  chargeback:        { bg: '#fee2e2', color: '#b91c1c', label: 'Chargeback' },
  follow_up:         { bg: '#fef3c7', color: '#b45309', label: 'Follow Up' },
  accepted:          { bg: '#d1fae5', color: '#047857', label: 'Accepted' },
};

const KEY_ICON = {
  pending: Clock, assigned: Activity, completed: CheckCircle, cancelled: XCircle,
  rejected: XCircle, missed: XCircle, no_answer: XCircle, answering_machine: Clock,
  open: Activity, sold: CheckCircle, closed_won: CheckCircle, closed_lost: XCircle,
  pending_review: Clock, needs_revision: AlertCircle, compliance_cancelled: XCircle,
  dispute: AlertCircle, chargeback: XCircle, follow_up: Clock, accepted: CheckCircle,
};

export default function TabStatsStrip({
  total = 0,
  records = [],
  statusKey = 'status',
  labelOf,
  badgeOf,
  extraTiles = [],   // [{ key, label, value, bg, color, icon }]
}) {
  const loaded = records.length;

  // Aggregate the visible page by status. We deliberately do NOT call the
  // backend a second time — the count strip is meant to summarize what the
  // user can see, not to do another expensive scan. The "of N total" caption
  // tells the truth when pagination hides more records.
  const byStatus = useMemo(() => {
    const acc = {};
    for (const r of records) {
      const k = r[statusKey];
      if (!k) continue;
      acc[k] = (acc[k] || 0) + 1;
    }
    return acc;
  }, [records, statusKey]);

  // Sort descending by count so the most common state lands first.
  const tiles = Object.entries(byStatus)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => {
      const pal = (badgeOf && badgeOf(k)) || DEFAULT_PALETTE[k] || { bg: '#f3f4f6', color: '#6b7280', label: null };
      const lbl = (labelOf && labelOf(k)) || pal.label || k.replace(/_/g, ' ');
      return { key: k, label: lbl, value: v, bg: pal.bg, color: pal.color, icon: KEY_ICON[k] || Layers };
    });

  // Append any extra caller-provided tiles (e.g. Overdue for callbacks).
  for (const t of extraTiles) {
    if (t && t.value !== undefined && t.value !== null) tiles.push({
      ...t, icon: t.icon || Layers,
    });
  }

  return (
    <div className="flex items-stretch gap-2 flex-wrap mb-3">
      {/* Total tile — always first, full-width on small screens */}
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl flex-shrink-0"
        style={{ background: 'linear-gradient(135deg, var(--color-primary-50, #eef2ff) 0%, var(--color-surface) 70%)',
                 border: '1px solid var(--color-primary-200, #c7d2fe)', minWidth: 180 }}>
        <div className="p-2 rounded-lg" style={{ backgroundColor: 'var(--color-primary-100, #e0e7ff)' }}>
          <Layers size={16} style={{ color: 'var(--color-primary-700, #4338ca)' }} />
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-primary-700, #4338ca)' }}>Matches</p>
          <p className="text-xl font-bold leading-none mt-0.5" style={{ color: 'var(--color-primary-700, #4338ca)', fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>
            {total.toLocaleString()}
          </p>
          {loaded > 0 && loaded < total && (
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>showing {loaded} on this page</p>
          )}
        </div>
      </div>

      {/* Per-status tiles for the current page */}
      {tiles.map(t => {
        const Icon = t.icon;
        return (
          <div key={t.key + ':' + t.label}
            className="flex items-center gap-2 px-3 py-2 rounded-xl flex-shrink-0"
            style={{ backgroundColor: t.bg, border: `1px solid ${t.color}30`, minWidth: 110 }}
            title={`${t.label}: ${t.value} on this page`}>
            <Icon size={13} style={{ color: t.color }} />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: t.color }}>{t.label}</p>
              <p className="text-sm font-bold leading-none mt-0.5" style={{ color: t.color, fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>
                {Number(t.value || 0).toLocaleString()}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
