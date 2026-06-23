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
  extraTiles = [],   // [{ key, label, value, bg, color, icon, onClick, active }]
  activeStatus,      // currently-selected status ('' / undefined = none)
  onSelectStatus,    // (statusKey | '') => void — when set, status tiles filter
  statusTotals,      // { status: count } true totals for the whole filtered set
}) {
  const loaded = records.length;
  const clickable = typeof onSelectStatus === 'function';
  // True totals (from the backend) beat page-derived counts so the breakdown is
  // consistent across pages; fall back to the current page when not provided.
  const hasTotals = statusTotals && Object.keys(statusTotals).length > 0;

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
  const tiles = Object.entries(hasTotals ? statusTotals : byStatus)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => {
      const pal = (badgeOf && badgeOf(k)) || DEFAULT_PALETTE[k] || { bg: '#f3f4f6', color: '#6b7280', label: null };
      const lbl = (labelOf && labelOf(k)) || pal.label || k.replace(/_/g, ' ');
      return { key: k, label: lbl, value: v, bg: pal.bg, color: pal.color, icon: KEY_ICON[k] || Layers };
    });

  // Append any extra caller-provided tiles (e.g. Overdue for callbacks).
  for (const t of extraTiles) {
    if (t && t.value !== undefined && t.value !== null) tiles.push({
      ...t, icon: t.icon || Layers, extra: true,
    });
  }

  // Uniform tile dimensions — every tile gets the same width + height so the
  // strip reads as a tight grid instead of a ragged row.
  const TILE_W  = 124;
  const TILE_H  = 48;
  const tileBase = {
    minWidth:  TILE_W,
    maxWidth:  TILE_W,
    minHeight: TILE_H,
    height:    TILE_H,
  };

  return (
    <div className="grid gap-2 mb-3"
      style={{
        gridTemplateColumns: `repeat(auto-fill, minmax(${TILE_W}px, 1fr))`,
      }}>
      {/* Total tile — primary accent, always first. Clickable → clear status. */}
      {(() => {
        const TotalTag = clickable ? 'button' : 'div';
        const totalActive = clickable && !activeStatus;
        return (
      <TotalTag
        type={clickable ? 'button' : undefined}
        onClick={clickable ? () => onSelectStatus('') : undefined}
        className={`flex items-center gap-2 px-2.5 rounded-lg w-full text-left ${clickable ? 'cursor-pointer transition-transform hover:scale-[1.03]' : ''}`}
        style={{
          ...tileBase,
          background: 'linear-gradient(135deg, var(--color-primary-50, #eef2ff) 0%, var(--color-surface) 70%)',
          border: '1px solid var(--color-primary-200, #c7d2fe)',
          boxShadow: totalActive ? '0 0 0 2px var(--color-primary-500, #6366f1)' : undefined,
        }}
        title={clickable ? 'Show all (clear status filter)' : (loaded < total ? `${total.toLocaleString()} total · ${loaded} on this page` : `${total.toLocaleString()} total`)}>
        <div className="rounded-md flex-shrink-0 flex items-center justify-center"
          style={{ width: 26, height: 26, backgroundColor: 'var(--color-primary-100, #e0e7ff)' }}>
          <Layers size={13} style={{ color: 'var(--color-primary-700, #4338ca)' }} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-bold uppercase tracking-wider truncate"
            style={{ color: 'var(--color-primary-700, #4338ca)' }}>Matches</p>
          <p className="text-base font-bold leading-none mt-0.5 truncate"
            style={{ color: 'var(--color-primary-700, #4338ca)', fontFamily: 'var(--font-display)', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
            {total.toLocaleString()}
          </p>
        </div>
      </TotalTag>
        );
      })()}

      {/* Per-status tiles */}
      {tiles.map(t => {
        const Icon = t.icon;
        // A status tile filters the list; an extra tile filters only if it
        // provides its own onClick. Otherwise it's a plain display tile.
        const isExtra   = t.extra === true;
        const canClick  = isExtra ? typeof t.onClick === 'function' : clickable;
        const isActive  = isExtra ? !!t.active : (clickable && activeStatus === t.key);
        const onClick   = isExtra ? t.onClick : (clickable ? () => onSelectStatus(activeStatus === t.key ? '' : t.key) : undefined);
        const Tag = canClick ? 'button' : 'div';
        return (
          <Tag key={t.key + ':' + t.label}
            type={canClick ? 'button' : undefined}
            onClick={onClick}
            className={`flex items-center gap-2 px-2.5 rounded-lg w-full text-left ${canClick ? 'cursor-pointer transition-transform hover:scale-[1.03]' : ''}`}
            style={{
              ...tileBase,
              backgroundColor: t.bg,
              border: `1px solid ${t.color}30`,
              boxShadow: isActive ? `0 0 0 2px ${t.color}` : undefined,
            }}
            title={canClick ? `Filter by ${t.label}` : `${t.label}: ${t.value} on this page`}>
            <div className="rounded-md flex-shrink-0 flex items-center justify-center"
              style={{ width: 26, height: 26, backgroundColor: `${t.color}1a` }}>
              <Icon size={13} style={{ color: t.color }} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[9px] font-bold uppercase tracking-wider truncate" style={{ color: t.color }}>{t.label}</p>
              <p className="text-base font-bold leading-none mt-0.5 truncate"
                style={{ color: t.color, fontFamily: 'var(--font-display)', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
                {Number(t.value || 0).toLocaleString()}
              </p>
            </div>
          </Tag>
        );
      })}
    </div>
  );
}
