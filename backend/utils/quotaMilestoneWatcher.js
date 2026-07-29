// ============================================================================
// quotaMilestoneWatcher — notice when a quota crosses one of its milestones
// (mig 218) and tell the people who chose to hear about it.
//
// WHY A SWEEP AND NOT A WRITE-PATH HOOK
// A milestone is crossed by activity that happens far away from the quota: a
// transfer created by VICIdial, a sale approved by compliance hours later, a
// cancellation that drops the number back down. Hooking every one of those
// write paths would mean touching sales, transfers, compliance and the dialer
// importer, and would still miss the bulk-upload path. One periodic sweep over
// the live quotas sees all of it and cannot be bypassed by a new writer.
//
// WHY THIS IS SAFE TO RUN REPEATEDLY
// Milestones are scored LIVE (the operator's choice — no award table), so this
// sweep re-detects the same earned milestone on every run. What stops the spam
// is the PERMANENT dedup key in onQuotaMilestoneEarned: the first crossing
// notifies, every later run is a no-op. That also means a number that dips
// below a threshold and climbs back does NOT congratulate anyone twice.
//
// Never throws. A background job that can crash the process on one bad row is
// worse than one that skips a cycle.
// ============================================================================
const { supabaseAdmin } = require('../config/database');
const { attachAttainment, attachMilestones } = require('./quotaMetrics');
const { resolveTeamMemberIds } = require('./teamMetrics');
const { getCompanyType } = require('../models/helpers');
const { onQuotaMilestoneEarned } = require('./notificationService');
const logger = require('./logger');

async function nameOf(userId) {
  if (!userId) return null;
  const { data } = await supabaseAdmin.from('user_profiles')
    .select('first_name, last_name').eq('user_id', userId).maybeSingle();
  if (!data) return null;
  return `${data.first_name || ''} ${data.last_name || ''}`.trim() || null;
}

async function sweepMilestones() {
  const today = new Date().toISOString().slice(0, 10);
  let checked = 0, earned = 0;
  try {
    // Only quotas whose window contains today. A finished quota's ladder is
    // history — re-announcing last month's prize would be noise, and the dedup
    // key would swallow it anyway.
    const { data: quotas, error } = await supabaseAdmin.from('team_quotas')
      .select('*').eq('status', 'active')
      .lte('starts_at', today).gte('ends_at', today);
    if (error) throw new Error(error.message);
    if (!quotas?.length) return { checked: 0, earned: 0 };

    // Group by team so member ids and the company side resolve once per team,
    // not once per quota.
    const byTeam = {};
    quotas.forEach(q => { (byTeam[q.team_id] = byTeam[q.team_id] || []).push(q); });

    for (const [teamId, list] of Object.entries(byTeam)) {
      const { data: team } = await supabaseAdmin.from('teams')
        .select('id, company_id, lead_user_id, is_active').eq('id', teamId).maybeSingle();
      if (!team || team.is_active === false) continue;

      const ids = await resolveTeamMemberIds(teamId, { includeSub: true, companyId: team.company_id });
      // Side follows COMPANY TYPE, matching the report routes — a role-based
      // answer has no meaning in a background job with no viewer.
      const coType = await getCompanyType(team.company_id);
      const closerSide = coType === 'closer';

      const scored = await attachMilestones(
        await attachAttainment(list, {
          companyId: team.company_id, closerSide, memberIdsByTeam: { [teamId]: ids },
        }),
      );

      for (const q of scored) {
        checked++;
        const hit = (q.milestones || []).filter(m => m.earned);
        if (!hit.length) continue;
        // On a TEAM-tier quota the lead owns the achievement; on a member
        // allocation the member does.
        const earnerId = q.user_id || team.lead_user_id || null;
        if (!earnerId) continue;
        const earnerName = await nameOf(earnerId);
        for (const m of hit) {
          await onQuotaMilestoneEarned({
            quota: q, milestone: m, earnerId,
            leadId: team.lead_user_id || null,
            companyId: team.company_id,
            actual: q.actual, earnerName,
          });
          earned++;
        }
      }
    }
  } catch (e) {
    logger.warn('QUOTA_MILESTONES', `sweep failed: ${e.message}`);
  }
  return { checked, earned };
}

module.exports = { sweepMilestones };
