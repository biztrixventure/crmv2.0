/**
 * Notification Service
 * Creates in-app notifications + fires Web Push for business events.
 *
 * Events:
 *   transfer_created    — fronter created & directly assigned to closer
 *   transfer_assigned   — closer receives a direct transfer
 *   transfer_rejected   — closer rejected → fronter + managers notified
 *   transfer_edited     — fronter manager edited transfer → stakeholders notified
 *   sale_created        — closer created a sale → fronter + managers notified
 *   sale_updated        — sale status changed → managers notified
 *   compliance_updated  — compliance manager updated sale → managers notified
 */

const { supabaseAdmin } = require('../config/database');
const logger = require('./logger');
const { sendPushToUser, sendPushToUsers } = require('./pushService');

// Roles notified for company-wide manager events
const MANAGER_LEVELS = [
  'manager',           // fronter manager
  'closer_manager',
  'operations_manager',
  'company_admin',
  'readonly_admin',
  'superadmin',
];

// Roles that are "floor managers" (fronter manager + ops manager)
const FLOOR_MANAGER_LEVELS = ['manager', 'operations_manager'];

// ─── helpers ─────────────────────────────────────────────────────────────────

async function createNotification({ userId, companyId, type, title, message, data }) {
  const { error } = await supabaseAdmin.from('notifications').insert({
    user_id:    userId,
    company_id: companyId || null,
    type,
    title,
    message:    message || null,
    data:       data    || null,
    is_read:    false,
  });
  if (error) logger.warn('NOTIF', `Failed for user ${userId}: ${error.message}`);
}

async function notifyUsers(userIds, payload) {
  if (!userIds?.length) return;
  const rows = userIds.map(uid => ({
    user_id:    uid,
    company_id: payload.companyId || null,
    type:       payload.type,
    title:      payload.title,
    message:    payload.message  || null,
    data:       payload.data     || null,
    is_read:    false,
  }));
  const { error } = await supabaseAdmin.from('notifications').insert(rows);
  if (error) logger.warn('NOTIF', `Bulk insert failed: ${error.message}`);
  // Web Push (fire-and-forget)
  sendPushToUsers(userIds, { title: payload.title, body: payload.message || payload.title }).catch(() => {});
}

/** Get user IDs in a company that match certain role levels */
async function getUserIdsByLevel(companyId, levels) {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_company_roles')
      .select('user_id, custom_roles(level)')
      .eq('company_id', companyId)
      .eq('is_active', true);
    if (error || !data) return [];
    return data
      .filter(r => levels.includes(r.custom_roles?.level))
      .map(r => r.user_id);
  } catch { return []; }
}

async function notifyManagers(companyId, payload) {
  const ids = await getUserIdsByLevel(companyId, MANAGER_LEVELS);
  await notifyUsers(ids, { ...payload, companyId });
}

async function notifyFloorManagers(companyId, payload) {
  const ids = await getUserIdsByLevel(companyId, FLOOR_MANAGER_LEVELS);
  await notifyUsers(ids, { ...payload, companyId });
}

// ─── business events ──────────────────────────────────────────────────────────

/**
 * Fronter created a transfer and directly assigned to a specific closer.
 * Notify: the closer + fronter manager + operations manager.
 */
async function onTransferCreated({ transfer, fronterName, closerUserId }) {
  const customerName = transfer.form_data?.customer_name || 'New Customer';
  const companyId    = transfer.company_id;

  // Notify the closer directly assigned
  if (closerUserId) {
    await createNotification({
      userId: closerUserId, companyId,
      type: 'transfer_assigned',
      title: 'New transfer assigned to you',
      message: `${fronterName} transferred ${customerName} directly to you.`,
      data: { transfer_id: transfer.id, customer_name: customerName },
    });
    sendPushToUser(closerUserId, {
      title: 'New transfer assigned',
      body:  `${fronterName} → ${customerName}`,
      tag:   'transfer_assigned',
      data:  { transfer_id: transfer.id },
    }).catch(() => {});
  }

  // Notify floor managers
  await notifyFloorManagers(companyId, {
    type: 'transfer_created',
    title: 'Transfer created',
    message: `${fronterName} transferred ${customerName} to a closer.`,
    data: { transfer_id: transfer.id, customer_name: customerName },
  });
}

/**
 * Closer rejected a transfer.
 * Notify: the original fronter + fronter manager + closer manager.
 */
async function onTransferRejected({ transfer, closerName, reason }) {
  const customerName = transfer.form_data?.customer_name || 'Customer';
  const companyId    = transfer.company_id;
  const fronterUserId = transfer.created_by;

  // Notify the fronter who created it
  if (fronterUserId) {
    await createNotification({
      userId: fronterUserId, companyId,
      type: 'transfer_rejected',
      title: 'Transfer rejected',
      message: `${closerName} rejected your transfer for ${customerName}. Reason: ${reason || 'No reason given'}`,
      data: { transfer_id: transfer.id, customer_name: customerName, reason },
    });
    sendPushToUser(fronterUserId, {
      title: 'Transfer rejected',
      body:  `${closerName} rejected ${customerName}${reason ? ': ' + reason : ''}`,
      tag:   'transfer_rejected',
      data:  { transfer_id: transfer.id },
    }).catch(() => {});
  }

  // Notify fronter manager + closer manager
  const managerIds = await getUserIdsByLevel(companyId, ['manager', 'closer_manager', 'operations_manager']);
  await notifyUsers(managerIds, {
    companyId,
    type: 'transfer_rejected',
    title: 'Transfer rejected by closer',
    message: `${closerName} rejected the transfer for ${customerName}.`,
    data: { transfer_id: transfer.id, customer_name: customerName, reason },
  });
}

/**
 * Fronter manager edited a transfer (with reason).
 * Notify: the fronter who created it.
 */
async function onTransferEdited({ transfer, editorName, reason }) {
  const customerName  = transfer.form_data?.customer_name || 'Customer';
  const fronterUserId = transfer.created_by;

  if (fronterUserId && fronterUserId !== transfer._editorId) {
    await createNotification({
      userId: fronterUserId, companyId: transfer.company_id,
      type: 'transfer_edited',
      title: 'Your transfer was updated',
      message: `${editorName} edited the transfer for ${customerName}. Reason: ${reason}`,
      data: { transfer_id: transfer.id, customer_name: customerName, reason },
    });
  }
}

/**
 * A closer created a sale.
 * Notify: the original fronter + fronter manager + operations manager.
 */
async function onSaleCreated({ sale, fronterUserId, closerName }) {
  const customerName = sale.customer_name || 'Customer';
  const refNo        = sale.reference_no  || sale.id.slice(0, 8).toUpperCase();
  const companyId    = sale.company_id;

  if (fronterUserId) {
    await createNotification({
      userId: fronterUserId, companyId,
      type: 'sale_created',
      title: 'Your lead became a sale!',
      message: `${customerName} (Ref: ${refNo}) was closed by ${closerName || 'a closer'}.`,
      data: { sale_id: sale.id, reference_no: refNo, customer_name: customerName },
    });
    sendPushToUser(fronterUserId, {
      title: 'Sale closed!',
      body:  `${customerName} — Ref: ${refNo}`,
      tag:   'sale_created',
      data:  { sale_id: sale.id },
    }).catch(() => {});
  }

  // Notify floor managers
  await notifyFloorManagers(companyId, {
    type: 'sale_created',
    title: 'New sale closed',
    message: `${closerName || 'A closer'} closed ${customerName} — Ref: ${refNo}.`,
    data: { sale_id: sale.id, reference_no: refNo, customer_name: customerName },
  });
}

/**
 * A sale status was updated.
 */
async function onSaleUpdated({ sale, updaterName }) {
  const customerName = sale.customer_name || 'Customer';
  const refNo        = sale.reference_no  || sale.id.slice(0, 8).toUpperCase();

  await notifyManagers(sale.company_id, {
    type: 'sale_updated',
    title: `Sale updated — ${sale.status?.toUpperCase()}`,
    message: `${updaterName} updated ${customerName} (Ref: ${refNo}) → ${sale.status?.toUpperCase()}.`,
    data: { sale_id: sale.id, reference_no: refNo, status: sale.status },
  });
}

/**
 * Compliance manager updated a sale.
 */
async function onComplianceUpdate({ sale, editorName, reason }) {
  const customerName = sale.customer_name || 'Customer';
  const refNo        = sale.reference_no  || sale.id.slice(0, 8).toUpperCase();

  await notifyManagers(sale.company_id, {
    type: 'compliance_updated',
    title: `Compliance update — ${sale.status?.toUpperCase()}`,
    message: `${editorName} updated ${customerName} (Ref: ${refNo}) for compliance. Reason: ${reason}`,
    data: { sale_id: sale.id, reference_no: refNo, status: sale.status, reason },
  });
}

module.exports = {
  onTransferCreated,
  onTransferRejected,
  onTransferEdited,
  onSaleCreated,
  onSaleUpdated,
  onComplianceUpdate,
  notifyManagers,
  notifyFloorManagers,
  getUserIdsByLevel,
  createNotification,
};
