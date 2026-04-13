/**
 * Role-based routing utility
 * Maps user roles to their appropriate dashboard routes
 * Handles both underscore and non-underscore role naming conventions
 */

// Role mapping - uses database role level values as keys
export const ROLE_ROUTES = {
  // Admin roles
  superadmin: '/admin',
  super_admin: '/admin',
  readonly_admin: '/admin',
  readonlyadmin: '/admin',

  // Company/Team roles
  company_admin: '/company',
  companyadmin: '/company',

  // Specialist roles
  closer: '/closer',
  fronter: '/fronter',

  // Manager roles
  manager: '/operations',
  operations_manager: '/operations',
  operationsmanager: '/operations',
  operations: '/operations',
  closer_manager: '/closer-manager',
  closermanager: '/closer-manager',
};

// Role hierarchy - lower number = higher authority
const ROLE_HIERARCHY = {
  superadmin: 0,
  readonlyadmin: 1,
  companyadmin: 2,
  manager: 3,
  operationsmanager: 4,
  closermanager: 5,
  closer: 6,
  fronter: 7,
  operations: 8,
};

/**
 * Normalize role name by removing underscores for comparison
 * @param {string} role - The role to normalize
 * @returns {string} - Normalized role (lowercase, no underscores)
 */
export const normalizeRole = (role) => {
  if (!role) return '';
  return role.toLowerCase().trim().replace(/_/g, '');
};

/**
 * Get the appropriate dashboard route for a user role
 * @param {string} role - The user's role
 * @returns {string} - The route path for the role, defaults to /dashboard
 */
export const getRoleRoute = (role) => {
  if (!role) return '/dashboard';

  const normalizedRole = role.toLowerCase().trim();

  // Try exact match first
  if (ROLE_ROUTES[normalizedRole]) {
    return ROLE_ROUTES[normalizedRole];
  }

  // Try normalized match (without underscores)
  const normalized = normalizeRole(role);
  for (const [key, value] of Object.entries(ROLE_ROUTES)) {
    if (normalizeRole(key) === normalized) {
      return value;
    }
  }

  return '/dashboard';
};

/**
 * Check if a role has access to a specific route/required role
 * Supports hierarchy: higher authority roles can access lower authority dashboards
 * @param {string} userRole - The user's role
 * @param {string} requiredRole - The role required for the route
 * @returns {boolean} - True if user has access
 */
export const hasRoleAccess = (userRole, requiredRole) => {
  if (!requiredRole) return true; // No restriction
  if (!userRole) return false;

  const normalizedUserRole = normalizeRole(userRole);
  const normalizedRequiredRole = normalizeRole(requiredRole);

  // Exact normalized match
  if (normalizedUserRole === normalizedRequiredRole) return true;

  // SuperAdmin and ReadonlyAdmin can access ALL dashboards
  const adminRoles = ['superadmin', 'readonlyadmin'];
  if (adminRoles.includes(normalizedUserRole)) {
    return true;
  }

  // Company Admin can access company, closer, fronter, operations, closer-manager dashboards
  if (normalizedUserRole === 'companyadmin') {
    const companyAccessible = ['companyadmin', 'closer', 'fronter', 'manager', 'operationsmanager', 'closermanager', 'operations', 'admin'];
    return companyAccessible.includes(normalizedRequiredRole);
  }

  // Managers can access their subordinate dashboards
  const userLevel = ROLE_HIERARCHY[normalizedUserRole] ?? 999;
  const requiredLevel = ROLE_HIERARCHY[normalizedRequiredRole] ?? 999;
  
  // Higher authority (lower number) can access lower authority dashboards
  return userLevel <= requiredLevel;
};
