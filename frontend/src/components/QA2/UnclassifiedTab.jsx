// ============================================================================
// UnclassifiedTab.jsx — calls with zero rule match (qa2_call.method_id IS
// NULL). A manager assigns a method or rejects as not QA-relevant — nothing
// is ever silently dropped. Backend: qa2Methods.js.
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import { Inbox, X } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';
import ThemedSelect from '../UI/Select';
import { Panel, SectionHeader, TableScroll, EmptyState, Loading } from '../UI/kit';

export default function UnclassifiedTab() {
  const [calls, setCalls] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [methods, setMethods] = useState([]);
  const [picked, setPicked] = useState({});
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    setLoadError(null);
    Promise.all([
      client.get('qa2/unclassified'),
      client.get('qa2/methods'),
    ]).then(([callsRes, methodsRes]) => {
      setCalls(callsRes.data.calls || []);
      setMethods((methodsRes.data.methods || []).filter(m => m.is_active));
    }).catch(e => setLoadError(e.response?.data?.error || 'Could not load the unclassified pool'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const classify = async (callId) => {
    const methodId = picked[callId];
    if (!methodId) return toast.error('Pick a method first');
    setBusyId(callId);
    try {
      await client.post(`qa2/calls/${callId}/classify`, { method_id: methodId });
      toast.success('Classified');
      setCalls(prev => prev.filter(c => c.id !== callId));
    } catch (e) { toast.error(e.response?.data?.error || 'Could not classify'); }
    finally { setBusyId(null); }
  };

  const reject = async (callId) => {
    setBusyId(callId);
    try {
      await client.post(`qa2/calls/${callId}/classify`, { qa_relevant: false });
      toast.success('Marked not QA-relevant');
      setCalls(prev => prev.filter(c => c.id !== callId));
    } catch (e) { toast.error(e.response?.data?.error || 'Could not update'); }
    finally { setBusyId(null); }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <SectionHeader level="page" icon={Inbox} title="Unclassified"
        subtitle="Calls no method's rules matched. Assign one or reject as not QA-relevant — nothing here vanishes on its own." />

      {loadError && <Panel tone="inset"><p className="text-sm" style={{ color: 'var(--color-error-600)' }}>{loadError}</p></Panel>}
      {!loadError && calls === null && <Loading variant="table" rows={5} />}
      {!loadError && calls && calls.length === 0 && (
        <EmptyState icon={Inbox} title="Nothing unclassified" hint="Every incoming call has matched a method rule." />
      )}

      {!loadError && calls && calls.length > 0 && (
        <Panel pad="none">
          <TableScroll>
            <table className="w-full text-sm">
              <thead><tr style={{ color: 'var(--color-text-secondary)' }}>
                <th className="text-left font-semibold px-3 py-2">Company</th>
                <th className="text-left font-semibold px-3 py-2">Leg</th>
                <th className="text-left font-semibold px-3 py-2">Agent</th>
                <th className="text-left font-semibold px-3 py-2">Phone</th>
                <th className="text-left font-semibold px-3 py-2">Dispo</th>
                <th className="text-left font-semibold px-3 py-2">Received</th>
                <th className="px-3 py-2" />
              </tr></thead>
              <tbody>
                {calls.map(c => (
                  <tr key={c.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td className="px-3 py-2">{c.companies?.name || '—'}</td>
                    <td className="px-3 py-2">{c.leg || '—'}</td>
                    <td className="px-3 py-2">{c.agent_user || '—'}</td>
                    <td className="px-3 py-2">{c.customer_phone || '—'}</td>
                    <td className="px-3 py-2">{c.dispo_raw || '—'}</td>
                    <td className="px-3 py-2" style={{ color: 'var(--color-text-secondary)' }}>{new Date(c.created_at).toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5 justify-end">
                        <ThemedSelect variant="pill" value={picked[c.id] || ''} onChange={e => setPicked(p => ({ ...p, [c.id]: e.target.value }))} disabled={busyId === c.id}>
                          <option value="">Assign method…</option>
                          {methods.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                        </ThemedSelect>
                        <button className="btn btn-primary text-xs" disabled={busyId === c.id || !picked[c.id]} onClick={() => classify(c.id)}>Assign</button>
                        <button className="text-xs font-semibold flex items-center gap-1" style={{ color: 'var(--color-error-600)' }} disabled={busyId === c.id} onClick={() => reject(c.id)}>
                          <X size={13} />Not QA
                        </button>
                      </div>
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
