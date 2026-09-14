// ============================================================================
// RecordHistory -- "what happened to this record, who did it, and why".
//
// Reads the append-only change record (mig 313) through
//   GET /{hr|accounting}/history/record/:table/:id
// and renders it as a timeline in plain words:
//
//   Ayesha Khan changed Salary  60,000 -> 65,000      14 Sep, 10:32
//     "Annual raise approved by Ali"
//
// Pieces:
//   <HistoryButton module table id companyId />   the button every record gets
//   <HistoryModal .../>                            the timeline in a modal
//   <HistoryEvent event refNames />                one entry (also used by the
//                                                  module Change log page)
//
// Nothing here edits anything: history is append-only on the server too.
// ============================================================================
import { useEffect, useState } from 'react';
import { History, ChevronDown, ChevronRight, PlusCircle, PencilLine, Trash2, Flag } from 'lucide-react';
import client from '../../api/client';
import { Loading, EmptyState } from '../UI/kit';
import { Btn, ModuleModal } from './ModuleUI';

// -- Words -------------------------------------------------------------------
export const TABLE_LABEL = {
  hr_employees: 'Employee', hr_departments: 'Department', hr_positions: 'Position',
  hr_attendance: 'Attendance', hr_leave_types: 'Leave type', hr_leave_balances: 'Leave balance',
  hr_leave_requests: 'Leave request', hr_pay_periods: 'Pay period', hr_payroll_runs: 'Payroll run',
  hr_payroll_entries: 'Pay line', hr_payroll_deductions: 'Deduction', hr_review_cycles: 'Review cycle',
  hr_reviews: 'Review', hr_review_goals: 'Review goal', hr_review_ratings: 'Review rating',
  user_company_roles: 'CRM login & role', hr_settings: 'HR settings', hr_exit_cases: 'Exit',
  chart_of_accounts: 'Account', journal_entries: 'Journal entry', journal_entry_lines: 'Entry line',
  invoices: 'Invoice', invoice_line_items: 'Invoice line', invoice_payments: 'Payment',
  expense_categories: 'Expense category', expenses: 'Expense claim',
  accounting_posting_rules: 'Money rule', fx_rates: 'Exchange rate',
  revenue_settings: 'Sales into the books', revenue_rates: 'Sale rate', hr_holidays: 'Holiday',
  hr_commission_plans: 'Commission plan',
  module_designations: 'Designation', module_designation_companies: 'Designation company',
};

const FIELD_LABEL = {
  first_name: 'First name', last_name: 'Last name', employee_no: 'Employee no.', user_id: 'CRM login',
  work_email: 'Work email', personal_email: 'Personal email', phone: 'Phone', date_of_birth: 'Date of birth',
  address: 'Address', emergency_contact: 'Emergency contact', department_id: 'Department',
  position_id: 'Position', manager_employee_id: 'Manager', head_employee_id: 'Department head',
  hire_date: 'Start date', termination_date: 'Last day', employment_type: 'Employment type',
  status: 'Status', base_salary: 'Salary', pay_frequency: 'Pay frequency', currency: 'Currency',
  notes: 'Notes', note: 'Note', role_id: 'Role', is_active: 'Active', assigned_by: 'Assigned by',
  work_date: 'Day', check_in: 'Checked in', check_out: 'Checked out', hours_worked: 'Hours worked',
  recorded_by: 'Recorded by', leave_type_id: 'Leave type', start_date: 'From', end_date: 'To',
  days: 'Days', reason: 'Reason', decided_by: 'Decided by', decided_at: 'Decided on',
  decision_note: 'Decision note', requested_by: 'Requested by', entitled_days: 'Days allowed',
  used_days: 'Days used', default_days: 'Default days', is_paid: 'Paid leave',
  requires_approval: 'Needs approval', pay_period_id: 'Pay period', pay_date: 'Pay day',
  base_amount: 'Base pay', overtime_amount: 'Overtime', bonus_amount: 'Bonus',
  commission_amount: 'Commission', allowance_amount: 'Allowance', gross_amount: 'Gross pay',
  deduction_total: 'Deductions', net_amount: 'Take-home pay', gross_total: 'Total gross',
  net_total: 'Total take-home', finalized_at: 'Finalized on', finalized_by: 'Finalized by',
  voided_at: 'Voided on', voided_by: 'Voided by', journal_entry_id: 'Journal entry',
  kind: 'Type', label: 'Label', amount: 'Amount', is_employer_cost: 'Paid by the company',
  code: 'Code', name: 'Name', title: 'Title', description: 'Description',
  account_type: 'Type', account_subtype: 'Subtype', parent_id: 'Parent account', is_system: 'Built-in',
  entry_no: 'Entry no.', entry_date: 'Date', memo: 'Memo', source_type: 'Came from',
  posted_at: 'Posted on', posted_by: 'Posted by', void_reason: 'Void reason',
  debit: 'Debit (in)', credit: 'Credit (out)', account_id: 'Account',
  invoice_no: 'Invoice no.', customer_name: 'Customer', customer_email: 'Customer email',
  customer_phone: 'Customer phone', issue_date: 'Issued', due_date: 'Due', subtotal: 'Subtotal',
  tax_total: 'Tax', discount_total: 'Discount', total: 'Total', amount_paid: 'Paid so far',
  balance_due: 'Still owed', terms: 'Terms', quantity: 'Qty', unit_price: 'Unit price',
  tax_rate: 'Tax %', discount: 'Discount', paid_at: 'Paid on', method: 'Method', reference: 'Reference',
  expense_date: 'Date', vendor: 'Paid to', category_id: 'Category', receipt_url: 'Receipt',
  is_billable: 'Bill to a client', submitted_by: 'Claimed by', submitted_at: 'Submitted on',
  approved_by: 'Approved by', approved_at: 'Approved on', rejected_by: 'Rejected by',
  rejected_at: 'Rejected on', rejection_reason: 'Rejection reason', reimbursed_at: 'Paid back on',
  reimbursed_by: 'Paid back by', cycle_id: 'Review cycle', reviewer_employee_id: 'Reviewer',
  overall_rating: 'Overall rating', self_comments: 'Self comments', manager_comments: 'Manager comments',
  signoff_comments: 'Sign-off comments', period_start: 'Period from', period_end: 'Period to',
  rating_scale_max: 'Rating scale', weight: 'Weight', target: 'Target', self_rating: 'Self rating',
  manager_rating: 'Manager rating', competency: 'Competency', comments: 'Comments', module: 'Module',
  auto_enroll: 'Add CRM logins automatically', enroll_role_levels: 'Roles added', employee_no_prefix: 'Employee number start',
  exit_prompt: 'Ask to confirm exits', rules: 'Rules', updated_by: 'Changed by', source: 'Came from',
  exit_type: 'Left because', last_day: 'Last day', eligible_for_rehire: 'Can be rehired', opened_at: 'Opened',
  handled_by: 'Handled by', handled_at: 'Handled on', trigger: 'Started by',
};

// Plumbing columns: kept in the record, not worth a line in the timeline.
const QUIET = new Set(['id', 'company_id', 'created_at', 'updated_at', 'line_no', 'sort_order',
  'entry_id', 'invoice_id', 'run_id', 'review_id', 'created_by']);

export const fieldLabel = (k) => FIELD_LABEL[k] || String(k).replace(/_id$/, '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const ISO_D = /^\d{4}-\d{2}-\d{2}$/;

export function fmtValue(v, refNames = {}) {
  if (v === null || v === undefined || v === '') return '—';
  if (v === '(hidden)') return 'hidden';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (typeof v === 'string') {
    if (UUID.test(v)) return refNames[v] || 'record …' + v.slice(-4);
    if (ISO_TS.test(v)) { const d = new Date(v); return isNaN(d) ? v : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }
    if (ISO_D.test(v))  { const d = new Date(v + 'T00:00:00'); return isNaN(d) ? v : d.toLocaleDateString(undefined, { dateStyle: 'medium' }); }
    if (/^[a-z]+(_[a-z]+)+$/.test(v)) return v.replace(/_/g, ' ');      // on_leave -> on leave
    return v;
  }
  if (Array.isArray(v)) return v.map(x => fmtValue(x, refNames)).join(', ');
  try { return JSON.stringify(v); } catch { return String(v); }
}

export function relTime(iso) {
  const d = new Date(iso);
  const s = (Date.now() - d.getTime()) / 1000;
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  if (s < 86400 * 7) return Math.floor(s / 86400) + ' d ago';
  return d.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

const OP = {
  INSERT:   { verb: 'created', icon: PlusCircle, tone: 'var(--color-success-600)' },
  UPDATE:   { verb: 'changed', icon: PencilLine, tone: 'var(--color-primary-600)' },
  DELETE:   { verb: 'deleted', icon: Trash2,     tone: 'var(--color-error-600)' },
  BASELINE: { verb: 'history starts here', icon: Flag, tone: 'var(--color-text-tertiary)' },
};

// One entry. `showRecord` adds the record's name (used by the change log,
// where entries from many records sit together).
export function HistoryEvent({ event, refNames = {}, showRecord = false }) {
  const [open, setOpen] = useState(false);
  const isBaseline = event.source === 'baseline';
  const op = isBaseline ? OP.BASELINE : (OP[event.operation] || OP.UPDATE);
  const Icon = op.icon;
  const changes = event.changes || {};
  const snapshot = changes.snapshot;
  const hidden = changes.hidden;
  const diffs = (!snapshot && !hidden) ? Object.entries(changes).filter(([k]) => !QUIET.has(k)) : [];
  const snapRows = snapshot ? Object.entries(snapshot).filter(([k, v]) => !QUIET.has(k) && v !== null && v !== '') : [];
  const what = TABLE_LABEL[event.table_name] || event.table_name;

  return (
    <li className="flex gap-3 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
      <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ background: `color-mix(in srgb, ${op.tone} 14%, transparent)` }}>
        <Icon size={14} style={{ color: op.tone }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-x-2 gap-y-0.5 flex-wrap">
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{event.actor_name || 'Someone'}</span>
          <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {isBaseline ? 'record as it was when history began' : op.verb + ' ' + what.toLowerCase()}
            {showRecord && event.record_label ? <> · <b style={{ color: 'var(--color-text)' }}>{event.record_label}</b></> : null}
            {!showRecord && event.record_label && event.table_name !== 'hr_employees' ? <> · {event.record_label}</> : null}
          </span>
          <span className="text-xs ml-auto whitespace-nowrap" title={new Date(event.changed_at).toLocaleString()}
            style={{ color: 'var(--color-text-tertiary)' }}>{relTime(event.changed_at)}</span>
        </div>

        {hidden && <p className="text-xs m-0 mt-1" style={{ color: 'var(--color-text-tertiary)' }}>{hidden}</p>}

        {diffs.length > 0 && (
          <ul className="mt-1.5 space-y-1 m-0 p-0 list-none">
            {diffs.map(([k, d]) => (
              <li key={k} className="text-xs flex flex-wrap items-baseline gap-x-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{fieldLabel(k)}</span>
                <span className="line-through opacity-70">{fmtValue(d?.old, refNames)}</span>
                <span aria-hidden>→</span>
                <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{fmtValue(d?.new, refNames)}</span>
              </li>
            ))}
          </ul>
        )}

        {snapRows.length > 0 && (
          <div className="mt-1">
            <button type="button" onClick={() => setOpen(o => !o)}
              className="text-xs font-semibold inline-flex items-center gap-1" style={{ color: 'var(--color-text-secondary)' }}>
              {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {event.operation === 'DELETE' ? 'What was deleted' : 'Details'}
            </button>
            {open && (
              <dl className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 text-xs m-0">
                {snapRows.map(([k, v]) => (
                  <div key={k} className="flex gap-1.5 min-w-0">
                    <dt className="font-semibold flex-shrink-0" style={{ color: 'var(--color-text)' }}>{fieldLabel(k)}:</dt>
                    <dd className="m-0 truncate" style={{ color: 'var(--color-text-secondary)' }} title={fmtValue(v, refNames)}>{fmtValue(v, refNames)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}

        {event.reason && (
          <p className="text-xs m-0 mt-1.5 px-2 py-1 rounded-md italic"
            style={{ background: 'color-mix(in srgb, var(--color-text) 6%, transparent)', color: 'var(--color-text)' }}>
            “{event.reason}”
          </p>
        )}
      </div>
    </li>
  );
}

export function HistoryModal({ module, table, id, companyId, title, onClose }) {
  const [state, setState] = useState({ loading: true, error: null, events: [], refNames: {} });

  useEffect(() => {
    let alive = true;
    client.get(`${module}/history/record/${table}/${id}`, { params: { company_id: companyId || undefined } })
      .then(r => { if (alive) setState({ loading: false, error: null, events: r.data.events || [], refNames: r.data.ref_names || {} }); })
      .catch(e => { if (alive) setState({ loading: false, error: e.response?.data?.error || 'Could not load the history', events: [], refNames: {} }); });
    return () => { alive = false; };
  }, [module, table, id, companyId]);

  return (
    <ModuleModal wide title={title || 'History'} subtitle="Every change to this record: who made it, when, and why. History cannot be edited or deleted."
      onClose={onClose}>
      {state.loading && <Loading variant="rows" rows={4} />}
      {state.error && <p className="text-sm m-0" style={{ color: 'var(--color-error-600)' }}>{state.error}</p>}
      {!state.loading && !state.error && state.events.length === 0 && (
        <EmptyState icon={History} compact title="No history yet" hint="Changes made from now on will appear here." />
      )}
      {state.events.length > 0 && (
        <ul className="m-0 p-0 list-none max-h-[65vh] overflow-auto pr-1">
          {state.events.map(ev => <HistoryEvent key={ev.id} event={ev} refNames={state.refNames} />)}
        </ul>
      )}
    </ModuleModal>
  );
}

export function HistoryButton({ module, table, id, companyId, title, label = 'History', size = 'sm' }) {
  const [open, setOpen] = useState(false);
  if (!id) return null;
  return (
    <>
      <Btn size={size} icon={History} onClick={() => setOpen(true)} title="Who changed what, and when">{label}</Btn>
      {open && <HistoryModal module={module} table={table} id={id} companyId={companyId} title={title} onClose={() => setOpen(false)} />}
    </>
  );
}

export default HistoryButton;
