// ============================================================================
// routes/moduleHistory.js -- read side of the change record (mig 313).
//
// Mounted twice, once per module:
//   /api/hr/history          historyRouter('hr')
//   /api/accounting/history  historyRouter('accounting')
//
// Two views of the same append-only log:
//
//   GET /record/:table/:id   One record's whole life: created, every field
//                            change with old -> new, who, when, why, deleted.
//                            A document's parts come with it -- an invoice
//                            brings its lines and payments, a payroll run its
//                            entries and their deductions, an employee their
//                            CRM role/active changes.
//                            Gate: whatever lets you SEE that record type.
//
//   GET /feed                The company-wide change log, newest first.
//                            Gate: hr.history.view / accounting.history.view,
//                            a separate grant so a superadmin can hand an
//                            auditor the log without handing them payroll.
//
// Both are company-scoped through readCompanyId -- a record id guessed from
// another tenant returns nothing, because every audit row carries company_id.
// Both redact the employee's private fields (salary, date of birth, address...)
// from anyone who could not read them on the record itself: history must never
// be a side door around the directory's redaction.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { can, readCompanyId, selfEmployee } = require('../utils/moduleAccess');

// Same list routes/hr/employees.js strips from the directory.
const EMPLOYEE_PRIVATE = ['base_salary', 'pay_frequency', 'date_of_birth', 'address',
  'emergency_contact', 'personal_email', 'notes'];

// table -> { permissions that may read it (any one), children }
const TABLES = {
  hr: {
    hr_employees:          { perms: ['hr.employees.view'], children: [{ table: 'user_company_roles', via: 'user_id' }] },
    hr_departments:        { perms: ['hr.employees.view'] },
    hr_positions:          { perms: ['hr.employees.view'] },
    hr_attendance:         { perms: ['hr.attendance.view_team', 'hr.attendance.manage'] },
    hr_leave_types:        { perms: ['hr.leave.view_team', 'hr.leave.manage'] },
    hr_leave_balances:     { perms: ['hr.leave.view_team', 'hr.leave.manage'] },
    hr_leave_requests:     { perms: ['hr.leave.view_team', 'hr.leave.approve'] },
    hr_pay_periods:        { perms: ['hr.payroll.view', 'hr.payroll.manage'] },
    hr_payroll_runs:       { perms: ['hr.payroll.view', 'hr.payroll.manage'],
                             children: [{ table: 'hr_payroll_entries' }, { table: 'hr_payroll_deductions', grand: true }] },
    hr_payroll_entries:    { perms: ['hr.payroll.view', 'hr.payroll.manage'], children: [{ table: 'hr_payroll_deductions' }] },
    hr_payroll_deductions: { perms: ['hr.payroll.view', 'hr.payroll.manage'] },
    hr_review_cycles:      { perms: ['hr.reviews.view_team', 'hr.reviews.manage'] },
    hr_reviews:            { perms: ['hr.reviews.view_team', 'hr.reviews.manage'],
                             children: [{ table: 'hr_review_goals' }, { table: 'hr_review_ratings' }] },
    hr_review_goals:       { perms: ['hr.reviews.view_team', 'hr.reviews.manage'] },
    hr_review_ratings:     { perms: ['hr.reviews.view_team', 'hr.reviews.manage'] },
    user_company_roles:    { perms: ['hr.employees.view'] },
    hr_settings:           { perms: ['hr.employees.view'] },           // record id = company id (mig 314)
    hr_exit_cases:         { perms: ['hr.employees.view'] },
  },
  accounting: {
    chart_of_accounts:   { perms: ['accounting.accounts.view'] },
    journal_entries:     { perms: ['accounting.journal.view'], children: [{ table: 'journal_entry_lines' }] },
    journal_entry_lines: { perms: ['accounting.journal.view'] },
    invoices:            { perms: ['accounting.invoices.view', 'accounting.invoices.manage'],
                           children: [{ table: 'invoice_line_items' }, { table: 'invoice_payments' }] },
    invoice_line_items:  { perms: ['accounting.invoices.view', 'accounting.invoices.manage'] },
    invoice_payments:    { perms: ['accounting.invoices.view', 'accounting.invoices.manage'] },
    expense_categories:  { perms: ['accounting.expenses.view', 'accounting.expenses.approve'] },
    expenses:            { perms: ['accounting.expenses.view', 'accounting.expenses.approve'] },
  },
};

// The log's own module values each router may read. HR also owns the CRM
// membership rows ('people'): a role change is a position change.
const LOG_MODULES = { hr: ['hr', 'people'], accounting: ['accounting'] };

const SELECT = 'id, module, company_id, table_name, record_id, parent_id, operation, changes, changed_by, reason, source, changed_at';

async function canAny(req, companyId, perms) {
  for (const p of perms) if (await can(req, companyId, p)) return true;
  return false;
}

// Strip private employee fields from one event, in both shapes.
function redactEvent(ev) {
  if (ev.table_name !== 'hr_employees') return ev;
  const changes = { ...(ev.changes || {}) };
  if (changes.snapshot) {
    const snap = { ...changes.snapshot };
    for (const f of EMPLOYEE_PRIVATE) if (f in snap) snap[f] = '(hidden)';
    changes.snapshot = snap;
  } else {
    for (const f of EMPLOYEE_PRIVATE) if (f in changes) changes[f] = { old: '(hidden)', new: '(hidden)' };
  }
  return { ...ev, changes };
}

// Who did it, in words. Actor names come from user_profiles; rows written with
// no signed-in user say where they came from instead of showing a blank.
async function withActors(events) {
  const ids = [...new Set(events.map(e => e.changed_by).filter(Boolean))];
  const names = {};
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await supabaseAdmin
      .from('user_profiles').select('user_id, first_name, last_name').in('user_id', ids.slice(i, i + 100));
    for (const p of data || []) {
      names[p.user_id] = [p.first_name, p.last_name].filter(Boolean).join(' ') || null;
    }
  }
  return events.map(e => ({
    ...e,
    actor_name: e.changed_by
      ? (names[e.changed_by] || 'Unknown user')
      : e.source === 'baseline' ? 'History started'
      : String(e.source || '').startsWith('job:') ? 'Automatic (' + e.source.slice(4) + ')'
      : 'System (direct database change)',
  }));
}

// A human handle for each record in a list of events, so the change log reads
// "Invoice INV-000004" rather than a uuid. Taken from the event's own snapshot
// when there is one (covers deleted records), otherwise looked up in batches.
const LABELERS = {
  hr_employees:       { select: 'id, first_name, last_name, employee_no', fmt: r => [r.first_name, r.last_name].filter(Boolean).join(' ') || r.employee_no },
  hr_departments:     { select: 'id, name', fmt: r => r.name },
  hr_positions:       { select: 'id, title', fmt: r => r.title },
  hr_leave_types:     { select: 'id, name', fmt: r => r.name },
  hr_pay_periods:     { select: 'id, name', fmt: r => r.name },
  hr_payroll_runs:    { select: 'id, name', fmt: r => r.name },
  hr_review_cycles:   { select: 'id, name', fmt: r => r.name },
  chart_of_accounts:  { select: 'id, code, name', fmt: r => (r.code ? r.code + ' ' : '') + r.name },
  journal_entries:    { select: 'id, entry_no, memo', fmt: r => r.entry_no + (r.memo ? ' -- ' + r.memo : '') },
  invoices:           { select: 'id, invoice_no, customer_name', fmt: r => r.invoice_no + (r.customer_name ? ' -- ' + r.customer_name : '') },
  expense_categories: { select: 'id, name', fmt: r => r.name },
  expenses:           { select: 'id, description, vendor, amount', fmt: r => r.description || r.vendor || ('Claim ' + r.amount) },
};
// Rows that are "about" an employee borrow the employee's name.
const BY_EMPLOYEE = ['hr_attendance', 'hr_leave_balances', 'hr_leave_requests', 'hr_reviews', 'hr_payroll_entries'];

async function withLabels(events) {
  const want = {};            // table -> Set(ids)
  const add = (t, id) => { if (!id) return; (want[t] = want[t] || new Set()).add(id); };
  const userIds = new Set();

  for (const e of events) {
    if (LABELERS[e.table_name]) add(e.table_name, e.record_id);
    const snap = e.changes?.snapshot;
    if (BY_EMPLOYEE.includes(e.table_name) && snap?.employee_id) add('hr_employees', snap.employee_id);
    if (e.table_name === 'user_company_roles') userIds.add(snap?.user_id || e.parent_id);
  }

  // UPDATE events carry no snapshot: an attendance/leave/entry row's employee
  // comes from the live row (or from parent_id, which is the employee for
  // attendance, leave and reviews -- see the mig 313 attach list).
  const recEmp = {};
  for (const t of BY_EMPLOYEE) {
    const ids = [...new Set(events.filter(e => e.table_name === t && !e.changes?.snapshot).map(e => e.record_id))];
    if (!ids.length) continue;
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await supabaseAdmin.from(t).select('id, employee_id').in('id', ids.slice(i, i + 100));
      for (const r of data || []) { recEmp[r.id] = r.employee_id; add('hr_employees', r.employee_id); }
    }
  }

  const labels = {};
  for (const [t, set] of Object.entries(want)) {
    const ids = [...set].filter(Boolean);
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await supabaseAdmin.from(t).select(LABELERS[t].select).in('id', ids.slice(i, i + 100));
      for (const r of data || []) labels[t + ':' + r.id] = LABELERS[t].fmt(r);
    }
  }
  const userNames = {};
  const uids = [...userIds].filter(Boolean);
  for (let i = 0; i < uids.length; i += 100) {
    const { data } = await supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', uids.slice(i, i + 100));
    for (const p of data || []) userNames[p.user_id] = [p.first_name, p.last_name].filter(Boolean).join(' ');
  }

  return events.map(e => {
    const snap = e.changes?.snapshot;
    let label = null;
    if (LABELERS[e.table_name]) {
      label = labels[e.table_name + ':' + e.record_id] || (snap ? LABELERS[e.table_name].fmt(snap) : null);
    } else if (BY_EMPLOYEE.includes(e.table_name)) {
      const emp = snap?.employee_id || recEmp[e.record_id];
      label = labels['hr_employees:' + emp] || null;
      if (e.table_name === 'hr_attendance' && snap?.work_date) label = (label || 'Attendance') + ' -- ' + snap.work_date;
    } else if (e.table_name === 'user_company_roles') {
      label = userNames[snap?.user_id || e.parent_id] || null;
    }
    return { ...e, record_label: label };
  });
}

// Reference columns shown by NAME in the timeline ("Role: Trainee -> Fronter",
// not two uuids). One lookup per referenced table for the whole response.
const REF_FIELDS = {
  role_id:             { table: 'custom_roles',       select: 'id, name',                 fmt: r => r.name },
  department_id:       { table: 'hr_departments',     select: 'id, name',                 fmt: r => r.name },
  position_id:         { table: 'hr_positions',       select: 'id, title',                fmt: r => r.title },
  manager_employee_id: { table: 'hr_employees',       select: 'id, first_name, last_name', fmt: r => [r.first_name, r.last_name].filter(Boolean).join(' ') },
  head_employee_id:    { table: 'hr_employees',       select: 'id, first_name, last_name', fmt: r => [r.first_name, r.last_name].filter(Boolean).join(' ') },
  reviewer_employee_id:{ table: 'hr_employees',       select: 'id, first_name, last_name', fmt: r => [r.first_name, r.last_name].filter(Boolean).join(' ') },
  employee_id:         { table: 'hr_employees',       select: 'id, first_name, last_name', fmt: r => [r.first_name, r.last_name].filter(Boolean).join(' ') },
  account_id:          { table: 'chart_of_accounts',  select: 'id, code, name',           fmt: r => (r.code ? r.code + ' ' : '') + r.name },
  parent_id:           { table: 'chart_of_accounts',  select: 'id, code, name',           fmt: r => (r.code ? r.code + ' ' : '') + r.name },
  category_id:         { table: 'expense_categories', select: 'id, name',                 fmt: r => r.name },
  leave_type_id:       { table: 'hr_leave_types',     select: 'id, name',                 fmt: r => r.name },
  pay_period_id:       { table: 'hr_pay_periods',     select: 'id, name',                 fmt: r => r.name },
  cycle_id:            { table: 'hr_review_cycles',   select: 'id, name',                 fmt: r => r.name },
};
const PERSON_FIELDS = ['user_id', 'created_by', 'recorded_by', 'submitted_by', 'approved_by', 'rejected_by',
  'reimbursed_by', 'decided_by', 'requested_by', 'finalized_by', 'voided_by', 'posted_by', 'assigned_by',
  'signed_off_by', 'designated_by'];

async function refNames(events) {
  const want = {};                       // table -> Set(id)
  const people = new Set();
  const isId = v => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);
  const visit = (field, value) => {
    if (!isId(value)) return;
    if (REF_FIELDS[field]) (want[REF_FIELDS[field].table] = want[REF_FIELDS[field].table] || new Set()).add(value);
    else if (PERSON_FIELDS.includes(field)) people.add(value);
  };
  for (const e of events) {
    const c = e.changes || {};
    if (c.snapshot) for (const [k, v] of Object.entries(c.snapshot)) visit(k, v);
    else for (const [k, v] of Object.entries(c)) { visit(k, v?.old); visit(k, v?.new); }
  }
  const names = {};
  const byTable = {};
  for (const spec of Object.values(REF_FIELDS)) byTable[spec.table] = spec;
  for (const [table, set] of Object.entries(want)) {
    const ids = [...set];
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await supabaseAdmin.from(table).select(byTable[table].select).in('id', ids.slice(i, i + 100));
      for (const r of data || []) names[r.id] = byTable[table].fmt(r);
    }
  }
  const pids = [...people];
  for (let i = 0; i < pids.length; i += 100) {
    const { data } = await supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', pids.slice(i, i + 100));
    for (const p of data || []) names[p.user_id] = [p.first_name, p.last_name].filter(Boolean).join(' ') || null;
  }
  return names;
}

function historyRouter(moduleKey) {
  const router = express.Router();
  const catalog = TABLES[moduleKey];
  const logModules = LOG_MODULES[moduleKey];

  // One record, with its parts.
  router.get('/record/:table/:id', asyncHandler(async (req, res) => {
    const { table, id } = req.params;
    const spec = catalog[table];
    if (!spec) return res.status(400).json({ error: 'History is not kept for that record type here' });

    const companyId = await readCompanyId(req);
    if (!companyId) return res.json({ events: [] });

    // Self-service: an employee may read the history of their own employee
    // record and their own attendance days, even without the team permission.
    let allowed = await canAny(req, companyId, spec.perms);
    let selfOnly = false;
    if (!allowed && (table === 'hr_employees' || table === 'hr_attendance')) {
      const me = await selfEmployee(companyId, req.user.id);
      if (me) {
        if (table === 'hr_employees') selfOnly = me.id === id;
        else {
          const { data: row } = await supabaseAdmin.from('hr_attendance').select('employee_id')
            .eq('id', id).eq('company_id', companyId).maybeSingle();
          selfOnly = row?.employee_id === me.id;
        }
      }
      allowed = selfOnly;
    }
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });

    // The record itself.
    const { data: own, error } = await supabaseAdmin
      .from('module_audit_log').select(SELECT)
      .eq('company_id', companyId).eq('table_name', table).eq('record_id', id)
      .order('id', { ascending: false }).limit(500);
    if (error) return res.status(500).json({ error: error.message });
    let events = own || [];

    // Its parts.
    for (const child of spec.children || []) {
      if (child.grand) continue;
      let parentKey = id;
      if (child.via === 'user_id') {
        // Employee -> their CRM membership rows, keyed on the login.
        const { data: emp } = await supabaseAdmin.from('hr_employees').select('user_id')
          .eq('id', id).eq('company_id', companyId).maybeSingle();
        parentKey = emp?.user_id || null;
        if (!parentKey) continue;
      }
      const { data: kids } = await supabaseAdmin
        .from('module_audit_log').select(SELECT)
        .eq('company_id', companyId).eq('table_name', child.table).eq('parent_id', parentKey)
        .order('id', { ascending: false }).limit(1000);
      events = events.concat(kids || []);
    }
    // Grandchildren (payroll run -> entries -> deductions).
    const grand = (spec.children || []).find(c => c.grand);
    if (grand) {
      const entryIds = [...new Set(events.filter(e => e.table_name === 'hr_payroll_entries').map(e => e.record_id))];
      for (let i = 0; i < entryIds.length; i += 100) {
        const { data: gk } = await supabaseAdmin
          .from('module_audit_log').select(SELECT)
          .eq('company_id', companyId).eq('table_name', grand.table).in('parent_id', entryIds.slice(i, i + 100))
          .order('id', { ascending: false }).limit(1000);
        events = events.concat(gk || []);
      }
    }

    const mayReadPrivate = selfOnly || await can(req, companyId, 'hr.employees.manage');
    events.sort((a, b) => b.id - a.id);
    if (!mayReadPrivate) events = events.map(redactEvent);
    events = await withLabels(await withActors(events));
    res.json({ events, ref_names: await refNames(events) });
  }));

  // The company-wide change log.
  router.get('/feed', asyncHandler(async (req, res) => {
    const companyId = await readCompanyId(req);
    if (!companyId) return res.json({ events: [], next_before: null });
    if (!(await can(req, companyId, moduleKey + '.history.view'))) return res.status(403).json({ error: 'Forbidden' });

    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    let q = supabaseAdmin
      .from('module_audit_log').select(SELECT)
      .eq('company_id', companyId).in('module', logModules)
      .order('id', { ascending: false }).limit(limit);

    if (req.query.table && catalog[req.query.table]) q = q.eq('table_name', req.query.table);
    if (req.query.actor && /^[0-9a-f-]{36}$/i.test(String(req.query.actor))) q = q.eq('changed_by', req.query.actor);
    if (['INSERT', 'UPDATE', 'DELETE'].includes(req.query.operation)) q = q.eq('operation', req.query.operation);
    if (req.query.include_baseline !== 'true') q = q.neq('source', 'baseline');
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date_from || ''))) q = q.gte('changed_at', req.query.date_from);
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date_to || '')))   q = q.lte('changed_at', req.query.date_to + 'T23:59:59.999Z');
    if (/^\d+$/.test(String(req.query.before || ''))) q = q.lt('id', Number(req.query.before));

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    let events = data || [];
    if (!(await can(req, companyId, 'hr.employees.manage'))) events = events.map(redactEvent);
    // Payroll rows in the HR log are payroll data: someone holding the change
    // log but not payroll sees that a payroll row changed, not the amounts.
    if (moduleKey === 'hr' && !(await canAny(req, companyId, ['hr.payroll.view', 'hr.payroll.manage']))) {
      events = events.map(e => (e.table_name.startsWith('hr_payroll') || e.table_name === 'hr_pay_periods')
        ? { ...e, changes: { hidden: 'Payroll details need payroll access' } } : e);
    }
    events = await withLabels(await withActors(events));

    res.json({
      events,
      ref_names: await refNames(events),
      next_before: events.length === limit ? events[events.length - 1].id : null,
    });
  }));

  // People who have changed anything in this company's module -- feeds the
  // "changed by" picker without exposing the whole user table.
  router.get('/actors', asyncHandler(async (req, res) => {
    const companyId = await readCompanyId(req);
    if (!companyId) return res.json({ actors: [] });
    if (!(await can(req, companyId, moduleKey + '.history.view'))) return res.status(403).json({ error: 'Forbidden' });
    const { data } = await supabaseAdmin
      .from('module_audit_log').select('changed_by')
      .eq('company_id', companyId).in('module', logModules)
      .not('changed_by', 'is', null).order('id', { ascending: false }).limit(2000);
    const ids = [...new Set((data || []).map(r => r.changed_by))];
    const named = await withActors(ids.map(id => ({ changed_by: id })));
    res.json({ actors: named.map(a => ({ id: a.changed_by, name: a.actor_name })).sort((a, b) => a.name.localeCompare(b.name)) });
  }));

  return router;
}

module.exports = { historyRouter, TABLES };
