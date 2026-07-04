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
const { settings, isoDate, runPaymentReminderScan, monthsAgo, CFG } = require('../utils/paymentReminders');
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

  // Scoped to RECENTLY CLOSED sales only (sale_date within the last windowMonths)
  // with an upcoming due date — old/2025 policies drop out. sales!inner + the
  // sale_date filter make PostgREST filter the parent rows.
  const today  = isoDate(new Date());
  const cutoff = isoDate(monthsAgo(cfg.windowMonths));

  let q = supabaseAdmin.from('payment_followups')
    .select('*, sales!inner(customer_name, customer_phone, customer_email, monthly_payment, down_payment, reference_no, sale_date, plan, client_name, payment_due_note)')
    .order('due_date', { ascending: true });

  if (role === 'compliance_manager' && !sa) {
    q = q.eq('status', 'at_risk');                 // soft-cancellation queue (any age)
  } else {
    q = q.gte('due_date', today).gte('sales.sale_date', cutoff);   // upcoming + recent sale
    if (sa) { if (req.query.company_id) q = q.eq('company_id', req.query.company_id); }
    else if (MANAGER_LEVELS.includes(role)) q = q.eq('company_id', req.user.company_id);
    else q = q.eq('closer_id', userId);
  }

  const { data, error } = await q.limit(500);
  if (error) return res.status(500).json({ error: error.message });

  // Attach the responsible closer's name + the company name (no FK from
  // payment_followups, so resolve in two batched lookups).
  const rows = data || [];
  const closerIds  = [...new Set(rows.map(r => r.closer_id).filter(Boolean))];
  const companyIds = [...new Set(rows.map(r => r.company_id).filter(Boolean))];
  const [closers, companies] = await Promise.all([
    closerIds.length  ? supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', closerIds)  : Promise.resolve({ data: [] }),
    companyIds.length ? supabaseAdmin.from('companies').select('id, name, slug').in('id', companyIds)                          : Promise.resolve({ data: [] }),
  ]);
  const closerName = new Map((closers.data || []).map(u => [u.user_id, [u.first_name, u.last_name].filter(Boolean).join(' ') || null]));
  const compName   = new Map((companies.data || []).map(c => [c.id, c.name || c.slug || null]));
  rows.forEach(r => {
    r.closer_name  = r.closer_id  ? (closerName.get(r.closer_id) || null) : null;
    r.company_name = r.company_id ? (compName.get(r.company_id)  || null) : null;
  });

  res.json({ followups: rows, window_months: cfg.windowMonths, cutoff, today });
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
  // recency window: how many months back to chase closed sales (1..12)
  if (b.window_months !== undefined)      await setConfig('global', `${CFG}.window_months`, Math.max(1, Math.min(parseInt(b.window_months, 10) || 2, 12)), req.user.id);
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
