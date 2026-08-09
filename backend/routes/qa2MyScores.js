// ============================================================================
// qa2MyScores.js — /qa2/my-scores. Fronter/closer read-only view of their OWN
// evaluations. Deliberately does NOT use qa2ScopeResolver — qa2Scope.js's own
// header calls this out: fronter/closer have no operational scope at all,
// this route is self-scoped by subject_user_id = req.user.id instead, which
// is a tighter boundary than any permission check could add.
//
// FINAL SCORE + PASS/FAIL ONLY — never per-parameter detail or comments
// (locked-in answer to the build brief's Q7). No qa2_answer join here on
// purpose; adding one later would silently widen what this route exposes.
// ============================================================================

const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');
const { supabaseAdmin } = require('../config/database');
const { hasPermission } = require('../models/helpers');

router.get('/my-scores', asyncHandler(async (req, res) => {
  const allowed = await hasPermission(req.user.id, req.user.company_id, 'qa2.view_own_scores');
  if (!allowed) return res.status(403).json({ error: 'Forbidden' });

  const { data, error } = await supabaseAdmin
    .from('qa2_evaluation')
    .select(`id, final_score, result, submitted_at,
             qa2_call(call_at, leg, qa2_method(label), companies(name))`)
    .eq('subject_user_id', req.user.id)
    .in('status', ['submitted', 'flagged'])
    .order('submitted_at', { ascending: false })
    .limit(200);
  if (error) return res.status(500).json({ error: error.message });

  const scores = (data || []).map(e => ({
    id: e.id,
    date: e.submitted_at || e.qa2_call?.call_at || null,
    company: e.qa2_call?.companies?.name || '—',
    method: e.qa2_call?.qa2_method?.label || '—',
    leg: e.qa2_call?.leg || null,
    final_score: e.final_score,
    result: e.result,
  }));
  res.json({ scores });
}));

module.exports = router;
