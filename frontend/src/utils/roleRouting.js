/**
 * Role-based routing utility
 * Maps user roles to their appropriate dashboard routes
 * Handles both underscore and non-underscore role naming conventions
 */

// Role mapping - uses database role values as keys
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
  manager: '/manager',

  // Manager roles
  operations_manager: '/operations',
  operationsmanager: '/operations',
  operations: '/operations',
  closer_manager: '/closer-manager',
  closermanager: '/closer-manager',
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
 * Check if a role has access to a specific route
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

  // Admin roles have access to all admin routes
  const adminRoles = ['superadmin', 'readonlyadmin'];
  const adminRequiredRoles = ['superadmin', 'readonlyadmin', 'admin'];

  if (adminRoles.includes(normalizedUserRole) && adminRequiredRoles.includes(normalizedRequiredRole)) {
    return true;
  }

  return false;
};

