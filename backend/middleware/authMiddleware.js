const { verifyToken } = require('../config/auth');

const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }

    const token = verifyToken(authHeader);

    // Attach user info to request
    req.user = {
      id: token.sub,
      role: token.role,
      company_id: token.company_id,
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
