// ============================================================================
// egressConfig — resolvers for the business_config-backed egress/display config
// (mirrors drawer.layout / shell.layout resolution: company → global → fallback).
//   export.columns.<dataset>.<role>  → string[] of allowed export field keys
//   list.layout.<shell>.<role>       → { page_size, visible_columns[], default_view }
// Absence = "all fields / code default" so nothing changes until configured.
// ============================================================================
const { getConfig } = require('./businessConfig');

// Allowed EXPORT columns for a dataset, most-specific scope first:
//   per-USER (userId) → per-ROLE (role) → the 'all' catch-all → null.
// A per-user config lets a superadmin give ONE person a one-column (or many-
// column) export that differs from their whole role. null = "no restriction →
// all fields". Keys never collide: userId is a UUID, role a level string.
async function resolveExportColumns({ companyId, dataset, role, userId }) {
  if (!dataset) return null;
  for (const scope of [userId, role, 'all']) {
    if (!scope) continue;
    const v = await getConfig(companyId, `export.columns.${dataset}.${scope}`, undefined);
    if (Array.isArray(v)) return v.map(String);
  }
  return null;
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

module.exports = { resolveExportColumns, resolveListLayout };
