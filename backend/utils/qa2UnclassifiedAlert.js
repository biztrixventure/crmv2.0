// ============================================================================
// qa2UnclassifiedAlert.js — notifies a company's QA manager when their
// Unclassified pool (qa2_call.method_id IS NULL, qa_relevant = true) crosses
// a threshold. Locked-in decision (build brief Q5): a real notification, not
// just a tab badge — reuses the EXISTING notifications table (mig 004) and
// its dedup_key mechanism (mig 026), which already delivers over Supabase
// Realtime + Web Push via useNotifications.js. No new delivery pipeline.
//
// Dedup granularity is DAILY, not hourly like mig 026's own worked example
// (sale-approval-style one-off events) — a growing pool that's still over
// threshold shouldn't refire every hour, just once a day as a standing
// reminder until someone actually triages it down.
// ============================================================================

const { supabaseAdmin } = require('../config/database');
const { createNotification } = require('./notificationService');

const DEFAULT_THRESHOLD = 20;

async function checkUnclassifiedThreshold(companyId, { threshold = DEFAULT_THRESHOLD } = {}) {
  if (!companyId) return;

  const { count, error: countError } = await supabaseAdmin
    .from('qa2_call')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .is('method_id', null)
    .eq('qa_relevant', true);
  if (countError || !Number.isFinite(count) || count < threshold) return;

  const { data: mgr } = await supabaseAdmin
    .from('qa2_manager_company').select('manager_id').eq('company_id', companyId).maybeSingle();
  if (!mgr) return; // no QA manager assigned to this company yet -- nobody to alert

  const { data: company } = await supabaseAdmin.from('companies').select('name').eq('id', companyId).maybeSingle();
  const utcDay = new Date().toISOString().slice(0, 10);

  await createNotification({
    userId: mgr.manager_id,
    companyId,
    type: 'qa2_unclassified_threshold',
    title: 'QA v2: Unclassified calls piling up',
    message: `${company?.name || 'A company'} has ${count} unclassified calls waiting for triage.`,
    data: { company_id: companyId, count },
    dedupKey: `qa2_unclassified_threshold_${companyId}_${mgr.manager_id}_${utcDay}`,
  });
}

module.exports = { checkUnclassifiedThreshold, DEFAULT_THRESHOLD };
