// ============================================================================
// /api/hr/employees -- employees, departments and positions (mig 286).
//
// An employee is NOT a user. user_id is optional in both directions, so this
// file never assumes the person it is describing can log in. Where the link
// does exist it is what makes every self-service HR route work: they resolve
// "me" from (company_id, user_id) and never take an employee_id from a client.
//
// Directory visibility is deliberately generous -- hr.employees.view is a read
// of names, departments and managers, the same thing a wall chart shows. The
// sensitive columns (salary, date of birth, home address, emergency contact)
// are stripped for anyone without hr.employees.manage, so one endpoint serves
// both audiences without a second route to keep in sync.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../../config/database');
const { asyncHandler } = require('../../middleware/errorHandler');
const logger = require('../../utils/logger');
const { can, deny, readCompanyId, writeCompanyId, selfEmployee } = require('../../utils/moduleAccess');

const router = express.Router();

// Columns only an HR manager (or the person themselves) may see.
const SENSITIVE = ['base_salary', 'pay_frequency', 'date_of_birth', 'address', 'emergency_contact', 'personal_email', 'notes'];

const redact = (row, allowed) => {
  if (allowed) return row;
  const out = { ...row };
  for (const f of SENSITIVE) delete out[f];
  return out;
};

const full = 'id, company_id, user_id, employee_no, first_name, last_name, work_email, personal_email, '
  + 'phone, date_of_birth, address, emergency_contact, department_id, position_id, manager_employee_id, '
  + 'hire_date, termination_date, employment_type, status, base_salary, pay_frequency, currency, notes, '
  + 'created_at, updated_at, '
  + 'hr_departments(id, name), hr_positions(id, title)';

async function nextEmployeeNo(companyId) {
  const { data } = await supabaseAdmin
    .from('hr_employees').select('employee_no')
    .eq('company_id', companyId).order('created_at', { ascending: false }).limit(1);
  const m = /^EMP-(\d+)$/.exec(data?.[0]?.employee_no || '');
  return 'EMP-' + String(m ? Number(m[1]) + 1 : 1).padStart(5, '0');
}

// -- Departments --------------------------------------------------------------

router.get('/departments', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ departments: [] });
  if (await deny(req, res, companyId, 'hr.employees.view')) return;

  const { data, error } = await supabaseAdmin
    .from('hr_departments')
    .select('id, name, description, head_employee_id, is_active, created_at')
    .eq('company_id', companyId).order('name');
  if (error) return res.status(500).json({ error: error.message });

  // Headcount per department, so the directory can show it without N queries.
  const { data: emps } = await supabaseAdmin
    .from('hr_employees').select('department_id')
    .eq('company_id', companyId).eq('status', 'active');
  const counts = (emps || []).reduce((a, e) => {
    if (e.department_id) a[e.department_id] = (a[e.department_id] || 0) + 1;
    return a;
  }, {});

  res.json({ departments: (data || []).map(d => ({ ...d, headcount: counts[d.id] || 0 })) });
}));

router.post('/departments', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (!companyId) return res.status(400).json({ error: 'No company scope for this user' });
  if (await deny(req, res, companyId, 'hr.employees.manage')) return;
  if (!req.body?.name) return res.status(400).json({ error: 'name is required' });

  const { data, error } = await supabaseAdmin.from('hr_departments').insert({
    company_id: companyId,
    name: String(req.body.name).trim(),
    description: req.body.description || null,
    head_employee_id: req.body.head_employee_id || null,
    created_by: req.user.id,
  }).select().single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'A department with that name already exists' });
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json({ department: data });
}));

router.put('/departments/:id', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'hr.employees.manage')) return;

  const patch = { updated_at: new Date().toISOString() };
  for (const f of ['name', 'description', 'head_employee_id']) if (req.body?.[f] !== undefined) patch[f] = req.body[f];
  if (req.body?.is_active !== undefined) patch.is_active = !!req.body.is_active;

  const { data, error } = await supabaseAdmin.from('hr_departments')
    .update(patch).eq('id', req.params.id).eq('company_id', companyId).select().maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Department not found' });
  res.json({ department: data });
}));

router.delete('/departments/:id', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'hr.employees.manage')) return;

  const { count } = await supabaseAdmin
    .from('hr_employees').select('id', { count: 'exact', head: true })
    .eq('company_id', companyId).eq('department_id', req.params.id);
  if (count) return res.status(409).json({ error: 'Department still has ' + count + ' employee(s). Move them first, or archive the department.' });

  const { error } = await supabaseAdmin.from('hr_departments').delete().eq('id', req.params.id).eq('company_id', companyId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

// -- Positions ----------------------------------------------------------------

router.get('/positions', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ positions: [] });
  if (await deny(req, res, companyId, 'hr.employees.view')) return;

  let q = supabaseAdmin
    .from('hr_positions').select('id, title, department_id, description, is_active, hr_departments(id, name)')
    .eq('company_id', companyId).order('title');
  if (req.query.department_id) q = q.eq('department_id', req.query.department_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ positions: data || [] });
}));

router.post('/positions', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (!companyId) return res.status(400).json({ error: 'No company scope for this user' });
  if (await deny(req, res, companyId, 'hr.employees.manage')) return;
  if (!req.body?.title) return res.status(400).json({ error: 'title is required' });

  const { data, error } = await supabaseAdmin.from('hr_positions').insert({
    company_id: companyId,
    title: String(req.body.title).trim(),
    department_id: req.body.department_id || null,
    description: req.body.description || null,
    created_by: req.user.id,
  }).select().single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'A position with that title already exists' });
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json({ position: data });
}));

router.put('/positions/:id', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'hr.employees.manage')) return;

  const patch = { updated_at: new Date().toISOString() };
  for (const f of ['title', 'department_id', 'description']) if (req.body?.[f] !== undefined) patch[f] = req.body[f];
  if (req.body?.is_active !== undefined) patch.is_active = !!req.body.is_active;

  const { data, error } = await supabaseAdmin.from('hr_positions')
    .update(patch).eq('id', req.params.id).eq('company_id', companyId).select().maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Position not found' });
  res.json({ position: data });
}));

router.delete('/positions/:id', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'hr.employees.manage')) return;

  const { count } = await supabaseAdmin
    .from('hr_employees').select('id', { count: 'exact', head: true })
    .eq('company_id', companyId).eq('position_id', req.params.id);
  if (count) return res.status(409).json({ error: 'Position is held by ' + count + ' employee(s). Reassign them first.' });

  const { error } = await supabaseAdmin.from('hr_positions').delete().eq('id', req.params.id).eq('company_id', companyId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

// -- Unlinked CRM users -------------------------------------------------------
// Who in this company has a login but no HR record yet. This is what makes the
// "create employee from an existing user" flow possible without hand-typing a
// uuid, and it is why the directory can ever be complete.
router.get('/linkable-users', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ users: [] });
  if (await deny(req, res, companyId, 'hr.employees.manage')) return;

  const [{ data: ucr }, { data: emps }] = await Promise.all([
    supabaseAdmin.from('user_company_roles')
      .select('user_id, custom_roles(name, level)')
      .eq('company_id', companyId).eq('is_active', true),
    supabaseAdmin.from('hr_employees').select('user_id').eq('company_id', companyId).not('user_id', 'is', null),
  ]);
  const taken = new Set((emps || []).map(e => e.user_id));
  const freeIds = (ucr || []).map(r => r.user_id).filter(id => !taken.has(id));
  if (!freeIds.length) return res.json({ users: [] });

  const { data: profs } = await supabaseAdmin
    .from('user_profiles').select('user_id, first_name, last_name').in('user_id', freeIds);
  const roleOf = Object.fromEntries((ucr || []).map(r => [r.user_id, r.custom_roles?.name || r.custom_roles?.level || null]));

  res.json({
    users: (profs || []).map(p => ({
      user_id: p.user_id,
      first_name: p.first_name, last_name: p.last_name,
      name: [p.first_name, p.last_name].filter(Boolean).join(' ') || p.user_id,
      role: roleOf[p.user_id] || null,
    })).sort((a, b) => a.name.localeCompare(b.name)),
  });
}));

// -- Me -----------------------------------------------------------------------
// The caller own record. No permission needed beyond being in the company:
// every self-service HR surface starts here.
router.get('/me', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  const employee = await selfEmployee(companyId, req.user.id);
  if (!employee) return res.json({ employee: null });

  const { data } = await supabaseAdmin
    .from('hr_employees').select(full).eq('id', employee.id).single();
  res.json({ employee: data });   // own record -- sensitive fields are theirs to see
}));

// -- Employees ----------------------------------------------------------------

router.get('/', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ employees: [], total: 0 });
  if (await deny(req, res, companyId, 'hr.employees.view')) return;
  const canManage = await can(req, companyId, 'hr.employees.manage');

  const page  = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  const from  = (page - 1) * limit;

  let q = supabaseAdmin
    .from('hr_employees').select(full, { count: 'exact' })
    .eq('company_id', companyId)
    .order('first_name', { ascending: true })
    .range(from, from + limit - 1);

  if (req.query.status)        q = q.eq('status', req.query.status);
  else if (req.query.include_terminated !== 'true') q = q.neq('status', 'terminated');
  if (req.query.department_id) q = q.eq('department_id', req.query.department_id);
  if (req.query.position_id)   q = q.eq('position_id', req.query.position_id);
  if (req.query.search) {
    const s = req.query.search;
    q = q.or('first_name.ilike.%' + s + '%,last_name.ilike.%' + s + '%,employee_no.ilike.%' + s + '%,work_email.ilike.%' + s + '%');
  }

  const { data, error, count } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const self = await selfEmployee(companyId, req.user.id);
  res.json({
    employees: (data || []).map(e => redact(e, canManage || e.id === self?.id)),
    total: count || 0, page, limit,
    can_manage: canManage,
    my_employee_id: self?.id || null,
  });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (await deny(req, res, companyId, 'hr.employees.view')) return;

  const { data, error } = await supabaseAdmin
    .from('hr_employees').select(full).eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Employee not found' });

  const canManage = await can(req, companyId, 'hr.employees.manage');
  const isSelf = data.user_id && data.user_id === req.user.id;

  // Direct reports, so the profile page can show the org branch.
  const { data: reports } = await supabaseAdmin
    .from('hr_employees').select('id, first_name, last_name, employee_no, status')
    .eq('company_id', companyId).eq('manager_employee_id', data.id).neq('status', 'terminated');

  res.json({ employee: redact(data, canManage || isSelf), direct_reports: reports || [] });
}));

router.post('/', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (!companyId) return res.status(400).json({ error: 'No company scope for this user' });
  if (await deny(req, res, companyId, 'hr.employees.manage')) return;

  const b = req.body || {};
  if (!b.first_name) return res.status(400).json({ error: 'first_name is required' });

  // A linked user must actually belong to this company, or the HR record would
  // describe somebody else tenant employee.
  if (b.user_id) {
    const { data: member } = await supabaseAdmin.from('user_company_roles')
      .select('id').eq('user_id', b.user_id).eq('company_id', companyId).eq('is_active', true).maybeSingle();
    if (!member) return res.status(400).json({ error: 'That user is not an active member of this company' });
  }

  const { data, error } = await supabaseAdmin.from('hr_employees').insert({
    company_id:   companyId,
    user_id:      b.user_id || null,
    employee_no:  b.employee_no || await nextEmployeeNo(companyId),
    first_name:   String(b.first_name).trim(),
    last_name:    b.last_name || null,
    work_email:   b.work_email || null,
    personal_email: b.personal_email || null,
    phone:        b.phone || null,
    date_of_birth: b.date_of_birth || null,
    address:      b.address || null,
    emergency_contact: b.emergency_contact || null,
    department_id: b.department_id || null,
    position_id:  b.position_id || null,
    manager_employee_id: b.manager_employee_id || null,
    hire_date:    b.hire_date || null,
    employment_type: b.employment_type || null,
    status:       b.status || 'active',
    base_salary:  b.base_salary ?? null,
    pay_frequency: b.pay_frequency || null,
    currency:     b.currency || 'USD',
    notes:        b.notes || null,
    created_by:   req.user.id,
  }).select(full).single();

  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'That employee number, or that user, already has a record in this company' });
    return res.status(500).json({ error: error.message });
  }
  logger.info('HR', 'employee ' + data.employee_no + ' created in ' + companyId + ' by ' + req.user.id);
  res.status(201).json({ employee: data });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'hr.employees.manage')) return;

  const { data: existing } = await supabaseAdmin
    .from('hr_employees').select('id, employee_no, status')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Employee not found' });

  const b = req.body || {};
  if (b.manager_employee_id && b.manager_employee_id === existing.id) {
    return res.status(400).json({ error: 'An employee cannot report to themselves' });
  }
  if (b.user_id) {
    const { data: member } = await supabaseAdmin.from('user_company_roles')
      .select('id').eq('user_id', b.user_id).eq('company_id', companyId).eq('is_active', true).maybeSingle();
    if (!member) return res.status(400).json({ error: 'That user is not an active member of this company' });
  }

  const patch = { updated_at: new Date().toISOString() };
  for (const f of ['user_id', 'employee_no', 'first_name', 'last_name', 'work_email', 'personal_email',
                   'phone', 'date_of_birth', 'address', 'emergency_contact', 'department_id', 'position_id',
                   'manager_employee_id', 'hire_date', 'termination_date', 'employment_type', 'status',
                   'base_salary', 'pay_frequency', 'currency', 'notes']) {
    if (b[f] !== undefined) patch[f] = b[f];
  }
  // Terminating without a date leaves a record that cannot answer "when".
  if (patch.status === 'terminated' && !patch.termination_date) {
    patch.termination_date = new Date().toISOString().slice(0, 10);
  }

  const { data, error } = await supabaseAdmin
    .from('hr_employees').update(patch).eq('id', existing.id).select(full).single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'That employee number, or that user, already has a record in this company' });
    return res.status(500).json({ error: error.message });
  }
  res.json({ employee: data });
}));

// DELETE -- refused once the person has any HR history. Terminating is the
// real-world action; deleting a paid, reviewed, attended employee erases the
// record those things point at.
router.delete('/:id', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'hr.employees.manage')) return;

  const { data: existing } = await supabaseAdmin
    .from('hr_employees').select('id, employee_no')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Employee not found' });

  const [att, pay, rev, lv] = await Promise.all([
    supabaseAdmin.from('hr_attendance').select('id', { count: 'exact', head: true }).eq('employee_id', existing.id),
    supabaseAdmin.from('hr_payroll_entries').select('id', { count: 'exact', head: true }).eq('employee_id', existing.id),
    supabaseAdmin.from('hr_reviews').select('id', { count: 'exact', head: true }).eq('employee_id', existing.id),
    supabaseAdmin.from('hr_leave_requests').select('id', { count: 'exact', head: true }).eq('employee_id', existing.id),
  ]);
  const history = (att.count || 0) + (pay.count || 0) + (rev.count || 0) + (lv.count || 0);
  if (history > 0) {
    return res.status(409).json({
      error: 'Employee ' + existing.employee_no + ' has ' + history + ' HR record(s) attached. Set their status to terminated instead of deleting.',
      history_count: history,
    });
  }

  const { error } = await supabaseAdmin.from('hr_employees').delete().eq('id', existing.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

module.exports = router;
