/**
 * Role routing — maps custom_role.level (from /auth/me) to shell URL.
 *
 * Hierarchy (high → low authority):
 *   superadmin
 *   └── readonly_admin
 *   company_admin
 *   └── operations_manager
 *       ├── fronter_manager  →  manages fronters
 *       │   └── fronter
 *       ├── closer_manager   →  manages closers
 *       │   └── closer
 *       └── compliance_manager
 *
 * NOTE: 'manager' is a legacy alias for fronter_manager. Kept for backward
 *       compat with existing roles that have level='manager' in the DB.
 */

// ─── Shell routes ─────────────────────────────────────────────────────────────

export const ROLE_ROUTES = {
  superadmin:          '/admin',
  readonly_admin:      '/admin',

  compliance_manager:  '/compliance',

  company_admin:       '/operations',
  operations_manager:  '/operations',

  fronter_manager:     '/fronter-manager',
  manager:             '/fronter-manager', // legacy alias

  closer_manager:      '/closer-manager',

  closer:              '/closer',
  fronter:             '/fronter',
};

// ─── Hierarchy (lower number = higher authority) ─────────────────────────────
// Used by hasRoleAccess to decide if a user can access a protected route.

const ROLE_HIERARCHY = {
  superadmin:          0,
  readonly_admin:      1,
  compliance_manager:  2,
  company_admin:       3,
  operations_manager:  4,
  closer_manager:      5,
  fronter_manager:     6,
  manager:             6, // legacy alias, same level as fronter_manager
  closer:              7,
  fronter:             8,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Normalise a role string for loose comparison (lowercase, no underscores). */
export const normalizeRole = (role) =>
  role ? role.toLowerCase().trim().replace(/_/g, '') : '';

/** Return the shell URL for a given role level. */
export const getRoleRoute = (role) => {
  if (!role) return '/dashboard';
  const direct = ROLE_ROUTES[role.toLowerCase().trim()];
  if (direct) return direct;
  // Fallback: try removing underscores
  const norm = normalizeRole(role);
  for (const [key, value] of Object.entries(ROLE_ROUTES)) {
    if (normalizeRole(key) === norm) return value;
  }
  return '/dashboard';
};

/**
 * Returns true if a user with `userRole` may access a route guarded by `requiredRole`.
 *
 * Rules:
 *   - superadmin / readonly_admin → only admin routes
 *   - compliance_manager          → only /compliance
 *   - Everyone else               → hierarchy-based (lower number ≥ required)
 */
export const hasRoleAccess = (userRole, requiredRole) => {
  if (!requiredRole) return true;
  if (!userRole)     return false;

  const normUser     = normalizeRole(userRole);
  const normRequired = normalizeRole(requiredRole);

  if (normUser === normRequired) return true;

  // Platform admins: only admin routes
  if (normUser === 'superadmin' || normUser === 'readonlyadmin') {
    return normRequired === 'admin';
  }

  // Compliance manager: only /compliance
  if (normUser === 'compliancemanager') {
    return normRequired === 'compliancemanager';
  }

  // Hierarchy check: can access routes at same or lower authority
  const userLevel     = ROLE_HIERARCHY[userRole.toLowerCase().trim()]     ?? 999;
  const requiredLevel = ROLE_HIERARCHY[requiredRole.toLowerCase().trim()] ?? 999;
  return userLevel <= requiredLevel;
};
