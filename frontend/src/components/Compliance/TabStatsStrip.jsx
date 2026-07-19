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

  // Uniform tiles. Number + label always render in theme text colors so they
  // stay legible on both the cream (light) and obsidian (dark) surface — the
  // status color lives only in the icon chip + left accent + active ring, which
  // is what keeps the strip readable in dark mode (the old flat pastel fills
  // washed out to bright blobs).
  const TILE_W  = 140;
  const TILE_H  = 62;
  const tileBase = {
    minHeight: TILE_H, height: TILE_H,
    backgroundColor: 'var(--color-surface)',
  };

  const Tile = ({ color, Icon, label, value, active, onClick, tag, title, accentLabel }) => {
    const Tag = tag;
    return (
      <Tag
        type={onClick ? 'button' : undefined}
        onClick={onClick}
        title={title}
        className={`relative flex items-center gap-2.5 pl-3.5 pr-3 rounded-xl w-full text-left overflow-hidden transition-all ${onClick ? 'cursor-pointer hover:-translate-y-0.5' : ''}`}
        style={{
          ...tileBase,
          border: `1px solid ${active ? color : 'var(--color-border)'}`,
          boxShadow: active ? `0 0 0 2px color-mix(in srgb, ${color} 45%, transparent)` : '0 1px 2px rgba(0,0,0,0.03)',
        }}>
        {/* left accent bar */}
        <span className="absolute left-0 top-0 bottom-0" style={{ width: 3, backgroundColor: color }} />
        <div className="rounded-lg flex-shrink-0 flex items-center justify-center"
          style={{ width: 30, height: 30, backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)` }}>
          <Icon size={15} style={{ color }} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-wider truncate"
            style={{ color: accentLabel ? color : 'var(--color-text-secondary)' }}>{label}</p>
          <p className="text-xl font-extrabold leading-none mt-1 truncate"
            style={{ color: 'var(--color-text)', fontFamily: 'var(--font-display)', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
            {Number(value || 0).toLocaleString()}
          </p>
        </div>
      </Tag>
    );
  };

  return (
    <div className="grid gap-2.5 mb-4"
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${TILE_W}px, 1fr))` }}>
      {/* Total tile — primary accent, always first. Clickable → clear status. */}
      <Tile
        tag={clickable ? 'button' : 'div'}
        color="var(--color-primary)"
        Icon={Layers}
        label="Matches"
        value={total}
        accentLabel
        active={clickable && !activeStatus}
        onClick={clickable ? () => onSelectStatus('') : undefined}
        title={clickable ? 'Show all (clear status filter)' : (loaded < total ? `${total.toLocaleString()} total · ${loaded} on this page` : `${total.toLocaleString()} total`)}
      />

      {/* Per-status tiles */}
      {tiles.map(t => {
        const isExtra   = t.extra === true;
        const canClick  = isExtra ? typeof t.onClick === 'function' : clickable;
        const isActive  = isExtra ? !!t.active : (clickable && activeStatus === t.key);
        const onClick   = isExtra ? t.onClick : (clickable ? () => onSelectStatus(activeStatus === t.key ? '' : t.key) : undefined);
        return (
          <Tile key={t.key + ':' + t.label}
            tag={canClick ? 'button' : 'div'}
            color={t.color}
            Icon={t.icon}
            label={t.label}
            value={t.value}
            active={isActive}
            onClick={onClick}
            title={canClick ? `Filter by ${t.label}` : `${t.label}: ${t.value} on this page`}
          />
        );
      })}
    </div>
  );
}
