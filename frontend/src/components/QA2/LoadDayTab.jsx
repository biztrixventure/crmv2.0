// ============================================================================
// LoadDayTab.jsx — a QA manager picks a company + ANY past date, pulls that
// day's CRM records on demand (POST /qa2/team/load-day — the manual
// counterpart to the scheduler's automatic "yesterday" pull, same underlying
// populateCrmDay function), browses what landed, and hand-assigns selected
// calls to one or more of their own agents (round-robin across however many
// agents are picked). Backend: qa2Team.js.
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import { CalendarClock, Download, Users2, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';
import ThemedSelect from '../UI/Select';
import ThemedDate from '../UI/ThemedDate';
import ColumnHeader from '../UI/ColumnHeader';
import { useTableQuery, useAbortable, isCanceled } from '../../hooks/useTableQuery';
import { Panel, SectionHeader, TableScroll, EmptyState, Loading } from '../UI/kit';

const LEG_OPTIONS = [{ value: 'fronter', label: 'Fronter' }, { value: 'closer', label: 'Closer' }];
const REC_OPTIONS = [
  { value: 'pending', label: 'Pending' }, { value: 'found', label: 'Found' },
  { value: 'missing', label: 'Missing' }, { value: 'error', label: 'Error' },
];
const th = 'text-left font-semibold px-3 py-2';

export default function LoadDayTab({ scope }) {
  const [companies, setCompanies] = useState([]);
  const [companyId, setCompanyId] = useState('');
  const [date, setDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [calls, setCalls] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [columns, setColumns] = useState({});
  const [methodOptions, setMethodOptions] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [agents, setAgents] = useState([]);
  const [pickedAgents, setPickedAgents] = useState([]);
  const [assigning, setAssigning] = useState(false);

  const tq = useTableQuery({ scope: 'qa2:loadday', columns, defaultSort: { by: 'call_at', dir: 'desc' } });
  const abortable = useAbortable();

  const myCompanyIds = scope?.operationalCompanyIds === 'all' ? null : (scope?.operationalCompanyIds || []);
  useEffect(() => {
    client.get('compliance/companies').then(r => {
      const all = r.data.companies || [];
      setCompanies(myCompanyIds ? all.filter(c => myCompanyIds.includes(c.id)) : all);
    }).catch(() => {});
    client.get('qa2/methods').then(r => setMethodOptions((r.data.methods || []).map(m => ({ value: m.id, label: m.label })))).catch(() => {});
    client.get('qa2/team/roster').then(r => setAgents(r.data.agents || [])).catch(() => {});
  }, [myCompanyIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchCalls = useCallback(() => {
    if (!companyId || !date) return;
    setLoadError(null);
    client.get('qa2/team/day-calls', { params: { company_id: companyId, date, ...tq.params }, signal: abortable() })
      .then(r => { setCalls(r.data.calls || []); if (r.data.columns) setColumns(r.data.columns); setSelected(new Set()); })
      .catch(e => { if (!isCanceled(e)) setLoadError(e.response?.data?.error || 'Could not load this day'); });
  }, [companyId, date, tq.params, abortable]);
  useEffect(() => { fetchCalls(); }, [tq.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadDay = async () => {
    if (!companyId || !date) return toast.error('Pick a company and a date');
    setLoading(true);
    try {
      const r = await client.post('qa2/team/load-day', { company_id: companyId, date });
      toast.success(r.data.created ? `Pulled ${r.data.created} new call(s) for ${date}` : `Already up to date for ${date}`);
      fetchCalls();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not load this day'); }
    finally { setLoading(false); }
  };

  const repairDay = async () => {
    if (!companyId || !date) return toast.error('Pick a company and a date');
    setRepairing(true);
    try {
      const r = await client.post('qa2/team/repair-day', { company_id: companyId, date });
      toast.success(r.data.repaired ? `Fixed ${r.data.repaired} call(s) — the recording poller will pick them up within a minute` : 'Nothing to repair for this day');
      fetchCalls();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not repair this day'); }
    finally { setRepairing(false); }
  };

  const toggleOne = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(prev => (prev.size === (calls || []).length ? new Set() : new Set((calls || []).map(c => c.id))));

  const toggleAgent = (id) => setPickedAgents(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  const assign = async () => {
    if (!selected.size) return toast.error('Select at least one call');
    if (!pickedAgents.length) return toast.error('Pick at least one agent to assign to');
    setAssigning(true);
    try {
      const r = await client.post('qa2/team/bulk-assign', { call_ids: [...selected], agent_ids: pickedAgents });
      toast.success(`Assigned ${r.data.assigned}${r.data.skipped ? `, skipped ${r.data.skipped} already-assigned` : ''}`);
      fetchCalls();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not assign'); }
    finally { setAssigning(false); }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <SectionHeader level="page" icon={CalendarClock} title="Load a day"
        subtitle="Pull any past date's transfers/sales into QA v2 on demand, then hand-assign specific calls to one or more agents." />

      <Panel className="flex flex-wrap items-end gap-2">
        <div className="min-w-[200px]">
          <ThemedSelect value={companyId} onChange={e => setCompanyId(e.target.value)}>
            <option value="">Pick a company…</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </ThemedSelect>
        </div>
        <ThemedDate value={date} onChange={e => setDate(e.target.value)} />
        <button className="btn text-sm" style={{ border: '1px solid var(--color-border)' }} disabled={!companyId || !date} onClick={fetchCalls}>Browse</button>
        <button className="btn btn-primary text-sm flex items-center gap-1.5" disabled={loading || !companyId || !date} onClick={loadDay}>
          <Download size={14} />{loading ? 'Pulling…' : 'Pull this day from the CRM'}
        </button>
        <button className="btn text-sm flex items-center gap-1.5" style={{ border: '1px solid var(--color-border)' }}
          disabled={repairing || !companyId || !date} onClick={repairDay} title="Fixes closer-leg calls that never got a recording lookup because they were missing a dialer code">
          <Wrench size={14} />{repairing ? 'Repairing…' : 'Repair missing recordings'}
        </button>
      </Panel>

      {loadError && <Panel tone="inset"><p className="text-sm" style={{ color: 'var(--color-error-600)' }}>{loadError}</p></Panel>}
      {!loadError && companyId && date && calls === null && <Loading variant="table" rows={4} />}
      {!loadError && calls && calls.length === 0 && (
        <EmptyState icon={CalendarClock} title="Nothing here yet" hint={`No classified calls for this company on ${date} — try "Pull this day from the CRM", or check your filters.`} />
      )}

      {!loadError && calls && calls.length > 0 && (
        <>
          <Panel pad="none">
            <TableScroll>
              <table className="w-full text-sm">
                <thead><tr style={{ color: 'var(--color-text-secondary)' }}>
                  <th className="px-3 py-2"><input type="checkbox" checked={selected.size === calls.length} onChange={toggleAll} /></th>
                  <ColumnHeader tq={tq} colKey="method" label="Method" options={methodOptions} className={th} />
                  <ColumnHeader tq={tq} colKey="leg" label="Leg" options={LEG_OPTIONS} className={th} />
                  <th className={th}>Agent</th>
                  <th className={th}>Dispo</th>
                  <ColumnHeader tq={tq} colKey="recording_state" label="Recording" options={REC_OPTIONS} className={th} />
                  <ColumnHeader tq={tq} colKey="call_at" label="Time" className={th} />
                  <th className={th}>Assignment</th>
                </tr></thead>
                <tbody>
                  {calls.map(c => (
                    <tr key={c.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                      <td className="px-3 py-2"><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleOne(c.id)} /></td>
                      <td className="px-3 py-2">{c.qa2_method?.label || '—'}</td>
                      <td className="px-3 py-2">{c.leg || '—'}</td>
                      <td className="px-3 py-2">{c.agent_name || '—'}</td>
                      <td className="px-3 py-2">{c.dispo_raw || '—'}</td>
                      <td className="px-3 py-2">{c.recording_state || '—'}</td>
                      <td className="px-3 py-2">{c.call_at ? new Date(c.call_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                      <td className="px-3 py-2">
                        {c.assignment_status === 'unassigned'
                          ? <span style={{ color: 'var(--color-text-tertiary)' }}>Unassigned</span>
                          : <span>{c.assigned_to_name || '—'} <span style={{ color: 'var(--color-text-tertiary)' }}>({c.assignment_status})</span></span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </Panel>

          <Panel className="space-y-3">
            <SectionHeader level="section" icon={Users2} title="Assign selected"
              subtitle={`${selected.size} call(s) selected — picking more than one agent distributes them round-robin, it does not send every call to every agent.`} />
            {agents.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No agents on your team yet — compliance assigns agents to a manager on the Org tab.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {agents.map(a => {
                  const on = pickedAgents.includes(a.agent_id);
                  return (
                    <button key={a.agent_id} type="button" onClick={() => toggleAgent(a.agent_id)}
                      className="text-xs font-semibold px-2.5 py-1.5 rounded-lg"
                      style={{
                        border: '1px solid ' + (on ? 'var(--color-primary-600)' : 'var(--color-border)'),
                        background: on ? 'color-mix(in srgb, var(--color-primary-600) 12%, transparent)' : 'var(--color-bg)',
                        color: on ? 'var(--color-primary-600)' : 'var(--color-text)',
                      }}>
                      {a.name}
                    </button>
                  );
                })}
              </div>
            )}
            <button className="btn btn-primary text-sm" disabled={assigning || !selected.size || !pickedAgents.length} onClick={assign}>
              {assigning ? 'Assigning…' : `Assign ${selected.size || ''} call(s)`}
            </button>
          </Panel>
        </>
      )}
    </div>
  );
}
