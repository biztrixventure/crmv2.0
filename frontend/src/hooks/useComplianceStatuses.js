import { useEffect, useState } from 'react';
import client from '../api/client';

// ── Hardcoded fallback. Used when the config endpoint is unavailable or has
// no catalog seeded yet. Keeping every legacy status here means existing
// records always render correctly, even if SuperAdmin removes a key from the
// catalog. New custom statuses added in the catalog merge over this list.
const FALLBACK_CATALOG = [
  { key: 'open',                 label: 'Open',              badge: 'info',      category: 'pending', enabled: true,  editable_by_compliance: true  },
  { key: 'sold',                 label: 'Sold',              badge: 'success',   category: 'won',     enabled: true,  editable_by_compliance: true  },
  { key: 'cancelled',            label: 'Cancelled',         badge: 'error',     category: 'lost',    enabled: true,  editable_by_compliance: true  },
  { key: 'follow_up',            label: 'Follow Up',         badge: 'warning',   category: 'pending', enabled: true,  editable_by_compliance: true  },
  { key: 'closed_won',           label: 'Approved',          badge: 'success',   category: 'won',     enabled: true,  editable_by_compliance: true  },
  { key: 'closed_lost',          label: 'Lost',              badge: 'error',     category: 'lost',    enabled: true,  editable_by_compliance: true  },
  { key: 'pending_review',       label: 'Pending Review',    badge: 'warning',   category: 'pending', enabled: true,  editable_by_compliance: false },
  { key: 'needs_revision',       label: 'Needs Revision',    badge: 'error',     category: 'pending', enabled: true,  editable_by_compliance: false },
  { key: 'compliance_cancelled', label: 'Comp. Cancelled',   badge: 'error',     category: 'lost',    enabled: true,  editable_by_compliance: true  },
  { key: 'chargeback',           label: 'Chargeback',        badge: 'error',     category: 'lost',    enabled: true,  editable_by_compliance: true  },
  { key: 'dispute',              label: 'Dispute',           badge: 'warning',   category: 'pending', enabled: true,  editable_by_compliance: true  },
];

let _cache = null;
let _at = 0;
const TTL_MS = 30_000;

// Merge resolver — catalog from config wins, fallback fills gaps so existing
// records with statuses outside the catalog still render with a sane label.
function mergeCatalog(raw) {
  const fromConfig = Array.isArray(raw) ? raw : [];
  const map = new Map();
  // Fallback first so config can overwrite each entry.
  FALLBACK_CATALOG.forEach(s => map.set(s.key, { ...s }));
  fromConfig.forEach(s => {
    if (!s || !s.key) return;
    map.set(s.key, { ...(map.get(s.key) || {}), ...s });
  });
  return [...map.values()];
}

/* useComplianceStatuses
 * Returns the merged compliance status catalog + helpful derived lookups.
 *   catalog       — full list (config-driven, falls back to FALLBACK_CATALOG)
 *   allStatuses   — keys of every catalog entry (for the filter dropdown)
 *   editStatuses  — keys of entries with editable_by_compliance + enabled
 *                   true (for the compliance edit-status dialog)
 *   labelOf(key)  — display label, with fallback to a humanized key
 *   badgeOf(key)  — Badge variant ('success'/'error'/…), default 'secondary'
 *   isLegacy(key) — true when the key exists in FALLBACK but not in config
 */
export function useComplianceStatuses() {
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
        const raw = cfg['compliance.status_catalog'];
        // Back-compat: older deployments may only have allowed_statuses (an
        // array of bare key strings). Treat each as an enabled entry that
        // borrows defaults from the fallback.
        let resolved;
        if (Array.isArray(raw)) {
          resolved = mergeCatalog(raw);
        } else if (Array.isArray(cfg['compliance.allowed_statuses'])) {
          const enabledKeys = new Set(cfg['compliance.allowed_statuses']);
          resolved = mergeCatalog(FALLBACK_CATALOG.map(s => ({ ...s, enabled: enabledKeys.has(s.key) })));
        } else {
          resolved = FALLBACK_CATALOG;
        }
        _cache = { catalog: resolved };
        _at = Date.now();
        setCatalog(resolved);
      })
      .catch(() => { /* fall back silently */ });
    return () => { cancelled = true; };
  }, []);

  const allStatuses  = catalog.filter(s => s.enabled !== false).map(s => s.key);
  const editStatuses = catalog
    .filter(s => s.enabled !== false && s.editable_by_compliance !== false)
    .map(s => s.key);

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

  return { catalog, allStatuses, editStatuses, labelOf, badgeOf, isLegacy };
}

export function clearComplianceStatusCache() { _cache = null; _at = 0; }
