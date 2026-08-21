// ============================================================================
// utils/scheduler.js — background jobs (in-process cron).
//
// Runs in the single Express process (same model as callbackScheduler):
//   • refresh the v_customer_segments materialized view (so the Customer
//     Profiles browser reads pre-aggregated, indexed rows — fast)
//   • sweep expired in-process cache entries (memory hygiene)
//
// Every job is wrapped in try/catch so a failure can never crash the process or
// stop the other jobs. started once from server.js via startBackgroundJobs().
// ============================================================================
const { supabaseAdmin } = require('../config/database');
const cache = require('./cache');
const logger = require('./logger');
const { runPaymentReminderScan } = require('./paymentReminders');
const { runQaMaterialization } = require('./qaMaterializer');
const { sweepMilestones } = require('./quotaMilestoneWatcher');
const { pollPendingRecordings } = require('./qa2RecordingPoller');
const { runQa2AutoAssign, purgeStaleQa2Assignments, purgeParkedQa2Calls } = require('./qa2AutoAssign');
const { runCrmDayForAllCompanies } = require('./qa2CrmDay');

const REFRESH_SEGMENTS_MS = 10 * 60 * 1000;     // every 10 min
const CACHE_SWEEP_MS      = 5  * 60 * 1000;      // every 5 min
const INITIAL_REFRESH_MS  = 60 * 1000;          // one refresh ~1 min after boot
const PAYMENT_SCAN_MS     = 3 * 60 * 60 * 1000; // monthly-payment scan every 3h
const PAYMENT_SCAN_INIT   = 90 * 1000;          // first scan ~90s after boot
const MILESTONE_SWEEP_MS   = 10 * 60 * 1000;    // quota milestone ladder, every 10 min
const MILESTONE_SWEEP_INIT = 2 * 60 * 1000;     // first sweep ~2 min after boot
// QA worklist materialization. Hourly: TRA coverage should track new transfers
// within ~an hour (review work, not real-time), and RCM only acts once per
// completed period (frozen guard makes the extra ticks cheap no-ops). Raise to
// daily if hourly proves too eager. First run ~2 min after boot.
const QA_MATERIALIZE_MS   = 60 * 60 * 1000;
const QA_MATERIALIZE_INIT = 2 * 60 * 1000;
// QA v2 recording attachment poller (build brief 7.2). 60s — recordings land
// on the dialer ~60-90s after hangup, and this is what makes same-day
// scoring possible (v1's equivalent only ran hourly).
const QA2_REC_POLL_MS   = 60 * 1000;
const QA2_REC_POLL_INIT = 30 * 1000;
// QA v2 sampling-rule pool fill (build brief Phase 8). 5 min — frequent
// enough that a newly-classified call reaches the pool same-shift, cheap
// enough not to matter at ~80 calls/day scale.
const QA2_AUTOASSIGN_MS   = 5 * 60 * 1000;
const QA2_AUTOASSIGN_INIT = 90 * 1000;
// QA v2 retention purge — matches v1's mig 177 cadence (hourly) exactly.
const QA2_RETENTION_MS   = 60 * 60 * 1000;
const QA2_RETENTION_INIT = 3 * 60 * 1000;
// QA v2 day-1 CRM population (qa2CrmDay.js). No wall-clock cron in this
// scheduler — everything runs on a fixed interval since boot — so this ticks
// every 2h; populateCrmDay's own dedup makes a repeat call for the same day a
// fast no-op, which is what gives "runs once a day" behavior without needing
// real cron. First run 4 min after boot.
const QA2_CRMDAY_MS   = 2 * 60 * 60 * 1000;
const QA2_CRMDAY_INIT = 4 * 60 * 1000;

let _timers = [];

async function refreshCustomerSegments() {
  try {
    const { error } = await supabaseAdmin.rpc('refresh_customer_segments');
    if (error) {
      // Function/matview not present yet (migration 137 not applied) is fine —
      // the browse endpoint falls back to the live search. Log softly.
      logger.warn('JOBS', `customer-segments refresh skipped: ${error.message}`);
    } else {
      logger.debug('JOBS', 'customer-segments matview refreshed');
    }
  } catch (e) {
    logger.warn('JOBS', `customer-segments refresh error: ${e.message}`);
  }
}

function startBackgroundJobs() {
  // Initial refresh shortly after boot (catches data written since the last
  // refresh / since the migration populated it), then on a fixed cadence.
  _timers.push(setTimeout(refreshCustomerSegments, INITIAL_REFRESH_MS));
  _timers.push(setInterval(refreshCustomerSegments, REFRESH_SEGMENTS_MS));

  _timers.push(setInterval(() => {
    try {
      const purged = cache.sweep();
      if (purged) logger.debug('JOBS', `cache sweep purged ${purged} expired entries`);
    } catch (e) { logger.warn('JOBS', `cache sweep error: ${e.message}`); }
  }, CACHE_SWEEP_MS));

  // Monthly-payment retention scan — upserts follow-ups + fires reminder
  // notifications at the configured offsets. Idempotent (dedupKey), so the 3h
  // cadence is safe. Honors payment_reminder.enabled.
  const scan = () => runPaymentReminderScan().catch(e => logger.warn('JOBS', `payment scan error: ${e.message}`));
  _timers.push(setTimeout(scan, PAYMENT_SCAN_INIT));
  _timers.push(setInterval(scan, PAYMENT_SCAN_MS));

  // QA worklist materialization (TRA full coverage + RCM frozen sampling).
  // No-op unless a company has QA explicitly enabled (mig 171 default is off).
  const qa = () => runQaMaterialization().catch(e => logger.warn('JOBS', `qa materialize error: ${e.message}`));
  _timers.push(setTimeout(qa, QA_MATERIALIZE_INIT));
  _timers.push(setInterval(qa, QA_MATERIALIZE_MS));

  // Quota milestone ladder (mig 218). Milestones are scored live, so this
  // re-detects the same earned milestone every run — the permanent dedup key in
  // onQuotaMilestoneEarned is what makes that a no-op after the first crossing.
  // 10 minutes is the useful resolution: a prize that lands within ten minutes
  // of the sale being approved still feels immediate, and a tighter loop would
  // re-count every live quota for nothing.
  const ms = () => sweepMilestones().catch(e => logger.warn('JOBS', `milestone sweep error: ${e.message}`));
  _timers.push(setTimeout(ms, MILESTONE_SWEEP_INIT));
  _timers.push(setInterval(ms, MILESTONE_SWEEP_MS));

  // QA v2 recording poller — attaches a found clip to any qa2_call still
  // waiting on one (recording_state='pending'), or gives up after 10 tries.
  const rec2 = () => pollPendingRecordings().catch(e => logger.warn('JOBS', `qa2 recording poll error: ${e.message}`));
  _timers.push(setTimeout(rec2, QA2_REC_POLL_INIT));
  _timers.push(setInterval(rec2, QA2_REC_POLL_MS));

  // QA v2 sampling-driven pool fill + ageing purge (Phase 8). No-op unless a
  // company has active qa2_sampling_rule rows — same "off by default until
  // configured" posture as everything else in this scheduler.
  const auto2 = () => runQa2AutoAssign().catch(e => logger.warn('JOBS', `qa2 auto-assign error: ${e.message}`));
  _timers.push(setTimeout(auto2, QA2_AUTOASSIGN_INIT));
  _timers.push(setInterval(auto2, QA2_AUTOASSIGN_MS));

  const ret2 = () => Promise.all([
    purgeStaleQa2Assignments(),
    purgeParkedQa2Calls(),          // parked (non-reviewable) calls — mig 266
  ]).catch(e => logger.warn('JOBS', `qa2 retention purge error: ${e.message}`));
  _timers.push(setTimeout(ret2, QA2_RETENTION_INIT));
  _timers.push(setInterval(ret2, QA2_RETENTION_MS));

  // QA v2 day-1 CRM population — pulls yesterday's transfers/sales (per
  // company with a QA v2 manager assigned) straight from the CRM, same as
  // ingest/sweep but reading real records instead of the dialer.
  const crmDay2 = () => runCrmDayForAllCompanies().catch(e => logger.warn('JOBS', `qa2 crm-day error: ${e.message}`));
  _timers.push(setTimeout(crmDay2, QA2_CRMDAY_INIT));
  _timers.push(setInterval(crmDay2, QA2_CRMDAY_MS));

  logger.info('JOBS', `background jobs started — segments refresh ${REFRESH_SEGMENTS_MS / 60000}m, cache sweep ${CACHE_SWEEP_MS / 60000}m, payment scan ${PAYMENT_SCAN_MS / 3600000}h, qa materialize ${QA_MATERIALIZE_MS / 60000}m, milestone sweep ${MILESTONE_SWEEP_MS / 60000}m, qa2 recording poll ${QA2_REC_POLL_MS / 1000}s, qa2 auto-assign ${QA2_AUTOASSIGN_MS / 60000}m, qa2 retention ${QA2_RETENTION_MS / 3600000}h, qa2 crm-day ${QA2_CRMDAY_MS / 3600000}h`);
}

function stopBackgroundJobs() {
  _timers.forEach(t => { clearInterval(t); clearTimeout(t); });
  _timers = [];
}

module.exports = { startBackgroundJobs, stopBackgroundJobs, refreshCustomerSegments, runQaMaterialization };
