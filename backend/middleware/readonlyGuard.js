// ============================================================================
// readonlyGuard — blocks every mutation from a readonly_admin.
//
// readonly_admin is meant to inspect the platform without ever changing it.
// Hiding buttons in the UI is cosmetic — the source of truth is here, so a
// devtools-edited request still gets 403'd.
//
// Mount AFTER authMiddleware (req.user must already be populated).
// ============================================================================

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Endpoints that must still accept POST/PUT from a readonly_admin to keep them
// usable — session housekeeping + their own profile bits. Match by suffix
// against the path the route saw (NOT including the /api/X mount prefix), and
// also by absolute path for things mounted outside a per-resource prefix.
const ALLOWLIST_SUFFIX = [
  '/logout',
  '/refresh',
  '/me',
];

function readonlyGuard(req, res, next) {
  if (READ_METHODS.has(req.method)) return next();
  if (req.user?.role !== 'readonly_admin') return next();

  const path = req.originalUrl.split('?')[0];
  if (ALLOWLIST_SUFFIX.some(suf => path.endsWith(suf))) return next();

  return res.status(403).json({ error: 'Read-only account: writes are disabled for this role.' });
}

module.exports = { readonlyGuard };
