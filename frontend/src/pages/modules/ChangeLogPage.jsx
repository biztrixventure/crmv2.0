// ============================================================================
// ChangeLogPage -- the company-wide "who changed what" log for one module.
//
// Same page for HR and Accounting (module prop). Reads
//   GET /{module}/history/feed      newest first, paginated by id
//   GET /{module}/history/actors    the "changed by" picker
// Gate on the server: hr.history.view / accounting.history.view. Salary and
// payroll amounts are hidden server-side from anyone without those rights.
//
// The log is append-only (mig 313): there is no edit or delete here, and the
// server would refuse one anyway.
// ============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { History, Download, RotateCcw } from 'lucide-react';
import client from '../../api/client';
import { Panel, SectionHeader, Loading, EmptyState, Field } from '../../components/UI/kit';
import ThemedSelect from '../../components/UI/Select';
import ThemedDate from '../../components/UI/ThemedDate';
import { Btn } from '../../components/Modules/ModuleUI';
import { HistoryEvent, TABLE_LABEL, fieldLabel, fmtValue } from '../../components/Modules/RecordHistory';
import { downloadCSV } from '../../utils/recordFormat';

const MODULE_TABLES = {
  hr: ['hr_employees', 'user_company_roles', 'hr_departments', 'hr_positions', 'hr_attendance',
       'hr_leave_requests', 'hr_leave_balances', 'hr_leave_types', 'hr_pay_periods', 'hr_payroll_runs',
       'hr_payroll_entries', 'hr_payroll_deductions', 'hr_review_cycles', 'hr_reviews'],
  accounting: ['chart_of_accounts', 'journal_entries', 'journal_entry_lines', 'invoices', 'invoice_line_items',
               'invoice_payments', 'expenses', 'expense_categories'],
};

const OPS = [
  { value: '', label: 'Any change' },
  { value: 'INSERT', label: 'Created' },
  { value: 'UPDATE', label: 'Changed' },
  { value: 'DELETE', label: 'Deleted' },
];

const EMPTY = { table: '', actor: '', operation: '', date_from: '', date_to: '', include_baseline: false };

export default function ChangeLogPage({ module, scope }) {
  const companyId = scope?.company_id || null;
  const [filters, setFilters] = useState(EMPTY);
  const [events, setEvents] = useState([]);
  const [refNames, setRefNames] = useState({});
  const [nextBefore, setNextBefore] = useState(null);
  const [actors, setActors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const params = useMemo(() => ({
    company_id: companyId || undefined,
    table: filters.table || undefined,
    actor: filters.actor || undefined,
    operation: filters.operation || undefined,
    date_from: filters.date_from || undefined,
    date_to: filters.date_to || undefined,
    include_baseline: filters.include_baseline ? 'true' : undefined,
  }), [companyId, filters]);

  const load = useCallback(async (before = null) => {
    setLoading(true);
    setError(null);
    try {
      const r = await client.get(`${module}/history/feed`, { params: { ...params, before: before || undefined, limit: 100 } });
      setEvents(prev => before ? [...prev, ...(r.data.events || [])] : (r.data.events || []));
      setRefNames(prev => ({ ...(before ? prev : {}), ...(r.data.ref_names || {}) }));
      setNextBefore(r.data.next_before || null);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not load the change log');
    } finally {
      setLoading(false);
    }
  }, [module, params]);

  useEffect(() => { load(null); }, [load]);

  useEffect(() => {
    client.get(`${module}/history/actors`, { params: { company_id: companyId || undefined } })
      .then(r => setActors(r.data.actors || []))
      .catch(() => setActors([]));
  }, [module, companyId]);

  const set = (k, v) => setFilters(f => ({ ...f, [k]: v }));

  // One row per changed field, so the file opens cleanly in a spreadsheet.
  const exportCsv = () => {
    const rows = [];
    for (const e of events) {
      const base = [new Date(e.changed_at).toLocaleString(), e.actor_name, TABLE_LABEL[e.table_name] || e.table_name,
        e.record_label || '', e.operation, e.reason || ''];
      const c = e.changes || {};
      if (c.snapshot || c.hidden) { rows.push([...base, '', '', '']); continue; }
      const keys = Object.keys(c);
      if (!keys.length) rows.push([...base, '', '', '']);
      for (const k of keys) rows.push([...base, fieldLabel(k), fmtValue(c[k]?.old, refNames), fmtValue(c[k]?.new, refNames)]);
    }
    downloadCSV(rows, ['When', 'Who', 'What', 'Record', 'Action', 'Reason', 'Field', 'Before', 'After'],
      `${module}-change-log-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  return (
    <div className="space-y-4">
      <SectionHeader level="page" icon={History} title="Change log"
        subtitle="Every change in this company: who made it, when, what it was before and after, and why. Nothing here can be edited or deleted."
        actions={<Btn icon={Download} onClick={exportCsv} disabled={!events.length}>Download CSV</Btn>} />

      <Panel pad="md">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <Field label="Record type">
            <ThemedSelect value={filters.table} onChange={e => set('table', e.target.value)}>
              <option value="">Everything</option>
              {MODULE_TABLES[module].map(t => <option key={t} value={t}>{TABLE_LABEL[t] || t}</option>)}
            </ThemedSelect>
          </Field>
          <Field label="Changed by">
            <ThemedSelect value={filters.actor} onChange={e => set('actor', e.target.value)}>
              <option value="">Anyone</option>
              {actors.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </ThemedSelect>
          </Field>
          <Field label="Action">
            <ThemedSelect value={filters.operation} onChange={e => set('operation', e.target.value)}>
              {OPS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </ThemedSelect>
          </Field>
          <Field label="From">
            <ThemedDate value={filters.date_from} onChange={e => set('date_from', e.target.value)} />
          </Field>
          <Field label="To">
            <ThemedDate value={filters.date_to} onChange={e => set('date_to', e.target.value)} />
          </Field>
        </div>
        <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
          <label className="text-xs inline-flex items-center gap-2 cursor-pointer" style={{ color: 'var(--color-text-secondary)' }}>
            <input type="checkbox" checked={filters.include_baseline} onChange={e => set('include_baseline', e.target.checked)} />
            Also show each record as it was when history began (14 Sep 2026)
          </label>
          <Btn size="sm" icon={RotateCcw} onClick={() => setFilters(EMPTY)}>Clear filters</Btn>
        </div>
      </Panel>

      <Panel pad="md">
        {error && <p className="text-sm m-0" style={{ color: 'var(--color-error-600)' }}>{error}</p>}
        {loading && !events.length && <Loading variant="rows" rows={6} />}
        {!loading && !error && events.length === 0 && (
          <EmptyState icon={History} title="No changes match" hint="Try a wider date range, or clear the filters." />
        )}
        {events.length > 0 && (
          <ul className="m-0 p-0 list-none">
            {events.map(ev => <HistoryEvent key={ev.id} event={ev} refNames={refNames} showRecord />)}
          </ul>
        )}
        {nextBefore && (
          <div className="flex justify-center pt-3">
            <Btn onClick={() => load(nextBefore)} busy={loading}>Show older changes</Btn>
          </div>
        )}
      </Panel>
    </div>
  );
}
