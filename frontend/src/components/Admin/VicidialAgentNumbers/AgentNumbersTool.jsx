import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Phone, Search, X, Loader2, RefreshCw, Users, Plus, Copy, Check, Send,
  KeyRound, Archive, Trash2, Download, AlertTriangle, ListChecks,
} from 'lucide-react';
import client from '../../../api/client';
import ThemedSelect from '../../UI/Select';
import ThemedDate from '../../UI/ThemedDate';
import CreateBatchModal from './CreateBatchModal';

// ============================================================================
// VICIdial Agent Numbers (superadmin) — pulls an agent's user_stats.php report
// LIVE through a STATELESS backend proxy (creds live server-side in app_secrets;
// the CRM stores none of the pulled data). The report lives ONLY here in the
// browser (localStorage, cleared on logout). From the loaded numbers you build a
// distribution batch and send it to users → their floating "My Numbers" widget.
// ============================================================================

const LS_KEY = 'vici_agent_numbers_v1';   // ALSO cleared in AuthContext.logout
const todayStr = () => new Date().toISOString().slice(0, 10);

// Common outbound statuses for the quick filter (free-typing any code also works).
const STATUS_HINTS = ['', 'A', 'XFER', 'SALE', 'NI', 'DNC', 'CALLBK', 'N', 'B', 'DAIR', 'DROP'];

const digits = (s) => String(s || '').replace(/\D/g, '');

const SECTIONS = [
  { id: 'numbers',  label: 'Numbers' },
  { id: 'outbound', label: 'Outbound Calls' },
  { id: 'manual',   label: 'Manual Dials' },
  { id: 'activity', label: 'Agent Activity' },
  { id: 'status',   label: 'Status Summary' },
  { id: 'logins',   label: 'URL Logins' },
];

export default function AgentNumbersTool() {
  // ── controls ──────────────────────────────────────────────────────────────
  const [agentInput, setAgentInput] = useState('');
  const [agents, setAgents]   = useState([]);
  const [boxId, setBoxId]     = useState('');
  const [begin, setBegin]     = useState(todayStr());
  const [end, setEnd]         = useState(todayStr());
  const [callStatus, setCallStatus] = useState('');
  const [archived, setArchived]     = useState(false);

  const [boxes, setBoxes]     = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  // ── results (client-only, persisted to localStorage) ───────────────────────
  const [results, setResults] = useState(null);
  const [section, setSection] = useState('numbers');

  // ── numbers view state ──────────────────────────────────────────────────────
  const [search, setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState(new Set());
  const [selected, setSelected]   = useState(new Set());   // keys "agent|phone"
  const [copied, setCopied]       = useState(null);
  const [showBatch, setShowBatch] = useState(false);

  const [showCreds, setShowCreds] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);

  // Hydrate saved results + load config on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved?.agents) {
          setResults(saved);
          if (saved.params) {
            setAgents(saved.params.agents || []);
            setBoxId(saved.params.box_id || '');
            setBegin(saved.params.begin_date || todayStr());
            setEnd(saved.params.end_date || todayStr());
            setCallStatus(saved.params.call_status || '');
            setArchived(!!saved.params.archived);
          }
          const keys = new Set();
          (saved.agents || []).forEach(a => (a.numbers || []).forEach(n => keys.add(`${a.agent}|${n.phone}`)));
          setSelected(keys);
        }
      }
    } catch { /* ignore corrupt cache */ }
    loadConfig();
  }, []);

  const loadConfig = useCallback(async () => {
    try { const r = await client.get('vicidial/stats/config'); setBoxes(r.data.boxes || []); }
    catch { /* non-fatal */ }
  }, []);

  const addAgent = (raw) => {
    const parts = String(raw || '').split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
    if (!parts.length) return;
    setAgents(prev => [...new Set([...prev, ...parts])].slice(0, 25));
    setAgentInput('');
  };
  const removeAgent = (a) => setAgents(prev => prev.filter(x => x !== a));

  const persist = (payload) => { try { localStorage.setItem(LS_KEY, JSON.stringify(payload)); } catch { /* quota */ } };

  const pull = useCallback(async () => {
    if (!agents.length) { setError('Add at least one agent id'); return; }
    if (!begin) { setError('Pick a start date'); return; }
    setLoading(true); setError(null);
    try {
      const body = { agents, box_id: boxId || undefined, begin_date: begin, end_date: end || begin, call_status: callStatus || '', archived };
      const r = await client.post('vicidial/stats/pull', body);
      const payload = { savedAt: new Date().toISOString(), params: { agents, box_id: boxId, begin_date: begin, end_date: end || begin, call_status: callStatus, archived }, agents: r.data.agents || [] };
      setResults(payload);
      persist(payload);
      setSection('numbers');
      setStatusFilter(new Set());
      const keys = new Set();
      (r.data.agents || []).forEach(a => (a.numbers || []).forEach(n => keys.add(`${a.agent}|${n.phone}`)));
      setSelected(keys);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Pull failed');
    } finally { setLoading(false); }
  }, [agents, boxId, begin, end, callStatus, archived]);

  const clearResults = () => { setResults(null); setSelected(new Set()); setSearch(''); setStatusFilter(new Set()); try { localStorage.removeItem(LS_KEY); } catch { /* noop */ } };

  const okAgents  = useMemo(() => (results?.agents || []).filter(a => a.ok), [results]);
  const errAgents = useMemo(() => (results?.agents || []).filter(a => !a.ok), [results]);
  const multiAgent = okAgents.length > 1;

  const allNumbers = useMemo(() => {
    const out = [];
    okAgents.forEach(a => (a.numbers || []).forEach(n => out.push({ ...n, agent: a.agent, box: a.box, key: `${a.agent}|${n.phone}` })));
    return out;
  }, [okAgents]);

  const statusCounts = useMemo(() => {
    const m = new Map();
    allNumbers.forEach(n => { const s = n.status || '—'; m.set(s, (m.get(s) || 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [allNumbers]);

  const filteredNumbers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qd = digits(search);
    return allNumbers.filter(n => {
      if (statusFilter.size && !statusFilter.has(n.status || '—')) return false;
      if (!q) return true;
      return (qd && n.phone.includes(qd))
        || (n.lead && n.lead.includes(qd))
        || (n.status || '').toLowerCase().includes(q)
        || (n.list || '').toLowerCase().includes(q)
        || (n.campaign || '').toLowerCase().includes(q)
        || (n.agent || '').toLowerCase().includes(q);
    });
  }, [allNumbers, search, statusFilter]);

  const selectedNumbers = useMemo(() => allNumbers.filter(n => selected.has(n.key)), [allNumbers, selected]);
  const distinctSelected = useMemo(() => new Set(selectedNumbers.map(n => digits(n.phone).slice(-10))).size, [selectedNumbers]);

  const toggleStatus = (s) => setStatusFilter(prev => { const nx = new Set(prev); nx.has(s) ? nx.delete(s) : nx.add(s); return nx; });
  const toggleRow = (key) => setSelected(prev => { const nx = new Set(prev); nx.has(key) ? nx.delete(key) : nx.add(key); return nx; });
  const selectAllFiltered = () => setSelected(prev => { const nx = new Set(prev); filteredNumbers.forEach(n => nx.add(n.key)); return nx; });
  const clearSelection = () => setSelected(new Set());
  const selectOnlyFiltered = () => setSelected(new Set(filteredNumbers.map(n => n.key)));

  const copyNum = (p) => {
    const d = digits(p);
    try { navigator.clipboard?.writeText(d); } catch { /* ignore */ }
    setCopied(p); setTimeout(() => setCopied(c => (c === p ? null : c)), 1200);
  };

  const exportCsv = () => {
    const rows = filteredNumbers;
    const head = ['phone', 'status', 'length', 'list', 'lead', 'campaign', 'group', 'call_type', 'agent', 'datetime'];
    const csv = [head.join(',')].concat(rows.map(n => head.map(h => `"${String(n[h] ?? '').replace(/"/g, '""')}"`).join(','))).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `agent-numbers-${begin}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const c = { border: 'var(--color-border)', sub: 'var(--color-text-muted, #64748b)' };

  return (
    <div className="w-full">
      {/* ── header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white" style={{ background: 'var(--gradient-sidebar, #4f46e5)' }}>
          <Phone size={20} />
        </div>
        <div className="flex-1 min-w-[200px]">
          <h1 className="text-xl font-bold text-text">VICIdial Agent Numbers</h1>
          <p className="text-xs" style={{ color: c.sub }}>Live pull from user_stats.php · stays in your browser only · never stored in the CRM</p>
        </div>
        <button onClick={() => setShowCreds(s => !s)} className="btn-ghost text-sm inline-flex items-center gap-1.5" title="Dialer stats credentials">
          <KeyRound size={15} /> Creds
        </button>
      </div>

      {showCreds && <CredsPanel boxes={boxes} onSaved={loadConfig} onClose={() => setShowCreds(false)} />}

      {/* ── control card ───────────────────────────────────────────────────── */}
      <div className="rounded-2xl p-4 mb-4" style={{ background: 'var(--color-surface, #fff)', border: `1px solid ${c.border}` }}>
        <div className="mb-3">
          <label className="block text-xs font-semibold mb-1.5 text-text">Agent id(s)</label>
          <div className="flex flex-wrap items-center gap-1.5 p-2 rounded-lg" style={{ border: `1px solid ${c.border}`, minHeight: 44 }}>
            {agents.map(a => (
              <span key={a} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-bold" style={{ background: 'var(--color-primary-50, #eef2ff)', color: 'var(--color-primary-700, #4338ca)' }}>
                {a}
                <button onClick={() => removeAgent(a)} className="opacity-70 hover:opacity-100"><X size={12} /></button>
              </span>
            ))}
            <input
              value={agentInput}
              onChange={e => setAgentInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addAgent(agentInput); } else if (e.key === 'Backspace' && !agentInput && agents.length) { removeAgent(agents[agents.length - 1]); } }}
              onBlur={() => agentInput && addAgent(agentInput)}
              placeholder={agents.length ? 'Add another…' : 'e.g. WTI1020  (Enter to add, paste many)'}
              className="flex-1 min-w-[160px] bg-transparent outline-none text-sm text-text py-1"
            />
            <button onClick={() => setRosterOpen(true)} className="btn-ghost text-xs inline-flex items-center gap-1 shrink-0" title="Pick from the dialer roster">
              <Users size={13} /> Roster
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
          <div>
            <label className="block text-xs font-semibold mb-1 text-text">Dialer</label>
            <ThemedSelect value={boxId} onChange={e => setBoxId(e.target.value)}>
              <option value="">Auto (by prefix)</option>
              {boxes.map(b => <option key={b.id} value={b.id}>{b.prefix || b.id}</option>)}
            </ThemedSelect>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1 text-text">From</label>
            <ThemedDate value={begin} onChange={v => setBegin((v?.target ? v.target.value : v) || '')} max={end || undefined} />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1 text-text">To</label>
            <ThemedDate value={end} onChange={v => setEnd((v?.target ? v.target.value : v) || '')} min={begin || undefined} />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1 text-text">Call status</label>
            <ThemedSelect value={STATUS_HINTS.includes(callStatus) ? callStatus : '__custom'} onChange={e => { if (e.target.value !== '__custom') setCallStatus(e.target.value); }}>
              {STATUS_HINTS.map(s => <option key={s || 'all'} value={s}>{s === '' ? 'All' : s}</option>)}
              <option value="__custom">Custom…</option>
            </ThemedSelect>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1 text-text">Custom code</label>
            <input value={callStatus} onChange={e => setCallStatus(e.target.value.toUpperCase())} placeholder="blank = all"
              className="w-full px-2.5 py-2 rounded-lg text-sm bg-transparent text-text outline-none" style={{ border: `1px solid ${c.border}` }} />
          </div>
          <label className="flex items-center gap-2 text-sm text-text cursor-pointer select-none pb-2">
            <input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} />
            <Archive size={14} /> Archived
          </label>
        </div>

        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <button onClick={pull} disabled={loading || !agents.length} className="btn-primary inline-flex items-center gap-2 text-sm disabled:opacity-50">
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
            {loading ? 'Pulling…' : `Load ${agents.length || ''} agent${agents.length === 1 ? '' : 's'}`.trim()}
          </button>
          {results && <button onClick={clearResults} className="btn-ghost inline-flex items-center gap-1.5 text-sm"><Trash2 size={14} /> Clear</button>}
          {results?.savedAt && <span className="text-xs" style={{ color: c.sub }}>loaded {new Date(results.savedAt).toLocaleString()}</span>}
          {error && <span className="text-xs font-semibold" style={{ color: 'var(--color-danger-600, #dc2626)' }}>{error}</span>}
        </div>
      </div>

      {/* ── per-agent status banner ─────────────────────────────────────────── */}
      {results && (errAgents.length > 0 || okAgents.length > 0) && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {okAgents.map(a => (
            <span key={a.agent} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
              style={{ background: 'var(--color-success-50, #ecfdf5)', color: 'var(--color-success-700, #047857)' }}>
              <Check size={12} /> {a.agent} · {a.counts?.numbers ?? 0} #
            </span>
          ))}
          {errAgents.map(a => (
            <span key={a.agent} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold" title={a.error}
              style={{ background: 'var(--color-danger-50, #fef2f2)', color: 'var(--color-danger-700, #b91c1c)' }}>
              <AlertTriangle size={12} /> {a.agent}: {a.error}
            </span>
          ))}
        </div>
      )}

      {/* ── results ─────────────────────────────────────────────────────────── */}
      {okAgents.length > 0 && (
        <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${c.border}`, background: 'var(--color-surface, #fff)' }}>
          <div className="flex items-center gap-1 px-2 pt-2 flex-wrap" style={{ borderBottom: `1px solid ${c.border}` }}>
            {SECTIONS.map(s => {
              const count = sectionCount(okAgents, s.id);
              return (
                <button key={s.id} onClick={() => setSection(s.id)}
                  className="px-3 py-2 text-sm font-semibold rounded-t-lg transition-colors"
                  style={section === s.id
                    ? { color: 'var(--color-primary-700, #4338ca)', borderBottom: '2px solid var(--color-primary-600, #4f46e5)' }
                    : { color: c.sub }}>
                  {s.label}{count != null && <span className="ml-1 opacity-60">{count}</span>}
                </button>
              );
            })}
          </div>

          <div className="p-3">
            {section === 'numbers' && (
              <>
                {statusCounts.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {statusCounts.map(([s, n]) => (
                      <button key={s} onClick={() => toggleStatus(s)}
                        className="px-2.5 py-1 rounded-full text-xs font-bold"
                        style={statusFilter.has(s)
                          ? { background: 'var(--color-primary-600, #4f46e5)', color: '#fff' }
                          : { background: 'var(--color-primary-50, #eef2ff)', color: 'var(--color-primary-700, #4338ca)' }}>
                        {s} {n}
                      </button>
                    ))}
                    {statusFilter.size > 0 && <button onClick={() => setStatusFilter(new Set())} className="text-xs underline" style={{ color: c.sub }}>reset</button>}
                  </div>
                )}

                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <div className="relative flex-1 min-w-[180px]">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: c.sub }} />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search phone, lead, list, status, agent…"
                      className="w-full pl-8 pr-2 py-2 rounded-lg text-sm bg-transparent text-text outline-none" style={{ border: `1px solid ${c.border}` }} />
                  </div>
                  <button onClick={selectOnlyFiltered} className="btn-ghost text-xs inline-flex items-center gap-1"><ListChecks size={13} /> Select shown</button>
                  <button onClick={selectAllFiltered} className="btn-ghost text-xs">+ Add shown</button>
                  <button onClick={clearSelection} className="btn-ghost text-xs">None</button>
                  <button onClick={exportCsv} className="btn-ghost text-xs inline-flex items-center gap-1"><Download size={13} /> CSV</button>
                  <button onClick={() => setShowBatch(true)} disabled={!selected.size} className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
                    <Send size={14} /> Create batch ({distinctSelected})
                  </button>
                </div>

                <p className="text-xs mb-2" style={{ color: c.sub }}>
                  {filteredNumbers.length} shown · {selected.size} selected ({distinctSelected} distinct numbers)
                </p>

                <NumbersTable
                  rows={filteredNumbers} selected={selected} onToggle={toggleRow}
                  multiAgent={multiAgent} copied={copied} onCopy={copyNum} border={c.border} sub={c.sub}
                />
              </>
            )}

            {section === 'outbound' && <SectionTable okAgents={okAgents} pick="outbound_calls" multiAgent={multiAgent}
              cols={[['datetime', 'Date/Time'], ['status', 'Status'], ['length', 'Len'], ['phone', 'Phone'], ['list', 'List'], ['lead', 'Lead'], ['campaign', 'Camp'], ['group', 'Group'], ['hangup', 'Hangup']]} border={c.border} sub={c.sub} />}

            {section === 'manual' && <SectionTable okAgents={okAgents} pick="manual_outbound" multiAgent={multiAgent}
              cols={[['datetime', 'Date/Time'], ['call_type', 'Type'], ['phone', 'Phone'], ['dialed', 'Dialed'], ['lead', 'Lead'], ['callerid', 'Caller ID']]} border={c.border} sub={c.sub} />}

            {section === 'activity' && <SectionTable okAgents={okAgents} pick="agent_activity" multiAgent={multiAgent}
              cols={[['datetime', 'Date/Time'], ['pause', 'Pause'], ['wait', 'Wait'], ['talk', 'Talk'], ['dispo', 'Dispo'], ['customer', 'Cust'], ['status', 'Status'], ['lead', 'Lead'], ['type', 'Type'], ['campaign', 'Camp'], ['pause_code', 'Pause code']]} border={c.border} sub={c.sub} />}

            {section === 'status' && <SectionTable okAgents={okAgents} pick="status_summary" multiAgent={multiAgent}
              cols={[['status', 'Status'], ['count', 'Count'], ['duration', 'Hours:MM:SS']]} border={c.border} sub={c.sub} />}

            {section === 'logins' && <SectionTable okAgents={okAgents} pick="url_logins" multiAgent={multiAgent}
              cols={[['date', 'Date'], ['campaign', 'Camp'], ['group', 'Group'], ['dialer_server', 'Dialer'], ['web_server', 'Web server'], ['login_url', 'Login URL']]} border={c.border} sub={c.sub} />}
          </div>
        </div>
      )}

      {rosterOpen && <RosterPicker boxes={boxes} onAdd={(ids) => { addAgent(ids.join(' ')); }} onClose={() => setRosterOpen(false)} />}

      {showBatch && (
        <CreateBatchModal
          numbers={selectedNumbers}
          defaultName={`${okAgents.map(a => a.agent).join(', ')} · ${begin}${end && end !== begin ? `→${end}` : ''}`.slice(0, 120)}
          onClose={() => setShowBatch(false)}
          onSent={() => setShowBatch(false)}
        />
      )}
    </div>
  );
}

function sectionCount(okAgents, id) {
  if (id === 'numbers') return okAgents.reduce((a, x) => a + (x.numbers?.length || 0), 0);
  const key = { outbound: 'outbound_calls', manual: 'manual_outbound', activity: 'agent_activity', status: 'status_summary', logins: 'url_logins' }[id];
  return okAgents.reduce((a, x) => a + ((x[key] || []).length), 0);
}

// ── numbers table (selectable) ──────────────────────────────────────────────
function NumbersTable({ rows, selected, onToggle, multiAgent, copied, onCopy, border, sub }) {
  const CAP = 2000;
  const shown = rows.slice(0, CAP);
  if (!rows.length) return <p className="text-sm py-8 text-center" style={{ color: sub }}>No numbers match.</p>;
  const th = { textAlign: 'left', padding: '6px 8px', fontSize: 11, fontWeight: 700, color: sub, position: 'sticky', top: 0, background: 'var(--color-surface, #fff)' };
  const td = { padding: '5px 8px', fontSize: 12.5, borderTop: `1px solid ${border}` };
  return (
    <div style={{ maxHeight: 560, overflow: 'auto', border: `1px solid ${border}`, borderRadius: 10 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...th, width: 32 }} />
            <th style={th}>Phone</th>
            <th style={th}>Status</th>
            <th style={th}>Len</th>
            <th style={th}>List</th>
            <th style={th}>Lead</th>
            <th style={th}>Type</th>
            {multiAgent && <th style={th}>Agent</th>}
            <th style={th}>Date/Time</th>
            <th style={{ ...th, width: 36 }} />
          </tr>
        </thead>
        <tbody>
          {shown.map(n => {
            const sel = selected.has(n.key);
            return (
              <tr key={n.key} style={{ background: sel ? 'var(--color-primary-50, #eef2ff)' : 'transparent', cursor: 'pointer' }} onClick={() => onToggle(n.key)}>
                <td style={{ ...td, textAlign: 'center' }}><input type="checkbox" checked={sel} onChange={() => onToggle(n.key)} onClick={e => e.stopPropagation()} /></td>
                <td style={{ ...td, fontFamily: 'ui-monospace,monospace', fontWeight: 700 }}>{n.phone}</td>
                <td style={td}><StatusBadge s={n.status} /></td>
                <td style={td}>{n.length ?? ''}</td>
                <td style={td}>{n.list || ''}</td>
                <td style={{ ...td, fontFamily: 'ui-monospace,monospace' }}>{n.lead || ''}</td>
                <td style={td}>{n.call_type || ''}</td>
                {multiAgent && <td style={{ ...td, fontWeight: 700 }}>{n.agent}</td>}
                <td style={{ ...td, color: sub, whiteSpace: 'nowrap' }}>{n.datetime || ''}</td>
                <td style={{ ...td, textAlign: 'center' }}>
                  <button onClick={e => { e.stopPropagation(); onCopy(n.phone); }} title="Copy">
                    {copied === n.phone ? <Check size={13} color="#059669" /> : <Copy size={13} style={{ color: sub }} />}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > CAP && <p className="text-xs py-2 text-center" style={{ color: sub }}>Showing first {CAP} of {rows.length}. Narrow the filter to see more (all {rows.length} are still selectable/sendable).</p>}
    </div>
  );
}

function StatusBadge({ s }) {
  if (!s) return <span style={{ color: 'var(--color-text-muted,#94a3b8)' }}>—</span>;
  const up = s.toUpperCase();
  const good = up === 'XFER' || up === 'SALE';
  const bad = up === 'DNC' || up === 'N' || up === 'B';
  const bg = good ? 'var(--color-success-50,#ecfdf5)' : bad ? 'var(--color-danger-50,#fef2f2)' : 'var(--color-primary-50,#eef2ff)';
  const col = good ? 'var(--color-success-700,#047857)' : bad ? 'var(--color-danger-700,#b91c1c)' : 'var(--color-primary-700,#4338ca)';
  return <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 6, background: bg, color: col }}>{s}</span>;
}

// ── generic read-only section table (combined across agents) ─────────────────
function SectionTable({ okAgents, pick, cols, multiAgent, border, sub }) {
  const rows = [];
  okAgents.forEach(a => (a[pick] || []).forEach(r => rows.push({ ...r, __agent: a.agent })));
  if (!rows.length) return <p className="text-sm py-8 text-center" style={{ color: sub }}>Nothing in this section.</p>;
  const th = { textAlign: 'left', padding: '6px 8px', fontSize: 11, fontWeight: 700, color: sub, position: 'sticky', top: 0, background: 'var(--color-surface, #fff)', whiteSpace: 'nowrap' };
  const td = { padding: '5px 8px', fontSize: 12.5, borderTop: `1px solid ${border}`, whiteSpace: 'nowrap' };
  return (
    <div style={{ maxHeight: 560, overflow: 'auto', border: `1px solid ${border}`, borderRadius: 10 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{multiAgent && <th style={th}>Agent</th>}{cols.map(([k, l]) => <th key={k} style={th}>{l}</th>)}</tr></thead>
        <tbody>
          {rows.slice(0, 3000).map((r, i) => (
            <tr key={i}>
              {multiAgent && <td style={{ ...td, fontWeight: 700 }}>{r.__agent}</td>}
              {cols.map(([k]) => <td key={k} style={{ ...td, ...(k === 'phone' || k === 'lead' ? { fontFamily: 'ui-monospace,monospace' } : {}) }}>{k === 'login_url' && r[k] ? <a href={r[k]} target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary-600,#4f46e5)' }}>{r[k]}</a> : (r[k] ?? '')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── credentials panel (write-only, per box) ──────────────────────────────────
function CredsPanel({ boxes, onSaved, onClose }) {
  const [boxId, setBoxId] = useState(boxes[0]?.id || '');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => { if (!boxId && boxes[0]) setBoxId(boxes[0].id); }, [boxes]);   // eslint-disable-line
  const save = async () => {
    if (!boxId || !user) { setMsg('Pick a dialer and enter a user'); return; }
    setBusy(true); setMsg(null);
    try { await client.post('vicidial/stats/auth', { box_id: boxId, user, pass }); setMsg('Saved'); setUser(''); setPass(''); onSaved?.(); }
    catch (e) { setMsg(e.response?.data?.error || 'Save failed'); }
    finally { setBusy(false); }
  };
  return (
    <div className="rounded-2xl p-4 mb-4" style={{ background: 'var(--color-surface, #fff)', border: '1px solid var(--color-border)' }}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-text">Dialer stats login (user_stats.php)</h3>
        <button onClick={onClose}><X size={16} /></button>
      </div>
      <p className="text-xs mb-3" style={{ color: 'var(--color-text-muted,#64748b)' }}>
        Basic-auth login for each dialer's admin page. Stored server-side only (write-only) — never shown back or sent to the browser.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[140px]">
          <label className="block text-xs font-semibold mb-1 text-text">Dialer</label>
          <ThemedSelect value={boxId} onChange={e => setBoxId(e.target.value)}>
            {boxes.map(b => <option key={b.id} value={b.id}>{(b.prefix || b.id)}{b.stats_auth_set ? ' ✓' : ''}</option>)}
          </ThemedSelect>
        </div>
        <input value={user} onChange={e => setUser(e.target.value)} placeholder="user (e.g. ceo)" className="px-2.5 py-2 rounded-lg text-sm bg-transparent text-text outline-none" style={{ border: '1px solid var(--color-border)' }} />
        <input value={pass} onChange={e => setPass(e.target.value)} type="password" placeholder="password" className="px-2.5 py-2 rounded-lg text-sm bg-transparent text-text outline-none" style={{ border: '1px solid var(--color-border)' }} />
        <button onClick={save} disabled={busy} className="btn-primary text-sm disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
        {msg && <span className="text-xs font-semibold" style={{ color: msg === 'Saved' ? 'var(--color-success-600,#059669)' : 'var(--color-danger-600,#dc2626)' }}>{msg}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5 mt-3">
        {boxes.map(b => (
          <span key={b.id} className="text-xs px-2 py-0.5 rounded-full" style={{ background: b.stats_auth_set ? 'var(--color-success-50,#ecfdf5)' : 'var(--color-bg-subtle,#f1f5f9)', color: b.stats_auth_set ? 'var(--color-success-700,#047857)' : 'var(--color-text-muted,#64748b)' }}>
            {(b.prefix || b.id)}: {b.stats_auth_set ? 'creds set' : (b.box_auth_fallback ? 'using box creds' : 'no creds')}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── roster picker (agent_stats_export) ───────────────────────────────────────
function RosterPicker({ boxes, onAdd, onClose }) {
  const [box, setBox] = useState('');
  const [days, setDays] = useState(14);
  const [roster, setRoster] = useState([]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState(new Set());
  const load = useCallback(async () => {
    setBusy(true);
    try { const r = await client.get('vicidial/agents/roster', { params: { box: box || undefined, days } }); setRoster(r.data.roster || []); }
    catch { setRoster([]); }
    finally { setBusy(false); }
  }, [box, days]);
  useEffect(() => { load(); }, [load]);
  const filtered = roster.filter(r => !q || r.login.toLowerCase().includes(q.toLowerCase()) || (r.full_name || '').toLowerCase().includes(q.toLowerCase()));
  const toggle = (id) => setChosen(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <Modal onClose={onClose} title="Pick agents from the dialer roster" wide>
      <div className="flex flex-wrap gap-2 mb-3 items-end">
        <div><label className="block text-xs font-semibold mb-1 text-text">Dialer</label>
          <ThemedSelect value={box} onChange={e => setBox(e.target.value)}>
            <option value="">All</option>{boxes.map(b => <option key={b.id} value={b.id}>{b.prefix || b.id}</option>)}
          </ThemedSelect></div>
        <div><label className="block text-xs font-semibold mb-1 text-text">Last days</label>
          <input type="number" min={1} max={60} value={days} onChange={e => setDays(parseInt(e.target.value, 10) || 14)} className="w-20 px-2 py-2 rounded-lg text-sm bg-transparent text-text outline-none" style={{ border: '1px solid var(--color-border)' }} /></div>
        <button onClick={load} className="btn-ghost text-sm inline-flex items-center gap-1"><RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Reload</button>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="filter…" className="flex-1 min-w-[140px] px-2.5 py-2 rounded-lg text-sm bg-transparent text-text outline-none" style={{ border: '1px solid var(--color-border)' }} />
      </div>
      <div style={{ maxHeight: 340, overflow: 'auto', border: '1px solid var(--color-border)', borderRadius: 10 }}>
        {busy && !roster.length ? <p className="text-sm py-8 text-center" style={{ color: 'var(--color-text-muted,#64748b)' }}>Loading roster…</p>
          : !filtered.length ? <p className="text-sm py-8 text-center" style={{ color: 'var(--color-text-muted,#64748b)' }}>No agents.</p>
          : filtered.map(r => (
            <label key={`${r.box_id}|${r.login}`} className="flex items-center gap-2 px-3 py-2 cursor-pointer" style={{ borderTop: '1px solid var(--color-border)' }}>
              <input type="checkbox" checked={chosen.has(r.login)} onChange={() => toggle(r.login)} />
              <span className="font-mono font-bold text-sm text-text">{r.login}</span>
              <span className="text-xs" style={{ color: 'var(--color-text-muted,#64748b)' }}>{r.full_name}</span>
              <span className="text-xs ml-auto" style={{ color: 'var(--color-text-muted,#64748b)' }}>{r.prefix} · {r.calls} calls{r.mapped_to ? ` · ${r.mapped_to.name}` : ''}</span>
            </label>
          ))}
      </div>
      <div className="flex justify-end gap-2 mt-3">
        <button onClick={onClose} className="btn-ghost text-sm">Cancel</button>
        <button onClick={() => { onAdd([...chosen]); onClose(); }} disabled={!chosen.size} className="btn-primary text-sm disabled:opacity-50 inline-flex items-center gap-1.5"><Plus size={14} /> Add {chosen.size || ''}</button>
      </div>
    </Modal>
  );
}

// Small shared modal shell (also used by CreateBatchModal).
export function Modal({ title, children, onClose, wide }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={onClose}>
      <div className="rounded-2xl w-full animate-scale-in" style={{ maxWidth: wide ? 720 : 520, background: 'var(--color-surface, #fff)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)', maxHeight: '90vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <h3 className="font-bold text-text">{title}</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
