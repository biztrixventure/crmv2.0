import { useEffect, useState } from 'react';
import client from '../api/client';
import { CELEBRATION_TEMPLATE_KEYS } from '../utils/celebration';

/*
 * useCelebrationConfig
 *
 * Reads the superadmin-configured celebration settings from business_config
 * (`celebrations.config`). Generic eventKey → template map: adding a new
 * morale-moment trigger later (a new notification type) is just one more
 * entry under `events` — no new plumbing here.
 *
 * Config shape (all optional — falls back to DEFAULT_CELEBRATIONS):
 *   { enabled, events: { [notificationType]: { enabled, template } } }
 *   - notificationType matches `notifications.type` exactly (e.g.
 *     'sale_approved', 'quota_milestone') — the realtime INSERT handler in
 *     useNotifications.js looks up payload.new.type directly against this map.
 *
 * Superadmin edits it in Business Rules → Celebrations.
 */
const KEY = 'celebrations.config';

export const DEFAULT_CELEBRATIONS = {
  enabled: true,
  events: {
    sale_approved:   { enabled: true, template: 'fireworks' },
    quota_milestone: { enabled: true, template: 'stars' },
  },
};

let _cache = null, _at = 0;
const TTL_MS = 30_000;

const clean = (raw) => {
  if (!raw || typeof raw !== 'object') return DEFAULT_CELEBRATIONS;
  const events = { ...DEFAULT_CELEBRATIONS.events };
  if (raw.events && typeof raw.events === 'object') {
    for (const [eventKey, val] of Object.entries(raw.events)) {
      const base = events[eventKey] || { enabled: true, template: 'classic' };
      events[eventKey] = {
        enabled: val?.enabled !== false,
        template: CELEBRATION_TEMPLATE_KEYS.includes(val?.template) ? val.template : base.template,
      };
    }
  }
  return { enabled: raw.enabled !== false, events };
};

// Non-hook accessor — the realtime notification handler in useNotifications.js
// fires from a Supabase channel callback, not React render, so it can't call
// a hook. Shares the same module-level cache as useCelebrationConfig().
export async function loadCelebrationConfig() {
  if (_cache && Date.now() - _at < TTL_MS) return _cache;
  try {
    const r = await client.get('business-config');
    const resolved = clean(r.data?.config?.[KEY]);
    _cache = resolved; _at = Date.now();
    return resolved;
  } catch {
    return DEFAULT_CELEBRATIONS;
  }
}

export function useCelebrationConfig() {
  const [cfg, setCfg] = useState(_cache || DEFAULT_CELEBRATIONS);

  useEffect(() => {
    let cancelled = false;
    loadCelebrationConfig().then((resolved) => { if (!cancelled) setCfg(resolved); });
    return () => { cancelled = true; };
  }, []);

  return cfg;
}

export function clearCelebrationConfigCache() { _cache = null; _at = 0; }
