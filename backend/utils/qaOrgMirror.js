// ============================================================================
// utils/qaOrgMirror.js — the v1 org screen keeps the v2 org chart in step.
//
// The QA org chart lives in two places: v1 (`qa_manager_companies`,
// `qa_team_members`, `qa_managers`, wired from Compliance → QA Department) and
// v2 (`qa2_manager_company`, `qa2_team_member`, `qa2_manager_access`, wired
// from the /qa2 Org tab). QA2 reads ONLY v2 — a qa_manager's companies come
// from `qa2_manager_company` and nowhere else (qa2ScopeResolver).
//
// Both screens are still on the floor, so an admin can quite reasonably wire a
// manager on the v1 screen and hand them a QA2 login that shows nothing. That
// happened, and the manager's Team tab was simply empty. Rather than guess
// which screen people will use, every v1 org write now applies the same change
// to v2. Mig 324 did the one-time catch-up for rows written before this.
//
// Direction is v1 → v2 ONLY. v2 is the surface that is staying, so a change
// made THERE must never be dragged back into the system being retired.
//
// Every function is BEST-EFFORT: it logs and swallows. A v1 org edit must not
// fail because the mirror hit a constraint — the v1 write has already happened
// by the time these are called, and a 500 after a successful write would tell
// the admin a lie.
// ============================================================================
const { supabaseAdmin } = require('../config/database');
const logger = require('./logger');

// "Set exactly these companies for this manager", the same contract the v1
// endpoint has. company_id is the PK in both tables, so an upsert MOVES a
// company off whoever held it before — which is what one-manager-per-company
// means.
async function mirrorManagerCompanies(managerId, companyIds, actorId) {
  try {
    const ids = [...new Set((companyIds || []).filter(Boolean))];
    const now = new Date().toISOString();
    if (ids.length) {
      const { error } = await supabaseAdmin.from('qa2_manager_company').upsert(
        ids.map(cid => ({ company_id: cid, manager_id: managerId, assigned_by: actorId || null, assigned_at: now })),
        { onConflict: 'company_id' });
      if (error) throw new Error(error.message);
    }
    // anything this manager used to hold and no longer does
    const { data: existing } = await supabaseAdmin.from('qa2_manager_company')
      .select('company_id').eq('manager_id', managerId);
    const drop = (existing || []).map(r => r.company_id).filter(c => !ids.includes(c));
    if (drop.length) {
      await supabaseAdmin.from('qa2_manager_company').delete().eq('manager_id', managerId).in('company_id', drop);
    }
    logger.info('QA', `org mirror → v2: manager ${managerId} companies ${ids.length} (dropped ${drop.length})`);
  } catch (e) {
    logger.warn('QA', `org mirror → v2 companies failed for ${managerId}: ${e.message}`);
  }
}

// Same contract for the team. agent_id is the PK in both, so assigning an agent
// moves them off their previous manager.
async function mirrorManagerAgents(managerId, agentIds, actorId) {
  try {
    const ids = [...new Set((agentIds || []).filter(Boolean))];
    const now = new Date().toISOString();
    if (ids.length) {
      const { error } = await supabaseAdmin.from('qa2_team_member').upsert(
        ids.map(aid => ({ agent_id: aid, manager_id: managerId, assigned_by: actorId || null, assigned_at: now })),
        { onConflict: 'agent_id' });
      if (error) throw new Error(error.message);
    }
    const { data: existing } = await supabaseAdmin.from('qa2_team_member')
      .select('agent_id').eq('manager_id', managerId);
    const drop = (existing || []).map(r => r.agent_id).filter(a => !ids.includes(a));
    if (drop.length) {
      await supabaseAdmin.from('qa2_team_member').delete().eq('manager_id', managerId).in('agent_id', drop);
    }
    logger.info('QA', `org mirror → v2: manager ${managerId} agents ${ids.length} (dropped ${drop.length})`);
  } catch (e) {
    logger.warn('QA', `org mirror → v2 agents failed for ${managerId}: ${e.message}`);
  }
}

// The designation. v2 only models this for a compliance_manager — a real
// qa_manager already holds QA authority from their role, and
// POST /qa2/org/manager-access refuses anyone else — so for any other role
// this is deliberately a no-op rather than a bogus grant row.
async function mirrorDesignation(userId, enabled, actorId) {
  try {
    const { data: roleRow } = await supabaseAdmin.from('user_company_roles')
      .select('custom_roles(level)').eq('user_id', userId).eq('is_active', true).limit(1).maybeSingle();
    const level = Array.isArray(roleRow?.custom_roles) ? roleRow.custom_roles[0]?.level : roleRow?.custom_roles?.level;
    if (level !== 'compliance_manager') return;

    const { data: live } = await supabaseAdmin.from('qa2_manager_access')
      .select('id').eq('user_id', userId).is('revoked_at', null).maybeSingle();

    if (enabled && !live) {
      await supabaseAdmin.from('qa2_manager_access')
        .insert({ user_id: userId, granted_by: actorId || null, granted_at: new Date().toISOString() });
      logger.info('QA', `org mirror → v2: granted qa2 manager access to ${userId}`);
    } else if (!enabled && live) {
      await supabaseAdmin.from('qa2_manager_access')
        .update({ revoked_by: actorId || null, revoked_at: new Date().toISOString() }).eq('id', live.id);
      logger.info('QA', `org mirror → v2: revoked qa2 manager access for ${userId}`);
    }
  } catch (e) {
    logger.warn('QA', `org mirror → v2 designation failed for ${userId}: ${e.message}`);
  }
}

module.exports = { mirrorManagerCompanies, mirrorManagerAgents, mirrorDesignation };
