// ============================================================================
// QueueTab.jsx — MY assignments (assigned_to = self). "Unassigned" doesn't
// apply here by definition (that's PoolTab) — the two live states within a
// queue are "not started" (pending) and "in review", plus a history filter
// for what's already scored/skipped. Backend: qa2Assignments.js.
//
// Column header sort/filter reuses the SAME useTableQuery/<ColumnHeader> pair
// every compliance list already drives off, alongside the existing KpiTile
// status switcher (a separate axis — pending/in_review/scored — not part of
// the column-filter catalog).
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import { ListTodo, Clock, PlayCircle, CheckCircle2 } from 'lucide-react';
import client from '../../api/client';
import { Panel, SectionHeader, TableScroll, EmptyState, Loading, KpiTile } from '../UI/kit';
import ColumnHeader from '../UI/ColumnHeader';
import { useTableQuery, useAbortable, isCanceled } from '../../hooks/useTableQuery';
import ReviewScreen from './ReviewScreen';

const FILTERS = [
  { key: 'pending', label: 'Not started', icon: Clock },
  { key: 'in_review', label: 'In review', icon: PlayCircle },
  { key: 'scored', label: 'Scored', icon: CheckCircle2 },
];
const LEG_OPTIONS = [{ value: 'fronter', label: 'Fronter' }, { value: 'closer', label: 'Closer' }];
const REC_OPTIONS = [
  { value: 'pending', label: 'Pending' }, { value: 'found', label: 'Found' },
  { value: 'missing', label: 'Missing' }, { value: 'error', label: 'Error' },
];
const th = 'text-left font-semibold px-3 py-2';

export default function QueueTab({ scope }) {
  const [filter, setFilter] = useState('pending');
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [open, setOpen] = useState(null);
  const [columns, setColumns] = useState({});
  const [companyOptions, setCompanyOptions] = useState([]);
  const [methodOptions, setMethodOptions] = useState([]);

  const tq = useTableQuery({ scope: 'qa2:queue', columns, defaultSort: { by: 'call_at', dir: 'desc' } });
  const abortable = useAbortable();

  const myCompanyIds = scope?.operationalCompanyIds === 'all' ? null : (scope?.operationalCompanyIds || []);
  useEffect(() => {
    client.get('compliance/companies').then(r => {
      const all = r.data.companies || [];
      setCompanyOptions((myCompanyIds ? all.filter(c => myCompanyIds.includes(c.id)) : all).map(c => ({ value: c.id, label: c.name })));
    }).catch(() => {});
    client.get('qa2/methods').then(r => setMethodOptions((r.data.methods || []).map(m => ({ value: m.id, label: m.label })))).catch(() => {});
  }, [myCompanyIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(() => {
    setLoadError(null);
    client.get('qa2/queue', { params: { status: filter, ...tq.params }, signal: abortable() })
      .then(r => { setRows(r.data.assignments || []); if (r.data.columns) setColumns(r.data.columns); })
      .catch(e => { if (!isCanceled(e)) setLoadError(e.response?.data?.error || 'Could not load your queue'); });
  }, [filter, tq.params, abortable]);
  useEffect(() => { load(); }, [filter, tq.version]); // eslint-disable-line react-hooks/exhaustive-deps

  if (open) return <ReviewScreen assignment={open} onDone={() => { setOpen(null); load(); }} />;

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <SectionHeader level="page" icon={ListTodo} title="My queue" subtitle="Assignments already yours." />

      <div className="grid grid-cols-3 gap-3">
        {FILTERS.map(f => (
          <KpiTile key={f.key} icon={f.icon} label={f.label} value={filter === f.key ? (rows?.length ?? '…') : '—'}
            active={filter === f.key} onClick={() => setFilter(f.key)} />
        ))}
      </div>

      {loadError && <Panel tone="inset"><p className="text-sm" style={{ color: 'var(--color-error-600)' }}>{loadError}</p></Panel>}
      {!loadError && rows === null && <Loading variant="table" rows={4} />}
      {!loadError && rows && rows.length === 0 && (
        <EmptyState icon={ListTodo} title="Nothing here" hint="Claim work from the Pool tab, wait for a manager to push you something, or check your filters." />
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
                {rows.map(a => (
                  <tr key={a.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td className="px-3 py-2">{a.qa2_call?.companies?.name || '—'}</td>
                    <td className="px-3 py-2">{a.qa2_call?.qa2_method?.label || '—'}</td>
                    <td className="px-3 py-2">{a.qa2_call?.leg || '—'}</td>
                    <td className="px-3 py-2">{a.qa2_call?.agent_name || a.qa2_call?.agent_user || '—'}</td>
                    <td className="px-3 py-2">{a.qa2_call?.recording_state || '—'}</td>
                    <td className="px-3 py-2">{a.qa2_call?.call_at ? new Date(a.qa2_call.call_at).toLocaleDateString() : '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <button className="btn btn-primary text-xs" onClick={() => setOpen(a)}>Open</button>
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
