// ============================================================================
// StatusStrip — the clickable status dashboard above a record table.
//
// Replaces the count-less status pills on the Team Transfers and Team Sales
// tabs. Same job, three differences that matter:
//
//   • it carries the COUNT, so you can see where the work is before clicking;
//   • the vocabulary comes from the SERVER's catalog (the response's
//     status_catalog), not a hardcoded array, so a status added in Business
//     Rules appears here with no deploy — and the labels shown are the ones the
//     counts were actually computed against;
//   • the counts are exact HEAD counts over the list's own filters, so a box
//     saying 26 means the table shows 26 rows when you click it.
//
// Built on KpiTile's `active` state, which exists for exactly this — a tile
// that is also a filter. It reads as selected through a tone tint + tone border
// + tone value rather than a flood fill, so a strip of six doesn't turn into a
// solid block when one is chosen.
//
// Clicking the active box clears back to All. Without that, the only way out of
// a status filter is to hunt for whatever cleared it last time.
// ============================================================================
import { Layers } from 'lucide-react';
import { KpiTile } from '../UI/kit';
import { toneOfBadge } from '../../utils/statusTone';
import { sharePct } from '../../utils/recordFormat';

const num = (v) => Number(v || 0).toLocaleString();

/**
 * @param catalog  [{ key, label, badge }] from the list response
 * @param counts   { [statusKey]: count } from the list response, or null
 * @param total    the unfiltered total for this query (drives the All box)
 * @param value    currently selected status key, '' for All
 * @param onChange (statusKey) => void — '' means All
 * @param allLabel label for the leading box
 */
export default function StatusStrip({
  catalog = [],
  counts = null,
  total = 0,
  value = '',
  onChange,
  allLabel = 'All records',
  className = '',
}) {
  // No catalog means the server had nothing to say (empty scope, or a
  // deployment older than this field). Render nothing rather than a bare row
  // of chrome.
  if (!catalog.length) return null;

  const pick = (key) => onChange?.(key === value ? '' : key);

  return (
    <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 mb-4 ${className}`}>
      <KpiTile
        icon={Layers}
        tone="primary"
        label={allLabel}
        value={num(total)}
        active={!value}
        onClick={() => onChange?.('')}
      />
      {catalog.map((s) => {
        // A count of 0 is SHOWN, not hidden: the server sends every catalog key
        // so the box set stays put as the date range moves. Boxes that appear
        // and vanish shift their neighbours under a cursor mid-click.
        const n = counts ? (counts[s.key] ?? 0) : null;
        return (
          <KpiTile
            key={s.key}
            tone={toneOfBadge(s.badge)}
            label={s.label}
            // An em-dash, not 0, when counts are absent — they ride page 1
            // only, and a 0 there would be a lie rather than a gap.
            value={n === null ? '—' : num(n)}
            sub={n !== null && sharePct(n, total) ? `${sharePct(n, total)} of total` : undefined}
            active={value === s.key}
            onClick={() => pick(s.key)}
          />
        );
      })}
    </div>
  );
}
