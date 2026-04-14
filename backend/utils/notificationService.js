/**
 * Notification Service
 * Creates notifications for business events — fired from route handlers.
 *
 * Notification types:
 *   transfer_created   — fronter created a transfer → managers notified
 *   transfer_assigned  — manager assigned to closer → closer notified
 *   sale_created       — closer created a sale → fronter + managers notified
 *   sale_updated       — sale status changed → managers notified
 */

const { supabaseAdmin } = require('../config/database');
const logger = require('./logger');

// Role levels considered "management" for company-level notifications
const MANAGER_LEVELS = ['superadmin', 'readonly_admin', 'company_admin', 'manager', 'closer_manager', 'operations_manager'];

/**
 * Insert a single notification row.
 */
async function createNotification({ userId, companyId, type, title, message, data }) {
  const { error } = await supabaseAdmin.from('notifications').insert({
    user_id: userId,
    company_id: companyId || null,
    type,
    title,
    message: message || null,
    data: data || null,
    is_read: false,
  });
  if (error) {
    logger.warn('NOTIFICATIONS', `Failed to create notification for user ${userId}`, { error: error.message });
  }
}

/**
 * Notify all manager-level users in a company.
 */
async function notifyManagers(companyId, { type, title, message, data }) {
  try {
    // Find all active manager-level users in this company
    const { data: managers, error } = await supabaseAdmin
      .from('user_company_roles')
      .select('user_id, custom_roles(level)')
      .eq('company_id', companyId)
      .eq('is_active', true);

    if (error || !managers) return;

    const managerIds = managers
      .filter(m => MANAGER_LEVELS.includes(m.custom_roles?.level))
      .map(m => m.user_id);

    if (managerIds.length === 0) return;

    const rows = managerIds.map(uid => ({
      user_id: uid,
      company_id: companyId,
      type,
      title,
      message: message || null,
      data: data || null,
      is_read: false,
    }));

    const { error: insertErr } = await supabaseAdmin.from('notifications').insert(rows);
    if (insertErr) logger.warn('NOTIFICATIONS', 'Failed to notify managers', { error: insertErr.message });
  } catch (err) {
    logger.warn('NOTIFICATIONS', 'notifyManagers threw', { error: err.message });
  }
}

// ============================================================================
// Business event notification creators
// ============================================================================

/**
 * A fronter created a new transfer.
 * Notify all managers of the company.
 */
async function onTransferCreated({ transfer, fronterName }) {
  const customerName = transfer.form_data?.customer_name || 'Unknown Customer';
  await notifyManagers(transfer.company_id, {
    type: 'transfer_created',
    title: 'New transfer created',
    message: `${fronterName} submitted a transfer for ${customerName}.`,
    data: { transfer_id: transfer.id, customer_name: customerName },
  });
}

/**
 * A transfer was assigned to a closer.
 * Notify the closer.
 */
async function onTransferAssigned({ transfer, closerUserId }) {
  const customerName = transfer.form_data?.customer_name || 'Unknown Customer';
  await createNotification({
    userId: closerUserId,
    companyId: transfer.company_id,
    type: 'transfer_assigned',
    title: 'Transfer assigned to you',
    message: `A transfer for ${customerName} has been assigned to you.`,
    data: { transfer_id: transfer.id, customer_name: customerName },
  });
}

/**
 * A closer created a sale.
 * Notify the fronter of the original transfer + all managers.
 */
async function onSaleCreated({ sale, fronterUserId }) {
  const customerName = sale.customer_name || 'Unknown Customer';
  const refNo = sale.reference_no || sale.id.slice(0, 8).toUpperCase();

  // Notify the fronter
  if (fronterUserId) {
    await createNotification({
      userId: fronterUserId,
      companyId: sale.company_id,
      type: 'sale_created',
      title: 'Your transfer became a sale! 🎉',
      message: `${customerName} — Ref: ${refNo} has been closed as a sale.`,
      data: { sale_id: sale.id, reference_no: refNo, customer_name: customerName },
    });
  }

  // Notify managers
  await notifyManagers(sale.company_id, {
    type: 'sale_created',
    title: 'New sale created',
    message: `${customerName} — Ref: ${refNo} was closed by the closer team.`,
    data: { sale_id: sale.id, reference_no: refNo, customer_name: customerName },
  });
}

/**
 * A sale's status was updated (e.g. status change).
 * Notify managers.
 */
async function onSaleUpdated({ sale, updaterName }) {
  const customerName = sale.customer_name || 'Unknown Customer';
  const refNo = sale.reference_no || sale.id.slice(0, 8).toUpperCase();

  await notifyManagers(sale.company_id, {
    type: 'sale_updated',
    title: `Sale updated — ${sale.status?.toUpperCase()}`,
    message: `${updaterName} updated sale for ${customerName} (Ref: ${refNo}) to ${sale.status?.toUpperCase()}.`,
    data: { sale_id: sale.id, reference_no: refNo, status: sale.status },
  });
}

module.exports = {
  onTransferCreated,
  onTransferAssigned,
  onSaleCreated,
  onSaleUpdated,
};
