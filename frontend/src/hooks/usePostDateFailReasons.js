import { useEffect, useState } from 'react';
import client from '../api/client';

/*
 * usePostDateFailReasons
 *
 * Why the card did not go through on a post-date's charge day.
 *
 * Reads the admin-configured post_date_fail_reasons catalog from
 * business_config (seeded by mig 221). Deliberately the same shape and cache
 * contract as useCancellationReasons — every other vocabulary in this app
 * (form_fields, dispositions, cancellation_reasons, compliance statuses) is
 * admin-editable, and a hardcoded list here would be the odd one out the first
 * time a company wanted "ACH returned" on the menu.
 *
 * Catalog entry: { key, label, category, enabled }
 *   - category groups the dropdown ("payment", "customer", "other")
 *   - enabled === false hides the entry from new picks but keeps the label
 *     resolvable on historical attempts. reason_key is stored as free text
 *     exactly so retiring an entry never orphans an old record.
 *
 * Returns:
 *   reasons       — full list (catalog-driven, falls back to FALLBACK)
 *   activeReasons — only enabled entries (for the picker)
 *   labelOf(key)  — display label, falls back to the humanized key
 */

// Mirrors the seed in mig 221. Present so the picker still works if the
// migration has not been applied yet, or the config fetch fails.
const FALLBACK = [
  { key: 'insufficient_funds',  label: 'Insufficient funds',             category: 'payment',  enabled: true },
  { key: 'declined_card',       label: 'Card declined',                  category: 'payment',  enabled: true },
  { key: 'expired_card',        label: 'Card expired / details changed', category: 'payment',  enabled: true },
  { key: 'wrong_card_details',  label: 'Wrong card details on file',     category: 'payment',  enabled: true },
  { key: 'no_answer',           label: 'Customer did not answer',        category: 'customer', enabled: true },
  { key: 'asked_to_reschedule', label: 'Customer asked to reschedule',   category: 'customer', enabled: true },
  { key: 'customer_refused',    label: 'Customer refused to pay',        category: 'customer', enabled: true },
  { key: 'other',               label: 'Other (see note)',               category: 'other',    enabled: true },
];

let _cache = null;
let _at = 0;
const TTL_MS = 30_000;

// Config entries win over the fallback per key, so an admin can relabel a
// seeded reason without losing the ones they never touched.
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

export function usePostDateFailReasons() {
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
        const raw = r.data?.config?.['post_date_fail_reasons'];
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
    return hit?.label || String(key).replace(/_/g, ' ');
  };

  return { reasons, activeReasons, labelOf };
}

export function clearPostDateFailReasonsCache() { _cache = null; _at = 0; }

export { FALLBACK as DEFAULT_POST_DATE_FAIL_REASONS };
