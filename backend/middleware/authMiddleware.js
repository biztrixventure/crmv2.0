const { verifyToken } = require('../config/auth');
const { supabaseAdmin } = require('../config/database');
const logger = require('../utils/logger');

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }

    const token = verifyToken(authHeader);

    // Get user's current company and role from database
    let userRole = token.role;
    let userCompanyId = token.company_id;

    try {
      // Fetch user's active company assignment with role details
      // Don't use .single() - use normal select to avoid errors if no results
      const { data: assignments, error } = await supabaseAdmin
        .from('user_company_roles')
        .select(`
          company_id,
          custom_roles (level)
        `)
        .eq('user_id', token.sub)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1);

      if (!error && assignments && assignments.length > 0) {
        const assignment = assignments[0];
        userCompanyId = assignment.company_id;
        userRole = assignment.custom_roles?.level || token.role;
        logger.info('AUTH_MIDDLEWARE', `Resolved role for user ${token.sub}: ${userRole} in company ${userCompanyId}`);
      } else if (error) {
        logger.warn('AUTH_MIDDLEWARE', `Database query error: ${error.message}`);
      } else {
        logger.warn('AUTH_MIDDLEWARE', `No active company assignments found for user ${token.sub}`);
      }
    } catch (dbErr) {
      logger.warn('AUTH_MIDDLEWARE', `Could not fetch user role from database: ${dbErr.message}`);
      // Fall back to token role
    }

    // Attach user info to request
    req.user = {
      id: token.sub,
      role: userRole,
      company_id: userCompanyId,
      email: token.email,
      iat: token.iat,
      exp: token.exp,
    };

    next();
  } catch (error) {
    console.error('Auth middleware error:', error.message);
    return res.status(401).json({ error: 'Unauthorized', details: error.message });
  }
};

// Optional: middleware to check if user has specific role
const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Forbidden - insufficient permissions',
        required_roles: allowedRoles,
        user_role: req.user.role,
      });
    }

    next();
  };
};

module.exports = { authMiddleware, requireRole };
