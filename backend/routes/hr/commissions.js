// ============================================================================
// /api/hr/commissions -- commission plans (mig 318). Rules, not payments:
// a payroll run turns them into SUGGESTED amounts that HR applies by hand
// (routes/hr/payroll.js /runs/:id/suggestions + /apply-suggestions).
//
// View: hr.payroll.view. Change: hr.payroll.manage, and changing or removing
// a plan asks why -- it moves what people are paid. Every change is in the
// change log (mig 313).
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../../config/database');
const { asyncHandler } = require('../../middleware/errorHandler');
const { can, deny, readCompanyId, writeCompanyId } = require('../../utils/moduleAccess');
const { needReason } = require('../../utils/requestContext');

const router = express.Router();

const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(new Date(s + 'T00:00:00Z').getTime());

function clean(b) {
  const p = {
    name: String(b.name || '').trim().slice(0, 120),
    applies_to: b.applies_to,
    role_levels: Array.isArray(b.role_levels) ? [...new Set(b.role_levels.map(String).filter(Boolean))] : [],
    basis: b.basis,
    amount: Number(b.amount),
    dp_currency: String(b.dp_currency || 'USD').toUpperCase(),
    min_sales: Number.isInteger(Number(b.min_sales)) ? Number(b.min_sales) : 0,
    counts_on: b.counts_on || 'approved',
    is_active: b.is_active !== false,
    effective_from: b.effective_from || '2026-06-01',
    effective_to: b.effective_to || null,
    note: b.note ? String(b.note).slice(0, 500) : null,
  };
  if (!p.name) return { error: 'Give the plan a name' };
  if (!['closer', 'fronter'].includes(p.applies_to)) return { error: 'Pick whose sales count: closed by them, or passed on by them' };
  if (!['per_sale', 'dp_percent'].includes(p.basis)) return { error: 'A plan pays per sale or a percent of the down payment' };
  if (!Number.isFinite(p.amount) || p.amount < 0) return { error: 'The amount must be zero or more' };
  if (p.basis === 'dp_percent' && p.amount > 100) return { error: 'A percent cannot be over 100' };
  if (!/^[A-Z]{3}$/.test(p.dp_currency)) return { error: 'The down-payment currency is a 3-letter code, e.g. USD' };
  if (p.min_sales < 0) return { error: 'The minimum cannot be negative' };
  if (!['approved', 'dp_paid'].includes(p.counts_on)) return { error: 'Unknown rule for when a sale counts' };
  if (!isDay(p.effective_from)) return { error: 'Pick the date the plan starts' };
  if (p.effective_to && (!isDay(p.effective_to) || p.effective_to < p.effective_from)) return { error: 'The end date must be after the start date' };
  return { plan: p };
}

router.get('/plans', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ plans: [] });
  if (await deny(req, res, companyId, 'hr.payroll.view')) return;
  const [{ data, error }, { data: roles }] = await Promise.all([
    supabaseAdmin.from('hr_commission_plans').select('*').eq('company_id', companyId)
      .order('is_active', { ascending: false }).order('name'),
    supabaseAdmin.from('custom_roles').select('name, level').or(`company_id.eq.${companyId},company_id.is.null`),
  ]);
  if (error) return res.status(500).json({ error: error.message });
  const levels = {};
  for (const r of roles || []) {
    const l = String(r.level);
    if (['superadmin', 'readonly_admin'].includes(l)) continue;
    (levels[l] = levels[l] || new Set()).add(r.name);
  }
  res.json({
    plans: data || [],
    role_levels: Object.entries(levels).map(([level, names]) => ({ level, names: [...names] })).sort((a, b) => a.level.localeCompare(b.level)),
    can_manage: await can(req, companyId, 'hr.payroll.manage'),
  });
}));

router.post('/plans', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (!companyId) return res.status(400).json({ error: 'No company scope for this user' });
  if (await deny(req, res, companyId, 'hr.payroll.manage')) return;
  const c = clean(req.body || {});
  if (c.error) return res.status(400).json({ error: c.error });
  const { data, error } = await supabaseAdmin.from('hr_commission_plans')
    .insert({ ...c.plan, company_id: companyId, created_by: req.user.id }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ plan: data });
}));

router.put('/plans/:id', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'hr.payroll.manage')) return;
  if (needReason(req, res, 'changing this commission plan')) return;
  const { data: existing } = await supabaseAdmin.from('hr_commission_plans').select('*').eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Plan not found' });
  const c = clean({ ...existing, ...req.body });
  if (c.error) return res.status(400).json({ error: c.error });
  const { data, error } = await supabaseAdmin.from('hr_commission_plans')
    .update({ ...c.plan, updated_at: new Date().toISOString() }).eq('id', existing.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ plan: data });
}));

router.delete('/plans/:id', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'hr.payroll.manage')) return;
  if (needReason(req, res, 'removing this commission plan')) return;
  const { error } = await supabaseAdmin.from('hr_commission_plans').delete().eq('id', req.params.id).eq('company_id', companyId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

module.exports = router;
