// ============================================================================
// PoolTab.jsx — unassigned calls within the caller's own grants (companies +
// methods). Claim is race-safe server-side, so two agents hitting "Claim" on
// the same row at once is handled cleanly, not just optimistically. Backend:
// qa2Assignments.js.
//
// Column header sort/filter reuses the SAME useTableQuery/<ColumnHeader> pair
// every compliance list already drives off — not a QA2-specific reinvention
// of the UI, only the backend's filter application differs (qa2ColumnFilter.js,
// since Pool queries qa2_assignment with qa2_call embedded).
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import { Inbox as InboxIcon, X } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';
import { Panel, SectionHeader, TableScroll, EmptyState, Loading } from '../UI/kit';
import ColumnHeader from '../UI/ColumnHeader';
import ThemedDate from '../UI/ThemedDate';
import ThemedSelect from '../UI/Select';
import { useTableQuery, useAbortable, isCanceled } from '../../hooks/useTableQuery';
import ReviewScreen from './ReviewScreen';

// THE WORK BAR — day, company, method. Shared by Pool and My queue.
//
// Day is the DIALER's day, i.e. US Eastern (the box runs UTC-4 and Load Day
// windows the same way). The team's shift is 8 pm – 5 am Pakistan time, which
// is 11 am – 8 pm Eastern: one whole shift falls inside ONE Eastern date, so
// "Today" here is "this shift" — never split across two days the way a
// Pakistan-local or UTC date would split it at midnight.
//
// Company and method options come from the ROWS the agent can see (their
// grants), so the method pills are dynamic: an agent granted only TRA sees only
// TRA; grant them Closed and a Closed pill appears on their next load.
const etDay = (offset = 0) => {
  const d = new Date(); d.setDate(d.getDate() - offset);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
};
export function WorkFilters({ tq, companyOptions, methodOptions, methodTab, setMethodTab, counts }) {
  const f = tq.filters?.call_at;
  const day = f && f.op === 'between' && f.v && f.v === f.v2 ? f.v : '';
  const setDay = (d) => (d ? tq.setFilter('call_at', { op: 'between', v: d, v2: d }) : tq.clearFilter('call_at'));
  const cf = tq.filters?.company;
  const company = cf && cf.op === 'in' && Array.isArray(cf.v) && cf.v.length === 1 ? String(cf.v[0]) : '';
  const setCompany = (id) => (id ? tq.setFilter('company', { op: 'in', v: [id] }) : tq.clearFilter('company'));
  const pill = (on) => ({ background: on ? 'var(--color-primary-600)' : 'var(--color-surface)', color: on ? '#fff' : 'var(--color-text)', border: '1px solid var(--color-border)' });
  const P = ({ on, onClick, children }) => (
    <button onClick={onClick} className="text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap" style={pill(on)}>{children}</button>
  );
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Shift day</span>
        <ThemedDate value={day} onChange={e => setDay(e.target.value)} />
        <P on={day === etDay(0)} onClick={() => setDay(etDay(0))}>Today</P>
        <P on={day === etDay(1)} onClick={() => setDay(etDay(1))}>Yesterday</P>
        <P on={!day} onClick={() => setDay('')}>All days</P>
        {companyOptions.length > 1 && (
          <>
            <span className="text-xs font-semibold ml-2" style={{ color: 'var(--color-text-secondary)' }}>Company</span>
            <div className="min-w-[180px]">
              <ThemedSelect value={company} onChange={e => setCompany(e.target.value)}>
                <option value="">All companies</option>
                {companyOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </ThemedSelect>
            </div>
          </>
        )}
      </div>
      {methodOptions.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <P on={methodTab === 'all'} onClick={() => setMethodTab('all')}>All{counts ? ` ${counts.all}` : ''}</P>
          {methodOptions.map(m => (
            <P key={m.value} on={methodTab === m.value} onClick={() => setMethodTab(m.value)}>
              {m.label}{counts ? ` ${counts[m.value] || 0}` : ''}
            </P>
          ))}
        </div>
      )}
    </div>
  );
}
// Rows narrowed by the method pill, plus per-method counts for the pills.
export function byMethod(rows, methodTab) {
  const list = rows || [];
  const counts = { all: list.length };
  list.forEach(a => { const m = a.qa2_call?.method_id; if (m) counts[m] = (counts[m] || 0) + 1; });
  return { visible: methodTab === 'all' ? list : list.filter(a => a.qa2_call?.method_id === methodTab), counts };
}

const LEG_OPTIONS = [{ value: 'fronter', label: 'Fronter' }, { value: 'closer', label: 'Closer' }];
const REC_OPTIONS = [
  { value: 'pending', label: 'Pending' }, { value: 'found', label: 'Found' },
  { value: 'missing', label: 'Missing' }, { value: 'error', label: 'Error' },
];
const th = 'text-left font-semibold px-3 py-2';

export default function PoolTab() {
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [claimingId, setClaimingId] = useState(null);
  const [open, setOpen] = useState(null);
  const [columns, setColumns] = useState({});
  const [methodTab, setMethodTab] = useState('all');   // pill: 'all' | method_id

  const tq = useTableQuery({ scope: 'qa2:pool', columns, defaultSort: { by: 'call_at', dir: 'desc' } });
  const abortable = useAbortable();

  // Filter options come from the ROWS, not from /compliance/companies and
  // /qa2/methods. Both are manager/compliance-only, so a QA agent — who lives in
  // this screen to claim work — got a 403 pair on every mount and empty filter
  // dropdowns. Each row already carries company_id + name and method_id + label,
  // so the lists describe exactly what this agent can see.
  const optionsFrom = (list, idKey, labelOf) => {
    const seen = new Map();
    (list || []).forEach(a => {
      const c = a.qa2_call || {};
      const id = c[idKey]; const label = labelOf(c);
      if (id && label && !seen.has(id)) seen.set(id, { value: id, label });
    });
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
  };
  const companyOptions = optionsFrom(rows, 'company_id', c => c.companies?.name);
  const methodOptions  = optionsFrom(rows, 'method_id',  c => c.qa2_method?.label);
  const { visible, counts: methodCounts } = byMethod(rows, methodTab);

  const load = useCallback(() => {
    setLoadError(null);
    client.get('qa2/pool', { params: tq.params, signal: abortable() })
      .then(r => { setRows(r.data.assignments || []); if (r.data.columns) setColumns(r.data.columns); })
      .catch(e => { if (!isCanceled(e)) setLoadError(e.response?.data?.error || 'Could not load the pool'); });
  }, [tq.params, abortable]);
  useEffect(() => { load(); }, [tq.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const claim = async (assignment) => {
    setClaimingId(assignment.id);
    try {
      const r = await client.post(`qa2/assignments/${assignment.id}/claim`);
      toast.success('Claimed');
      setRows(prev => prev.filter(a => a.id !== assignment.id));
      setOpen(r.data.assignment);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Someone else just claimed this');
      load();
    } finally { setClaimingId(null); }
  };

  // Pool's "next" can't just index into the local list the way Queue's does —
  // these rows are still unclaimed and shared with every other agent, so the
  // next one has to be claimed for real (a network round trip), and it may
  // already be gone by the time we ask. Walk the locally-known rows, claiming
  // each in turn until one succeeds; a lost race just drops that row and
  // tries the next without bothering the agent with it. Only surface an error
  // if the whole local list turns out to be already taken.
  const claimNext = async () => {
    for (const candidate of visible) {
      try {
        const r = await client.post(`qa2/assignments/${candidate.id}/claim`);
        setRows(prev => prev.filter(a => a.id !== candidate.id));
        setOpen(r.data.assignment);
        return;
      } catch {
        setRows(prev => prev.filter(a => a.id !== candidate.id));
      }
    }
    toast.error('Everything in view just got claimed — refreshing the pool');
    setOpen(null);
    load();
  };

  if (open) {
    return (
      <ReviewScreen
        key={open.id}
        assignment={open}
        remaining={visible.length}
        nextLabel={visible.length > 0 ? 'Next record' : null}
        onNext={visible.length > 0 ? claimNext : null}
        onDone={() => { setOpen(null); load(); }}
      />
    );
  }

  // ACTIVE FILTERS, VISIBLY. Column filters live in the header menus and persist
  // per user, so a filter set yesterday still applies today with nothing on
  // screen saying so — an empty table then looks like "no work" and there is no
  // obvious way back. Each active filter is now a chip you can remove, plus one
  // Clear all, and the empty state offers the same escape.
  const FILTER_LABELS = { company: 'Company', method: 'Method', leg: 'Leg', recording_state: 'Recording', call_at: 'Date' };
  const OPTION_LOOKUP = { company: companyOptions, method: methodOptions, leg: LEG_OPTIONS, recording_state: REC_OPTIONS };
  const filterText = (key, f) => {
    if (!f) return '';
    if (f.op === 'empty') return 'is empty';
    if (f.op === 'notempty') return 'is not empty';
    const pretty = (v) => (OPTION_LOOKUP[key] || []).find(o => String(o.value) === String(v))?.label ?? v;
    if (f.op === 'in')      return (Array.isArray(f.v) ? f.v : [f.v]).map(pretty).join(', ');
    if (f.op === 'between') return `${f.v} → ${f.v2 || '…'}`;
    if (f.op === 'gte')     return `≥ ${f.v}`;
    if (f.op === 'lte')     return `≤ ${f.v}`;
    return String(pretty(f.v));
  };
  const activeFilters = Object.entries(tq.filters || {});

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <SectionHeader level="page" icon={InboxIcon} title="Pool" subtitle="Unassigned calls within your granted companies and methods — claim one to start." />

      <WorkFilters tq={tq} companyOptions={companyOptions} methodOptions={methodOptions}
        methodTab={methodTab} setMethodTab={setMethodTab} counts={methodCounts} />

      {activeFilters.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Filtered by</span>
          {activeFilters.map(([key, f]) => (
            <button key={key} onClick={() => tq.clearFilter(key)} title="Remove this filter"
              className="text-xs font-semibold px-2 py-1 rounded-full inline-flex items-center gap-1.5"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
              {FILTER_LABELS[key] || key}: {filterText(key, f)} <X size={11} />
            </button>
          ))}
          <button onClick={tq.clearAll} className="text-xs font-bold px-2.5 py-1 rounded-full"
            style={{ background: 'var(--color-primary-600)', color: '#fff' }}>
            Clear all
          </button>
        </div>
      )}

      {loadError && <Panel tone="inset"><p className="text-sm" style={{ color: 'var(--color-error-600)' }}>{loadError}</p></Panel>}
      {!loadError && rows === null && <Loading variant="table" rows={4} />}
      {!loadError && rows && rows.length === 0 && (
        (tq.activeCount > 0 ? (
          <EmptyState icon={InboxIcon} title="No calls match your filters"
            hint="The pool may still have work — these filters are hiding it."
            action={<button onClick={tq.clearAll} className="text-sm font-bold px-3 py-2 rounded-lg"
              style={{ background: 'var(--gradient-sidebar)', color: 'var(--color-text-inverse)' }}>Clear all filters</button>} />
        ) : (
          <EmptyState icon={InboxIcon} title="Pool is empty" hint="Nothing waiting to be claimed right now." />
        ))
      )}

      {!loadError && rows && rows.length > 0 && (
        <Panel pad="none">
          <TableScroll>
            <table className="w-full text-sm">
              <thead><tr style={{ color: 'var(--color-text-secondary)' }}>
                <ColumnHeader tq={tq} colKey="company" label="Company" options={companyOptions} className={th} />
                <ColumnHeader tq={tq} colKey="method" label="Method" options={methodOptions} className={th} />
                <ColumnHeader tq={tq} colKey="leg" label="Leg" options={LEG_OPTIONS} className={th} />
                <th className={th}>Agent</th>
                <ColumnHeader tq={tq} colKey="recording_state" label="Recording" options={REC_OPTIONS} className={th} />
                <ColumnHeader tq={tq} colKey="call_at" label="Date" className={th} />
                <th className="px-3 py-2" />
              </tr></thead>
              <tbody>
                {visible.map(a => (
                  <tr key={a.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td className="px-3 py-2">{a.qa2_call?.companies?.name || '—'}</td>
                    <td className="px-3 py-2">{a.qa2_call?.qa2_method?.label || '—'}</td>
                    <td className="px-3 py-2">{a.qa2_call?.leg || '—'}</td>
                    <td className="px-3 py-2">{a.qa2_call?.agent_name || a.qa2_call?.agent_user || '—'}</td>
                    <td className="px-3 py-2">{a.qa2_call?.recording_state || '—'}</td>
                    <td className="px-3 py-2">{a.qa2_call?.call_at ? new Date(a.qa2_call.call_at).toLocaleDateString() : '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <button className="btn btn-primary text-xs" disabled={claimingId === a.id} onClick={() => claim(a)}>
                        {claimingId === a.id ? 'Claiming…' : 'Claim'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Panel>
      )}
    </div>
  );
}
