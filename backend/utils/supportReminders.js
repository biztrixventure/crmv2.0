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

// ── First-monthly digest (mig 359) ──────────────────────────────────────────
// Once a day, from 9am US Eastern, each support agent who has first-monthly
// calls due today is told how many. The support_fm_digest row IS the claim
// (primary key agent + day): insert first, send only if the insert won, so
// two instances cannot both ring. An agent with nothing due is not claimed --
// a policy keyed later that day can still produce a reminder.
const fm = require('./firstMonthly');
const etParts = (now) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
};

let _warnedFm = false;
async function runFirstMonthlyDigest(now = new Date(), { onlyAgentIds = null, anyHour = false } = {}) {
  const { day, hour } = etParts(now);
  if (!anyHour && hour < 9) return { sent: 0 };

  let q = supabaseAdmin.from('support_agent_clients').select('user_id, client_name');
  if (onlyAgentIds) q = q.in('user_id', onlyAgentIds);
  const { data: rows, error } = await q;
  if (error) return { sent: 0 };
  const clientsBy = {};
  (rows || []).forEach(r => { (clientsBy[r.user_id] = clientsBy[r.user_id] || []).push(r.client_name); });
  const agentIds = Object.keys(clientsBy);
  if (!agentIds.length) return { sent: 0 };

  const { data: already, error: dErr } = await supabaseAdmin
    .from('support_fm_digest').select('agent_id').eq('day', day).in('agent_id', agentIds);
  if (dErr) {
    if (!_warnedFm) { _warnedFm = true; logger.warn('SUPPORT', `first-monthly digest unavailable: ${dErr.message}`); }
    return { sent: 0 };
  }
  const done = new Set((already || []).map(r => r.agent_id));

  let sent = 0;
  for (const agentId of agentIds) {
    if (done.has(agentId)) continue;
    let due;
    try {
      const list = await fm.listFirstMonthly({ clients: clientsBy[agentId], from: fm.addDays(day, -7), to: fm.addDays(day, 7), today: day });
      due = list.filter(r => r.needs_action).length;
    } catch (e) { logger.warn('SUPPORT', `first-monthly digest failed for ${agentId}: ${e.message}`); continue; }
    if (!due) continue;

    const { error: claimErr } = await supabaseAdmin.from('support_fm_digest').insert({ agent_id: agentId, day, due });
    if (claimErr) continue;              // 23505 = another instance has it
    try {
      await notifications.notifyUsers([agentId], {
        companyId: null,
        type: 'support_first_monthly_due',
        title: 'First monthly calls due today',
        message: `${due} customer${due === 1 ? '' : 's'} to call before the first monthly payment. Open First Monthly.`,
        data: { due, day },
      });
      sent++;
    } catch (e) { logger.warn('SUPPORT', `first-monthly notify failed for ${agentId}: ${e.message}`); }
  }
  if (sent) logger.info('SUPPORT', `first-monthly digests sent: ${sent}`);
  return { sent };
}

module.exports = { runSupportFollowUpReminders, runFirstMonthlyDigest };
