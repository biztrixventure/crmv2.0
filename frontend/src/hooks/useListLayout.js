import { useState, useEffect } from 'react';
import client from '../api/client';
import { useAuth } from '../contexts/AuthContext';

// Resolve the superadmin-configured list.layout for a shell (page size, default
// row view, visible columns) for the current user's role. Falls back to the
// caller-supplied defaults so nothing changes until a superadmin configures it.
// Config source: business_config list.layout.<shell>.<role> via /egress/list-layout.
//
// Cached per (shell, role) for the session so every table in a shell shares one
// fetch. Never throws — a config outage silently uses the defaults.
const _cache = new Map();

export function useListLayout(shell, defaults = {}) {
  const { user } = useAuth();
  const role = user?.role;
  const key = `${shell}:${role}`;
  const [layout, setLayout] = useState(() => _cache.get(key) || null);

  useEffect(() => {
    if (!shell || !role) return;
    if (_cache.has(key)) { setLayout(_cache.get(key)); return; }
    let cancelled = false;
    client.get('egress/list-layout', { params: { shell, role } })
      .then(r => { const v = r.data?.layout || {}; _cache.set(key, v); if (!cancelled) setLayout(v); })
      .catch(() => { _cache.set(key, {}); if (!cancelled) setLayout({}); });
    return () => { cancelled = true; };
  }, [shell, role, key]);

  const l = layout || {};
  return {
    pageSize: (Number.isFinite(+l.page_size) && +l.page_size > 0) ? +l.page_size : (defaults.pageSize || 25),
    defaultView: l.default_view || defaults.defaultView || 'collapsed',
    visibleColumns: Array.isArray(l.visible_columns) ? l.visible_columns : null,   // null = all
    loaded: layout !== null,
  };
}
