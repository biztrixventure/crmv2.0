import { useEffect, useState } from 'react';
import client from '../api/client';

/*
 * useCancellationReasons
 *
 * Reads the admin-configured cancellation_reasons catalog from
 * business_config (seeded by mig 076). Same shape + cache contract as
 * useComplianceStatuses so the compliance dashboard, bulk-status page,
 * and sale-detail drawer all render identical option lists.
 *
 * Catalog entry: { key, label, category, enabled }
 *   - category groups the dropdown ("customer", "compliance",
 *     "chargeback", "system") so the UI can section the menu
 *   - enabled === false hides the entry from new picks but keeps the
 *     label resolvable on historical rows
 *
 * Returns:
 *   reasons     — full list (catalog-driven, falls back to FALLBACK)
 *   activeReasons — only enabled entries (for picker dropdowns)
 *   labelOf(key) — display label, falls back to humanized key
 *   isLegacy(key) — key exists in fallback only
 */

const FALLBACK = [
  { key: 'customer_request',    label: 'Customer requested cancel',       category: 'customer',   enabled: true },
  { key: 'buyers_remorse',      label: "Buyer's remorse (cooling-off)",   category: 'customer',   enabled: true },
  { key: 'affordability',       label: 'Affordability / payment issue',   category: 'customer',   enabled: true },
  { key: 'misrepresentation',   label: 'Plan misrepresented at close',    category: 'compliance', enabled: true },
  { key: 'failed_verification', label: 'Failed verification call',        category: 'compliance', enabled: true },
  { key: 'failed_underwriting', label: 'Client/underwriting rejected',    category: 'compliance', enabled: true },
  { key: 'chargeback_fraud',    label: 'Chargeback — fraud',              category: 'chargeback', enabled: true },
  { key: 'chargeback_dispute',  label: 'Chargeback — dispute',            category: 'chargeback', enabled: true },
  { key: 'duplicate_sale',      label: 'Duplicate sale on same VIN',      category: 'system',     enabled: true },
  { key: 'closer_error',        label: 'Closer error / mis-keyed',        category: 'system',     enabled: true },
  { key: 'vehicle_ineligible',  label: 'Vehicle ineligible (year/miles)', category: 'system',     enabled: true },
  { key: 'other',               label: 'Other (see compliance note)',     category: 'system',     enabled: true },
];

let _cache = null;
let _at = 0;
const TTL_MS = 30_000;

function mergeCatalog(raw) {
  const fromConfig = Array.isArray(raw) ? raw : [];
  const map = new Map();
  FALLBACK.forEach(s => map.set(s.key, { ...s }));
  fromConfig.forEach(s => {
    if (!s || !s.key) return;
    map.set(s.key, { ...(map.get(s.key) || {}), ...s });
  });
  return [...map.values()];
}

export function useCancellationReasons() {
  const [reasons, setReasons] = useState(_cache?.reasons || FALLBACK);

  useEffect(() => {
    if (_cache && Date.now() - _at < TTL_MS) {
      setReasons(_cache.reasons);
      return;
    }
    let cancelled = false;
    client.get('business-config')
      .then(r => {
        if (cancelled) return;
        const raw = r.data?.config?.['cancellation_reasons'];
        const resolved = Array.isArray(raw) && raw.length ? mergeCatalog(raw) : FALLBACK;
        _cache = { reasons: resolved };
        _at = Date.now();
        setReasons(resolved);
      })
      .catch(() => { /* silent fallback */ });
    return () => { cancelled = true; };
  }, []);

  const activeReasons = reasons.filter(r => r.enabled !== false);
  const labelOf = (key) => {
    if (!key) return '—';
    const hit = reasons.find(r => r.key === key);
    return hit?.label || key.replace(/_/g, ' ');
  };
  const isLegacy = (key) => key && !reasons.some(r => r.key === key);

  return { reasons, activeReasons, labelOf, isLegacy };
}

export function clearCancellationReasonsCache() { _cache = null; _at = 0; }
