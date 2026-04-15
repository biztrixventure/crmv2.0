/**
 * Role-based routing utility
 * Maps user role levels to their dashboard routes.
 */

export const ROLE_ROUTES = {
  // Platform admin
  superadmin:          '/admin',
  super_admin:         '/admin',
  readonly_admin:      '/admin',
  readonlyadmin:       '/admin',

  // Compliance (biztrixventure internal)
  compliance_manager:  '/compliance',
  compliancemanager:   '/compliance',

  // Company-level admin (merged → operations_manager)
  company_admin:       '/operations',
  companyadmin:        '/operations',

  // Operations Manager (was Company Manager — now has all company manager powers)
  operations_manager:  '/operations',
  operationsmanager:   '/operations',
  operations:          '/operations',

  // Fronter Manager
  manager:             '/fronter-manager',
  fronter_manager:     '/fronter-manager',
  frontermanager:      '/fronter-manager',

  // Closer Manager
  closer_manager:      '/closer-manager',
  closermanager:       '/closer-manager',

  // Floor staff
  closer:  '/closer',
  fronter: '/fronter',
};

// Role hierarchy — lower number = higher authority
const ROLE_HIERARCHY = {
  superadmin:          0,
  readonlyadmin:       1,
  compliancemanager:   2,
  companyadmin:        3,
  operationsmanager:   4,
  closermanager:       5,
  frontermanager:      6,
  manager:             6,
  closer:              7,
  fronter:             8,
};

export const normalizeRole = (role) => {
  if (!role) return '';
  return role.toLowerCase().trim().replace(/_/g, '');
};

export const getRoleRoute = (role) => {
  if (!role) return '/dashboard';
  const norm = role.toLowerCase().trim();
  if (ROLE_ROUTES[norm]) return ROLE_ROUTES[norm];
  const noUnderscore = normalizeRole(role);
  for (const [key, value] of Object.entries(ROLE_ROUTES)) {
    if (normalizeRole(key) === noUnderscore) return value;
  }
  return '/dashboard';
};

export const hasRoleAccess = (userRole, requiredRole) => {
  if (!requiredRole) return true;
  if (!userRole) return false;

  const normUser     = normalizeRole(userRole);
  const normRequired = normalizeRole(requiredRole);

  if (normUser === normRequired) return true;

  // SuperAdmin accesses everything
  if (['superadmin', 'readonlyadmin'].includes(normUser)) return true;

  // Compliance manager can only access /compliance
  if (normUser === 'compliancemanager') return normRequired === 'compliancemanager';

  // Company Admin — merged into operations_manager, same access
  if (normUser === 'companyadmin') {
    return ['companyadmin', 'operationsmanager', 'operations', 'closermanager', 'frontermanager', 'manager', 'closer', 'fronter'].includes(normRequired);
  }

  // Operations Manager: same as company admin for floor staff
  if (normUser === 'operationsmanager' || normUser === 'operations') {
    return ['operationsmanager', 'operations', 'closermanager', 'frontermanager', 'manager', 'closer', 'fronter'].includes(normRequired);
  }

  // Hierarchy-based fallback
  const userLevel     = ROLE_HIERARCHY[normUser]     ?? 999;
  const requiredLevel = ROLE_HIERARCHY[normRequired] ?? 999;
  return userLevel <= requiredLevel;
};
