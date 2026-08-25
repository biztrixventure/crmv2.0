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
import { CalendarClock, Download, Users2, Wrench, Grid3x3, ListChecks, Info, Undo2, UserMinus, X } from 'lucide-react';
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
  const [crm, setCrm] = useState(null);   // { transfers, sales } — the day's CRM ledger
  const [reviewerFilter, setReviewerFilter] = useState(null);   // agent_id → show only rows they hold
  const [selected, setSelected] = useState(new Set());
  const [assigning, setAssigning] = useState(false);

  // ── assignment state ─────────────────────────────────────────────────────
  const [mode, setMode] = useState('grid');            // 'grid' | 'rows'
  const [board, setBoard] = useState(null);            // /qa2/assign/workbench
  const [pickedAgents, setPickedAgents] = useState([]);
  const [counts, setCounts] = useState({});            // `${agentId}|${methodId}` -> number
  const [result, setResult] = useState(null);
  const [boardError, setBoardError] = useState(null);

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
  const visibleCalls = (calls || [])
    .filter(c => methodTab === 'all' || methodOf(c) === methodTab)
    .filter(c => !reviewerFilter || c.assigned_to === reviewerFilter);
  const abortable = useAbortable();

  // Persisted column filters, made visible — copied from PoolTab, same tq hook.
  const FILTER_LABELS = { method: 'Method', leg: 'Leg', recording_state: 'Recording', call_at: 'Time' };
  const OPTION_LOOKUP = { method: methodOptions, leg: LEG_OPTIONS, recording_state: REC_OPTIONS };
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
    setBoardError(null);
    client.get('qa2/assign/workbench', {
      params: { company_ids: companyId, date_from: date, date_to: date },
    })
      .then(r => setBoard(r.data))
      // Swallowing this was a trap of my own making: a failed board left the
      // panel showing "No agents on your team yet", which is a different
      // problem with a different fix, and every control below it then looked
      // broken rather than un-loaded.
      .catch(e => {
        setBoard(null);
        setBoardError(e.response?.data?.error || 'Could not load your reviewers');
      });
  }, [companyId, date]);

  const fetchCalls = useCallback(() => {
    if (!companyId || !date) return;
    setLoadError(null);
    client.get('qa2/team/day-calls', { params: { company_id: companyId, date, ...tq.params }, signal: abortable() })
      .then(r => { setCalls(r.data.calls || []); if (r.data.columns) setColumns(r.data.columns); setCrm(r.data.crm || null); setSelected(new Set()); })
      .catch(e => { if (!isCanceled(e)) setLoadError(e.response?.data?.error || 'Could not load this day'); });
    loadBoard();
  }, [companyId, date, tq.params, abortable, loadBoard]);
  // Picking a company and a date IS the request — the old flow made you press
  // Browse afterwards, so choosing both and seeing an empty screen looked like
  // a bug rather than a step you had not taken yet.
  useEffect(() => { fetchCalls(); }, [tq.version, companyId, date]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Both fills CAP at what the day actually holds. Filling "50 each" from a
  // method with 12 left used to write 50 into every box and then come back
  // having assigned 12 — the button looked broken when the shortfall was real.
  // They also say why nothing happened rather than silently doing nothing,
  // which is what made these read as dead buttons.
  const fillEach = (n) => {
    if (!pickedAgents.length) return toast.error('Pick a reviewer first');
    const next = { ...counts };
    let filled = 0;
    gridMethods.forEach(m => {
      const eligible = pickedAgents.filter(a => isGranted(a, m.id));
      if (!eligible.length) return;
      let left = m.available || 0;
      eligible.forEach(a => {
        const give = Math.min(n, left);
        left -= give;
        next[key(a, m.id)] = give;
        filled += give;
      });
    });
    setCounts(next); setResult(null);
    if (!filled) {
      toast.error(gridMethods.some(m => pickedAgents.some(a => isGranted(a, m.id)))
        ? 'Nothing left to hand out for this day'
        : 'Nobody picked is granted these methods — grant them on the Team tab');
    }
  };

  const fillSplit = () => {
    if (!pickedAgents.length) return toast.error('Pick a reviewer first');
    const next = { ...counts };
    let filled = 0;
    gridMethods.forEach(m => {
      const eligible = pickedAgents.filter(a => isGranted(a, m.id));
      if (!eligible.length) return;
      const avail = m.available || 0;
      const each = Math.floor(avail / eligible.length);
      // The remainder goes to the first few rather than being thrown away —
      // 7 calls across 2 reviewers is 4 and 3, not 3 and 3.
      let extra = avail - each * eligible.length;
      eligible.forEach(a => {
        const give = each + (extra > 0 ? 1 : 0);
        if (extra > 0) extra -= 1;
        next[key(a, m.id)] = give;
        filled += give;
      });
    });
    setCounts(next); setResult(null);
    if (!filled) {
      toast.error(gridMethods.some(m => pickedAgents.some(a => isGranted(a, m.id)))
        ? 'Nothing left to hand out for this day'
        : 'Nobody picked is granted these methods — grant them on the Team tab');
    }
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

  // Taking work BACK. A manager hands out a day and then someone calls in sick,
  // or the wrong person got it — so the same table that gave it out takes it
  // back. Only un-started work: a review already in progress keeps its owner,
  // which the server enforces too.
  const unassignOne = async (row) => {
    if (!row.assignment_id || !row.assigned_to) return;   // in the pool already — nothing to take back
    if (row.assignment_status && row.assignment_status !== 'pending'
        && !window.confirm(`${row.assigned_to_name} has already started this one. Take it back anyway?`)) return;
    try {
      await client.post(`qa2/assignments/${row.assignment_id}/unassign`);
      toast.success(`Taken back from ${row.assigned_to_name || 'the reviewer'}`);
      fetchCalls();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not take it back'); }
  };

  const unassignSelected = async () => {
    const rows = visibleCalls.filter(c => selected.has(c.id) && c.assignment_id);
    if (!rows.length) return toast.error('None of the ticked rows are assigned to anyone');
    if (!window.confirm(`Take ${rows.length} review(s) back off their reviewers?`)) return;
    setAssigning(true);
    let ok = 0, failed = 0;
    for (const r of rows) {
      try { await client.post(`qa2/assignments/${r.assignment_id}/unassign`); ok++; }
      catch { failed++; }
    }
    setAssigning(false);
    if (ok) toast.success(`Took back ${ok} review(s)${failed ? `, ${failed} could not be taken back` : ''}`);
    else toast.error('Could not take any of them back');
    fetchCalls();
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

      <Panel>
        {/* Labelled fields on their own line, actions on theirs. The old row put
            a select, a date and three buttons of different heights in one
            flex-end line, so nothing lined up and "Browse" sat between two
            actions that do something much bigger. */}
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="block mb-1 font-medium" style={{ color: 'var(--color-text-secondary)' }}>Company</span>
            <div className="min-w-[220px]">
              <ThemedSelect value={companyId} onChange={e => setCompanyId(e.target.value)}>
                <option value="">Pick a company…</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </ThemedSelect>
            </div>
          </label>
          <label className="text-sm">
            <span className="block mb-1 font-medium" style={{ color: 'var(--color-text-secondary)' }}>Day</span>
            <ThemedDate value={date} onChange={e => setDate(e.target.value)} />
          </label>
          <div className="flex items-center gap-2">
            <button className="btn btn-primary text-sm flex items-center gap-1.5 whitespace-nowrap"
              disabled={loading || !companyId || !date} onClick={loadDay}>
              <Download size={14} />{loading ? 'Pulling…' : 'Pull this day from the CRM'}
            </button>
            <button className="btn text-sm flex items-center gap-1.5 whitespace-nowrap"
              style={{ border: '1px solid var(--color-border)' }}
              disabled={repairing || !companyId || !date} onClick={repairDay}
              title="Some closer-leg calls arrive without a dialer code and never get a recording lookup. This finds them and re-arms the search.">
              <Wrench size={14} />{repairing ? 'Repairing…' : 'Retry missing recordings'}
            </button>
          </div>
        </div>
        <p className="text-xs mt-2" style={{ color: 'var(--color-text-tertiary)' }}>
          {!companyId || !date
            ? 'Pick a company and a day — the calls load on their own.'
            : 'Already-pulled calls show below. "Pull this day" fetches anything new from the CRM.'}
        </p>
      </Panel>

      {/* ACTIVE FILTERS, VISIBLY — same treatment PoolTab already has. Column
          filters persist per user, so one set last week still applies today, in
          EVERY company: switch company, pull the day, and only the filtered
          method shows, with nothing on screen saying why and no way back short
          of reopening each column menu. Each filter is now a removable chip
          plus one Clear all, shown whether or not any rows survived it. */}
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
      {!loadError && companyId && date && calls === null && <Loading variant="table" rows={4} />}
      {!loadError && calls && calls.length === 0 && (
        activeFilters.length > 0 ? (
          <EmptyState icon={CalendarClock} title="No calls match your filters"
            hint="This day may still have work — the filters above are hiding it."
            action={<button onClick={tq.clearAll} className="text-sm font-bold px-3 py-2 rounded-lg"
              style={{ background: 'var(--gradient-sidebar)', color: 'var(--color-text-inverse)' }}>Clear all filters</button>} />
        ) : (
          <EmptyState icon={CalendarClock} title="Nothing here yet" hint={`No classified calls for this company on ${date} — try "Pull this day from the CRM".`} />
        )
      )}

      {/* ── HAND IT OUT ───────────────────────────────────────────────── */}
      {!loadError && calls && calls.length > 0 && (
        <Panel className="space-y-4">
          <SectionHeader level="section" icon={Users2} title="Hand this day out"
            subtitle="Pick your reviewers, then choose how much each one gets." />

          {boardError ? (
            <p className="text-sm" style={{ color: 'var(--color-error-600)' }}>{boardError}</p>
          ) : agents.length === 0 ? (
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
                      {/* The three states a manager needs before handing out or
                          taking back: not started (safe to pull), in review (they
                          are on it), and done. "show their rows" filters the
                          table to this reviewer, where take-back is per row. */}
                      <div className="text-xs opacity-80">
                        <strong>{a.workload.open}</strong> waiting · <strong>{a.workload.in_review}</strong> in review · <strong>{a.workload.done}</strong> done
                      </div>
                      {(a.workload.open + a.workload.in_review) > 0 && (
                        <span role="button" tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); setReviewerFilter(reviewerFilter === a.agent_id ? null : a.agent_id); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setReviewerFilter(reviewerFilter === a.agent_id ? null : a.agent_id); } }}
                          className="text-xs mt-1 mr-3 inline-flex items-center gap-1 hover:underline">
                          {reviewerFilter === a.agent_id ? 'showing their rows — clear' : 'show their rows'}
                        </span>
                      )}
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
                    <span className="text-xs self-center" style={{ color: 'var(--color-text-tertiary)' }}>
                      {totalRequested} of {gridMethods.reduce((n, m) => n + (m.available || 0), 0)} left today allocated
                    </span>
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

      {!loadError && calls && calls.length > 0 && methodTab.toUpperCase().includes('TRA') && (
        <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          TRA is every transfer, so membership comes from the transfer existing — not from what the
          dispo says. "Latest dispo" is whatever last touched the record; "Closer dispo" is what the
          closer actually made of the lead, which is the one worth reading when you score a fronter.
        </p>
      )}

      {/* THE CRM LEDGER — the identity a manager reconciles against. It holds
          exactly here by construction (Unclosed is literally TRA − Closed on
          the CRM's own records). The pills below count PLAYABLE CALLS instead,
          which is a different number on purpose: a closer dials a lead twice,
          a re-transferred customer shares one recording, and some transfers
          never reach a closer — so calls can never equal transfers. */}
      {!loadError && crm && calls && calls.length > 0 && (
        <Panel tone="inset">
          <div className="flex items-center gap-4 flex-wrap text-sm">
            <span className="font-bold" style={{ color: 'var(--color-text)' }}>CRM day</span>
            <span>TRA (transfers) <strong>{crm.transfers}</strong></span>
            <span>− Closed (sales) <strong>{crm.sales}</strong></span>
            <span>= Unclosed <strong>{Math.max(0, crm.transfers - crm.sales)}</strong></span>
            <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              The tabs below count playable calls — re-transferred customers share one recording, so calls can be fewer than transfers.
            </span>
          </div>
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

      {!loadError && calls && calls.length > 0 && selected.size > 0 && (
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <span style={{ color: 'var(--color-text-secondary)' }}>{selected.size} ticked</span>
          <button onClick={unassignSelected} disabled={assigning}
            className="btn text-xs flex items-center gap-1.5" style={{ border: '1px solid var(--color-border)' }}>
            <UserMinus size={12} /> Take the assigned ones back
          </button>
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
                <th className={th}>Latest dispo</th>
                <th className={th}>Closer dispo</th>
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
                    <td className="px-3 py-2">{c.closer_dispo || '—'}</td>
                    <td className="px-3 py-2">{c.recording_state || '—'}</td>
                    <td className="px-3 py-2">{c.call_at ? new Date(c.call_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                    <td className="px-3 py-2">
                      {c.assignment_status === 'unassigned' ? (
                        <span style={{ color: 'var(--color-text-tertiary)' }}>Unassigned</span>
                      ) : !c.assigned_to ? (
                        // An assignment row EXISTS but nobody holds it — it is in
                        // the pool waiting to be claimed. This used to fall into
                        // the branch below and render "— (pending)" with a
                        // "take back" button; clicking it unassigned a row that
                        // was already unassigned, so nothing visibly happened.
                        // There is no one to take it back from.
                        <span style={{ color: 'var(--color-text-tertiary)' }}>In pool — unclaimed</span>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <span>{c.assigned_to_name || '—'} <span style={{ color: 'var(--color-text-tertiary)' }}>({c.assignment_status})</span></span>
                          {c.assignment_id && (
                            <button onClick={() => unassignOne(c)} title={`Take this back off ${c.assigned_to_name || 'the reviewer'}`}
                              className="inline-flex items-center gap-1 text-xs hover:underline"
                              style={{ color: 'var(--color-text-tertiary)' }}>
                              <UserMinus size={12} /> take back
                            </button>
                          )}
                        </span>
                      )}
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
