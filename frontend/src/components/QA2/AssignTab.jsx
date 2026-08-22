// ============================================================================
// AssignTab.jsx — the QA manager hands work to their agents. Backend:
// qa2Assign.js (/qa2/assign/workbench, /bulk, /return).
//
// Reads top to bottom as three questions, because that is the order a manager
// actually decides in:
//
//   1. WHICH WORK   company / date range / audio-ready — and every method chip
//                   shows how much work those filters leave, so the number on
//                   the chip is never a mystery
//   2. WHO REVIEWS  agent cards showing what each is ALLOWED to review and what
//                   they are already carrying
//   3. HOW MANY     a grid of reviewers x methods with a number in each cell
//
// The grid is the point. One agent and one method is a single cell; one agent
// across three methods is a row; four agents on one method is a column; the
// whole team across everything is the whole grid — all of it in one submit.
//
// A cell for a method the agent is not granted is not an input at all. It says
// "not granted" and points at where to change that, because a disabled box with
// no explanation is what makes people think software is broken. The backend
// refuses the same pairing independently — this is the explanation, not the
// enforcement.
//
// Preview runs the identical request with dry_run, so the numbers on screen are
// the server's own answer rather than the UI guessing.
// ============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Users2, ListChecks, Filter, PlayCircle, Send, Undo2, Info,
  CircleAlert, CircleCheck, Layers,
} from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';
import ThemedDate from '../UI/ThemedDate';
import { Panel, SectionHeader, EmptyState, Loading } from '../UI/kit';

const todayStr = () => new Date().toISOString().slice(0, 10);
const daysAgoStr = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

// Every refusal the backend can return, in words a manager can act on.
const REASON_TEXT = {
  method_not_granted: 'Not granted this method — grant it on the Team tab first',
  not_on_your_team: 'That reviewer is not on your team',
  unknown_method: 'That method no longer exists',
  zero_requested: 'No amount entered',
  no_company_overlap: 'None of the chosen companies are granted to this reviewer',
  no_work_available: 'No unassigned work matches these filters',
  partial_only_this_much_available: 'Only this many were available',
};
const reasonText = (r) => (r ? (REASON_TEXT[r] || r) : null);

export default function AssignTab() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(false);

  // ── filters: WHICH WORK ──────────────────────────────────────────────────
  const [companyIds, setCompanyIds] = useState([]);
  const [dateFrom, setDateFrom] = useState(daysAgoStr(7));
  const [dateTo, setDateTo] = useState(todayStr());
  const [requireRecording, setRequireRecording] = useState(true);
  const [minTalk, setMinTalk] = useState(0);

  // ── selection + the matrix ───────────────────────────────────────────────
  const [pickedMethods, setPickedMethods] = useState([]);
  const [pickedAgents, setPickedAgents] = useState([]);
  const [counts, setCounts] = useState({});          // `${agentId}|${methodId}` -> number
  const [preview, setPreview] = useState(null);
  const [lastResult, setLastResult] = useState(null);

  const companyKey = companyIds.join(',');
  const load = useCallback(() => {
    setLoadError(null);
    const params = {
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      require_recording: requireRecording ? undefined : 'false',
      min_talk_sec: minTalk || undefined,
      company_ids: companyKey || undefined,
    };
    client.get('qa2/assign/workbench', { params })
      .then(r => setData(r.data))
      .catch(e => setLoadError(e.response?.data?.error || 'Could not load the workbench'));
  }, [dateFrom, dateTo, requireRecording, minTalk, companyKey]);

  useEffect(() => { load(); }, [load]);

  const methods = data?.methods || [];
  const agents = data?.agents || [];
  const companies = data?.companies || [];

  const grantedSet = useMemo(() => {
    const m = new Map();
    agents.forEach(a => m.set(a.agent_id, new Set(a.method_ids || [])));
    return m;
  }, [agents]);

  const isGranted = (agentId, methodId) => !!grantedSet.get(agentId)?.has(methodId);

  const key = (a, m) => `${a}|${m}`;
  const setCount = (a, m, v) => {
    const n = Math.max(0, parseInt(v, 10) || 0);
    setCounts(prev => ({ ...prev, [key(a, m)]: n }));
    setPreview(null);
  };

  const toggle = (arr, setArr, id) => {
    setArr(arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id]);
    setPreview(null);
  };

  // Allocations = every granted cell carrying a number. Ungranted cells are
  // never sent: the backend would refuse them anyway, and a request full of
  // rows that can only fail makes the result strip useless.
  const allocations = useMemo(() => {
    const out = [];
    pickedAgents.forEach(a => pickedMethods.forEach(m => {
      const n = counts[key(a, m)] || 0;
      if (n > 0 && grantedSet.get(a)?.has(m)) out.push({ agent_id: a, method_id: m, count: n });
    }));
    return out;
  }, [pickedAgents, pickedMethods, counts, grantedSet]);

  const totalRequested = allocations.reduce((n, a) => n + a.count, 0);

  const body = () => ({
    allocations,
    company_ids: companyIds,
    date_from: dateFrom || null,
    date_to: dateTo || null,
    require_recording: requireRecording,
    min_talk_sec: minTalk || 0,
  });

  const runPreview = () => {
    if (!allocations.length) return toast.error('Enter how many calls to hand out first');
    setBusy(true);
    client.post('qa2/assign/bulk', { ...body(), dry_run: true })
      .then(r => { setPreview(r.data); setLastResult(null); })
      .catch(e => toast.error(e.response?.data?.error || 'Preview failed'))
      .finally(() => setBusy(false));
  };

  const runAssign = () => {
    if (!allocations.length) return toast.error('Enter how many calls to hand out first');
    setBusy(true);
    client.post('qa2/assign/bulk', body())
      .then(r => {
        setLastResult(r.data);
        setPreview(null);
        const n = r.data.total_assigned;
        if (n) toast.success(`Assigned ${n} call${n === 1 ? '' : 's'}`);
        else toast.error('Nothing was assigned — see the reasons below');
        setCounts({});
        load();
      })
      .catch(e => toast.error(e.response?.data?.error || 'Assign failed'))
      .finally(() => setBusy(false));
  };

  const returnWork = (agentId, agentName) => {
    if (!window.confirm(`Send ${agentName}'s un-started work back to the pool? Anything already in review stays with them.`)) return;
    client.post('qa2/assign/return', { agent_id: agentId })
      .then(r => { toast.success(`${r.data.returned} returned to the pool`); load(); })
      .catch(e => toast.error(e.response?.data?.error || 'Could not return the work'));
  };

  // Quick fills. "Each" puts N in every granted cell; "Split" divides a
  // method's available work across the reviewers who can actually take it —
  // the two things managers do by hand every morning.
  const fillEach = (n) => {
    const next = { ...counts };
    pickedAgents.forEach(a => pickedMethods.forEach(m => { if (isGranted(a, m)) next[key(a, m)] = n; }));
    setCounts(next); setPreview(null);
  };
  const fillSplit = () => {
    const next = { ...counts };
    pickedMethods.forEach(m => {
      const eligible = pickedAgents.filter(a => isGranted(a, m));
      if (!eligible.length) return;
      const avail = methods.find(x => x.id === m)?.available || 0;
      const each = Math.floor(avail / eligible.length);
      eligible.forEach(a => { next[key(a, m)] = each; });
    });
    setCounts(next); setPreview(null);
  };
  const clearAll = () => { setCounts({}); setPreview(null); setLastResult(null); };

  if (loadError) return <EmptyState icon={CircleAlert} title="Could not load" hint={loadError} />;
  if (!data) return <Loading />;

  const resultRows = (preview || lastResult)?.results || [];

  return (
    <div className="space-y-4">

      {/* ── 1. WHICH WORK ─────────────────────────────────────────────── */}
      <Panel>
        <SectionHeader
          icon={Filter}
          title="1. Which work"
          subtitle="Narrows the pool that every method count and every assign below draws from."
        />

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mt-3">
          <label className="text-sm">
            <span className="block mb-1" style={{ color: 'var(--color-text-secondary)' }}>Calls from</span>
            <ThemedDate value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="block mb-1" style={{ color: 'var(--color-text-secondary)' }}>Calls to</span>
            <ThemedDate value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="block mb-1" style={{ color: 'var(--color-text-secondary)' }}>Minimum talk time (seconds)</span>
            <input
              type="number" min="0" value={minTalk}
              onChange={e => setMinTalk(Math.max(0, parseInt(e.target.value, 10) || 0))}
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
            />
            <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              Skips very short calls. 0 keeps everything.
            </span>
          </label>
          <label className="text-sm flex flex-col justify-center">
            <span className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={requireRecording} onChange={e => { setRequireRecording(e.target.checked); setPreview(null); }} />
              <span style={{ color: 'var(--color-text)' }}>Only calls whose audio is ready</span>
            </span>
            <span className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>
              On: nobody opens a review with nothing to listen to. Off: includes calls still being fetched.
            </span>
          </label>
        </div>

        {companies.length > 1 && (
          <div className="mt-4">
            <div className="text-sm mb-2" style={{ color: 'var(--color-text-secondary)' }}>
              Companies — none selected means all of yours
            </div>
            <div className="flex flex-wrap gap-2">
              {companies.map(c => {
                const on = companyIds.includes(c.id);
                return (
                  <button
                    key={c.id} onClick={() => toggle(companyIds, setCompanyIds, c.id)}
                    className="px-3 py-1.5 rounded-full text-sm transition"
                    style={{
                      background: on ? 'var(--color-primary, #2563eb)' : 'var(--color-surface)',
                      color: on ? 'var(--color-text-inverse)' : 'var(--color-text)',
                      border: '1px solid var(--color-border)',
                    }}
                  >{c.name}</button>
                );
              })}
            </div>
          </div>
        )}
      </Panel>

      {/* ── 2. METHODS ────────────────────────────────────────────────── */}
      <Panel>
        <SectionHeader
          icon={ListChecks}
          title="2. Which methods"
          subtitle="The number is unassigned work matching the filters above — exactly what an assign would draw from."
        />
        <div className="flex flex-wrap gap-3 mt-3">
          {methods.map(m => {
            const on = pickedMethods.includes(m.id);
            return (
              <button
                key={m.id} onClick={() => toggle(pickedMethods, setPickedMethods, m.id)}
                className="rounded-xl px-4 py-3 text-left min-w-[170px] transition"
                style={{
                  background: on ? 'var(--color-primary, #2563eb)' : 'var(--color-surface)',
                  color: on ? 'var(--color-text-inverse)' : 'var(--color-text)',
                  border: '1px solid var(--color-border)',
                }}
              >
                <div className="text-sm font-medium">{m.name}</div>
                <div className="text-2xl font-semibold leading-tight">{m.available}</div>
                <div className="text-xs opacity-80">
                  ready to assign
                  {m.awaiting_audio > 0 && ` · ${m.awaiting_audio} still fetching audio`}
                </div>
              </button>
            );
          })}
          {!methods.length && <EmptyState icon={Layers} title="No active methods" hint="Create one on the Methods tab." />}
        </div>
      </Panel>

      {/* ── 3. AGENTS ─────────────────────────────────────────────────── */}
      <Panel>
        <SectionHeader
          icon={Users2}
          title="3. Which reviewers"
          subtitle="Each card shows what that reviewer is allowed to review and what they are already holding."
        />
        {!agents.length ? (
          <EmptyState icon={Users2} title="No agents on your team" hint="Compliance assigns agents to you on the Org tab." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 mt-3">
            {agents.map(a => {
              const on = pickedAgents.includes(a.agent_id);
              const granted = methods.filter(m => isGranted(a.agent_id, m.id));
              return (
                <div
                  key={a.agent_id}
                  className="rounded-xl p-3 cursor-pointer transition"
                  onClick={() => toggle(pickedAgents, setPickedAgents, a.agent_id)}
                  style={{
                    background: 'var(--color-surface)',
                    border: `2px solid ${on ? 'var(--color-primary, #2563eb)' : 'var(--color-border)'}`,
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium" style={{ color: 'var(--color-text)' }}>{a.name}</span>
                    <input type="checkbox" checked={on} readOnly className="pointer-events-none" />
                  </div>
                  <div className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                    {a.workload.open} waiting · {a.workload.in_review} in review · {a.workload.done} done
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {granted.length ? granted.map(m => (
                      <span key={m.id} className="text-xs px-2 py-0.5 rounded-full"
                        style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                        {m.name}
                      </span>
                    )) : (
                      <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                        No methods granted yet — Team tab
                      </span>
                    )}
                  </div>
                  {a.workload.open > 0 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); returnWork(a.agent_id, a.name); }}
                      className="mt-2 text-xs flex items-center gap-1 hover:underline"
                      style={{ color: 'var(--color-text-secondary)' }}
                    >
                      <Undo2 size={12} /> return un-started work
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* ── 4. THE MATRIX ─────────────────────────────────────────────── */}
      {pickedAgents.length > 0 && pickedMethods.length > 0 && (
        <Panel>
          <SectionHeader
            icon={Send}
            title="4. How many each"
            subtitle="A number in a cell is how many calls of that method go to that reviewer."
          />

          <div className="flex flex-wrap gap-2 my-3">
            {[10, 25, 50].map(n => (
              <button key={n} onClick={() => fillEach(n)}
                className="px-3 py-1.5 rounded-lg text-sm"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                {n} each
              </button>
            ))}
            <button onClick={fillSplit}
              className="px-3 py-1.5 rounded-lg text-sm"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
              Split everything evenly
            </button>
            <button onClick={clearAll}
              className="px-3 py-1.5 rounded-lg text-sm"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
              Clear
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ color: 'var(--color-text)' }}>
              <thead>
                <tr>
                  <th className="text-left p-2" style={{ color: 'var(--color-text-secondary)' }}>Reviewer</th>
                  {pickedMethods.map(mid => {
                    const m = methods.find(x => x.id === mid);
                    return (
                      <th key={mid} className="text-left p-2" style={{ color: 'var(--color-text-secondary)' }}>
                        {m?.name}
                        <div className="text-xs font-normal">{m?.available} available</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {pickedAgents.map(aid => {
                  const a = agents.find(x => x.agent_id === aid);
                  return (
                    <tr key={aid} style={{ borderTop: '1px solid var(--color-border)' }}>
                      <td className="p-2 font-medium">{a?.name}</td>
                      {pickedMethods.map(mid => {
                        const ok = isGranted(aid, mid);
                        return (
                          <td key={mid} className="p-2">
                            {ok ? (
                              <input
                                type="number" min="0" value={counts[key(aid, mid)] ?? ''}
                                onChange={e => setCount(aid, mid, e.target.value)}
                                placeholder="0"
                                className="w-24 rounded-lg px-2 py-1.5"
                                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                              />
                            ) : (
                              <span className="text-xs flex items-center gap-1" style={{ color: 'var(--color-text-secondary)' }} title="Grant this method on the Team tab">
                                <Info size={12} /> not granted
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-3 mt-4">
            <button
              onClick={runPreview} disabled={busy || !allocations.length}
              className="px-4 py-2 rounded-lg text-sm flex items-center gap-2 disabled:opacity-50"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
            >
              <PlayCircle size={16} /> Preview
            </button>
            <button
              onClick={runAssign} disabled={busy || !allocations.length}
              className="px-4 py-2 rounded-lg text-sm flex items-center gap-2 disabled:opacity-50"
              style={{ background: 'var(--color-primary, #2563eb)', color: 'var(--color-text-inverse)', border: '1px solid var(--color-border)' }}
            >
              <Send size={16} /> Assign {totalRequested || ''}
            </button>
            <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              Preview asks the server what it would hand out, and changes nothing.
            </span>
          </div>
        </Panel>
      )}

      {/* ── result strip ──────────────────────────────────────────────── */}
      {resultRows.length > 0 && (
        <Panel>
          <SectionHeader
            icon={preview ? PlayCircle : CircleCheck}
            title={preview ? 'Preview — nothing assigned yet' : 'Assigned'}
            subtitle={preview
              ? `Would hand out ${preview.total_assigned} call(s).`
              : `Handed out ${lastResult?.total_assigned ?? 0} call(s).`}
          />
          <div className="mt-3 space-y-1">
            {resultRows.map((r, i) => (
              <div key={`${r.agent_id}-${r.method_id}-${i}`} className="flex flex-wrap items-center gap-2 text-sm py-1"
                style={{ borderTop: i ? '1px solid var(--color-border)' : 'none' }}>
                <span className="font-medium" style={{ color: 'var(--color-text)' }}>{r.agent_name || r.agent_id}</span>
                <span style={{ color: 'var(--color-text-secondary)' }}>{r.method_code}</span>
                <span style={{ color: 'var(--color-text)' }}>{r.assigned} of {r.requested}</span>
                {r.reason && (
                  <span className="text-xs flex items-center gap-1" style={{ color: 'var(--color-text-secondary)' }}>
                    <CircleAlert size={12} /> {reasonText(r.reason)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
