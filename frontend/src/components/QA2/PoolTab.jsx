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
import { Inbox as InboxIcon } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';
import { Panel, SectionHeader, TableScroll, EmptyState, Loading } from '../UI/kit';
import ColumnHeader from '../UI/ColumnHeader';
import { useTableQuery, useAbortable, isCanceled } from '../../hooks/useTableQuery';
import ReviewScreen from './ReviewScreen';

const LEG_OPTIONS = [{ value: 'fronter', label: 'Fronter' }, { value: 'closer', label: 'Closer' }];
const REC_OPTIONS = [
  { value: 'pending', label: 'Pending' }, { value: 'found', label: 'Found' },
  { value: 'missing', label: 'Missing' }, { value: 'error', label: 'Error' },
];
const th = 'text-left font-semibold px-3 py-2';

export default function PoolTab({ scope }) {
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [claimingId, setClaimingId] = useState(null);
  const [open, setOpen] = useState(null);
  const [columns, setColumns] = useState({});
  const [companyOptions, setCompanyOptions] = useState([]);
  const [methodOptions, setMethodOptions] = useState([]);

  const tq = useTableQuery({ scope: 'qa2:pool', columns, defaultSort: { by: 'call_at', dir: 'desc' } });
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

  if (open) return <ReviewScreen assignment={open} onDone={() => { setOpen(null); load(); }} />;

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <SectionHeader level="page" icon={InboxIcon} title="Pool" subtitle="Unassigned calls within your granted companies and methods — claim one to start." />

      {loadError && <Panel tone="inset"><p className="text-sm" style={{ color: 'var(--color-error-600)' }}>{loadError}</p></Panel>}
      {!loadError && rows === null && <Loading variant="table" rows={4} />}
      {!loadError && rows && rows.length === 0 && (
        <EmptyState icon={InboxIcon} title="Pool is empty" hint="Nothing waiting to be claimed right now, or nothing matches your filters." />
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
