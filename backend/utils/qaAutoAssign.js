// ============================================================================
// utils/qaAutoAssign.js — coverage-driven routing for QA tasks.
//
// "Coverage" = the qa_agent_methods rows: an agent bound to (company, method) is
// declared responsible for that company's calls of that method. This module
// distributes UNASSIGNED, still-pending QA tasks to the covering agents,
// round-robin (balanced), so materialized work reaches the right people
// automatically instead of sitting in an unassigned pool until it is purged.
//
// Safe by construction: if a company/method has no covering agent, its tasks are
// left in the pool for a manager to hand-assign. Everything is wrapped so a
// missing table never breaks materialization.
// ============================================================================
const { supabaseAdmin } = require('../config/database');
const logger = require('./logger');

// Distribute one company's unassigned pending tasks to its covering agents —
// least-loaded first, and NEVER past the reviewer cap (qa.reviewer_cap): a
// backlog trickles onto plates as reviews get scored instead of burying anyone.
// Returns { assigned, byMethod:{tra,rcm}, byAgent:{uid:n}, held }.
async function autoAssignCompany(companyId, { assignedBy = null } = {}) {
  const result = { assigned: 0, byMethod: {}, byAgent: {}, held: 0 };
  if (!companyId) return result;
  try {
    // lazy require avoids any load-order coupling with qaRules
    const { reviewerCap, openCounts } = require('./qaRules');
    // coverage: method -> [user_id]
    const { data: cov, error: covErr } = await supabaseAdmin
      .from('qa_agent_methods').select('user_id, method').eq('company_id', companyId);
    if (covErr) { logger.warn('QA_ASSIGN', `coverage ${companyId}: ${covErr.message}`); return result; }
    const agentsByMethod = {};
    for (const r of (cov || [])) (agentsByMethod[r.method] ||= []).push(r.user_id);
    const allAgents = [...new Set(Object.values(agentsByMethod).flat())];
    if (!allAgents.length) return result;

    const cap = await reviewerCap(companyId);
    const open = await openCounts(allAgents);
    const extra = {};                                  // picks made this run
    const load = (uid) => (open[uid] || 0) + (extra[uid] || 0);

    for (const method of Object.keys(agentsByMethod)) {
      const agents = [...new Set(agentsByMethod[method])];
      if (!agents.length) continue;

      // The company's unassigned, still-pending tasks for this method — oldest
      // first so the longest-waiting calls are routed first.
      const { data: tasks, error: tErr } = await supabaseAdmin
        .from('qa_assignments').select('id')
        .eq('company_id', companyId).eq('method', method)
        .eq('status', 'pending').is('assigned_to', null)
        .order('created_at', { ascending: true }).limit(5000);
      if (tErr) { logger.warn('QA_ASSIGN', `tasks ${companyId}/${method}: ${tErr.message}`); continue; }
      if (!tasks || !tasks.length) continue;

      // least-loaded pick per task, capped — leftover stays in the pool
      const buckets = {};   // uid -> [task ids]
      for (const t of tasks) {
        const free = agents.filter(a => load(a) < cap);
        if (!free.length) { result.held += 1; continue; }
        free.sort((a, b) => load(a) - load(b));
        const uid = free[0];
        (buckets[uid] ||= []).push(t.id);
        extra[uid] = (extra[uid] || 0) + 1;
      }
      const stamp = new Date().toISOString();
      for (const [uid, ids] of Object.entries(buckets)) {
        const patch = { assigned_to: uid, assigned_at: stamp };
        if (assignedBy) patch.assigned_by = assignedBy;
        const { error } = await supabaseAdmin.from('qa_assignments').update(patch).in('id', ids);
        if (error) { logger.warn('QA_ASSIGN', `assign ${companyId}/${method} → ${uid}: ${error.message}`); extra[uid] -= ids.length; continue; }
        result.assigned += ids.length;
        result.byMethod[method] = (result.byMethod[method] || 0) + ids.length;
        result.byAgent[uid] = (result.byAgent[uid] || 0) + ids.length;
      }
    }
    if (result.held) logger.info('QA_ASSIGN', `${companyId}: ${result.held} task(s) held — reviewer caps keep queues light`);
  } catch (e) { logger.warn('QA_ASSIGN', `autoAssignCompany ${companyId}: ${e.message}`); }
  return result;
}

module.exports = { autoAssignCompany };
