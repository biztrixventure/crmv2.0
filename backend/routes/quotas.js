// ============================================================================
// /api/quotas — two-tier team quotas (mig 216).
//
//   TEAM tier   (user_id NULL)  — superadmin / company_admin / operations_manager
//                                 set the target on a TEAM.
//   MEMBER tier (user_id set)   — the TEAM LEAD sub-allocates it across their
//                                 people. Gated on teams.lead_can_edit (mig 212),
//                                 the switch that already means "this lead may
//                                 run their own team" — not a new permission.
//
// Allocations are NOT required to sum to the parent. Over- and under-allocation
// are both normal; the report states the gap rather than refusing the write.
//
// Every number comes from utils/quotaMetrics.js, the single counter shared with
// the team report, so no two surfaces can disagree about the same person.
//
// Scoping is server-side and company-typed: resolveScopedCompanyId decides which
// company a request may read, isCloserSideScope decides whether the company is
// judged on transfers (fronter) or sales (closer). No role-name lists.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const {
  isSuperAdmin, getUserRole, isCompanyMember, isCloserSideScope, resolveScopedCompanyId,
} = require('../models/helpers');
const { resolveTeamMemberIds } = require('../utils/teamMetrics');
const { getCatalog, attachAttainment, periodBounds } = require('../utils/quotaMetrics');
const cache = require('../utils/cache');

const router = express.Router();
const MANAGER_LEVELS = ['company_admin', 'operations_manager'];
const NS = 'quota_members';           // teamId → member ids, 60s
const TTL = 60_000;

// ── access helpers ──────────────────────────────────────────────────────────
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
// May this caller WRITE quotas on this team, and at which tier?
//   manager → both tiers.  lead (+lead_can_edit) → member tier only.
async function writeScope(req, team) {
  if (!team) return { team: false, member: false };
  if (await canManageCompany(req, team.company_id)) return { team: true, member: true, manager: true };
  const isLead = team.lead_user_id === req.user.id;
  if (isLead && team.lead_can_edit) return { team: false, member: true, lead: true };
  return { team: false, member: false, isLead };
}
// Read access: managers of the company, the team's lead, or any team member.
async function canRead(req, team) {
  if (!team) return false;
  if (await canManageCompany(req, team.company_id)) return true;
  if (team.lead_user_id === req.user.id) return true;
  const { data } = await supabaseAdmin.from('team_members')
    .select('id').eq('team_id', team.id).eq('user_id', req.user.id).maybeSingle();
  return !!data;
}

const memberIds = (teamId, companyId) =>
  cache.remember(NS, `${teamId}`, TTL, () => resolveTeamMemberIds(teamId, { includeSub: true, companyId }));

// Decorate a quota list with live attainment for one team.
async function decorate(rows, { team, req }) {
  if (!rows.length) return [];
  const ids = await memberIds(team.id, team.company_id);
  const closerSide = await isCloserSideScope(req.user.role, team.company_id);
  return attachAttainment(rows, {
    companyId: team.company_id, closerSide, memberIdsByTeam: { [team.id]: ids },
  });
}

// Names for the member tier — a raw uuid must never reach the UI.
async function nameMap(ids) {
  const uniq = [...new Set((ids || []).filter(Boolean))];
  if (!uniq.length) return {};
  const { data } = await supabaseAdmin.from('user_profiles')
    .select('user_id, first_name, last_name').in('user_id', uniq);
  const out = {};
  (data || []).forEach(p => { out[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown'; });
  return out;
}

// ── metric catalog ──────────────────────────────────────────────────────────
// Built-ins plus anything the operator added via business_config quota.metrics,
// so "define other quota kinds later" never needs a migration.
router.get('/metrics', asyncHandler(async (req, res) => {
  const companyId = await resolveScopedCompanyId(req);
  const catalog = await getCatalog(companyId);
  res.json({
    metrics: catalog.map(m => ({ key: m.key, label: m.label, unit: m.unit, hint: m.hint, custom: !!m.custom })),
  });
}));

// ── one team's quotas (both tiers) + the allocation gap ─────────────────────
router.get('/team/:teamId', asyncHandler(async (req, res) => {
  const team = await teamById(req.params.teamId);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  if (!(await canRead(req, team))) return res.status(403).json({ error: 'Not allowed' });

  const includeArchived = req.query.include_archived === 'true';
  let q = supabaseAdmin.from('team_quotas').select('*')
    .eq('team_id', team.id).order('starts_at', { ascending: false });
  if (!includeArchived) q = q.neq('status', 'archived');
  const { data: rows, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const decorated = await decorate(rows || [], { team, req });
  const names = await nameMap(decorated.filter(r => r.user_id).map(r => r.user_id));
  const withNames = decorated.map(r => ({ ...r, member_name: r.user_id ? (names[r.user_id] || 'Unknown') : null }));

  const teamTier   = withNames.filter(r => !r.user_id);
  const memberTier = withNames.filter(r => r.user_id);

  // The gap the lead must be able to see. Compared per (metric, window) so a
  // monthly transfers quota is never measured against a weekly sales allocation.
  const gaps = teamTier.map(t => {
    const kids = memberTier.filter(m =>
      m.metric === t.metric && m.starts_at === t.starts_at && m.ends_at === t.ends_at);
    const allocated = kids.reduce((n, k) => n + (Number(k.target_value) || 0), 0);
    const target = Number(t.target_value) || 0;
    return {
      quota_id: t.id, metric: t.metric, metric_label: t.metric_label,
      starts_at: t.starts_at, ends_at: t.ends_at,
      target, allocated, allocated_to: kids.length,
      // positive = still to hand out, negative = the lead promised more than
      // the team owes. Both are legitimate; the UI labels which one it is.
      gap: target - allocated,
    };
  });

  const scope = await writeScope(req, team);
  res.json({
    team: { id: team.id, name: team.name, company_id: team.company_id, team_type: team.team_type,
            lead_user_id: team.lead_user_id, lead_can_edit: team.lead_can_edit },
    can: scope, team_quotas: teamTier, member_quotas: memberTier, gaps,
    member_count: (await memberIds(team.id, team.company_id)).length,
  });
}));

// ── company roll-up: every team's TEAM-tier quota (admin tier) ──────────────
router.get('/company', asyncHandler(async (req, res) => {
  const companyId = await resolveScopedCompanyId(req);
  if (!companyId) return res.json({ quotas: [], teams: [] });
  if (!(await isSuperAdmin(req.user.id)) && !(await isCompanyMember(req.user.id, companyId))) {
    return res.status(403).json({ error: 'Not a member of this company' });
  }
  const { data: teams } = await supabaseAdmin.from('teams')
    .select('id, name, team_type, lead_user_id, color').eq('company_id', companyId).eq('is_active', true);
  const teamIds = (teams || []).map(t => t.id);
  if (!teamIds.length) return res.json({ quotas: [], teams: [] });

  const { data: rows } = await supabaseAdmin.from('team_quotas').select('*')
    .in('team_id', teamIds).is('user_id', null).neq('status', 'archived')
    .order('starts_at', { ascending: false });

  // One member-id lookup per team, then ONE attainment pass over every quota —
  // rows sharing a (metric, window, team) collapse into a single count.
  const byTeam = {};
  for (const id of teamIds) byTeam[id] = await memberIds(id, companyId);
  const closerSide = await isCloserSideScope(req.user.role, companyId);
  const decorated = await attachAttainment(rows || [], { companyId, closerSide, memberIdsByTeam: byTeam });

  const teamName = Object.fromEntries((teams || []).map(t => [t.id, t]));
  res.json({
    quotas: decorated.map(q => ({ ...q, team_name: teamName[q.team_id]?.name || 'Unknown',
                                  team_color: teamName[q.team_id]?.color || null })),
    teams: teams || [],
  });
}));

// ── my live quotas (the member-facing card, merged with the SPIFF strip) ────
// Only quotas whose window contains today, so the card is always about now.
router.get('/mine', asyncHandler(async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const { data: rows } = await supabaseAdmin.from('team_quotas').select('*')
    .eq('user_id', req.user.id).eq('status', 'active')
    .lte('starts_at', today).gte('ends_at', today);
  if (!rows?.length) return res.json({ quotas: [] });

  // Group by team so each team is counted once, with its own side rule.
  const teamIds = [...new Set(rows.map(r => r.team_id))];
  const { data: teams } = await supabaseAdmin.from('teams').select('id, name, company_id, color').in('id', teamIds);
  const teamMap = Object.fromEntries((teams || []).map(t => [t.id, t]));

  const out = [];
  for (const tid of teamIds) {
    const team = teamMap[tid];
    if (!team) continue;
    const mine = rows.filter(r => r.team_id === tid);
    const ids = await memberIds(tid, team.company_id);
    const closerSide = await isCloserSideScope(req.user.role, team.company_id);

    // The parent team quota rides along so the card can show "team at 61%" —
    // context for why this number matters, the same way a SPIFF shows the
    // leaderboard around your own bar.
    const parentIds = [...new Set(mine.map(r => r.parent_quota_id).filter(Boolean))];
    let parents = [];
    if (parentIds.length) {
      const { data: p } = await supabaseAdmin.from('team_quotas').select('*').in('id', parentIds);
      parents = p || [];
    }
    const decorated = await attachAttainment([...mine, ...parents], {
      companyId: team.company_id, closerSide, memberIdsByTeam: { [tid]: ids },
    });
    const parentById = Object.fromEntries(decorated.filter(d => !d.user_id).map(d => [d.id, d]));
    decorated.filter(d => d.user_id).forEach(d => {
      const p = d.parent_quota_id ? parentById[d.parent_quota_id] : null;
      out.push({
        ...d, team_name: team.name, team_color: team.color,
        team_quota: p ? { target: Number(p.target_value) || 0, actual: p.actual, pct: p.pct } : null,
      });
    });
  }
  res.json({ quotas: out });
}));

// ── create ──────────────────────────────────────────────────────────────────
router.post('/', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.team_id || !b.metric) return res.status(400).json({ error: 'team_id and metric required' });
  const team = await teamById(b.team_id);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  const scope = await writeScope(req, team);
  const isMemberTier = !!b.user_id;
  if (isMemberTier && !scope.member) {
    return res.status(403).json({
      error: scope.isLead
        ? 'Your manager has not enabled "let the team lead edit this team", so you cannot allocate quotas yet.'
        : 'Not allowed to allocate quotas for this team',
    });
  }
  if (!isMemberTier && !scope.team) return res.status(403).json({ error: 'Only a company manager can set a team quota' });

  const catalog = await getCatalog(team.company_id);
  if (!catalog.some(m => m.key === b.metric)) return res.status(400).json({ error: `Unknown metric "${b.metric}"` });

  const target = Number(b.target_value);
  if (!Number.isFinite(target) || target <= 0) return res.status(400).json({ error: 'target_value must be greater than 0' });

  // A member allocation is only valid for someone actually ON the team —
  // otherwise it could never be measured and would sit there reading 0 forever.
  if (isMemberTier) {
    const ids = await memberIds(team.id, team.company_id);
    if (!ids.includes(b.user_id)) return res.status(400).json({ error: 'That user is not a member of this team' });
  }

  const kind = ['day', 'week', 'month', 'range'].includes(b.period_kind) ? b.period_kind : 'month';
  // 'range' carries explicit dates; the named periods are resolved to explicit
  // bounds ONCE, at write time, so an old quota's window never drifts.
  const bounds = kind === 'range'
    ? { starts_at: b.starts_at, ends_at: b.ends_at }
    : periodBounds(kind, b.starts_at);
  if (!bounds.starts_at || !bounds.ends_at) return res.status(400).json({ error: 'starts_at and ends_at required for a custom range' });
  if (bounds.ends_at < bounds.starts_at) return res.status(400).json({ error: 'End date is before the start date' });

  const row = {
    company_id: team.company_id, team_id: team.id,
    user_id: isMemberTier ? b.user_id : null,
    parent_quota_id: isMemberTier ? (b.parent_quota_id || null) : null,
    metric: b.metric, target_value: target, period_kind: kind,
    starts_at: bounds.starts_at, ends_at: bounds.ends_at,
    label: b.label ? String(b.label).slice(0, 120) : null,
    notes: b.notes || null,
    status: b.status === 'draft' ? 'draft' : 'active',
    created_by: req.user.id,
  };
  const { data, error } = await supabaseAdmin.from('team_quotas').insert(row).select().single();
  if (error) {
    // The partial unique indexes are the friendly-message case: the same target
    // already exists for this window rather than anything being broken.
    if (error.code === '23505') return res.status(409).json({ error: 'A quota for that metric and period already exists here. Edit it instead.' });
    return res.status(500).json({ error: error.message });
  }
  logger.success('QUOTAS', `${isMemberTier ? 'Member' : 'Team'} quota ${row.metric} ${target} on team ${team.name}`);
  res.json({ quota: data });
}));

// ── update ──────────────────────────────────────────────────────────────────
router.put('/:id', asyncHandler(async (req, res) => {
  const { data: q } = await supabaseAdmin.from('team_quotas').select('*').eq('id', req.params.id).maybeSingle();
  if (!q) return res.status(404).json({ error: 'Quota not found' });
  const team = await teamById(q.team_id);
  const scope = await writeScope(req, team);
  const needed = q.user_id ? scope.member : scope.team;
  if (!needed) return res.status(403).json({ error: 'Not allowed to edit this quota' });

  const b = req.body || {};
  const patch = { updated_at: new Date().toISOString() };
  if (b.target_value !== undefined) {
    const t = Number(b.target_value);
    if (!Number.isFinite(t) || t <= 0) return res.status(400).json({ error: 'target_value must be greater than 0' });
    patch.target_value = t;
  }
  if (b.label !== undefined)  patch.label = b.label ? String(b.label).slice(0, 120) : null;
  if (b.notes !== undefined)  patch.notes = b.notes || null;
  if (b.status && ['draft', 'active', 'archived'].includes(b.status)) patch.status = b.status;
  if (b.starts_at && b.ends_at) {
    if (b.ends_at < b.starts_at) return res.status(400).json({ error: 'End date is before the start date' });
    patch.starts_at = b.starts_at; patch.ends_at = b.ends_at; patch.period_kind = 'range';
  }
  // metric is intentionally immutable: changing it would silently re-point an
  // in-flight quota at a different counter and make its history meaningless.

  const { data, error } = await supabaseAdmin.from('team_quotas').update(patch).eq('id', q.id).select().single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'That metric and period already has a quota here.' });
    return res.status(500).json({ error: error.message });
  }
  res.json({ quota: data });
}));

// ── delete (soft — archive, so attainment history survives) ─────────────────
router.delete('/:id', asyncHandler(async (req, res) => {
  const { data: q } = await supabaseAdmin.from('team_quotas').select('*').eq('id', req.params.id).maybeSingle();
  if (!q) return res.status(404).json({ error: 'Quota not found' });
  const team = await teamById(q.team_id);
  const scope = await writeScope(req, team);
  const needed = q.user_id ? scope.member : scope.team;
  if (!needed) return res.status(403).json({ error: 'Not allowed to delete this quota' });
  await supabaseAdmin.from('team_quotas')
    .update({ status: 'archived', updated_at: new Date().toISOString() }).eq('id', q.id);
  res.json({ ok: true });
}));

module.exports = router;
