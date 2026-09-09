// ============================================================================
// /api/daily-performance — review a day's numbers and FINALISE them (mig 310).
//
// Two scopes, two audiences:
//   scope='company'  the whole project for a day, every team plus anyone on no
//                    team. Operations manager / company admin.
//   scope='team'     one team's day. That team's LEAD (teams.lead_user_id); a
//                    manager may finalise any team in their company.
//
// A lock stores a SNAPSHOT (utils/dailyPerformance). Sales and transfers stay
// editable afterwards — a late correction is legitimate — so the frozen figure
// and the live figure are both kept and can be compared. Without the snapshot a
// "finalised" number would keep drifting and the history would mean nothing.
//
// UNLOCK is manager-only, by decision: a finalise a team lead can undo on their
// own is not a finalise. Unlock is soft — the row keeps unlocked_by/unlocked_at
// so "signed off, then reopened by X" survives, and the day can be relocked
// (the unique indexes are partial on unlocked_at IS NULL).
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const { isSuperAdmin } = require('../models/helpers');
const { resolveTeamMemberIds } = require('../utils/teamMetrics');
const { dailyPerformance } = require('../utils/dailyPerformance');
const { todayEt } = require('../utils/etUtils');

const router = express.Router();

// The roles that own the whole project's day. Same pair routes/teams.js treats
// as team managers, so "who can manage teams" and "who can sign off the
// project's day" cannot drift apart.
const MANAGER_LEVELS = ['company_admin', 'operations_manager'];

const ISO_DAY   = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;
const cleanDay   = (v) => (ISO_DAY.test(String(v || '')) ? String(v) : null);
const cleanMonth = (v) => (ISO_MONTH.test(String(v || '')) ? String(v) : null);

/**
 * What may this caller see and do?
 *
 * `teams` is the set they may finalise a TEAM day for: every active team for a
 * manager, only the ones they lead for anyone else. A lead with no team gets an
 * empty list and the UI offers nothing — which is the honest answer.
 */
async function resolveScope(req) {
  const superadmin = await isSuperAdmin(req.user.id);
  // A superadmin has no company of their own (authMiddleware sets null), so
  // they must name one; everyone else is pinned to theirs.
  const companyId = superadmin ? (req.query.company_id || req.user.company_id) : req.user.company_id;
  const canCompany = superadmin || MANAGER_LEVELS.includes(req.user.role);

  let teams = [];
  if (companyId) {
    let q = supabaseAdmin.from('teams')
      .select('id, name, color, team_type, lead_user_id')
      .eq('company_id', companyId).eq('is_active', true);
    if (!canCompany) q = q.eq('lead_user_id', req.user.id);
    const { data } = await q.order('name');
    teams = data || [];
  }
  return { superadmin, companyId, canCompany, canUnlock: canCompany, teams, role: req.user.role };
}

const nameMap = async (ids) => {
  const uniq = [...new Set((ids || []).filter(Boolean))];
  if (!uniq.length) return {};
  const { data } = await supabaseAdmin
    .from('user_profiles').select('user_id, first_name, last_name').in('user_id', uniq);
  const m = {};
  (data || []).forEach(p => { m[p.user_id] = [p.first_name, p.last_name].filter(Boolean).join(' ') || null; });
  return m;
};

// Narrow a lock query to what a NON-manager may see: the project lock (it is
// their company's own day) and their own team's, never another team's numbers.
const scopeLockQuery = (q, s) => {
  if (s.canCompany) return q;
  const mine = s.teams.map(t => t.id);
  return mine.length
    ? q.or(`scope.eq.company,team_id.in.(${mine.join(',')})`)
    : q.eq('scope', 'company');
};

// ── GET /scope — what the calendar should offer this person ────────────────
router.get('/scope', asyncHandler(async (req, res) => {
  const s = await resolveScope(req);
  res.json({
    company_id: s.companyId,
    can_lock_company: s.canCompany && !!s.companyId,
    can_unlock: s.canUnlock,
    teams: s.teams.map(t => ({ id: t.id, name: t.name, color: t.color, team_type: t.team_type })),
  });
}));

// ── GET /month?month=YYYY-MM — the locks to paint into the calendar cells ──
// Only LOCKED days come back. Computing live figures for 31 days on every
// calendar paint would be dozens of count queries for numbers nobody asked to
// see; the spec wants the box populated once a day is finalised.
router.get('/month', asyncHandler(async (req, res) => {
  const s = await resolveScope(req);
  const month = cleanMonth(req.query.month);
  if (!month) return res.status(400).json({ error: 'month must be YYYY-MM' });
  if (!s.companyId) return res.json({ month, locks: [] });

  const from = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  // Half-open upper bound (first of next month) so the last day of any month is
  // included without needing to know how long the month is.
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;

  const q = scopeLockQuery(
    supabaseAdmin.from('daily_performance_locks')
      .select('id, scope, team_id, perf_date, stats, note, locked_by, locked_at')
      .eq('company_id', s.companyId)
      .is('unlocked_at', null)
      .gte('perf_date', from)
      .lt('perf_date', nextMonth),
    s,
  );

  const { data, error } = await q.order('perf_date');
  if (error) return res.status(500).json({ error: error.message });

  const locks = data || [];
  const names = await nameMap(locks.map(l => l.locked_by));
  const teamNames = {};
  s.teams.forEach(t => { teamNames[t.id] = t.name; });

  res.json({
    month,
    locks: locks.map(l => ({
      ...l,
      locked_by_name: names[l.locked_by] || 'Unknown',
      team_name: l.team_id ? (teamNames[l.team_id] || null) : null,
    })),
  });
}));

// ── GET /day?date=YYYY-MM-DD — the panel behind a clicked date ────────────
// Live figures for what the caller owns, plus whatever is already locked, so
// the panel can show "frozen 18 · live 19" when a day moved after sign-off.
router.get('/day', asyncHandler(async (req, res) => {
  const s = await resolveScope(req);
  const date = cleanDay(req.query.date);
  if (!date) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  if (!s.companyId) return res.json({ date, company: null, teams: [], locks: [] });

  const { data: lockRows } = await scopeLockQuery(
    supabaseAdmin.from('daily_performance_locks')
      .select('id, scope, team_id, perf_date, stats, note, locked_by, locked_at')
      .eq('company_id', s.companyId).eq('perf_date', date).is('unlocked_at', null),
    s,
  );
  const locks = lockRows || [];

  // Live company figures — only for someone who owns the project day. A lead
  // must not be handed company-wide numbers.
  const company = s.canCompany
    ? await dailyPerformance({ companyId: s.companyId, date, memberIds: null, role: s.role })
    : null;

  // Live per-team figures, computed with the SAME function as the company row
  // so a project total and its team rows are never derived differently.
  const teams = [];
  for (const t of s.teams) {
    const ids = await resolveTeamMemberIds(t.id, { companyId: s.companyId });
    const stats = await dailyPerformance({ companyId: s.companyId, date, memberIds: ids, role: s.role });
    teams.push({ team_id: t.id, name: t.name, color: t.color, members: ids.length, ...stats });
  }

  const names = await nameMap(locks.map(l => l.locked_by));
  res.json({
    date,
    // A day that has not finished cannot be signed off — its numbers are still
    // moving. Today is excluded too: it is not over until the ET day is.
    lockable: date < todayEt(),
    can_lock_company: s.canCompany,
    can_unlock: s.canUnlock,
    company,
    teams,
    locks: locks.map(l => ({ ...l, locked_by_name: names[l.locked_by] || 'Unknown' })),
  });
}));

// ── POST /lock — freeze a day ─────────────────────────────────────────────
router.post('/lock', asyncHandler(async (req, res) => {
  const s = await resolveScope(req);
  const date = cleanDay(req.body?.date);
  const scope = req.body?.scope === 'team' ? 'team' : 'company';
  const teamId = req.body?.team_id || null;
  const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : null;

  if (!date) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  if (!s.companyId) return res.status(400).json({ error: 'No company in scope' });
  if (date >= todayEt()) {
    return res.status(422).json({ error: 'A day can only be finalised once it is over.' });
  }

  let memberIds = null;
  if (scope === 'company') {
    if (!s.canCompany) {
      return res.status(403).json({ error: 'Only an operations manager can finalise the whole project day' });
    }
  } else {
    if (!teamId) return res.status(400).json({ error: 'team_id is required to finalise a team day' });
    // The authority check: s.teams is already narrowed to the caller's own team
    // unless they are a manager, so membership of this list IS the permission.
    if (!s.teams.some(t => t.id === teamId)) {
      return res.status(403).json({ error: 'You can only finalise your own team' });
    }
    memberIds = await resolveTeamMemberIds(teamId, { companyId: s.companyId });
  }

  const stats = await dailyPerformance({ companyId: s.companyId, date, memberIds, role: s.role });

  // A project lock carries its team breakdown, so the history can answer "which
  // team drove that day" without recomputing against records that have since
  // moved.
  if (scope === 'company') {
    const breakdown = [];
    for (const t of s.teams) {
      const ids = await resolveTeamMemberIds(t.id, { companyId: s.companyId });
      const ts = await dailyPerformance({ companyId: s.companyId, date, memberIds: ids, role: s.role });
      breakdown.push({ team_id: t.id, name: t.name, ...ts });
    }
    stats.teams = breakdown;
  }
  stats.snapshot_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin.from('daily_performance_locks')
    .insert({
      company_id: s.companyId, scope, team_id: scope === 'team' ? teamId : null,
      perf_date: date, stats, note, locked_by: req.user.id,
    })
    .select()
    .single();

  if (error) {
    // The partial unique index is the real guard against a double-click, or two
    // people finalising the same day at the same moment.
    if (/duplicate key|uq_dpl_active/i.test(error.message)) {
      return res.status(409).json({ error: 'That day is already finalised for this scope.' });
    }
    logger.error('DAILY_LOCK', `lock failed: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }

  logger.info('DAILY_LOCK', `${req.user.id} locked ${scope}${teamId ? ':' + teamId : ''} for ${date}`);
  res.json({ lock: data });
}));

// ── POST /unlock — reopen a day (manager only) ────────────────────────────
router.post('/unlock', asyncHandler(async (req, res) => {
  const s = await resolveScope(req);
  const id = req.body?.id;
  if (!id) return res.status(400).json({ error: 'id is required' });
  if (!s.canUnlock) {
    return res.status(403).json({ error: 'Only an operations manager or company admin can reopen a finalised day' });
  }

  const { data: row } = await supabaseAdmin.from('daily_performance_locks')
    .select('id, company_id, unlocked_at').eq('id', id).maybeSingle();
  if (!row) return res.status(404).json({ error: 'Lock not found' });
  // Cross-tenant guard: a manager may only reopen their own company's day.
  if (row.company_id !== s.companyId && !s.superadmin) {
    return res.status(403).json({ error: 'That day belongs to another company' });
  }
  if (row.unlocked_at) return res.status(409).json({ error: 'That day is already reopened.' });

  const { data, error } = await supabaseAdmin.from('daily_performance_locks')
    .update({ unlocked_by: req.user.id, unlocked_at: new Date().toISOString() })
    .eq('id', id).is('unlocked_at', null)   // lost-update guard
    .select().single();
  if (error) return res.status(500).json({ error: error.message });

  logger.info('DAILY_LOCK', `${req.user.id} reopened lock ${id}`);
  res.json({ lock: data });
}));

module.exports = router;
