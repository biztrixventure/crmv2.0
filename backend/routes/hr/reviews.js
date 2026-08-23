// ============================================================================
// /api/hr/reviews -- review cycles, reviews, goals and competency ratings (289).
//
// The status ladder is the whole design:
//
//   pending_self -> pending_manager -> pending_signoff -> completed
//
// Each rung belongs to a different person, and this file is what makes that
// true. A reviewer cannot write the self-assessment; an employee cannot write
// the manager section; nobody skips a rung. The transitions are checked here
// because the database cannot know who is asking.
//
// hr.reviews.participate is the self-service door: it resolves the caller
// employee record from (company_id, user_id) and only ever exposes reviews
// where they are the SUBJECT or the REVIEWER. An employee_id in the query is
// ignored on that path.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../../config/database');
const { asyncHandler } = require('../../middleware/errorHandler');
const logger = require('../../utils/logger');
const { can, deny, readCompanyId, writeCompanyId, selfEmployee } = require('../../utils/moduleAccess');

const router = express.Router();

const LADDER = ['pending_self', 'pending_manager', 'pending_signoff', 'completed'];

const reviewFull = 'id, company_id, cycle_id, employee_id, reviewer_employee_id, status, self_comments, '
  + 'manager_comments, signoff_comments, overall_rating, self_submitted_at, manager_submitted_at, '
  + 'signed_off_at, signed_off_by, completed_at, created_at, updated_at, '
  + 'hr_review_cycles(id, name, period_start, period_end, due_date, status, rating_scale_max), '
  + 'hr_employees!hr_reviews_employee_id_fkey(id, first_name, last_name, employee_no, department_id)';

const detailFull = reviewFull
  + ', hr_review_goals(id, title, description, target, weight, status, self_rating, manager_rating, self_comments, manager_comments, sort_order)'
  + ', hr_review_ratings(id, competency, self_rating, manager_rating, comments, sort_order)';

// -- Cycles ---------------------------------------------------------------------

router.get('/cycles', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ cycles: [] });
  const allowed = await can(req, companyId, 'hr.reviews.manage')
               || await can(req, companyId, 'hr.reviews.view_team')
               || await can(req, companyId, 'hr.reviews.participate');
  if (!allowed) return res.status(403).json({ error: 'Forbidden' });

  const { data, error } = await supabaseAdmin
    .from('hr_review_cycles')
    .select('id, name, period_start, period_end, due_date, status, description, rating_scale_max, created_at')
    .eq('company_id', companyId).order('period_start', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  // Progress per cycle, so the list is useful without opening each one.
  const ids = (data || []).map(c => c.id);
  let progress = {};
  if (ids.length) {
    const { data: revs } = await supabaseAdmin
      .from('hr_reviews').select('cycle_id, status').eq('company_id', companyId).in('cycle_id', ids);
    progress = (revs || []).reduce((a, r) => {
      const p = a[r.cycle_id] || (a[r.cycle_id] = { total: 0, completed: 0 });
      p.total += 1;
      if (r.status === 'completed') p.completed += 1;
      return a;
    }, {});
  }

  res.json({
    cycles: (data || []).map(c => ({ ...c, progress: progress[c.id] || { total: 0, completed: 0 } })),
    can_manage: await can(req, companyId, 'hr.reviews.manage'),
  });
}));

router.post('/cycles', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (!companyId) return res.status(400).json({ error: 'No company scope for this user' });
  if (await deny(req, res, companyId, 'hr.reviews.manage')) return;

  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name is required' });
  if (!b.period_start || !b.period_end) return res.status(400).json({ error: 'period_start and period_end are required' });
  if (b.period_end < b.period_start)    return res.status(400).json({ error: 'period_end cannot be before period_start' });

  const { data, error } = await supabaseAdmin.from('hr_review_cycles').insert({
    company_id: companyId,
    name: String(b.name).trim(),
    period_start: b.period_start,
    period_end: b.period_end,
    due_date: b.due_date || null,
    description: b.description || null,
    rating_scale_max: Number(b.rating_scale_max ?? 5),
    created_by: req.user.id,
  }).select().single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'A cycle with that name already exists' });
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json({ cycle: data });
}));

router.put('/cycles/:id', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'hr.reviews.manage')) return;

  const patch = { updated_at: new Date().toISOString() };
  for (const f of ['name', 'period_start', 'period_end', 'due_date', 'description', 'status', 'rating_scale_max']) {
    if (req.body?.[f] !== undefined) patch[f] = req.body[f];
  }
  const { data, error } = await supabaseAdmin.from('hr_review_cycles')
    .update(patch).eq('id', req.params.id).eq('company_id', companyId).select().maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Cycle not found' });
  res.json({ cycle: data });
}));

// POST /api/hr/reviews/cycles/:id/launch
// Creates one review per active employee, each pointing at that employee
// manager as reviewer. Idempotent -- an employee who already has a review in
// this cycle is skipped, so re-launching after a new hire joins does the right
// thing instead of erroring or duplicating.
router.post('/cycles/:id/launch', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'hr.reviews.manage')) return;

  const { data: cycle } = await supabaseAdmin
    .from('hr_review_cycles').select('id, name, status').eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!cycle) return res.status(404).json({ error: 'Cycle not found' });
  if (cycle.status === 'closed') return res.status(409).json({ error: 'This cycle is closed' });

  const [{ data: emps }, { data: existing }] = await Promise.all([
    supabaseAdmin.from('hr_employees').select('id, manager_employee_id')
      .eq('company_id', companyId).eq('status', 'active'),
    supabaseAdmin.from('hr_reviews').select('employee_id').eq('cycle_id', cycle.id),
  ]);
  const have = new Set((existing || []).map(r => r.employee_id));
  const only = Array.isArray(req.body?.employee_ids) ? new Set(req.body.employee_ids) : null;

  const rows = (emps || [])
    .filter(e => !have.has(e.id))
    .filter(e => !only || only.has(e.id))
    .map(e => ({
      company_id: companyId,
      cycle_id: cycle.id,
      employee_id: e.id,
      reviewer_employee_id: e.manager_employee_id || null,
      status: 'pending_self',
      created_by: req.user.id,
    }));

  if (rows.length) {
    const { error } = await supabaseAdmin.from('hr_reviews').insert(rows);
    if (error) return res.status(500).json({ error: error.message });
  }
  if (cycle.status === 'draft') {
    await supabaseAdmin.from('hr_review_cycles').update({ status: 'active', updated_at: new Date().toISOString() }).eq('id', cycle.id);
  }

  logger.info('HR', 'review cycle ' + cycle.name + ' launched: ' + rows.length + ' new review(s)');
  res.status(201).json({ created: rows.length, skipped: have.size });
}));

// -- Reviews ----------------------------------------------------------------------

// Load one review plus the caller relationship to it, in one place, because
// every write below needs exactly this.
async function loadReview(req, companyId, id) {
  const { data: review } = await supabaseAdmin
    .from('hr_reviews').select(detailFull).eq('id', id).eq('company_id', companyId).maybeSingle();
  if (!review) return { error: 'Review not found', status: 404 };

  const self = await selfEmployee(companyId, req.user.id);
  const isSubject  = !!self && review.employee_id === self.id;
  const isReviewer = !!self && review.reviewer_employee_id === self.id;
  const isManager  = await can(req, companyId, 'hr.reviews.manage');
  if (!isSubject && !isReviewer && !isManager && !(await can(req, companyId, 'hr.reviews.view_team'))) {
    return { error: 'Forbidden', status: 403 };
  }
  return { review, self, isSubject, isReviewer, isManager };
}

// GET /api/hr/reviews?cycle_id=&status=&scope=mine|team|all
router.get('/', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ reviews: [], scope: 'none' });

  const canSeeAll = await can(req, companyId, 'hr.reviews.manage')
                 || await can(req, companyId, 'hr.reviews.view_team');
  const canParticipate = await can(req, companyId, 'hr.reviews.participate');
  if (!canSeeAll && !canParticipate) return res.status(403).json({ error: 'Forbidden' });

  const self = await selfEmployee(companyId, req.user.id);
  const wantAll = canSeeAll && req.query.scope !== 'mine';

  let q = supabaseAdmin.from('hr_reviews').select(reviewFull)
    .eq('company_id', companyId).order('created_at', { ascending: false }).limit(500);
  if (req.query.cycle_id) q = q.eq('cycle_id', req.query.cycle_id);
  if (req.query.status)   q = q.eq('status', req.query.status);

  if (!wantAll) {
    if (!self) return res.json({ reviews: [], scope: 'none', my_employee_id: null });
    // Mine = reviews ABOUT me or reviews I have to write.
    q = q.or('employee_id.eq.' + self.id + ',reviewer_employee_id.eq.' + self.id);
  } else if (req.query.employee_id) {
    q = q.eq('employee_id', req.query.employee_id);
  }

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  res.json({
    reviews: (data || []).map(r => ({
      ...r,
      is_subject:  !!self && r.employee_id === self.id,
      is_reviewer: !!self && r.reviewer_employee_id === self.id,
    })),
    scope: wantAll ? 'all' : 'mine',
    my_employee_id: self?.id || null,
    can_manage: await can(req, companyId, 'hr.reviews.manage'),
  });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  const ctx = await loadReview(req, companyId, req.params.id);
  if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });

  res.json({
    review: ctx.review,
    is_subject: ctx.isSubject,
    is_reviewer: ctx.isReviewer,
    can_manage: ctx.isManager,
  });
}));

router.post('/', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (!companyId) return res.status(400).json({ error: 'No company scope for this user' });
  if (await deny(req, res, companyId, 'hr.reviews.manage')) return;

  const b = req.body || {};
  if (!b.cycle_id || !b.employee_id) return res.status(400).json({ error: 'cycle_id and employee_id are required' });

  const { data: emp } = await supabaseAdmin
    .from('hr_employees').select('id, manager_employee_id').eq('id', b.employee_id).eq('company_id', companyId).maybeSingle();
  if (!emp) return res.status(404).json({ error: 'Employee not found in this company' });

  const { data, error } = await supabaseAdmin.from('hr_reviews').insert({
    company_id: companyId,
    cycle_id: b.cycle_id,
    employee_id: emp.id,
    reviewer_employee_id: b.reviewer_employee_id || emp.manager_employee_id || null,
    status: 'pending_self',
    created_by: req.user.id,
  }).select(detailFull).single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'This employee already has a review in that cycle' });
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json({ review: data });
}));

// PUT /api/hr/reviews/:id -- the manager reassigning a reviewer, etc.
router.put('/:id', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'hr.reviews.manage')) return;

  const patch = { updated_at: new Date().toISOString() };
  for (const f of ['reviewer_employee_id', 'overall_rating']) if (req.body?.[f] !== undefined) patch[f] = req.body[f];
  // Status is moved by the transition endpoints below, never set directly --
  // that is what keeps the ladder meaningful.
  const { data, error } = await supabaseAdmin.from('hr_reviews')
    .update(patch).eq('id', req.params.id).eq('company_id', companyId).select(detailFull).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Review not found' });
  res.json({ review: data });
}));

// POST /api/hr/reviews/:id/self -- the SUBJECT writes their self-assessment and
// hands the review to their reviewer. pending_self -> pending_manager.
router.post('/:id/self', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'hr.reviews.participate')) return;

  const ctx = await loadReview(req, companyId, req.params.id);
  if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
  if (!ctx.isSubject) return res.status(403).json({ error: 'Only the person being reviewed can write the self-assessment' });
  if (ctx.review.status !== 'pending_self') {
    return res.status(409).json({ error: 'This review has already moved past the self-assessment (' + ctx.review.status + ')' });
  }

  const now = new Date().toISOString();
  const submit = req.body?.submit !== false;   // save-as-draft with submit:false
  const patch = { self_comments: req.body?.self_comments ?? ctx.review.self_comments, updated_at: now };
  if (submit) { patch.status = 'pending_manager'; patch.self_submitted_at = now; }

  const { error } = await supabaseAdmin.from('hr_reviews').update(patch).eq('id', ctx.review.id);
  if (error) return res.status(500).json({ error: error.message });

  // Self ratings on goals and competencies come along with the submission.
  await applyRatings(req.body, companyId, ctx.review.id, 'self');

  const { data: fresh } = await supabaseAdmin.from('hr_reviews').select(detailFull).eq('id', ctx.review.id).single();
  res.json({ review: fresh });
}));

// POST /api/hr/reviews/:id/manager -- the REVIEWER writes their section.
// pending_manager -> pending_signoff.
router.post('/:id/manager', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  const ctx = await loadReview(req, companyId, req.params.id);
  if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
  if (!ctx.isReviewer && !ctx.isManager) {
    return res.status(403).json({ error: 'Only the assigned reviewer can write the manager section' });
  }
  if (ctx.isSubject && !ctx.isManager) {
    return res.status(403).json({ error: 'You cannot write the manager section of your own review' });
  }
  if (ctx.review.status !== 'pending_manager') {
    return res.status(409).json({ error: 'This review is ' + ctx.review.status + ', not awaiting the manager' });
  }

  const now = new Date().toISOString();
  const submit = req.body?.submit !== false;
  const patch = {
    manager_comments: req.body?.manager_comments ?? ctx.review.manager_comments,
    updated_at: now,
  };
  if (req.body?.overall_rating !== undefined) patch.overall_rating = req.body.overall_rating;
  if (submit) { patch.status = 'pending_signoff'; patch.manager_submitted_at = now; }

  const { error } = await supabaseAdmin.from('hr_reviews').update(patch).eq('id', ctx.review.id);
  if (error) return res.status(500).json({ error: error.message });

  await applyRatings(req.body, companyId, ctx.review.id, 'manager');

  const { data: fresh } = await supabaseAdmin.from('hr_reviews').select(detailFull).eq('id', ctx.review.id).single();
  res.json({ review: fresh });
}));

// POST /api/hr/reviews/:id/signoff -- the SUBJECT acknowledges.
// pending_signoff -> completed.
router.post('/:id/signoff', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'hr.reviews.participate')) return;

  const ctx = await loadReview(req, companyId, req.params.id);
  if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
  if (!ctx.isSubject && !ctx.isManager) {
    return res.status(403).json({ error: 'Only the person being reviewed signs off on it' });
  }
  if (ctx.review.status !== 'pending_signoff') {
    return res.status(409).json({ error: 'This review is ' + ctx.review.status + ', not awaiting sign-off' });
  }

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('hr_reviews').update({
    status: 'completed',
    signoff_comments: req.body?.signoff_comments || null,
    signed_off_at: now, signed_off_by: req.user.id,
    completed_at: now, updated_at: now,
  }).eq('id', ctx.review.id).select(detailFull).single();
  if (error) return res.status(500).json({ error: error.message });

  logger.info('HR', 'review ' + ctx.review.id + ' completed');
  res.json({ review: data });
}));

// POST /api/hr/reviews/:id/reopen -- an HR manager sends a review back one rung.
// Deliberately one rung, not "to any status": jumping a completed review
// straight back to pending_self would throw away the manager section with no
// trace of who did it.
router.post('/:id/reopen', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'hr.reviews.manage')) return;

  const { data: review } = await supabaseAdmin
    .from('hr_reviews').select('id, status').eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!review) return res.status(404).json({ error: 'Review not found' });

  const idx = LADDER.indexOf(review.status);
  if (idx <= 0) return res.status(409).json({ error: 'This review is already at the first step' });
  const back = LADDER[idx - 1];

  const patch = { status: back, updated_at: new Date().toISOString() };
  if (back === 'pending_signoff') { patch.completed_at = null; patch.signed_off_at = null; patch.signed_off_by = null; }
  if (back === 'pending_manager') { patch.manager_submitted_at = null; }
  if (back === 'pending_self')    { patch.self_submitted_at = null; }

  const { data, error } = await supabaseAdmin.from('hr_reviews').update(patch).eq('id', review.id).select(detailFull).single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ review: data, moved_to: back });
}));

// -- Goals ------------------------------------------------------------------------

router.post('/:id/goals', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  const ctx = await loadReview(req, companyId, req.params.id);
  if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
  if (!ctx.isSubject && !ctx.isReviewer && !ctx.isManager) return res.status(403).json({ error: 'Forbidden' });
  if (ctx.review.status === 'completed') return res.status(409).json({ error: 'This review is completed' });

  if (!req.body?.title) return res.status(400).json({ error: 'title is required' });
  const { data, error } = await supabaseAdmin.from('hr_review_goals').insert({
    company_id: companyId,
    review_id: ctx.review.id,
    title: String(req.body.title).trim(),
    description: req.body.description || null,
    target: req.body.target || null,
    weight: Number(req.body.weight ?? 0),
    sort_order: Number(req.body.sort_order ?? 0),
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ goal: data });
}));

router.put('/goals/:goalId', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  const { data: goal } = await supabaseAdmin
    .from('hr_review_goals').select('id, review_id').eq('id', req.params.goalId).eq('company_id', companyId).maybeSingle();
  if (!goal) return res.status(404).json({ error: 'Goal not found' });

  const ctx = await loadReview(req, companyId, goal.review_id);
  if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });

  const patch = { updated_at: new Date().toISOString() };
  for (const f of ['title', 'description', 'target', 'weight', 'status', 'sort_order']) {
    if (req.body?.[f] !== undefined) patch[f] = req.body[f];
  }
  // Each side writes only its own column. This is the goal-level version of the
  // ladder, and it is why a manager cannot quietly rewrite a self-rating.
  if (req.body?.self_rating !== undefined) {
    if (!ctx.isSubject && !ctx.isManager) return res.status(403).json({ error: 'Only the reviewee sets the self rating' });
    patch.self_rating = req.body.self_rating;
  }
  if (req.body?.self_comments !== undefined) {
    if (!ctx.isSubject && !ctx.isManager) return res.status(403).json({ error: 'Only the reviewee writes the self comments' });
    patch.self_comments = req.body.self_comments;
  }
  if (req.body?.manager_rating !== undefined) {
    if (!ctx.isReviewer && !ctx.isManager) return res.status(403).json({ error: 'Only the reviewer sets the manager rating' });
    patch.manager_rating = req.body.manager_rating;
  }
  if (req.body?.manager_comments !== undefined) {
    if (!ctx.isReviewer && !ctx.isManager) return res.status(403).json({ error: 'Only the reviewer writes the manager comments' });
    patch.manager_comments = req.body.manager_comments;
  }

  const { data, error } = await supabaseAdmin.from('hr_review_goals').update(patch).eq('id', goal.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ goal: data });
}));

router.delete('/goals/:goalId', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  const { data: goal } = await supabaseAdmin
    .from('hr_review_goals').select('id, review_id').eq('id', req.params.goalId).eq('company_id', companyId).maybeSingle();
  if (!goal) return res.status(404).json({ error: 'Goal not found' });
  const ctx = await loadReview(req, companyId, goal.review_id);
  if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
  if (!ctx.isReviewer && !ctx.isManager && !ctx.isSubject) return res.status(403).json({ error: 'Forbidden' });

  const { error } = await supabaseAdmin.from('hr_review_goals').delete().eq('id', goal.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

// -- Competency ratings --------------------------------------------------------------

router.post('/:id/ratings', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  const ctx = await loadReview(req, companyId, req.params.id);
  if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
  if (!ctx.isSubject && !ctx.isReviewer && !ctx.isManager) return res.status(403).json({ error: 'Forbidden' });
  if (!req.body?.competency) return res.status(400).json({ error: 'competency is required' });

  const { data, error } = await supabaseAdmin.from('hr_review_ratings').upsert({
    company_id: companyId,
    review_id: ctx.review.id,
    competency: String(req.body.competency).trim(),
    sort_order: Number(req.body.sort_order ?? 0),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'review_id,competency' }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ rating: data });
}));

router.put('/ratings/:ratingId', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  const { data: rating } = await supabaseAdmin
    .from('hr_review_ratings').select('id, review_id').eq('id', req.params.ratingId).eq('company_id', companyId).maybeSingle();
  if (!rating) return res.status(404).json({ error: 'Rating not found' });

  const ctx = await loadReview(req, companyId, rating.review_id);
  if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });

  const patch = { updated_at: new Date().toISOString() };
  if (req.body?.competency !== undefined) patch.competency = req.body.competency;
  if (req.body?.comments !== undefined)   patch.comments = req.body.comments;
  if (req.body?.self_rating !== undefined) {
    if (!ctx.isSubject && !ctx.isManager) return res.status(403).json({ error: 'Only the reviewee sets the self rating' });
    patch.self_rating = req.body.self_rating;
  }
  if (req.body?.manager_rating !== undefined) {
    if (!ctx.isReviewer && !ctx.isManager) return res.status(403).json({ error: 'Only the reviewer sets the manager rating' });
    patch.manager_rating = req.body.manager_rating;
  }

  const { data, error } = await supabaseAdmin.from('hr_review_ratings').update(patch).eq('id', rating.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ rating: data });
}));

router.delete('/ratings/:ratingId', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'hr.reviews.manage')) return;
  const { error } = await supabaseAdmin
    .from('hr_review_ratings').delete().eq('id', req.params.ratingId).eq('company_id', companyId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

// Bulk-apply the ratings that arrive alongside a self or manager submission.
// side is 'self' or 'manager' and decides WHICH column is written -- the caller
// cannot choose, which is what stops one side overwriting the other.
async function applyRatings(body, companyId, reviewId, side) {
  const col = side === 'self' ? 'self_rating' : 'manager_rating';
  const commentCol = side === 'self' ? 'self_comments' : 'manager_comments';

  for (const g of (Array.isArray(body?.goals) ? body.goals : [])) {
    if (!g?.id) continue;
    const patch = { updated_at: new Date().toISOString() };
    if (g.rating !== undefined)   patch[col] = g.rating;
    if (g.comments !== undefined) patch[commentCol] = g.comments;
    if (side === 'manager' && g.status !== undefined) patch.status = g.status;
    if (Object.keys(patch).length > 1) {
      await supabaseAdmin.from('hr_review_goals').update(patch).eq('id', g.id).eq('company_id', companyId);
    }
  }

  for (const r of (Array.isArray(body?.ratings) ? body.ratings : [])) {
    if (!r?.competency) continue;
    await supabaseAdmin.from('hr_review_ratings').upsert({
      company_id: companyId,
      review_id: reviewId,
      competency: String(r.competency).trim(),
      [col]: r.rating ?? null,
      sort_order: Number(r.sort_order ?? 0),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'review_id,competency' });
  }
}

module.exports = router;
