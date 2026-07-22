// ============================================================================
// /api/teams — team structure per company (mig 211). ADDITIVE: teams group users
// for the org chart + team dashboards; they do NOT restrict existing access.
//
// Manage (create/edit/delete team, assign anyone): superadmin | company_admin |
// operations_manager (in that company). A team LEAD can manage their own team's
// membership. Everyone in the company can view the org chart; team reports are
// visible to managers + that team's lead/members. readonlyGuard blocks writes.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const { isSuperAdmin, getUserRole, isCompanyMember } = require('../models/helpers');
const { resolveTeamMemberIds, teamMetrics } = require('../utils/teamMetrics');

const router = express.Router();
const MANAGER_LEVELS = ['company_admin', 'operations_manager'];

async function canManageCompany(req, companyId) {
  if (!companyId) return false;
  if (await isSuperAdmin(req.user.id)) return true;
  const r = await getUserRole(req.user.id, companyId);
  return MANAGER_LEVELS.includes(r?.role_level);
}
async function teamById(id) {
  const { data } = await supabaseAdmin.from('teams').select('*').eq('id', id).maybeSingle();
  return data;
}
// name lookup for a batch of user ids (never a raw UUID in the UI)
async function nameMap(ids) {
  const out = {};
  const uniq = [...new Set((ids || []).filter(Boolean))];
  if (!uniq.length) return out;
  const { data } = await supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', uniq);
  (data || []).forEach(p => { out[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown'; });
  uniq.forEach(id => { if (!out[id]) out[id] = 'Unknown'; });
  return out;
}

// ── company roster (for the assign picker + unassigned detection) ─────────────
// Every active user of a company + their role + current team (if any).
router.get('/company-members', asyncHandler(async (req, res) => {
  const companyId = req.query.company_id;
  if (!companyId) return res.status(400).json({ error: 'company_id required' });
  if (!(await isSuperAdmin(req.user.id)) && !(await isCompanyMember(req.user.id, companyId))) {
    return res.status(403).json({ error: 'Not a member of this company' });
  }
  const { data: ucr } = await supabaseAdmin.from('user_company_roles')
    .select('user_id, custom_roles(level)').eq('company_id', companyId).eq('is_active', true);
  const { data: tm } = await supabaseAdmin.from('team_members')
    .select('user_id, team_id, role_in_team').eq('company_id', companyId);
  const teamOf = Object.fromEntries((tm || []).map(m => [m.user_id, m]));
  const ids = (ucr || []).map(u => u.user_id);
  const names = await nameMap(ids);
  const members = (ucr || []).map(u => ({
    user_id: u.user_id, name: names[u.user_id] || 'Unknown', role: u.custom_roles?.level || null,
    team_id: teamOf[u.user_id]?.team_id || null, role_in_team: teamOf[u.user_id]?.role_in_team || null,
  }));
  res.json({ members });
}));

// ── list / org chart for a company ────────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const companyId = req.query.company_id;
  if (!companyId) return res.status(400).json({ error: 'company_id required' });
  if (!(await isSuperAdmin(req.user.id)) && !(await isCompanyMember(req.user.id, companyId))) {
    return res.status(403).json({ error: 'Not a member of this company' });
  }
  const { data: teams } = await supabaseAdmin.from('teams').select('*')
    .eq('company_id', companyId).eq('is_active', true).order('created_at', { ascending: true });
  const { data: tm } = await supabaseAdmin.from('team_members').select('team_id, user_id, role_in_team').eq('company_id', companyId);
  const byTeam = {};
  (tm || []).forEach(m => { (byTeam[m.team_id] = byTeam[m.team_id] || []).push(m); });
  const leadIds = (teams || []).map(t => t.lead_user_id).filter(Boolean);
  const memberIds = (tm || []).map(m => m.user_id);
  const names = await nameMap([...leadIds, ...memberIds]);
  const decorated = (teams || []).map(t => ({
    ...t, lead_name: t.lead_user_id ? (names[t.lead_user_id] || 'Unknown') : null,
    member_count: (byTeam[t.id] || []).length,
    members: (byTeam[t.id] || []).map(m => ({ user_id: m.user_id, name: names[m.user_id] || 'Unknown', role_in_team: m.role_in_team })),
  }));
  res.json({ teams: decorated });
}));

// ── create ────────────────────────────────────────────────────────────────────
router.post('/', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.company_id || !b.name) return res.status(400).json({ error: 'company_id and name required' });
  if (!(await canManageCompany(req, b.company_id))) return res.status(403).json({ error: 'Not allowed to manage teams for this company' });
  const row = {
    company_id: b.company_id, name: String(b.name).slice(0, 120), description: b.description || null,
    team_type: ['fronter', 'closer', 'mixed', 'general'].includes(b.team_type) ? b.team_type : 'general',
    lead_user_id: b.lead_user_id || null, parent_team_id: b.parent_team_id || null,
    goal_monthly_sales: b.goal_monthly_sales != null && b.goal_monthly_sales !== '' ? +b.goal_monthly_sales : null,
    goal_monthly_transfers: b.goal_monthly_transfers != null && b.goal_monthly_transfers !== '' ? +b.goal_monthly_transfers : null,
    color: b.color || null, created_by: req.user.id, updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabaseAdmin.from('teams').insert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });
  // A lead is implicitly a member of their team too (org-chart completeness).
  if (row.lead_user_id) await addMember(data.id, data.company_id, row.lead_user_id, 'lead', req.user.id);
  logger.success('TEAMS', `Created team ${data.name} in company ${data.company_id}`);
  res.json({ team: data });
}));

// ── update ────────────────────────────────────────────────────────────────────
router.put('/:id', asyncHandler(async (req, res) => {
  const team = await teamById(req.params.id);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  const isLead = team.lead_user_id === req.user.id;
  if (!(await canManageCompany(req, team.company_id)) && !isLead) return res.status(403).json({ error: 'Not allowed' });
  const b = req.body || {};
  const patch = { updated_at: new Date().toISOString() };
  if (b.name != null) patch.name = String(b.name).slice(0, 120);
  if (b.description !== undefined) patch.description = b.description || null;
  if (b.team_type && ['fronter', 'closer', 'mixed', 'general'].includes(b.team_type)) patch.team_type = b.team_type;
  if (b.color !== undefined) patch.color = b.color || null;
  if (b.goal_monthly_sales !== undefined) patch.goal_monthly_sales = b.goal_monthly_sales === '' || b.goal_monthly_sales == null ? null : +b.goal_monthly_sales;
  if (b.goal_monthly_transfers !== undefined) patch.goal_monthly_transfers = b.goal_monthly_transfers === '' || b.goal_monthly_transfers == null ? null : +b.goal_monthly_transfers;
  // lead + parent + active are manager-only (structural)
  if (await canManageCompany(req, team.company_id)) {
    if (b.lead_user_id !== undefined) patch.lead_user_id = b.lead_user_id || null;
    if (b.parent_team_id !== undefined) patch.parent_team_id = b.parent_team_id || null;
    if (b.is_active !== undefined) patch.is_active = !!b.is_active;
  }
  const { data, error } = await supabaseAdmin.from('teams').update(patch).eq('id', team.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (patch.lead_user_id) await addMember(team.id, team.company_id, patch.lead_user_id, 'lead', req.user.id);
  res.json({ team: data });
}));

// ── delete (soft) ─────────────────────────────────────────────────────────────
router.delete('/:id', asyncHandler(async (req, res) => {
  const team = await teamById(req.params.id);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  if (!(await canManageCompany(req, team.company_id))) return res.status(403).json({ error: 'Not allowed' });
  await supabaseAdmin.from('teams').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', team.id);
  await supabaseAdmin.from('team_members').delete().eq('team_id', team.id);   // free the members (one-per-company)
  res.json({ ok: true });
}));

// ── members ───────────────────────────────────────────────────────────────────
// Upsert on (user_id, company_id) MOVES a user to this team (one team per user
// per company). Returns the row.
async function addMember(teamId, companyId, userId, roleInTeam, addedBy) {
  return supabaseAdmin.from('team_members').upsert(
    { team_id: teamId, user_id: userId, company_id: companyId, role_in_team: roleInTeam || 'member', added_by: addedBy },
    { onConflict: 'user_id,company_id' },
  );
}
router.post('/:id/members', asyncHandler(async (req, res) => {
  const team = await teamById(req.params.id);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  const isLead = team.lead_user_id === req.user.id;
  if (!(await canManageCompany(req, team.company_id)) && !isLead) return res.status(403).json({ error: 'Not allowed' });
  const userId = req.body?.user_id;
  if (!userId) return res.status(400).json({ error: 'user_id required' });
  if (!(await isCompanyMember(userId, team.company_id))) return res.status(400).json({ error: 'User is not a member of this company' });
  const { error } = await addMember(team.id, team.company_id, userId, req.body?.role_in_team === 'lead' ? 'lead' : 'member', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, team_id: team.id, user_id: userId });
}));
router.delete('/:id/members/:userId', asyncHandler(async (req, res) => {
  const team = await teamById(req.params.id);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  const isLead = team.lead_user_id === req.user.id;
  if (!(await canManageCompany(req, team.company_id)) && !isLead) return res.status(403).json({ error: 'Not allowed' });
  await supabaseAdmin.from('team_members').delete().eq('team_id', team.id).eq('user_id', req.params.userId);
  res.json({ ok: true });
}));

// ── team report (progress + per-member leaderboard + trend + goal) ────────────
router.get('/:id/report', asyncHandler(async (req, res) => {
  const team = await teamById(req.params.id);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  const isLead = team.lead_user_id === req.user.id;
  const isMember = !!(await supabaseAdmin.from('team_members').select('id').eq('team_id', team.id).eq('user_id', req.user.id).maybeSingle()).data;
  if (!(await canManageCompany(req, team.company_id)) && !isLead && !isMember) return res.status(403).json({ error: 'Not allowed' });
  const from = req.query.from || null, to = req.query.to || null;
  const ids = await resolveTeamMemberIds(team.id, { includeSub: true, companyId: team.company_id });
  const report = await teamMetrics({ ids, companyId: team.company_id, from, to });
  const goal = {
    monthly_sales: team.goal_monthly_sales ?? null, monthly_transfers: team.goal_monthly_transfers ?? null,
    sales_pct: team.goal_monthly_sales ? Math.round(100 * report.totals.sales / team.goal_monthly_sales) : null,
    transfers_pct: team.goal_monthly_transfers ? Math.round(100 * report.totals.transfers / team.goal_monthly_transfers) : null,
  };
  res.json({ team: { id: team.id, name: team.name, team_type: team.team_type }, ...report, goal, member_count: ids.length });
}));

// ── my team (for the Manager shell) ───────────────────────────────────────────
router.get('/my', asyncHandler(async (req, res) => {
  const companyId = req.query.company_id || req.user.company_id;
  if (!companyId) return res.status(400).json({ error: 'company_id required' });
  // team I lead first, else the team I'm a member of
  const { data: led } = await supabaseAdmin.from('teams').select('*')
    .eq('company_id', companyId).eq('is_active', true).eq('lead_user_id', req.user.id).maybeSingle();
  let team = led;
  if (!team) {
    const { data: mem } = await supabaseAdmin.from('team_members').select('team_id').eq('company_id', companyId).eq('user_id', req.user.id).maybeSingle();
    if (mem) team = await teamById(mem.team_id);
  }
  if (!team) return res.json({ team: null });
  res.json({ team, is_lead: team.lead_user_id === req.user.id });
}));

module.exports = router;
