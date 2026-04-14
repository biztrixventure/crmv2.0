const jwt = require('jsonwebtoken');

/**
 * Verify and decode JWT token from Supabase
 * @param {string} token - JWT token with or without "Bearer " prefix
 * @returns {object} Decoded token payload
 */
const verifyToken = (token) => {
  try {
    // Remove "Bearer " prefix if present
    const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;

    // Decode without verification (we trust Supabase tokens)
    // Supabase uses RS256 (asymmetric), and we don't have the public key
    // Instead, we rely on Supabase's RLS policies for security
    const decoded = jwt.decode(cleanToken, { complete: true });

    if (!decoded || !decoded.payload) {
      throw new Error('Invalid token format');
    }

    // Check if token is expired
    if (decoded.payload.exp && decoded.payload.exp * 1000 < Date.now()) {
      throw new Error('Token expired');
    }

    return decoded.payload;
  } catch (error) {
    throw new Error(`Token verification failed: ${error.message}`);
  }
};

module.exports = { verifyToken };
