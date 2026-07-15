import { useEffect, useState } from 'react';
import client from '../api/client';

/*
 * useSaleHighlight
 *
 * Reads the superadmin-configured sale-record highlight from business_config
 * (`compliance.sale_highlight`). Compliance highlights sale rows by how many
 * LIVE sales share the same customer number (sales.dupe_active_count from the
 * /compliance/sales endpoint, mig 193): the more repeat sales, the deeper the
 * yellow. Because the count is LIVE (closed_won / pending_review only),
 * cancelling a sale drops the count and the tint lightens on the next load.
 *
 * Config shape (all optional — falls back to DEFAULT):
 *   { enabled, tiers: [{ min, color, label }], cancelled_color }
 *   - tiers: pick the highest tier whose `min` <= the row's live-duplicate count
 *   - cancelled_color: optional tint for a non-live (cancelled/…) duplicate row
 *
 * Superadmin edits it in Business Rules → Sale Highlight.
 */
export const DEFAULT_SALE_HIGHLIGHT = {
  enabled: true,
  tiers: [
    { min: 2, color: '#fef9c3', label: '2 on this number' },
    { min: 3, color: '#fde68a', label: '3 on this number' },
    { min: 4, color: '#fcd34d', label: '4 on this number' },
    { min: 5, color: '#f59e0b', label: '5+ on this number' },
  ],
  cancelled_color: '',
};

const LIVE = new Set(['closed_won', 'pending_review']);
let _cache = null, _at = 0;
const TTL_MS = 30_000;

const clean = (raw) => {
  if (!raw || typeof raw !== 'object') return DEFAULT_SALE_HIGHLIGHT;
  const tiers = Array.isArray(raw.tiers) && raw.tiers.length
    ? raw.tiers.filter(t => t && Number.isFinite(+t.min) && typeof t.color === 'string')
        .map(t => ({ min: +t.min, color: t.color, label: t.label || `${t.min}+ on this number` }))
        .sort((a, b) => a.min - b.min)
    : DEFAULT_SALE_HIGHLIGHT.tiers;
  return {
    enabled: raw.enabled !== false,
    tiers,
    cancelled_color: typeof raw.cancelled_color === 'string' ? raw.cancelled_color : '',
  };
};

export function useSaleHighlight() {
  const [cfg, setCfg] = useState(_cache || DEFAULT_SALE_HIGHLIGHT);

  useEffect(() => {
    if (_cache && Date.now() - _at < TTL_MS) { setCfg(_cache); return; }
    let cancelled = false;
    client.get('business-config')
      .then(r => {
        if (cancelled) return;
        const resolved = clean(r.data?.config?.['compliance.sale_highlight']);
        _cache = resolved; _at = Date.now(); setCfg(resolved);
      })
      .catch(() => { /* silent → default */ });
    return () => { cancelled = true; };
  }, []);

  // The row background for a sale, or null for no highlight.
  const colorFor = (sale) => {
    if (!cfg.enabled || !sale) return null;
    const live = LIVE.has(sale.status);
    const count = live ? (sale.dupe_active_count || 0) : (sale.dupe_active_count || 0);
    // Non-live (cancelled/…) duplicate rows: optional distinct tint, else none —
    // so cancelling a sale visibly drops it out of the yellow set.
    if (!live) {
      return (cfg.cancelled_color && (sale.dupe_sale_count || 0) >= 2) ? cfg.cancelled_color : null;
    }
    let hit = null;
    for (const t of cfg.tiers) if (count >= t.min) hit = t;   // tiers sorted asc → highest match wins
    return hit ? hit.color : null;
  };

  return { cfg, colorFor };
}

export function clearSaleHighlightCache() { _cache = null; _at = 0; }
