// Global error handling middleware
const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  const safeBody = { ...req.body };
  if (safeBody.password)     safeBody.password     = '[redacted]';
  if (safeBody.new_password) safeBody.new_password = '[redacted]';
  if (safeBody.old_password) safeBody.old_password = '[redacted]';

  const errorContext = {
    method: req.method,
    path: req.path,
    query: req.query,
    body: safeBody,
    message: err.message,
    code: err.code,
    status: err.status,
  };

  // Log the error with full context
  logger.error(`${req.method} ${req.path}`, err.message, err);
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error('ERROR CONTEXT:', JSON.stringify(errorContext, null, 2));
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Supabase errors — never forward raw Supabase messages to client
  if (err.message?.includes('Supabase') || err.status) {
    logger.error('SUPABASE', `Status ${err.status || 500}`, err);
    return res.status(err.status || 500).json({ error: 'Service error' });
  }

  // Validation errors
  if (err.array) {
    const validationErrors = err.array();
    logger.error('VALIDATION', `${validationErrors.length} validation errors`, { errors: validationErrors });
    return res.status(400).json({
      error: 'Validation failed',
      details: validationErrors,
    });
  }

  // Default error
  const statusCode = err.statusCode || 500;
  logger.error('UNHANDLED', `Status ${statusCode}`, err);
  res.status(statusCode).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
  });
};

// Async error wrapper - enhanced with logging
const asyncHandler = (fn) => (req, res, next) => {
  try {
    Promise.resolve(fn(req, res, next)).catch(err => {
      logger.error('ASYNC_HANDLER', `Caught error in ${req.method} ${req.path}`, err);
      next(err);
    });
  } catch (err) {
    logger.error('ASYNC_HANDLER', `Try-catch error in ${req.method} ${req.path}`, err);
    next(err);
  }
};

module.exports = { errorHandler, asyncHandler };
