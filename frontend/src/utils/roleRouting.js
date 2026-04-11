/**
 * Role-based routing utility
 * Maps user roles to their appropriate dashboard routes
 */

export const ROLE_ROUTES = {
  super_admin: '/admin',
  readonly_admin: '/admin',
  company_admin: '/company',
  closer: '/closer',
  fronter: '/fronter',
  operations_manager: '/operations',
  closer_manager: '/closer-manager',
};

/**
 * Get the appropriate dashboard route for a user role
 * @param {string} role - The user's role
 * @returns {string} - The route path for the role, defaults to /dashboard
 */
export const getRoleRoute = (role) => {
  if (!role) return '/dashboard';

  const normalizedRole = role.toLowerCase().trim();
  return ROLE_ROUTES[normalizedRole] || '/dashboard';
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

  const normalizedUserRole = userRole.toLowerCase().trim();
  const normalizedRequiredRole = requiredRole.toLowerCase().trim();

  // Exact match
  if (normalizedUserRole === normalizedRequiredRole) return true;

  // Admin roles have access to all admin routes
  if ((normalizedUserRole === 'super_admin' || normalizedUserRole === 'readonly_admin')
      && (normalizedRequiredRole === 'super_admin' || normalizedRequiredRole === 'readonly_admin' || normalizedRequiredRole === 'admin')) {
    return true;
  }

  return false;
};
