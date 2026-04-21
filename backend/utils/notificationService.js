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
  'manager',
  'fronter_manager',
  'closer_manager',
  'operations_manager',
  'compliance_manager',
  'company_admin',
  'readonly_admin',
  'superadmin',
];

// Roles that are "floor managers" — receive per-event (transfer/sale) notifications
const FLOOR_MANAGER_LEVELS = ['manager', 'fronter_manager', 'closer_manager', 'operations_manager'];

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

  // Notify fronter company managers
  const fronterMgrIds = await getUserIdsByLevel(companyId, ['manager', 'fronter_manager', 'operations_manager']);
  await notifyUsers(fronterMgrIds, {
    companyId,
    type: 'transfer_rejected',
    title: 'Transfer rejected by closer',
    message: `${closerName} rejected the transfer for ${customerName}.`,
    data: { transfer_id: transfer.id, customer_name: customerName, reason },
  });

  // Also notify managers in the closer's company (different company from transfer)
  if (transfer.assigned_closer_id) {
    const { data: closerRole } = await supabaseAdmin
      .from('user_company_roles')
      .select('company_id')
      .eq('user_id', transfer.assigned_closer_id)
      .eq('is_active', true)
      .single();
    if (closerRole?.company_id && closerRole.company_id !== companyId) {
      const closerMgrIds = await getUserIdsByLevel(closerRole.company_id, ['closer_manager', 'operations_manager', 'company_admin']);
      await notifyUsers(closerMgrIds, {
        companyId: closerRole.company_id,
        type: 'transfer_rejected',
        title: 'Transfer rejected',
        message: `${closerName} rejected the transfer for ${customerName}.`,
        data: { transfer_id: transfer.id, customer_name: customerName, reason },
      });
    }
  }
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

  // Auto-resolve fronter from linked transfer if not explicitly provided
  let resolvedFronterUserId = fronterUserId || sale.fronter_id || null;
  if (!resolvedFronterUserId && sale.transfer_id) {
    const { data: tf } = await supabaseAdmin.from('transfers').select('created_by').eq('id', sale.transfer_id).single();
    resolvedFronterUserId = tf?.created_by || null;
  }
  const fronterUserId_ = resolvedFronterUserId;

  if (fronterUserId_) {
    await createNotification({
      userId: fronterUserId_, companyId,
      type: 'sale_created',
      title: 'Your lead became a sale!',
      message: `${customerName} (Ref: ${refNo}) was closed by ${closerName || 'a closer'}.`,
      data: { sale_id: sale.id, reference_no: refNo, customer_name: customerName },
    });
    sendPushToUser(fronterUserId_, {
      title: 'Sale closed!',
      body:  `${customerName} — Ref: ${refNo}`,
      tag:   'sale_created',
      data:  { sale_id: sale.id },
    }).catch(() => {});
  }

  // Notify floor managers in closer's company
  await notifyFloorManagers(companyId, {
    type: 'sale_created',
    title: 'New sale closed',
    message: `${closerName || 'A closer'} closed ${customerName} — Ref: ${refNo}.`,
    data: { sale_id: sale.id, reference_no: refNo, customer_name: customerName },
  });

  // Also notify floor managers in the fronter's company (via transfer link)
  if (sale.transfer_id) {
    const { data: tf } = await supabaseAdmin.from('transfers').select('company_id').eq('id', sale.transfer_id).single();
    if (tf?.company_id && tf.company_id !== companyId) {
      await notifyFloorManagers(tf.company_id, {
        type: 'sale_created',
        title: 'Transfer converted to sale',
        message: `${closerName || 'A closer'} closed ${customerName} — Ref: ${refNo}.`,
        data: { sale_id: sale.id, reference_no: refNo, customer_name: customerName },
      });
    }
  }
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
 * Closer submitted sale for compliance review.
 * Notify: all compliance_managers in the company.
 */
async function onSaleSubmittedForReview({ sale, submitterName }) {
  const customerName = sale.customer_name || 'Customer';
  const refNo        = sale.reference_no  || sale.id.slice(0, 8).toUpperCase();
  const companyId    = sale.company_id;

  const complianceIds = await getUserIdsByLevel(companyId, ['compliance_manager']);
  await notifyUsers(complianceIds, {
    companyId,
    type:    'sale_pending_review',
    title:   'Sale awaiting compliance review',
    message: `${submitterName} submitted ${customerName} (Ref: ${refNo}) for review.`,
    data:    { sale_id: sale.id, reference_no: refNo, customer_name: customerName },
  });
}

/**
 * Compliance approved a sale → closed_won.
 * Notify: closer (submitter) + closer_manager + operations_manager + company_admin.
 */
async function onSaleApproved({ sale, reviewerName }) {
  const customerName = sale.customer_name || 'Customer';
  const refNo        = sale.reference_no  || sale.id.slice(0, 8).toUpperCase();
  const companyId    = sale.company_id;

  // Notify the closer who owns the sale
  const closerId = sale.closer_id || sale.submitted_by;
  if (closerId) {
    await createNotification({
      userId: closerId, companyId,
      type:    'sale_approved',
      title:   'Sale approved by compliance!',
      message: `${customerName} (Ref: ${refNo}) was approved by ${reviewerName}.`,
      data:    { sale_id: sale.id, reference_no: refNo, customer_name: customerName },
    });
    sendPushToUser(closerId, {
      title: 'Sale approved!',
      body:  `${customerName} — Ref: ${refNo} approved by compliance`,
      tag:   'sale_approved',
      data:  { sale_id: sale.id },
    }).catch(() => {});
  }

  // Notify managers
  const managerIds = await getUserIdsByLevel(companyId, ['closer_manager', 'operations_manager', 'company_admin']);
  await notifyUsers(managerIds, {
    companyId,
    type:    'sale_approved',
    title:   `Sale confirmed — ${customerName}`,
    message: `${reviewerName} approved ${customerName} (Ref: ${refNo}). Status: CLOSED WON.`,
    data:    { sale_id: sale.id, reference_no: refNo, customer_name: customerName },
  });
}

/**
 * Compliance returned a sale to closer with note.
 * Notify: closer + their manager.
 */
async function onSaleReturned({ sale, reviewerName, note }) {
  const customerName = sale.customer_name || 'Customer';
  const refNo        = sale.reference_no  || sale.id.slice(0, 8).toUpperCase();
  const companyId    = sale.company_id;

  const closerId = sale.closer_id || sale.submitted_by;
  if (closerId) {
    await createNotification({
      userId: closerId, companyId,
      type:    'sale_needs_revision',
      title:   'Sale returned — changes required',
      message: `${reviewerName} returned ${customerName} (Ref: ${refNo}). Note: ${note}`,
      data:    { sale_id: sale.id, reference_no: refNo, customer_name: customerName, note },
    });
    sendPushToUser(closerId, {
      title: 'Sale needs revision',
      body:  `${customerName}: ${note}`,
      tag:   'sale_needs_revision',
      data:  { sale_id: sale.id },
    }).catch(() => {});
  }

  // Notify closer's manager
  const managerIds = await getUserIdsByLevel(companyId, ['closer_manager', 'operations_manager']);
  await notifyUsers(managerIds, {
    companyId,
    type:    'sale_needs_revision',
    title:   `Sale returned for revision — ${customerName}`,
    message: `${reviewerName} returned ${customerName} (Ref: ${refNo}) to closer. Note: ${note}`,
    data:    { sale_id: sale.id, reference_no: refNo, note },
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
  onSaleSubmittedForReview,
  onSaleApproved,
  onSaleReturned,
  notifyManagers,
  notifyFloorManagers,
  getUserIdsByLevel,
  createNotification,
};
