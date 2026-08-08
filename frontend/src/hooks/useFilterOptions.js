// ============================================================================
// useFilterOptions — the dropdown vocabularies a column filter needs, fetched
// ONCE per session and shared by every table that asks.
//
// The rule this exists to enforce: never SELECT DISTINCT a big table to
// populate a filter menu. "Which closers exist" is a 237-row question about
// user_profiles, not a 7,044-row scan of sales — and "which companies exist"
// is a 6-row question. So the options come from the small catalog endpoints the
// shells already call, cached in a module-level map so opening Sales, then
// Transfers, then Callbacks costs one request in total rather than three.
//
// Statuses are NOT here: they ride along in the `columns` catalog the list
// endpoint returns (the server knows the enum vocabulary), and compliance
// overrides their labels through useComplianceStatuses.
// ============================================================================
import { useState, useEffect } from 'react';
import client from '../api/client';

const cache = new Map();      // key -> resolved value
const inflight = new Map();   // key -> promise, so N tables mounting at once
                              // share ONE request instead of racing N.

function once(key, fetcher) {
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  if (inflight.has(key)) return inflight.get(key);
  const p = fetcher()
    .then((v) => { cache.set(key, v); inflight.delete(key); return v; })
    .catch(() => { cache.set(key, []); inflight.delete(key); return []; });
  inflight.set(key, p);
  return p;
}

/**
 * @param opts.companyList  the shell already holds this (6 rows) — passed in
 *                          rather than re-fetched.
 * @returns { userOptions, companyOptions, clientOptions } — userOptions carry
 *          a `role` (the user's custom_roles level, e.g. 'closer'/'fronter'),
 *          all as [{ value, label }]
 */
export function useFilterOptions({ companyList } = {}) {
  const [userOptions, setUserOptions] = useState(() => cache.get('users') || []);

  useEffect(() => {
    let alive = true;
    once('users', async () => {
      const r = await client.get('compliance/users');
      // One entry per user — /compliance/users returns a row per (user,
      // company) pair, and a user in two companies must not appear twice.
      const seen = new Set();
      return (r.data?.users || [])
        .filter((u) => { if (seen.has(u.user_id)) return false; seen.add(u.user_id); return true; })
        .map((u) => ({ value: u.user_id, label: u.full_name || 'Unknown', role: u.role_level || null }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }).then((v) => { if (alive) setUserOptions(v); });
    return () => { alive = false; };
  }, []);

  const [clientOptions, setClientOptions] = useState(() => cache.get('clients') || []);

  useEffect(() => {
    let alive = true;
    once('clients', async () => {
      const r = await client.get('compliance/clients');
      return (r.data?.clients || []).map((v) => ({ value: v, label: v }));
    }).then((v) => { if (alive) setClientOptions(v); });
    return () => { alive = false; };
  }, []);

  const companyOptions = (companyList || []).map((c) => ({ value: c.id, label: c.name }));
  return { userOptions, companyOptions, clientOptions };
}

export default useFilterOptions;
