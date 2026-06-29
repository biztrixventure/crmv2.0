// ============================================================================
// routes/paymentReminders.js — Monthly Payment retention workflow API.
//   GET  /payment-reminders/upcoming   role-scoped list of due/at-risk policies
//   PATCH /payment-reminders/:id        log outcome (collected / at_risk / cancelled)
//   GET/PUT /payment-reminders/settings superadmin config (window / offsets / roles)
//   POST /payment-reminders/run         superadmin: trigger the scan now
// Mounted with authMiddleware + readonlyGuard.
// ============================================================================
const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { supabaseAdmin } = require('../config/database');
const { isSuperAdmin } = require('../models/helpers');
const { setConfig } = require('../utils/businessConfig');
const { settings, isoDate, runPaymentReminderScan, CFG } = require('../utils/paymentReminders');
const notifications = require('../utils/notificationService');

const router = express.Router();

const MANAGER_LEVELS = ['superadmin', 'readonly_admin', 'company_admin', 'operations_manager',
  'closer_manager', 'fronter_manager', 'manager', 'compliance_manager'];
const isSA = async (req) => req.user.role === 'superadmin' || req.user.role === 'readonly_admin' || await isSuperAdmin(req.user.id);

// ── GET /upcoming ─────────────────────────────────────────────────────────────
router.get('/upcoming', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const role   = req.user.role;
  const sa     = await isSA(req);
  const cfg    = await settings();

  const today = isoDate(new Date());
  const end   = new Date(); end.setUTCDate(end.getUTCDate() + (cfg.windowDays || 7));
  const endStr = isoDate(end);

  let q = supabaseAdmin.from('payment_followups')
    .select('*, sales(customer_name, customer_phone, monthly_payment, reference_no, sale_date)')
    .gte('due_date', today)
    .order('due_date', { ascending: true });

  if (sa) {
    if (req.query.company_id) q = q.eq('company_id', req.query.company_id);
    q = q.lte('due_date', endStr);
  } else if (role === 'compliance_manager') {
    q = q.eq('status', 'at_risk');                 // soft-cancellation queue, any horizon
  } else if (MANAGER_LEVELS.includes(role)) {
    q = q.eq('company_id', req.user.company_id).lte('due_date', endStr);   // team window
  } else {
    q = q.eq('closer_id', userId).lte('due_date', endStr);                 // own window
  }

  const { data, error } = await q.limit(500);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ followups: data || [], window_days: cfg.windowDays, today });
}));

// ── PATCH /:id — log outcome ──────────────────────────────────────────────────
router.patch('/:id', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const role   = req.user.role;
  const { status, note } = req.body || {};
  const ALLOWED = ['pending', 'collected', 'at_risk', 'cancelled'];
  if (status && !ALLOWED.includes(status)) return res.status(400).json({ error: 'invalid status' });

  const { data: f } = await supabaseAdmin
    .from('payment_followups').select('*, sales(customer_name)').eq('id', req.params.id).single();
  if (!f) return res.status(404).json({ error: 'Follow-up not found' });

  const sa = await isSA(req);
  const isCompliance = role === 'compliance_manager';
  const isManager = MANAGER_LEVELS.includes(role);
  const isOwner = f.closer_id === userId;
  if (!sa && !isCompliance && !isOwner && !(isManager && f.company_id === req.user.company_id)) {
    return res.status(403).json({ error: 'You cannot update this follow-up' });
  }
  // Cancelling a policy is a compliance/superadmin action.
  if (status === 'cancelled' && !sa && !isCompliance) {
    return res.status(403).json({ error: 'Only compliance can mark a policy cancelled' });
  }

  const updates = { updated_at: new Date().toISOString() };
  if (status) { updates.status = status; updates.handled_by = userId; updates.handled_at = new Date().toISOString(); }
  if (note !== undefined) updates.note = note;

  const { data: updated, error } = await supabaseAdmin
    .from('payment_followups').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // at_risk → soft-notify compliance (the cancellation review queue).
  if (status === 'at_risk' && f.company_id) {
    const compliance = await notifications.getUserIdsByLevel(f.company_id, ['compliance_manager']).catch(() => []);
    if (compliance && compliance.length) {
      await notifications.notifyUsers(compliance, {
        companyId: f.company_id,
        type: 'payment_at_risk',
        title: 'Payment at risk — review for cancellation',
        message: `${f.sales?.customer_name || 'A customer'} couldn't be collected (due ${f.due_date}).`,
        data: { sale_id: f.sale_id, followup_id: f.id, due_date: f.due_date },
        dedupKey: `payment_at_risk:${f.id}`,
      }).catch(() => {});
    }
  }
  res.json({ followup: updated });
}));

// ── GET/PUT /settings (superadmin) ────────────────────────────────────────────
router.get('/settings', asyncHandler(async (req, res) => {
  if (!(await isSA(req))) return res.status(403).json({ error: 'Superadmin only' });
  res.json(await settings());
}));

router.put('/settings', asyncHandler(async (req, res) => {
  if (!(req.user.role === 'superadmin' || await isSuperAdmin(req.user.id))) {
    return res.status(403).json({ error: 'Superadmin only' });
  }
  const b = req.body || {};
  const ROLES = ['closer', 'closer_manager', 'compliance_manager', 'operations_manager', 'company_admin'];
  if (b.enabled !== undefined)            await setConfig('global', `${CFG}.enabled`, !!b.enabled, req.user.id);
  if (b.window_days !== undefined)        await setConfig('global', `${CFG}.window_days`, Math.max(0, Math.min(parseInt(b.window_days, 10) || 7, 60)), req.user.id);
  if (Array.isArray(b.reminder_offsets))  await setConfig('global', `${CFG}.reminder_offsets`, [...new Set(b.reminder_offsets.map(n => parseInt(n, 10)).filter(n => n >= 0 && n <= 60))].sort((x, y) => y - x), req.user.id);
  if (Array.isArray(b.notify_roles))      await setConfig('global', `${CFG}.notify_roles`, [...new Set(b.notify_roles.filter(r => ROLES.includes(r)))], req.user.id);
  res.json(await settings());
}));

// ── POST /run (superadmin) — trigger the scan immediately ─────────────────────
router.post('/run', asyncHandler(async (req, res) => {
  if (!(req.user.role === 'superadmin' || await isSuperAdmin(req.user.id))) {
    return res.status(403).json({ error: 'Superadmin only' });
  }
  res.json(await runPaymentReminderScan());
}));

module.exports = router;
