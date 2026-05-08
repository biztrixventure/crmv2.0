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
 *
 * Deduplication:
 *   createNotification / notifyUsers accept an optional dedupKey / dedupBase.
 *   When provided, the row is upserted with ignoreDuplicates so retried HTTP
 *   requests or race conditions cannot create duplicate notifications.
 *   Key format: {type}_{entityId}_{userId}_{hourBlock} (1-hour window).
 */

const { supabaseAdmin } = require('../config/database');
const logger = require('./logger');
const { sendPushToUser, sendPushToUsers } = require('./pushService');

// All management roles — notified for company-wide events.
const MANAGER_LEVELS = [
  'superadmin', 'readonly_admin',
  'company_admin', 'operations_manager',
  'fronter_manager', 'manager',
  'closer_manager', 'compliance_manager',
];

// Floor managers — per-event notifications (not compliance_manager).
const FLOOR_MANAGER_LEVELS = [
  'company_admin', 'operations_manager',
  'fronter_manager', 'manager',
  'closer_manager',
];

// Current UTC hour block: e.g. "2024-01-15T14"
// Used as dedup window — same event on same entity for same user within one hour = single notification.
const hourBlock = () => new Date().toISOString().slice(0, 13);

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Insert one notification.
 * @param {string} [dedupKey] - If set, upsert with ignoreDuplicates to prevent duplicates on retry.
 */
async function createNotification({ userId, companyId, type, title, message, data, dedupKey }) {
  const row = {
    user_id:    userId,
    company_id: companyId || null,
    type,
    title,
    message:    message || null,
    data:       data    || null,
    is_read:    false,
  };
  if (dedupKey) row.dedup_key = dedupKey;

  const op = dedupKey
    ? supabaseAdmin.from('notifications').upsert(row, { onConflict: 'dedup_key', ignoreDuplicates: true })
    : supabaseAdmin.from('notifications').insert(row);

  const { error } = await op;
  if (error) logger.warn('NOTIF', `Failed for user ${userId}: ${error.message}`);
}

/**
 * Insert notifications for multiple users.
 * @param {string} [payload.dedupBase] - Base string for dedup key; full key = dedupBase_userId_hour.
 */
async function notifyUsers(userIds, payload) {
  if (!userIds?.length) return;
  const hour = hourBlock();
  const rows = userIds.map(uid => {
    const row = {
      user_id:    uid,
      company_id: payload.companyId || null,
      type:       payload.type,
      title:      payload.title,
      message:    payload.message  || null,
      data:       payload.data     || null,
      is_read:    false,
    };
    if (payload.dedupBase) row.dedup_key = `${payload.dedupBase}_${uid}_${hour}`;
    return row;
  });

  const op = payload.dedupBase
    ? supabaseAdmin.from('notifications').upsert(rows, { onConflict: 'dedup_key', ignoreDuplicates: true })
    : supabaseAdmin.from('notifications').insert(rows);

  const { error } = await op;
  if (error) logger.warn('NOTIF', `Bulk insert failed: ${error.message}`);

  // Web Push (fire-and-forget) — pass type as tag for OS notification grouping
  sendPushToUsers(userIds, {
    title: payload.title,
    body:  payload.message || payload.title,
    tag:   payload.type,
    data:  payload.data || {},
  }).catch(() => {});
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

async function onTransferCreated({ transfer, fronterName, closerUserId }) {
  const customerName = transfer.form_data?.customer_name || 'New Customer';
  const companyId    = transfer.company_id;

  if (closerUserId) {
    await createNotification({
      userId: closerUserId, companyId,
      type:     'transfer_assigned',
      title:    'New transfer assigned to you',
      message:  `${fronterName} transferred ${customerName} directly to you.`,
      data:     { transfer_id: transfer.id, customer_name: customerName },
      dedupKey: `transfer_assigned_${transfer.id}_${closerUserId}_${hourBlock()}`,
    });
    sendPushToUser(closerUserId, {
      title: 'New transfer assigned',
      body:  `${fronterName} → ${customerName}`,
      tag:   'transfer_assigned',
      data:  { transfer_id: transfer.id },
    }).catch(() => {});
  }

  await notifyFloorManagers(companyId, {
    type:      'transfer_created',
    title:     'Transfer created',
    message:   `${fronterName} transferred ${customerName} to a closer.`,
    data:      { transfer_id: transfer.id, customer_name: customerName },
    dedupBase: `transfer_created_${transfer.id}`,
  });
}

async function onTransferRejected({ transfer, closerName, reason }) {
  const customerName  = transfer.form_data?.customer_name || 'Customer';
  const companyId     = transfer.company_id;
  const fronterUserId = transfer.created_by;

  if (fronterUserId) {
    await createNotification({
      userId: fronterUserId, companyId,
      type:    'transfer_rejected',
      title:   'Transfer rejected',
      message: `${closerName} rejected your transfer for ${customerName}. Reason: ${reason || 'No reason given'}`,
      data:    { transfer_id: transfer.id, customer_name: customerName, reason },
    });
    sendPushToUser(fronterUserId, {
      title: 'Transfer rejected',
      body:  `${closerName} rejected ${customerName}${reason ? ': ' + reason : ''}`,
      tag:   'transfer_rejected',
      data:  { transfer_id: transfer.id },
    }).catch(() => {});
  }

  const fronterMgrIds = await getUserIdsByLevel(companyId, ['manager', 'fronter_manager', 'operations_manager']);
  await notifyUsers(fronterMgrIds, {
    companyId,
    type:    'transfer_rejected',
    title:   'Transfer rejected by closer',
    message: `${closerName} rejected the transfer for ${customerName}.`,
    data:    { transfer_id: transfer.id, customer_name: customerName, reason },
  });

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
        type:    'transfer_rejected',
        title:   'Transfer rejected',
        message: `${closerName} rejected the transfer for ${customerName}.`,
        data:    { transfer_id: transfer.id, customer_name: customerName, reason },
      });
    }
  }
}

async function onTransferEdited({ transfer, editorName, reason }) {
  const customerName  = transfer.form_data?.customer_name || 'Customer';
  const fronterUserId = transfer.created_by;

  if (fronterUserId && fronterUserId !== transfer._editorId) {
    await createNotification({
      userId: fronterUserId, companyId: transfer.company_id,
      type:    'transfer_edited',
      title:   'Your transfer was updated',
      message: `${editorName} edited the transfer for ${customerName}. Reason: ${reason}`,
      data:    { transfer_id: transfer.id, customer_name: customerName, reason },
    });
  }
}

async function onSaleSubmittedForReview({ sale, submitterName }) {
  const customerName = sale.customer_name || 'Customer';
  const refNo        = sale.reference_no  || sale.id.slice(0, 8).toUpperCase();
  const companyId    = sale.company_id;

  const complianceIds = await getUserIdsByLevel(companyId, ['compliance_manager']);
  await notifyUsers(complianceIds, {
    companyId,
    type:      'sale_pending_review',
    title:     'Sale awaiting compliance review',
    message:   `${submitterName} submitted ${customerName} (Ref: ${refNo}) for review.`,
    data:      { sale_id: sale.id, reference_no: refNo, customer_name: customerName },
    dedupBase: `sale_pending_${sale.id}`,
  });
}

async function onSaleApproved({ sale, reviewerName }) {
  const customerName  = sale.customer_name || 'Customer';
  const refNo         = sale.reference_no  || sale.id.slice(0, 8).toUpperCase();
  const companyId     = sale.company_id;
  const hour          = hourBlock();
  const disposition   = sale.closer_disposition;
  const dispoSuffix   = disposition ? ` · Disposition: ${disposition}` : '';
  const dispoData     = disposition ? { closer_disposition: disposition } : {};

  const closerId = sale.closer_id || sale.submitted_by;
  if (closerId) {
    await createNotification({
      userId: closerId, companyId,
      type:     'sale_approved',
      title:    'Sale approved by compliance!',
      message:  `${customerName} (Ref: ${refNo}) was approved by ${reviewerName}.`,
      data:     { sale_id: sale.id, reference_no: refNo, customer_name: customerName, ...dispoData },
      dedupKey: `sale_approved_${sale.id}_${closerId}_${hour}`,
    });
    sendPushToUser(closerId, {
      title: 'Sale approved!',
      body:  `${customerName} — Ref: ${refNo} approved by compliance`,
      tag:   'sale_approved',
      data:  { sale_id: sale.id },
    }).catch(() => {});
  }

  const closerMgrIds = await getUserIdsByLevel(companyId, ['closer_manager', 'operations_manager', 'company_admin']);
  await notifyUsers(closerMgrIds, {
    companyId,
    type:      'sale_approved',
    title:     `Sale confirmed — ${customerName}`,
    message:   `${reviewerName} approved ${customerName} (Ref: ${refNo}). Status: CLOSED WON.${dispoSuffix}`,
    data:      { sale_id: sale.id, reference_no: refNo, customer_name: customerName, ...dispoData },
    dedupBase: `sale_approved_mgr_${sale.id}`,
  });

  let fronterUserId    = sale.fronter_id || null;
  let fronterCompanyId = null;
  if (sale.transfer_id) {
    const { data: tf } = await supabaseAdmin
      .from('transfers')
      .select('created_by, company_id')
      .eq('id', sale.transfer_id)
      .single();
    if (tf) {
      fronterUserId    = fronterUserId || tf.created_by;
      fronterCompanyId = tf.company_id;
    }
  }

  if (fronterUserId) {
    await createNotification({
      userId: fronterUserId, companyId: fronterCompanyId || companyId,
      type:     'sale_approved',
      title:    'Your lead was confirmed as a sale!',
      message:  `${customerName} (Ref: ${refNo}) was approved by compliance — CLOSED WON.${dispoSuffix}`,
      data:     { sale_id: sale.id, reference_no: refNo, customer_name: customerName, ...dispoData },
      dedupKey: `sale_approved_${sale.id}_${fronterUserId}_${hour}`,
    });
    sendPushToUser(fronterUserId, {
      title: 'Lead confirmed!',
      body:  `${customerName} — Ref: ${refNo} closed won${dispoSuffix}`,
      tag:   'sale_approved',
      data:  { sale_id: sale.id },
    }).catch(() => {});
  }

  if (fronterCompanyId && fronterCompanyId !== companyId) {
    await notifyFloorManagers(fronterCompanyId, {
      type:      'sale_approved',
      title:     `Transfer confirmed as sale — ${customerName}`,
      message:   `${customerName} (Ref: ${refNo}) was approved by compliance — CLOSED WON.${dispoSuffix}`,
      data:      { sale_id: sale.id, reference_no: refNo, customer_name: customerName, ...dispoData },
      dedupBase: `sale_approved_fmgr_${sale.id}`,
    });
  }
}

async function onSaleReturned({ sale, reviewerName, note }) {
  const customerName = sale.customer_name || 'Customer';
  const refNo        = sale.reference_no  || sale.id.slice(0, 8).toUpperCase();
  const companyId    = sale.company_id;

  const closerId = sale.closer_id || sale.submitted_by;
  if (closerId) {
    await createNotification({
      userId: closerId, companyId,
      type:     'sale_needs_revision',
      title:    'Sale returned — changes required',
      message:  `${reviewerName} returned ${customerName} (Ref: ${refNo}). Note: ${note}`,
      data:     { sale_id: sale.id, reference_no: refNo, customer_name: customerName, note },
      dedupKey: `sale_returned_${sale.id}_${closerId}_${hourBlock()}`,
    });
    sendPushToUser(closerId, {
      title: 'Sale needs revision',
      body:  `${customerName}: ${note}`,
      tag:   'sale_needs_revision',
      data:  { sale_id: sale.id },
    }).catch(() => {});
  }

  const managerIds = await getUserIdsByLevel(companyId, ['closer_manager', 'operations_manager']);
  await notifyUsers(managerIds, {
    companyId,
    type:    'sale_needs_revision',
    title:   `Sale returned for revision — ${customerName}`,
    message: `${reviewerName} returned ${customerName} (Ref: ${refNo}) to closer. Note: ${note}`,
    data:    { sale_id: sale.id, reference_no: refNo, note },
  });
}

async function onComplianceUpdate({ sale, editorName, reason }) {
  const customerName = sale.customer_name || 'Customer';
  const refNo        = sale.reference_no  || sale.id.slice(0, 8).toUpperCase();

  await notifyManagers(sale.company_id, {
    type:    'compliance_updated',
    title:   `Compliance update — ${sale.status?.toUpperCase()}`,
    message: `${editorName} updated ${customerName} (Ref: ${refNo}) for compliance. Reason: ${reason}`,
    data:    { sale_id: sale.id, reference_no: refNo, status: sale.status, reason },
  });
}

async function onDispositionSubmitted({ action, transfer, config, submitterId, submitterCompanyId }) {
  const fd           = transfer.form_data || {};
  const customerName = fd.customer_name
    || (fd.FirstName ? `${fd.FirstName} ${fd.LastName || ''}`.trim() : null)
    || 'Customer';

  const { data: profile } = await supabaseAdmin
    .from('user_profiles').select('first_name, last_name').eq('user_id', submitterId).single();
  const submitterName = profile
    ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'Closer'
    : 'Closer';

  const noteStr = action.note ? ` — Note: ${action.note}` : '';

  // Notify roles within closer's company
  if (config.notify_roles?.length > 0) {
    const roleIds = await getUserIdsByLevel(submitterCompanyId, config.notify_roles);
    const filtered = roleIds.filter(id => id !== submitterId);
    if (filtered.length > 0) {
      await notifyUsers(filtered, {
        companyId: submitterCompanyId,
        type:      'disposition_submitted',
        title:     `${config.name} — ${customerName}`,
        message:   `${submitterName} marked ${customerName} as "${config.name}".${noteStr}`,
        data:      { transfer_id: transfer.id, action_id: action.id, disposition: config.name, color: config.color },
        dedupBase: `disposition_${action.id}`,
      });
    }
  }

  const fronterCompanyId = transfer.company_id;
  const fronterUserId    = transfer.created_by;

  if (config.notify_fronter && fronterUserId && fronterUserId !== submitterId) {
    await createNotification({
      userId: fronterUserId, companyId: fronterCompanyId,
      type:     'disposition_submitted',
      title:    `${config.name} — ${customerName}`,
      message:  `${submitterName} marked your lead ${customerName} as "${config.name}".${noteStr}`,
      data:     { transfer_id: transfer.id, action_id: action.id, disposition: config.name, color: config.color },
      dedupKey: `disposition_${action.id}_${fronterUserId}_${hourBlock()}`,
    });
    sendPushToUser(fronterUserId, {
      title: `Lead outcome: ${config.name}`,
      body:  `${customerName} — ${config.name}`,
      tag:   'disposition_submitted',
      data:  { transfer_id: transfer.id },
    }).catch(() => {});
  }

  if (config.notify_fronter_manager && fronterCompanyId) {
    const mgrIds     = await getUserIdsByLevel(fronterCompanyId, ['manager', 'fronter_manager', 'operations_manager', 'company_admin']);
    const toNotify   = mgrIds.filter(id => id !== submitterId && id !== fronterUserId);
    if (toNotify.length > 0) {
      await notifyUsers(toNotify, {
        companyId: fronterCompanyId,
        type:      'disposition_submitted',
        title:     `${config.name} — ${customerName}`,
        message:   `${submitterName} marked ${customerName} as "${config.name}".${noteStr}`,
        data:      { transfer_id: transfer.id, action_id: action.id, disposition: config.name, color: config.color },
        dedupBase: `disposition_fmgr_${action.id}`,
      });
    }
  }
}

module.exports = {
  onTransferCreated,
  onTransferRejected,
  onTransferEdited,
  onSaleSubmittedForReview,
  onSaleApproved,
  onSaleReturned,
  onComplianceUpdate,
  onDispositionSubmitted,
  notifyManagers,
  notifyFloorManagers,
  getUserIdsByLevel,
  createNotification,
};
