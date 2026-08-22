// ============================================================================
// LoadDayTab.jsx — one place for a day's QA work: pull it from the CRM, see
// what landed, and hand it out. Backend: qa2Team.js + qa2Assign.js.
//
// Assigning lives HERE rather than in a tab of its own. A manager pulls a day
// and hands that day out in the same motion; splitting those across two tabs
// meant picking the same company and the same date twice to do one job.
//
// Two ways to hand work out, because managers do both:
//
//   By reviewer   a grid of reviewers x methods — "fifty TRA to Ali, thirty
//                 Unclosed to Sara" — the whole team in one submit, without
//                 ticking three hundred rows
//   Picked rows   tick specific calls in the table and send those exact ones,
//                 for a follow-up or a complaint
//
// Neither will give an agent a method they are not granted. The grid shows
// "not granted" in the cell instead of an input; the row mode reports how many
// it had to skip for that reason. The server re-checks either way — what is on
// screen is the explanation, not the enforcement.
// ============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import { CalendarClock, Download, Users2, Wrench, Grid3x3, ListChecks, Info, Undo2 } from 'lucide-react';
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

// Every refusal the assign endpoint can return, in words a manager can act on.
const REASON_TEXT = {
  method_not_granted: 'Not granted this method — grant it on the Team tab',
  not_on_your_team: 'Not on your team',
  unknown_method: 'That method no longer exists',
  zero_requested: 'No amount entered',
  no_company_overlap: 'This company is not granted to this reviewer',
  no_work_available: 'No unassigned work left for this day',
  partial_only_this_much_available: 'Only this many were left',
};
const reasonText = (r) => (r ? (REASON_TEXT[r] || r) : null);

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
  const [methodTab, setMethodTab] = useState('all');
  const [selected, setSelected] = useState(new Set());
  const [assigning, setAssigning] = useState(false);

  // ── assignment state ─────────────────────────────────────────────────────
  const [mode, setMode] = useState('grid');            // 'grid' | 'rows'
  const [board, setBoard] = useState(null);            // /qa2/assign/workbench
  const [pickedAgents, setPickedAgents] = useState([]);
  const [counts, setCounts] = useState({});            // `${agentId}|${methodId}` -> number
  const [result, setResult] = useState(null);

  const tq = useTableQuery({ scope: 'qa2:loadday', columns, defaultSort: { by: 'call_at', dir: 'desc' } });

  // METHOD TABS. A pulled day is one long list mixing TRA, Unclosed and Closed,
  // and a manager assigns per method — different scorecards, often different
  // agents. Splitting client-side keeps the single day-calls request: the rows
  // are already in memory, so switching tabs costs nothing.
  const methodOf = (c) => c.qa2_method?.label || 'Unclassified';
  const methodTabs = (() => {
    const seen = new Map();
    (calls || []).forEach(c => { const k = methodOf(c); seen.set(k, (seen.get(k) || 0) + 1); });
    return [{ key: 'all', label: 'All', n: (calls || []).length },
            ...[...seen.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ key: k, label: k, n }))];
  })();
  const visibleCalls = (calls || []).filter(c => methodTab === 'all' || methodOf(c) === methodTab);
  const abortable = useAbortable();

  const myCompanyIds = scope?.operationalCompanyIds === 'all' ? null : (scope?.operationalCompanyIds || []);
  useEffect(() => {
    client.get('compliance/companies').then(r => {
      const all = r.data.companies || [];
      setCompanies(myCompanyIds ? all.filter(c => myCompanyIds.includes(c.id)) : all);
    }).catch(() => {});
    client.get('qa2/methods').then(r => setMethodOptions((r.data.methods || []).map(m => ({ value: m.id, label: m.label })))).catch(() => {});
  }, [myCompanyIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // The board carries the team, their grants, their current workload and how
  // much unassigned work this company+day holds per method — scoped to exactly
  // what is on screen, so the number on a column is the number an assign uses.
  const loadBoard = useCallback(() => {
    if (!companyId || !date) { setBoard(null); return; }
    client.get('qa2/assign/workbench', {
      params: { company_ids: companyId, date_from: date, date_to: date },
    }).then(r => setBoard(r.data)).catch(() => setBoard(null));
  }, [companyId, date]);

  const fetchCalls = useCallback(() => {
    if (!companyId || !date) return;
    setLoadError(null);
    client.get('qa2/team/day-calls', { params: { company_id: companyId, date, ...tq.params }, signal: abortable() })
      .then(r => { setCalls(r.data.calls || []); if (r.data.columns) setColumns(r.data.columns); setSelected(new Set()); })
      .catch(e => { if (!isCanceled(e)) setLoadError(e.response?.data?.error || 'Could not load this day'); });
    loadBoard();
  }, [companyId, date, tq.params, abortable, loadBoard]);
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
  // Select-all follows the METHOD TAB you are on, not the whole day — picking
  // "all" while filtered to TRA and getting Unclosed calls assigned too would be
  // a nasty surprise, and assignment is per method.
  const toggleAll = () => setSelected(prev => (prev.size === visibleCalls.length ? new Set() : new Set(visibleCalls.map(c => c.id))));

  const toggleAgent = (id) => {
    setPickedAgents(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
    setResult(null);
  };

  // ── grants ───────────────────────────────────────────────────────────────
  const agents = board?.agents || [];
  const methods = useMemo(() => board?.methods || [], [board]);
  const grantedSet = useMemo(() => {
    const m = new Map();
    agents.forEach(a => m.set(a.agent_id, new Set(a.method_ids || [])));
    return m;
  }, [agents]);
  const isGranted = (agentId, methodId) => !!grantedSet.get(agentId)?.has(methodId);

  // Only methods this day actually holds work for — an empty column is noise.
  const gridMethods = useMemo(
    () => methods.filter(m => m.available > 0 || methods.length <= 3),
    [methods],
  );

  const key = (a, m) => `${a}|${m}`;
  const setCount = (a, m, v) => {
    setCounts(prev => ({ ...prev, [key(a, m)]: Math.max(0, parseInt(v, 10) || 0) }));
    setResult(null);
  };

  const allocations = useMemo(() => {
    const out = [];
    pickedAgents.forEach(a => gridMethods.forEach(m => {
      const n = counts[key(a, m.id)] || 0;
      if (n > 0 && grantedSet.get(a)?.has(m.id)) out.push({ agent_id: a, method_id: m.id, count: n });
    }));
    return out;
  }, [pickedAgents, gridMethods, counts, grantedSet]);

  const totalRequested = allocations.reduce((n, a) => n + a.count, 0);

  const fillEach = (n) => {
    const next = { ...counts };
    pickedAgents.forEach(a => gridMethods.forEach(m => { if (isGranted(a, m.id)) next[key(a, m.id)] = n; }));
    setCounts(next); setResult(null);
  };
  const fillSplit = () => {
    const next = { ...counts };
    gridMethods.forEach(m => {
      const eligible = pickedAgents.filter(a => isGranted(a, m.id));
      if (!eligible.length) return;
      const each = Math.floor((m.available || 0) / eligible.length);
      eligible.forEach(a => { next[key(a, m.id)] = each; });
    });
    setCounts(next); setResult(null);
  };

  const assignGrid = async () => {
    if (!allocations.length) return toast.error('Enter how many calls each reviewer gets');
    setAssigning(true);
    try {
      const r = await client.post('qa2/assign/bulk', {
        allocations,
        company_ids: [companyId],
        date_from: date,
        date_to: date,
        require_recording: true,
      });
      setResult(r.data);
      if (r.data.total_assigned) toast.success(`Assigned ${r.data.total_assigned} call(s)`);
      else toast.error('Nothing was assigned — see the reasons below');
      setCounts({});
      fetchCalls();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not assign'); }
    finally { setAssigning(false); }
  };

  const assignRows = async () => {
    if (!selected.size) return toast.error('Tick at least one call in the table');
    if (!pickedAgents.length) return toast.error('Pick at least one reviewer');
    setAssigning(true);
    try {
      const r = await client.post('qa2/team/bulk-assign', { call_ids: [...selected], agent_ids: pickedAgents });
      const bits = [`Assigned ${r.data.assigned}`];
      if (r.data.skipped) bits.push(`${r.data.skipped} already assigned`);
      if (r.data.skipped_not_granted) bits.push(`${r.data.skipped_not_granted} skipped — nobody picked is granted that method`);
      toast.success(bits.join(' · '));
      fetchCalls();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not assign'); }
    finally { setAssigning(false); }
  };

  const returnWork = async (agentId, agentName) => {
    if (!window.confirm(`Send ${agentName}'s un-started work back to the pool? Anything already in review stays with them.`)) return;
    try {
      const r = await client.post('qa2/assign/return', { agent_id: agentId });
      toast.success(`${r.data.returned} returned to the pool`);
      loadBoard();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not return the work'); }
  };

  const chip = (on) => ({
    border: '1px solid ' + (on ? 'var(--color-primary-600)' : 'var(--color-border)'),
    background: on ? 'color-mix(in srgb, var(--color-primary-600) 12%, transparent)' : 'var(--color-bg)',
    color: on ? 'var(--color-primary-600)' : 'var(--color-text)',
  });

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <SectionHeader level="page" icon={CalendarClock} title="Load a day"
        subtitle="Pull any past date's transfers and sales into QA, see what landed, and hand it out to your reviewers." />

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

      {/* ── HAND IT OUT ───────────────────────────────────────────────── */}
      {!loadError && calls && calls.length > 0 && (
        <Panel className="space-y-4">
          <SectionHeader level="section" icon={Users2} title="Hand this day out"
            subtitle="Pick your reviewers, then choose how much each one gets." />

          {agents.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
              No agents on your team yet — compliance assigns agents to a manager on the Org tab.
            </p>
          ) : (
            <>
              {/* reviewers */}
              <div className="flex flex-wrap gap-2">
                {agents.map(a => {
                  const on = pickedAgents.includes(a.agent_id);
                  const granted = methods.filter(m => isGranted(a.agent_id, m.id));
                  return (
                    <div key={a.agent_id} role="button" tabIndex={0}
                      onClick={() => toggleAgent(a.agent_id)}
                      onKeyDown={(e) => { if (e.key === 'Enter') toggleAgent(a.agent_id); }}
                      className="text-left px-3 py-2 rounded-xl cursor-pointer" style={chip(on)}>
                      <div className="text-sm font-semibold">{a.name}</div>
                      <div className="text-xs opacity-80">
                        {a.workload.open} waiting · {a.workload.in_review} in review
                      </div>
                      <div className="text-xs opacity-70">
                        {granted.length ? granted.map(m => m.name).join(' · ') : 'no methods granted yet'}
                      </div>
                      {a.workload.open > 0 && (
                        <span role="button" tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); returnWork(a.agent_id, a.name); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); returnWork(a.agent_id, a.name); } }}
                          className="text-xs mt-1 inline-flex items-center gap-1 hover:underline">
                          <Undo2 size={11} /> return un-started
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* how */}
              <div className="flex items-center gap-1 flex-wrap">
                {[
                  { key: 'grid', label: 'By reviewer', icon: Grid3x3 },
                  { key: 'rows', label: `Picked rows${selected.size ? ` (${selected.size})` : ''}`, icon: ListChecks },
                ].map(t => (
                  <button key={t.key} onClick={() => { setMode(t.key); setResult(null); }}
                    className="text-xs font-bold px-3 py-1.5 rounded-full transition-colors flex items-center gap-1.5"
                    style={{
                      background: mode === t.key ? 'var(--color-primary-600)' : 'var(--color-surface)',
                      color: mode === t.key ? '#fff' : 'var(--color-text-secondary)',
                      border: '1px solid var(--color-border)',
                    }}>
                    <t.icon size={12} /> {t.label}
                  </button>
                ))}
                <span className="text-xs ml-1" style={{ color: 'var(--color-text-tertiary)' }}>
                  {mode === 'grid'
                    ? 'Give each reviewer a number of calls per method.'
                    : 'Send the exact rows you tick in the table below.'}
                </span>
              </div>

              {/* ── grid mode ─────────────────────────────────────────── */}
              {mode === 'grid' && (pickedAgents.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Pick at least one reviewer above.</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    {[10, 25, 50].map(n => (
                      <button key={n} onClick={() => fillEach(n)} className="btn text-xs" style={{ border: '1px solid var(--color-border)' }}>{n} each</button>
                    ))}
                    <button onClick={fillSplit} className="btn text-xs" style={{ border: '1px solid var(--color-border)' }}>Split the day evenly</button>
                    <button onClick={() => { setCounts({}); setResult(null); }} className="btn text-xs" style={{ border: '1px solid var(--color-border)' }}>Clear</button>
                  </div>

                  <TableScroll>
                    <table className="w-full text-sm">
                      <thead><tr style={{ color: 'var(--color-text-secondary)' }}>
                        <th className={th}>Reviewer</th>
                        {gridMethods.map(m => (
                          <th key={m.id} className={th}>
                            {m.name}
                            <div className="text-xs font-normal opacity-70">{m.available} left today</div>
                          </th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {pickedAgents.map(aid => {
                          const a = agents.find(x => x.agent_id === aid);
                          return (
                            <tr key={aid} style={{ borderTop: '1px solid var(--color-border)' }}>
                              <td className="px-3 py-2 font-semibold">{a?.name}</td>
                              {gridMethods.map(m => (
                                <td key={m.id} className="px-3 py-2">
                                  {isGranted(aid, m.id) ? (
                                    <input type="number" min="0" placeholder="0"
                                      value={counts[key(aid, m.id)] ?? ''}
                                      onChange={e => setCount(aid, m.id, e.target.value)}
                                      className="w-24 rounded-lg px-2 py-1.5"
                                      style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
                                  ) : (
                                    <span className="text-xs flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}
                                      title="Grant this method on the Team tab">
                                      <Info size={12} /> not granted
                                    </span>
                                  )}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </TableScroll>

                  <button className="btn btn-primary text-sm" disabled={assigning || !allocations.length} onClick={assignGrid}>
                    {assigning ? 'Assigning…' : `Assign ${totalRequested || ''} call(s)`}
                  </button>
                </>
              ))}

              {/* ── rows mode ─────────────────────────────────────────── */}
              {mode === 'rows' && (
                <div className="space-y-2">
                  <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
                    {selected.size} row(s) ticked. More than one reviewer shares them out in turn — it does not send every
                    call to everyone. A call only goes to a reviewer granted its method.
                  </p>
                  <button className="btn btn-primary text-sm" disabled={assigning || !selected.size || !pickedAgents.length} onClick={assignRows}>
                    {assigning ? 'Assigning…' : `Assign ${selected.size || ''} picked call(s)`}
                  </button>
                </div>
              )}

              {/* ── what happened ─────────────────────────────────────── */}
              {result?.results?.length > 0 && (
                <div className="rounded-xl p-3" style={{ border: '1px solid var(--color-border)' }}>
                  <div className="text-sm font-semibold mb-1">Handed out {result.total_assigned} call(s)</div>
                  {result.results.map((r, i) => (
                    <div key={`${r.agent_id}-${r.method_id}-${i}`} className="flex flex-wrap items-center gap-2 text-sm py-0.5">
                      <span className="font-medium">{r.agent_name}</span>
                      <span style={{ color: 'var(--color-text-secondary)' }}>{r.method_code}</span>
                      <span>{r.assigned} of {r.requested}</span>
                      {r.reason && <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>— {reasonText(r.reason)}</span>}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </Panel>
      )}

      {!loadError && calls && calls.length > 0 && methodTabs.length > 2 && (
        <div className="flex items-center gap-1 flex-wrap">
          {methodTabs.map(t => (
            <button key={t.key} onClick={() => { setMethodTab(t.key); setSelected(new Set()); }}
              className="text-xs font-bold px-3 py-1.5 rounded-full transition-colors"
              style={{
                background: methodTab === t.key ? 'var(--color-primary-600)' : 'var(--color-surface)',
                color: methodTab === t.key ? '#fff' : 'var(--color-text-secondary)',
                border: '1px solid var(--color-border)',
              }}>
              {t.label} <span className="tabular-nums opacity-80">{t.n}</span>
            </button>
          ))}
        </div>
      )}

      {!loadError && calls && calls.length > 0 && (
        <Panel pad="none">
          <TableScroll>
            <table className="w-full text-sm">
              <thead><tr style={{ color: 'var(--color-text-secondary)' }}>
                <th className="px-3 py-2"><input type="checkbox" checked={visibleCalls.length > 0 && selected.size === visibleCalls.length} onChange={toggleAll} /></th>
                <ColumnHeader tq={tq} colKey="method" label="Method" options={methodOptions} className={th} />
                <ColumnHeader tq={tq} colKey="leg" label="Leg" options={LEG_OPTIONS} className={th} />
                <th className={th}>Agent</th>
                <th className={th}>Dispo</th>
                <ColumnHeader tq={tq} colKey="recording_state" label="Recording" options={REC_OPTIONS} className={th} />
                <ColumnHeader tq={tq} colKey="call_at" label="Time" className={th} />
                <th className={th}>Assignment</th>
              </tr></thead>
              <tbody>
                {visibleCalls.map(c => (
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
      )}
    </div>
  );
}
