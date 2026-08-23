/**
 * Role routing â€” maps custom_role.level (from /auth/me) to shell URL.
 *
 * Hierarchy (high â†’ low authority):
 *   superadmin
 *   â””â”€â”€ readonly_admin
 *   company_admin
 *   â””â”€â”€ operations_manager
 *       â”œâ”€â”€ fronter_manager  â†’  manages fronters
 *       â”‚   â””â”€â”€ fronter
 *       â”œâ”€â”€ closer_manager   â†’  manages closers
 *       â”‚   â””â”€â”€ closer
 *       â””â”€â”€ compliance_manager
 *
 * NOTE: 'manager' is a legacy alias for fronter_manager. Kept for backward
 *       compat with existing roles that have level='manager' in the DB.
 */

// â”€â”€â”€ Shell routes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const ROLE_ROUTES = {
  superadmin:          '/admin',
  readonly_admin:      '/admin',

  compliance_manager:  '/compliance',

  // QA department â€” isolated shell (like compliance), qa_manager + qa_agent.
  qa_manager:          '/qa',
  qa_agent:            '/qa',

  company_admin:       '/operations',
  operations_manager:  '/operations',

  fronter_manager:     '/fronter-manager',
  manager:             '/fronter-manager', // legacy alias

  closer_manager:      '/closer-manager',

  closer:              '/closer',
  fronter:             '/fronter',

  // External recording-portal client â€” isolated, no CRM surface.
  // Accounting + HR (mig 290). Real role levels exist, but in practice the job
  // is done by a DESIGNATION on an existing role (module_designations), so these
  // routes matter mainly for a company that does assign the dedicated role.
  accountant:          '/accounting',
  hr_manager:          '/hr',
  employee:            '/hr',

  portal_client:       '/portal',
};

// â”€â”€â”€ Hierarchy (lower number = higher authority) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Used by hasRoleAccess to decide if a user can access a protected route.

const ROLE_HIERARCHY = {
  superadmin:          0,
  readonly_admin:      1,
  compliance_manager:  2,
  qa_manager:          2, // QA dept lead â€” isolated shell, gated in hasRoleAccess
  company_admin:       3,
  operations_manager:  4,
  accountant:          4, // Accounting module lead -- same tier as compliance_manager
  hr_manager:          4, // HR module lead -- same tier as compliance_manager
  closer_manager:      5,
  fronter_manager:     6,
  manager:             6, // legacy alias, same level as fronter_manager
  closer:              7,
  qa_agent:            7, // QA reviewer â€” isolated shell, gated in hasRoleAccess
  employee:            8, // HR-only self-service rung
  fronter:             8,
};

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
 *   - superadmin / readonly_admin â†’ only admin routes
 *   - compliance_manager          â†’ only /compliance
 *   - Everyone else               â†’ hierarchy-based (lower number â‰¥ required)
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

  // Read-only admin stays pinned to /admin â€” they have no business in shells
  // that expose write actions.
  if (normUser === 'readonlyadmin') {
    return normRequired === 'admin';
  }

  // Compliance manager: /compliance, plus the QA shell. Compliance OWNS the QA
  // department (they wire the org chart), and the role already carries every QA
  // permission the API gates on â€” view_qa_queue, view_qa_reports,
  // view_all_qa_reviews, assign_qa_tasks, manage_qa_config, override_qa_review â€”
  // so /qa was blocked here and nowhere else. They still LAND on /compliance
  // (getRoleRoute is unchanged); this only lets them reach /qa by URL. No other
  // shell opens up.
  if (normUser === 'compliancemanager') {
    return normRequired === 'compliancemanager' || normRequired === 'qamanager' || normRequired === 'qaagent';
  }

  // QA roles: only the isolated /qa shell. Both qa_manager and qa_agent land in
  // the same shell (tabs gate themselves by permission), so either QA user may
  // reach a route guarded by either QA level.
  if (normUser === 'qamanager' || normUser === 'qaagent') {
    return normRequired === 'qamanager' || normRequired === 'qaagent';
  }

  // Portal client: ONLY the recording portal â€” never any CRM shell.
  if (normUser === 'portalclient') {
    return normRequired === 'portalclient';
  }

  // '/admin' is a shell name, NOT a hierarchy level. superadmin + readonly_admin
  // are already allowed above; anyone reaching here for 'admin' is neither, so
  // deny â€” otherwise the missing hierarchy key falls back to 999 and lets every
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
