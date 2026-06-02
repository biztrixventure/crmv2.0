import { useEffect, useState } from 'react';
import client from '../api/client';

// Fallback used when the business-config endpoint is unavailable or returns
// nothing for the company. Matches the safe default seeded by mig 068.
const FALLBACK = [
  'open', 'sold', 'cancelled', 'follow_up', 'closed_won', 'closed_lost',
  'pending_review', 'needs_revision', 'compliance_cancelled', 'chargeback', 'dispute',
];

// Some statuses are workflow-only and never appear in the compliance edit
// dropdown even when allowed elsewhere (a sale can't be moved BACK into
// pending_review — submit_for_review handles that).
const HIDE_FROM_EDIT = new Set(['pending_review', 'needs_revision']);

let _cache = null;
let _at = 0;
const TTL_MS = 30_000;

/* useComplianceStatuses
 * Returns { allStatuses, editStatuses } pulled from business_config so the
 * SuperAdmin's Compliance Workflow page actually drives every status dropdown
 * in the compliance shell. Falls back to a safe default when the config endpoint
 * is unreachable so the UI never breaks.
 */
export function useComplianceStatuses() {
  const [allStatuses, setAllStatuses]   = useState(FALLBACK);
  const [editStatuses, setEditStatuses] = useState(FALLBACK.filter(s => !HIDE_FROM_EDIT.has(s)));

  useEffect(() => {
    if (_cache && Date.now() - _at < TTL_MS) {
      setAllStatuses(_cache.all);
      setEditStatuses(_cache.edit);
      return;
    }
    let cancelled = false;
    client.get('business-config')
      .then(r => {
        if (cancelled) return;
        const cfg = r.data?.config || {};
        const allowed = Array.isArray(cfg['compliance.allowed_statuses']) && cfg['compliance.allowed_statuses'].length
          ? cfg['compliance.allowed_statuses']
          : FALLBACK;
        const editable = allowed.filter(s => !HIDE_FROM_EDIT.has(s));
        _cache = { all: allowed, edit: editable };
        _at = Date.now();
        setAllStatuses(allowed);
        setEditStatuses(editable);
      })
      .catch(() => { /* fall back silently */ });
    return () => { cancelled = true; };
  }, []);

  return { allStatuses, editStatuses };
}

export function clearComplianceStatusCache() { _cache = null; }
