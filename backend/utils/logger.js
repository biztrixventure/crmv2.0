/**
 * Logger utility for comprehensive debugging
 * Logs all operations, errors, and database queries
 */

const LOG_LEVELS = {
  ERROR: '❌ ERROR',
  WARN: '⚠️  WARN',
  INFO: 'ℹ️  INFO',
  DEBUG: '🔍 DEBUG',
  SUCCESS: '✅ SUCCESS',
  QUERY: '📊 QUERY',
};

const logger = {
  error: (section, message, error = null) => {
    console.error(`\n${LOG_LEVELS.ERROR} [${section}] ${message}`);
    if (error) {
      console.error('  Details:', error.message || error);
      console.error('  Stack:', error.stack);
    }
  },

  warn: (section, message) => {
    console.warn(`\n${LOG_LEVELS.WARN} [${section}] ${message}`);
  },

  info: (section, message) => {
    console.log(`\n${LOG_LEVELS.INFO} [${section}] ${message}`);
  },

  debug: (section, message, data = null) => {
    console.log(`\n${LOG_LEVELS.DEBUG} [${section}] ${message}`);
    if (data) {
      console.log('  Data:', JSON.stringify(data, null, 2));
    }
  },

  success: (section, message, data = null) => {
    console.log(`\n${LOG_LEVELS.SUCCESS} [${section}] ${message}`);
    if (data) {
      console.log('  Result:', JSON.stringify(data, null, 2));
    }
  },

  query: (section, operation, table, conditions = null, error = null) => {
    if (error) {
      console.error(`\n${LOG_LEVELS.QUERY} [${section}] ${operation} ${table}`);
      console.error('  Conditions:', conditions);
      console.error('  Error:', error.message || error);
    } else {
      console.log(`\n${LOG_LEVELS.QUERY} [${section}] ${operation} ${table}`);
      if (conditions) {
        console.log('  Conditions:', JSON.stringify(conditions, null, 2));
      }
    }
  },

  request: (method, path, statusCode, message = null) => {
    const arrow = statusCode >= 200 && statusCode < 400 ? '→' : '✗';
    const status = statusCode >= 200 && statusCode < 300 ? '✅' : statusCode >= 300 && statusCode < 400 ? '🔄' : '❌';
    console.log(`${status} ${arrow} ${method.padEnd(6)} ${path.padEnd(30)} ${statusCode}${message ? ' - ' + message : ''}`);
  },

  permission: (userId, action, resource, granted, reason = null) => {
    const symbol = granted ? '✅' : '❌';
    console.log(`\n${symbol} PERMISSION [${userId}] ${action} ${resource}${reason ? ' - ' + reason : ''}`);
  },

  apiCall: (method, url, body = null, error = null) => {
    if (error) {
      console.error(`\n❌ API CALL ${method} ${url}`);
      console.error('  Error:', error.message || error);
    } else {
      console.log(`\n→ API CALL ${method} ${url}`);
      if (body) {
        console.log('  Body:', JSON.stringify(body, null, 2));
      }
    }
  },
};

module.exports = logger;
