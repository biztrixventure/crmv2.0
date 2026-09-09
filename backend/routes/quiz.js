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

// Was 8, which made a "pick the state" or "pick the plan" question impossible.
// jsonb never had a limit of its own — this was always just the route's rule.
// 100 is past anything a real question needs and still refuses a runaway paste.
// A question with dozens of options should be a dropdown, which is what
// display_type is for (mig 279).
const MAX_OPTIONS = 100;
const MIN_OPTIONS = 2;
const DISPLAY_TYPES = ['radio', 'dropdown'];

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
    if (q.display_type && !DISPLAY_TYPES.includes(q.display_type)) return 'A question is either radio or dropdown';
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
    display_type: DISPLAY_TYPES.includes(q.display_type) ? q.display_type : 'radio',
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
      display_type: DISPLAY_TYPES.includes(q.display_type) ? q.display_type : 'radio',
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
// A quiz the creator hid (is_active=false) disappears from here entirely for
// anyone who hasn't taken it yet — but a PAST submission stays visible, since
// hiding a quiz is about stopping new attempts, not erasing someone's record.
router.get('/my/list', asyncHandler(async (req, res) => {
  const { data: attempts } = await supabaseAdmin.from('quiz_attempts')
    .select('*, quizzes(id, title, description, category, pass_threshold, time_limit_minutes, is_active)')
    .eq('user_id', req.user.id).order('created_at', { ascending: false });
  const rows = (attempts || []).filter(a => a.quizzes && (a.quizzes.is_active || a.status === 'submitted')).map(a => ({
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
// The clock starts the FIRST time this is hit and never resets — reopening the
// same attempt (tab switch, refresh, coming back later) resumes the same
// countdown rather than granting a fresh one. `seconds_remaining` is computed
// here, server-side, so the frontend never has to re-derive it from a raw
// started_at + trust its own clock; `resuming` tells it whether this is a
// fresh start or a reopen, so it can explain a near-zero timer instead of
// just letting the modal go silent.
router.get('/my/:attemptId/take', asyncHandler(async (req, res) => {
  const { data: attempt } = await supabaseAdmin.from('quiz_attempts').select('*').eq('id', req.params.attemptId).maybeSingle();
  if (!attempt || attempt.user_id !== req.user.id) return res.status(404).json({ error: 'Assignment not found' });
  if (attempt.status === 'submitted') return res.status(400).json({ error: 'You already submitted this quiz' });
  const quiz = await quizById(attempt.quiz_id);
  if (!quiz || !quiz.is_active) return res.status(400).json({ error: 'This quiz is no longer available' });

  const resuming = !!attempt.started_at;
  let startedAt = attempt.started_at;
  if (!startedAt) {
    startedAt = new Date().toISOString();
    await supabaseAdmin.from('quiz_attempts').update({ started_at: startedAt }).eq('id', attempt.id);
  }

  const { data: questions } = await supabaseAdmin.from('quiz_questions').select('id, question_text, options, display_type, points, order_index').eq('quiz_id', quiz.id).order('order_index', { ascending: true });

  let secondsRemaining = null;
  if (quiz.time_limit_minutes) {
    const elapsedSeconds = (Date.now() - new Date(startedAt).getTime()) / 1000;
    secondsRemaining = Math.max(0, Math.round(quiz.time_limit_minutes * 60 - elapsedSeconds));
  }

  res.json({ quiz, questions: questions || [], started_at: startedAt, resuming, seconds_remaining: secondsRemaining });
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

// ============================================================================
// OVERSIGHT — read-only visibility into QA-conducted quizzes.
//
// WHY THIS IS SEPARATE FROM THE MANAGE SURFACE. Manage access is
// CREATOR-BASED: canManageThisQuiz passes for the quiz's own creator,
// compliance_manager, or superadmin. Granting an operations_manager
// `quiz.manage` would therefore show them only quizzes THEY created — never
// the QA Department's, which is the entire point — and would hand them
// edit/delete/assign on top. Oversight answers a different question ("what
// happened to my agents") and gets its own gate and its own read-only routes.
//
// VISIBILITY RULE. A quiz is visible when this viewer's company owns it OR any
// member of their company was assigned it. Agent rows are ALWAYS filtered to
// their own company's members — never widened by owning the quiz.
//
// That boundary is load-bearing, not theoretical. The one quiz in production is
// owned by 1-Vertex and was assigned, by three TEAM assignments, to 40 people:
// 30 Wavetech Infomatics agents, none of them 1-Vertex members, plus 10 with no
// active company role at all. Scoping agent rows on quiz OWNERSHIP would show a
// 1-Vertex manager another company's agents question by question, answer by
// answer. So the number of people who took it is reported (a count reveals
// nothing) while the rows are only ever your own people.
// ============================================================================

// Read-only oversight, by role. operations_manager holds no quiz permission at
// all today — quiz.manage sits with company_admin, compliance_manager and
// qa_manager — so this grants sight of results without creating a write path.
const OVERSIGHT_ROLES = ['operations_manager'];
const canOversee = (req) => OVERSIGHT_ROLES.includes(req.user.role);

// PostgREST returns an EMPTY result once an .in() carries more than ~100-150
// uuids, with no error at all. Every id list below is chunked for that reason.
const IN_CHUNK = 100;
async function inChunks(ids, run) {
  const out = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) out.push(...((await run(ids.slice(i, i + IN_CHUNK))) || []));
  return out;
}

async function companyMemberIds(companyId) {
  if (!companyId) return [];
  const { data } = await supabaseAdmin
    .from('user_company_roles').select('user_id')
    .eq('company_id', companyId).eq('is_active', true);
  return [...new Set((data || []).map(r => r.user_id))];
}

// Every quiz this viewer may see: owned by their company, or taken by one of
// their members.
async function visibleQuizIds(companyId, memberIds) {
  const owned = companyId
    ? (await supabaseAdmin.from('quizzes').select('id').eq('company_id', companyId)).data || []
    : [];
  const taken = memberIds.length
    ? await inChunks(memberIds, async (chunk) =>
        (await supabaseAdmin.from('quiz_attempts').select('quiz_id').in('user_id', chunk)).data)
    : [];
  return [...new Set([...owned.map(z => z.id), ...taken.map(a => a.quiz_id)])];
}

const numOf = (v) => (v === null || v === undefined ? null : Number(v));
const avgOf = (nums) => (nums.length ? +(nums.reduce((s, n) => s + n, 0) / nums.length).toFixed(1) : null);

// ── oversight: one call for the whole panel — quiz-wise AND agent-wise ───────
router.get('/oversight/summary', asyncHandler(async (req, res) => {
  if (!canOversee(req)) return res.status(403).json({ error: 'Not allowed' });
  const companyId = req.user.company_id;
  const empty = { quizzes: [], agents: [], totals: { quizzes: 0, agents_participating: 0, submitted: 0, avg_percent: null } };
  if (!companyId) return res.json(empty);

  const memberIds = await companyMemberIds(companyId);
  const memberSet = new Set(memberIds);
  const quizIds = await visibleQuizIds(companyId, memberIds);
  if (!quizIds.length) return res.json(empty);

  const quizzes = await inChunks(quizIds, async (chunk) =>
    (await supabaseAdmin.from('quizzes')
      .select('id, title, description, category, pass_threshold, is_active, created_by, created_at, company_id')
      .in('id', chunk).order('created_at', { ascending: false })).data);

  const questions = await inChunks(quizIds, async (chunk) =>
    (await supabaseAdmin.from('quiz_questions').select('quiz_id').in('quiz_id', chunk)).data);

  // Every attempt on every visible quiz. Membership then splits my company's
  // people from everyone else: the rest contribute to a participation COUNT
  // only, never a row.
  const attempts = await inChunks(quizIds, async (chunk) =>
    (await supabaseAdmin.from('quiz_attempts')
      .select('quiz_id, user_id, status, score, total_points, percent, submitted_at')
      .in('quiz_id', chunk)).data);

  const qCount = {};
  questions.forEach(q => { qCount[q.quiz_id] = (qCount[q.quiz_id] || 0) + 1; });

  const names = await nameMap([...new Set([
    ...quizzes.map(z => z.created_by),
    ...attempts.filter(a => memberSet.has(a.user_id)).map(a => a.user_id),
  ])]);

  const thresholdOf = Object.fromEntries(quizzes.map(z => [z.id, Number(z.pass_threshold) || 0]));
  const didPass = (a) => (Number(a.percent) || 0) >= thresholdOf[a.quiz_id];

  // ── quiz-wise ─────────────────────────────────────────────────────────────
  const byQuiz = {};
  attempts.forEach(a => {
    const b = byQuiz[a.quiz_id] || (byQuiz[a.quiz_id] = { total: 0, mine: [], mineSubmitted: [] });
    b.total += 1;
    if (!memberSet.has(a.user_id)) return;
    b.mine.push(a);
    if (a.status === 'submitted') b.mineSubmitted.push(a);
  });

  const quizRows = quizzes.map(z => {
    const b = byQuiz[z.id] || { total: 0, mine: [], mineSubmitted: [] };
    const pcts = b.mineSubmitted.map(a => Number(a.percent) || 0);
    const passCount = b.mineSubmitted.filter(didPass).length;
    return {
      id: z.id,
      title: z.title,
      description: z.description,
      category: z.category,
      pass_threshold: Number(z.pass_threshold) || 0,
      is_active: z.is_active,
      created_at: z.created_at,
      created_by_name: names[z.created_by] || 'Unknown',
      // True when another company owns the quiz — an ops manager should be able
      // to tell "QA ran this at us" from "this one is ours".
      external: z.company_id !== companyId,
      question_count: qCount[z.id] || 0,
      // Participation, both ways round. participants_total counts everyone
      // assigned whatever company they are in; assigned counts only this
      // viewer's own agents. Both are shown so an empty table explains itself
      // instead of looking broken: "0 of 30 participants are in your company".
      participants_total: b.total,
      assigned: b.mine.length,
      submitted: b.mineSubmitted.length,
      pending: b.mine.length - b.mineSubmitted.length,
      avg_percent: avgOf(pcts),
      pass_count: passCount,
      fail_count: b.mineSubmitted.length - passCount,
      completion_rate: b.mine.length ? +(100 * b.mineSubmitted.length / b.mine.length).toFixed(1) : null,
    };
  });

  // ── agent-wise ────────────────────────────────────────────────────────────
  // Each of my agents with their quiz history attached, so the panel can pivot
  // by person without a second round trip.
  const titleOf = Object.fromEntries(quizzes.map(z => [z.id, z.title]));
  const byAgent = {};
  attempts.filter(a => memberSet.has(a.user_id)).forEach(a => {
    const b = byAgent[a.user_id] || (byAgent[a.user_id] = { user_id: a.user_id, rows: [] });
    b.rows.push(a);
  });

  const agentRows = Object.values(byAgent).map(b => {
    const submitted = b.rows.filter(a => a.status === 'submitted');
    const pcts = submitted.map(a => Number(a.percent) || 0);
    return {
      user_id: b.user_id,
      name: names[b.user_id] || 'Unknown',
      assigned: b.rows.length,
      submitted: submitted.length,
      pending: b.rows.length - submitted.length,
      // null, not 0, for an agent assigned a quiz they have not sat — "no score
      // yet" is not "scored zero", and a 0% would read as a failing agent.
      avg_percent: avgOf(pcts),
      best_percent: pcts.length ? Math.max(...pcts) : null,
      pass_count: submitted.filter(didPass).length,
      last_submitted_at: submitted.map(a => a.submitted_at).filter(Boolean).sort().pop() || null,
      quizzes: b.rows
        .map(a => ({
          quiz_id: a.quiz_id,
          title: titleOf[a.quiz_id] || 'Unknown quiz',
          status: a.status,
          percent: numOf(a.percent),
          score: numOf(a.score),
          total_points: numOf(a.total_points),
          pass: a.status === 'submitted' ? didPass(a) : null,
          submitted_at: a.submitted_at,
        }))
        .sort((x, y) => String(y.submitted_at || '').localeCompare(String(x.submitted_at || ''))),
    };
  }).sort((x, y) => (y.avg_percent ?? -1) - (x.avg_percent ?? -1) || y.submitted - x.submitted);

  const mineSubmitted = attempts.filter(a => memberSet.has(a.user_id) && a.status === 'submitted');
  res.json({
    quizzes: quizRows,
    agents: agentRows,
    totals: {
      quizzes: quizRows.length,
      agents_participating: agentRows.length,
      submitted: mineSubmitted.length,
      avg_percent: avgOf(mineSubmitted.map(a => Number(a.percent) || 0)),
    },
  });
}));

// ── oversight: one quiz in full — questions, correct answers, agent answers ──
router.get('/oversight/quizzes/:id', asyncHandler(async (req, res) => {
  if (!canOversee(req)) return res.status(403).json({ error: 'Not allowed' });
  const companyId = req.user.company_id;
  const quiz = await quizById(req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

  const memberIds = await companyMemberIds(companyId);
  const memberSet = new Set(memberIds);

  // The same visibility rule as the summary, re-checked here: a quiz id typed
  // into the URL must not reach further than the list would have shown.
  const mineTook = memberIds.length
    ? (await inChunks(memberIds, async (chunk) =>
        (await supabaseAdmin.from('quiz_attempts').select('user_id')
          .eq('quiz_id', quiz.id).in('user_id', chunk)).data)).length > 0
    : false;
  if (quiz.company_id !== companyId && !mineTook) return res.status(403).json({ error: 'Not allowed' });

  const { data: questions } = await supabaseAdmin.from('quiz_questions')
    .select('id, question_text, options, correct_index, points, order_index, display_type')
    .eq('quiz_id', quiz.id).order('order_index', { ascending: true });

  const { data: allAttempts } = await supabaseAdmin.from('quiz_attempts')
    .select('id, user_id, status, answers, score, total_points, percent, started_at, submitted_at, due_at')
    .eq('quiz_id', quiz.id);

  const mine = (allAttempts || []).filter(a => memberSet.has(a.user_id));
  const names = await nameMap([...mine.map(a => a.user_id), quiz.created_by]);
  const threshold = Number(quiz.pass_threshold) || 0;
  const didPass = (a) => (Number(a.percent) || 0) >= threshold;

  const rows = mine.map(a => {
    const answers = Array.isArray(a.answers) ? a.answers : [];
    return {
      attempt_id: a.id,
      user_id: a.user_id,
      user_name: names[a.user_id] || 'Unknown',
      status: a.status,
      score: numOf(a.score),
      total_points: numOf(a.total_points),
      percent: numOf(a.percent),
      pass: a.status === 'submitted' ? didPass(a) : null,
      started_at: a.started_at,
      submitted_at: a.submitted_at,
      due_at: a.due_at,
      // On the production quiz 14 of 40 attempts carry a non-empty answers
      // array while 23 are submitted — so a submitted attempt can hold a score
      // and no per-question record. The UI has to say "not recorded" rather
      // than render every question as answered wrongly.
      answers_recorded: answers.length > 0,
      answers: answers.map(x => ({ question_id: x.question_id, selected_index: Number(x.selected_index) })),
    };
  }).sort((x, y) => (y.status === 'submitted') - (x.status === 'submitted') || (y.percent ?? -1) - (x.percent ?? -1));

  const submitted = rows.filter(r => r.status === 'submitted');

  // Per-question difficulty across MY agents only. Which question the team got
  // wrong is the most actionable thing on this screen.
  const perQuestion = (questions || []).map(q => {
    const answered = submitted.filter(r => r.answers_recorded)
      .map(r => r.answers.find(x => x.question_id === q.id))
      .filter(Boolean);
    const correct = answered.filter(x => x.selected_index === q.correct_index).length;
    const chosen = {};
    answered.forEach(x => { chosen[x.selected_index] = (chosen[x.selected_index] || 0) + 1; });
    return {
      question_id: q.id,
      answered: answered.length,
      correct,
      correct_rate: answered.length ? +(100 * correct / answered.length).toFixed(1) : null,
      chosen_counts: chosen,
    };
  });

  const passCount = submitted.filter(r => r.pass).length;
  res.json({
    quiz: {
      id: quiz.id, title: quiz.title, description: quiz.description, category: quiz.category,
      pass_threshold: threshold, is_active: quiz.is_active, created_at: quiz.created_at,
      time_limit_minutes: quiz.time_limit_minutes,
      created_by_name: names[quiz.created_by] || 'Unknown',
      external: quiz.company_id !== companyId,
    },
    questions: questions || [],
    rows,
    // Top performers among my own agents.
    ranked: submitted.slice()
      .sort((x, y) => (y.percent ?? 0) - (x.percent ?? 0))
      .slice(0, 10)
      .map(r => ({
        user_id: r.user_id, user_name: r.user_name, percent: r.percent,
        score: r.score, total_points: r.total_points, submitted_at: r.submitted_at,
      })),
    per_question: perQuestion,
    summary: {
      participants_total: (allAttempts || []).length,
      assigned: rows.length,
      submitted: submitted.length,
      pending: rows.length - submitted.length,
      avg_percent: avgOf(submitted.map(r => r.percent ?? 0)),
      pass_count: passCount,
      fail_count: submitted.length - passCount,
      completion_rate: rows.length ? +(100 * submitted.length / rows.length).toFixed(1) : null,
      answers_recorded: submitted.filter(r => r.answers_recorded).length,
    },
  });
}));

module.exports = router;
