import { useState, useEffect, useCallback, useMemo } from 'react';
import { Shield, RefreshCw, Loader2, X, Search, Building2, Check, Settings2, ChevronDown, ChevronRight, Info, Lock, Headphones, ArrowRightLeft, Shuffle, DollarSign, PhoneOff, Play, Users, User, Plus } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';
import ThemedSelect from '../UI/Select';

// ============================================================================
// QaAdminTab — Compliance owns the QA department (mig 181 + 186).
//   1. Companies — enable/configure QA + coverage/backlog per company
//   2. QA Team — person-centric console: pick a QUALITY person, then assign
//      any combination of work in one flow (company access + kinds of calls +
//      one/many/all subject users + dispositions + route now)
//   3. Work rules — the all-companies overview of who listens to what
// QA accounts are created by the Super Admin and appear here automatically.
// ============================================================================

// width:'auto' so ThemedSelect filters size to their content and flow several per
// row instead of each taking a full line. Any control that needs a set width
// still wins by passing width explicitly (e.g. {...inp, width: 58} / width:'100%').
const inp = { background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text)', borderRadius: 999, padding: '8px 12px', fontSize: 13, outline: 'none', width: 'auto' };
const METHODS = [['tra', 'TRA'], ['rcm', 'RCM']];
const lvlLabel = (l) => (l === 'qa_manager' ? 'Manager' : 'Agent');

// Small "i" helper — hover or tap for a plain-language explanation (mirrors the
// QA shell's InfoTip so both surfaces explain themselves the same way).
function InfoTip({ text, w = 250 }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex" style={{ verticalAlign: 'middle' }} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen(o => !o); }}
        className="inline-flex items-center justify-center rounded-full cursor-help"
        style={{ width: 15, height: 15, background: 'var(--color-surface-hover)', color: 'var(--color-text-tertiary)', flexShrink: 0 }} aria-label="What does this do?">
        <Info size={10} />
      </button>
      {open && (
        <span className="absolute z-[60] text-[11px] font-normal normal-case tracking-normal leading-snug p-2.5 rounded-lg"
          onClick={(e) => e.stopPropagation()}
          style={{ width: w, top: 'calc(100% + 5px)', left: 0, background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', boxShadow: '0 8px 24px rgba(0,0,0,0.20)', whiteSpace: 'normal' }}>
          {text}
        </span>
      )}
    </span>
  );
}

const StepBadge = ({ n }) => (
  <span className="inline-flex items-center justify-center rounded-full text-[10px] font-bold" style={{ width: 16, height: 16, background: 'var(--color-primary-600)', color: '#fff' }}>{n}</span>
);

const WORK_TYPE_DEFS = [
  { key: 'tra', label: 'TRA — Transfer calls (Fronter)', icon: ArrowRightLeft, tint: '#2563eb', desc: 'The fronters\' transfer calls — the ones entered IN the CRM. A transfer means TRA. Comes from CRM records.' },
  { key: 'rcm', label: 'RCM — Random calls (Fronter)', icon: Shuffle, tint: '#d97706', desc: 'The fronters\' OTHER calls — raw dialer calls NOT in the CRM. This is the only type fetched live from the dialer, sampled daily at the configured rate.' },
  { key: 'closer_sales', label: 'Closed Sale calls (Closer)', icon: DollarSign, tint: '#059669', desc: 'The closers\' calls that CLOSED a sale. Every TRA that became a sale. Pick the closer company for its own sales, or a fronter company for the sales its transfers produced.' },
  { key: 'closer_dispo', label: 'Unclosed Sale calls (Closer)', icon: PhoneOff, tint: '#dc2626', desc: 'The closers\' calls that did NOT close — a TRA that landed on the closer but ended with a non-sale disposition. Pick which codes count (none = any non-sale). With "Closed Sale" this covers EVERY closer call.' },
];
const wtDef = (k) => WORK_TYPE_DEFS.find(w => w.key === k) || { label: k, tint: 'var(--color-text-tertiary)', icon: Headphones };
const WT_SHORT = { tra: 'TRA', rcm: 'RCM', closer_sales: 'SALE', closer_dispo: 'UNCL' };

// ── small shared bits for the reporting surfaces ─────────────────────────────
const isoDay = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const todayISO = () => isoDay(new Date());
const daysAgoISO = (n) => isoDay(new Date(Date.now() - n * 86400000));
const fmtWhen = (ts) => { try { return ts ? new Date(String(ts).replace(' ', 'T')).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; } catch { return ''; } };
const agoOf = (ts) => { if (!ts) return '—'; const s = Math.floor((Date.now() - new Date(String(ts).replace(' ', 'T')).getTime()) / 1000); if (s < 60) return `${s}s ago`; const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`; const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`; return `${Math.floor(h / 24)}d ago`; };
const WtPill = ({ k, n }) => { const d = wtDef(k); return <span className="text-[9px] font-bold px-1 py-0.5 rounded" style={{ background: `${d.tint}1f`, color: d.tint }}>{WT_SHORT[k] || k}{n != null ? ` ${n}` : ''}</span>; };
// a company's currently-enabled review types, in a fixed order (tra/rcm from
// qa.methods, closer legs from qa.closer — default both on).
const enabledTypes = (co) => ['tra', 'rcm', 'closer_sales', 'closer_dispo']
  .filter(k => (k === 'tra' || k === 'rcm') ? (co.methods || []).includes(k) : (co.closer || []).includes(k));

function KpiStrip({ kpis }) {
  const tiles = [
    ['QA people', kpis ? kpis.qa_people : '—', kpis ? `${kpis.managers} mgr · ${kpis.agents} agent` : '', 'Everyone holding a QA manager or agent role, across all companies.'],
    ['Reviews (window)', kpis ? kpis.reviews : '—', kpis ? `${kpis.active_reviewers} active reviewer${kpis.active_reviewers === 1 ? '' : 's'}` : '', 'Completed reviews in the selected date window, and how many different people did them.'],
    ['Open backlog', kpis ? kpis.backlog : '—', 'unscored on plates', 'Calls assigned to QA people but not yet scored (pending + in-progress), across everyone.'],
    ['Pass rate', kpis ? (kpis.pass_rate == null ? '—' : `${kpis.pass_rate}%`) : '—', 'of scored w/ a verdict', 'Share of scored reviews that PASSED — only reviews that produce a pass/fail verdict are counted.'],
  ];
  return (
    <div className="grid gap-2 mb-3" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
      {tiles.map(([label, val, sub, tip]) => (
        <div key={label} className="p-3 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="text-[10px] font-bold uppercase tracking-wide flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}>{label} <InfoTip text={tip} /></div>
          <div className="text-2xl font-extrabold tabular-nums leading-tight" style={{ color: 'var(--color-text)' }}>{val}</div>
          <div className="text-[10px] truncate" style={{ color: 'var(--color-text-tertiary)' }}>{sub}</div>
        </div>
      ))}
    </div>
  );
}

// Productivity roster — every QA person + how much they're doing over the window.
function TeamReport({ team, onPick }) {
  const [sort, setSort] = useState({ k: 'reviews', dir: -1 });
  if (!team) return <div className="py-8 text-center"><Loader2 className="animate-spin inline" style={{ color: 'var(--color-text-tertiary)' }} /></div>;
  const rows = [...(team.reviewers || [])];
  const cell = (r, k) => ({ name: (r.name || '').toLowerCase(), reviews: r.reviews, per_day: r.per_day, open: r.open_tasks, avg: r.avg_final ?? r.avg_quality ?? -1, pass: r.pass_rate ?? -1, last: r.last_at || '' }[k]);
  rows.sort((a, b) => { const va = cell(a, sort.k), vb = cell(b, sort.k); if (va < vb) return -sort.dir; if (va > vb) return sort.dir; return 0; });
  const setS = (k) => setSort(s => s.k === k ? { k, dir: -s.dir } : { k, dir: k === 'name' ? 1 : -1 });
  const cols = [['name', 'Person'], ['open', 'Open'], ['reviews', 'Reviews'], ['per_day', '/day'], ['avg', 'Avg given'], ['pass', 'Pass %'], ['last', 'Last active']];
  const COL_TIP = { name: 'The QA person, their role(s) and the companies they cover.', open: 'Unscored calls on their plate right now (pending + in-progress).', reviews: 'Reviews they completed in the selected date window.', per_day: 'Reviews per ACTIVE day — only days they actually reviewed.', avg: 'The average score they GIVE — final score on TRA, quality % on closer/RCM.', pass: 'Share of their scored reviews that PASSED (only verdict-producing reviews).', last: 'When they last submitted a review.' };
  const exportCsv = () => {
    const head = ['Person', 'Roles', 'Companies', 'Open', 'Reviews', 'Per day', 'Active days', 'Avg final', 'Avg quality', 'Pass %', 'Avg turnaround (min)', 'Last active'];
    const lines = [head.join(',')].concat(rows.map(r => [r.name, r.levels.map(lvlLabel).join('+'), r.companies.map(c => c.company_name).join(' | '), r.open_tasks, r.reviews, r.per_day, r.active_days, r.avg_final ?? '', r.avg_quality ?? '', r.pass_rate ?? '', r.avg_turnaround_min ?? '', r.last_at || ''].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' }); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `qa-team-report.csv`; a.click(); URL.revokeObjectURL(url);
  };
  const Th = ({ k, label }) => <th onClick={() => setS(k)} title={COL_TIP[k] ? `${COL_TIP[k]} · click to sort` : 'click to sort'} className="text-left px-3 py-2 text-[11px] font-bold uppercase cursor-pointer select-none whitespace-nowrap" style={{ color: sort.k === k ? 'var(--color-primary-600)' : 'var(--color-text-tertiary)' }}>{label}{sort.k === k ? (sort.dir < 0 ? ' ↓' : ' ↑') : ''}</th>;
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs inline-flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}>{rows.length} QA people <InfoTip text="Every QA manager & agent with their productivity over the selected window. Click a column header to sort, or a row to open that person in Team." /></span>
        <button onClick={exportCsv} title="Download this roster (with turnaround + active-days) as a CSV for the selected window" className="ml-auto text-[11px] font-bold px-2.5 py-1 rounded-lg inline-flex items-center gap-1" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}>Export CSV</button>
      </div>
      <div className="rounded-xl overflow-auto" style={{ border: '1px solid var(--color-border)' }}>
        <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
          <thead className="sticky top-0" style={{ background: 'var(--color-surface-hover)' }}><tr>{cols.map(([k, l]) => <Th key={k} k={k} label={l} />)}</tr></thead>
          <tbody>
            {rows.map(r => {
              const avgLbl = r.avg_final != null ? `${r.avg_final}` : r.avg_quality != null ? `${r.avg_quality}%` : '—';
              return (
                <tr key={r.user_id} onClick={() => onPick?.(r.user_id)} className="cursor-pointer" style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td className="px-3 py-2">
                    <div className="font-semibold truncate inline-flex items-center gap-1.5" style={{ color: 'var(--color-text)', maxWidth: 240 }}>{r.name}
                      {r.levels.map(l => <span key={l} className="text-[8px] font-bold px-1 py-0.5 rounded uppercase" style={{ background: 'var(--color-surface-hover)', color: l === 'qa_manager' ? 'var(--color-primary-600)' : 'var(--color-warning-600)' }}>{lvlLabel(l)}</span>)}
                    </div>
                    <div className="text-[10px] mt-0.5 flex items-center gap-1 flex-wrap" style={{ color: 'var(--color-text-tertiary)' }}>
                      {r.companies.length ? r.companies.slice(0, 3).map(c => c.company_name).filter(Boolean).join(' · ') : <span style={{ color: 'var(--color-warning-600)' }}>no company access</span>}
                      {r.companies.length > 3 && <span>+{r.companies.length - 3}</span>}
                      {Object.keys(r.by_work_type || {}).length > 0 && <span className="inline-flex gap-0.5 ml-1">{Object.entries(r.by_work_type).map(([k, n]) => <WtPill key={k} k={k} n={n} />)}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums"><span style={{ color: r.open_tasks >= 25 ? '#dc2626' : r.open_tasks >= 15 ? '#d97706' : 'var(--color-text-secondary)', fontWeight: 700 }}>{r.open_tasks}</span></td>
                  <td className="px-3 py-2 text-right tabular-nums font-bold" style={{ color: 'var(--color-text)' }}>{r.reviews}</td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{r.per_day || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{avgLbl}</td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color: r.pass_rate == null ? 'var(--color-text-tertiary)' : r.pass_rate >= 60 ? 'var(--color-success-600)' : 'var(--color-error-600)', fontWeight: 700 }}>{r.pass_rate == null ? '—' : `${r.pass_rate}%`}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-[11px]" style={{ color: 'var(--color-text-tertiary)' }} title={fmtWhen(r.last_at)}>{r.last_at ? agoOf(r.last_at) : '—'}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={7} className="px-3 py-8 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No QA people yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// The "who did what, when" timeline — every completed review, newest first.
function resultOf(i) {
  if (i.final_score != null) return { text: `${i.passed ? 'Pass' : 'Fail'} · ${i.final_score}`, ok: i.passed };
  if (i.quality_score != null) return { text: `Quality ${i.quality_score}%`, ok: null };
  if (i.passed != null) return { text: i.passed ? 'Pass' : 'Fail', ok: i.passed };
  if (i.autofail_result) return { text: i.autofail_result, ok: i.autofail_result === 'Pass' };
  return { text: 'scored', ok: null };
}
function ActivityFeed({ coFilter, range, reviewers }) {
  const [items, setItems] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [reviewer, setReviewer] = useState('');
  const LIMIT = 60;
  const load = useCallback(() => {
    const params = { from: daysAgoISO(+range), to: todayISO(), limit: LIMIT, page };
    if (coFilter) params.company_id = coFilter;
    if (reviewer) params.reviewer_id = reviewer;
    setItems(null);
    client.get('qa/admin/activity', { params }).then(r => { setItems(r.data.items || []); if (r.data.total != null) setTotal(r.data.total); }).catch(() => setItems([]));
  }, [coFilter, range, page, reviewer]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [coFilter, range, reviewer]);
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-xs font-bold" style={{ color: 'var(--color-text-secondary)' }}>Activity</span>
        <InfoTip text="Every completed QA review, newest first: who reviewed whose call, for which company, the result, and when. Filter by reviewer or company; the date range is set above." />
        <ThemedSelect value={reviewer} onChange={e => setReviewer(e.target.value)} title="Show only the reviews done by one QA reviewer" style={{ ...inp, fontSize: 12, padding: '5px 10px' }}>
          <option value="">All reviewers</option>
          {(reviewers || []).map(r => <option key={r.user_id} value={r.user_id}>{r.name}</option>)}
        </ThemedSelect>
        {total > 0 && <span className="text-[11px] ml-auto" style={{ color: 'var(--color-text-tertiary)' }}>{total.toLocaleString()} reviews</span>}
      </div>
      {items === null ? <div className="py-8 text-center"><Loader2 className="animate-spin inline" style={{ color: 'var(--color-text-tertiary)' }} /></div>
        : !items.length ? <div className="py-10 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No reviews in this window.</div>
        : <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            {items.map((i, idx) => {
              const res = resultOf(i);
              return (
                <div key={i.id} className="flex items-center gap-2.5 px-3 py-2" style={{ borderTop: idx ? '1px solid var(--color-border)' : 'none', background: 'var(--color-surface)' }}>
                  <WtPill k={i.work_type} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] truncate" style={{ color: 'var(--color-text)' }}>
                      <b>{i.reviewer_name || 'A reviewer'}</b> <span style={{ color: 'var(--color-text-tertiary)' }}>reviewed</span> <b>{i.subject_name || 'a call'}</b>
                      {i.company_name && <span style={{ color: 'var(--color-text-tertiary)' }}> · {i.company_name}</span>}
                    </div>
                  </div>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded whitespace-nowrap" style={{ background: res.ok == null ? 'var(--color-surface-hover)' : res.ok ? 'rgba(5,150,105,0.14)' : 'rgba(220,38,38,0.12)', color: res.ok == null ? 'var(--color-text-secondary)' : res.ok ? '#059669' : '#dc2626' }}>{res.text}</span>
                  <span className="text-[11px] whitespace-nowrap tabular-nums" style={{ color: 'var(--color-text-tertiary)', width: 92, textAlign: 'right' }} title={fmtWhen(i.created_at)}>{agoOf(i.created_at)}</span>
                </div>
              );
            })}
          </div>}
      {total > LIMIT && (
        <div className="flex items-center justify-between mt-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-1.5">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 rounded-lg font-bold disabled:opacity-40" style={{ background: 'var(--color-surface-hover)' }}>Prev</button>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 rounded-lg font-bold disabled:opacity-40" style={{ background: 'var(--color-surface-hover)' }}>Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function QaAdminTab() {
  const [tab, setTab] = useState('overview');
  const [companies, setCompanies] = useState(null);
  const [users, setUsers] = useState(null);
  const [rules, setRules] = useState(null);   // eslint-disable-line no-unused-vars — kept for loadRules side-effect (mig-186 toast)
  const [expanded, setExpanded] = useState(null);   // company id whose config is open
  const [team, setTeam] = useState(null);     // { kpis, reviewers, window }
  const [range, setRange] = useState('30');   // report window in days
  const [coFilter, setCoFilter] = useState('');   // '' = all companies (Overview + Activity)
  const [jumpUser, setJumpUser] = useState(null); // person to open when jumping Overview → Team

  const loadUsers = useCallback(() => client.get('qa/admin/users').then(r => setUsers(r.data.users || [])).catch(() => setUsers([])), []);
  const loadRules = useCallback(() => client.get('qa/admin/rules').then(r => setRules(r.data.rules || [])).catch(e => { setRules([]); const m = e.response?.data?.error; if (m && /migration 186/.test(m)) toast.error(m); }), []);
  const loadTeam = useCallback(() => {
    setTeam(null);
    const params = { from: daysAgoISO(+range), to: todayISO() };
    if (coFilter) params.company_id = coFilter;
    client.get('qa/admin/team', { params }).then(r => setTeam(r.data)).catch(() => setTeam({ kpis: null, reviewers: [] }));
  }, [range, coFilter]);
  const load = useCallback(() => {
    client.get('qa/admin/overview').then(r => setCompanies(r.data.companies || [])).catch(() => setCompanies([]));
    loadUsers(); loadRules();
  }, [loadUsers, loadRules]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadTeam(); }, [loadTeam]);   // re-fetch productivity when window / company changes

  const toggleMethod = async (co, m) => {
    const methods = co.methods.includes(m) ? co.methods.filter(x => x !== m) : [...co.methods, m];
    setCompanies(cs => cs.map(c => c.id === co.id ? { ...c, methods } : c));
    try { const r = await client.put('qa/admin/company-methods', { company_id: co.id, methods }); const mm = r.data.materialized; if (mm && (mm.tra || mm.rcm)) toast.success(`QA on — pulled ${mm.tra || 0} TRA + ${mm.rcm || 0} RCM`); }
    catch { toast.error('Update failed'); load(); }
  };
  // Remove COMPANY ACCESS only — soft, reversible, never a user delete. The
  // backend also pauses their rules there + returns unscored calls to the pool.
  const removeAssign = async (ucrId, label) => {
    try {
      const r = await client.delete(`qa/admin/assign/${ucrId}`);
      const bits = [];
      if (r.data.released_tasks) bits.push(`${r.data.released_tasks} unscored call(s) returned to the pool`);
      if (r.data.paused_rules) bits.push(`${r.data.paused_rules} listening rule(s) paused`);
      toast.success(`Access removed${label ? ` from ${label}` : ''}. The account is NOT deleted — they stay in the QA team and can be re-added anytime.${bits.length ? ` ${bits.join('; ')}.` : ''}`, { duration: 7000 });
      loadUsers(); loadRules();
    } catch { toast.error('Remove failed'); }
  };
  // bind an agent's review method(s) for a company (drives which scorecard).
  const setAgentMethod = async (userId, companyId, current, m) => {
    const methods = current.includes(m) ? current.filter(x => x !== m) : [...current, m];
    setUsers(us => us.map(u => u.user_id === userId ? { ...u, companies: u.companies.map(c => c.company_id === companyId ? { ...c, methods } : c) } : u));
    try { await client.put('qa/agent-methods', { user_id: userId, company_id: companyId, methods }); }
    catch { toast.error('Method update failed'); loadUsers(); }
  };
  return (
    <div className="space-y-4 pb-6">
      {/* header + shared report filters (company + window apply to Overview & Activity) */}
      <div className="flex items-center gap-2 flex-wrap">
        <Shield size={18} style={{ color: 'var(--color-primary-600)' }} />
        <h2 className="text-base font-bold" style={{ color: 'var(--color-text)' }}>QA Department</h2>
        <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>Managers, agents, tasks &amp; reporting — one place. QA accounts are created by the Super Admin and appear here automatically.</span>
        <span className="ml-auto flex items-center gap-1.5">
          <ThemedSelect value={coFilter} onChange={e => setCoFilter(e.target.value)} style={{ ...inp, fontSize: 12, padding: '5px 10px' }} title="Filter the reports to one company">
            <option value="">All companies</option>
            {(companies || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </ThemedSelect>
          <ThemedSelect value={range} onChange={e => setRange(e.target.value)} style={{ ...inp, fontSize: 12, padding: '5px 10px' }} title="Reporting window">
            <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option>
          </ThemedSelect>
          <button onClick={() => { load(); loadTeam(); }} className="p-2 rounded-lg" style={{ background: 'var(--color-surface-hover)' }} title="Refresh"><RefreshCw size={14} style={{ color: 'var(--color-text-secondary)' }} /></button>
        </span>
      </div>

      {/* sub-tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 p-1 rounded-xl w-fit" style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-border)' }}>
          {[
            ['overview', 'Overview', 'Department KPIs + a productivity board: who is reviewing how much, the pass rate they give, and when they were last active.'],
            ['team', 'Team', 'Manage each QA person — which companies they can review, and which call types (TRA/RCM) their reviews are scored against.'],
            ['activity', 'Activity', 'A newest-first timeline of who reviewed whose call, for which company, the result, and when.'],
            ['companies', 'Companies', 'Turn the 4 review types on/off per company and set their scorecards, RCM sampling, and limits.'],
          ].map(([k, l, tip]) => (
            <button key={k} onClick={() => setTab(k)} title={tip} className="px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors"
              style={{ background: tab === k ? 'var(--gradient-sidebar, linear-gradient(135deg,#2563eb,#7c3aed))' : 'transparent', color: tab === k ? '#fff' : 'var(--color-text-secondary)' }}>{l}</button>
          ))}
        </div>
        <InfoTip w={320} text="Overview = who's reviewing how much. Team = manage QA people + their company / call-type access. Activity = the who-did-what-when timeline. Companies = turn review types on/off + settings per company. The company + date filters (top-right) apply to Overview and Activity." />
      </div>

      {/* OVERVIEW — KPIs + reviewer productivity */}
      {tab === 'overview' && (
        <section>
          <KpiStrip kpis={team?.kpis} />
          <div className="text-sm font-bold mb-1 flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
            Reviewer productivity
            <InfoTip w={300} text="Each QA person and how much they're doing over the selected window: open plate, reviews completed, per active day, the average score they GIVE, the pass rate they give, and when they were last active. Click a row to manage that person in Team." />
          </div>
          <TeamReport team={team} onPick={(uid) => { setJumpUser(uid); setTab('team'); }} />
        </section>
      )}

      {/* TEAM — person management (company access + methods) */}
      {tab === 'team' && (
        <section>
          <div className="text-sm font-bold mb-1 flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
            QA Team — who reviews, and where
            <InfoTip w={300} text="Every QA manager & agent. Give a person access to the companies they should review + which call types (TRA/RCM). The QA MANAGER hands out the actual calls from Load Day / Live. The Super Admin creates the accounts." />
          </div>
          <TeamConsole companies={companies || []} users={users} initialUser={jumpUser}
            reloadUsers={loadUsers} reloadAll={() => { load(); loadTeam(); }}
            removeAssign={removeAssign} setAgentMethod={setAgentMethod} />
        </section>
      )}

      {/* ACTIVITY — who did what, when */}
      {tab === 'activity' && (
        <section>
          <ActivityFeed coFilter={coFilter} range={range} reviewers={team?.reviewers} />
        </section>
      )}

      {/* COMPANIES — enable + configure per company */}
      {tab === 'companies' && (
        <section>
          <div className="text-sm font-bold mb-1 flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
            Companies — enable, configure &amp; route
            <InfoTip text="Turn on the review types per company, open the gear for the settings, and see who reviews that company's calls. If a company shows waiting calls with no reviewer, assign someone in the QA Team." />
          </div>
          <div className="text-[11px] mb-2 flex items-center gap-3 flex-wrap" style={{ color: 'var(--color-text-tertiary)' }}>
            <span><b style={{ color: 'var(--color-primary-600)' }}>TRA</b> = calls entered in the CRM — every transfer gets reviewed</span>
            <span><b style={{ color: 'var(--color-warning-600)' }}>RCM</b> = random raw dialer calls — sampled daily</span>
          </div>
          {companies === null ? <Loader2 className="animate-spin" style={{ color: 'var(--color-text-tertiary)' }} />
            : <div className="space-y-2">
                {companies.map(co => {
                  return (
                  <div key={co.id} className="rounded-xl overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                    <div className="flex items-center gap-2 p-2.5 cursor-pointer" onClick={() => setExpanded(e => e === co.id ? null : co.id)}>
                      <Building2 size={14} style={{ color: 'var(--color-text-tertiary)' }} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{co.name}</div>
                        <div className="text-[10px] uppercase" style={{ color: 'var(--color-text-tertiary)' }}>{co.company_type || ''}{co.qa_agents ? ` · ${co.qa_agents} agent${co.qa_agents === 1 ? '' : 's'}` : ''}</div>
                      </div>
                      {/* enabled review-type summary */}
                      <div className="flex items-center gap-1 flex-wrap justify-end" style={{ maxWidth: 280 }}>
                        {enabledTypes(co).length ? enabledTypes(co).map(k => <WtPill key={k} k={k} />)
                          : <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-warning-600)' }}>QA off</span>}
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); setExpanded(x => x === co.id ? null : co.id); }} title="Configure QA for this company" className="p-1.5 rounded-lg flex-shrink-0" style={{ background: expanded === co.id ? 'var(--color-surface-hover)' : 'transparent' }}>
                        <Settings2 size={14} style={{ color: 'var(--color-text-secondary)' }} />
                        <ChevronDown size={11} style={{ color: 'var(--color-text-tertiary)', transition: 'transform .15s', transform: expanded === co.id ? 'rotate(180deg)' : 'none' }} />
                      </button>
                    </div>
                    {expanded === co.id && <CompanyConfig company={co} onToggleMethod={(m) => toggleMethod(co, m)} onCloserChange={(closer) => setCompanies(cs => cs.map(c => c.id === co.id ? { ...c, closer } : c))} />}
                  </div>
                  );
                })}
              </div>}
        </section>
      )}
    </div>
  );
}

// ── STEP 2 — the person-centric console ──────────────────────────────────────
function TeamConsole({ companies, users, reloadUsers, reloadAll, removeAssign, setAgentMethod, initialUser }) {
  const [q, setQ] = useState('');
  const [lvl, setLvl] = useState('');
  const [sel, setSel] = useState(null);          // selected user_id
  useEffect(() => { if (initialUser) setSel(initialUser); }, [initialUser]);   // jump from the Overview roster
  const [addCo, setAddCo] = useState('');        // add-to-company picker
  const [addLvl, setAddLvl] = useState('qa_agent');
  const [confirmRemove, setConfirmRemove] = useState(null);   // ucr_id awaiting confirmation

  const shown = useMemo(() => {
    if (!users) return null;
    const term = q.trim().toLowerCase();
    return users.filter(u =>
      (!term || u.name.toLowerCase().includes(term)) &&
      (!lvl || u.levels.includes(lvl)));
  }, [users, q, lvl]);

  const person = (users || []).find(u => u.user_id === sel) || null;
  useEffect(() => { setAddCo(''); setConfirmRemove(null); }, [sel]);

  const addToCompany = async () => {
    if (!person || !addCo) return;
    try {
      await client.post('qa/admin/assign', { user_id: person.user_id, company_id: addCo, level: addLvl });
      toast.success(`${person.name} added as QA ${lvlLabel(addLvl).toLowerCase()}`);
      setAddCo(''); reloadUsers();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not add'); }
  };

  if (users === null) return <Loader2 className="animate-spin" style={{ color: 'var(--color-text-tertiary)' }} />;
  if (!users.length) return <div className="text-sm p-4 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-tertiary)' }}>No QA people yet — ask the Super Admin to create QA manager/agent accounts; they appear here automatically.</div>;

  const notIn = companies.filter(c => person && !person.companies.some(pc => pc.company_id === c.id));

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: '280px 1fr', alignItems: 'start' }}>
      {/* LEFT — quality people only */}
      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="p-2 space-y-1.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-1 px-2 rounded-lg" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
            <Search size={12} style={{ color: 'var(--color-text-tertiary)' }} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search QA people…" style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--color-text)', fontSize: 12, padding: '5px 2px', width: '100%' }} />
          </div>
          <div className="flex items-center gap-1">
            {[['', 'All'], ['qa_manager', 'Managers'], ['qa_agent', 'Agents']].map(([k, l]) => (
              <button key={k} onClick={() => setLvl(k)} className="text-[10px] font-bold px-2 py-1 rounded-lg flex-1"
                style={lvl === k ? { background: 'var(--color-primary-600)', color: '#fff' } : { background: 'var(--color-bg)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>{l}</button>
            ))}
          </div>
        </div>
        <div className="max-h-[380px] overflow-auto">
          {!shown.length ? <div className="text-[11px] p-3" style={{ color: 'var(--color-text-tertiary)' }}>No QA people match.</div>
            : shown.map(u => {
              const active = sel === u.user_id;
              return (
                <button key={u.user_id} onClick={() => setSel(u.user_id)}
                  className="w-full text-left flex items-center gap-2 px-2.5 py-2"
                  style={{ background: active ? 'var(--color-surface-hover)' : 'transparent', borderLeft: active ? '3px solid var(--color-primary-600)' : '3px solid transparent', borderBottom: '1px solid var(--color-border)' }}>
                  <span className="inline-flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 26, height: 26, background: 'var(--color-primary-100, #e0e7ff)' }}>
                    <User size={13} style={{ color: 'var(--color-primary-700, #4338ca)' }} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold truncate" style={{ color: 'var(--color-text)' }}>{u.name}</span>
                    <span className="block text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{u.levels.map(lvlLabel).join(' + ')} · {u.companies.length} compan{u.companies.length === 1 ? 'y' : 'ies'}</span>
                  </span>
                  {u.open_tasks > 0 && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full tabular-nums" title={`${u.open_tasks} open call(s) on their plate right now`}
                      style={u.open_tasks >= 25 ? { background: 'rgba(220,38,38,0.12)', color: '#dc2626' } : u.open_tasks >= 15 ? { background: 'rgba(217,119,6,0.12)', color: '#d97706' } : { background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}>
                      {u.open_tasks}
                    </span>
                  )}
                  <ChevronRight size={13} style={{ color: 'var(--color-text-tertiary)' }} />
                </button>
              );
            })}
        </div>
        <div className="p-2 text-[10px] flex items-center gap-1.5" style={{ color: 'var(--color-text-tertiary)', borderTop: '1px solid var(--color-border)' }}>
          <Lock size={11} /> New QA accounts are created by the Super Admin.
        </div>
      </div>

      {/* RIGHT — the selected person's file */}
      {!person ? (
        <div className="rounded-xl p-8 text-center" style={{ background: 'var(--color-surface)', border: '1px dashed var(--color-border)' }}>
          <Headphones size={22} className="inline mb-2" style={{ color: 'var(--color-text-tertiary)' }} />
          <div className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>Pick a QA person on the left</div>
          <div className="text-[11px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>Then give them access to the companies they should review. The QA manager assigns the actual calls from Load Day.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {/* header */}
          <div className="flex items-center gap-2.5 p-3 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <span className="inline-flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 34, height: 34, background: 'var(--color-primary-100, #e0e7ff)' }}>
              <User size={17} style={{ color: 'var(--color-primary-700, #4338ca)' }} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-extrabold truncate" style={{ color: 'var(--color-text)' }}>{person.name}</div>
              <div className="flex items-center gap-1 mt-0.5">{person.levels.map(l => <span key={l} className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase" style={{ background: 'var(--color-surface-hover)', color: l === 'qa_manager' ? 'var(--color-primary-600)' : 'var(--color-warning-600)' }}>{lvlLabel(l)}</span>)}</div>
            </div>
            <span className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded-lg tabular-nums"
              title="Open (unscored) calls on their plate right now"
              style={(person.open_tasks || 0) >= 25 ? { background: 'rgba(220,38,38,0.10)', color: '#dc2626' } : { background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}>
              <Headphones size={11} /> {person.open_tasks || 0} on their plate
            </span>
          </div>

          {/* company access */}
          <div className="p-3 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="text-[10px] font-bold uppercase tracking-wide mb-2 flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}>
              Company access <InfoTip text="The companies this person can review. For agents, the TRA/RCM chips set which scorecard applies to that type. The QA manager then distributes the actual calls from Load Day. × removes them from that company." />
            </div>
            <div className="flex flex-wrap gap-1.5 items-center">
              {person.companies.map(c => {
                const coName = c.company_name || c.company_id.slice(0, 6);
                // × asks first — one accidental click must never remove access.
                if (confirmRemove === c.ucr_id) return (
                  <span key={c.ucr_id} className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg" style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid #dc262666', color: 'var(--color-text-secondary)' }}>
                    <span>Remove <b style={{ color: 'var(--color-text)' }}>{person.name}</b> from <b style={{ color: 'var(--color-text)' }}>{coName}</b>? Their unscored calls return to the pool; the account is <b>not</b> deleted.</span>
                    <button onClick={() => { setConfirmRemove(null); removeAssign(c.ucr_id, coName); }} className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: '#dc2626', color: '#fff' }}>Remove access</button>
                    <button onClick={() => setConfirmRemove(null)} className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}>Keep</button>
                  </span>
                );
                return (
                  <span key={c.ucr_id} className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                    <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{coName}</span>
                    {c.level === 'qa_agent' ? (
                      <span className="inline-flex items-center gap-0.5">
                        {METHODS.map(([k, l]) => {
                          const on = (c.methods || []).includes(k);
                          return <button key={k} onClick={() => setAgentMethod(person.user_id, c.company_id, c.methods || [], k)} title={`${l} — bind this agent to the ${l} section for ${coName}: their reviews here use the ${l} scorecard, and Distribute can hand them ${l} calls. Click to ${on ? 'unbind' : 'bind'}.`} className="font-bold px-1 rounded uppercase text-[10px]"
                            style={on ? { background: k === 'tra' ? 'rgba(37,99,235,0.18)' : 'rgba(217,119,6,0.18)', color: k === 'tra' ? 'var(--color-primary-600)' : 'var(--color-warning-600)' } : { color: 'var(--color-text-tertiary)', border: '1px solid var(--color-border)' }}>{on ? '✓' : ''}{l}</button>;
                        })}
                      </span>
                    ) : <span className="text-[10px] font-bold" style={{ color: 'var(--color-primary-600)' }}>MGR</span>}
                    <button onClick={() => setConfirmRemove(c.ucr_id)} title="Remove access to this company (asks first — never deletes the account)"><X size={12} style={{ color: 'var(--color-error-600)' }} /></button>
                  </span>
                );
              })}
              {!person.companies.length && <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>No company access right now — the account still exists. Use “+ add to company” to restore it.</span>}
              {notIn.length > 0 && (
                <span className="inline-flex items-center gap-1 ml-1">
                  <ThemedSelect value={addCo} onChange={e => setAddCo(e.target.value)} style={{ ...inp, fontSize: 11, padding: '4px 6px' }}>
                    <option value="">+ add to company…</option>
                    {notIn.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </ThemedSelect>
                  {addCo && <>
                    <ThemedSelect value={addLvl} onChange={e => setAddLvl(e.target.value)} style={{ ...inp, fontSize: 11, padding: '4px 6px' }}>
                      <option value="qa_agent">Agent</option><option value="qa_manager">Manager</option>
                    </ThemedSelect>
                    <button onClick={addToCompany} className="p-1 rounded-lg" style={{ background: 'var(--color-primary-600)' }} title="Add"><Plus size={12} color="#fff" /></button>
                  </>}
                </span>
              )}
            </div>
          </div>

          <div className="text-[11px] p-2.5 rounded-xl leading-relaxed" style={{ background: 'var(--color-surface)', border: '1px dashed var(--color-border)', color: 'var(--color-text-secondary)' }}>
            <Headphones size={12} className="inline mr-1" style={{ color: 'var(--color-primary-600)' }} />
            Calls are assigned to this person by the <b>QA manager</b> in the <b>Load Day</b> screen — fetch a dialer day, then distribute the calls (equally across agents or to one). Here you only control which companies they can review.
          </div>
        </div>
      )}
    </div>
  );
}

// ── work-rule builder — standalone (Step 3) or person-fixed (Team console) ────
// Person-fixed by design: the QA Team console is the ONLY place assignments are
// created, so fixedReviewer is always provided.
function RuleBuilder({ companies, onDone, onCancel, fixedReviewer }) {
  const [companyId, setCompanyId] = useState('');
  const [types, setTypes] = useState([]);
  const [subjectMode, setSubjectMode] = useState('all');   // all | specific
  const [subjects, setSubjects] = useState([]);
  const [dispos, setDispos] = useState([]);
  const [dispoAdd, setDispoAdd] = useState('');
  const [companyUsers, setCompanyUsers] = useState(null);
  const [dispoOptions, setDispoOptions] = useState([]);
  const [accessLevel, setAccessLevel] = useState('qa_agent');   // when adding access on the fly
  const [runNow, setRunNow] = useState(true);
  const [busy, setBusy] = useState(false);

  const rid = fixedReviewer.user_id;
  const personEntry = (fixedReviewer.companies || []).find(c => c.company_id === companyId) || null;
  const needsAccess = !!companyId && !personEntry;

  useEffect(() => {
    if (!companyId) { setCompanyUsers(null); setDispoOptions([]); return; }
    setCompanyUsers(null); setSubjects([]);
    client.get('qa/admin/company-users', { params: { company_id: companyId } }).then(r => setCompanyUsers(r.data.users || [])).catch(() => setCompanyUsers([]));
    client.get('qa/admin/dispositions', { params: { company_id: companyId } }).then(r => setDispoOptions(r.data.dispositions || [])).catch(() => setDispoOptions([]));
  }, [companyId]);

  const toggleType = (k) => setTypes(ts => ts.includes(k) ? ts.filter(x => x !== k) : [...ts, k]);
  const toggleSubject = (id) => setSubjects(ss => ss.includes(id) ? ss.filter(x => x !== id) : [...ss, id]);
  const toggleDispo = (c) => setDispos(ds => ds.includes(c) ? ds.filter(x => x !== c) : [...ds, c]);
  const addDispo = () => { const c = dispoAdd.trim().toUpperCase(); if (c && !dispos.includes(c)) setDispos(ds => [...ds, c]); setDispoAdd(''); };

  const save = async () => {
    if (!companyId || !types.length) return toast.error('Pick a company and at least one kind of call');
    if (subjectMode === 'specific' && !subjects.length) return toast.error('Pick at least one agent to listen to, or switch back to All agents');
    setBusy(true);
    try {
      // 1. company access on the fly
      if (needsAccess) await client.post('qa/admin/assign', { user_id: rid, company_id: companyId, level: accessLevel });
      // 2. Method binding = company-wide "catch-all" coverage (Distribute uses it).
      //    Bind it ONLY when the rule covers ALL agents — otherwise a
      //    "listen to 3 specific users" reviewer would ALSO be flooded with the
      //    whole company via Distribute. Specific-user rules route via the rule
      //    alone, so they stay focused.
      const isAgent = personEntry ? personEntry.level === 'qa_agent' : accessLevel === 'qa_agent';
      if (isAgent && subjectMode === 'all') {
        const implied = [...new Set(types.map(t => t === 'tra' ? 'tra' : 'rcm'))];
        const merged = [...new Set([...(personEntry?.methods || []), ...implied])];
        await client.put('qa/agent-methods', { user_id: rid, company_id: companyId, methods: merged }).catch(() => {});
      }
      // 3. the rule itself
      await client.post('qa/admin/rules', {
        company_id: companyId, reviewer_id: rid, work_types: types,
        subject_user_ids: subjectMode === 'specific' ? subjects : [],
        dispositions: types.includes('closer_dispo') ? dispos : [],
      });
      // 4. optionally pull + route right away
      if (runNow) {
        try {
          const r = await client.post('qa/admin/rules/apply', { company_id: companyId });
          const held = r.data.held || 0;
          toast.success(`Assigned — routed ${r.data.routed} call(s) now${held ? `; ${held} waiting behind the workload cap (they'll flow in as reviews get done)` : ''}. New calls follow automatically.`);
        } catch { toast.success('Assigned — matching calls route automatically from now on.'); }
      } else {
        toast.success('Assigned — matching calls route automatically from now on.');
      }
      onDone();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not create the assignment'); }
    finally { setBusy(false); }
  };

  return (
    <div className="p-3.5 rounded-xl space-y-3" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-primary-600)' }}>
      <div className="flex items-center gap-2">
        <Headphones size={15} style={{ color: 'var(--color-primary-600)' }} />
        <span className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>Assign work to {fixedReviewer.name}</span>
        <button onClick={onCancel} className="ml-auto"><X size={16} style={{ color: 'var(--color-text-tertiary)' }} /></button>
      </div>

      {/* where */}
      <div className="grid gap-2" style={{ gridTemplateColumns: '1fr' }}>
        <label className="text-[11px] font-bold" style={{ color: 'var(--color-text-tertiary)' }}>COMPANY
          <ThemedSelect value={companyId} onChange={e => setCompanyId(e.target.value)} style={{ ...inp, display: 'block', width: '100%', marginTop: 3 }}>
            <option value="">Choose company…</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}{(fixedReviewer.companies || []).some(pc => pc.company_id === c.id) ? ' ✓' : ''}</option>)}
          </ThemedSelect>
        </label>
      </div>
      {needsAccess && (
        <div className="flex items-center gap-2 text-[11px] p-2 rounded-lg" style={{ background: 'rgba(217,119,6,0.08)', color: 'var(--color-warning-600)' }}>
          <Plus size={12} /> Not in this company yet — they'll be added automatically as
          <ThemedSelect value={accessLevel} onChange={e => setAccessLevel(e.target.value)} style={{ ...inp, fontSize: 11, padding: '3px 6px' }}>
            <option value="qa_agent">Agent</option><option value="qa_manager">Manager</option>
          </ThemedSelect>
        </div>
      )}

      {/* what kinds of calls — all 4, grouped Fronter vs Closer so none is missed */}
      <div>
        <div className="text-[11px] font-bold mb-1.5" style={{ color: 'var(--color-text-tertiary)' }}>KINDS OF CALLS TO REVIEW <span className="font-normal">— tick any combination (a call has a fronter leg and a closer leg)</span></div>
        {[['Fronter calls', ['tra', 'rcm']], ['Closer calls', ['closer_sales', 'closer_dispo']]].map(([groupLabel, keys]) => (
          <div key={groupLabel} className="mb-2">
            <div className="text-[9px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-text-tertiary)' }}>{groupLabel}</div>
            <div className="space-y-1.5">
              {keys.map(k => WORK_TYPE_DEFS.find(w => w.key === k)).map(w => {
                const on = types.includes(w.key); const I = w.icon;
                return (
                  <button key={w.key} onClick={() => toggleType(w.key)} className="w-full text-left p-2 rounded-lg flex items-start gap-2"
                    style={{ background: on ? `${w.tint}12` : 'var(--color-bg)', border: `1px solid ${on ? w.tint : 'var(--color-border)'}` }}>
                    <span className="inline-flex items-center justify-center rounded flex-shrink-0" style={{ width: 18, height: 18, background: on ? w.tint : 'var(--color-surface-hover)' }}>
                      {on ? <Check size={12} color="#fff" /> : <I size={12} style={{ color: w.tint }} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-bold" style={{ color: on ? w.tint : 'var(--color-text)' }}>{w.label}</span>
                      <span className="block text-[10px] leading-snug mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>{w.desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* dispositions — only for closer_dispo */}
      {types.includes('closer_dispo') && (
        <div>
          <div className="text-[11px] font-bold mb-1.5" style={{ color: 'var(--color-text-tertiary)' }}>WHICH DISPOSITIONS <span className="font-normal">— none picked = any non-SALE</span></div>
          <div className="flex flex-wrap gap-1.5 items-center">
            {dispoOptions.map(d => (
              <button key={d.code} onClick={() => toggleDispo(d.code)} className="text-[11px] font-bold px-2 py-1 rounded-lg"
                style={dispos.includes(d.code) ? { background: 'rgba(220,38,38,0.12)', color: '#dc2626', border: '1px solid #dc262666' } : { background: 'var(--color-bg)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                {d.code} <span className="font-normal opacity-70">({d.count})</span>
              </button>
            ))}
            {dispos.filter(c => !dispoOptions.some(o => o.code === c)).map(c => (
              <button key={c} onClick={() => toggleDispo(c)} className="text-[11px] font-bold px-2 py-1 rounded-lg" style={{ background: 'rgba(220,38,38,0.12)', color: '#dc2626', border: '1px solid #dc262666' }}>{c}</button>
            ))}
            <input value={dispoAdd} onChange={e => setDispoAdd(e.target.value)} onKeyDown={e => e.key === 'Enter' && addDispo()} placeholder="Add code…" style={{ ...inp, width: 90, fontSize: 11, padding: '4px 8px' }} />
          </div>
        </div>
      )}

      {/* whose calls */}
      <div>
        <div className="text-[11px] font-bold mb-1.5" style={{ color: 'var(--color-text-tertiary)' }}>LISTEN TO</div>
        <div className="flex items-center gap-2 mb-1.5">
          {[['all', 'All agents', Users], ['specific', 'Specific agents', User]].map(([k, l, I]) => (
            <button key={k} onClick={() => setSubjectMode(k)} className="text-[11px] font-bold px-2.5 py-1 rounded-lg inline-flex items-center gap-1"
              style={subjectMode === k ? { background: 'var(--color-primary-600)', color: '#fff' } : { background: 'var(--color-bg)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
              <I size={11} />{l}
            </button>
          ))}
          {subjectMode === 'specific' && <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{subjects.length} selected — single or multiple, your choice</span>}
        </div>
        {subjectMode === 'specific' && (
          !companyId ? <div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>Pick a company first to see its agents.</div>
          : companyUsers === null ? <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-text-tertiary)' }} />
          : !companyUsers.length ? <div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>No fronters/closers found in this company.</div>
          : <div className="flex flex-wrap gap-1.5 max-h-32 overflow-auto">
              {companyUsers.map(u => {
                // RCM needs a dialer mapping to attribute raw calls; warn if missing
                const rcmNeedsDialer = types.includes('rcm') && !u.has_dialer;
                return (
                <button key={u.user_id} onClick={() => toggleSubject(u.user_id)} className="text-[11px] px-2 py-1 rounded-lg"
                  title={rcmNeedsDialer ? 'No dialer id mapped — this person\'s RANDOM (RCM) raw calls can\'t be sampled until their vicidial_agent_ids is set on their profile.' : (u.linked ? `Closer at the linked company ${u.company_name || ''} — receives this company's transferred calls` : undefined)}
                  style={subjects.includes(u.user_id) ? { background: 'var(--color-primary-100, #e0e7ff)', color: 'var(--color-primary-700, #4338ca)', border: '1px solid var(--color-primary-300, #c7d2fe)', fontWeight: 700 } : { background: 'var(--color-bg)', color: 'var(--color-text-secondary)', border: `1px solid ${rcmNeedsDialer ? '#dc262655' : 'var(--color-border)'}` }}>
                  {subjects.includes(u.user_id) ? '✓ ' : ''}{u.name} <span className="opacity-60">· {u.level.replace('_', ' ')}{u.linked && u.company_name ? ` @ ${u.company_name}` : ''}</span>
                  {rcmNeedsDialer && <span title="No dialer mapping" style={{ color: '#dc2626', marginLeft: 3 }}>⚠</span>}
                </button>
                );
              })}
              {types.includes('rcm') && companyUsers.some(u => subjects.includes(u.user_id) && !u.has_dialer) && (
                <div className="w-full text-[10px] mt-1" style={{ color: 'var(--color-warning-600)' }}>⚠ Users marked ⚠ have no dialer id — their random (RCM) calls can't be pulled until their dialer mapping is set. TRA/closer reviews still work for them.</div>
              )}
            </div>
        )}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <label className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
          <input type="checkbox" checked={runNow} onChange={e => setRunNow(e.target.checked)} /> Route matching calls now
          <InfoTip text="Pull the matching calls that already exist and hand them to this reviewer immediately. New calls route automatically either way." />
        </label>
        <span className="ml-auto flex items-center gap-2">
          <button onClick={onCancel} className="px-3 py-2 rounded-lg text-xs font-semibold" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}>Cancel</button>
          <button onClick={save} disabled={busy} className="px-4 py-2 rounded-lg text-xs font-bold text-white inline-flex items-center gap-1.5"
            style={{ background: 'var(--gradient-sidebar, linear-gradient(135deg,#2563eb,#7c3aed))', opacity: busy ? 0.6 : 1 }}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Assign
          </button>
        </span>
      </div>
    </div>
  );
}

// ── STEP 3 — rules overview grouped by company (read-only + Run now/pause/×).
// Assignments are CREATED in one place only: the QA Team console above — this
// section is the by-company view of the same rules, so there's never a second,
// competing "assign" flow to confuse anyone. ──────────────────────────────────
function RulesSection({ rules, reload }) {
  const [applying, setApplying] = useState(null);   // company id being run

  const toggle = async (rule) => {
    try { await client.put(`qa/admin/rules/${rule.id}`, { is_active: !rule.is_active }); reload(); }
    catch { toast.error('Could not update rule'); }
  };
  const remove = async (rule) => {
    try { await client.delete(`qa/admin/rules/${rule.id}`); toast.success('Rule removed'); reload(); }
    catch { toast.error('Could not remove rule'); }
  };
  const runNow = async (companyId) => {
    setApplying(companyId);
    try {
      const r = await client.post('qa/admin/rules/apply', { company_id: companyId });
      const bits = [];
      const m = r.data.materialized || {}; const c = r.data.closer || {};
      if (m.tra) bits.push(`${m.tra} TRA`); if (m.rcm) bits.push(`${m.rcm} RCM`);
      if (c.closer_sales) bits.push(`${c.closer_sales} sales`); if (c.closer_dispo) bits.push(`${c.closer_dispo} dispo`);
      const held = r.data.held || 0;
      toast.success(`Rules ran — pulled ${bits.length ? bits.join(' + ') : 'no new calls'}, routed ${r.data.routed} task(s)${held ? `; ${held} waiting behind the workload cap` : ''}`);
    } catch (e) { toast.error(e.response?.data?.error || 'Run failed'); }
    finally { setApplying(null); }
  };

  const byCompany = useMemo(() => {
    const m = {};
    for (const r of (rules || [])) (m[r.company_id] ||= { name: r.company_name, rules: [] }).rules.push(r);
    return m;
  }, [rules]);

  return (
    <div className="space-y-3">
      {rules === null ? <Loader2 className="animate-spin" style={{ color: 'var(--color-text-tertiary)' }} />
        : !rules.length ? (
          <div className="text-[12px] p-3 rounded-xl leading-relaxed" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
            No listening assignments yet. Create them in the <b>QA Team</b> console above — pick a person, click <b>Assign work</b>. They'll appear here grouped by company.
          </div>
        ) : Object.entries(byCompany).map(([coId, g]) => (
          <div key={coId} className="rounded-xl overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <Building2 size={13} style={{ color: 'var(--color-text-tertiary)' }} />
              <span className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>{g.name || coId.slice(0, 8)}</span>
              <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{g.rules.length} rule{g.rules.length === 1 ? '' : 's'}</span>
              <button onClick={() => runNow(coId)} disabled={applying === coId}
                className="ml-auto text-[11px] font-bold px-2.5 py-1 rounded-lg inline-flex items-center gap-1"
                style={{ background: 'var(--color-primary-600)', color: '#fff', opacity: applying === coId ? 0.6 : 1 }}
                title="Pull the matching calls and route them to the rule reviewers right now">
                {applying === coId ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Run now
              </button>
            </div>
            <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
              {g.rules.map(r => (
                <div key={r.id} className="flex items-start gap-2 px-3 py-2" style={{ opacity: r.is_active ? 1 : 0.45 }}>
                  <Headphones size={14} className="mt-0.5" style={{ color: 'var(--color-primary-600)' }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{r.reviewer_name || r.reviewer_id.slice(0, 6)} <span className="text-[11px] font-normal" style={{ color: 'var(--color-text-tertiary)' }}>listens to</span></div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(r.work_types || []).map(k => { const d = wtDef(k); const I = d.icon; return (
                        <span key={k} className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${d.tint}18`, color: d.tint }}><I size={10} />{d.label}</span>
                      ); })}
                      {(r.work_types || []).includes('closer_dispo') && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}>
                          {(r.dispositions || []).length ? `dispo: ${r.dispositions.join(', ')}` : 'dispo: any non-SALE'}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}>
                        {(r.subject_names || []).length ? <><User size={10} />{r.subject_names.join(', ')}</> : <><Users size={10} />all agents</>}
                      </span>
                    </div>
                  </div>
                  <button onClick={() => toggle(r)} className="text-[10px] font-bold px-2 py-1 rounded uppercase" style={r.is_active ? { background: 'rgba(5,150,105,0.14)', color: '#059669' } : { background: 'var(--color-surface-hover)', color: 'var(--color-text-tertiary)' }}>{r.is_active ? 'Active' : 'Paused'}</button>
                  <button onClick={() => remove(r)} title="Delete rule"><X size={14} style={{ color: 'var(--color-error-600)' }} /></button>
                </div>
              ))}
            </div>
          </div>
        ))}

    </div>
  );
}

// ── per-company QA config (RCM sampling, covers, retention) ──────────────────
function CompanyConfig({ company, onToggleMethod, onCloserChange }) {
  const companyId = company.id;
  const companyType = company.company_type;
  const methods = company.methods || [];
  const closerOn = company.closer || [];
  const [cfg, setCfg] = useState(null);
  const [cards, setCards] = useState(null);     // active scorecard present per slot
  const [dispos, setDispos] = useState(null);   // this company's closer dispositions
  useEffect(() => {
    client.get('qa/admin/company-config', { params: { company_id: companyId } }).then(r => setCfg(r.data.config || {})).catch(() => setCfg({}));
    client.get('qa/scorecards', { params: { company_id: companyId } }).then(r => { const by = {}; for (const c of (r.data.scorecards || [])) if (c.is_active) by[c.method] = true; setCards(by); }).catch(() => setCards({}));
  }, [companyId]);
  // Dispositions power ONLY the Unclosed-Sale picker and are the heavy scan, so
  // fetch them lazily — only the first time that section is actually shown.
  const wantDispos = closerOn.includes('closer_dispo');
  useEffect(() => {
    if (wantDispos && dispos === null) client.get('qa/admin/dispositions', { params: { company_id: companyId } }).then(r => setDispos(r.data.dispositions || [])).catch(() => setDispos([]));
  }, [wantDispos, dispos, companyId]);
  const setKey = async (key, value) => {
    setCfg(c => ({ ...c, [key]: value }));
    try { await client.put('qa/admin/company-config', { company_id: companyId, key, value }); }
    catch { toast.error('Save failed'); }
  };
  const toggleCloser = (k) => {
    const next = closerOn.includes(k) ? closerOn.filter(x => x !== k) : [...new Set([...closerOn, k])];
    onCloserChange(next);   // optimistic — keeps the header summary live
    client.put('qa/admin/company-config', { company_id: companyId, key: 'qa.closer', value: next }).catch(() => toast.error('Save failed'));
  };
  if (!cfg) return <div className="p-3" style={{ borderTop: '1px solid var(--color-border)' }}><Loader2 className="animate-spin" size={14} style={{ color: 'var(--color-text-tertiary)' }} /></div>;
  const rcm = (cfg['qa.rcm.sample'] && typeof cfg['qa.rcm.sample'] === 'object') ? cfg['qa.rcm.sample'] : { mode: 'percentage', value: 10, period: 'week' };
  const covers = Array.isArray(cfg['qa.rcm.covers']) ? cfg['qa.rcm.covers'] : ['fronter'];
  const retention = cfg['qa.retention_days'] ?? 2;
  const unclDispos = Array.isArray(cfg['qa.closer_dispo.dispositions']) ? cfg['qa.closer_dispo.dispositions'] : [];
  const unclSet = new Set(unclDispos.map(x => String(x).toUpperCase()));
  const toggleUncl = (code) => { const c = String(code).toUpperCase(); const next = unclSet.has(c) ? unclDispos.filter(x => String(x).toUpperCase() !== c) : [...unclDispos, c]; setKey('qa.closer_dispo.dispositions', next); };

  const ScoreStatus = ({ slot }) => {
    const has = cards && cards[slot];
    return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={has ? { background: 'rgba(5,150,105,0.14)', color: '#059669' } : { background: 'rgba(217,119,6,0.14)', color: 'var(--color-warning-600)' }} title={has ? 'An active scorecard exists for this type.' : 'No active scorecard yet — set one in the QA app → Scorecards & Config, otherwise this type can’t be scored.'}>{has ? '✓ scorecard' : '⚠ no scorecard'}</span>;
  };
  const TypeCard = ({ k, label, desc, on, onToggle, children }) => {
    const d = wtDef(k);
    return (
      <div className="p-2.5 rounded-xl" style={{ background: on ? `${d.tint}0e` : 'var(--color-bg)', border: `1px solid ${on ? d.tint + '66' : 'var(--color-border)'}` }}>
        <div className="flex items-start gap-2">
          <button onClick={onToggle} className="text-[10px] font-bold px-2 py-1 rounded uppercase flex-shrink-0" style={on ? { background: `${d.tint}22`, color: d.tint, border: `1px solid ${d.tint}` } : { background: 'var(--color-surface-hover)', color: 'var(--color-text-tertiary)', border: '1px solid transparent' }}>{on ? '✓ On' : 'Off'}</button>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold inline-flex items-center gap-1.5 flex-wrap" style={{ color: 'var(--color-text)' }}>{label} <ScoreStatus slot={k} /></div>
            <div className="text-[10px] leading-snug mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>{desc}</div>
          </div>
        </div>
        {on && children && <div className="mt-2 pt-2" style={{ borderTop: '1px dashed var(--color-border)' }}>{children}</div>}
      </div>
    );
  };
  const Row = ({ title, tip, children, sub }) => (
    <div className="flex items-start gap-3 py-2" style={{ borderBottom: '1px dashed var(--color-border)' }}>
      <div style={{ width: 210 }} className="flex-shrink-0">
        <div className="text-xs font-bold flex items-center gap-1" style={{ color: 'var(--color-text)' }}>{title}{tip && <InfoTip text={tip} />}</div>
        {sub && <div className="text-[10px] mt-0.5 leading-snug" style={{ color: 'var(--color-text-tertiary)' }}>{sub}</div>}
      </div>
      <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">{children}</div>
    </div>
  );

  return (
    <div className="px-3 pb-3 pt-1" style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-bg)' }}>
      <div className="text-[10px] font-bold uppercase tracking-wide mt-1 mb-1.5 flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}>
        Review types <InfoTip w={320} text="The 4 QA review types for this company. FRONTER: TRA (every CRM transfer) + RCM (random raw dialer calls). CLOSER: Closed Sale + Unclosed Sale — the closer's leg of each transfer. Each type has its OWN scorecard, set in the QA app → Scorecards & Config; the badge shows whether one exists." />
      </div>
      <div className="mb-1 text-[9px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-primary-600)' }}>Fronter calls</div>
      <div className="grid gap-2 mb-2.5" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <TypeCard k="tra" label="TRA · Transfers" desc="Reviews every transfer entered in the CRM — full coverage of the fronter leg." on={methods.includes('tra')} onToggle={() => onToggleMethod('tra')} />
        <TypeCard k="rcm" label="RCM · Random" desc="A daily random sample of the fronters' raw dialer calls (numbers NOT in the CRM)." on={methods.includes('rcm')} onToggle={() => onToggleMethod('rcm')}>
          <div className="flex items-center gap-1.5 flex-wrap">
            <ThemedSelect value={rcm.mode} onChange={e => setKey('qa.rcm.sample', { ...rcm, mode: e.target.value })} style={{ ...inp, fontSize: 11, padding: '4px 8px' }}><option value="fixed">A fixed number</option><option value="percentage">A percentage</option></ThemedSelect>
            <input type="number" value={rcm.value} onChange={e => setKey('qa.rcm.sample', { ...rcm, value: +e.target.value })} style={{ ...inp, width: 58, fontSize: 11, padding: '4px 8px' }} />
            <span className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>{rcm.mode === 'percentage' ? '%' : 'calls'}</span>
            <ThemedSelect value={rcm.period} onChange={e => setKey('qa.rcm.sample', { ...rcm, period: e.target.value })} style={{ ...inp, fontSize: 11, padding: '4px 8px' }}><option value="day">/day</option><option value="week">/week</option></ThemedSelect>
            {(() => {
              const opts = companyType === 'fronter' ? [['fronter', 'fronters']] : companyType === 'closer' ? [['closer', 'closers']] : [['fronter', 'fronters'], ['closer', 'closers']];
              return <><span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>of:</span>{opts.map(([r, label]) => <label key={r} className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--color-text-secondary)' }}><input type="checkbox" checked={covers.includes(r)} onChange={e => setKey('qa.rcm.covers', e.target.checked ? [...new Set([...covers, r])] : covers.filter(x => x !== r))} />{label}</label>)}</>;
            })()}
          </div>
        </TypeCard>
      </div>
      <div className="mb-1 text-[9px] font-bold uppercase tracking-wide" style={{ color: '#059669' }}>Closer calls <span className="font-normal normal-case" style={{ color: 'var(--color-text-tertiary)' }}>— the closer's leg of each transfer</span></div>
      <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <TypeCard k="closer_sales" label="Closed Sale" desc="The closer's call on a transfer that SOLD. Reviewed live from the CRM (Live / Load Day)." on={closerOn.includes('closer_sales')} onToggle={() => toggleCloser('closer_sales')} />
        <TypeCard k="closer_dispo" label="Unclosed Sale" desc="The closer's call on a transfer that did NOT sell (a non-sale disposition)." on={closerOn.includes('closer_dispo')} onToggle={() => toggleCloser('closer_dispo')}>
          <div>
            <div className="text-[10px] font-bold mb-1" style={{ color: 'var(--color-text-secondary)' }}>Which dispositions count as Unclosed <span className="font-normal" style={{ color: 'var(--color-text-tertiary)' }}>— none picked = any non-sale</span></div>
            <div className="flex flex-wrap gap-1">
              {dispos === null ? <Loader2 size={12} className="animate-spin" style={{ color: 'var(--color-text-tertiary)' }} />
                : !dispos.length ? <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>No closer dispositions seen yet for this company.</span>
                : dispos.slice(0, 24).map(d => { const on = unclSet.has(d.code); return <button key={d.code} onClick={() => toggleUncl(d.code)} className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={on ? { background: 'rgba(220,38,38,0.12)', color: '#dc2626', border: '1px solid #dc262666' } : { background: 'var(--color-surface)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>{d.code} <span className="opacity-60">{d.count}</span></button>; })}
            </div>
          </div>
        </TypeCard>
      </div>

      <div className="text-[10px] font-bold uppercase tracking-wide mt-3 mb-0.5" style={{ color: 'var(--color-text-tertiary)' }}>General settings</div>
      <Row title="Unclaimed calls expire after"
        sub="A waiting call nobody picks up is removed automatically — old calls never pile into an endless backlog."
        tip="Only applies to calls still sitting in the pool with no reviewer. Anything assigned, in progress, or scored is kept forever.">
        <input type="number" min={1} max={30} value={retention} onChange={e => setKey('qa.retention_days', Math.max(1, Math.min(30, +e.target.value || 2)))} style={{ ...inp, width: 60 }} />
        <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>days</span>
      </Row>
      <Row title="Max open calls per reviewer"
        sub="No QA person ever holds more than this many unscored calls — extra work waits and flows in as they finish."
        tip="The workload cap. Routing always picks the least-loaded reviewer and stops at this number, so a big backlog trickles onto plates instead of burying anyone.">
        <input type="number" min={5} max={200} value={cfg['qa.reviewer_cap'] ?? 25} onChange={e => setKey('qa.reviewer_cap', Math.max(5, Math.min(200, +e.target.value || 25)))} style={{ ...inp, width: 60 }} />
        <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>open calls</span>
      </Row>
      <Row title="Keep a loaded day for"
        sub="Once the QA manager loads a dialer day for this company, the calls are cached this long — reloading the same day is instant and doesn't hit the dialer again."
        tip="How long a fetched Load Day stays cached. Higher = fewer dialer fetches but staler dispositions. 2 days is a good default.">
        <input type="number" min={1} max={14} value={cfg['qa.day_cache_days'] ?? 2} onChange={e => setKey('qa.day_cache_days', Math.max(1, Math.min(14, +e.target.value || 2)))} style={{ ...inp, width: 60 }} />
        <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>days</span>
      </Row>
      <Row title="QA manager can clear tasks"
        sub="Lets this company's QA manager delete un-scored (pending / in-progress) tasks off their agents' queues. Completed, scored work is always kept."
        tip="When on, the QA manager sees a 'clear un-scored' control per agent and for the whole team. Only pending / in-progress tasks are removed — scored reviews stay. Off by default.">
        <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          <input type="checkbox" checked={!!cfg['qa.manager_can_clear']} onChange={e => setKey('qa.manager_can_clear', e.target.checked)} />
          {cfg['qa.manager_can_clear'] ? 'Allowed' : 'Not allowed'}
        </label>
      </Row>
    </div>
  );
}
