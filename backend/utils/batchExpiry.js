// ============================================================================
// utils/batchExpiry.js — numbers that were LENT go home on their own.
//
// An assignment can carry a day/time limit (mig 322). When it passes, the
// numbers have to leave the person who was holding them: their copy is hidden,
// anyone THEY passed it on to loses it too, and the assigner's row unlocks so
// the number can be dealt again. All of that is one SQL function
// (fn_recall_batch_items, driven by fn_expire_batch_assignments) — this file
// only decides WHEN, and tells the people who just lost the numbers.
//
// Everything about it is idempotent: a batch is marked 'expired' in the same
// call that empties it, so a restart mid-sweep, a missed tick, or two ticks
// overlapping all converge on the same end state.
// ============================================================================
const { supabaseAdmin } = require('../config/database');
const notifications = require('./notificationService');
const logger = require('./logger');

// Per tick. A deadline is a business decision, not a millisecond one — 200
// batches per five-minute tick is far past anything the floor produces, and it
// caps one tick's work if a bulk edit ever sets many deadlines at once.
const PER_RUN = 200;

async function runBatchExpiry() {
  const { data, error } = await supabaseAdmin.rpc('fn_expire_batch_assignments', { p_limit: PER_RUN });
  if (error) {
    // Migration 322 not applied yet → the function does not exist. Warn and do
    // nothing: assignments simply stay permanent until it is applied, which is
    // exactly how they behaved before this feature existed.
    logger.warn('JOBS', `batch expiry skipped: ${error.message}`);
    return { expired: 0, recalled: 0 };
  }

  const rows = data || [];
  if (!rows.length) return { expired: 0, recalled: 0 };

  let recalled = 0;
  for (const r of rows) {
    const n = Number(r.recalled || 0);
    recalled += n;
    if (!r.holder_id) continue;
    // The holder watches these numbers disappear from My Numbers. Without this,
    // the only explanation available to them is "the CRM lost my list".
    notifications.notifyUsers([r.holder_id], {
      type: 'batch_recalled',
      title: 'Time limit reached',
      message: `The ${n} number${n === 1 ? '' : 's'} from "${r.batch_name}" went back — the time limit on them has passed.`,
      companyId: r.company_id || null,
      data: { batch_id: r.batch_id, kind: 'distribution_batch' },
      dedupBase: `expired_${r.batch_id}`,
    }).catch(() => {});
  }
  logger.info('JOBS', `batch expiry: ${rows.length} batch(es) hit their time limit, ${recalled} number(s) returned`);
  return { expired: rows.length, recalled };
}

module.exports = { runBatchExpiry };
