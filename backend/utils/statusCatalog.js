// ============================================================================
// statusCatalog — the ONE server-side resolver for "which statuses exist, in
// what order, with what label and badge".
//
// The vocabulary is CONFIG, not code: `transfer.status_catalog` and
// `compliance.status_catalog` in business_config. A superadmin adds, renames,
// reorders or disables a status in Business Rules and every surface reading
// through here follows with no deploy.
//
// This exists because three places needed the same answer at once —
// /stats/overview's stat boxes, /transfers' count strip and /sales' count strip
// — and a per-file copy is how "Approved" ends up meaning closed_won in one
// panel and closed_won+sold in the next. The frontend mirrors live in
// hooks/useTransferStatuses.js and hooks/useComplianceStatuses.js; when a
// response carries a catalog the client should render THAT rather than its own,
// so what is drawn can never disagree with what was counted.
//
// The fallbacks below are the seeded catalogs, kept so an unconfigured
// deployment still renders a full lifecycle instead of an empty strip.
// ============================================================================
const { getConfig } = require('./businessConfig');

const TRANSFER_STATUS_FALLBACK = [
  { key: 'pending',   label: 'Pending',   badge: 'warning'   },
  { key: 'assigned',  label: 'Assigned',  badge: 'info'      },
  { key: 'completed', label: 'Completed', badge: 'success'   },
  { key: 'rejected',  label: 'Rejected',  badge: 'error'     },
  { key: 'cancelled', label: 'Cancelled', badge: 'secondary' },
];

const SALE_STATUS_FALLBACK = [
  { key: 'open',           label: 'Open',           badge: 'info'    },
  { key: 'closed_won',     label: 'Approved',       badge: 'success' },
  { key: 'pending_review', label: 'Pending Review', badge: 'warning' },
  { key: 'needs_revision', label: 'Needs Revision', badge: 'error'   },
  { key: 'cancelled',      label: 'Cancelled',      badge: 'error'   },
];

const titleCase = (k) => String(k).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Enabled entries of a config catalog, in the catalog's own order.
 *
 * `enabled` absent means enabled — a hand-written catalog row must not vanish
 * for omitting a flag. A catalog that resolves to nothing falls back rather
 * than returning [], because an empty strip reads as "no data" when the truth
 * is "misconfigured".
 */
function resolveStatCatalog(raw, fallback) {
  if (!Array.isArray(raw) || !raw.length) return fallback;
  const out = raw
    .filter((s) => s && s.key && s.enabled !== false)
    .map((s) => ({
      key:   String(s.key),
      label: (typeof s.label === 'string' && s.label.trim()) ? s.label.trim() : titleCase(s.key),
      badge: s.badge || 'secondary',
    }));
  return out.length ? out : fallback;
}

/** Transfer lifecycle: pending → assigned → completed, with rejected/cancelled off-ramps. */
async function transferStatusCatalog(companyId) {
  return resolveStatCatalog(
    await getConfig(companyId, 'transfer.status_catalog', null),
    TRANSFER_STATUS_FALLBACK,
  );
}

/**
 * Sale lifecycle. Falls back through `compliance.allowed_statuses` — older
 * deployments configured a flat key list before the catalog shape existed, and
 * those keys are still the truth about which statuses that company uses.
 */
async function saleStatusCatalog(companyId) {
  let raw = await getConfig(companyId, 'compliance.status_catalog', null);
  if (!Array.isArray(raw) || !raw.length) {
    const allowed = await getConfig(companyId, 'compliance.allowed_statuses', null);
    if (Array.isArray(allowed) && allowed.length) raw = allowed.map((k) => ({ key: k }));
  }
  return resolveStatCatalog(raw, SALE_STATUS_FALLBACK);
}

module.exports = {
  transferStatusCatalog,
  saleStatusCatalog,
  resolveStatCatalog,
  TRANSFER_STATUS_FALLBACK,
  SALE_STATUS_FALLBACK,
};
