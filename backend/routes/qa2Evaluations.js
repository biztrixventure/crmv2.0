// ============================================================================
// qa2Evaluations.js — /qa2/evaluations[/:id/*]. Raw answers are the source of
// truth (build brief 7/qa2Scoring.js header) — every PUT recomputes the score
// from qa2_answer rows via the SAME engine Phase 2 tested against v1's real
// numbers, never trusts a client-sent score.
//
// MANAGER OVERRIDE NEVER MUTATES THE AGENT'S ROW (mig 237's header). Flag
// marks the original; override creates a NEW evaluation with
// overrides_evaluation_id set, and the original becomes 'superseded' with
// superseded_by pointing forward. Both stay queryable — that comparison is
// how calibration-worthy reviewers get found.
// ============================================================================

const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');
const { supabaseAdmin } = require('../config/database');
const { resolveQa2Scope } = require('../utils/qa2ScopeResolver');
const { companyInScope, methodInScope } = require('../utils/qa2Scope');
const { computeEvaluation } = require('../utils/qa2Scoring');
const { resolveActiveFormVersion } = require('./qa2Forms');

async function requireScope(req, res) {
  const scope = await resolveQa2Scope(req);
  if (!scope.isCompliance && !scope.managerAccess && scope.role !== 'qa_agent') {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  return scope;
}

// Fetches parameters+options for a form_version and recomputes + persists
// the score onto an evaluation from its CURRENT qa2_answer rows. Called after
// every answer write so the stored score is never stale.
async function recomputeAndPersist(evaluationId, formVersionId) {
  const [{ data: version }, { data: parameters }, { data: answers }] = await Promise.all([
    supabaseAdmin.from('qa2_form_version').select('*').eq('id', formVersionId).single(),
    supabaseAdmin.from('qa2_parameter').select('*').eq('form_version_id', formVersionId),
    supabaseAdmin.from('qa2_answer').select('*').eq('evaluation_id', evaluationId),
  ]);
  const paramIds = (parameters || []).map(p => p.id);
  const { data: options } = paramIds.length
    ? await supabaseAdmin.from('qa2_parameter_option').select('*').in('parameter_id', paramIds)
    : { data: [] };

  const result = computeEvaluation({ formVersion: version, parameters: parameters || [], options: options || [], answers: answers || [] });
  const { data: updated, error } = await supabaseAdmin
    .from('qa2_evaluation')
    .update({
      base_sum: result.base_sum, base_pct: result.base_pct, penalty_total: result.penalty_total,
      final_score: result.final_score, autofail_result: result.autofail_result, result: result.result,
    })
    .eq('id', evaluationId).select().single();
  if (error) throw error;
  return updated;
}

// ── GET /qa2/evaluations/:id — full record for override/calibration review ──
// The reviewer can always re-fetch their own; a manager/compliance can fetch
// any evaluation whose call is within their scope — this is what the
// calibration comparison view and the override panel both load before
// rendering an existing evaluation's answers.

router.get('/evaluations/:id', asyncHandler(async (req, res) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  const { id } = req.params;

  const { data: evaluation } = await supabaseAdmin.from('qa2_evaluation').select('*').eq('id', id).maybeSingle();
  if (!evaluation) return res.status(404).json({ error: 'Evaluation not found' });
  const owns = evaluation.reviewer_id === req.user.id;
  const managerInScope = scope.managerAccess && companyInScope(scope, evaluation.company_id);
  if (!owns && !scope.isCompliance && !managerInScope) return res.status(403).json({ error: 'Forbidden' });

  const { data: answers, error } = await supabaseAdmin.from('qa2_answer').select('*').eq('evaluation_id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ evaluation, answers: answers || [] });
}));

// ── POST /qa2/evaluations — start a review ──────────────────────────────────

router.post('/evaluations', asyncHandler(async (req, res) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  const { assignment_id } = req.body || {};
  if (!assignment_id) return res.status(400).json({ error: 'assignment_id required' });

  const { data: assignment } = await supabaseAdmin
    .from('qa2_assignment').select('id, call_id, assigned_to, status').eq('id', assignment_id).maybeSingle();
  if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
  if (assignment.assigned_to !== req.user.id && !scope.managerAccess) return res.status(403).json({ error: 'Forbidden' });

  const { data: existing } = await supabaseAdmin
    .from('qa2_evaluation').select('id').eq('assignment_id', assignment_id).eq('reviewer_id', req.user.id).eq('status', 'draft').maybeSingle();
  if (existing) return res.json({ evaluation: existing, resumed: true });

  const { data: call } = await supabaseAdmin
    .from('qa2_call').select('id, company_id, method_id, leg, agent_user_id').eq('id', assignment.call_id).maybeSingle();
  if (!call) return res.status(404).json({ error: 'Call not found' });
  if (!call.method_id) return res.status(400).json({ error: 'This call has not been classified yet' });

  const formVersionId = await resolveActiveFormVersion(call.method_id, call.company_id);
  if (!formVersionId) return res.status(400).json({ error: 'No published scorecard for this method/company yet' });

  const now = new Date().toISOString();
  const { data: evaluation, error } = await supabaseAdmin
    .from('qa2_evaluation')
    .insert({
      call_id: call.id, assignment_id, form_version_id: formVersionId, reviewer_id: req.user.id,
      subject_user_id: call.agent_user_id, subject_role: call.leg, company_id: call.company_id,
      status: 'draft', started_at: now,
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });

  const updates = { status: 'in_review' };
  if (!assignment.opened_at) updates.opened_at = now;
  await supabaseAdmin.from('qa2_assignment').update(updates).eq('id', assignment_id);

  res.status(201).json({ evaluation });
}));

// ── PUT /qa2/evaluations/:id — autosave, returns the live computed score ───

router.put('/evaluations/:id', asyncHandler(async (req, res) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  const { id } = req.params;
  const { answers, active_seconds, overall_notes } = req.body || {};

  const { data: evaluation } = await supabaseAdmin.from('qa2_evaluation').select('*').eq('id', id).maybeSingle();
  if (!evaluation) return res.status(404).json({ error: 'Evaluation not found' });
  if (evaluation.reviewer_id !== req.user.id && !scope.managerAccess) return res.status(403).json({ error: 'Forbidden' });
  if (evaluation.status !== 'draft') return res.status(409).json({ error: 'Only a draft evaluation can be edited' });

  if (Array.isArray(answers)) {
    for (const a of answers) {
      if (!a.parameter_id) continue;
      await supabaseAdmin.from('qa2_answer').upsert({
        evaluation_id: id, parameter_id: a.parameter_id,
        value_num: a.value_num ?? null, value_text: a.value_text ?? null, value_bool: a.value_bool ?? null,
        is_na: !!a.is_na, comment: a.comment ?? null,
      }, { onConflict: 'evaluation_id,parameter_id' });
    }
  }

  const fieldUpdate = {};
  if (Number.isFinite(active_seconds)) fieldUpdate.active_seconds = active_seconds;
  if (overall_notes !== undefined) fieldUpdate.overall_notes = overall_notes;
  if (Object.keys(fieldUpdate).length) await supabaseAdmin.from('qa2_evaluation').update(fieldUpdate).eq('id', id);

  try {
    const updated = await recomputeAndPersist(id, evaluation.form_version_id);
    res.json({ evaluation: updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

// ── POST /qa2/evaluations/:id/submit ────────────────────────────────────────

router.post('/evaluations/:id/submit', asyncHandler(async (req, res) => {
  const scope = await requireScope(req, res);
  if (!scope) return;
  const { id } = req.params;

  const { data: evaluation } = await supabaseAdmin.from('qa2_evaluation').select('*').eq('id', id).maybeSingle();
  if (!evaluation) return res.status(404).json({ error: 'Evaluation not found' });
  if (evaluation.reviewer_id !== req.user.id && !scope.managerAccess) return res.status(403).json({ error: 'Forbidden' });
  if (evaluation.status !== 'draft') return res.status(409).json({ error: 'Already submitted' });

  const { data: parameters } = await supabaseAdmin.from('qa2_parameter').select('id, key, role, requires_comment').eq('form_version_id', evaluation.form_version_id);
  const { data: answers } = await supabaseAdmin.from('qa2_answer').select('*').eq('evaluation_id', id);
  const byParam = new Map((answers || []).map(a => [a.parameter_id, a]));

  const missingComment = (parameters || []).find(p => {
    if (p.requires_comment === 'never') return false;
    const a = byParam.get(p.id);
    const hasComment = a && a.comment && a.comment.trim();
    if (p.requires_comment === 'always') return !hasComment;
    // 'on_fail' — a flagged answer (autofail/penalty role, answered Yes) needs
    // a comment explaining why; a clean answer doesn't.
    if (p.requires_comment === 'on_fail' && ['autofail', 'penalty'].includes(p.role)) {
      const isYes = a && (a.value_bool === true || (a.value_text || '').toUpperCase() === 'Y');
      return isYes && !hasComment;
    }
    return false;
  });
  if (missingComment) return res.status(400).json({ error: `"${missingComment.key}" requires a comment before submitting` });

  // recomputeAndPersist commits the score fields first; the status update
  // below returns the FULL row (score fields included), so that response
  // alone is complete — no need to merge two partial snapshots.
  await recomputeAndPersist(id, evaluation.form_version_id);
  const now = new Date().toISOString();
  const { data: submitted, error } = await supabaseAdmin
    .from('qa2_evaluation').update({ status: 'submitted', submitted_at: now }).eq('id', id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  if (evaluation.assignment_id) {
    await supabaseAdmin.from('qa2_assignment').update({ status: 'scored' }).eq('id', evaluation.assignment_id);
  }
  res.json({ evaluation: submitted });
}));

// ── manager actions: flag / override / void ─────────────────────────────────

router.post('/evaluations/:id/flag', asyncHandler(async (req, res) => {
  const scope = await resolveQa2Scope(req);
  if (!scope.managerAccess) return res.status(403).json({ error: 'Forbidden' });
  const { id } = req.params;
  const { data: row, error } = await supabaseAdmin
    .from('qa2_evaluation').update({ status: 'flagged' }).eq('id', id).eq('status', 'submitted').select().maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!row) return res.status(409).json({ error: 'Only a submitted evaluation can be flagged' });
  res.json({ evaluation: row });
}));

router.post('/evaluations/:id/override', asyncHandler(async (req, res) => {
  const scope = await resolveQa2Scope(req);
  if (!scope.managerAccess) return res.status(403).json({ error: 'Forbidden' });
  const { id } = req.params;
  const { answers, overall_notes } = req.body || {};

  const { data: original } = await supabaseAdmin.from('qa2_evaluation').select('*').eq('id', id).maybeSingle();
  if (!original) return res.status(404).json({ error: 'Evaluation not found' });
  if (!['submitted', 'flagged'].includes(original.status)) return res.status(409).json({ error: 'Only a submitted or flagged evaluation can be overridden' });

  const now = new Date().toISOString();
  const { data: overriding, error } = await supabaseAdmin
    .from('qa2_evaluation')
    .insert({
      call_id: original.call_id, assignment_id: original.assignment_id, form_version_id: original.form_version_id,
      reviewer_id: req.user.id, subject_user_id: original.subject_user_id, subject_role: original.subject_role,
      company_id: original.company_id, status: 'draft', started_at: now,
      overrides_evaluation_id: original.id, overall_notes: overall_notes || null,
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });

  if (Array.isArray(answers)) {
    for (const a of answers) {
      if (!a.parameter_id) continue;
      await supabaseAdmin.from('qa2_answer').insert({
        evaluation_id: overriding.id, parameter_id: a.parameter_id,
        value_num: a.value_num ?? null, value_text: a.value_text ?? null, value_bool: a.value_bool ?? null,
        is_na: !!a.is_na, comment: a.comment ?? null,
      });
    }
  }
  await recomputeAndPersist(overriding.id, original.form_version_id);
  const { data: submitted } = await supabaseAdmin
    .from('qa2_evaluation').update({ status: 'submitted', submitted_at: now }).eq('id', overriding.id).select().single();

  await supabaseAdmin.from('qa2_evaluation').update({ status: 'superseded', superseded_by: overriding.id }).eq('id', original.id);

  res.status(201).json({ evaluation: submitted });
}));

router.post('/evaluations/:id/void', asyncHandler(async (req, res) => {
  const scope = await resolveQa2Scope(req);
  if (!scope.managerAccess) return res.status(403).json({ error: 'Forbidden' });
  const { id } = req.params;
  const { reason } = req.body || {};
  if (!reason || !reason.trim()) return res.status(400).json({ error: 'A void reason is required' });

  const { data: row, error } = await supabaseAdmin
    .from('qa2_evaluation')
    .update({ status: 'void', voided_by: req.user.id, void_reason: reason.trim() })
    .eq('id', id).select().maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!row) return res.status(404).json({ error: 'Evaluation not found' });
  res.json({ evaluation: row });
}));

module.exports = router;
