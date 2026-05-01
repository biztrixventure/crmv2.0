/**
 * Callback Scheduler
 * Runs every 60 seconds:
 *  1. Notifies users of due callbacks
 *  2. Expires callback_numbers past 7-day lock → claimable
 *  3. Releases callback_numbers past 30-day limit → released
 */
const { supabaseAdmin } = require('../config/database');
const { sendPushToUser } = require('./pushService');
const logger = require('./logger');

let schedulerInterval = null;
let isRunning         = false; // prevents overlapping ticks

async function processDueCallbacks() {
  try {
    const now  = new Date();
    const soon = new Date(now.getTime() + 60 * 1000);

    const { data: due, error } = await supabaseAdmin
      .from('callbacks')
      .select('id, user_id, company_id, customer_name, customer_phone, callback_at, notes')
      .eq('status', 'pending')
      .eq('notified', false)
      .lte('callback_at', soon.toISOString());

    if (error) {
      logger.warn('SCHEDULER', `Callback query error: ${error.message}`);
      return;
    }

    if (!due?.length) return;

    logger.info('SCHEDULER', `Processing ${due.length} due callback(s)`);

    for (const cb of due) {
      try {
        const title   = `📞 Callback: ${cb.customer_name}`;
        const message = [
          cb.customer_phone || null,
          cb.notes          || null,
        ].filter(Boolean).join(' — ') || 'Time for your scheduled callback';

        // 1. Create in-app notification
        const { error: notifErr } = await supabaseAdmin.from('notifications').insert({
          user_id:    cb.user_id,
          company_id: cb.company_id,
          type:       'callback_due',
          title,
          message,
          data: {
            callback_id:    cb.id,
            customer_name:  cb.customer_name,
            customer_phone: cb.customer_phone,
            callback_at:    cb.callback_at,
          },
          is_read: false,
        });
        if (notifErr) logger.warn('SCHEDULER', `Notification insert error for ${cb.id}: ${notifErr.message}`);

        // 2. Send Web Push
        await sendPushToUser(cb.user_id, {
          title,
          body:               message,
          tag:                `callback-${cb.id}`,
          requireInteraction: true,
          data:               { type: 'callback_due', callback_id: cb.id },
        });

        // 3. Mark notified so we don't fire again
        await supabaseAdmin
          .from('callbacks')
          .update({ notified: true })
          .eq('id', cb.id);

      } catch (cbErr) {
        logger.warn('SCHEDULER', `Failed to process callback ${cb.id}: ${cbErr.message}`);
      }
    }
  } catch (err) {
    logger.warn('SCHEDULER', `processDueCallbacks error: ${err.message}`);
  }
}

async function processCallbackNumberExpiry() {
  try {
    const now = new Date().toISOString();

    // 1. Active numbers past locked_until → claimable
    const { data: toClaimable } = await supabaseAdmin
      .from('callback_numbers')
      .select('id, phone_number, customer_name, company_id, owner_id')
      .eq('status', 'active')
      .lt('locked_until', now);

    if (toClaimable?.length) {
      const ids = toClaimable.map(n => n.id);
      await supabaseAdmin
        .from('callback_numbers')
        .update({ status: 'claimable', updated_at: now })
        .in('id', ids);

      const byCompany = {};
      toClaimable.forEach(n => {
        if (!byCompany[n.company_id]) byCompany[n.company_id] = [];
        byCompany[n.company_id].push(n);
      });

      for (const [companyId, nums] of Object.entries(byCompany)) {
        const { data: mgrs } = await supabaseAdmin
          .from('user_company_roles')
          .select('user_id, custom_roles(level)')
          .eq('company_id', companyId)
          .eq('is_active', true);

        const MANAGER_LEVELS = ['company_admin', 'manager', 'operations_manager', 'closer_manager', 'fronter_manager'];
        const mgrIds = (mgrs || [])
          .filter(r => MANAGER_LEVELS.includes(r.custom_roles?.level))
          .map(r => r.user_id);

        for (const mgrId of mgrIds) {
          for (const n of nums) {
            await supabaseAdmin.from('notifications').insert({
              user_id:    mgrId,
              company_id: companyId,
              type:       'number_claimable',
              title:      `📞 Number Now Claimable`,
              message:    `${n.customer_name || n.phone_number} (${n.phone_number}) — no contact for 7 days, available to claim.`,
              data:       { callback_number_id: n.id, phone_number: n.phone_number },
              is_read:    false,
            });
          }
        }
        logger.info('SCHEDULER', `${nums.length} number(s) → claimable in company ${companyId}`);
      }
    }

    // 2. Active/claimable numbers past release_at → released
    const { data: toRelease } = await supabaseAdmin
      .from('callback_numbers')
      .select('id, phone_number, customer_name, company_id, owner_id')
      .in('status', ['active', 'claimable'])
      .lt('release_at', now);

    if (toRelease?.length) {
      const ids = toRelease.map(n => n.id);
      await supabaseAdmin
        .from('callback_numbers')
        .update({ status: 'released', owner_id: null, updated_at: now })
        .in('id', ids);

      await supabaseAdmin
        .from('callback_number_claims')
        .update({ owned_until: now, release_reason: 'inactivity_30d' })
        .in('callback_number_id', ids)
        .is('owned_until', null);

      logger.info('SCHEDULER', `${toRelease.length} number(s) auto-released (30-day expiry)`);
    }
  } catch (err) {
    logger.warn('SCHEDULER', `processCallbackNumberExpiry error: ${err.message}`);
  }
}

async function runAll() {
  // Guard: skip if a previous tick is still executing.
  // Without this, slow DB or push sends can cause overlapping runs
  // that produce duplicate callback notifications.
  if (isRunning) {
    logger.info('SCHEDULER', 'Previous tick still running — skipping');
    return;
  }
  isRunning = true;
  try {
    await processDueCallbacks();
    await processCallbackNumberExpiry();
  } finally {
    isRunning = false;
  }
}

function startCallbackScheduler() {
  if (schedulerInterval) return;
  logger.info('SCHEDULER', 'Callback scheduler started (60s interval)');
  runAll();
  schedulerInterval = setInterval(runAll, 60 * 1000);
}

function stopCallbackScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

module.exports = { startCallbackScheduler, stopCallbackScheduler };
