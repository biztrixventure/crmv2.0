import { useEffect, useState } from 'react';
import client from '../api/client';

/*
 * useSaleHighlight
 *
 * Reads the superadmin-configured sale-record highlight from business_config
 * (`compliance.sale_highlight`). Compliance highlights EVERY sale row — active
 * or cancelled — by how many sales share the same customer number, counting ALL
 * real records (active + cancelled), from sales.dupe_sale_count on the
 * /compliance/sales endpoint (mig 193). The more sales on the number, the deeper
 * the yellow, and both the live and cancelled rows for that number are tinted.
 *
 * Config shape (all optional — falls back to DEFAULT):
 *   { enabled, tiers: [{ min, color, label }] }
 *   - tiers: pick the highest tier whose `min` <= the row's total sale count
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

  // The row background for a sale, or null for no highlight. Counts ALL sales on
  // the customer's number — active AND cancelled — so every such row is tinted.
  const colorFor = (sale) => {
    if (!cfg.enabled || !sale) return null;
    const count = sale.dupe_sale_count || 0;
    let hit = null;
    for (const t of cfg.tiers) if (count >= t.min) hit = t;   // tiers sorted asc → highest match wins
    return hit ? hit.color : null;
  };

  return { cfg, colorFor };
}

export function clearSaleHighlightCache() { _cache = null; _at = 0; }
