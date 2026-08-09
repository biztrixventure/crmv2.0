// ============================================================================
// qa2Calibration.js — /qa2/calibration[/:groupId]. A calibration group is 2+
// qa2_assignment rows sharing calibration_group_id (created via
// POST /assignments/:id/calibrate, Phase 7) — same call, independent
// reviewers, so a manager can see whether raters agree. This is a read
// surface only: acting on what it shows (flag/override/void) goes through
// qa2Evaluations.js's existing routes, never duplicated here.
//
// Viewing is broader than acting: isCompliance sees everything (view_all_
// teams command-center visibility) even without the operational toggle;
// managerAccess is still required to actually flag/override/void, enforced
// where those routes already live.
// ============================================================================

const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');
const { supabaseAdmin } = require('../config/database');
const { resolveQa2Scope } = require('../utils/qa2ScopeResolver');
const { companyInScope } = require('../utils/qa2Scope');

async function requireViewer(req, res) {
  const scope = await resolveQa2Scope(req);
  if (!scope.managerAccess && !scope.isCompliance) { res.status(403).json({ error: 'Forbidden' }); return null; }
  return scope;
}

async function reviewerNames(reviewerIds) {
  if (!reviewerIds.length) return new Map();
  const { data } = await supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', reviewerIds);
  return new Map((data || []).map(p => [p.user_id, `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown']));
}

// ── GET /qa2/calibration — one row per group, within scope ─────────────────

router.get('/calibration', asyncHandler(async (req, res) => {
  const scope = await requireViewer(req, res);
  if (!scope) return;

  const { data, error } = await supabaseAdmin
    .from('qa2_assignment')
    .select(`id, call_id, calibration_group_id, assigned_to, status,
             qa2_call(id, company_id, leg, agent_user, method_id, qa2_method(label), companies(name))`)
    .not('calibration_group_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) return res.status(500).json({ error: error.message });

  const inScope = (row) => scope.isCompliance || (scope.managerAccess && companyInScope(scope, row.qa2_call?.company_id));
  const groups = new Map();
  for (const row of (data || []).filter(inScope)) {
    const g = groups.get(row.calibration_group_id) || {
      calibration_group_id: row.calibration_group_id, call: row.qa2_call, assignment_count: 0, scored_count: 0,
    };
    g.assignment_count += 1;
    if (row.status === 'scored') g.scored_count += 1;
    groups.set(row.calibration_group_id, g);
  }
  res.json({ groups: Array.from(groups.values()) });
}));

// ── GET /qa2/calibration/:groupId — side-by-side detail ─────────────────────

router.get('/calibration/:groupId', asyncHandler(async (req, res) => {
  const scope = await requireViewer(req, res);
  if (!scope) return;
  const { groupId } = req.params;

  const { data: assignments, error } = await supabaseAdmin
    .from('qa2_assignment')
    .select(`id, call_id, assigned_to, status,
             qa2_call(id, company_id, leg, agent_user, customer_phone, call_at, method_id, qa2_method(label), companies(name))`)
    .eq('calibration_group_id', groupId);
  if (error) return res.status(500).json({ error: error.message });
  if (!assignments || !assignments.length) return res.status(404).json({ error: 'Calibration group not found' });

  const call = assignments[0].qa2_call;
  if (!scope.isCompliance && !(scope.managerAccess && companyInScope(scope, call?.company_id))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const assignmentIds = assignments.map(a => a.id);
  const { data: evaluations } = await supabaseAdmin
    .from('qa2_evaluation').select('*').in('assignment_id', assignmentIds).in('status', ['submitted', 'flagged', 'superseded']);
  const evalIds = (evaluations || []).map(e => e.id);
  const { data: answers } = evalIds.length
    ? await supabaseAdmin.from('qa2_answer').select('*').in('evaluation_id', evalIds)
    : { data: [] };
  const names = await reviewerNames([...new Set((evaluations || []).map(e => e.reviewer_id))]);

  const byAssignment = assignments.map(a => ({
    ...a,
    evaluations: (evaluations || [])
      .filter(e => e.assignment_id === a.id)
      .map(e => ({ ...e, reviewer_name: names.get(e.reviewer_id) || e.reviewer_id, answers: (answers || []).filter(x => x.evaluation_id === e.id) })),
  }));

  res.json({ calibration_group_id: groupId, call, assignments: byAssignment });
}));

module.exports = router;
