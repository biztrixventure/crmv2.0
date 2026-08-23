// ============================================================================
// /api/hr/leave -- leave types, balances and requests (mig 287).
//
// The brief said "approving a request must decrement the matching
// leave_balances.used_days". It does -- but the decrement lives in the mig 287
// trigger, not in this file, and that is on purpose. A balance that is only
// correct when it happens to be an Express handler doing the writing is a
// balance that goes wrong the first time anyone fixes data in the SQL editor.
// The trigger also handles the reverse (approved -> rejected/cancelled gives the
// days back) and seeds a missing year row from the leave type default, so an
// approval can never fail just because nobody pre-created the balance.
//
// This file therefore does three things the database cannot: it decides WHO may
// act, it refuses an approval that would overdraw the balance, and it stops
// people approving their own leave.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../../config/database');
const { asyncHandler } = require('../../middleware/errorHandler');
const logger = require('../../utils/logger');
const { can, deny, readCompanyId, writeCompanyId, selfEmployee, hrReadScope } = require('../../utils/moduleAccess');

const router = express.Router();

const full = 'id, company_id, employee_id, leave_type_id, start_date, end_date, days, reason, status, '
  + 'requested_by, decided_by, decided_at, decision_note, created_at, updated_at, '
  + 'hr_employees(id, first_name, last_name, employee_no, department_id), '
  + 'hr_leave_types(id, code, name, is_paid)';

const yearOf = (d) => Number(String(d).slice(0, 4));

// -- Leave types ---------------------------------------------------------------

router.get('/types', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ types: [] });
  // Anyone who can request leave has to be able to pick a type.
  const allowed = await can(req, companyId, 'hr.leave.request')
               || await can(req, companyId, 'hr.leave.view_team');
  if (!allowed) return res.status(403).json({ error: 'Forbidden' });

  const { data, error } = await supabaseAdmin
    .from('hr_leave_types')
    .select('id, code, name, default_days, is_paid, requires_approval, is_active')
    .eq('company_id', companyId).eq('is_active', true).order('name');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ types: data || [], can_manage: await can(req, companyId, 'hr.leave.manage') });
}));

router.post('/types', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (!companyId) return res.status(400).json({ error: 'No company scope for this user' });
  if (await deny(req, res, companyId, 'hr.leave.manage')) return;

  const b = req.body || {};
  if (!b.code || !b.name) return res.status(400).json({ error: 'code and name are required' });

  const { data, error } = await supabaseAdmin.from('hr_leave_types').insert({
    company_id: companyId,
    code: String(b.code).trim().toUpperCase(),
    name: String(b.name).trim(),
    default_days: Number(b.default_days ?? 0),
    is_paid: b.is_paid !== false,
    requires_approval: b.requires_approval !== false,
  }).select().single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'That leave code already exists' });
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json({ type: data });
}));

router.put('/types/:id', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'hr.leave.manage')) return;

  const patch = { updated_at: new Date().toISOString() };
  for (const f of ['code', 'name', 'default_days']) if (req.body?.[f] !== undefined) patch[f] = req.body[f];
  for (const f of ['is_paid', 'requires_approval', 'is_active']) if (req.body?.[f] !== undefined) patch[f] = !!req.body[f];

  const { data, error } = await supabaseAdmin.from('hr_leave_types')
    .update(patch).eq('id', req.params.id).eq('company_id', companyId).select().maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Leave type not found' });
  res.json({ type: data });
}));

// -- Balances ------------------------------------------------------------------

// GET /api/hr/leave/balances?employee_id=&year=
// Own balances need no team permission. Someone else needs hr.leave.view_team.
router.get('/balances', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ balances: [] });

  const scope = await hrReadScope(req, companyId, 'hr.leave.view_team');
  const year = Number(req.query.year) || new Date().getFullYear();

  let q = supabaseAdmin
    .from('hr_leave_balances')
    .select('id, employee_id, leave_type_id, year, entitled_days, used_days, remaining_days, hr_leave_types(id, code, name, is_paid), hr_employees(id, first_name, last_name, employee_no)')
    .eq('company_id', companyId).eq('year', year);

  if (!scope.all) {
    if (!scope.employee) return res.json({ balances: [], scope: 'none' });
    q = q.eq('employee_id', scope.employee.id);
  } else if (req.query.employee_id) {
    q = q.eq('employee_id', req.query.employee_id);
  }

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({
    balances: data || [],
    year,
    scope: scope.all ? 'all' : 'own',
    my_employee_id: scope.employee?.id || null,
    can_manage: await can(req, companyId, 'hr.leave.manage'),
  });
}));

// PUT /api/hr/leave/balances -- set an ENTITLEMENT. used_days is never settable
// here; it belongs to the trigger and to the approvals that moved it.
router.put('/balances', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (!companyId) return res.status(400).json({ error: 'No company scope for this user' });
  if (await deny(req, res, companyId, 'hr.leave.manage')) return;

  const { employee_id, leave_type_id, entitled_days } = req.body || {};
  const year = Number(req.body?.year) || new Date().getFullYear();
  if (!employee_id || !leave_type_id) return res.status(400).json({ error: 'employee_id and leave_type_id are required' });
  if (!(Number(entitled_days) >= 0)) return res.status(400).json({ error: 'entitled_days must be zero or more' });

  const { data: emp } = await supabaseAdmin
    .from('hr_employees').select('id').eq('id', employee_id).eq('company_id', companyId).maybeSingle();
  if (!emp) return res.status(404).json({ error: 'Employee not found in this company' });

  const { data, error } = await supabaseAdmin.from('hr_leave_balances').upsert({
    company_id: companyId, employee_id, leave_type_id, year,
    entitled_days: Number(entitled_days),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'company_id,employee_id,leave_type_id,year' }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ balance: data });
}));

// -- Requests ------------------------------------------------------------------

router.get('/requests', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ requests: [], scope: 'none' });

  const scope = await hrReadScope(req, companyId, 'hr.leave.view_team');
  if (!scope.all && !scope.employee) return res.json({ requests: [], scope: 'none' });

  let q = supabaseAdmin
    .from('hr_leave_requests').select(full)
    .eq('company_id', companyId)
    .order('start_date', { ascending: false })
    .limit(Math.min(500, Math.max(1, Number(req.query.limit) || 200)));

  if (!scope.all) q = q.eq('employee_id', scope.employee.id);
  else if (req.query.employee_id) q = q.eq('employee_id', req.query.employee_id);

  if (req.query.status)    q = q.eq('status', req.query.status);
  if (req.query.date_from) q = q.gte('end_date', req.query.date_from);
  if (req.query.date_to)   q = q.lte('start_date', req.query.date_to);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  res.json({
    requests: data || [],
    scope: scope.all ? 'all' : 'own',
    my_employee_id: scope.employee?.id || null,
    can_approve: await can(req, companyId, 'hr.leave.approve'),
  });
}));

// POST /api/hr/leave/requests -- filed for YOURSELF unless you can manage leave.
router.post('/requests', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (!companyId) return res.status(400).json({ error: 'No company scope for this user' });
  if (await deny(req, res, companyId, 'hr.leave.request')) return;

  const self = await selfEmployee(companyId, req.user.id);
  const canFileForOthers = await can(req, companyId, 'hr.leave.manage');
  const employeeId = (canFileForOthers && req.body?.employee_id) ? req.body.employee_id : self?.id;
  if (!employeeId) return res.status(400).json({ error: 'You have no employee record in this company yet -- ask HR to create one.' });

  const b = req.body || {};
  if (!b.leave_type_id) return res.status(400).json({ error: 'leave_type_id is required' });
  if (!b.start_date || !b.end_date) return res.status(400).json({ error: 'start_date and end_date are required' });
  if (b.end_date < b.start_date)    return res.status(400).json({ error: 'end_date cannot be before start_date' });

  // Days defaults to the inclusive calendar span. Half days and company
  // holidays mean the caller can override it, which is why it is stored.
  const span = Math.round((new Date(b.end_date) - new Date(b.start_date)) / 86_400_000) + 1;
  const days = Number(b.days ?? span);
  if (!(days > 0)) return res.status(400).json({ error: 'days must be greater than zero' });

  const { data: emp } = await supabaseAdmin
    .from('hr_employees').select('id').eq('id', employeeId).eq('company_id', companyId).maybeSingle();
  if (!emp) return res.status(404).json({ error: 'Employee not found in this company' });

  const { data, error } = await supabaseAdmin.from('hr_leave_requests').insert({
    company_id: companyId,
    employee_id: employeeId,
    leave_type_id: b.leave_type_id,
    start_date: b.start_date,
    end_date: b.end_date,
    days,
    reason: b.reason || null,
    status: 'pending',
    requested_by: req.user.id,
  }).select(full).single();
  if (error) return res.status(500).json({ error: error.message });

  res.status(201).json({ request: data });
}));

// PUT /api/hr/leave/requests/:id -- pending requests only, by the requester.
router.put('/requests/:id', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  const { data: existing } = await supabaseAdmin
    .from('hr_leave_requests').select('id, employee_id, status')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Leave request not found' });
  if (existing.status !== 'pending') return res.status(409).json({ error: 'A request that is ' + existing.status + ' can no longer be edited' });

  const self = await selfEmployee(companyId, req.user.id);
  const mine = self && existing.employee_id === self.id;
  if (!mine && !(await can(req, companyId, 'hr.leave.manage'))) return res.status(403).json({ error: 'Forbidden' });

  const patch = { updated_at: new Date().toISOString() };
  for (const f of ['leave_type_id', 'start_date', 'end_date', 'reason']) if (req.body?.[f] !== undefined) patch[f] = req.body[f];
  if (req.body?.days !== undefined) {
    if (!(Number(req.body.days) > 0)) return res.status(400).json({ error: 'days must be greater than zero' });
    patch.days = Number(req.body.days);
  }

  const { data, error } = await supabaseAdmin
    .from('hr_leave_requests').update(patch).eq('id', existing.id).select(full).single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ request: data });
}));

// POST /api/hr/leave/requests/:id/approve
// The balance movement itself is the mig 287 trigger. What happens here is the
// decision to allow it: enough days left, and not your own request.
router.post('/requests/:id/approve', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'hr.leave.approve')) return;

  const { data: r } = await supabaseAdmin
    .from('hr_leave_requests').select('id, employee_id, leave_type_id, start_date, days, status')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!r) return res.status(404).json({ error: 'Leave request not found' });
  if (r.status !== 'pending') return res.status(409).json({ error: 'This request is already ' + r.status });

  const self = await selfEmployee(companyId, req.user.id);
  if (self && r.employee_id === self.id) {
    return res.status(403).json({ error: 'You cannot approve your own leave request' });
  }

  // Overdraw check. allow_overdraw:true is an explicit override, not a default,
  // and it is recorded in the decision note so the exception stays visible.
  const year = yearOf(r.start_date);
  const { data: balance } = await supabaseAdmin
    .from('hr_leave_balances').select('entitled_days, used_days, remaining_days')
    .eq('company_id', companyId).eq('employee_id', r.employee_id)
    .eq('leave_type_id', r.leave_type_id).eq('year', year).maybeSingle();

  const remaining = balance ? Number(balance.remaining_days) : null;
  const overdraws = remaining !== null && Number(r.days) > remaining;
  if (overdraws && req.body?.allow_overdraw !== true) {
    return res.status(422).json({
      error: 'This request is for ' + r.days + ' day(s) but only ' + remaining + ' remain for ' + year + '.',
      remaining_days: remaining,
      requested_days: Number(r.days),
      hint: 'Send allow_overdraw:true to approve it anyway.',
    });
  }

  const note = [req.body?.note, overdraws ? 'Approved over the remaining balance.' : null]
    .filter(Boolean).join(' ') || null;

  const { data, error } = await supabaseAdmin.from('hr_leave_requests').update({
    status: 'approved',
    decided_by: req.user.id,
    decided_at: new Date().toISOString(),
    decision_note: note,
    updated_at: new Date().toISOString(),
  }).eq('id', r.id).select(full).single();
  if (error) return res.status(500).json({ error: error.message });

  // Re-read the balance the trigger just moved, so the caller sees the truth
  // rather than an optimistic guess.
  const { data: after } = await supabaseAdmin
    .from('hr_leave_balances').select('entitled_days, used_days, remaining_days')
    .eq('company_id', companyId).eq('employee_id', r.employee_id)
    .eq('leave_type_id', r.leave_type_id).eq('year', year).maybeSingle();

  logger.info('HR', 'leave ' + r.id + ' approved by ' + req.user.id + (overdraws ? ' (overdraw)' : ''));
  res.json({ request: data, balance: after || null });
}));

// POST /api/hr/leave/requests/:id/reject { reason }
router.post('/requests/:id/reject', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'hr.leave.approve')) return;

  const reason = (req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'A reason is required -- the requester has to know why' });

  const { data: r } = await supabaseAdmin
    .from('hr_leave_requests').select('id, employee_id, leave_type_id, start_date, status')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!r) return res.status(404).json({ error: 'Leave request not found' });
  if (!['pending', 'approved'].includes(r.status)) return res.status(409).json({ error: 'This request is already ' + r.status });

  const self = await selfEmployee(companyId, req.user.id);
  if (self && r.employee_id === self.id) return res.status(403).json({ error: 'You cannot action your own leave request' });

  const { data, error } = await supabaseAdmin.from('hr_leave_requests').update({
    status: 'rejected',
    decided_by: req.user.id,
    decided_at: new Date().toISOString(),
    decision_note: reason,
    updated_at: new Date().toISOString(),
  }).eq('id', r.id).select(full).single();
  if (error) return res.status(500).json({ error: error.message });

  // Rejecting a previously APPROVED request gives the days back -- the trigger
  // does it; this just reports the result.
  const { data: after } = await supabaseAdmin
    .from('hr_leave_balances').select('entitled_days, used_days, remaining_days')
    .eq('company_id', companyId).eq('employee_id', r.employee_id)
    .eq('leave_type_id', r.leave_type_id).eq('year', yearOf(r.start_date)).maybeSingle();

  res.json({ request: data, balance: after || null });
}));

// POST /api/hr/leave/requests/:id/cancel -- by the requester, before or after
// approval. An approved cancellation returns the days (mig 287 trigger).
router.post('/requests/:id/cancel', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  const { data: r } = await supabaseAdmin
    .from('hr_leave_requests').select('id, employee_id, leave_type_id, start_date, status')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!r) return res.status(404).json({ error: 'Leave request not found' });
  if (['cancelled', 'rejected'].includes(r.status)) return res.status(409).json({ error: 'This request is already ' + r.status });

  const self = await selfEmployee(companyId, req.user.id);
  const mine = self && r.employee_id === self.id;
  if (!mine && !(await can(req, companyId, 'hr.leave.approve'))) return res.status(403).json({ error: 'Forbidden' });

  const { data, error } = await supabaseAdmin.from('hr_leave_requests').update({
    status: 'cancelled',
    decided_by: req.user.id,
    decided_at: new Date().toISOString(),
    decision_note: req.body?.reason || 'Cancelled',
    updated_at: new Date().toISOString(),
  }).eq('id', r.id).select(full).single();
  if (error) return res.status(500).json({ error: error.message });

  const { data: after } = await supabaseAdmin
    .from('hr_leave_balances').select('entitled_days, used_days, remaining_days')
    .eq('company_id', companyId).eq('employee_id', r.employee_id)
    .eq('leave_type_id', r.leave_type_id).eq('year', yearOf(r.start_date)).maybeSingle();

  res.json({ request: data, balance: after || null });
}));

module.exports = router;
