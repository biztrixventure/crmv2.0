const { supabaseAdmin } = require('../config/database');

/**
 * logActivity — fire-and-forget activity log writer.
 * Never throws; errors are printed but don't fail the caller's request.
 */
async function logActivity({ companyId, userId, action, entityType = 'transfer', entityId, oldValue, newValue, metadata }) {
  try {
    await supabaseAdmin.from('activity_logs').insert({
      company_id:  companyId  || null,
      user_id:     userId     || null,
      action,
      entity_type: entityType,
      entity_id:   entityId   || null,
      old_value:   oldValue   || null,
      new_value:   newValue,
      metadata:    metadata   || null,
    });
  } catch (err) {
    console.error('[ACTIVITY_LOG] Write failed:', err.message);
  }
}

module.exports = { logActivity };
