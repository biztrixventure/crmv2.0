// ============================================================================
// egressConfig — resolvers for the business_config-backed egress/display config
// (mirrors drawer.layout / shell.layout resolution: company → global → fallback).
//   export.columns.<dataset>.<role>  → string[] of allowed export field keys
//   list.layout.<shell>.<role>       → { page_size, visible_columns[], default_view }
// Absence = "all fields / code default" so nothing changes until configured.
// ============================================================================
const { getConfig } = require('./businessConfig');

// Allowed EXPORT columns for a dataset+role. Falls back role → (dataset-wide '*'
// role) → null. null means "no restriction → all fields".
async function resolveExportColumns({ companyId, dataset, role }) {
  if (!dataset) return null;
  for (const r of [role, 'all']) {
    if (!r) continue;
    const v = await getConfig(companyId, `export.columns.${dataset}.${r}`, undefined);
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
