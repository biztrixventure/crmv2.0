import { useEffect, useState } from 'react';
import client from '../api/client';
import { useAuth } from '../contexts/AuthContext';

// In-memory cache keyed by `${drawerType}|${role}` — drawer layouts are tiny
// and read often, so a 30s TTL is overkill. We refresh once per session unless
// the SuperAdmin saves a change (which we can't observe here without realtime).
const _cache = new Map();
const TTL_MS = 30_000;

const FALLBACK = {
  sale: [
    { id: 'customer',   label: 'Customer',     visible: true, order: 1 },
    { id: 'vehicle',    label: 'Vehicle',      visible: true, order: 2 },
    { id: 'sale_info',  label: 'Sale Info',    visible: true, order: 3 },
    { id: 'financial',  label: 'Financial',    visible: true, order: 4 },
    { id: 'additional', label: 'Additional Info', visible: true, order: 5 },
    { id: 'people',     label: 'People',       visible: true, order: 6 },
    { id: 'timeline',   label: 'Timeline',     visible: true, order: 7 },
    { id: 'audit',      label: 'Audit Trail',  visible: true, order: 8 },
    { id: 'compliance_actions', label: 'Compliance Actions', visible: false, order: 9 },
  ],
  transfer: [
    { id: 'customer',     label: 'Customer',     visible: true, order: 1 },
    { id: 'vehicle',      label: 'Vehicle',      visible: true, order: 2 },
    { id: 'lead_info',    label: 'Lead Info',    visible: true, order: 3 },
    { id: 'people',       label: 'People',       visible: true, order: 4 },
    { id: 'dispositions', label: 'Dispositions', visible: true, order: 5 },
    { id: 'timeline',     label: 'Timeline',     visible: true, order: 6 },
  ],
  callback: [
    { id: 'schedule', label: 'Schedule', visible: true, order: 1 },
    { id: 'customer', label: 'Customer', visible: true, order: 2 },
    { id: 'notes',    label: 'Notes',    visible: true, order: 3 },
    { id: 'history',  label: 'History',  visible: true, order: 4 },
  ],
};

/* useDrawerLayout(drawerType)
 * Returns ordered+visible section ids for the current user's role on the
 * given drawer type. Drawers consume this to render sections in the order
 * the SuperAdmin configured, hiding sections marked invisible per role.
 *
 * Returns { sections, isVisible(id), order(id) }.
 *
 * Defensive: if config endpoint fails or returns nothing, falls back to a
 * built-in default so drawers never render empty.
 */
export function useDrawerLayout(drawerType) {
  const { user } = useAuth();
  const role = user?.role || 'closer';
  const cacheKey = `${drawerType}|${role}`;
  const [sections, setSections] = useState(() => {
    const hit = _cache.get(cacheKey);
    return hit ? hit.value : (FALLBACK[drawerType] || []);
  });

  useEffect(() => {
    const hit = _cache.get(cacheKey);
    if (hit && Date.now() - hit.at < TTL_MS) {
      setSections(hit.value);
      return;
    }
    let cancelled = false;
    client.get('business-config')
      .then(r => {
        if (cancelled) return;
        const cfg = r.data?.config || {};
        const key = `drawer.layout.${drawerType}.${role}`;
        const raw = cfg[key] || FALLBACK[drawerType] || [];
        const sorted = [...raw].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        _cache.set(cacheKey, { value: sorted, at: Date.now() });
        setSections(sorted);
      })
      .catch(() => {
        // Use fallback silently — drawer still renders.
        setSections(FALLBACK[drawerType] || []);
      });
    return () => { cancelled = true; };
  }, [cacheKey, drawerType, role]);

  const isVisible = (id) => {
    const s = sections.find(x => x.id === id);
    return s ? !!s.visible : true; // unknown section ids default to visible
  };
  const order = (id) => {
    const s = sections.find(x => x.id === id);
    return s ? (s.order ?? 99) : 99;
  };

  return { sections, isVisible, order };
}

// Used by the admin page to bust the cache after a save.
export function clearDrawerLayoutCache() { _cache.clear(); }
