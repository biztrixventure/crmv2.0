// ============================================================================
// /audit — read-only access to the field_audit_log table populated by triggers
// from migration 063. Locked to superadmin + compliance_manager since the log
// contains every PII field change made to transfers / sales / callbacks /
// callback_numbers; rank-and-file users shouldn't see siblings' edits.
// ============================================================================

const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler }  = require('../middleware/errorHandler');
const { isSuperAdmin }  = require('../models/helpers');

const router = express.Router();

const ALLOWED_TABLES = ['transfers', 'sales', 'callbacks', 'callback_numbers'];

// Gate: superadmin OR compliance_manager only. Mirrors the compliance read
// scope so the same role hierarchy that sees sales across companies can
// inspect their audit history.
const gate = asyncHandler(async (req, res, next) => {
  if (await isSuperAdmin(req.user.id)) return next();
  if (req.user.role === 'compliance_manager') return next();
  return res.status(403).json({ error: 'Audit access requires superadmin or compliance role' });
});

router.use(gate);

// GET /audit/:table/:id — full event timeline for a single record.
router.get('/:table/:id', asyncHandler(async (req, res) => {
  const { table, id } = req.params;
  if (!ALLOWED_TABLES.includes(table)) {
    return res.status(400).json({ error: `Unknown table. Allowed: ${ALLOWED_TABLES.join(', ')}` });
  }
  const { data, error } = await supabaseAdmin
    .from('field_audit_log')
    .select('id, operation, changes, changed_by, changed_at, source')
    .eq('table_name', table)
    .eq('record_id', id)
    .order('changed_at', { ascending: false })
    .limit(500);
  if (error) return res.status(500).json({ error: error.message });

  // Hydrate actor names so the UI doesn't need a separate users lookup. One
  // batched query against user_profiles instead of N-per-row.
  const actorIds = [...new Set((data || []).map(r => r.changed_by).filter(Boolean))];
  let actorMap = {};
  if (actorIds.length) {
    const { data: actors } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, first_name, last_name')
      .in('user_id', actorIds);
    actorMap = Object.fromEntries(
      (actors || []).map(u => [u.user_id, [u.first_name, u.last_name].filter(Boolean).join(' ') || u.user_id])
    );
  }

  const enriched = (data || []).map(r => ({
    ...r,
    actor_name: r.changed_by ? (actorMap[r.changed_by] || r.changed_by) : null,
  }));
  res.json({ events: enriched });
}));

// GET /audit/by-actor/:userId — every change a given user made, newest first.
// Useful for compliance investigations ("show me everything Closer X touched
// last week"). Optional ?since=ISO and ?table= filters.
router.get('/by-actor/:userId', asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { since, table, limit = '200' } = req.query;
  let q = supabaseAdmin
    .from('field_audit_log')
    .select('table_name, record_id, operation, changes, changed_at, source')
    .eq('changed_by', userId)
    .order('changed_at', { ascending: false })
    .limit(Math.min(parseInt(limit, 10) || 200, 1000));
  if (since && !Number.isNaN(Date.parse(since))) q = q.gte('changed_at', since);
  if (table && ALLOWED_TABLES.includes(table))   q = q.eq('table_name', table);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ events: data || [] });
}));

module.exports = router;
