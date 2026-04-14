/**
 * Callback Scheduler
 * Runs every 60 seconds, finds callbacks due within the next minute,
 * creates in-app notifications, and sends Web Push to the user's browser.
 */
const { supabaseAdmin } = require('../config/database');
const { sendPushToUser } = require('./pushService');
const logger = require('./logger');

let schedulerInterval = null;

async function processDueCallbacks() {
  try {
    const now = new Date();
    const soon = new Date(now.getTime() + 60 * 1000); // next 60 seconds

    // Find all pending, un-notified callbacks due right now or overdue
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
      const time = new Date(cb.callback_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const title = `📞 Callback Due: ${cb.customer_name}`;
      const message = `${cb.customer_phone ? cb.customer_phone + ' — ' : ''}${cb.notes || 'No notes'} at ${time}`;

      // 1. Create in-app notification
      await supabaseAdmin.from('notifications').insert({
        user_id:    cb.user_id,
        company_id: cb.company_id,
        type:       'callback_due',
        title,
        message,
        data: {
          callback_id:   cb.id,
          customer_name: cb.customer_name,
          customer_phone: cb.customer_phone,
          callback_at:   cb.callback_at,
        },
        is_read: false,
      });

      // 2. Send Web Push (OS notification)
      await sendPushToUser(cb.user_id, {
        title,
        body: message,
        tag:  `callback-${cb.id}`,
        data: { type: 'callback_due', callback_id: cb.id },
      });

      // 3. Mark notified so we don't fire again
      await supabaseAdmin
        .from('callbacks')
        .update({ notified: true })
        .eq('id', cb.id);
    }
  } catch (err) {
    logger.warn('SCHEDULER', `processDueCallbacks error: ${err.message}`);
  }
}

function startCallbackScheduler() {
  if (schedulerInterval) return;
  logger.info('SCHEDULER', 'Callback scheduler started (60s interval)');
  // Run once immediately, then every 60 seconds
  processDueCallbacks();
  schedulerInterval = setInterval(processDueCallbacks, 60 * 1000);
}

function stopCallbackScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

module.exports = { startCallbackScheduler, stopCallbackScheduler };
