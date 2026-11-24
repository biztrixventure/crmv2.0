// ============================================================================
// SupportReports -- the management side of the retention desk. Mounted by
// AdminPanel (superadmin / readonly admin) and ComplianceShell.
//
//   Agent Report     per-agent numbers for a date range + how calls ended.
//   Call Log         every call in the range, with the agent's own story.
//                    Click a row to open the policy (read-only).
//   Agents & Clients which clients each support agent works. An agent with no
//                    client sees nothing, so this is where a new one is set up.
//
// There is no approval step here any more (mig 357): a support agent's Saved
// is final and never changes the sale, so there is nothing to approve.
//
// Every column sorts on click (in the browser -- these tables are whole, not
// paged). The server decides who may assign clients (routes/support.js);
// `me.can_assign` only hides the button that would be refused anyway.
// ============================================================================
import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Download, Save } from 'lucide-react';
import client from '../../api/client';
import { logClientExport } from '../../utils/exportSpec';
import PolicyScreen from './PolicyScreen';
import SupportColorStyle from './supportColors';
import SupportColorsEditor from './SupportColorsEditor';
import { SortTh, useClientSort } from './sxSort';
import { dateTime, caseStatus, errText, toneClass } from './supportFormat';
import './support.css';

const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const monthStartIso = () => `${todayIso().slice(0, 8)}01`;

const TABS = [
  ['report', 'Agent Report'],
  ['calls', 'Call Log'],
  ['agents', 'Agents & Clients'],
];

// CSV cell: quote, double the quotes, and defuse a leading = + - @ so a
// spreadsheet never runs an agent's typed story as a formula.
const csvCell = (v) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};
// Every export is written to the CRM's export log first (egress governance):
// these files carry customer names and the agents' call notes. false = the
// person's daily export cap refused it.
const downloadCsv = async (name, header, rows, filters) => {
  if (!(await logClientExport('support_retention', rows.length, filters || null))) return false;
  const text = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
  return true;
};

const AGENT_COLS = [
  ['name', 'Agent', false], ['calls', 'Calls', true], ['customers', 'Customers', true], ['opened', 'Started', true],
  ['in_progress', 'In progress', true], ['saved', 'Saved', true], ['lost', 'Not saved', true],
  ['tags', 'Closers tagged', true], ['save_rate', 'Save rate', true],
];

export default function SupportReports() {
  const [me, setMe] = useState(null);
  const [meError, setMeError] = useState('');
  const [tab, setTab] = useState('report');
  const [range, setRange] = useState({ from: monthStartIso(), to: todayIso() });
  const [agentFilter, setAgentFilter] = useState('');
  const [report, setReport] = useState(null);
  const [agents, setAgents] = useState([]);
  const [allClients, setAllClients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [openSale, setOpenSale] = useState(null);

  useEffect(() => {
    client.get('support/me')
      .then((r) => setMe(r.data))
      .catch((e) => setMeError(errText(e, 'Could not open support reports.')));
  }, []);

  const loadReport = useCallback(async () => {
    const r = await client.get('support/reports', {
      params: { date_from: range.from, date_to: range.to, agent_id: agentFilter || undefined },
    });
    setReport(r.data);
  }, [range.from, range.to, agentFilter]);
  const loadAgents = useCallback(async () => {
    const [a, c] = await Promise.all([client.get('support/agents'), client.get('support/clients')]);
    setAgents(a.data.agents || []);
    setAllClients(c.data.clients || []);
  }, []);

  const load = useCallback(async () => {
    if (!me) return;
    setLoading(true); setError('');
    try {
      if (tab === 'colors') return;            // nothing to fetch: the colours came with /me
      if (tab === 'agents') await loadAgents();
      else await loadReport();
    } catch (e) {
      setError(errText(e, 'Could not load.'));
    } finally { setLoading(false); }
  }, [me, tab, loadAgents, loadReport]);

  useEffect(() => { load(); }, [load]);
  // The agent picker on the report needs the roster even before the Agents tab is opened.
  useEffect(() => { if (me) loadAgents().catch(() => {}); }, [me, loadAgents]);

  const agentRows = useClientSort(report?.agents || [], Object.fromEntries(AGENT_COLS.map(([k]) => [k, (r) => r[k]])));
  const outcomeRows = useClientSort(report?.outcomes || [], { label: (r) => r.label, count: (r) => r.count });
  const callRows = useClientSort(report?.calls || [], {
    when: (r) => r.called_at, agent: (r) => r.agent_name, customer: (r) => r.customer_name, client: (r) => r.client_name,
    outcome: (r) => r.outcome_label, notes: (r) => r.notes, status: (r) => caseStatus(r.case_status).label,
  });

  if (meError) return <div className="sx" style={{ minHeight: 0 }}><div className="sx-body"><div className="sx-note bad">{meError}</div></div></div>;
  if (!me) return <div className="sx" style={{ minHeight: 0 }}><div className="sx-empty">Opening support reports...</div></div>;

  const exportCsv = async (...args) => {
    const ok = await downloadCsv(...args, { date_from: range.from, date_to: range.to, agent_id: agentFilter || null });
    if (!ok) setError('You have reached your export limit for today. Ask an admin if you need more.');
  };

  // An element, not a component: defined as a component in here it would be a
  // new type every render and the date boxes would lose focus on each change.
  const rangeBar = (
    <form className="sx-searchbar" onSubmit={(e) => { e.preventDefault(); load(); }}>
      <label htmlFor="sr-from">From:</label>
      <input id="sr-from" type="date" className="sx-input" style={{ width: 150 }} value={range.from} max={range.to}
        onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
      <label htmlFor="sr-to">To:</label>
      <input id="sr-to" type="date" className="sx-input" style={{ width: 150 }} value={range.to} min={range.from}
        onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
      <label htmlFor="sr-agent">Agent:</label>
      <select id="sr-agent" className="sx-select" value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)}>
        <option value="">All support agents</option>
        {agents.map((a) => <option key={a.user_id} value={a.user_id}>{a.name}</option>)}
      </select>
      <button type="submit" className="sx-btn" disabled={loading}><RefreshCw size={14} /> Refresh</button>
    </form>
  );
  const t = report?.totals;

  return (
    <div className="sx" style={{ minHeight: 420, border: '1px solid #a0a0a0' }}>
      <SupportColorStyle colors={me.colors} />
      <div className="sx-tabstrip" role="tablist" aria-label="Support reports">
        {[...TABS, ...(me.can_colors ? [['colors', 'Colours']] : [])].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className="sx-tab"
            onClick={() => { setTab(k); setOpenSale(null); }}>
            {label}
          </button>
        ))}
      </div>

      {openSale ? (
        <PolicyScreen key={openSale} saleId={openSale} outcomes={me.outcomes} mode="view"
          onBack={() => setOpenSale(null)} />
      ) : (
        <>
          {error && <div className="sx-body" style={{ paddingBottom: 0 }}><div className="sx-note bad">{error}</div></div>}

          {tab === 'report' && (
            <>
              {rangeBar}
              <div className="sx-body">
                {report && (
                  <>
                    <div className="sx-stats">
                      <div className="sx-stat"><b>{t.calls}</b>Calls made</div>
                      <div className="sx-stat"><b>{t.opened}</b>Customers started</div>
                      <div className="sx-stat"><b>{t.in_progress}</b>In progress now</div>
                      <div className="sx-stat"><b>{t.saved}</b>Saved</div>
                      <div className="sx-stat"><b>{t.lost}</b>Not saved</div>
                      <div className="sx-stat"><b>{t.tags}</b>Closers tagged</div>
                      <div className="sx-stat"><b>{t.save_rate == null ? '-' : `${t.save_rate}%`}</b>Save rate</div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                      <button type="button" className="sx-btn" disabled={!report.agents.length}
                        onClick={() => exportCsv(`support-agents_${report.range.date_from}_${report.range.date_to}.csv`,
                          AGENT_COLS.map(([, label]) => (label === 'Save rate' ? 'Save rate %' : label)),
                          agentRows.sorted.map((a) => AGENT_COLS.map(([k]) => a[k] ?? '')))}>
                        <Download size={14} /> Export
                      </button>
                    </div>
                    <div className="sx-gridwrap">
                      <table className="sx-grid">
                        <thead><tr>
                          {AGENT_COLS.map(([k, label, isNum]) => (
                            <SortTh key={k} label={label} k={k} num={isNum} sort={agentRows.sort} onSort={agentRows.setSort} />
                          ))}
                        </tr></thead>
                        <tbody>
                          {report.agents.length === 0 && <tr><td colSpan={AGENT_COLS.length}><div className="sx-empty">No support activity in this date range.</div></td></tr>}
                          {agentRows.sorted.map((a) => (
                            <tr key={a.agent_id}>
                              <td className="nowrap">{a.name}</td>
                              <td className="num">{a.calls}</td><td className="num">{a.customers}</td><td className="num">{a.opened}</td>
                              <td className="num">{a.in_progress}</td><td className="num">{a.saved}</td><td className="num">{a.lost}</td>
                              <td className="num">{a.tags}</td><td className="num">{a.save_rate == null ? '-' : `${a.save_rate}%`}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="sx-hint" style={{ margin: '6px 0 12px' }}>
                      Save rate = saved out of (saved + not saved) in the range. In progress = open right now. Days are US Eastern.
                    </div>
                    {report.outcomes.length > 0 && (
                      <div className="sx-gridwrap" style={{ maxWidth: 420 }}>
                        <table className="sx-grid">
                          <thead><tr>
                            <SortTh label="How calls ended" k="label" sort={outcomeRows.sort} onSort={outcomeRows.setSort} />
                            <SortTh label="Calls" k="count" num sort={outcomeRows.sort} onSort={outcomeRows.setSort} />
                          </tr></thead>
                          <tbody>{outcomeRows.sorted.map((o) => (
                            <tr key={o.key} className={toneClass(me.outcomes, o.key)}><td>{o.label}</td><td className="num">{o.count}</td></tr>
                          ))}</tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}

          {tab === 'calls' && (
            <>
              {rangeBar}
              <div className="sx-body">
                {report && (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                      <span className="sx-hint">
                        {report.calls_total.toLocaleString()} call{report.calls_total === 1 ? '' : 's'}
                        {report.calls_total > report.calls.length ? `, newest ${report.calls.length} shown` : ''}. Click a row to open the policy.
                      </span>
                      <span className="sx-spacer" />
                      <button type="button" className="sx-btn" disabled={!report.calls.length}
                        onClick={() => exportCsv(`support-calls_${report.range.date_from}_${report.range.date_to}.csv`,
                          ['Date/Time (ET)', 'Agent', 'Customer', 'Client', 'Policy Number', 'Outcome', 'What happened', 'Follow-up', 'Case'],
                          callRows.sorted.map((c) => [dateTime(c.called_at), c.agent_name, c.customer_name, c.client_name, c.reference_no, c.outcome_label, c.notes, dateTime(c.follow_up_at), caseStatus(c.case_status).label]))}>
                        <Download size={14} /> Export
                      </button>
                    </div>
                    <div className="sx-gridwrap" style={{ maxHeight: '62vh' }}>
                      <table className="sx-grid">
                        <thead><tr>
                          <SortTh label="Date / Time (ET)" k="when" sort={callRows.sort} onSort={callRows.setSort} />
                          <SortTh label="Agent" k="agent" sort={callRows.sort} onSort={callRows.setSort} />
                          <SortTh label="Customer" k="customer" sort={callRows.sort} onSort={callRows.setSort} />
                          <SortTh label="Client" k="client" sort={callRows.sort} onSort={callRows.setSort} />
                          <SortTh label="Outcome" k="outcome" sort={callRows.sort} onSort={callRows.setSort} />
                          <SortTh label="What happened" k="notes" sort={callRows.sort} onSort={callRows.setSort} />
                          <SortTh label="Case" k="status" sort={callRows.sort} onSort={callRows.setSort} />
                        </tr></thead>
                        <tbody>
                          {report.calls.length === 0 && <tr><td colSpan={7}><div className="sx-empty">No calls in this date range.</div></td></tr>}
                          {callRows.sorted.map((c) => {
                            const cs = caseStatus(c.case_status);
                            const tone = toneClass(me.outcomes, c.outcome);
                            return (
                              <tr key={c.id} className={`${c.sale_id ? 'pick' : ''} ${tone}`.trim()} tabIndex={c.sale_id ? 0 : undefined}
                                onClick={() => c.sale_id && setOpenSale(c.sale_id)}
                                onKeyDown={(e) => { if (c.sale_id && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setOpenSale(c.sale_id); } }}>
                                <td className="nowrap">{dateTime(c.called_at)}</td>
                                <td className="nowrap">{c.agent_name}</td>
                                <td className="nowrap">{c.customer_name}</td>
                                <td className="nowrap">{c.client_name}</td>
                                <td className="nowrap">{c.outcome_label}</td>
                                <td className="story">{c.notes}</td>
                                <td className="nowrap">{cs.label && <span className={`sx-pill ${cs.pill}`}>{cs.label}</span>}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            </>
          )}

          {tab === 'colors' && me.can_colors && (
            <SupportColorsEditor me={me} onSaved={(colors) => setMe((m) => ({ ...m, colors }))} />
          )}

          {tab === 'agents' && (
            <div className="sx-body">
              <div className="sx-hint" style={{ marginBottom: 8 }}>
                A support agent only sees the policies of the clients ticked here. Create the agent first in User Management with the <b>Support Agent</b> role, then tick their clients.
              </div>
              {!loading && agents.length === 0 && (
                <div className="sx-empty">No support agents yet. Create a user with the Support Agent role and they will appear here.</div>
              )}
              {agents.map((a) => (
                <AgentClients key={a.user_id} agent={a} allClients={allClients} canEdit={me.can_assign} onSaved={loadAgents} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AgentClients({ agent, allClients, canEdit, onSaved }) {
  const [picked, setPicked] = useState(() => new Set(agent.clients));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => { setPicked(new Set(agent.clients)); }, [agent.clients]);

  const dirty = picked.size !== agent.clients.length || agent.clients.some((c) => !picked.has(c));
  const toggle = (c) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(c)) next.delete(c); else next.add(c);
    return next;
  });
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      await client.put(`support/agents/${agent.user_id}/clients`, { clients: [...picked] });
      setMsg({ ok: true, text: 'Saved.' });
      await onSaved();
    } catch (e) {
      setMsg({ ok: false, text: errText(e, 'Could not save.') });
    } finally { setBusy(false); }
  };

  return (
    <fieldset className="sx-group" style={{ marginBottom: 10 }}>
      <legend>{agent.name}{agent.company ? ` - ${agent.company}` : ''}</legend>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px', padding: '4px 0 8px' }}>
        {allClients.map((c) => (
          <label key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 150 }}>
            <input type="checkbox" checked={picked.has(c)} disabled={!canEdit || busy} onChange={() => toggle(c)} />
            {c}
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {canEdit && (
          <button type="button" className="sx-btn" onClick={save} disabled={!dirty || busy}>
            <Save size={14} /> {busy ? 'Saving...' : 'Save clients'}
          </button>
        )}
        <span className="sx-hint">{picked.size === 0 ? 'No clients: this agent sees nothing.' : `${picked.size} client${picked.size === 1 ? '' : 's'}`}</span>
        {msg && <span role="status" style={{ color: msg.ok ? '#1a6b1a' : '#b03a3a' }}>{msg.text}</span>}
      </div>
    </fieldset>
  );
}
