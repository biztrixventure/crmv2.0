import { useEffect, useState } from 'react';
import client from '../api/client';

/*
 * useTransferStatuses
 *
 * Mirror of useComplianceStatuses but for the transfer lifecycle. The
 * compliance catalog drives the sales pipeline; the transfer catalog drives
 * the fronter→closer handoff lifecycle (pending → assigned → completed,
 * with rejected and cancelled as off-ramps).
 *
 * Returns:
 *   catalog       — full list, config-driven (falls back to FALLBACK_CATALOG)
 *   allStatuses   — keys of enabled entries (for filter dropdowns)
 *   labelOf(key)  — display label, falls back to a humanized key
 *   badgeOf(key)  — Badge variant ('success'/'error'/…), default 'secondary'
 *   isLegacy(key) — true when the key exists in FALLBACK but not in config
 */

// Hardcoded fallback — keeps the UI working even before the SuperAdmin saves
// a custom catalog or the seed migration is applied. Order here is the
// canonical workflow order so the filter pills always read left → right.
const FALLBACK_CATALOG = [
  { key: 'pending',   label: 'Pending',   badge: 'warning',   enabled: true },
  { key: 'assigned',  label: 'Assigned',  badge: 'info',      enabled: true },
  { key: 'completed', label: 'Completed', badge: 'success',   enabled: true },
  { key: 'rejected',  label: 'Rejected',  badge: 'error',     enabled: true },
  { key: 'cancelled', label: 'Cancelled', badge: 'secondary', enabled: true },
];

let _cache = null;
let _at = 0;
const TTL_MS = 30_000;

function mergeCatalog(raw) {
  const fromConfig = Array.isArray(raw) ? raw : [];
  const map = new Map();
  FALLBACK_CATALOG.forEach(s => map.set(s.key, { ...s }));
  fromConfig.forEach(s => {
    if (!s || !s.key) return;
    map.set(s.key, { ...(map.get(s.key) || {}), ...s });
  });
  // When config provides an ordered array, honor that order; append any
  // fallback-only keys at the tail so legacy rows still render.
  if (fromConfig.length) {
    const seen = new Set();
    const ordered = [];
    fromConfig.forEach(s => {
      if (!s || !s.key) return;
      const merged = map.get(s.key);
      if (merged && !seen.has(s.key)) { ordered.push(merged); seen.add(s.key); }
    });
    FALLBACK_CATALOG.forEach(s => {
      if (!seen.has(s.key)) ordered.push(map.get(s.key));
    });
    return ordered;
  }
  return [...map.values()];
}

export function useTransferStatuses() {
  const [catalog, setCatalog] = useState(_cache?.catalog || FALLBACK_CATALOG);

  useEffect(() => {
    if (_cache && Date.now() - _at < TTL_MS) {
      setCatalog(_cache.catalog);
      return;
    }
    let cancelled = false;
    client.get('business-config')
      .then(r => {
        if (cancelled) return;
        const cfg = r.data?.config || {};
        const raw = cfg['transfer.status_catalog'];
        const resolved = Array.isArray(raw) && raw.length ? mergeCatalog(raw) : FALLBACK_CATALOG;
        _cache = { catalog: resolved };
        _at = Date.now();
        setCatalog(resolved);
      })
      .catch(() => { /* fall back silently */ });
    return () => { cancelled = true; };
  }, []);

  const allStatuses = catalog.filter(s => s.enabled !== false).map(s => s.key);

  const labelOf = (key) => {
    if (!key) return '—';
    const hit = catalog.find(s => s.key === key);
    return hit?.label || key.replace(/_/g, ' ');
  };
  const badgeOf = (key) => {
    if (!key) return 'secondary';
    const hit = catalog.find(s => s.key === key);
    return hit?.badge || 'secondary';
  };
  const isLegacy = (key) => {
    if (!key) return false;
    return !catalog.some(s => s.key === key);
  };

  return { catalog, allStatuses, labelOf, badgeOf, isLegacy };
}

export function clearTransferStatusCache() { _cache = null; _at = 0; }
