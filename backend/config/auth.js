const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || 'your-jwt-secret-key';

/**
 * Verify and decode JWT token from Supabase
 * @param {string} token - JWT token with or without "Bearer " prefix
 * @returns {object} Decoded token payload
 */
const verifyToken = (token) => {
  try {
    // Remove "Bearer " prefix if present
    const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;

    // Verify token - Supabase uses HS256 algorithm
    const decoded = jwt.verify(cleanToken, JWT_SECRET, {
      algorithms: ['HS256'],
    });

    return decoded;
  } catch (error) {
    throw new Error(`Token verification failed: ${error.message}`);
  }
};

/**
 * Generate a new JWT token (for testing or special cases)
 * @param {string} userId - User ID
 * @param {string} role - User role
 * @param {string} companyId - Company ID
 * @returns {string} JWT token
 */
const generateToken = (userId, role, companyId) => {
  return jwt.sign(
    {
      sub: userId,
      role,
      company_id: companyId,
      iat: Math.floor(Date.now() / 1000),
    },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '24h' }
  );
};

module.exports = { verifyToken, generateToken };
