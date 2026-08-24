// ============================================================================
// qa2Forms.js — /qa2/forms, /qa2/forms/:id/versions[/:vid], /qa2/versions/:vid,
// /qa2/versions/:vid/publish, /qa2/versions/:vid/preview-score.
//
// IMMUTABLE VERSIONS. PUT /versions/:vid only ever succeeds on a version
// with published_at IS NULL (a true draft) — this is the stricter, safer
// reading of "published versions are permanent" (build brief section 9):
// once published, the ONLY way to change a form is POST .../versions to
// clone the current version into a new draft, edit that, and publish again.
// A DB trigger backstop is intentionally NOT added here — the FK from
// qa2_evaluation.form_version_id (mig 237, NO ON DELETE clause) already
// makes a scored version impossible to delete, and the API-level draft-only
// gate is enough to keep the row itself from being mutated in place.
//
// One method has many forms; exactly one global form (company_id IS NULL)
// and, separately, one form per company may be ACTIVE per method at a time
// (mig 235's partial unique indexes). Publishing a version flips its form to
// 'active' and, if a DIFFERENT form for the same (method, company) was
// already active, archives that one — "exactly one active card" is a real
// invariant, not just advisory.
// ============================================================================

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');
const { supabaseAdmin } = require('../config/database');
const { resolveQa2Scope } = require('../utils/qa2ScopeResolver');
const { companyInScope } = require('../utils/qa2Scope');
const { computeEvaluation, maxPoints } = require('../utils/qa2Scoring');

// Which form_version an evaluation should score against for a given
// (method, company) — company-specific active form first, else the global
// one. Exported for qa2Evaluations.js (Phase 7): creating an evaluation has
// to resolve this exactly once, the same way, everywhere it happens.
async function resolveActiveFormVersion(methodId, companyId) {
  let form = null;
  if (companyId) {
    const { data } = await supabaseAdmin
      .from('qa2_form').select('id').eq('method_id', methodId).eq('company_id', companyId).eq('status', 'active').maybeSingle();
    form = data;
  }
  if (!form) {
    const { data } = await supabaseAdmin
      .from('qa2_form').select('id').eq('method_id', methodId).is('company_id', null).eq('status', 'active').maybeSingle();
    form = data;
  }
  if (!form) return null;
  const { data: version } = await supabaseAdmin
    .from('qa2_form_version').select('id').eq('form_id', form.id).eq('is_current', true).maybeSingle();
  return version?.id || null;
}

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
// Wider than requireViewer on purpose — the standalone GET /versions/:vid
// below is what the Review screen calls for ANY assignee scoring their own
// call (build brief Phase 7), not just managers/compliance browsing the
// Forms catalog. Same tier qa2Assignments.js's requireScope already grants
// a qa_agent for queue/pool/evaluations.
async function requireScoreViewer(req, res) {
  const scope = await resolveQa2Scope(req);
  if (!scope.isCompliance && !scope.managerAccess && scope.role !== 'qa_agent') { res.status(403).json({ error: 'Forbidden' }); return null; }
  return scope;
}

// ── /qa2/forms ───────────────────────────────────────────────────────────

router.get('/forms', asyncHandler(async (req, res) => {
  const scope = await requireViewer(req, res);
  if (!scope) return;
  const { method_id, company_id, status } = req.query;

  let query = supabaseAdmin
    .from('qa2_form')
    .select('id, name, method_id, company_id, status, created_by, created_at, qa2_method(label, code), companies(name)')
    .order('created_at', { ascending: false });
  if (method_id) query = query.eq('method_id', method_id);
  if (status) query = query.eq('status', status);
  if (company_id) query = query.eq('company_id', company_id);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Global forms (company_id null) are visible to any viewer; a company-scoped
  // form only to someone whose operational scope actually includes it.
  const visible = (data || []).filter(f => !f.company_id || companyInScope(scope, f.company_id));
  res.json({ forms: visible });
}));

router.post('/forms', asyncHandler(async (req, res) => {
  const scope = await requireManager(req, res);
  if (!scope) return;
  const { name, method_id, company_id } = req.body || {};
  if (!name || !method_id) return res.status(400).json({ error: 'name and method_id are required' });
  if (company_id && !companyInScope(scope, company_id)) {
    return res.status(403).json({ error: 'You are not assigned to this company' });
  }

  const { data: form, error } = await supabaseAdmin
    .from('qa2_form')
    .insert({ name, method_id, company_id: company_id || null, status: 'draft', created_by: req.user.id })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });

  // A form is useless without at least one version to build against — the
  // first one is created here so the caller can go straight to the builder.
  const { data: version, error: vErr } = await supabaseAdmin
    .from('qa2_form_version')
    .insert({ form_id: form.id, version_no: 1 })
    .select().single();
  if (vErr) return res.status(500).json({ error: vErr.message });

  res.status(201).json({ form, version });
}));

// ── /qa2/forms/:id/versions ─────────────────────────────────────────────

// List (not the full nested definition — that's GET .../versions/:vid).
// FormBuilder uses this to find the latest version_id when opening a form
// that already exists, rather than a fresh one it just created.
router.get('/forms/:id/versions', asyncHandler(async (req, res) => {
  if (!(await requireViewer(req, res))) return;
  const { id } = req.params;
  const { data, error } = await supabaseAdmin
    .from('qa2_form_version')
    .select('id, version_no, is_current, published_at')
    .eq('form_id', id)
    .order('version_no', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ versions: data || [] });
}));

router.post('/forms/:id/versions', asyncHandler(async (req, res) => {
  if (!(await requireManager(req, res))) return;
  const { id } = req.params;

  const { data: current } = await supabaseAdmin
    .from('qa2_form_version').select('*').eq('form_id', id).order('version_no', { ascending: false }).limit(1).maybeSingle();
  if (!current) return res.status(404).json({ error: 'Form has no existing version to clone' });

  const { data: newVersion, error } = await supabaseAdmin
    .from('qa2_form_version')
    .insert({
      form_id: id,
      version_no: current.version_no + 1,
      base_denominator_mode: current.base_denominator_mode,
      base_denominator: current.base_denominator,
      final_score_formula: current.final_score_formula,
      rounding_mode: current.rounding_mode,
      pass_threshold: current.pass_threshold,
      pass_comparator: current.pass_comparator,
      autofail_mode: current.autofail_mode,
      autofail_table: current.autofail_table,
    })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });

  const { data: sections } = await supabaseAdmin.from('qa2_section').select('*').eq('form_version_id', current.id);
  const sectionIdMap = new Map();
  for (const s of (sections || [])) {
    const { data: ns } = await supabaseAdmin
      .from('qa2_section').insert({ form_version_id: newVersion.id, name: s.name, sort: s.sort }).select().single();
    sectionIdMap.set(s.id, ns.id);
  }

  const { data: params } = await supabaseAdmin.from('qa2_parameter').select('*').eq('form_version_id', current.id);
  for (const p of (params || [])) {
    // lineage_id carries forward unchanged — this IS what lets reporting
    // chart one question across versions after its wording changed.
    const { id: _pid, form_version_id: _fvid, section_id, created_at, ...rest } = p;
    const { data: np } = await supabaseAdmin
      .from('qa2_parameter')
      .insert({ ...rest, form_version_id: newVersion.id, section_id: section_id ? sectionIdMap.get(section_id) || null : null })
      .select().single();

    const { data: opts } = await supabaseAdmin.from('qa2_parameter_option').select('*').eq('parameter_id', p.id);
    if (opts && opts.length) {
      await supabaseAdmin.from('qa2_parameter_option').insert(
        opts.map(o => ({ parameter_id: np.id, value: o.value, label: o.label, points: o.points, is_pass: o.is_pass, sort: o.sort }))
      );
    }
  }

  res.status(201).json({ version: newVersion });
}));

// Shared by both routes below — the nested one (validates form_id too, for
// the builder) and the standalone one (Review screen only ever has a
// form_version_id from the evaluation row, never the form's own id).
async function loadVersionDefinition(vid, formId) {
  let query = supabaseAdmin.from('qa2_form_version').select('*').eq('id', vid);
  if (formId) query = query.eq('form_id', formId);
  const { data: version, error } = await query.maybeSingle();
  if (error) throw error;
  if (!version) return null;

  const { data: sections } = await supabaseAdmin
    .from('qa2_section').select('*').eq('form_version_id', vid).order('sort', { ascending: true });
  const { data: parameters } = await supabaseAdmin
    .from('qa2_parameter').select('*').eq('form_version_id', vid).order('sort', { ascending: true });
  const paramIds = (parameters || []).map(p => p.id);
  const { data: options } = paramIds.length
    ? await supabaseAdmin.from('qa2_parameter_option').select('*').in('parameter_id', paramIds).order('sort', { ascending: true })
    : { data: [] };

  const optsByParam = new Map();
  for (const o of (options || [])) {
    if (!optsByParam.has(o.parameter_id)) optsByParam.set(o.parameter_id, []);
    optsByParam.get(o.parameter_id).push(o);
  }
  const paramsHydrated = (parameters || []).map(p => ({ ...p, options: optsByParam.get(p.id) || [] }));

  // Auto-computed true maximum — shown beside a manual base_denominator in
  // the builder so a manager can see when they're deliberately reproducing a
  // legacy quirk (like WaveTech's own 30-vs-20 divisor) versus just being
  // wrong. Same maxPoints() logic qa2Scoring.js uses for real scoring.
  const optMapForMax = new Map();
  for (const p of paramsHydrated) optMapForMax.set(p.id, new Map((p.options || []).map(o => [String(o.value), Number(o.points) || 0])));
  const computed_max = paramsHydrated
    .filter(p => p.role === 'score' && p.included_in_base !== false)
    .reduce((sum, p) => sum + maxPoints(p, optMapForMax), 0);

  // Whether the builder may still edit this version, and why not if it can't.
  // Same rule the PUT guard enforces — computed here so the UI disables the
  // controls up front instead of letting a manager retype a whole scorecard and
  // only then discover the save is refused.
  const { count: submittedCount } = await supabaseAdmin
    .from('qa2_evaluation')
    .select('id', { count: 'exact', head: true })
    .eq('form_version_id', vid)
    .eq('status', 'submitted');
  const submitted_count = submittedCount || 0;

  return {
    version, sections: sections || [], parameters: paramsHydrated, computed_max,
    submitted_count,
    editable: !version.published_at || submitted_count === 0,
  };
}

router.get('/forms/:id/versions/:vid', asyncHandler(async (req, res) => {
  if (!(await requireViewer(req, res))) return;
  const { id, vid } = req.params;
  const result = await loadVersionDefinition(vid, id);
  if (!result) return res.status(404).json({ error: 'Version not found' });
  res.json(result);
}));

// Standalone — no form_id required. The Review screen (Phase 7) only ever
// has form_version_id from the evaluation row.
router.get('/versions/:vid', asyncHandler(async (req, res) => {
  if (!(await requireScoreViewer(req, res))) return;
  const { vid } = req.params;
  const result = await loadVersionDefinition(vid, null);
  if (!result) return res.status(404).json({ error: 'Version not found' });
  res.json(result);
}));

router.put('/versions/:vid', asyncHandler(async (req, res) => {
  if (!(await requireManager(req, res))) return;
  const { vid } = req.params;

  const { data: version } = await supabaseAdmin.from('qa2_form_version').select('id, published_at').eq('id', vid).maybeSingle();
  if (!version) return res.status(404).json({ error: 'Version not found' });

  // A published version locks so a score already given keeps meaning what it
  // meant: change the questions or the points under a submitted evaluation and
  // 87/100 silently becomes a different number. That is the ONLY thing the lock
  // protects — so it only needs to bite once something has actually been scored.
  // A manager who publishes a scorecard, spots a typo in a question and has
  // nobody's review riding on it was being told to abandon the version and clone
  // a new one for no benefit: there is no history there to preserve.
  //
  // DRAFT evaluations deliberately do not count. A draft is an unfinished review
  // that is re-read against the CURRENT definition when it is reopened, so it
  // picks the edit up rather than being falsified by it.
  if (version.published_at) {
    const { count: scored, error: cErr } = await supabaseAdmin
      .from('qa2_evaluation')
      .select('id', { count: 'exact', head: true })
      .eq('form_version_id', vid)
      .eq('status', 'submitted');
    if (cErr) return res.status(500).json({ error: cErr.message });
    if (scored > 0) {
      return res.status(409).json({
        error: `This version has ${scored} submitted review${scored === 1 ? '' : 's'} scored against it, so it can no longer change — use "Edit as new version" to carry it forward.`,
      });
    }
  }

  const {
    base_denominator_mode, base_denominator, final_score_formula, rounding_mode,
    pass_threshold, pass_comparator, autofail_mode, autofail_table, sections,
  } = req.body || {};

  const settingsUpdate = {};
  if (base_denominator_mode !== undefined) settingsUpdate.base_denominator_mode = base_denominator_mode;
  if (base_denominator !== undefined) settingsUpdate.base_denominator = base_denominator;
  if (final_score_formula !== undefined) settingsUpdate.final_score_formula = final_score_formula;
  if (rounding_mode !== undefined) settingsUpdate.rounding_mode = rounding_mode;
  if (pass_threshold !== undefined) settingsUpdate.pass_threshold = pass_threshold;
  if (pass_comparator !== undefined) settingsUpdate.pass_comparator = pass_comparator;
  if (autofail_mode !== undefined) settingsUpdate.autofail_mode = autofail_mode;
  if (autofail_table !== undefined) settingsUpdate.autofail_table = autofail_table;
  if (Object.keys(settingsUpdate).length) {
    const { error } = await supabaseAdmin.from('qa2_form_version').update(settingsUpdate).eq('id', vid);
    if (error) return res.status(500).json({ error: error.message });
  }

  // Sections/parameters/options: full replace when provided. A draft version
  // has no evaluations yet by definition (publishing is what makes it
  // scoreable), so there is nothing to lose by rebuilding its structure.
  if (Array.isArray(sections)) {
    const { data: oldParams } = await supabaseAdmin.from('qa2_parameter').select('id').eq('form_version_id', vid);
    const oldParamIds = (oldParams || []).map(p => p.id);
    if (oldParamIds.length) await supabaseAdmin.from('qa2_parameter_option').delete().in('parameter_id', oldParamIds);
    await supabaseAdmin.from('qa2_parameter').delete().eq('form_version_id', vid);
    await supabaseAdmin.from('qa2_section').delete().eq('form_version_id', vid);

    for (let si = 0; si < sections.length; si++) {
      const s = sections[si];
      let sectionId = null;
      if (s.name) {
        const { data: ns } = await supabaseAdmin
          .from('qa2_section').insert({ form_version_id: vid, name: s.name, sort: s.sort ?? si }).select().single();
        sectionId = ns.id;
      }
      for (let pi = 0; pi < (s.parameters || []).length; pi++) {
        const p = s.parameters[pi];
        const { data: np, error: pErr } = await supabaseAdmin
          .from('qa2_parameter')
          .insert({
            form_version_id: vid,
            section_id: sectionId,
            lineage_id: p.lineage_id || crypto.randomUUID(), // qa2_parameter.lineage_id has NO db default (mig 235) -- new question gets a fresh identity
            key: p.key,
            label: p.label,
            input_type: p.input_type,
            role: p.role,
            points_yes: p.points_yes,
            points_no: p.points_no,
            scale_min: p.scale_min,
            scale_max: p.scale_max,
            scale_step: p.scale_step,
            penalty_value: p.penalty_value,
            allow_na: !!p.allow_na,
            included_in_base: p.included_in_base !== false,
            requires_comment: p.requires_comment || 'never',
            sort: p.sort ?? pi,
            ui: p.ui || {},
          })
          .select().single();
        if (pErr) return res.status(400).json({ error: `parameter "${p.key}": ${pErr.message}` });

        if (Array.isArray(p.options) && p.options.length) {
          const { error: oErr } = await supabaseAdmin.from('qa2_parameter_option').insert(
            p.options.map((o, oi) => ({ parameter_id: np.id, value: String(o.value), label: o.label, points: o.points, is_pass: !!o.is_pass, sort: o.sort ?? oi }))
          );
          if (oErr) return res.status(400).json({ error: `options for "${p.key}": ${oErr.message}` });
        }
      }
    }
  }

  res.json({ ok: true });
}));

router.post('/versions/:vid/publish', asyncHandler(async (req, res) => {
  if (!(await requireManager(req, res))) return;
  const { vid } = req.params;

  const { data: version } = await supabaseAdmin.from('qa2_form_version').select('*').eq('id', vid).maybeSingle();
  if (!version) return res.status(404).json({ error: 'Version not found' });
  if (version.published_at) return res.status(409).json({ error: 'Already published' });

  const { count: paramCount } = await supabaseAdmin
    .from('qa2_parameter').select('id', { count: 'exact', head: true }).eq('form_version_id', vid);
  if (!paramCount) return res.status(400).json({ error: 'Cannot publish a form with no parameters' });

  const { data: form } = await supabaseAdmin.from('qa2_form').select('id, method_id, company_id').eq('id', version.form_id).maybeSingle();
  if (!form) return res.status(404).json({ error: 'Form not found' });

  // Exactly one active form per (method, company) — demote whichever form
  // currently holds that slot (if it isn't this one) before taking it.
  let activeQuery = supabaseAdmin.from('qa2_form').select('id').eq('method_id', form.method_id).eq('status', 'active');
  activeQuery = form.company_id ? activeQuery.eq('company_id', form.company_id) : activeQuery.is('company_id', null);
  const { data: currentlyActive } = await activeQuery.maybeSingle();
  if (currentlyActive && currentlyActive.id !== form.id) {
    await supabaseAdmin.from('qa2_form').update({ status: 'archived' }).eq('id', currentlyActive.id);
  }

  await supabaseAdmin.from('qa2_form_version').update({ is_current: false }).eq('form_id', form.id).eq('is_current', true);
  const { data: published, error } = await supabaseAdmin
    .from('qa2_form_version')
    .update({ is_current: true, published_at: new Date().toISOString(), published_by: req.user.id })
    .eq('id', vid).select().single();
  if (error) return res.status(500).json({ error: error.message });

  await supabaseAdmin.from('qa2_form').update({ status: 'active' }).eq('id', form.id);
  res.json({ version: published });
}));

router.post('/versions/:vid/preview-score', asyncHandler(async (req, res) => {
  if (!(await requireViewer(req, res))) return;
  const { vid } = req.params;
  const { answers } = req.body || {};

  const { data: version } = await supabaseAdmin.from('qa2_form_version').select('*').eq('id', vid).maybeSingle();
  if (!version) return res.status(404).json({ error: 'Version not found' });
  const { data: parameters } = await supabaseAdmin.from('qa2_parameter').select('*').eq('form_version_id', vid);
  const paramIds = (parameters || []).map(p => p.id);
  const { data: options } = paramIds.length
    ? await supabaseAdmin.from('qa2_parameter_option').select('*').in('parameter_id', paramIds)
    : { data: [] };

  const result = computeEvaluation({ formVersion: version, parameters: parameters || [], options: options || [], answers: answers || [] });
  res.json({ result });
}));

module.exports = router;
module.exports.resolveActiveFormVersion = resolveActiveFormVersion;
