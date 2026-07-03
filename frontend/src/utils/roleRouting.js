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

  // QA department — isolated shell (like compliance), qa_manager + qa_agent.
  qa_manager:          '/qa',
  qa_agent:            '/qa',

  company_admin:       '/operations',
  operations_manager:  '/operations',

  fronter_manager:     '/fronter-manager',
  manager:             '/fronter-manager', // legacy alias

  closer_manager:      '/closer-manager',

  closer:              '/closer',
  fronter:             '/fronter',

  // External recording-portal client — isolated, no CRM surface.
  portal_client:       '/portal',
};

// ─── Hierarchy (lower number = higher authority) ─────────────────────────────
// Used by hasRoleAccess to decide if a user can access a protected route.

const ROLE_HIERARCHY = {
  superadmin:          0,
  readonly_admin:      1,
  compliance_manager:  2,
  qa_manager:          2, // QA dept lead — isolated shell, gated in hasRoleAccess
  company_admin:       3,
  operations_manager:  4,
  closer_manager:      5,
  fronter_manager:     6,
  manager:             6, // legacy alias, same level as fronter_manager
  closer:              7,
  qa_agent:            7, // QA reviewer — isolated shell, gated in hasRoleAccess
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

  // Superadmin: unrestricted. Backend already grants cross-company CRUD on every
  // resource, so let the frontend reach every shell (compliance for cross-company
  // sales/transfers/callbacks lists; manager/staff shells for inspecting a single
  // company's day-to-day flows) instead of forcing API-only access.
  if (normUser === 'superadmin') return true;

  // Read-only admin stays pinned to /admin — they have no business in shells
  // that expose write actions.
  if (normUser === 'readonlyadmin') {
    return normRequired === 'admin';
  }

  // Compliance manager: only /compliance
  if (normUser === 'compliancemanager') {
    return normRequired === 'compliancemanager';
  }

  // QA roles: only the isolated /qa shell. Both qa_manager and qa_agent land in
  // the same shell (tabs gate themselves by permission), so either QA user may
  // reach a route guarded by either QA level.
  if (normUser === 'qamanager' || normUser === 'qaagent') {
    return normRequired === 'qamanager' || normRequired === 'qaagent';
  }

  // Portal client: ONLY the recording portal — never any CRM shell.
  if (normUser === 'portalclient') {
    return normRequired === 'portalclient';
  }

  // '/admin' is a shell name, NOT a hierarchy level. superadmin + readonly_admin
  // are already allowed above; anyone reaching here for 'admin' is neither, so
  // deny — otherwise the missing hierarchy key falls back to 999 and lets every
  // role load the AdminPanel chrome.
  if (normRequired === 'admin') return false;

  // Likewise, never let an unknown required-role default to "allow". A required
  // role we don't recognise is treated as out of reach (fail closed).
  if (!(requiredRole.toLowerCase().trim() in ROLE_HIERARCHY)) return false;

  // Hierarchy check: can access routes at same or lower authority
  const userLevel     = ROLE_HIERARCHY[userRole.toLowerCase().trim()]     ?? 999;
  const requiredLevel = ROLE_HIERARCHY[requiredRole.toLowerCase().trim()];
  return userLevel <= requiredLevel;
};
