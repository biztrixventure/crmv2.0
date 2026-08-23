// ============================================================================
// /api/hr/payroll -- pay periods, runs, entries, deductions (mig 288).
//
// MANUAL ENTRY BY DESIGN in this phase. There is no tax engine behind this and
// none is implied: gross components and every deduction are typed in by a
// payroll operator. Search this file for TODO(tax) to see exactly where a real
// statutory calculator would attach.
//
// The arithmetic is not here either -- gross_amount and net_amount are GENERATED
// columns, entry.deduction_total and the run totals are trigger-fed (mig 288).
// This file owns the two things the database cannot: who may look, and what
// finalizing means.
//
// hr.payroll.view_own is the self-service door. It resolves the caller employee
// record from (company_id, user_id) and filters to it -- an employee_id in the
// query is ignored for that path, so nobody reads a colleague payslip by
// guessing a uuid.
//
// Finalizing writes the ledger side: debit salary expense, credit payroll
// liabilities, one balanced journal_entries row with source_type = 'payroll'.
// Best-effort -- a company with no chart of accounts still gets to run payroll.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../../config/database');
const { asyncHandler } = require('../../middleware/errorHandler');
const logger = require('../../utils/logger');
const { can, deny, readCompanyId, writeCompanyId, selfEmployee } = require('../../utils/moduleAccess');
const { createPostedEntry, accountByCode, cents, money } = require('../../utils/ledger');

const router = express.Router();

const runFull = 'id, company_id, pay_period_id, name, status, currency, gross_total, deduction_total, '
  + 'net_total, finalized_at, finalized_by, voided_at, voided_by, journal_entry_id, note, created_by, '
  + 'created_at, updated_at, hr_pay_periods(id, name, start_date, end_date, pay_date, status)';

const entryFull = 'id, company_id, run_id, employee_id, base_amount, overtime_amount, bonus_amount, '
  + 'commission_amount, allowance_amount, gross_amount, deduction_total, net_amount, note, created_at, '
  + 'hr_employees(id, first_name, last_name, employee_no, department_id), '
  + 'hr_payroll_deductions(id, kind, label, amount, is_employer_cost, note)';

// -- Pay periods ---------------------------------------------------------------

router.get('/periods', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ periods: [] });
  if (await deny(req, res, companyId, 'hr.payroll.view')) return;

  const { data, error } = await supabaseAdmin
    .from('hr_pay_periods').select('id, name, start_date, end_date, pay_date, status')
    .eq('company_id', companyId).order('start_date', { ascending: false }).limit(60);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ periods: data || [], can_manage: await can(req, companyId, 'hr.payroll.manage') });
}));

router.post('/periods', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (!companyId) return res.status(400).json({ error: 'No company scope for this user' });
  if (await deny(req, res, companyId, 'hr.payroll.manage')) return;

  const b = req.body || {};
  if (!b.start_date || !b.end_date) return res.status(400).json({ error: 'start_date and end_date are required' });
  if (b.end_date < b.start_date)    return res.status(400).json({ error: 'end_date cannot be before start_date' });

  const { data, error } = await supabaseAdmin.from('hr_pay_periods').insert({
    company_id: companyId,
    name: b.name || (b.start_date + ' to ' + b.end_date),
    start_date: b.start_date,
    end_date: b.end_date,
    pay_date: b.pay_date || null,
    created_by: req.user.id,
  }).select().single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'A pay period with those dates already exists' });
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json({ period: data });
}));

router.put('/periods/:id', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'hr.payroll.manage')) return;

  const patch = { updated_at: new Date().toISOString() };
  for (const f of ['name', 'start_date', 'end_date', 'pay_date', 'status']) {
    if (req.body?.[f] !== undefined) patch[f] = req.body[f];
  }
  const { data, error } = await supabaseAdmin.from('hr_pay_periods')
    .update(patch).eq('id', req.params.id).eq('company_id', companyId).select().maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Pay period not found' });
  res.json({ period: data });
}));

// -- My payslips ---------------------------------------------------------------
// The hr.payroll.view_own door. Finalized runs only: a draft run is a
// work-in-progress spreadsheet, and showing it to the employee as a payslip is
// how you get asked why your pay changed twice before payday.
router.get('/my-payslips', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ payslips: [] });
  if (await deny(req, res, companyId, 'hr.payroll.view_own')) return;

  const employee = await selfEmployee(companyId, req.user.id);
  if (!employee) return res.json({ payslips: [], employee: null });

  const { data, error } = await supabaseAdmin
    .from('hr_payroll_entries')
    .select(entryFull + ', hr_payroll_runs!inner(id, name, status, finalized_at, currency, pay_period_id, hr_pay_periods(name, start_date, end_date, pay_date))')
    .eq('company_id', companyId)
    .eq('employee_id', employee.id)                 // resolved server-side, never from the query
    .eq('hr_payroll_runs.status', 'finalized')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  res.json({ payslips: data || [], employee });
}));

// -- Runs -----------------------------------------------------------------------

router.get('/runs', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ runs: [] });
  if (await deny(req, res, companyId, 'hr.payroll.view')) return;

  let q = supabaseAdmin.from('hr_payroll_runs').select(runFull)
    .eq('company_id', companyId).order('created_at', { ascending: false })
    .limit(Math.min(200, Math.max(1, Number(req.query.limit) || 50)));
  if (req.query.status)        q = q.eq('status', req.query.status);
  if (req.query.pay_period_id) q = q.eq('pay_period_id', req.query.pay_period_id);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ runs: data || [], can_manage: await can(req, companyId, 'hr.payroll.manage') });
}));

router.get('/runs/:id', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (await deny(req, res, companyId, 'hr.payroll.view')) return;

  const { data: run, error } = await supabaseAdmin
    .from('hr_payroll_runs').select(runFull).eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!run) return res.status(404).json({ error: 'Payroll run not found' });

  const { data: entries } = await supabaseAdmin
    .from('hr_payroll_entries').select(entryFull).eq('run_id', run.id).order('created_at');

  res.json({ run, entries: entries || [], can_manage: await can(req, companyId, 'hr.payroll.manage') });
}));

router.post('/runs', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (!companyId) return res.status(400).json({ error: 'No company scope for this user' });
  if (await deny(req, res, companyId, 'hr.payroll.manage')) return;

  const b = req.body || {};
  if (!b.pay_period_id) return res.status(400).json({ error: 'pay_period_id is required' });

  const { data: period } = await supabaseAdmin
    .from('hr_pay_periods').select('id, name').eq('id', b.pay_period_id).eq('company_id', companyId).maybeSingle();
  if (!period) return res.status(404).json({ error: 'Pay period not found in this company' });

  const { data: run, error } = await supabaseAdmin.from('hr_payroll_runs').insert({
    company_id: companyId,
    pay_period_id: period.id,
    name: b.name || ('Payroll -- ' + period.name),
    currency: b.currency || 'USD',
    note: b.note || null,
    created_by: req.user.id,
  }).select(runFull).single();
  if (error) return res.status(500).json({ error: error.message });

  // prefill:true seeds one entry per active employee at their base salary. This
  // is the only place base_salary is read automatically, and it is a STARTING
  // POINT -- the operator edits every line before finalizing.
  // TODO(tax): a real payroll engine would also prorate by hire/termination date
  // and by attendance here, instead of taking the full period salary flat.
  if (b.prefill === true) {
    const { data: emps } = await supabaseAdmin
      .from('hr_employees').select('id, base_salary')
      .eq('company_id', companyId).eq('status', 'active');
    const rows = (emps || []).map(e => ({
      company_id: companyId, run_id: run.id, employee_id: e.id,
      base_amount: Number(e.base_salary || 0),
    }));
    if (rows.length) {
      const { error: seedErr } = await supabaseAdmin.from('hr_payroll_entries').insert(rows);
      if (seedErr) logger.warn('HR', 'payroll prefill failed for run ' + run.id + ': ' + seedErr.message);
    }
  }

  const { data: fresh } = await supabaseAdmin.from('hr_payroll_runs').select(runFull).eq('id', run.id).single();
  res.status(201).json({ run: fresh });
}));

router.put('/runs/:id', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'hr.payroll.manage')) return;

  const { data: run } = await supabaseAdmin
    .from('hr_payroll_runs').select('id, status').eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!run) return res.status(404).json({ error: 'Payroll run not found' });
  if (['finalized', 'void'].includes(run.status)) return res.status(409).json({ error: 'A ' + run.status + ' run can no longer be edited' });

  const patch = { updated_at: new Date().toISOString() };
  for (const f of ['name', 'note', 'currency']) if (req.body?.[f] !== undefined) patch[f] = req.body[f];
  if (req.body?.status === 'processing' || req.body?.status === 'draft') patch.status = req.body.status;

  const { data, error } = await supabaseAdmin.from('hr_payroll_runs').update(patch).eq('id', run.id).select(runFull).single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ run: data });
}));

// -- Entries ---------------------------------------------------------------------

router.post('/runs/:id/entries', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'hr.payroll.manage')) return;

  const { data: run } = await supabaseAdmin
    .from('hr_payroll_runs').select('id, status').eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!run) return res.status(404).json({ error: 'Payroll run not found' });
  if (run.status !== 'draft' && run.status !== 'processing') {
    return res.status(409).json({ error: 'A ' + run.status + ' run cannot take new entries' });
  }

  const b = req.body || {};
  if (!b.employee_id) return res.status(400).json({ error: 'employee_id is required' });
  const { data: emp } = await supabaseAdmin
    .from('hr_employees').select('id').eq('id', b.employee_id).eq('company_id', companyId).maybeSingle();
  if (!emp) return res.status(404).json({ error: 'Employee not found in this company' });

  const { data, error } = await supabaseAdmin.from('hr_payroll_entries').upsert({
    company_id: companyId,
    run_id: run.id,
    employee_id: b.employee_id,
    base_amount:       Number(b.base_amount ?? 0),
    overtime_amount:   Number(b.overtime_amount ?? 0),
    bonus_amount:      Number(b.bonus_amount ?? 0),
    commission_amount: Number(b.commission_amount ?? 0),
    allowance_amount:  Number(b.allowance_amount ?? 0),
    note: b.note || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'run_id,employee_id' }).select(entryFull).single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ entry: data });
}));

router.put('/entries/:entryId', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'hr.payroll.manage')) return;

  const { data: entry } = await supabaseAdmin
    .from('hr_payroll_entries').select('id, run_id').eq('id', req.params.entryId).eq('company_id', companyId).maybeSingle();
  if (!entry) return res.status(404).json({ error: 'Payroll entry not found' });

  const patch = { updated_at: new Date().toISOString() };
  for (const f of ['base_amount', 'overtime_amount', 'bonus_amount', 'commission_amount', 'allowance_amount']) {
    if (req.body?.[f] !== undefined) {
      const v = Number(req.body[f]);
      if (!(v >= 0)) return res.status(400).json({ error: f + ' cannot be negative' });
      patch[f] = v;
    }
  }
  if (req.body?.note !== undefined) patch.note = req.body.note;

  const { data, error } = await supabaseAdmin
    .from('hr_payroll_entries').update(patch).eq('id', entry.id).select(entryFull).single();
  // The mig 288 lock trigger raises when the run is finalized -- surface that as
  // a 409, not a 500.
  if (error) {
    if (/no longer be edited/.test(error.message || '')) return res.status(409).json({ error: error.message });
    return res.status(500).json({ error: error.message });
  }
  res.json({ entry: data });
}));

router.delete('/entries/:entryId', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'hr.payroll.manage')) return;

  const { error } = await supabaseAdmin
    .from('hr_payroll_entries').delete().eq('id', req.params.entryId).eq('company_id', companyId);
  if (error) {
    if (/no longer be edited/.test(error.message || '')) return res.status(409).json({ error: error.message });
    return res.status(500).json({ error: error.message });
  }
  res.json({ ok: true });
}));

// -- Deductions -------------------------------------------------------------------
// TODO(tax): every deduction here is typed in. A statutory engine would replace
// this endpoint for kind IN ('tax','social','pension') with computed values
// derived from the employee jurisdiction, YTD gross and filing status, and would
// need a per-jurisdiction rate table this phase deliberately does not have.
router.post('/entries/:entryId/deductions', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'hr.payroll.manage')) return;

  const { data: entry } = await supabaseAdmin
    .from('hr_payroll_entries').select('id, run_id, hr_payroll_runs(status)')
    .eq('id', req.params.entryId).eq('company_id', companyId).maybeSingle();
  if (!entry) return res.status(404).json({ error: 'Payroll entry not found' });
  const runStatus = entry.hr_payroll_runs?.status;
  if (['finalized', 'void'].includes(runStatus)) {
    return res.status(409).json({ error: 'Payroll run is ' + runStatus + ' and can no longer be edited' });
  }

  const b = req.body || {};
  if (!b.label) return res.status(400).json({ error: 'label is required' });
  const amount = Number(b.amount);
  if (!(amount >= 0)) return res.status(400).json({ error: 'amount cannot be negative' });

  const { data, error } = await supabaseAdmin.from('hr_payroll_deductions').insert({
    company_id: companyId,
    entry_id: entry.id,
    kind: b.kind || 'other',
    label: String(b.label).trim(),
    amount,
    is_employer_cost: !!b.is_employer_cost,
    note: b.note || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  const { data: fresh } = await supabaseAdmin.from('hr_payroll_entries').select(entryFull).eq('id', entry.id).single();
  res.status(201).json({ deduction: data, entry: fresh });
}));

router.delete('/deductions/:deductionId', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'hr.payroll.manage')) return;

  const { data: d } = await supabaseAdmin
    .from('hr_payroll_deductions').select('id, entry_id, hr_payroll_entries(run_id, hr_payroll_runs(status))')
    .eq('id', req.params.deductionId).eq('company_id', companyId).maybeSingle();
  if (!d) return res.status(404).json({ error: 'Deduction not found' });
  const runStatus = d.hr_payroll_entries?.hr_payroll_runs?.status;
  if (['finalized', 'void'].includes(runStatus)) {
    return res.status(409).json({ error: 'Payroll run is ' + runStatus + ' and can no longer be edited' });
  }

  const { error } = await supabaseAdmin.from('hr_payroll_deductions').delete().eq('id', d.id);
  if (error) return res.status(500).json({ error: error.message });

  const { data: fresh } = await supabaseAdmin.from('hr_payroll_entries').select(entryFull).eq('id', d.entry_id).single();
  res.json({ ok: true, entry: fresh });
}));

// -- Finalize ---------------------------------------------------------------------
// Closes the run and (optionally, best-effort) posts it to the ledger:
//
//   DR  5000 Salaries and Wages        gross
//   CR  2100 Payroll Liabilities       net
//   CR  2200 Taxes Payable             employee deductions
//
// Employer-side costs are reported on the run but deliberately NOT posted here:
// they are an expense the company owes on top of gross, and posting them into
// the same entry would make the salary expense line wrong.
// TODO(tax): employer contributions want their own expense/liability pair once
// there is a rate table to compute them from.
router.post('/runs/:id/finalize', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'hr.payroll.manage')) return;

  const { data: run } = await supabaseAdmin
    .from('hr_payroll_runs').select('id, name, status, gross_total, deduction_total, net_total, pay_period_id, hr_pay_periods(end_date, pay_date)')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!run) return res.status(404).json({ error: 'Payroll run not found' });
  if (run.status === 'finalized') return res.status(409).json({ error: 'This run is already finalized' });
  if (run.status === 'void')      return res.status(409).json({ error: 'A void run cannot be finalized' });

  const { count } = await supabaseAdmin
    .from('hr_payroll_entries').select('id', { count: 'exact', head: true }).eq('run_id', run.id);
  if (!count) return res.status(422).json({ error: 'This run has no entries' });
  if (Number(run.gross_total) <= 0) return res.status(422).json({ error: 'This run totals zero -- nothing to finalize' });

  const now = new Date().toISOString();
  const { data: finalized, error } = await supabaseAdmin.from('hr_payroll_runs').update({
    status: 'finalized', finalized_at: now, finalized_by: req.user.id, updated_at: now,
  }).eq('id', run.id).select(runFull).single();
  if (error) return res.status(500).json({ error: error.message });

  // Ledger side. post_journal:false opts out entirely.
  let journalNote = null;
  if (req.body?.post_journal !== false) {
    const [salary, liability, taxes] = await Promise.all([
      accountByCode(companyId, '5000'),
      accountByCode(companyId, '2100'),
      accountByCode(companyId, '2200'),
    ]);
    if (salary && liability) {
      const gross = Number(run.gross_total);
      const deducted = Number(run.deduction_total);
      const net = Number(run.net_total);

      const lines = [{ account_id: salary.id, debit: gross, credit: 0, description: 'Gross pay' }];
      lines.push({ account_id: liability.id, debit: 0, credit: net, description: 'Net pay owed' });
      if (cents(deducted) > 0) {
        // No taxes-payable account? The deductions still have to land somewhere
        // or the entry will not balance -- fold them into payroll liabilities
        // and say so, rather than posting a crooked entry.
        const target = taxes || liability;
        lines.push({ account_id: target.id, debit: 0, credit: deducted, description: 'Employee deductions' });
        if (!taxes) journalNote = 'Deductions were posted to Payroll Liabilities -- create account 2200 (Taxes Payable) to separate them.';
      }

      const posted = await createPostedEntry({
        companyId, userId: req.user.id,
        entryDate: run.hr_pay_periods?.pay_date || run.hr_pay_periods?.end_date || now.slice(0, 10),
        memo: run.name,
        sourceType: 'payroll', sourceId: run.id,
        lines,
      });
      if (posted.entry) {
        await supabaseAdmin.from('hr_payroll_runs').update({ journal_entry_id: posted.entry.id }).eq('id', run.id);
      } else {
        journalNote = 'Run finalized, but the journal entry failed: ' + posted.error;
        logger.warn('HR', 'payroll ' + run.id + ' journal failed: ' + posted.error);
      }
    } else {
      journalNote = 'Run finalized. No journal entry was written -- create accounts 5000 (Salaries and Wages) and 2100 (Payroll Liabilities) to post automatically.';
    }
  }

  const { data: fresh } = await supabaseAdmin.from('hr_payroll_runs').select(runFull).eq('id', run.id).single();
  logger.info('HR', 'payroll run ' + run.id + ' finalized by ' + req.user.id + ' (' + money(cents(run.net_total)) + ' net)');
  res.json({ run: fresh || finalized, journal_note: journalNote });
}));

// POST /api/hr/payroll/runs/:id/void { reason }
// The journal entry is NOT auto-reversed here: voiding a finalized run is rare
// and consequential, and silently writing a reversing entry hides that. The
// response names the entry so the operator voids it deliberately from the
// journal, which is where reversals belong.
router.post('/runs/:id/void', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'hr.payroll.manage')) return;

  const reason = (req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'A void reason is required' });

  const { data: run } = await supabaseAdmin
    .from('hr_payroll_runs').select('id, status, journal_entry_id')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!run) return res.status(404).json({ error: 'Payroll run not found' });
  if (run.status === 'void') return res.status(409).json({ error: 'This run is already void' });

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from('hr_payroll_runs').update({
    status: 'void', voided_at: now, voided_by: req.user.id,
    note: reason, updated_at: now,
  }).eq('id', run.id).select(runFull).single();
  if (error) return res.status(500).json({ error: error.message });

  res.json({
    run: data,
    journal_entry_id: run.journal_entry_id,
    journal_note: run.journal_entry_id
      ? 'This run had a posted journal entry. Void it from the journal to reverse the ledger.'
      : null,
  });
}));

module.exports = router;
