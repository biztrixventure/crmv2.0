const crypto = require('crypto');

/**
 * Password Validation and Generation Utility
 * Handles password validation and secure password generation
 */

/**
 * Validate password strength
 * @param {string} password - Password to validate
 * @returns {object} { valid: boolean, error: string | null }
 */
const validatePassword = (password) => {
  if (!password || typeof password !== 'string') {
    return {
      valid: false,
      error: 'Password is required',
    };
  }

  if (password.length < 8) {
    return {
      valid: false,
      error: 'Password must be at least 8 characters',
    };
  }

  return {
    valid: true,
    error: null,
  };
};

/**
 * Generate a secure random password
 * Uses crypto module for secure random generation (not Math.random)
 * @param {number} length - Password length (default: 16)
 * @returns {string} Secure random password
 */
const generateSecurePassword = (length = 16) => {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let password = '';

  // Generate bytes and map to charset, ensuring good randomness
  const randomBytes = crypto.randomBytes(length);

  for (let i = 0; i < length; i++) {
    // Use byte value modulo charset length to distribute evenly
    password += charset[randomBytes[i] % charset.length];
  }

  return password;
};

module.exports = {
  validatePassword,
  generateSecurePassword,
};
