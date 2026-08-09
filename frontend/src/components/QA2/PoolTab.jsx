// ============================================================================
// PoolTab.jsx — unassigned calls within the caller's own grants (companies +
// methods). Claim is race-safe server-side, so two agents hitting "Claim" on
// the same row at once is handled cleanly, not just optimistically. Backend:
// qa2Assignments.js.
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import { Inbox as InboxIcon } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';
import { Panel, SectionHeader, TableScroll, EmptyState, Loading } from '../UI/kit';
import ReviewScreen from './ReviewScreen';

export default function PoolTab() {
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [claimingId, setClaimingId] = useState(null);
  const [open, setOpen] = useState(null);

  const load = useCallback(() => {
    setLoadError(null);
    client.get('qa2/pool').then(r => setRows(r.data.assignments || [])).catch(e => setLoadError(e.response?.data?.error || 'Could not load the pool'));
  }, []);
  useEffect(() => { load(); }, [load]);

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
        <EmptyState icon={InboxIcon} title="Pool is empty" hint="Nothing waiting to be claimed right now." />
      )}

      {!loadError && rows && rows.length > 0 && (
        <Panel pad="none">
          <TableScroll>
            <table className="w-full text-sm">
              <thead><tr style={{ color: 'var(--color-text-secondary)' }}>
                <th className="text-left font-semibold px-3 py-2">Company</th>
                <th className="text-left font-semibold px-3 py-2">Method</th>
                <th className="text-left font-semibold px-3 py-2">Leg</th>
                <th className="text-left font-semibold px-3 py-2">Agent</th>
                <th className="text-left font-semibold px-3 py-2">Recording</th>
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
