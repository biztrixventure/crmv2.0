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

const REFRESH_SEGMENTS_MS = 10 * 60 * 1000;     // every 10 min
const CACHE_SWEEP_MS      = 5  * 60 * 1000;      // every 5 min
const INITIAL_REFRESH_MS  = 60 * 1000;          // one refresh ~1 min after boot
const PAYMENT_SCAN_MS     = 3 * 60 * 60 * 1000; // monthly-payment scan every 3h
const PAYMENT_SCAN_INIT   = 90 * 1000;          // first scan ~90s after boot

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

  logger.info('JOBS', `background jobs started — segments refresh ${REFRESH_SEGMENTS_MS / 60000}m, cache sweep ${CACHE_SWEEP_MS / 60000}m, payment scan ${PAYMENT_SCAN_MS / 3600000}h`);
}

function stopBackgroundJobs() {
  _timers.forEach(t => { clearInterval(t); clearTimeout(t); });
  _timers = [];
}

module.exports = { startBackgroundJobs, stopBackgroundJobs, refreshCustomerSegments };
