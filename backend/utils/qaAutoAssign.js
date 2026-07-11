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

// Distribute one company's unassigned pending tasks to its covering agents.
// Returns { assigned, byMethod:{tra,rcm}, byAgent:{uid:n} }.
async function autoAssignCompany(companyId, { assignedBy = null } = {}) {
  const result = { assigned: 0, byMethod: {}, byAgent: {} };
  if (!companyId) return result;
  try {
    // coverage: method -> [user_id]
    const { data: cov, error: covErr } = await supabaseAdmin
      .from('qa_agent_methods').select('user_id, method').eq('company_id', companyId);
    if (covErr) { logger.warn('QA_ASSIGN', `coverage ${companyId}: ${covErr.message}`); return result; }
    const agentsByMethod = {};
    for (const r of (cov || [])) (agentsByMethod[r.method] ||= []).push(r.user_id);

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

      // round-robin the task ids across the covering agents (even load)
      const buckets = agents.map(() => []);
      tasks.forEach((t, i) => buckets[i % agents.length].push(t.id));
      const stamp = new Date().toISOString();
      for (let i = 0; i < agents.length; i++) {
        if (!buckets[i].length) continue;
        const patch = { assigned_to: agents[i], assigned_at: stamp };
        if (assignedBy) patch.assigned_by = assignedBy;
        const { error } = await supabaseAdmin.from('qa_assignments').update(patch).in('id', buckets[i]);
        if (error) { logger.warn('QA_ASSIGN', `assign ${companyId}/${method} → ${agents[i]}: ${error.message}`); continue; }
        result.assigned += buckets[i].length;
        result.byMethod[method] = (result.byMethod[method] || 0) + buckets[i].length;
        result.byAgent[agents[i]] = (result.byAgent[agents[i]] || 0) + buckets[i].length;
      }
    }
  } catch (e) { logger.warn('QA_ASSIGN', `autoAssignCompany ${companyId}: ${e.message}`); }
  return result;
}

module.exports = { autoAssignCompany };
