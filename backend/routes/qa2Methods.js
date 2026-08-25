// ============================================================================
// qa2Methods.js — /qa2/methods, /qa2/methods/:id/rules, /qa2/unclassified,
// /qa2/calls/:id/classify. Methods are a global catalog, fully open (any QA
// manager may create/edit — no compliance approval gate, per the locked-in
// governance decision). Edits in place; archive is the ONLY removal path —
// there is no DELETE /methods/:id at all, so a method with scored calls can
// never be lost, and nothing needs a "has this been scored" guard.
// ============================================================================

const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');
const { supabaseAdmin } = require('../config/database');
const { resolveQa2Scope } = require('../utils/qa2ScopeResolver');
const { companyInScope } = require('../utils/qa2Scope');

async function requireManager(req, res) {
  const scope = await resolveQa2Scope(req);
  if (!scope.managerAccess) { res.status(403).json({ error: 'Forbidden' }); return null; }
  return scope;
}
async function requireViewer(req, res) {
  const scope = await resolveQa2Scope(req);
  if (!scope.isCompliance && !scope.managerAccess) { res.status(403).json({ error: 'Forbidden' }); return null; }
  return scope;
}

const LEGS = ['fronter', 'closer', 'both'];
const SOURCES = ['ingest_fronter', 'ingest_closer', 'sweep'];
const MATCH_TYPES = ['any', 'exact', 'prefix', 'regex'];

// The frontend's hasPermission() only reads the static role_permissions
// array — it can't see the RUNTIME qa2_manager_access toggle (mig 232), so a
// toggled compliance_manager would have real backend authority the UI has no
// way to know about. This is how the shell asks directly instead.
router.get('/my-scope', asyncHandler(async (req, res) => {
  const scope = await resolveQa2Scope(req);
  res.json({
    role: scope.role,
    superadmin: scope.superadmin,
    isCompliance: scope.isCompliance,
    managerAccess: scope.managerAccess,
    operationalCompanyIds: scope.operationalCompanyIds,
    operationalMethodIds: scope.operationalMethodIds,
  });
}));

// ── /qa2/methods — global catalog ───────────────────────────────────────────

router.get('/methods', asyncHandler(async (req, res) => {
  if (!(await requireViewer(req, res))) return;
  const { data, error } = await supabaseAdmin
    .from('qa2_method')
    .select('id, code, label, leg, requires_transfer, is_active, archived_at, sort, created_by, created_at')
    .order('sort', { ascending: true }).order('label', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ methods: data || [] });
}));

router.post('/methods', asyncHandler(async (req, res) => {
  if (!(await requireManager(req, res))) return;
  const { code, label, leg, requires_transfer, sort } = req.body || {};
  if (!code || !label || !leg) return res.status(400).json({ error: 'code, label, and leg are required' });
  if (!LEGS.includes(leg)) return res.status(400).json({ error: `leg must be one of: ${LEGS.join(', ')}` });

  const { data: row, error } = await supabaseAdmin
    .from('qa2_method')
    .insert({
      code, label, leg,
      requires_transfer: requires_transfer === undefined ? null : requires_transfer,
      sort: Number.isFinite(+sort) ? +sort : 0,
      created_by: req.user.id,
    })
    .select().single();
  if (error) {
    if (/duplicate key|unique/i.test(error.message)) return res.status(409).json({ error: `A method with code "${code}" already exists` });
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json({ method: row });
}));

// Edits in place — qa2_call/qa2_assignment/qa2_evaluation all FK to
// method_id by id, never by name, so renaming or changing rules here never
// detaches any history. The direct fix for v1's "editing spawned a
// duplicate method" mess.
router.put('/methods/:id', asyncHandler(async (req, res) => {
  if (!(await requireManager(req, res))) return;
  const { id } = req.params;
  const { code, label, leg, requires_transfer, sort, is_active } = req.body || {};
  const updates = {};
  if (code !== undefined) updates.code = code;
  if (label !== undefined) updates.label = label;
  if (leg !== undefined) {
    if (!LEGS.includes(leg)) return res.status(400).json({ error: `leg must be one of: ${LEGS.join(', ')}` });
    updates.leg = leg;
  }
  if (requires_transfer !== undefined) updates.requires_transfer = requires_transfer;
  if (sort !== undefined) updates.sort = Number.isFinite(+sort) ? +sort : 0;
  if (is_active !== undefined) {
    updates.is_active = !!is_active;
    if (is_active) updates.archived_at = null;
  }
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });

  const { data: row, error } = await supabaseAdmin.from('qa2_method').update(updates).eq('id', id).select().maybeSingle();
  if (error) {
    if (/duplicate key|unique/i.test(error.message)) return res.status(409).json({ error: 'That code is already in use' });
    return res.status(500).json({ error: error.message });
  }
  if (!row) return res.status(404).json({ error: 'Method not found' });
  res.json({ method: row });
}));

router.post('/methods/:id/archive', asyncHandler(async (req, res) => {
  if (!(await requireManager(req, res))) return;
  const { id } = req.params;
  const { data: row, error } = await supabaseAdmin
    .from('qa2_method')
    .update({ is_active: false, archived_at: new Date().toISOString() })
    .eq('id', id).select().maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!row) return res.status(404).json({ error: 'Method not found' });
  res.json({ method: row });
}));

// ── /qa2/methods/:id/rules — classification rules ───────────────────────────

router.get('/methods/:id/rules', asyncHandler(async (req, res) => {
  if (!(await requireViewer(req, res))) return;
  const { id } = req.params;
  const { data, error } = await supabaseAdmin
    .from('qa2_method_rule')
    .select('id, method_id, source, match_type, dispo_match, priority, is_active, created_at')
    .eq('method_id', id)
    .order('priority', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ rules: data || [] });
}));

router.post('/methods/:id/rules', asyncHandler(async (req, res) => {
  if (!(await requireManager(req, res))) return;
  const { id } = req.params;
  const { source, match_type, dispo_match, priority } = req.body || {};
  if (!source || !match_type) return res.status(400).json({ error: 'source and match_type are required' });
  if (!SOURCES.includes(source)) return res.status(400).json({ error: `source must be one of: ${SOURCES.join(', ')}` });
  if (!MATCH_TYPES.includes(match_type)) return res.status(400).json({ error: `match_type must be one of: ${MATCH_TYPES.join(', ')}` });
  if (match_type !== 'any' && !dispo_match) return res.status(400).json({ error: 'dispo_match is required unless match_type is "any"' });

  const { data: row, error } = await supabaseAdmin
    .from('qa2_method_rule')
    .insert({
      method_id: id, source, match_type,
      dispo_match: match_type === 'any' ? null : dispo_match,
      priority: Number.isFinite(+priority) ? +priority : 100,
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ rule: row });
}));

router.put('/methods/:id/rules/:ruleId', asyncHandler(async (req, res) => {
  if (!(await requireManager(req, res))) return;
  const { id, ruleId } = req.params;
  const { source, match_type, dispo_match, priority, is_active } = req.body || {};
  const updates = {};
  if (source !== undefined) {
    if (!SOURCES.includes(source)) return res.status(400).json({ error: `source must be one of: ${SOURCES.join(', ')}` });
    updates.source = source;
  }
  if (match_type !== undefined) {
    if (!MATCH_TYPES.includes(match_type)) return res.status(400).json({ error: `match_type must be one of: ${MATCH_TYPES.join(', ')}` });
    updates.match_type = match_type;
  }
  if (dispo_match !== undefined) updates.dispo_match = dispo_match;
  if (priority !== undefined) updates.priority = Number.isFinite(+priority) ? +priority : 100;
  if (is_active !== undefined) updates.is_active = !!is_active;
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });

  const { data: row, error } = await supabaseAdmin
    .from('qa2_method_rule').update(updates).eq('id', ruleId).eq('method_id', id).select().maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!row) return res.status(404).json({ error: 'Rule not found' });
  res.json({ rule: row });
}));

router.delete('/methods/:id/rules/:ruleId', asyncHandler(async (req, res) => {
  if (!(await requireManager(req, res))) return;
  const { id, ruleId } = req.params;
  const { error } = await supabaseAdmin.from('qa2_method_rule').delete().eq('id', ruleId).eq('method_id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

// ── /qa2/unclassified + /qa2/calls/:id/classify ─────────────────────────────
// Zero rule matches -> a call sits here (method_id IS NULL) until a QA
// manager assigns a method or rejects it as not QA-relevant. Nothing is ever
// silently dropped (build brief section 3).
//
// REVIEWABLE ONLY. Every dialed call becomes a qa2_call row, so "matched no
// rule" describes a quarter of a million no-answers and dead-air dials — the
// pool showed 264,291 rows, 239,934 of them parked calls nobody will ever
// listen to, burying the handful that genuinely need a human decision. QA only
// ever reviews a fronter's XFER and the closer leg that follows it, so the pool
// now shows exactly that population: 363 rows, 242 of them from the last week.
// Mirrors fn_qa2_is_reviewable (mig 262) — keep the two in step.
// Ordered by when the CALL happened, not when the row was written: a swept row
// can be created days after the conversation.
router.get('/unclassified', asyncHandler(async (req, res) => {
  const scope = await requireManager(req, res);
  if (!scope) return;
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
  let query = supabaseAdmin
    .from('qa2_call')
    .select('id, box_id, company_id, leg, agent_user, customer_phone, dispo_raw, call_at, source, created_at, recording_state, transfer_id, companies(name)')
    .is('method_id', null).eq('qa_relevant', true)
    // A CRM anchor (transfer / sale) or an XFER dispo makes a call reviewable.
    // Being PAIRED to a closer leg does not: the recording-pairer links every
    // dial on a recycled lead to that lead's closer call, so the fronter's
    // A / N / CALLBK redials were flooding this tab (207 in a week) as if they
    // were transfers waiting for a method. The closer leg is the review there.
    .or('dispo_raw.ilike.xfer,transfer_id.not.is.null,sale_id.not.is.null')
    .gte('call_at', new Date(Date.now() - days * 86400000).toISOString())
    .order('call_at', { ascending: false })
    .limit(200);
  if (scope.operationalCompanyIds !== 'all') {
    if (!scope.operationalCompanyIds.length) return res.json({ calls: [] });
    query = query.in('company_id', scope.operationalCompanyIds);
  }
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ calls: data || [] });
}));

router.post('/calls/:id/classify', asyncHandler(async (req, res) => {
  const scope = await requireManager(req, res);
  if (!scope) return;
  const { id } = req.params;
  const { method_id, qa_relevant } = req.body || {};
  if (!method_id && qa_relevant === undefined) {
    return res.status(400).json({ error: 'Provide method_id to classify, or qa_relevant=false to reject' });
  }

  const { data: call } = await supabaseAdmin.from('qa2_call').select('id, company_id, method_id').eq('id', id).maybeSingle();
  if (!call) return res.status(404).json({ error: 'Call not found' });
  if (call.company_id && !companyInScope(scope, call.company_id)) {
    return res.status(403).json({ error: 'You are not assigned to this company' });
  }

  const updates = { classified_by: req.user.id, classified_at: new Date().toISOString() };
  if (method_id) updates.method_id = method_id;
  if (qa_relevant === false) { updates.qa_relevant = false; updates.method_id = null; }

  const { data: row, error } = await supabaseAdmin.from('qa2_call').update(updates).eq('id', id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ call: row });
}));

module.exports = router;
