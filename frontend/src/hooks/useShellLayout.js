import { useEffect, useState, useMemo } from 'react';
import client from '../api/client';
import { useAuth } from '../contexts/AuthContext';

/*
 * useShellLayout
 *
 * Reads shell.layout.<shellId> from business_config and returns helpers
 * that layer on top of the existing permission + feature-flag gating in
 * each shell. Each shell still builds its full TABS catalog using
 * permissions and feature flags (which determine what the user is
 * *allowed* to see); this hook then filters/reorders/renames that
 * catalog using the admin's layout config.
 *
 * Critical rules:
 *   - Admin override can only *narrow* the catalog (hide, reorder,
 *     rename). It can NEVER widen — if a tab is gated out by permission
 *     or feature flag, the admin cannot show it.
 *   - If a tab is in the catalog but NOT in the admin config, it stays
 *     visible (default-on) so adding a new tab in code doesn't silently
 *     disappear after a deploy.
 *   - If the admin layout is empty / missing, the catalog renders as-is.
 *   - Cache: 30s TTL, in-memory, keyed per shellId.
 *
 * Phase 2 (stat_cards / filters / actions) uses the same key with extra
 * sub-collections. Unknown sub-keys are ignored so the shape can grow
 * without breaking older deployments.
 */

const TTL_MS = 30_000;
const _cache = new Map();

export function useShellLayout(shellId) {
  const [layout, setLayout] = useState(() => _cache.get(shellId)?.data || null);
  // The active role level (e.g. fronter_manager) — drives the per-role feature
  // overrides layered on top of the shell-wide config. Superadmin is exempt so
  // an admin never accidentally hides a surface from themselves while testing.
  const { user } = useAuth();
  const role = user?.role || null;

  useEffect(() => {
    if (!shellId) return;
    const cached = _cache.get(shellId);
    if (cached && Date.now() - cached.at < TTL_MS) {
      setLayout(cached.data);
      return;
    }
    let cancelled = false;
    client.get('business-config')
      .then(r => {
        if (cancelled) return;
        const cfg = r.data?.config || {};
        const raw = cfg[`shell.layout.${shellId}`] || null;
        _cache.set(shellId, { data: raw, at: Date.now() });
        setLayout(raw);
      })
      .catch(() => { /* fall back silently — UI uses code-defined catalog */ });
    return () => { cancelled = true; };
  }, [shellId]);

  const tabOverrides = useMemo(() => {
    const map = new Map();
    const tabs = Array.isArray(layout?.tabs) ? layout.tabs : [];
    tabs.forEach((t, i) => {
      if (!t || !t.key) return;
      map.set(t.key, {
        enabled: t.enabled !== false,
        label:   typeof t.label === 'string' && t.label.trim() ? t.label.trim() : null,
        order:   Number.isFinite(t.order) ? t.order : i,
      });
    });
    return map;
  }, [layout]);

  /*
   * applyTabs(catalog) — takes the code-defined tab array (already
   * permission/flag-filtered) and returns the version the user actually
   * sees. Stable for the lifetime of a given layout snapshot.
   */
  // Keys this role is explicitly forbidden from seeing for a given collection.
  // Role overrides can only *hide* (narrow) — never widen past the shell-wide
  // config or the user's permissions. Superadmin is never restricted.
  const roleHiddenSet = (category) => {
    if (!role || role === 'superadmin') return null;
    const col = layout?.role_overrides?.[role]?.[category];
    if (!Array.isArray(col)) return null;
    return new Set(col.filter(x => x && x.enabled === false).map(x => x.key));
  };

  const applyTabs = (catalog) => {
    if (!Array.isArray(catalog) || catalog.length === 0) return catalog || [];
    const roHidden = roleHiddenSet('tabs');
    const decorated = catalog.map((t, codeIdx) => {
      const override = tabOverrides.get(t.key);
      const enabled  = (override ? override.enabled : true) && !(roHidden && roHidden.has(t.key));
      const label    = override?.label || t.label;
      const order = override ? override.order : 1000 + codeIdx;
      return enabled ? { ...t, label, __order: order } : null;
    }).filter(Boolean);
    decorated.sort((a, b) => a.__order - b.__order);
    return decorated.map(({ __order, ...rest }) => rest);
  };

  const defaultTab = (catalog) => {
    const cfgKey = layout?.default_tab;
    if (cfgKey && catalog?.some?.(t => t.key === cfgKey)) return cfgKey;
    return catalog?.[0]?.key || null;
  };

  // Generic visibility lookup for stat_cards / filters / actions
  // sub-collections. Default-on so a fresh deploy never silently hides a
  // surface the admin hasn't customized.
  const isVisible = (category, key, fallback = true) => {
    // Per-role override is the most specific gate and can only hide.
    const roHidden = roleHiddenSet(category);
    if (roHidden && roHidden.has(key)) return false;
    // Shell-wide setting next.
    const col = layout?.[category];
    if (!Array.isArray(col)) return fallback;
    const hit = col.find(x => x && x.key === key);
    if (!hit) return fallback;
    return hit.enabled !== false;
  };
  const isCardVisible   = (key) => isVisible('stat_cards', key);
  const isFilterVisible = (key) => isVisible('filters',    key);
  const isActionVisible = (key) => isVisible('actions',    key);

  // Per-card display label override (admin can rename a KPI card without a
  // deploy). Falls back to the code-defined label when unset/blank.
  const cardLabel = (key, fallback) => {
    const col = layout?.stat_cards;
    if (!Array.isArray(col)) return fallback;
    const hit = col.find(x => x && x.key === key);
    const lbl = hit?.label;
    return (typeof lbl === 'string' && lbl.trim()) ? lbl.trim() : fallback;
  };

  return {
    layout,
    role,
    applyTabs,
    defaultTab,
    isCardVisible,
    isFilterVisible,
    isActionVisible,
    cardLabel,
    ready: !!_cache.get(shellId),
  };
}

export function clearShellLayoutCache(shellId) {
  if (shellId) _cache.delete(shellId);
  else _cache.clear();
}
