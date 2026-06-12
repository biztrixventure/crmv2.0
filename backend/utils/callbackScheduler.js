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
      .select('id, user_id, company_id, customer_name, customer_phone, callback_at, notes, customer_timezone, customer_state, customer_city')
      .eq('status', 'pending')
      .eq('notified', false)
      .lte('callback_at', soon.toISOString());

    if (error) {
      logger.warn('SCHEDULER', `Callback query error: ${error.message}`);
      return;
    }

    if (!due?.length) return;

    logger.info('SCHEDULER', `Processing ${due.length} due callback(s)`);

    // Fetch company timezones for all companies in this batch (agent's local time)
    const companyIds = [...new Set((due || []).map(c => c.company_id).filter(Boolean))];
    let companyTzMap = {};
    if (companyIds.length > 0) {
      const { data: companies } = await supabaseAdmin
        .from('companies').select('id, internal_timezone').in('id', companyIds);
      (companies || []).forEach(c => { companyTzMap[c.id] = c.internal_timezone || 'Asia/Karachi'; });
    }

    for (const cb of due) {
      try {
        // Build dual-timezone time string: customer local + agent local
        const agentTz    = companyTzMap[cb.company_id] || 'Asia/Karachi';
        const customerTz = cb.customer_timezone;
        let timeStr = '';
        if (cb.callback_at) {
          const fmtTime = (tz) => new Intl.DateTimeFormat('en-US', {
            timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: true,
          }).format(new Date(cb.callback_at));
          const fmtAbbr = (tz) => {
            const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(cb.callback_at));
            return parts.find(p => p.type === 'timeZoneName')?.value || '';
          };
          if (customerTz) {
            const custTime = `${fmtTime(customerTz)} ${fmtAbbr(customerTz)}`;
            const agentTime = `${fmtTime(agentTz)} ${fmtAbbr(agentTz)}`;
            timeStr = `${custTime} → ${agentTime} (you)`;
          } else {
            timeStr = `${fmtTime(agentTz)} ${fmtAbbr(agentTz)}`;
          }
        }

        const locationStr = [cb.customer_city, cb.customer_state].filter(Boolean).join(', ');
        const title = `📞 Callback: ${cb.customer_name}`;
        const message = [
          timeStr      || null,
          locationStr  || null,
          cb.customer_phone || null,
          cb.notes     || null,
        ].filter(Boolean).join(' · ') || 'Time for your scheduled callback';

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

// Post-dated sales: when a closer schedules a charge (post-date disposition),
// charge_at holds the date/time. Fire a one-time reminder to the closer when it
// comes due, then stamp charge_notified_at so it never repeats. Editing the
// charge date clears charge_notified_at (see PUT /sales/:id), re-arming this.
async function processDueCharges() {
  try {
    const soon = new Date(Date.now() + 60 * 1000).toISOString();
    const { data: due, error } = await supabaseAdmin
      .from('sales')
      .select('id, closer_id, company_id, customer_name, reference_no, charge_at')
      .not('charge_at', 'is', null)
      .is('charge_notified_at', null)
      .lte('charge_at', soon);

    if (error) { logger.warn('SCHEDULER', `Charge query error: ${error.message}`); return; }
    if (!due?.length) return;

    logger.info('SCHEDULER', `Processing ${due.length} due charge reminder(s)`);

    for (const s of due) {
      try {
        if (!s.closer_id) { // no one to notify — stamp so we don't re-scan it
          await supabaseAdmin.from('sales').update({ charge_notified_at: new Date().toISOString() }).eq('id', s.id);
          continue;
        }
        const whenStr = s.charge_at
          ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(s.charge_at))
          : '';
        const title   = `💳 Charge due: ${s.customer_name || 'sale'}`;
        const message = [whenStr || null, s.reference_no ? `Ref ${String(s.reference_no).toUpperCase()}` : null, 'Charge the card and move it to Sale.']
          .filter(Boolean).join(' · ');

        await supabaseAdmin.from('notifications').insert({
          user_id: s.closer_id, company_id: s.company_id, type: 'charge_due',
          title, message, data: { sale_id: s.id, charge_at: s.charge_at }, is_read: false,
        });
        await sendPushToUser(s.closer_id, {
          title, body: message, tag: `charge-${s.id}`, requireInteraction: true,
          data: { type: 'charge_due', sale_id: s.id },
        });
        await supabaseAdmin.from('sales').update({ charge_notified_at: new Date().toISOString() }).eq('id', s.id);
      } catch (e) {
        logger.warn('SCHEDULER', `Failed to process charge reminder ${s.id}: ${e.message}`);
      }
    }
  } catch (err) {
    logger.warn('SCHEDULER', `processDueCharges error: ${err.message}`);
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
    await processDueCharges();
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
