// ============================================================================
// QueueTab.jsx — MY assignments (assigned_to = self). "Unassigned" doesn't
// apply here by definition (that's PoolTab) — the two live states within a
// queue are "not started" (pending) and "in review", plus a history filter
// for what's already scored/skipped. Backend: qa2Assignments.js.
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import { ListTodo, Clock, PlayCircle, CheckCircle2 } from 'lucide-react';
import client from '../../api/client';
import { Panel, SectionHeader, TableScroll, EmptyState, Loading, KpiTile } from '../UI/kit';
import ReviewScreen from './ReviewScreen';

const FILTERS = [
  { key: 'pending', label: 'Not started', icon: Clock },
  { key: 'in_review', label: 'In review', icon: PlayCircle },
  { key: 'scored', label: 'Scored', icon: CheckCircle2 },
];

export default function QueueTab() {
  const [filter, setFilter] = useState('pending');
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [open, setOpen] = useState(null);

  const load = useCallback(() => {
    setLoadError(null);
    client.get('qa2/queue', { params: { status: filter } })
      .then(r => setRows(r.data.assignments || []))
      .catch(e => setLoadError(e.response?.data?.error || 'Could not load your queue'));
  }, [filter]);
  useEffect(() => { load(); }, [load]);

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
        <EmptyState icon={ListTodo} title="Nothing here" hint="Claim work from the Pool tab, or wait for a manager to push you something." />
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
                    <td className="px-3 py-2">{a.qa2_call?.agent_user || '—'}</td>
                    <td className="px-3 py-2">{a.qa2_call?.recording_state || '—'}</td>
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
