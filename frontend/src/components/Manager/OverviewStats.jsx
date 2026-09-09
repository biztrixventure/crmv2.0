// ============================================================================
// OverviewStats — the Manager Overview's two stat sections: Transfers, Sales.
//
// Each section is a self-contained panel with ITS OWN date filter, defaulting
// to the current month. That independence is the point: a manager checking
// "how did last month's transfers convert against this month's sales" needs two
// windows at once, which one shared picker cannot express.
//
// WHAT THIS REPLACED, AND WHY
// The Overview used to show eight StatCardTriple cards, each holding Today /
// MTD / Total segments from /stats/dashboard. Three problems:
//   • three fixed windows, no way to ask for a range;
//   • /stats/dashboard never counted rejected or cancelled transfers, so the
//     transfer lifecycle could not be shown at all, at any configuration;
//   • the totals came from a limit:1000 list fetch counted in JavaScript, so
//     every figure silently capped at 1000 on a company holding 17,459.
// One range-driven COUNT endpoint (GET /stats/overview) answers all of it.
//
// THE BOXES ARE NOT HARDCODED. The status list comes from the server, which
// reads the same config catalogs the filter pills and status badges read
// (transfer.status_catalog / compliance.status_catalog). Add a status in
// Business Rules → Compliance Workflow and a box appears here with no deploy;
// disable one and it goes. Each entry arrives with its own label and badge, so
// what is drawn can never disagree with what was counted.
//
// The breakdown always sums to the total — the server adds an "Other" bucket
// for any status outside the catalog rather than letting the parts quietly
// disagree with the whole. Ratios, resells and duplicate attempts sit apart
// from the status grid for the same reason: they are not slices of the total.
//
// Theming: CSS vars and kit accent() only. No hex literals, and no Tailwind
// class ever built from a template string — `text-${tone}-600` is not generated
// by the compiler and renders unstyled (it has shipped twice in this repo).
// ============================================================================
import { useState, useEffect, useCallback } from 'react';
import { Send, DollarSign, Copy, RefreshCw, Percent, AlertCircle } from 'lucide-react';
import client from '../../api/client';
import { Panel, SectionHeader, KpiTile, Loading, accent } from '../UI/kit';
import DateRangePicker, { getPresetRange } from '../UI/DateRangePicker';
import { useAbortable, isCanceled } from '../../hooks/useTableQuery';
// Shared with StatusStrip and TopAgents: the catalog says warning/error where
// the kit says warn/danger, and one copy of that map is what keeps 'cancelled'
// the same colour on every surface that reads these catalogs.
import { toneOfBadge as toneOf } from '../../utils/statusTone';

const fmt = (n) => (typeof n === 'number' ? n.toLocaleString() : '—');

// "Sep 1 – Sep 9" / "All time". Matches DateRangePicker's own button label
// style so the header text and the control never read as different ranges.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (iso) => {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return `${MONTHS[parseInt(m, 10) - 1]} ${parseInt(d, 10)}`;
};
const rangeLabel = ({ date_from, date_to }) => {
  if (!date_from && !date_to) return 'All time';
  if (date_from && date_to) {
    return date_from === date_to ? dayLabel(date_from) : `${dayLabel(date_from)} – ${dayLabel(date_to)}`;
  }
  return dayLabel(date_from || date_to);
};

/**
 * One entity's section. Owns its own date range so the two sections stay
 * independent; `refreshToken` lets the shell's Refresh button reload both
 * without lifting that range into the shell.
 *
 * @param entity        'transfers' | 'sales'
 * @param onDrill       ({ status, range }) => void — open the matching list
 * @param onDuplicates  () => void — transfers only, opens the duplicates modal
 */
function StatSection({ entity, title, icon, tone, refreshToken, onDrill, onDuplicates }) {
  const [range, setRange]  = useState(() => getPresetRange('month'));
  const [data, setData]    = useState(null);
  const [loading, setLoad] = useState(true);
  const [error, setError]  = useState(null);
  const abortable = useAbortable();

  const load = useCallback(async () => {
    setLoad(true);
    setError(null);
    try {
      const r = await client.get('stats/overview', {
        params: { entity, date_from: range.date_from || undefined, date_to: range.date_to || undefined },
        signal: abortable(),
      });
      setData(r.data);
      setLoad(false);
    } catch (e) {
      // A cancelled request means the picker moved again before this one
      // landed — superseded, not failed. Showing an error there would flash a
      // red row on every second click.
      if (isCanceled(e)) return;
      setError(e.response?.data?.error || 'Could not load these statistics');
      setLoad(false);
    }
  }, [entity, range.date_from, range.date_to, abortable]);

  useEffect(() => { load(); }, [load, refreshToken]);

  const isTransfers = entity === 'transfers';
  const statuses    = data?.by_status || [];
  const ratio       = isTransfers ? data?.completion_rate : data?.approval_rate;
  const total       = data?.total ?? 0;

  // Says which date column the range was cut on. Transfers key on when the
  // transfer arrived; sales key on the business day of the sale, not the row's
  // insert time — otherwise a bulk upload of an old workbook would land
  // entirely in the range it was uploaded in.
  const subtitle = error ? null : [
    rangeLabel(range),
    data ? `by ${isTransfers ? 'transfer date' : 'sale date'}` : null,
    data && total === 0 ? 'no records in this range' : null,
  ].filter(Boolean).join(' · ');

  return (
    <Panel pad="lg">
      <SectionHeader
        level="section"
        icon={icon}
        tone={tone}
        title={title}
        subtitle={subtitle}
        actions={<DateRangePicker defaultPreset="month" value={range} onChange={setRange} />}
      />

      {error ? (
        <div className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 flex-wrap"
          style={{ background: accent('danger').soft, border: `1px solid ${accent('danger').fg}` }}>
          <span className="text-xs font-semibold flex items-center gap-2" style={{ color: accent('danger').fg }}>
            <AlertCircle size={14} /> {error}
          </span>
          <button type="button" onClick={load}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      ) : loading && !data ? (
        <Loading variant="cards" cards={4} label={`Loading ${title.toLowerCase()} statistics…`} />
      ) : (
        // Two columns on a phone so the strip stays a few rows tall rather than
        // one tile per line; the total spans both so it reads as the headline.
        // Dimming instead of unmounting on a re-fetch keeps the numbers on
        // screen while a new range loads — the layout never collapses.
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3"
          style={{ opacity: loading ? 0.55 : 1, transition: 'opacity 120ms' }}>

          <KpiTile
            className="col-span-2"
            icon={icon}
            tone="primary"
            label={`Total ${title.toLowerCase()}`}
            value={fmt(total)}
            sub={rangeLabel(range)}
            onClick={onDrill ? () => onDrill({ status: '', range }) : undefined}
          />

          {statuses.map((s) => (
            <KpiTile
              key={s.key}
              tone={toneOf(s.badge)}
              label={s.label}
              value={fmt(s.count)}
              // Percent-of-total turns raw counts into a shape you can read at
              // a glance. Omitted at 0 total, where every share is 0/0.
              sub={total > 0 ? `${Math.round((s.count / total) * 100)}% of total` : undefined}
              // "Other" is a reconciliation bucket, not a filterable status —
              // no list view answers a click on it.
              onClick={(onDrill && s.key !== '__other') ? () => onDrill({ status: s.key, range }) : undefined}
            />
          ))}

          {/* Ratios, resells and duplicates sit AFTER the status grid and are
              deliberately not part of it: they are not slices of the total, and
              inlining them would break the "parts sum to the whole" reading. */}
          <KpiTile
            icon={Percent}
            tone="muted"
            label={isTransfers ? 'Completion rate' : 'Approval rate'}
            value={typeof ratio === 'number' ? `${ratio}%` : '—'}
            sub={isTransfers ? 'completed / total' : 'approved / total'}
          />

          {!isTransfers && typeof data?.resells === 'number' && (
            <KpiTile
              icon={RefreshCw}
              tone="info"
              label="Resells"
              value={fmt(data.resells)}
              sub="included in total"
            />
          )}

          {isTransfers && typeof data?.duplicates === 'number' && (
            <KpiTile
              icon={Copy}
              tone="warn"
              label="Duplicate attempts"
              value={fmt(data.duplicates)}
              // These never became transfer rows, so they are NOT in the total
              // above — say so on the tile rather than letting someone add it in.
              sub="not in total"
              onClick={onDuplicates}
            />
          )}
        </div>
      )}
    </Panel>
  );
}

/**
 * Both sections, clearly separated. `onDrillTransfers` / `onDrillSales` receive
 * ({ status, range }) so the shell can open the matching list tab with the same
 * status filter AND the same date range — the box's number and the list's count
 * have to agree or neither gets believed.
 *
 * `salesFirst` flips the reading order for a closer company's admin, whose room
 * is judged on sales rather than on lead volume. Both sections always render —
 * a closer company still receives transfers, and a fronter company's leads
 * still become sales — so this changes emphasis, never access.
 */
export default function OverviewStats({
  refreshToken,
  salesFirst = false,
  onDrillTransfers,
  onDrillSales,
  onDuplicates,
}) {
  const transfers = (
    <StatSection
      key="transfers"
      entity="transfers"
      title="Transfers"
      icon={Send}
      tone="info"
      refreshToken={refreshToken}
      onDrill={onDrillTransfers}
      onDuplicates={onDuplicates}
    />
  );
  const sales = (
    <StatSection
      key="sales"
      entity="sales"
      title="Sales"
      icon={DollarSign}
      tone="success"
      refreshToken={refreshToken}
      onDrill={onDrillSales}
    />
  );

  // Keyed elements reordered in an array, NOT two conditional branches: React
  // matches on key, so flipping the order moves the mounted sections instead of
  // unmounting both and throwing away each one's chosen date range.
  return (
    <div className="space-y-5">
      {salesFirst ? [sales, transfers] : [transfers, sales]}
    </div>
  );
}
