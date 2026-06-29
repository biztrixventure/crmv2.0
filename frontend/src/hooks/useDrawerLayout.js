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
    { id: 'customer',     label: 'Customer',        visible: true, order: 1 },
    { id: 'vehicle',      label: 'Vehicle',         visible: true, order: 2 },
    { id: 'lead_info',    label: 'Additional Info', visible: true, order: 3 },
    { id: 'people',       label: 'People',          visible: true, order: 4 },
    { id: 'dispositions', label: 'Dispositions',    visible: true, order: 5 },
    { id: 'timeline',     label: 'Timeline',        visible: true, order: 6 },
    { id: 'audit',        label: 'Audit Trail',     visible: true, order: 7 },
  ],
  callback: [
    { id: 'schedule', label: 'Schedule', visible: true, order: 1 },
    { id: 'customer', label: 'Customer', visible: true, order: 2 },
    { id: 'agent',    label: 'Agent',    visible: true, order: 3 },
    { id: 'notes',    label: 'Notes',    visible: true, order: 4 },
    { id: 'meta',     label: 'Meta',     visible: true, order: 5 },
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
  const uid  = user?.id || '';
  // Per-user layout (set by a superadmin) wins over the per-role layout.
  const cacheKey = `${drawerType}|${role}|${uid}`;
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
        const userKey = uid ? `drawer.layout.${drawerType}.user.${uid}` : null;
        const roleKey = `drawer.layout.${drawerType}.${role}`;
        const userLayout = userKey && Array.isArray(cfg[userKey]) && cfg[userKey].length ? cfg[userKey] : null;
        const raw = userLayout || cfg[roleKey] || FALLBACK[drawerType] || [];
        const sorted = [...raw].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        _cache.set(cacheKey, { value: sorted, at: Date.now() });
        setSections(sorted);
      })
      .catch(() => {
        // Use fallback silently — drawer still renders.
        setSections(FALLBACK[drawerType] || []);
      });
    return () => { cancelled = true; };
  }, [cacheKey, drawerType, role, uid]);

  const isVisible = (id) => {
    const s = sections.find(x => x.id === id);
    return s ? !!s.visible : true; // unknown section ids default to visible
  };
  const order = (id) => {
    const s = sections.find(x => x.id === id);
    return s ? (s.order ?? 99) : 99;
  };

  // Field-level visibility. When a section has no fields[] array, every field
  // defaults to visible (back-compat with the section-only configs). When the
  // SuperAdmin has set fields[], each entry controls one row.
  const isFieldVisible = (sectionId, fieldId) => {
    const s = sections.find(x => x.id === sectionId);
    if (!s) return true;
    if (!Array.isArray(s.fields) || s.fields.length === 0) return true;
    const f = s.fields.find(x => x.id === fieldId);
    return f ? !!f.visible : true;   // new fields default to visible
  };

  // Get field order within a section (for reordering rendered rows).
  const fieldOrder = (sectionId, fieldId) => {
    const s = sections.find(x => x.id === sectionId);
    if (!s || !Array.isArray(s.fields)) return 99;
    const f = s.fields.find(x => x.id === fieldId);
    return f ? (f.order ?? 99) : 99;
  };

  return { sections, isVisible, order, isFieldVisible, fieldOrder };
}

// Used by the admin page to bust the cache after a save.
export function clearDrawerLayoutCache() { _cache.clear(); }
