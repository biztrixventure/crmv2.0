import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3, Send, CheckCircle2, TrendingUp, DollarSign, PhoneCall, Award, Trophy,
  Download, Settings2, Columns3, Search, Building2, Info, Users, GitCompare, ListOrdered, PieChart,
  ChevronUp, ChevronDown, Repeat, CalendarClock, ShieldCheck,
} from 'lucide-react';
import client from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useFeatureFlags } from '../../contexts/FeatureFlagsContext';
import DateRangePicker, { getPresetRange } from '../UI/DateRangePicker';
import ThemedSelect from '../UI/Select';
import Tooltip from '../UI/Tooltip';
import DialerBadge from '../Shared/DialerBadge';
import {
  Panel, SectionHeader, KpiTile, PillTabs, TableScroll, Loading, EmptyState, CheckRow, accent,
} from '../UI/kit';
import { toast } from '../../utils/toast';
import { auditedCSV } from '../../utils/moduleExport';
import { buildFilename } from '../../utils/downloadFilename';
import {
  METRIC_GROUPS, availableMetrics, defaultColumns, formatMetric, metricLabel, metricValue, metricCsv, earnerLabel, earnerFmt,
} from '../../config/companyReportMetrics';
import DailyBars from './DailyBars';
import AgentReportDrawer from './AgentReportDrawer';
import ReportSettings from './ReportSettings';
import ReportAccessPanel from './ReportAccessPanel';
import OverviewView, { SideBadge } from './OverviewView';

// ============================================================================
// CompanyReports -- per-agent performance for one company, and every company
// side by side for estate-wide viewers.
//
// One component, mounted by ReportsPanel (manager + staff shells), the
// Compliance shell and the AdminPanel. The server decides which companies the
// viewer may open (GET /company-reports/scope) and strips money / QA the viewer
// may not see, so nothing here is a security boundary -- it only renders what
// arrived. Columns come from config/companyReportMetrics.js, the one catalog.
// ============================================================================

const ALL = '__all__';

// Per-viewer column choice: a convenience, so localStorage (wrapped -- private
// windows throw). Never anything that must persist or be shared.
const colsKey = (side) => `companyReports.cols.${side}`;
function readCols(side) {
  try {
    const v = JSON.parse(window.localStorage.getItem(colsKey(side)) || 'null');
    return Array.isArray(v) ? v : null;
  } catch { return null; }
}
function writeCols(side, cols) {
  try { window.localStorage.setItem(colsKey(side), JSON.stringify(cols)); } catch { /* ignore */ }
}

const sideWord = (side) => (side === 'closer' ? 'closer' : 'fronter');


function LeaderCard({ icon: Icon, title, leader, fmt, tone = 'primary', big = false, onOpen }) {
  const a = accent(tone);
  return (
    <button type="button" disabled={!leader} onClick={() => leader && onOpen?.(leader.user_id)}
      className={`text-left rounded-2xl p-4 min-w-0 transition-shadow ${leader ? 'hover:shadow-md cursor-pointer' : 'cursor-default'}`}
      style={{
        background: big ? a.soft : 'var(--color-surface)',
        border: `1px solid ${big ? a.fg : 'var(--color-border)'}`,
      }}>
      <div className="flex items-center gap-1.5">
        <Icon size={14} style={{ color: a.fg }} />
        <p className="text-[11px] font-bold uppercase tracking-wider m-0 leading-none truncate" style={{ color: 'var(--color-text-secondary)' }}>{title}</p>
      </div>
      {leader ? (
        <>
          <p className={`${big ? 'text-xl' : 'text-base'} font-bold m-0 mt-2 truncate`} style={{ color: 'var(--color-text)' }}>{leader.name}</p>
          <p className="text-sm font-semibold m-0 mt-0.5 tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{formatMetric(fmt, leader.value)}</p>
        </>
      ) : (
        <p className="text-sm m-0 mt-2" style={{ color: 'var(--color-text-tertiary)' }}>Nobody yet</p>
      )}
    </button>
  );
}

function ColumnChooser({ metrics, side, columns, onChange, onReset }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const on = new Set(columns);
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)} className="btn btn-secondary inline-flex items-center gap-1.5 text-sm">
        <Columns3 size={14} /> Columns
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-[min(92vw,420px)] max-h-[60vh] overflow-y-auto rounded-2xl p-3 shadow-lg"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold m-0" style={{ color: 'var(--color-text)' }}>Pick your columns</p>
            <button type="button" className="text-xs font-semibold" style={{ color: 'var(--color-primary-600)' }} onClick={onReset}>Reset</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
            {METRIC_GROUPS.map(g => {
              const list = metrics.filter(m => m.group === g.id);
              if (!list.length) return null;
              return (
                <div key={g.id} className="mb-2">
                  <p className="text-[11px] font-semibold m-0" style={{ color: 'var(--color-text-tertiary)' }}>{g.label}</p>
                  {list.map(m => (
                    <CheckRow key={m.key} label={metricLabel(m, side)} checked={on.has(m.key)}
                      onChange={(v) => onChange(v ? [...columns, m.key] : columns.filter(k => k !== m.key))} />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Sort value: text sorts alphabetically, numbers numerically, blanks always last.
function sortRows(rows, metric, dir) {
  if (!metric) return rows;
  const mul = dir === 'asc' ? 1 : -1;
  return rows.slice().sort((x, y) => {
    const a = metricValue(metric, x);
    const b = metricValue(metric, y);
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    if (typeof a === 'string' || typeof b === 'string') return String(a).localeCompare(String(b)) * mul;
    return (a - b) * mul;
  });
}

export default function CompanyReports({ companyId: preferredCompanyId = null }) {
  const { canExport } = useAuth();
  const { isEnabled } = useFeatureFlags();

  const [scope, setScope] = useState(null);
  const [company, setCompany] = useState(null);
  const [range, setRange] = useState(() => getPresetRange('30d'));
  const [data, setData] = useState(null);
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [view, setView] = useState('board');
  const [sort, setSort] = useState({ key: null, dir: 'desc' });
  const [columns, setColumns] = useState([]);
  const [selected, setSelected] = useState([]);
  const [openAgentId, setOpenAgentId] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [q, setQ] = useState('');
  const [team, setTeam] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [showAccess, setShowAccess] = useState(false);
  // An agent picked on the All-companies ladder opens once their company loads.
  const [pendingAgent, setPendingAgent] = useState(null);

  // ── which companies may I open ──
  useEffect(() => {
    let alive = true;
    client.get('company-reports/scope')
      .then(({ data: s }) => {
        if (!alive) return;
        setScope(s);
        const ids = (s.companies || []).map(c => c.id);
        const start = preferredCompanyId && ids.includes(preferredCompanyId) ? preferredCompanyId
          : s.default_company_id || ids[0] || null;
        // Estate-wide viewers with no company in mind open on the comparison.
        setCompany(s.multi && s.global && !preferredCompanyId ? ALL : start);
      })
      .catch(() => { if (alive) setScope({ companies: [], global: false }); });
    return () => { alive = false; };
  }, [preferredCompanyId]);

  const { date_from: from, date_to: to } = range || {};

  // ── load ──
  const load = useCallback(async () => {
    if (!company) return;
    setLoading(true);
    setError(null);
    try {
      const params = { from: from || undefined, to: to || undefined };
      if (company === ALL) {
        const r = await client.get('company-reports/overview', { params });
        setOverview(r.data);
        setData(null);
      } else {
        const r = await client.get('company-reports', { params: { ...params, company_id: company } });
        setData(r.data);
        setOverview(null);
      }
    } catch (e) {
      setError(e?.response?.data?.error || 'The report could not be loaded.');
      setData(null); setOverview(null);
    } finally { setLoading(false); }
  }, [company, from, to, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps -- reloadKey forces a refetch after Settings

  useEffect(() => { load(); }, [load]);

  const side = data?.side || 'fronter';
  const metrics = useMemo(() => (data ? availableMetrics({
    side, canSeeMoney: data.can_see_money, canSeeQa: data.can_see_qa, hidden: data.config?.hidden_metrics,
  }) : []), [data, side]);
  const metricByKey = useMemo(() => Object.fromEntries(metrics.map(m => [m.key, m])), [metrics]);

  // columns: the viewer's saved choice, filtered to what they may see
  useEffect(() => {
    if (!data) return;
    const allowed = new Set(metrics.map(m => m.key));
    const fallback = defaultColumns(side).filter(k => allowed.has(k));
    const cols = (readCols(side) || fallback).filter(k => allowed.has(k));
    setColumns(cols.length ? cols : fallback);
  }, [data, side, metrics]);

  const setCols = (cols) => { setColumns(cols); writeCols(side, cols); };

  // reset per-company UI state
  useEffect(() => { setSelected([]); setOpenAgentId(null); setQ(''); setTeam(''); setSort({ key: null, dir: 'desc' }); }, [company]);
  useEffect(() => {
    if (pendingAgent && data?.company?.id === pendingAgent.company_id) {
      setOpenAgentId(pendingAgent.user_id || '');
      setPendingAgent(null);
    }
  }, [data, pendingAgent]);

  const agents = useMemo(() => data?.agents || [], [data]);
  const teams = useMemo(() => [...new Set(agents.map(a => a.team_name).filter(Boolean))].sort(), [agents]);

  const visibleRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let rows = agents.filter(a => (!needle || String(a.name || '').toLowerCase().includes(needle))
      && (!team || a.team_name === team));
    if (sort.key && metricByKey[sort.key]) {
      // labelled rows (placeholder / unattributed) stay at the bottom whatever the sort
      const ranked = rows.filter(a => a.rank != null);
      const rest = rows.filter(a => a.rank == null);
      rows = [...sortRows(ranked, metricByKey[sort.key], sort.dir), ...rest];
    }
    return rows;
  }, [agents, q, team, sort, metricByKey]);

  const colMetrics = columns.map(k => metricByKey[k]).filter(Boolean);
  const openAgent = openAgentId !== null ? agents.find(a => (a.user_id || '') === openAgentId) : null;
  const compareAgents = useMemo(() => {
    const ids = selected.length ? selected : agents.filter(a => a.rank != null).slice(0, 3).map(a => a.user_id);
    return ids.map(id => agents.find(a => a.user_id === id)).filter(Boolean);
  }, [selected, agents]);

  const toggleSort = (key) => setSort(s => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }));
  const toggleSelect = (id) => setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id].slice(-5)));

  const companyName = scope?.companies?.find(c => c.id === company)?.name || data?.company?.name || '';
  const canDownload = isEnabled('exports') && canExport('reports');

  // ── CSV (through the export log + daily cap) ──
  const exportCsv = async () => {
    let headers; let rows; let scopeName;
    if (company === ALL) {
      if (!overview) return;
      const money = overview.can_see_money;
      headers = ['Company', 'Side', 'Active agents', 'Transfers', 'Converted', 'Conversion %', 'Sold', 'Still active', 'Stick rate %',
        'Post-dates (not sales)', ...(money ? ['Down payments', 'Monthly book'] : []), 'Top agent'];
      rows = overview.companies.map(c => [c.company?.name, c.side, c.agents_active, c.transfers, c.xfer_sold, c.conversion ?? '', c.sold, c.active,
        c.stick_rate ?? '', c.post_dates, ...(money ? [c.dp_sold, c.monthly_active] : []), c.top_agent?.name || '']);
      scopeName = 'all-companies';
    } else {
      if (!data) return;
      headers = ['Rank', 'Agent', 'Team', ...colMetrics.map(m => metricLabel(m, side))];
      rows = visibleRows.map(a => [
        a.rank ?? (a.placeholder ? 'placeholder' : a.unattributed ? 'unattributed' : ''),
        a.name, a.team_name || '', ...colMetrics.map(m => metricCsv(m, a)),
      ]);
      scopeName = companyName;
    }
    const res = await auditedCSV('company_reports', rows, headers,
      buildFilename({ dataset: 'company-report', scope: scopeName, dateFrom: from, dateTo: to }),
      { company_id: company === ALL ? 'all' : company, from, to });
    if (!res.ok) toast.error(res.error);
  };

  // ── render ──
  if (!scope) return <Loading variant="cards" cards={4} />;
  if (!scope.companies?.length) {
    return <EmptyState icon={BarChart3} title="Company Reports is not enabled for you" hint="Ask an admin to turn it on for your role, or for you in User Control Center → Tools." />;
  }

  const t = data?.totals || {};
  const money = !!data?.can_see_money;
  const qa = !!data?.can_see_qa;
  const leaders = data?.leaders || {};
  const earnerMetric = leaders.earner?.metric || data?.config?.earner_metric;

  const companyOptions = [
    ...(scope.multi ? [{ value: ALL, label: 'All companies' }] : []),
    ...scope.companies.map(c => ({ value: c.id, label: c.name })),
  ];

  return (
    <div className="space-y-5 min-w-0">
      <SectionHeader level="page" icon={BarChart3}
        title="Company Reports"
        subtitle="How every agent is doing — volume, conversion, money, callbacks and quality. Post-dates are never counted as sales. Days are US Eastern."
        actions={(
          <>
            {companyOptions.length > 1 && (
              <ThemedSelect value={company || ''} onChange={e => setCompany(e.target.value)} className="input min-w-[190px]" aria-label="Company">
                {companyOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </ThemedSelect>
            )}
            <DateRangePicker onChange={setRange} defaultPreset="30d" />
            {canDownload && (
              <button type="button" onClick={exportCsv} disabled={loading} className="btn btn-secondary inline-flex items-center gap-1.5 text-sm">
                <Download size={14} /> Export CSV
              </button>
            )}
            {scope.can_configure && (
              <button type="button" onClick={() => setShowAccess(v => !v)} aria-pressed={showAccess}
                className="btn btn-secondary inline-flex items-center gap-1.5 text-sm" title="Who can see these reports">
                <ShieldCheck size={14} /> {showAccess ? 'Back to report' : 'Who can see'}
              </button>
            )}
            {scope.can_configure && (
              <button type="button" onClick={() => setSettingsOpen(true)} className="btn btn-secondary inline-flex items-center gap-1.5 text-sm" title="Report settings">
                <Settings2 size={14} /> Settings
              </button>
            )}
          </>
        )} />

      {error && (
        <Panel tone="surface" pad="sm" className="text-sm" style={{ color: accent('danger').fg }}>{error}</Panel>
      )}

      {showAccess
        ? <ReportAccessPanel />
        : company === ALL
        ? <OverviewView overview={overview} loading={loading} onOpenCompany={setCompany}
            onOpenAgent={(a) => { setPendingAgent(a); setCompany(a.company_id); }} />
        : loading && !data
          ? <Loading variant="cards" cards={8} />
          : data && (
            <>
              {/* ── what this report is, in one line ── */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                <span className="inline-flex items-center gap-1.5"><Building2 size={13} /> <b style={{ color: 'var(--color-text)' }}>{data.company?.name}</b></span>
                <SideBadge side={side} />
                <span className="inline-flex items-center gap-1"><Info size={12} /> Post-dates excluded — {t.post_dates || 0} post-dated reminder{t.post_dates === 1 ? '' : 's'} not counted as sales</span>
                {t.unattributed > 0 && <span>{t.unattributed} sale{t.unattributed === 1 ? '' : 's'} with no {sideWord(side)} (shown as “Unattributed”)</span>}
                {t.recredited > 0 && <span>{t.recredited} sale{t.recredited === 1 ? '' : 's'} re-credited from another login</span>}
                {loading && <Loading variant="inline" size={12} />}
              </div>

              {/* ── KPI strip ── */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                <KpiTile icon={Send} tone="info" label={side === 'closer' ? 'Transfers received' : 'Transfers'}
                  value={formatMetric('int', t.transfers)} sub={`${formatMetric('num', t.daily_avg)} / day`} />
                <KpiTile icon={TrendingUp} tone="primary" label="Conversion"
                  value={formatMetric('pct', t.conversion)} sub={`${formatMetric('int', t.xfer_sold)} converted`} />
                <KpiTile icon={CheckCircle2} tone="success" label="Sold"
                  value={formatMetric('int', t.sold)} sub={`${formatMetric('int', t.active)} still active`} />
                <KpiTile icon={Repeat} tone={t.stick_rate != null && t.stick_rate < 60 ? 'warn' : 'success'} label="Stick rate"
                  value={formatMetric('pct', t.stick_rate)} sub={`${formatMetric('int', t.cancelled)} cancelled`} />
                {money
                  ? <KpiTile icon={DollarSign} tone="success" label="Down payments"
                      value={formatMetric('money', t.dp_sold)} sub={`avg ${formatMetric('money', t.avg_deal)} · book ${formatMetric('money', t.monthly_active)}/mo`} />
                  : <KpiTile icon={CalendarClock} tone="muted" label="In review" value={formatMetric('int', t.in_review)} sub="open or with compliance" />}
                {qa && t.qa_n > 0
                  ? <KpiTile icon={Award} tone={t.qa_avg >= 75 ? 'success' : 'warn'} label="QA score"
                      value={formatMetric('pct', t.qa_avg)} sub={`${t.qa_n} reviews · ${formatMetric('pct', t.qa_pass_rate)} pass`} />
                  : <KpiTile icon={PhoneCall} tone="info" label="Callbacks done"
                      value={formatMetric('pct', t.cb_completion)} sub={`${formatMetric('int', t.cb_completed)} of ${formatMetric('int', t.cb_total)} · ${formatMetric('int', t.cb_missed)} missed`} />}
              </div>

              {/* ── who is on top (by sales count unless Settings say otherwise) ── */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                <LeaderCard big icon={Trophy} tone="success" onOpen={setOpenAgentId}
                  title={`Top agent · most ${earnerLabel(earnerMetric)}`}
                  leader={leaders.earner} fmt={earnerFmt(earnerMetric)} />
                <LeaderCard icon={Send} title={side === 'closer' ? 'Most transfers received' : 'Most transfers'} leader={leaders.most_transfers} fmt="int" onOpen={setOpenAgentId} />
                <LeaderCard icon={TrendingUp} title={`Best conversion (≥${data.config?.best_partner_min} transfers)`} leader={leaders.best_conversion} fmt="pct" onOpen={setOpenAgentId} />
                <LeaderCard icon={Repeat} title={`Best stick rate (≥${data.config?.best_partner_min} sold)`} leader={leaders.best_stick} fmt="pct" onOpen={setOpenAgentId} />
              </div>

              {/* ── company trend ── */}
              <Panel tone="surface" pad="md" className={`grid grid-cols-1 ${money ? 'lg:grid-cols-3' : 'md:grid-cols-2'} gap-5`}>
                <DailyBars title={side === 'closer' ? 'Transfers received per day' : 'Transfers per day'} data={data.series} valueKey="x" />
                <DailyBars title="Sales per day" data={data.series} valueKey="s" color="var(--color-success-600)" />
                {money && <DailyBars title="Down payments per day" data={data.series} valueKey="dp" fmt="money" color="var(--color-info-600)" />}
              </Panel>

              {/* ── views ── */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <PillTabs value={view} onChange={setView} items={[
                  { key: 'board', label: 'Leaderboard', icon: ListOrdered },
                  { key: 'compare', label: `Compare${selected.length ? ` (${selected.length})` : ''}`, icon: GitCompare },
                  { key: 'partners', label: side === 'closer' ? 'Fronters' : 'Closers', icon: Users },
                  { key: 'outcomes', label: 'Outcomes', icon: PieChart },
                ]} />
                {view === 'board' && (
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative">
                      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
                      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find agent" className="input pl-8 w-40 text-sm" />
                    </div>
                    {teams.length > 0 && (
                      <ThemedSelect value={team} onChange={e => setTeam(e.target.value)} className="input min-w-[140px] text-sm" aria-label="Team">
                        <option value="">All teams</option>
                        {teams.map(n => <option key={n} value={n}>{n}</option>)}
                      </ThemedSelect>
                    )}
                    <ColumnChooser metrics={metrics} side={side} columns={columns} onChange={setCols}
                      onReset={() => setCols(defaultColumns(side).filter(k => metricByKey[k]))} />
                  </div>
                )}
              </div>

              {view === 'board' && (
                <Leaderboard rows={visibleRows} cols={colMetrics} side={side} sort={sort} onSort={toggleSort}
                  selected={selected} onSelect={toggleSelect} onOpen={setOpenAgentId} />
              )}
              {view === 'compare' && (
                <CompareGrid agents={compareAgents} metrics={metrics} side={side} pickedByHand={selected.length > 0}
                  onRemove={(id) => setSelected(s => s.filter(x => x !== id))} onOpen={setOpenAgentId} />
              )}
              {view === 'partners' && <PartnerBoard partners={data.partners} side={side} money={money} />}
              {view === 'outcomes' && <Outcomes dispositions={data.dispositions} boxes={data.boxes} total={t.transfers} />}
            </>
          )}

      {openAgent && (
        <AgentReportDrawer agent={openAgent} side={side} range={data?.range} metrics={metrics}
          canSeeMoney={money} onClose={() => setOpenAgentId(null)} />
      )}

      {scope.can_configure && (
        <ReportSettings open={settingsOpen} onClose={() => setSettingsOpen(false)}
          companyId={company !== ALL ? company : null} companyName={companyName} side={side}
          agents={agents} onSaved={() => setReloadKey(k => k + 1)} />
      )}
    </div>
  );
}

// ── Leaderboard ─────────────────────────────────────────────────────────────
function Leaderboard({ rows, cols, side, sort, onSort, selected, onSelect, onOpen }) {
  if (!rows.length) return <EmptyState icon={Users} title="No agents match" hint="Change the dates, the team or the search." />;
  const th = 'px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap';
  return (
    <Panel tone="surface" pad="none" className="overflow-hidden">
      <TableScroll stickyFirst label="Agent leaderboard">
        <table className="w-full text-sm">
          <thead style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
            <tr>
              <th className={`${th} text-left`}>Agent</th>
              <th className={`${th} text-center`} title="Tick up to five to compare">Cmp</th>
              {cols.map(m => (
                <th key={m.key} className={`${th} ${m.fmt === 'text' ? 'text-left' : 'text-right'}`}>
                  <Tooltip text={m.tip}>
                    <button type="button" onClick={() => onSort(m.key)} className="inline-flex items-center gap-0.5 uppercase font-bold">
                      {metricLabel(m, side)}
                      {sort.key === m.key && (sort.dir === 'desc' ? <ChevronDown size={12} /> : <ChevronUp size={12} />)}
                    </button>
                  </Tooltip>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(a => {
              const id = a.user_id || '';
              const labelled = a.rank == null;
              return (
                <tr key={id || 'unattributed'} onClick={() => onOpen(id)} className="cursor-pointer"
                  style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                  <td className="px-2.5 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-6 text-center text-xs font-bold tabular-nums flex-shrink-0"
                        style={{ color: a.rank && a.rank <= 3 ? accent('warn').fg : 'var(--color-text-tertiary)' }}>
                        {a.rank ?? '—'}
                      </span>
                      <div className="min-w-0">
                        <p className="font-semibold m-0 truncate max-w-[200px]" style={{ color: labelled ? 'var(--color-text-secondary)' : 'var(--color-text)', fontStyle: labelled ? 'italic' : 'normal' }}>
                          {a.name}
                        </p>
                        <p className="text-[11px] m-0 truncate max-w-[200px]" style={{ color: 'var(--color-text-tertiary)' }}>
                          {a.placeholder ? 'Placeholder — not ranked' : a.unattributed ? 'No agent on the sale' : [a.team_name, a.is_member_active === false ? 'inactive' : null].filter(Boolean).join(' · ') || ' '}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-2.5 py-2 text-center" onClick={e => e.stopPropagation()}>
                    {!labelled && (
                      <input type="checkbox" aria-label={`Compare ${a.name}`} checked={selected.includes(a.user_id)}
                        onChange={() => onSelect(a.user_id)} style={{ accentColor: 'var(--color-primary-600)' }} />
                    )}
                  </td>
                  {cols.map(m => {
                    if (m.key === 'top_disposition') {
                      return (
                        <td key={m.key} className="px-2.5 py-2 text-left whitespace-nowrap text-xs" style={{ color: 'var(--color-text)' }}>
                          {a.top_disposition ? <>{a.top_disposition.label} <span style={{ color: 'var(--color-text-tertiary)' }}>{a.top_disposition.pct}%</span></> : '—'}
                        </td>
                      );
                    }
                    if (m.key === 'best_partner') {
                      const b = a.best?.by_sold;
                      return (
                        <td key={m.key} className="px-2.5 py-2 text-left whitespace-nowrap text-xs" style={{ color: 'var(--color-text)' }}>
                          {b ? <>{b.name} <span style={{ color: 'var(--color-text-tertiary)' }}>{b.sold} sold</span></> : '—'}
                        </td>
                      );
                    }
                    const v = metricValue(m, a);
                    return (
                      <td key={m.key} className={`px-2.5 py-2 tabular-nums whitespace-nowrap ${m.fmt === 'text' ? 'text-left' : 'text-right'}`}
                        style={{ color: v == null ? 'var(--color-text-tertiary)' : 'var(--color-text)' }}>
                        {formatMetric(m.fmt, v)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>
    </Panel>
  );
}

// ── Compare ─────────────────────────────────────────────────────────────────
function CompareGrid({ agents, metrics, side, pickedByHand, onRemove, onOpen }) {
  if (!agents.length) return <EmptyState icon={GitCompare} title="Nobody to compare" hint="Tick agents in the Leaderboard." />;
  const rows = metrics.filter(m => m.fmt !== 'text');
  const bestOf = (m) => {
    if (!m.better) return null;
    const vals = agents.map(a => metricValue(m, a)).filter(v => v != null);
    if (vals.length < 2) return null;
    return m.better === 'low' ? Math.min(...vals) : Math.max(...vals);
  };
  const rowStyle = { borderTop: '1px solid var(--color-border)', background: 'var(--color-surface)' };
  return (
    <Panel tone="surface" pad="none" className="overflow-hidden">
      <p className="text-xs m-0 px-3 pt-3" style={{ color: 'var(--color-text-secondary)' }}>
        {pickedByHand ? 'Your picks.' : 'The top three — tick agents in the Leaderboard to choose your own (up to five).'} The best value in each row is highlighted.
      </p>
      <TableScroll stickyFirst label="Compare agents">
        <table className="w-full text-sm mt-2">
          <thead>
            <tr style={{ background: 'var(--color-bg-secondary)' }}>
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>Metric</th>
              {agents.map(a => (
                <th key={a.user_id} className="px-3 py-2 text-right whitespace-nowrap">
                  <button type="button" className="font-semibold" style={{ color: 'var(--color-text)' }} onClick={() => onOpen(a.user_id)}>{a.name}</button>
                  {pickedByHand && (
                    <button type="button" className="ml-1.5 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }} onClick={() => onRemove(a.user_id)} aria-label={`Remove ${a.name}`}>✕</button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(m => {
              const best = bestOf(m);
              return (
                <tr key={m.key} style={rowStyle}>
                  <td className="px-3 py-1.5 whitespace-nowrap text-xs" style={{ color: 'var(--color-text-secondary)' }} title={m.tip}>{metricLabel(m, side)}</td>
                  {agents.map(a => {
                    const v = metricValue(m, a);
                    const win = best != null && v === best;
                    return (
                      <td key={a.user_id} className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap"
                        style={{ color: 'var(--color-text)', fontWeight: win ? 700 : 400, background: win ? accent('success').soft : undefined }}>
                        {formatMetric(m.fmt, v)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            <tr style={rowStyle}>
              <td className="px-3 py-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>Usual outcome</td>
              {agents.map(a => <td key={a.user_id} className="px-3 py-1.5 text-right text-xs" style={{ color: 'var(--color-text)' }}>{a.top_disposition ? `${a.top_disposition.label} (${a.top_disposition.pct}%)` : '—'}</td>)}
            </tr>
            <tr style={rowStyle}>
              <td className="px-3 py-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>Best {side === 'closer' ? 'fronter' : 'closer'}</td>
              {agents.map(a => <td key={a.user_id} className="px-3 py-1.5 text-right text-xs" style={{ color: 'var(--color-text)' }}>{a.best?.by_sold ? `${a.best.by_sold.name} (${a.best.by_sold.sold})` : '—'}</td>)}
            </tr>
          </tbody>
        </table>
      </TableScroll>
    </Panel>
  );
}

// ── Partners (company level) ────────────────────────────────────────────────
function PartnerBoard({ partners = [], side, money }) {
  const title = side === 'closer' ? 'Fronters who sent this company leads' : 'Closers who worked this company\'s transfers';
  if (!partners.length) return <EmptyState icon={Users} title="No partners in this range" />;
  const th = 'px-3 py-2 text-[11px] font-bold uppercase tracking-wider';
  return (
    <Panel tone="surface" pad="none" className="overflow-hidden">
      <p className="text-xs m-0 px-3 pt-3" style={{ color: 'var(--color-text-secondary)' }}>{title}, most sales first.</p>
      <TableScroll stickyFirst label={title}>
        <table className="w-full text-sm mt-2">
          <thead style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
            <tr>
              <th className={`${th} text-left`}>{side === 'closer' ? 'Fronter' : 'Closer'}</th>
              {side === 'closer' && <th className={`${th} text-left`}>Company</th>}
              <th className={`${th} text-right`}>Transfers</th>
              <th className={`${th} text-right`}>Sold</th>
              <th className={`${th} text-right`}>Conversion</th>
              {money && <th className={`${th} text-right`}>Down payments</th>}
            </tr>
          </thead>
          <tbody>
            {partners.map(p => (
              <tr key={p.partner} style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}>
                <td className="px-3 py-1.5 whitespace-nowrap">{p.name}{p.placeholder && <span className="ml-1 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>(placeholder)</span>}</td>
                {side === 'closer' && <td className="px-3 py-1.5 whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>{p.partner_company || '—'}</td>}
                <td className="px-3 py-1.5 text-right tabular-nums">{formatMetric('int', p.transfers)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatMetric('int', p.sold)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatMetric('pct', p.rate)}</td>
                {money && <td className="px-3 py-1.5 text-right tabular-nums">{formatMetric('money', p.dp)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </Panel>
  );
}

// ── Outcomes (company level) ────────────────────────────────────────────────
function Outcomes({ dispositions = [], boxes = [], total = 0 }) {
  const max = Math.max(1, ...dispositions.map(d => d.n));
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Panel tone="surface" pad="md" className="lg:col-span-2">
        <p className="text-sm font-bold m-0" style={{ color: 'var(--color-text)' }}>How transfers ended</p>
        <p className="text-xs m-0 mb-3" style={{ color: 'var(--color-text-secondary)' }}>Closer disposition on each of the {formatMetric('int', total)} transfers in the range.</p>
        {dispositions.length === 0 ? <EmptyState compact title="No transfers in this range" /> : (
          <div className="space-y-1.5">
            {dispositions.slice(0, 20).map(d => (
              <div key={d.label} className="flex items-center gap-2 text-xs">
                <span className="w-36 sm:w-48 truncate" style={{ color: 'var(--color-text)' }} title={d.label}>{d.label}</span>
                <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-bg-secondary)' }}>
                  <div className="h-full rounded-full" style={{ width: `${(d.n / max) * 100}%`, background: 'var(--color-primary-600)' }} />
                </div>
                <span className="w-24 text-right tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{formatMetric('int', d.n)} · {formatMetric('pct', d.pct)}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
      <Panel tone="surface" pad="md">
        <p className="text-sm font-bold m-0 mb-3" style={{ color: 'var(--color-text)' }}>Where transfers came from</p>
        {boxes.length === 0 ? <EmptyState compact title="Nothing yet" /> : (
          <div className="space-y-2">
            {boxes.map(b => (
              <div key={`${b.dialer_provider}|${b.dialer_box}`} className="flex items-center justify-between gap-2 text-xs">
                <DialerBadge record={{ dialer_provider: b.dialer_provider, dialer_box: b.dialer_box }} />
                <span className="tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{formatMetric('int', b.n)} · {formatMetric('pct', total ? Math.round((b.n / total) * 1000) / 10 : null)}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
