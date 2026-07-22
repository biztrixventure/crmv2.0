// ============================================================================
// readonlyGuard — blocks every mutation from a readonly_admin.
//
// readonly_admin is meant to inspect the platform without ever changing it.
// Hiding buttons in the UI is cosmetic — the source of truth is here, so a
// devtools-edited request still gets 403'd.
//
// Mount AFTER authMiddleware (req.user must already be populated).
// ============================================================================
const { logReadonlyActivity, resolveGovernance } = require('../utils/readonlyGovernance');

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Endpoints that must still accept POST/PUT from a readonly_admin to keep them
// usable — session housekeeping + their own profile bits + the activity beacon
// (navigation telemetry the RO reports about themselves). Match by suffix
// against the path the route saw (NOT including the /api/X mount prefix), and
// also by absolute path for things mounted outside a per-resource prefix.
const ALLOWLIST_SUFFIX = [
  '/logout',
  '/refresh',
  '/me',
  '/activity/beacon',   // RO self-reported tab/view/copy telemetry (POST)
];

async function readonlyGuard(req, res, next) {
  if (READ_METHODS.has(req.method)) return next();
  if (req.user?.role !== 'readonly_admin') return next();

  const path = req.originalUrl.split('?')[0];
  if (ALLOWLIST_SUFFIX.some(suf => path.endsWith(suf))) return next();

  // Log the blocked write attempt — the highest-value audit signal (exactly
  // what the RO TRIED to change). Fire-and-forget: never await into the 403,
  // never throw. Only runs on the rare mutation path (reads short-circuit
  // above), so it adds zero cost to normal reads.
  logReadonlyActivity({
    userId: req.user.id, role: req.user.role, companyId: req.user.company_id || null,
    actionType: 'blocked_write', httpMethod: req.method, path, source: 'server',
  });

  // The write is ALWAYS blocked (source of truth). The superadmin only controls
  // the wording the RO sees: with show_write_blocked_alert OFF, the response
  // carries a neutral message (no "read-only" tell) and the frontend suppresses
  // the alert entirely. `readonly_write_blocked:true` lets the client recognize
  // this case regardless of the message text. Governance is cached (30s), so the
  // await is effectively free on the rare mutation path.
  let showAlert = true;
  try {
    const gov = await resolveGovernance(req.user.id);
    showAlert = gov?.flags?.show_write_blocked_alert !== false;
  } catch { /* fail safe → show the standard message */ }

  return res.status(403).json({
    error: showAlert ? 'Read-only account: writes are disabled for this role.' : 'Action unavailable.',
    readonly_write_blocked: true,
    show_alert: showAlert,
  });
}

module.exports = { readonlyGuard };
