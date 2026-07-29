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
  isSuperAdmin, getUserRole, isCompanyMember, isCloserSideScope, resolveScopedCompanyId, getCompanyType,
} = require('../models/helpers');

// Which column is this COMPANY judged on — leads sent, or deals closed?
//
// isCloserSideScope answers that from the VIEWER's role, which is right for
// scoping a list ("show me my rows") but wrong for a company report. A
// superadmin matches no closer role, so viewing a closer company they were told
// "fronter" and the report would have counted fronter_id — the wrong column, on
// the wrong side, reported as fact. A fronter company is judged on transfers no
// matter who is looking, so company type wins and the viewer's role is only the
// fallback when the company row can't be read.
async function sideIsCloser(req, companyId) {
  if (!companyId) return false;
  const type = await getCompanyType(companyId);
  if (type === 'closer' || type === 'fronter') return type === 'closer';
  return isCloserSideScope(req.user.role, companyId);
}
const { resolveTeamMemberIds } = require('../utils/teamMetrics');
const { getCatalog, attachAttainment, periodBounds, activitySeries } = require('../utils/quotaMetrics');
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
//
//   superadmin            → both tiers, every company, always. It overrides the
//                           per-team switches rather than reading them, so a
//                           team can never lock the operator out of its own data.
//   company_admin /
//   operations_manager    → both tiers, own company.
//   team lead             → MEMBER tier only, on their own team, and only while
//                           the team grants it. lead_can_allocate (mig 217) is
//                           the narrow switch; lead_can_edit (mig 212) implies
//                           it, because a lead trusted to rename the team is
//                           certainly trusted to hand out numbers.
//   everyone else         → read only.
//
// A team-level TARGET is never a lead's to set. The whole shape of the feature
// is that the number comes down from the company and the lead decides how to
// spend it; letting the lead set their own target would erase that.
async function writeScope(req, team) {
  if (!team) return { team: false, member: false };
  if (await isSuperAdmin(req.user.id)) {
    return { team: true, member: true, manager: true, superadmin: true };
  }
  if (await canManageCompany(req, team.company_id)) return { team: true, member: true, manager: true };
  const isLead = team.lead_user_id === req.user.id;
  const mayAllocate = !!(team.lead_can_allocate || team.lead_can_edit);
  if (isLead && mayAllocate) return { team: false, member: true, lead: true };
  return { team: false, member: false, isLead, lead_locked: isLead && !mayAllocate };
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
  const closerSide = await sideIsCloser(req,team.company_id);
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
  const closerSide = await sideIsCloser(req,companyId);
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
    const closerSide = await sideIsCloser(req,team.company_id);

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

// ── the reporting surface (all three tiers, one endpoint) ───────────────────
// GET /quotas/report?company_id=&from=&to=
//
// Visibility mirrors the Teams tab, which is already correct:
//   superadmin          → any company (?company_id), plus the company list
//   company_admin / ops → their own company, every team in it
//   team lead           → their own team only
//   member              → their own row only
//
// The viewer never chooses their scope — the server decides it from who they
// are and reports which scope it applied, so the UI can label the page honestly
// ("Your team" vs "EasyTech Communications") instead of guessing.
router.get('/report', asyncHandler(async (req, res) => {
  const superadmin = await isSuperAdmin(req.user.id);

  // A superadmin usually has no primary company of their own. resolveScopedCompanyId
  // then returns null and, without this, the page rendered empty with no company
  // picker — the picker only draws once the payload says who you are, so the
  // operator was locked out of every company at once. Fall back to the first
  // active company and always ship the list so they can switch.
  const companyList = superadmin
    ? ((await supabaseAdmin.from('companies').select('id, name, company_type')
        .eq('is_active', true).order('name')).data || [])
    : [];
  let companyId = await resolveScopedCompanyId(req);
  if (!companyId && superadmin) companyId = companyList[0]?.id || null;

  if (!companyId) {
    return res.json({ scope: 'none', superadmin, companies: superadmin ? companyList : undefined, teams: [], members: [], series: [], totals: null, unallocated_count: 0 });
  }
  if (!superadmin && !(await isCompanyMember(req.user.id, companyId))) {
    return res.status(403).json({ error: 'Not a member of this company' });
  }

  // Default to the current month — the period a quota is usually written for,
  // so the page opens already answering "how are we doing on this month's number".
  const today = new Date().toISOString().slice(0, 10);
  const from = req.query.from || `${today.slice(0, 7)}-01`;
  const to   = req.query.to   || today;

  const manager = superadmin || (await canManageCompany(req, companyId));
  const closerSide = await sideIsCloser(req,companyId);

  const { data: allTeams } = await supabaseAdmin.from('teams')
    .select('id, name, team_type, lead_user_id, color, lead_can_edit, lead_can_allocate')
    .eq('company_id', companyId).eq('is_active', true).order('name');

  // Narrow to what this viewer may see.
  let teams = allTeams || [];
  let scope = 'company';
  let selfOnly = false;
  if (!manager) {
    const led = teams.filter(t => t.lead_user_id === req.user.id);
    if (led.length) { teams = led; scope = 'team'; }
    else {
      const { data: mem } = await supabaseAdmin.from('team_members')
        .select('team_id').eq('company_id', companyId).eq('user_id', req.user.id).maybeSingle();
      teams = mem ? teams.filter(t => t.id === mem.team_id) : [];
      scope = 'member'; selfOnly = true;
    }
  }
  if (!teams.length) {
    // Still hand back the company list and the flags — otherwise a superadmin
    // who lands on a company with no teams loses the switcher and is stranded.
    return res.json({
      scope, side: closerSide ? 'closer' : 'fronter', company_id: companyId,
      can_manage: manager, superadmin, companies: superadmin ? companyList : undefined,
      range: { from, to }, teams: [], members: [], series: [], totals: null, unallocated_count: 0,
    });
  }

  const teamIds = teams.map(t => t.id);
  const { data: quotaRows } = await supabaseAdmin.from('team_quotas').select('*')
    .in('team_id', teamIds).neq('status', 'archived').order('starts_at', { ascending: false });

  const memberIdsByTeam = {};
  for (const t of teams) memberIdsByTeam[t.id] = await memberIds(t.id, companyId);
  const quotas = await attachAttainment(quotaRows || [], { companyId, closerSide, memberIdsByTeam });

  // One activity pass over every member in scope, reused by every chart.
  const everyone = [...new Set(Object.values(memberIdsByTeam).flat())];
  const activity = await activitySeries({
    userIds: selfOnly ? [req.user.id] : everyone, companyId, closerSide, from, to,
  });

  const teamOfUser = {};
  for (const [tid, ids] of Object.entries(memberIdsByTeam)) ids.forEach(id => { teamOfUser[id] = tid; });
  const names = await nameMap([...everyone, ...teams.map(t => t.lead_user_id)]);
  const teamName = Object.fromEntries(teams.map(t => [t.id, t.name]));

  // Per-member rows: activity + whatever they were personally allocated.
  const quotaByUser = {};
  quotas.filter(q => q.user_id).forEach(q => { (quotaByUser[q.user_id] = quotaByUser[q.user_id] || []).push(q); });
  const memberRows = activity.members
    .filter(m => !selfOnly || m.user_id === req.user.id)
    .map(m => ({
      ...m,
      name: names[m.user_id] || 'Unknown',
      team_id: teamOfUser[m.user_id] || null,
      team_name: teamName[teamOfUser[m.user_id]] || null,
      is_lead: teams.some(t => t.lead_user_id === m.user_id),
      quotas: (quotaByUser[m.user_id] || []).map(q => ({
        id: q.id, metric: q.metric, metric_label: q.metric_label, metric_unit: q.metric_unit,
        target_value: Number(q.target_value), actual: q.actual, pct: q.pct, remaining: q.remaining,
        starts_at: q.starts_at, ends_at: q.ends_at, label: q.label,
      })),
    }));

  // Per-team rows: the target, live attainment, and how much of it the lead has
  // actually handed out. `unallocated` is the lead's to-do list, and negative
  // means they promised more than the team owes — both are reported, neither
  // is an error.
  const teamRows = teams.map(t => {
    const tq = quotas.filter(q => q.team_id === t.id && !q.user_id);
    const mq = quotas.filter(q => q.team_id === t.id && q.user_id);
    return {
      id: t.id, name: t.name, team_type: t.team_type, color: t.color,
      lead_user_id: t.lead_user_id, lead_name: t.lead_user_id ? (names[t.lead_user_id] || 'Unknown') : null,
      lead_can_edit: t.lead_can_edit, lead_can_allocate: !!(t.lead_can_allocate || t.lead_can_edit),
      member_count: (memberIdsByTeam[t.id] || []).length,
      quotas: tq.map(q => {
        const kids = mq.filter(k => k.metric === q.metric && k.starts_at === q.starts_at && k.ends_at === q.ends_at);
        const allocated = kids.reduce((n, k) => n + (Number(k.target_value) || 0), 0);
        const target = Number(q.target_value) || 0;
        return {
          id: q.id, metric: q.metric, metric_label: q.metric_label, metric_unit: q.metric_unit,
          target_value: target, actual: q.actual, pct: q.pct, remaining: q.remaining,
          starts_at: q.starts_at, ends_at: q.ends_at, label: q.label,
          allocated, unallocated: target - allocated, allocated_to: kids.length,
          // Pace: what fraction of the window has elapsed vs what fraction of the
          // target is done. Ahead/behind is the question a manager actually asks,
          // and "61% done" means nothing without "and 80% of the month is gone".
          ...pace(q, target),
        };
      }),
      members_with_quota: new Set(mq.map(k => k.user_id)).size,
    };
  });

  // People in scope who hold no allocation at all — the gap the org chart hides.
  const allocatedUsers = new Set(quotas.filter(q => q.user_id).map(q => q.user_id));
  const unallocated = everyone.filter(id => !allocatedUsers.has(id));

  res.json({
    scope, side: closerSide ? 'closer' : 'fronter', company_id: companyId,
    range: { from, to },
    can_manage: manager, superadmin,
    companies: superadmin ? companyList : undefined,
    teams: teamRows,
    members: memberRows.sort((a, b) => (b.transfers - a.transfers) || (b.sales_won - a.sales_won)),
    series: activity.days,
    totals: activity.totals,
    unallocated_count: unallocated.length,
    unallocated_names: unallocated.slice(0, 40).map(id => names[id] || 'Unknown'),
  });
}));

// Elapsed-vs-earned for a dated window. `required_pace` is what the daily rate
// has to be from here to still land on target — the number that turns a report
// into a decision.
function pace(q, target) {
  const day = 86400000;
  const start = Date.parse(`${q.starts_at}T00:00:00`);
  const end   = Date.parse(`${q.ends_at}T23:59:59`);
  const now   = Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return { elapsed_pct: null, on_track: null, required_pace: null };
  const totalDays = Math.max(1, Math.round((end - start) / day));
  const elapsed = Math.min(1, Math.max(0, (now - start) / (end - start)));
  const daysLeft = Math.max(0, Math.ceil((end - now) / day));
  const remaining = Math.max(0, target - (Number(q.actual) || 0));
  return {
    elapsed_pct: Math.round(elapsed * 1000) / 10,
    days_total: totalDays,
    days_left: daysLeft,
    // Ahead of the clock, or behind it. null before the window opens.
    on_track: elapsed > 0 ? ((q.pct ?? 0) / 100) >= elapsed : null,
    required_pace: daysLeft > 0 ? Math.round((remaining / daysLeft) * 10) / 10 : null,
  };
}

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
