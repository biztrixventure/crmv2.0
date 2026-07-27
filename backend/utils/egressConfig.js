// ============================================================================
// egressConfig — resolvers for the business_config-backed egress/display config
// (mirrors drawer.layout / shell.layout resolution: company → global → fallback).
//   export.columns.__users           → { <userId>: { <dataset>: string[] } }
//   export.columns.<dataset>.<role>  → string[] of allowed export field keys
//   list.layout.<shell>.<role>       → { page_size, visible_columns[], default_view }
// Absence = "surface default / code default" so nothing changes until configured.
//
// PER-USER OVERRIDES live in ONE map key (export.columns.__users), the same
// shape as pwa_users: a single cached read resolves every dataset for a user
// instead of one business_config row per (user × dataset). Empty overrides are
// deleted from the map, never stored. The LEGACY per-user key layout
// (export.columns.<dataset>.<userId>) is still read so configs saved before the
// map existed keep working; new writes always go to the map.
// ============================================================================
const { getConfig } = require('./businessConfig');

const USERS_KEY = 'export.columns.__users';

// { userId: { dataset: string[] } } — always an object, never null.
async function readUserColumnMap(companyId) {
  const raw = await getConfig(companyId, USERS_KEY, null);
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

// An override that selects nothing is not stored: an absent entry already means
// "no override", so storing one would grow the map forever with no-op rows.
const isEmptyColumnOverride = (o) =>
  !o || typeof o !== 'object' || Array.isArray(o) ||
  Object.values(o).every(v => !Array.isArray(v) || v.length === 0);

// Allowed EXPORT columns for a dataset, most-specific scope first:
//   per-USER (map, then legacy key) → per-ROLE (role) → the 'all' catch-all → null.
// A per-user config lets a superadmin give ONE person a different export from
// their whole role. null = "not configured → the surface's own default column
// set" (the client resolves that; it is NOT the same as 'every known column').
async function resolveExportColumns({ companyId, dataset, role, userId, userMap }) {
  if (!dataset) return null;
  if (userId) {
    const map = userMap || await readUserColumnMap(companyId);
    const v = map[userId] && map[userId][dataset];
    if (Array.isArray(v) && v.length) return v.map(String);
    // legacy layout: one business_config row per (dataset, userId)
    const legacy = await getConfig(companyId, `export.columns.${dataset}.${userId}`, undefined);
    if (Array.isArray(legacy)) return legacy.map(String);
  }
  for (const scope of [role, 'all']) {
    if (!scope) continue;
    const v = await getConfig(companyId, `export.columns.${dataset}.${scope}`, undefined);
    if (Array.isArray(v)) return v.map(String);
  }
  return null;
}

// Resolve MANY datasets for one caller off a single read of the user map — the
// whole point of the map layout. Returns { dataset: string[]|null }.
async function resolveExportColumnsFor({ companyId, role, userId, datasets }) {
  const userMap = await readUserColumnMap(companyId);
  const out = {};
  for (const dataset of (datasets || [])) {
    out[dataset] = await resolveExportColumns({ companyId, dataset, role, userId, userMap });
  }
  return out;
}

// list.layout for a shell+role → merged with fallback. Returns the raw object or {}.
async function resolveListLayout({ companyId, shell, role }) {
  if (!shell) return {};
  for (const r of [role, 'all']) {
    if (!r) continue;
    const v = await getConfig(companyId, `list.layout.${shell}.${r}`, undefined);
    if (v && typeof v === 'object') return v;
  }
  return {};
}

module.exports = {
  resolveExportColumns, resolveExportColumnsFor, resolveListLayout,
  readUserColumnMap, isEmptyColumnOverride, USERS_KEY,
};
