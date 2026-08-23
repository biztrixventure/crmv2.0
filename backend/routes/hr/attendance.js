// ============================================================================
// /api/hr/attendance -- daily attendance records (mig 287).
//
// Who sees what is decided server-side and only server-side:
//
//   hr.attendance.view_team  -- the whole company.
//   hr.attendance.view_own   -- exactly one employee: the one whose
//                               hr_employees row carries the caller user_id.
//
// hrReadScope() answers that in one call. A caller with neither the team
// permission nor an employee record gets an empty list rather than a 403 --
// they are legitimately in the company, they just have no attendance to show,
// and a 403 there reads as a bug to the person looking at it.
//
// hours_worked is stored, not derived on read. It IS computed from check_in and
// check_out when both are present and the caller did not supply it, because a
// value that disagrees with its own timestamps is worse than no value.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../../config/database');
const { asyncHandler } = require('../../middleware/errorHandler');
const { can, deny, readCompanyId, writeCompanyId, selfEmployee, hrReadScope } = require('../../utils/moduleAccess');

const router = express.Router();

const full = 'id, company_id, employee_id, work_date, check_in, check_out, hours_worked, status, note, '
  + 'recorded_by, created_at, updated_at, hr_employees(id, first_name, last_name, employee_no, department_id)';

// Hours between two timestamps, 2dp. null when either side is missing.
function derivedHours(checkIn, checkOut) {
  if (!checkIn || !checkOut) return null;
  const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Number((ms / 3_600_000).toFixed(2));
}

// GET /api/hr/attendance?date_from&date_to&employee_id&department_id
router.get('/', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ attendance: [], scope: 'none' });

  const scope = await hrReadScope(req, companyId, 'hr.attendance.view_team');
  if (!scope.all && !scope.employee) return res.json({ attendance: [], scope: 'none', can_manage: false });

  // Default window: the current month. An unbounded attendance query is a table
  // scan that nobody actually wanted.
  const today = new Date();
  const from = req.query.date_from || new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const to   = req.query.date_to   || today.toISOString().slice(0, 10);

  let q = supabaseAdmin
    .from('hr_attendance').select(full)
    .eq('company_id', companyId)
    .gte('work_date', from).lte('work_date', to)
    .order('work_date', { ascending: false });

  if (!scope.all) {
    q = q.eq('employee_id', scope.employee.id);
  } else if (req.query.employee_id) {
    q = q.eq('employee_id', req.query.employee_id);
  }

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  let rows = data || [];
  // Department filter is applied here rather than in the query: the column
  // lives on the joined employee, and PostgREST cannot filter an embedded
  // resource without making it an inner join, which would silently drop
  // attendance rows whose employee record was deleted.
  if (scope.all && req.query.department_id) {
    rows = rows.filter(r => r.hr_employees?.department_id === req.query.department_id);
  }

  const summary = rows.reduce((a, r) => {
    a[r.status] = (a[r.status] || 0) + 1;
    a.hours += Number(r.hours_worked || 0);
    return a;
  }, { hours: 0 });
  summary.hours = Number(summary.hours.toFixed(2));

  res.json({
    attendance: rows,
    period: { date_from: from, date_to: to },
    scope: scope.all ? 'all' : 'own',
    my_employee_id: scope.employee?.id || null,
    can_manage: await can(req, companyId, 'hr.attendance.manage'),
    summary,
  });
}));

// GET /api/hr/attendance/me -- the caller own month, for the self-service card.
router.get('/me', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  const employee = await selfEmployee(companyId, req.user.id);
  if (!employee) return res.json({ attendance: [], employee: null });

  const today = new Date();
  const from = req.query.date_from || new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const to   = req.query.date_to   || today.toISOString().slice(0, 10);

  const { data, error } = await supabaseAdmin
    .from('hr_attendance')
    .select('id, work_date, check_in, check_out, hours_worked, status, note')
    .eq('company_id', companyId).eq('employee_id', employee.id)
    .gte('work_date', from).lte('work_date', to)
    .order('work_date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  res.json({ attendance: data || [], employee, period: { date_from: from, date_to: to } });
}));

// POST /api/hr/attendance
// Recording for SOMEONE ELSE needs hr.attendance.manage. Recording your own day
// needs only hr.attendance.view_own -- that is the self check-in.
router.post('/', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (!companyId) return res.status(400).json({ error: 'No company scope for this user' });

  const self = await selfEmployee(companyId, req.user.id);
  const targetId = req.body?.employee_id || self?.id || null;
  if (!targetId) return res.status(400).json({ error: 'No employee record to record attendance against' });

  const isSelf = self && targetId === self.id;
  const gate = isSelf ? 'hr.attendance.view_own' : 'hr.attendance.manage';
  if (await deny(req, res, companyId, gate)) return;

  // The target must live in this company. Without this an employee_id from
  // another tenant would happily insert.
  const { data: target } = await supabaseAdmin
    .from('hr_employees').select('id').eq('id', targetId).eq('company_id', companyId).maybeSingle();
  if (!target) return res.status(404).json({ error: 'Employee not found in this company' });

  const b = req.body || {};
  const workDate = b.work_date || new Date().toISOString().slice(0, 10);
  const hours = b.hours_worked !== undefined ? Number(b.hours_worked) : derivedHours(b.check_in, b.check_out);

  const { data, error } = await supabaseAdmin.from('hr_attendance').upsert({
    company_id: companyId,
    employee_id: targetId,
    work_date: workDate,
    check_in: b.check_in || null,
    check_out: b.check_out || null,
    hours_worked: hours,
    status: b.status || 'present',
    note: b.note || null,
    recorded_by: req.user.id,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'company_id,employee_id,work_date' }).select(full).single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ attendance: data });
}));

// PUT /api/hr/attendance/:id
router.put('/:id', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);

  const { data: existing } = await supabaseAdmin
    .from('hr_attendance').select('id, employee_id, check_in, check_out')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Attendance record not found' });

  const self = await selfEmployee(companyId, req.user.id);
  const isSelf = self && existing.employee_id === self.id;
  if (await deny(req, res, companyId, isSelf ? 'hr.attendance.view_own' : 'hr.attendance.manage')) return;

  const b = req.body || {};
  const patch = { updated_at: new Date().toISOString(), recorded_by: req.user.id };
  for (const f of ['check_in', 'check_out', 'status', 'note', 'work_date']) {
    if (b[f] !== undefined) patch[f] = b[f];
  }
  if (b.hours_worked !== undefined) {
    patch.hours_worked = b.hours_worked === null ? null : Number(b.hours_worked);
  } else if (b.check_in !== undefined || b.check_out !== undefined) {
    patch.hours_worked = derivedHours(
      b.check_in !== undefined ? b.check_in : existing.check_in,
      b.check_out !== undefined ? b.check_out : existing.check_out,
    );
  }

  const { data, error } = await supabaseAdmin
    .from('hr_attendance').update(patch).eq('id', existing.id).select(full).single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ attendance: data });
}));

// POST /api/hr/attendance/bulk -- one day, many employees. This is how a manager
// marks a whole team present in one action; doing it one request per person is
// what makes people stop using an attendance module.
router.post('/bulk', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (!companyId) return res.status(400).json({ error: 'No company scope for this user' });
  if (await deny(req, res, companyId, 'hr.attendance.manage')) return;

  const rows = Array.isArray(req.body?.records) ? req.body.records : [];
  if (!rows.length) return res.status(400).json({ error: 'records[] is required' });
  if (rows.length > 500) return res.status(400).json({ error: 'At most 500 records per call' });

  const ids = [...new Set(rows.map(r => r.employee_id).filter(Boolean))];
  const { data: valid } = await supabaseAdmin
    .from('hr_employees').select('id').eq('company_id', companyId).in('id', ids);
  const allowed = new Set((valid || []).map(e => e.id));
  const rejected = ids.filter(id => !allowed.has(id));
  if (rejected.length) return res.status(400).json({ error: 'Some employees do not belong to this company', employee_ids: rejected });

  const now = new Date().toISOString();
  const payload = rows.map(r => ({
    company_id: companyId,
    employee_id: r.employee_id,
    work_date: r.work_date || new Date().toISOString().slice(0, 10),
    check_in: r.check_in || null,
    check_out: r.check_out || null,
    hours_worked: r.hours_worked !== undefined ? Number(r.hours_worked) : derivedHours(r.check_in, r.check_out),
    status: r.status || 'present',
    note: r.note || null,
    recorded_by: req.user.id,
    updated_at: now,
  }));

  const { data, error } = await supabaseAdmin
    .from('hr_attendance').upsert(payload, { onConflict: 'company_id,employee_id,work_date' }).select();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ saved: data?.length || 0, attendance: data || [] });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'hr.attendance.manage')) return;

  const { error } = await supabaseAdmin
    .from('hr_attendance').delete().eq('id', req.params.id).eq('company_id', companyId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

module.exports = router;
