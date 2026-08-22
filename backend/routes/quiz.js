// ============================================================================
// /api/quiz — quiz system (mig 273). compliance_manager / qa_manager /
// company_admin (+ superadmin) build MCQ quizzes and assign them to individual
// users and/or teams. Assignees get exactly one attempt, auto-graded on
// submit. Creators + the assigned team's lead see live progress.
//
// Manage surface (create/edit/delete/assign/results): gated by the
// `quiz.manage` permission, EXCEPT compliance_manager and superadmin, who
// always pass (compliance sees every company, same as the rest of its shell).
// Team-lead progress access is ownership-based (team.lead_user_id), not
// permission-gated — same pattern as GET /teams/:id/report.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const { isSuperAdmin, hasPermission, isCompanyMember } = require('../models/helpers');
const { notifyUsers } = require('../utils/notificationService');

const router = express.Router();

const MAX_OPTIONS = 8;
const MIN_OPTIONS = 2;

// A user may manage quizzes if they hold quiz.manage in their own company, or
// are compliance_manager (cross-company by role, same as the rest of the
// compliance shell), or superadmin.
async function canManageQuizzes(req) {
  if (await isSuperAdmin(req.user.id)) return true;
  if (req.user.role === 'compliance_manager') return true;
  return hasPermission(req.user.id, req.user.company_id, 'quiz.manage');
}
const isCrossCompany = (req) => req.user.role === 'compliance_manager';

async function quizById(id) {
  const { data } = await supabaseAdmin.from('quizzes').select('*').eq('id', id).maybeSingle();
  return data;
}
// Creator, compliance_manager, or superadmin may edit/delete/assign/view results for a quiz.
async function canManageThisQuiz(req, quiz) {
  if (!quiz) return false;
  if (await isSuperAdmin(req.user.id)) return true;
  if (req.user.role === 'compliance_manager') return true;
  return quiz.created_by === req.user.id;
}

function nameMapFrom(profs) {
  const out = {};
  (profs || []).forEach(p => { out[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown'; });
  return out;
}
async function nameMap(ids) {
  const uniq = [...new Set((ids || []).filter(Boolean))];
  if (!uniq.length) return {};
  const { data } = await supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', uniq);
  const out = nameMapFrom(data);
  uniq.forEach(id => { if (!out[id]) out[id] = 'Unknown'; });
  return out;
}

function validateQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) return 'At least one question is required';
  for (const q of questions) {
    if (!q.question_text || !String(q.question_text).trim()) return 'Every question needs text';
    if (!Array.isArray(q.options) || q.options.length < MIN_OPTIONS || q.options.length > MAX_OPTIONS) {
      return `Every question needs ${MIN_OPTIONS}-${MAX_OPTIONS} options`;
    }
    if (q.options.some(o => !String(o || '').trim())) return 'Options cannot be blank';
    const ci = Number(q.correct_index);
    if (!Number.isInteger(ci) || ci < 0 || ci >= q.options.length) return 'Each question needs a valid correct answer';
  }
  return null;
}

// ── manage: create ───────────────────────────────────────────────────────────
router.post('/', asyncHandler(async (req, res) => {
  if (!(await canManageQuizzes(req))) return res.status(403).json({ error: 'Not allowed to create quizzes' });
  const b = req.body || {};
  if (!b.title || !String(b.title).trim()) return res.status(400).json({ error: 'title is required' });
  const qErr = validateQuestions(b.questions);
  if (qErr) return res.status(400).json({ error: qErr });

  const { data: quiz, error } = await supabaseAdmin.from('quizzes').insert({
    company_id: req.user.company_id || null,
    title: String(b.title).slice(0, 200),
    description: b.description || null,
    category: b.category ? String(b.category).slice(0, 60) : null,
    pass_threshold: Number.isFinite(+b.pass_threshold) ? Math.min(100, Math.max(0, +b.pass_threshold)) : 70,
    time_limit_minutes: b.time_limit_minutes ? +b.time_limit_minutes : null,
    created_by: req.user.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  const rows = b.questions.map((q, i) => ({
    quiz_id: quiz.id,
    question_text: String(q.question_text).slice(0, 2000),
    options: q.options.map(o => String(o).slice(0, 500)),
    correct_index: +q.correct_index,
    points: q.points && +q.points > 0 ? +q.points : 1,
    order_index: i,
  }));
  const { error: qError } = await supabaseAdmin.from('quiz_questions').insert(rows);
  if (qError) {
    await supabaseAdmin.from('quizzes').delete().eq('id', quiz.id);
    return res.status(500).json({ error: qError.message });
  }

  logger.success('QUIZ', `Created quiz "${quiz.title}" (${rows.length} questions) by ${req.user.id}`);
  res.json({ quiz: { ...quiz, question_count: rows.length } });
}));

// ── manage: list (creator's own view — cross-company for compliance/superadmin) ──
router.get('/', asyncHandler(async (req, res) => {
  if (!(await canManageQuizzes(req))) return res.status(403).json({ error: 'Not allowed' });
  let q = supabaseAdmin.from('quizzes').select('*').order('created_at', { ascending: false });
  if (!(await isSuperAdmin(req.user.id)) && !isCrossCompany(req)) q = q.eq('created_by', req.user.id);
  const { data: quizzes, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const ids = (quizzes || []).map(z => z.id);
  const [{ data: qc }, { data: ac }] = ids.length ? await Promise.all([
    supabaseAdmin.from('quiz_questions').select('quiz_id').in('quiz_id', ids),
    supabaseAdmin.from('quiz_attempts').select('quiz_id, status, percent').in('quiz_id', ids),
  ]) : [{ data: [] }, { data: [] }];
  const qCount = {}; (qc || []).forEach(r => { qCount[r.quiz_id] = (qCount[r.quiz_id] || 0) + 1; });
  const aCount = {}, sCount = {}, percentSum = {};
  (ac || []).forEach(r => {
    aCount[r.quiz_id] = (aCount[r.quiz_id] || 0) + 1;
    if (r.status === 'submitted') {
      sCount[r.quiz_id] = (sCount[r.quiz_id] || 0) + 1;
      percentSum[r.quiz_id] = (percentSum[r.quiz_id] || 0) + (Number(r.percent) || 0);
    }
  });
  const creatorIds = [...new Set((quizzes || []).map(z => z.created_by))];
  const names = await nameMap(creatorIds);
  const decorated = (quizzes || []).map(z => ({
    ...z,
    created_by_name: names[z.created_by] || 'Unknown',
    question_count: qCount[z.id] || 0,
    assigned_count: aCount[z.id] || 0,
    submitted_count: sCount[z.id] || 0,
    avg_percent: sCount[z.id] ? +(percentSum[z.id] / sCount[z.id]).toFixed(1) : null,
  }));
  res.json({ quizzes: decorated });
}));

// ── manage: cross-quiz leaderboard — top scorers across every quiz this viewer
// can see (same visibility rule as GET /). Ranks by average %, min 1 submitted
// quiz; ties broken by attempt count. ────────────────────────────────────────
router.get('/leaderboard', asyncHandler(async (req, res) => {
  if (!(await canManageQuizzes(req))) return res.status(403).json({ error: 'Not allowed' });
  let q = supabaseAdmin.from('quizzes').select('id');
  if (!(await isSuperAdmin(req.user.id)) && !isCrossCompany(req)) q = q.eq('created_by', req.user.id);
  const { data: quizzes } = await q;
  const quizIds = (quizzes || []).map(z => z.id);
  if (!quizIds.length) return res.json({ leaderboard: [] });

  const { data: attempts } = await supabaseAdmin.from('quiz_attempts')
    .select('user_id, percent, quiz_id').in('quiz_id', quizIds).eq('status', 'submitted');
  const byUser = {};
  (attempts || []).forEach(a => {
    const u = (byUser[a.user_id] = byUser[a.user_id] || { user_id: a.user_id, count: 0, sum: 0, best: 0 });
    u.count += 1; u.sum += Number(a.percent) || 0; u.best = Math.max(u.best, Number(a.percent) || 0);
  });
  const names = await nameMap(Object.keys(byUser));
  const leaderboard = Object.values(byUser)
    .map(u => ({ user_id: u.user_id, user_name: names[u.user_id] || 'Unknown', quizzes_taken: u.count, avg_percent: +(u.sum / u.count).toFixed(1), best_percent: u.best }))
    .sort((a, b) => b.avg_percent - a.avg_percent || b.quizzes_taken - a.quizzes_taken)
    .slice(0, 25);
  res.json({ leaderboard });
}));

// ── manage: full detail (with correct answers) ───────────────────────────────
router.get('/:id', asyncHandler(async (req, res) => {
  const quiz = await quizById(req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
  if (!(await canManageThisQuiz(req, quiz))) return res.status(403).json({ error: 'Not allowed' });
  const { data: questions } = await supabaseAdmin.from('quiz_questions').select('*').eq('quiz_id', quiz.id).order('order_index', { ascending: true });
  res.json({ quiz, questions: questions || [] });
}));

// ── manage: update (meta + full question replace) ────────────────────────────
router.put('/:id', asyncHandler(async (req, res) => {
  const quiz = await quizById(req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
  if (!(await canManageThisQuiz(req, quiz))) return res.status(403).json({ error: 'Not allowed' });
  const b = req.body || {};
  const patch = { updated_at: new Date().toISOString() };
  if (b.title != null) patch.title = String(b.title).slice(0, 200);
  if (b.description !== undefined) patch.description = b.description || null;
  if (b.category !== undefined) patch.category = b.category ? String(b.category).slice(0, 60) : null;
  if (b.pass_threshold !== undefined) patch.pass_threshold = Number.isFinite(+b.pass_threshold) ? Math.min(100, Math.max(0, +b.pass_threshold)) : 70;
  if (b.time_limit_minutes !== undefined) patch.time_limit_minutes = b.time_limit_minutes ? +b.time_limit_minutes : null;
  if (b.is_active !== undefined) patch.is_active = !!b.is_active;

  if (b.questions) {
    const qErr = validateQuestions(b.questions);
    if (qErr) return res.status(400).json({ error: qErr });
    await supabaseAdmin.from('quiz_questions').delete().eq('quiz_id', quiz.id);
    const rows = b.questions.map((q, i) => ({
      quiz_id: quiz.id,
      question_text: String(q.question_text).slice(0, 2000),
      options: q.options.map(o => String(o).slice(0, 500)),
      correct_index: +q.correct_index,
      points: q.points && +q.points > 0 ? +q.points : 1,
      order_index: i,
    }));
    const { error: qError } = await supabaseAdmin.from('quiz_questions').insert(rows);
    if (qError) return res.status(500).json({ error: qError.message });
  }

  const { data, error } = await supabaseAdmin.from('quizzes').update(patch).eq('id', quiz.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ quiz: data });
}));

// ── manage: delete ────────────────────────────────────────────────────────────
router.delete('/:id', asyncHandler(async (req, res) => {
  const quiz = await quizById(req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
  if (!(await canManageThisQuiz(req, quiz))) return res.status(403).json({ error: 'Not allowed' });
  await supabaseAdmin.from('quizzes').delete().eq('id', quiz.id);   // cascades questions/assignments/attempts
  res.json({ ok: true });
}));

// ── manage: assign to users and/or teams (many-or-individual, one call) ─────
router.post('/:id/assign', asyncHandler(async (req, res) => {
  const quiz = await quizById(req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
  if (!(await canManageThisQuiz(req, quiz))) return res.status(403).json({ error: 'Not allowed' });

  const b = req.body || {};
  const userIds = Array.isArray(b.user_ids) ? [...new Set(b.user_ids.filter(Boolean))] : [];
  const teamIds = Array.isArray(b.team_ids) ? [...new Set(b.team_ids.filter(Boolean))] : [];
  if (!userIds.length && !teamIds.length) return res.status(400).json({ error: 'Pick at least one user or team' });
  const dueAt = b.due_at ? new Date(b.due_at).toISOString() : null;

  const crossCompany = isCrossCompany(req) || await isSuperAdmin(req.user.id);
  const notifyIds = new Set();
  const createdAssignments = [];

  // ── individual users ──
  for (const userId of userIds) {
    if (!crossCompany && !(await isCompanyMember(userId, req.user.company_id))) {
      return res.status(400).json({ error: 'One of the selected users is outside your company' });
    }
    const { data: assignment, error: aErr } = await supabaseAdmin.from('quiz_assignments').insert({
      quiz_id: quiz.id, assigned_by: req.user.id, target_type: 'user', target_user_id: userId, due_at: dueAt,
    }).select().single();
    if (aErr) return res.status(500).json({ error: aErr.message });
    createdAssignments.push(assignment);
    await supabaseAdmin.from('quiz_attempts').upsert(
      { assignment_id: assignment.id, quiz_id: quiz.id, user_id: userId, due_at: dueAt },
      { onConflict: 'quiz_id,user_id', ignoreDuplicates: true },
    );
    notifyIds.add(userId);
  }

  // ── teams (expand to every current member at assignment time) ──
  for (const teamId of teamIds) {
    const { data: team } = await supabaseAdmin.from('teams').select('id, company_id, name').eq('id', teamId).maybeSingle();
    if (!team) return res.status(400).json({ error: 'Team not found' });
    if (!crossCompany && team.company_id !== req.user.company_id) {
      return res.status(400).json({ error: `Team "${team.name}" is outside your company` });
    }
    const { data: assignment, error: aErr } = await supabaseAdmin.from('quiz_assignments').insert({
      quiz_id: quiz.id, assigned_by: req.user.id, target_type: 'team', target_team_id: teamId, due_at: dueAt,
    }).select().single();
    if (aErr) return res.status(500).json({ error: aErr.message });
    createdAssignments.push(assignment);

    const { data: members } = await supabaseAdmin.from('team_members').select('user_id').eq('team_id', teamId);
    const memberIds = (members || []).map(m => m.user_id);
    if (memberIds.length) {
      await supabaseAdmin.from('quiz_attempts').upsert(
        memberIds.map(uid => ({ assignment_id: assignment.id, quiz_id: quiz.id, user_id: uid, due_at: dueAt })),
        { onConflict: 'quiz_id,user_id', ignoreDuplicates: true },
      );
      memberIds.forEach(uid => notifyIds.add(uid));
    }
  }

  if (notifyIds.size) {
    notifyUsers([...notifyIds], {
      type: 'quiz_assigned', companyId: req.user.company_id,
      title: 'New quiz assigned', message: `"${quiz.title}" was assigned to you.`,
      data: { quiz_id: quiz.id }, dedupBase: `quiz_assigned_${quiz.id}`,
    }).catch(() => {});
  }

  res.json({ ok: true, assignments: createdAssignments, assignee_count: notifyIds.size });
}));

// ── manage: unassign one assignment (removes its pending attempts; keeps submitted ones for history) ──
router.delete('/:id/assignments/:assignmentId', asyncHandler(async (req, res) => {
  const quiz = await quizById(req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
  if (!(await canManageThisQuiz(req, quiz))) return res.status(403).json({ error: 'Not allowed' });
  await supabaseAdmin.from('quiz_attempts').delete().eq('assignment_id', req.params.assignmentId).eq('status', 'pending');
  await supabaseAdmin.from('quiz_assignments').delete().eq('id', req.params.assignmentId).eq('quiz_id', quiz.id);
  res.json({ ok: true });
}));

// ── manage: results / progress for a quiz ────────────────────────────────────
router.get('/:id/results', asyncHandler(async (req, res) => {
  const quiz = await quizById(req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
  if (!(await canManageThisQuiz(req, quiz))) return res.status(403).json({ error: 'Not allowed' });

  const { data: assignments } = await supabaseAdmin.from('quiz_assignments').select('*').eq('quiz_id', quiz.id).order('created_at', { ascending: false });
  const { data: attempts } = await supabaseAdmin.from('quiz_attempts').select('*').eq('quiz_id', quiz.id);
  const teamIds = [...new Set((assignments || []).filter(a => a.target_team_id).map(a => a.target_team_id))];
  const { data: teams } = teamIds.length ? await supabaseAdmin.from('teams').select('id, name').in('id', teamIds) : { data: [] };
  const teamNameOf = Object.fromEntries((teams || []).map(t => [t.id, t.name]));
  const names = await nameMap((attempts || []).map(a => a.user_id));

  const byAssignment = {};
  (attempts || []).forEach(a => { (byAssignment[a.assignment_id] = byAssignment[a.assignment_id] || []).push(a); });

  const decorated = (assignments || []).map(a => ({
    ...a,
    target_team_name: a.target_team_id ? (teamNameOf[a.target_team_id] || 'Unknown team') : null,
    target_user_name: a.target_user_id ? (names[a.target_user_id] || 'Unknown') : null,
    attempts: (byAssignment[a.id] || [])
      // submitted first (best score leading), pending trailing — reads as a
      // leaderboard within each assignment instead of insertion order.
      .slice()
      .sort((x, y) => (y.status === 'submitted') - (x.status === 'submitted') || (Number(y.percent) || -1) - (Number(x.percent) || -1))
      .map(at => ({
        user_id: at.user_id, user_name: names[at.user_id] || 'Unknown',
        status: at.status, score: at.score, total_points: at.total_points, percent: at.percent,
        pass: at.status === 'submitted' ? (Number(at.percent) || 0) >= quiz.pass_threshold : null,
        started_at: at.started_at, submitted_at: at.submitted_at, due_at: at.due_at,
      })),
  }));

  const allAttempts = attempts || [];
  const submitted = allAttempts.filter(a => a.status === 'submitted');
  const passed = submitted.filter(a => (Number(a.percent) || 0) >= quiz.pass_threshold);
  // Top scorers across the whole quiz, independent of which assignment granted
  // the attempt — the leaderboard view in the results modal.
  const ranked = submitted.slice()
    .sort((x, y) => (Number(y.percent) || 0) - (Number(x.percent) || 0))
    .slice(0, 10)
    .map(a => ({ user_id: a.user_id, user_name: names[a.user_id] || 'Unknown', percent: a.percent, score: a.score, total_points: a.total_points, submitted_at: a.submitted_at }));
  res.json({
    quiz,
    assignments: decorated,
    ranked,
    summary: {
      total_assigned: allAttempts.length,
      total_submitted: submitted.length,
      total_pending: allAttempts.length - submitted.length,
      avg_percent: submitted.length ? +(submitted.reduce((s, a) => s + (Number(a.percent) || 0), 0) / submitted.length).toFixed(1) : null,
      pass_count: passed.length,
      fail_count: submitted.length - passed.length,
    },
  });
}));

// ── team lead: progress for their own team ────────────────────────────────────
router.get('/team/:teamId/progress', asyncHandler(async (req, res) => {
  const { data: team } = await supabaseAdmin.from('teams').select('*').eq('id', req.params.teamId).maybeSingle();
  if (!team) return res.status(404).json({ error: 'Team not found' });
  const isLead = team.lead_user_id === req.user.id;
  if (!isLead && !(await canManageQuizzes(req))) return res.status(403).json({ error: 'Not allowed' });

  const { data: assignments } = await supabaseAdmin.from('quiz_assignments').select('*, quizzes(id, title, time_limit_minutes)').eq('target_team_id', team.id).order('created_at', { ascending: false });
  const assignmentIds = (assignments || []).map(a => a.id);
  const { data: attempts } = assignmentIds.length
    ? await supabaseAdmin.from('quiz_attempts').select('*').in('assignment_id', assignmentIds)
    : { data: [] };
  const names = await nameMap((attempts || []).map(a => a.user_id));
  const byAssignment = {};
  (attempts || []).forEach(a => { (byAssignment[a.assignment_id] = byAssignment[a.assignment_id] || []).push(a); });

  const decorated = (assignments || []).map(a => {
    const list = byAssignment[a.id] || [];
    const submitted = list.filter(x => x.status === 'submitted');
    return {
      assignment_id: a.id, quiz_id: a.quizzes?.id, quiz_title: a.quizzes?.title,
      due_at: a.due_at, created_at: a.created_at,
      total: list.length, submitted: submitted.length,
      avg_percent: submitted.length ? +(submitted.reduce((s, x) => s + (Number(x.percent) || 0), 0) / submitted.length).toFixed(1) : null,
      members: list.map(x => ({
        user_id: x.user_id, user_name: names[x.user_id] || 'Unknown',
        status: x.status, score: x.score, total_points: x.total_points, percent: x.percent, submitted_at: x.submitted_at,
      })),
    };
  });
  res.json({ team: { id: team.id, name: team.name }, assignments: decorated });
}));

// ── assignee: my quizzes (pending + submitted) ────────────────────────────────
router.get('/my/list', asyncHandler(async (req, res) => {
  const { data: attempts } = await supabaseAdmin.from('quiz_attempts')
    .select('*, quizzes(id, title, description, category, pass_threshold, time_limit_minutes, is_active)')
    .eq('user_id', req.user.id).order('created_at', { ascending: false });
  const rows = (attempts || []).filter(a => a.quizzes).map(a => ({
    attempt_id: a.id, quiz_id: a.quizzes.id, title: a.quizzes.title, description: a.quizzes.description,
    category: a.quizzes.category, pass_threshold: a.quizzes.pass_threshold,
    time_limit_minutes: a.quizzes.time_limit_minutes, is_active: a.quizzes.is_active,
    status: a.status, due_at: a.due_at, score: a.score, total_points: a.total_points, percent: a.percent,
    pass: a.status === 'submitted' ? (Number(a.percent) || 0) >= a.quizzes.pass_threshold : null,
    submitted_at: a.submitted_at, is_overdue: !!(a.due_at && a.status === 'pending' && new Date(a.due_at) < new Date()),
  }));
  res.json({ quizzes: rows });
}));

// ── assignee: take a quiz (questions only, no correct answers) ───────────────
router.get('/my/:attemptId/take', asyncHandler(async (req, res) => {
  const { data: attempt } = await supabaseAdmin.from('quiz_attempts').select('*').eq('id', req.params.attemptId).maybeSingle();
  if (!attempt || attempt.user_id !== req.user.id) return res.status(404).json({ error: 'Assignment not found' });
  if (attempt.status === 'submitted') return res.status(400).json({ error: 'You already submitted this quiz' });
  const quiz = await quizById(attempt.quiz_id);
  if (!quiz || !quiz.is_active) return res.status(400).json({ error: 'This quiz is no longer available' });
  if (!attempt.started_at) {
    await supabaseAdmin.from('quiz_attempts').update({ started_at: new Date().toISOString() }).eq('id', attempt.id);
  }
  const { data: questions } = await supabaseAdmin.from('quiz_questions').select('id, question_text, options, points, order_index').eq('quiz_id', quiz.id).order('order_index', { ascending: true });
  res.json({ quiz, questions: questions || [], started_at: attempt.started_at || new Date().toISOString() });
}));

// ── assignee: submit (one-time, auto-graded) ──────────────────────────────────
router.post('/my/:attemptId/submit', asyncHandler(async (req, res) => {
  const { data: attempt } = await supabaseAdmin.from('quiz_attempts').select('*').eq('id', req.params.attemptId).maybeSingle();
  if (!attempt || attempt.user_id !== req.user.id) return res.status(404).json({ error: 'Assignment not found' });
  if (attempt.status === 'submitted') return res.status(400).json({ error: 'You already submitted this quiz' });

  const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
  const { data: questions } = await supabaseAdmin.from('quiz_questions').select('id, correct_index, points').eq('quiz_id', attempt.quiz_id);
  const answerOf = Object.fromEntries(answers.map(a => [a.question_id, Number(a.selected_index)]));

  let score = 0, total = 0;
  (questions || []).forEach(q => {
    total += q.points;
    if (answerOf[q.id] === q.correct_index) score += q.points;
  });
  const percent = total > 0 ? +(100 * score / total).toFixed(1) : 0;

  const { data: updated, error } = await supabaseAdmin.from('quiz_attempts').update({
    status: 'submitted', answers, score, total_points: total, percent, submitted_at: new Date().toISOString(),
  }).eq('id', attempt.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Tell whoever assigned it — a compact single-line result, not the whole review.
  if (attempt.assignment_id) {
    const { data: assignment } = await supabaseAdmin.from('quiz_assignments').select('assigned_by').eq('id', attempt.assignment_id).maybeSingle();
    const quiz = await quizById(attempt.quiz_id);
    if (assignment?.assigned_by) {
      notifyUsers([assignment.assigned_by], {
        type: 'quiz_submitted', companyId: req.user.company_id,
        title: 'Quiz completed', message: `${req.user.email || 'A user'} scored ${percent}% on "${quiz?.title || 'a quiz'}".`,
        data: { quiz_id: attempt.quiz_id }, dedupBase: `quiz_submitted_${attempt.id}`,
      }).catch(() => {});
    }
  }

  res.json({ attempt: updated });
}));

// ── assignee: view my graded result (incl. correct answers, post-submit only) ─
router.get('/my/:attemptId/result', asyncHandler(async (req, res) => {
  const { data: attempt } = await supabaseAdmin.from('quiz_attempts').select('*').eq('id', req.params.attemptId).maybeSingle();
  if (!attempt || attempt.user_id !== req.user.id) return res.status(404).json({ error: 'Assignment not found' });
  if (attempt.status !== 'submitted') return res.status(400).json({ error: 'Not submitted yet' });
  const quiz = await quizById(attempt.quiz_id);
  const { data: questions } = await supabaseAdmin.from('quiz_questions').select('*').eq('quiz_id', attempt.quiz_id).order('order_index', { ascending: true });
  res.json({ quiz, questions: questions || [], attempt });
}));

module.exports = router;
