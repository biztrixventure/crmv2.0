// ============================================================================
// HR -> Payroll. Run list, run detail, and the personal payslip view.
//
// PAYROLL IS MANUAL ENTRY IN THIS PHASE. There is no tax engine behind any of
// this: every gross component and every deduction is typed in by an operator.
// The UI says so where it matters rather than implying a calculation happened.
//
// Nothing on this page computes money either. gross_amount and net_amount are
// generated columns, and the run totals are trigger-fed (mig 288) -- each edit
// re-reads the run rather than adjusting a local number, so what you see is
// always what the database will pay.
//
// The employee view (My payslips) shows FINALIZED runs only, and asks for them
// with no employee id at all: the server resolves the caller own record. A
// draft run is a spreadsheet in progress, not a payslip.
// ============================================================================
import { useState, useEffect, useCallback } from 'react';
import {
  Banknote, Plus, ArrowLeft, CheckCircle2, Ban, Trash2, Users, User, CalendarRange,
} from 'lucide-react';
import { Panel, SectionHeader, Loading, EmptyState, Field, KpiTile, TableScroll, PillTabs } from '../../components/UI/kit';
import { Alert } from '../../components/UI';
import ThemedSelect from '../../components/UI/Select';
import { Btn, StatusPill, ModuleModal } from '../../components/Modules/ModuleUI';
import { usePayroll } from '../../hooks/usePayroll';
import { useEmployees } from '../../hooks/useEmployees';
import { fmtMoney, fmtMoneyShort, fmtDate, todayISO } from '../../utils/money';

const fullName = (e) => [e?.first_name, e?.last_name].filter(Boolean).join(' ') || 'Unnamed';

export default function PayrollPage({ scope }) {
  const companyId = scope?.company_id || null;
  const canView = !!scope?.permissions?.['hr.payroll.view'] || !!scope?.permissions?.['hr.payroll.manage'];
  const canViewOwn = !!scope?.permissions?.['hr.payroll.view_own'];

  const [tab, setTab] = useState(canView ? 'runs' : 'mine');
  const [openRun, setOpenRun] = useState(null);

  const tabs = [];
  if (canView) tabs.push({ key: 'runs', label: 'Payroll runs', icon: Users });
  if (canViewOwn) tabs.push({ key: 'mine', label: 'My payslips', icon: User });

  if (tabs.length === 0) {
    return <EmptyState icon={Banknote} title="No payroll access" hint="Your role does not include payroll." />;
  }

  return (
    <div className="space-y-4">
      <SectionHeader level="page" icon={Banknote} title="Payroll"
        subtitle={scope?.company_name || undefined} />
      {tabs.length > 1 && !openRun && <PillTabs items={tabs} value={tab} onChange={setTab} />}

      {tab === 'runs' && canView && (
        openRun
          ? <RunDetail companyId={companyId} runId={openRun} onBack={() => setOpenRun(null)} scope={scope} />
          : <RunList companyId={companyId} scope={scope} onOpen={setOpenRun} />
      )}
      {tab === 'mine' && canViewOwn && <MyPayslips companyId={companyId} />}
    </div>
  );
}

// -- Run list ---------------------------------------------------------------------

function RunList({ companyId, scope, onOpen }) {
  const canManage = !!scope?.permissions?.['hr.payroll.manage'];
  const { runs, periods, loading, error, fetchRuns, fetchPeriods, createPeriod, createRun } = usePayroll(companyId);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => { fetchRuns(); fetchPeriods(); }, [fetchRuns, fetchPeriods]);

  const totals = runs.reduce((a, r) => {
    if (r.status === 'finalized') { a.paid += Number(r.net_total || 0); a.finalized += 1; }
    if (['draft', 'processing'].includes(r.status)) a.open += 1;
    return a;
  }, { paid: 0, finalized: 0, open: 0 });

  return (
    <div className="space-y-4">
      {error && <Alert type="error">{error}</Alert>}
      {notice && <Alert type={notice.type} onDismiss={() => setNotice(null)}>{notice.text}</Alert>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label="Runs" value={runs.length} tone="info" />
        <KpiTile label="Open runs" value={totals.open} tone={totals.open ? 'warning' : 'muted'} />
        <KpiTile label="Finalized" value={totals.finalized} tone="success" />
        <KpiTile label="Net paid (finalized)" value={fmtMoneyShort(totals.paid)} tone="primary" />
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[11px] m-0" style={{ color: 'var(--color-text-tertiary)' }}>
          Payroll is manual entry in this phase -- amounts and deductions are typed in, not calculated.
        </p>
        {canManage && <Btn variant="primary" icon={Plus} onClick={() => setCreating(true)}>New payroll run</Btn>}
      </div>

      {loading && runs.length === 0 ? <Loading variant="table" rows={5} label="Loading payroll runs" /> : (
        runs.length === 0 ? (
          <EmptyState icon={Banknote} title="No payroll runs yet"
            hint="Create a pay period, then a run against it. You can prefill every active employee at their base salary and edit from there."
            action={canManage ? <Btn variant="primary" icon={Plus} onClick={() => setCreating(true)}>New payroll run</Btn> : null} />
        ) : (
          <Panel pad="none">
            <TableScroll stickyFirst>
              <table className="w-full">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    {['Run', 'Period', 'Gross', 'Deductions', 'Net', 'Status', ''].map((h, i) => (
                      <th key={h + i} className={`td-p text-[11px] font-bold uppercase tracking-wider ${i >= 2 && i <= 4 ? 'text-right' : 'text-left'}`}
                        style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {runs.map(r => (
                    <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td className="td-p">
                        <button onClick={() => onOpen(r.id)} className="text-sm font-semibold text-left"
                          style={{ color: 'var(--color-primary-600)' }}>{r.name}</button>
                      </td>
                      <td className="td-p text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                        {r.hr_pay_periods ? `${fmtDate(r.hr_pay_periods.start_date)} to ${fmtDate(r.hr_pay_periods.end_date)}` : '--'}
                      </td>
                      <td className="td-p text-sm text-right tabular-nums" style={{ color: 'var(--color-text)' }}>{fmtMoney(r.gross_total, r.currency)}</td>
                      <td className="td-p text-sm text-right tabular-nums" style={{ color: 'var(--color-warning-600)' }}>{fmtMoney(r.deduction_total, r.currency)}</td>
                      <td className="td-p text-sm text-right tabular-nums font-semibold" style={{ color: 'var(--color-text)' }}>{fmtMoney(r.net_total, r.currency)}</td>
                      <td className="td-p"><StatusPill status={r.status} /></td>
                      <td className="td-p text-right"><Btn size="sm" onClick={() => onOpen(r.id)}>Open</Btn></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </Panel>
        )
      )}

      {creating && (
        <NewRunDialog periods={periods} onClose={() => setCreating(false)}
          onCreatePeriod={createPeriod}
          onSubmit={async (payload) => {
            setNotice(null);
            try {
              const run = await createRun(payload);
              setCreating(false);
              setNotice({ type: 'success', text: 'Payroll run created.' });
              if (run) onOpen(run.id);
            } catch (e) {
              setNotice({ type: 'error', text: e.response?.data?.error || 'Could not create the run.' });
            }
          }} />
      )}
    </div>
  );
}

function NewRunDialog({ periods, onClose, onSubmit, onCreatePeriod }) {
  const [periodId, setPeriodId] = useState('');
  const [name, setName] = useState('');
  const [prefill, setPrefill] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newPeriod, setNewPeriod] = useState({ start_date: '', end_date: '', pay_date: '' });
  const [makingPeriod, setMakingPeriod] = useState(periods.length === 0);

  const createThenSelect = async () => {
    setSaving(true);
    try {
      const p = await onCreatePeriod(newPeriod);
      setPeriodId(p.id);
      setMakingPeriod(false);
    } finally { setSaving(false); }
  };

  return (
    <ModuleModal title="New payroll run" onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" busy={saving} disabled={!periodId}
            onClick={async () => { setSaving(true); await onSubmit({ pay_period_id: periodId, name: name || undefined, prefill }); setSaving(false); }}>
            Create run
          </Btn>
        </>
      }>
      <div className="space-y-3">
        {makingPeriod ? (
          <>
            <p className="text-xs m-0" style={{ color: 'var(--color-text-secondary)' }}>
              A run belongs to a pay period. Create one first.
            </p>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Start" required><input className="input w-full" type="date" value={newPeriod.start_date}
                onChange={e => setNewPeriod(p => ({ ...p, start_date: e.target.value }))} /></Field>
              <Field label="End" required><input className="input w-full" type="date" value={newPeriod.end_date}
                onChange={e => setNewPeriod(p => ({ ...p, end_date: e.target.value }))} /></Field>
              <Field label="Pay date"><input className="input w-full" type="date" value={newPeriod.pay_date}
                onChange={e => setNewPeriod(p => ({ ...p, pay_date: e.target.value }))} /></Field>
            </div>
            <div className="flex gap-2">
              <Btn variant="primary" icon={CalendarRange} busy={saving}
                disabled={!newPeriod.start_date || !newPeriod.end_date} onClick={createThenSelect}>
                Create pay period
              </Btn>
              {periods.length > 0 && <Btn onClick={() => setMakingPeriod(false)}>Use an existing one</Btn>}
            </div>
          </>
        ) : (
          <>
            <Field label="Pay period" required>
              <ThemedSelect value={periodId} onChange={e => setPeriodId(e.target.value)}>
                <option value="">Pick a period</option>
                {periods.map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({fmtDate(p.start_date)} to {fmtDate(p.end_date)})</option>
                ))}
              </ThemedSelect>
            </Field>
            <Btn size="sm" icon={Plus} onClick={() => setMakingPeriod(true)}>New pay period</Btn>
          </>
        )}

        <Field label="Run name" hint="Left blank, it is named after the period.">
          <input className="input w-full" value={name} onChange={e => setName(e.target.value)} />
        </Field>
        <label className="flex items-start gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
          <input type="checkbox" checked={prefill} onChange={e => setPrefill(e.target.checked)}
            style={{ accentColor: 'var(--color-primary-600)', width: 15, height: 15, marginTop: 2 }} />
          <span>
            Prefill every active employee at their base salary
            <span className="block text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
              A starting point only -- nothing is prorated, and you edit every line before finalizing.
            </span>
          </span>
        </label>
      </div>
    </ModuleModal>
  );
}

// -- Run detail --------------------------------------------------------------------

function RunDetail({ companyId, runId, onBack, scope }) {
  const canManage = !!scope?.permissions?.['hr.payroll.manage'];
  const { fetchRun, saveEntry, updateEntry, deleteEntry, addDeduction, deleteDeduction, finalizeRun, voidRun } =
    usePayroll(companyId);
  const { employees, fetchEmployees } = useEmployees(companyId);

  const [data, setData] = useState(null);
  const [notice, setNotice] = useState(null);
  const [adding, setAdding] = useState(false);
  const [deducting, setDeducting] = useState(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => { setData(await fetchRun(runId)); }, [fetchRun, runId]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { if (canManage) fetchEmployees({ status: 'active' }); }, [canManage, fetchEmployees]);

  const guard = async (fn, ok) => {
    setBusy(true);
    setNotice(null);
    try {
      const r = await fn();
      await reload();
      setNotice({ type: r?.journal_note ? 'warning' : 'success', text: r?.journal_note || ok });
    } catch (e) {
      setNotice({ type: 'error', text: e.response?.data?.error || 'That did not work.' });
    } finally { setBusy(false); }
  };

  if (!data) return <Loading variant="table" rows={6} label="Loading the payroll run" />;

  const { run, entries } = data;
  const editable = canManage && ['draft', 'processing'].includes(run.status);
  const inRun = new Set(entries.map(e => e.employee_id));

  return (
    <div className="space-y-4">
      <SectionHeader title={run.name}
        subtitle={run.hr_pay_periods ? `${fmtDate(run.hr_pay_periods.start_date)} to ${fmtDate(run.hr_pay_periods.end_date)}` : undefined}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Btn icon={ArrowLeft} onClick={onBack}>Back</Btn>
            {editable && <Btn icon={Plus} onClick={() => setAdding(true)}>Add employee</Btn>}
            {editable && (
              <Btn variant="primary" icon={CheckCircle2} busy={busy} disabled={entries.length === 0}
                onClick={() => {
                  if (window.confirm(`Finalize ${run.name}? Entries and deductions become read-only, and a journal entry is posted.`)) {
                    guard(() => finalizeRun(run.id), 'Payroll run finalized.');
                  }
                }}>Finalize</Btn>
            )}
            {canManage && run.status !== 'void' && (
              <Btn icon={Ban} onClick={() => {
                const reason = window.prompt('Why is this run being voided?');
                if (reason) guard(() => voidRun(run.id, reason), 'Run voided.');
              }}>Void</Btn>
            )}
          </div>
        } />

      {notice && <Alert type={notice.type} onDismiss={() => setNotice(null)}>{notice.text}</Alert>}
      {run.status === 'finalized' && (
        <Alert type="success" dismissible={false}>
          Finalized {fmtDate(run.finalized_at)}. Entries are locked.
          {run.journal_entry_id ? ' A journal entry was posted to the ledger.' : ' No journal entry was posted.'}
        </Alert>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label="Employees" value={entries.length} tone="info" />
        <KpiTile label="Gross" value={fmtMoney(run.gross_total, run.currency)} tone="primary" />
        <KpiTile label="Deductions" value={fmtMoney(run.deduction_total, run.currency)} tone="warning" />
        <KpiTile label="Net pay" value={fmtMoney(run.net_total, run.currency)} tone="success" />
      </div>

      {entries.length === 0 ? (
        <EmptyState icon={Users} title="No one on this run yet"
          hint="Add the employees this run pays."
          action={editable ? <Btn variant="primary" icon={Plus} onClick={() => setAdding(true)}>Add employee</Btn> : null} />
      ) : (
        <Panel pad="none">
          <TableScroll stickyFirst>
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  {['Employee', 'Base', 'Overtime', 'Bonus', 'Commission', 'Allowance', 'Gross', 'Deductions', 'Net', ''].map((h, i) => (
                    <th key={h + i} className={`td-p text-[11px] font-bold uppercase tracking-wider ${i > 0 && i < 9 ? 'text-right' : 'text-left'}`}
                      style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <EntryRow key={e.id} entry={e} currency={run.currency} editable={editable}
                    onPatch={(patch) => guard(() => updateEntry(e.id, patch), 'Entry updated.')}
                    onDelete={() => guard(() => deleteEntry(e.id), 'Entry removed.')}
                    onDeduct={() => setDeducting(e)}
                    onRemoveDeduction={(id) => guard(() => deleteDeduction(id), 'Deduction removed.')} />
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Panel>
      )}

      {adding && (
        <ModuleModal title="Add an employee to this run" onClose={() => setAdding(false)}
          footer={<Btn onClick={() => setAdding(false)}>Done</Btn>}>
          <div className="space-y-1 max-h-96 overflow-auto">
            {employees.filter(emp => !inRun.has(emp.id)).map(emp => (
              <div key={emp.id} className="flex items-center justify-between py-1.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
                <span className="text-sm" style={{ color: 'var(--color-text)' }}>
                  {fullName(emp)}
                  {emp.base_salary != null && (
                    <span className="ml-2 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                      base {fmtMoney(emp.base_salary, emp.currency)}
                    </span>
                  )}
                </span>
                <Btn size="sm" variant="primary"
                  onClick={() => guard(() => saveEntry(run.id, { employee_id: emp.id, base_amount: emp.base_salary || 0 }), 'Employee added.')}>
                  Add
                </Btn>
              </div>
            ))}
            {employees.filter(emp => !inRun.has(emp.id)).length === 0 && (
              <EmptyState compact icon={Users} title="Everyone active is already on this run" />
            )}
          </div>
        </ModuleModal>
      )}

      {deducting && (
        <DeductionDialog entry={deducting} currency={run.currency} onClose={() => setDeducting(null)}
          onSubmit={async (payload) => {
            await guard(() => addDeduction(deducting.id, payload), 'Deduction added.');
            setDeducting(null);
          }} />
      )}
    </div>
  );
}

function EntryRow({ entry, currency, editable, onPatch, onDelete, onDeduct, onRemoveDeduction }) {
  const [local, setLocal] = useState({});
  const field = (k) => local[k] ?? entry[k] ?? 0;
  const commit = (k) => {
    if (local[k] === undefined) return;
    if (Number(local[k]) === Number(entry[k])) { setLocal(l => ({ ...l, [k]: undefined })); return; }
    onPatch({ [k]: Number(local[k]) });
    setLocal(l => ({ ...l, [k]: undefined }));
  };

  const cell = (k) => (
    <td className="td-p text-right">
      {editable ? (
        <input className="input text-right tabular-nums" type="number" step="0.01" min="0" style={{ width: 96 }}
          value={field(k)} onChange={e => setLocal(l => ({ ...l, [k]: e.target.value }))}
          onBlur={() => commit(k)} />
      ) : (
        <span className="text-sm tabular-nums" style={{ color: 'var(--color-text)' }}>{fmtMoney(entry[k], currency)}</span>
      )}
    </td>
  );

  return (
    <>
      <tr style={{ borderBottom: (entry.hr_payroll_deductions || []).length ? 'none' : '1px solid var(--color-border)' }}>
        <td className="td-p text-sm" style={{ color: 'var(--color-text)' }}>{fullName(entry.hr_employees)}</td>
        {cell('base_amount')}
        {cell('overtime_amount')}
        {cell('bonus_amount')}
        {cell('commission_amount')}
        {cell('allowance_amount')}
        <td className="td-p text-sm text-right tabular-nums font-semibold" style={{ color: 'var(--color-text)' }}>
          {fmtMoney(entry.gross_amount, currency)}
        </td>
        <td className="td-p text-sm text-right tabular-nums" style={{ color: 'var(--color-warning-600)' }}>
          {fmtMoney(entry.deduction_total, currency)}
        </td>
        <td className="td-p text-sm text-right tabular-nums font-bold" style={{ color: 'var(--color-success-600)' }}>
          {fmtMoney(entry.net_amount, currency)}
        </td>
        <td className="td-p">
          {editable && (
            <div className="flex items-center gap-1.5 justify-end">
              <Btn size="sm" onClick={onDeduct}>Deduct</Btn>
              <Btn size="sm" variant="danger" icon={Trash2} onClick={onDelete}><span className="sr-only">Remove</span></Btn>
            </div>
          )}
        </td>
      </tr>
      {(entry.hr_payroll_deductions || []).length > 0 && (
        <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
          <td colSpan={10} className="td-p" style={{ paddingTop: 0 }}>
            <div className="flex flex-wrap gap-1.5">
              {entry.hr_payroll_deductions.map(d => (
                <span key={d.id} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px]"
                  style={{ background: 'var(--color-bg)', color: 'var(--color-text-secondary)' }}>
                  {d.label} {fmtMoney(d.amount, currency)}
                  {d.is_employer_cost && <span style={{ color: 'var(--color-text-tertiary)' }}>(employer)</span>}
                  {editable && (
                    <button onClick={() => onRemoveDeduction(d.id)} aria-label={`Remove ${d.label}`}
                      style={{ color: 'var(--color-error-600)' }}>x</button>
                  )}
                </span>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function DeductionDialog({ entry, currency, onClose, onSubmit }) {
  const [form, setForm] = useState({ kind: 'tax', label: '', amount: '', is_employer_cost: false, note: '' });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <ModuleModal title={`Deduction for ${fullName(entry.hr_employees)}`}
      subtitle={`Gross ${fmtMoney(entry.gross_amount, currency)}`} onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" busy={saving} disabled={!form.label.trim() || form.amount === ''}
            onClick={async () => { setSaving(true); await onSubmit({ ...form, amount: Number(form.amount) }); setSaving(false); }}>
            Add deduction
          </Btn>
        </>
      }>
      <div className="space-y-3">
        {/* TODO(tax): a statutory engine would compute tax/social/pension from
            jurisdiction + YTD gross instead of asking for a number here. */}
        <p className="text-[11px] m-0" style={{ color: 'var(--color-text-tertiary)' }}>
          Amounts are entered by hand in this phase -- nothing here is calculated from a tax table.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kind">
            <ThemedSelect value={form.kind} onChange={e => set('kind', e.target.value)}>
              {['tax', 'social', 'insurance', 'pension', 'loan', 'advance', 'garnishment', 'other'].map(k => (
                <option key={k} value={k}>{k}</option>
              ))}
            </ThemedSelect>
          </Field>
          <Field label="Amount" required>
            <input className="input w-full" type="number" step="0.01" min="0" value={form.amount}
              onChange={e => set('amount', e.target.value)} />
          </Field>
        </div>
        <Field label="Label" required hint="What appears on the payslip.">
          <input className="input w-full" value={form.label} onChange={e => set('label', e.target.value)} placeholder="Income tax" />
        </Field>
        <label className="flex items-start gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
          <input type="checkbox" checked={form.is_employer_cost} onChange={e => set('is_employer_cost', e.target.checked)}
            style={{ accentColor: 'var(--color-primary-600)', width: 15, height: 15, marginTop: 2 }} />
          <span>
            Employer cost
            <span className="block text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
              Reported on the run but not subtracted from take-home pay.
            </span>
          </span>
        </label>
      </div>
    </ModuleModal>
  );
}

// -- My payslips -------------------------------------------------------------------

function MyPayslips({ companyId }) {
  const { fetchMyPayslips, loading, error } = usePayroll(companyId);
  const [data, setData] = useState(null);
  useEffect(() => { fetchMyPayslips().then(setData); }, [fetchMyPayslips]);

  if (loading && !data) return <Loading variant="cards" label="Loading your payslips" />;
  if (error) return <Alert type="error">{error}</Alert>;
  if (!data?.employee) {
    return <EmptyState icon={User} title="No employee record"
      hint="You have no HR record in this company yet, so there are no payslips. Ask HR to create one and link it to your login." />;
  }
  if (!data.payslips?.length) {
    return <EmptyState icon={Banknote} title="No payslips yet"
      hint="Payslips appear here once a payroll run that includes you has been finalized." />;
  }

  return (
    <div className="space-y-3">
      {data.payslips.map(p => {
        const run = p.hr_payroll_runs;
        const period = run?.hr_pay_periods;
        const cur = run?.currency || 'USD';
        return (
          <Panel key={p.id}>
            <SectionHeader title={run?.name || 'Payslip'}
              subtitle={period ? `${fmtDate(period.start_date)} to ${fmtDate(period.end_date)}${period.pay_date ? ` -- paid ${fmtDate(period.pay_date)}` : ''}` : undefined}
              actions={<span className="text-lg font-bold tabular-nums" style={{ color: 'var(--color-success-600)' }}>
                {fmtMoney(p.net_amount, cur)}
              </span>} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider m-0 mb-1" style={{ color: 'var(--color-text-secondary)' }}>Earnings</p>
                <Line label="Base" value={fmtMoney(p.base_amount, cur)} />
                {Number(p.overtime_amount) > 0 && <Line label="Overtime" value={fmtMoney(p.overtime_amount, cur)} />}
                {Number(p.bonus_amount) > 0 && <Line label="Bonus" value={fmtMoney(p.bonus_amount, cur)} />}
                {Number(p.commission_amount) > 0 && <Line label="Commission" value={fmtMoney(p.commission_amount, cur)} />}
                {Number(p.allowance_amount) > 0 && <Line label="Allowances" value={fmtMoney(p.allowance_amount, cur)} />}
                <Line label="Gross" value={fmtMoney(p.gross_amount, cur)} strong />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider m-0 mb-1" style={{ color: 'var(--color-text-secondary)' }}>Deductions</p>
                {(p.hr_payroll_deductions || []).filter(d => !d.is_employer_cost).length === 0
                  ? <p className="text-xs m-0" style={{ color: 'var(--color-text-tertiary)' }}>None</p>
                  : p.hr_payroll_deductions.filter(d => !d.is_employer_cost).map(d => (
                    <Line key={d.id} label={d.label} value={fmtMoney(d.amount, cur)} />
                  ))}
                <Line label="Total deductions" value={fmtMoney(p.deduction_total, cur)} strong />
                <Line label="Net pay" value={fmtMoney(p.net_amount, cur)} strong />
              </div>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}

const Line = ({ label, value, strong }) => (
  <div className="flex items-center justify-between py-0.5">
    <span className={`text-xs ${strong ? 'font-bold' : ''}`} style={{ color: strong ? 'var(--color-text)' : 'var(--color-text-secondary)' }}>{label}</span>
    <span className={`text-xs tabular-nums ${strong ? 'font-bold' : ''}`} style={{ color: 'var(--color-text)' }}>{value}</span>
  </div>
);
