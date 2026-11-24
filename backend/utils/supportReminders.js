// ============================================================================
// supportReminders.js -- "your follow-up is due" for the support desk.
//
// A support agent logs a call and picks a follow-up time. When that time
// arrives they get a bell notification and a push, once. Run every minute from
// utils/scheduler.js, so a reminder lands within a minute of the time chosen.
//
// ONE RING PER FOLLOW-UP. retention_cases.follow_up_notified_at is stamped in
// the same UPDATE that claims the row (`... WHERE follow_up_notified_at IS
// NULL`), so two server instances -- or a slow run overlapping the next --
// cannot both send it. Logging the next call clears the stamp (routes/support.js),
// which is what re-arms the reminder for the new time.
//
// A follow-up that came due while the server was down is still sent when it
// comes back, but only if it is less than a day old: nobody wants last week's
// reminders arriving in a burst after a deploy.
// ============================================================================
const { supabaseAdmin } = require('../config/database');
const notifications = require('./notificationService');
const logger = require('./logger');

const BATCH = 100;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

let _warnedMissing = false;

// `onlyAgentIds` exists for tests: without it a test run claims (and, with
// notifications stubbed, swallows) the reminders of real agents.
async function runSupportFollowUpReminders(now = new Date(), { onlyAgentIds = null } = {}) {
  const nowIso = now.toISOString();
  let q = supabaseAdmin
    .from('retention_cases')
    .select('id, sale_id, agent_id, company_id, customer_name, client_name, next_follow_up_at')
    .in('status', ['open', 'saved'])
    .is('follow_up_notified_at', null)
    .not('next_follow_up_at', 'is', null)
    .lte('next_follow_up_at', nowIso)
    .gte('next_follow_up_at', new Date(now.getTime() - MAX_AGE_MS).toISOString())
    .order('next_follow_up_at', { ascending: true })
    .limit(BATCH);
  if (onlyAgentIds) q = q.in('agent_id', onlyAgentIds);
  const { data: due, error } = await q;

  if (error) {
    // Backend deployed before mig 357: say so once, not every minute.
    if (!_warnedMissing) { _warnedMissing = true; logger.warn('SUPPORT', `follow-up reminders unavailable: ${error.message}`); }
    return { sent: 0 };
  }

  let sent = 0;
  for (const c of due || []) {
    // Claim first, send second: only the run that wins this UPDATE notifies.
    const { data: claimed } = await supabaseAdmin
      .from('retention_cases')
      .update({ follow_up_notified_at: nowIso })
      .eq('id', c.id).is('follow_up_notified_at', null)
      .select('id');
    if (!claimed?.length) continue;

    try {
      await notifications.notifyUsers([c.agent_id], {
        companyId: c.company_id || null,
        type: 'support_followup_due',
        title: 'Follow-up due now',
        message: `Time to call ${c.customer_name || 'your customer'}${c.client_name ? ` (${c.client_name})` : ''}.`,
        data: { case_id: c.id, sale_id: c.sale_id },
      });
      sent++;
    } catch (e) {
      logger.warn('SUPPORT', `follow-up notify failed for case ${c.id}: ${e.message}`);
    }
  }
  if (sent) logger.info('SUPPORT', `follow-up reminders sent: ${sent}`);
  return { sent };
}

module.exports = { runSupportFollowUpReminders };
