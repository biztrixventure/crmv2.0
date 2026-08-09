// ============================================================================
// ReportsTab.jsx — the 6 qa2Reports.js endpoints (agent, parameters,
// reviewers, autofails, calibration, coverage) behind one filter bar + a
// section switcher. Charts via chart.js/react-chartjs-2 (build brief
// instruction: NOT v1's hand-rolled SVG charts) — same useThemeColors +
// Chart.js config pattern as Manager/PerfCharts.jsx, kept local to this file
// since PerfCharts.jsx itself doesn't export it as a shared hook either.
// ============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement,
  LineElement, ArcElement, Tooltip, Legend, Filler,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { BarChart3, Users, ListChecks, Gavel, ShieldAlert, Scale as ScaleIcon, Layers, Download } from 'lucide-react';
import client from '../../api/client';
import ThemedSelect from '../UI/Select';
import ThemedDate from '../UI/ThemedDate';
import { Panel, SectionHeader, TableScroll, EmptyState, Loading, KpiTile, PillTabs } from '../UI/kit';
import { downloadCSV } from '../../utils/recordFormat';

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Tooltip, Legend, Filler);

function useThemeColors() {
  const read = () => {
    const s = getComputedStyle(document.documentElement);
    const v = (n, fallback) => (s.getPropertyValue(n) || '').trim() || fallback;
    return {
      primary: v('--color-primary-600', '#0d9488'),
      warn: v('--color-warning-600', '#d97706'),
      error: v('--color-error-600', '#dc2626'),
      text: v('--color-text', '#111827'),
      muted: v('--color-text-tertiary', '#6b7280'),
      grid: v('--color-border', '#e5e7eb'),
      surface: v('--color-surface', '#ffffff'),
    };
  };
  const [c, setC] = useState(read);
  useEffect(() => {
    const ob = new MutationObserver(() => setC(read()));
    ob.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    return () => ob.disconnect();
  }, []);
  return c;
}

const SECTIONS = [
  { key: 'agent', label: 'Agents', icon: Users },
  { key: 'parameters', label: 'Parameters', icon: ListChecks },
  { key: 'reviewers', label: 'Reviewers', icon: Gavel },
  { key: 'autofails', label: 'Autofails', icon: ShieldAlert },
  { key: 'calibration', label: 'Calibration', icon: ScaleIcon },
  { key: 'coverage', label: 'Coverage', icon: Layers },
];

function ExportButton({ rows, headers, filename, mapRow }) {
  if (!rows || !rows.length) return null;
  return (
    <button className="btn text-xs flex items-center gap-1.5" style={{ border: '1px solid var(--color-border)' }}
      onClick={() => downloadCSV(rows.map(mapRow), headers, filename)}>
      <Download size={12} />Export CSV
    </button>
  );
}

function AgentSection({ params }) {
  const c = useThemeColors();
  const [data, setData] = useState(null);
  useEffect(() => { setData(null); client.get('qa2/reports/agent', { params }).then(r => setData(r.data)).catch(() => setData({ agents: [], daily: [] })); }, [params]);

  // Hooks must run unconditionally every render, so these precede the
  // `!data` early return below (data is loading on that first render) —
  // matches PerfCharts.jsx's established pattern for this codebase.
  const daily = data?.daily || [];
  const chartData = useMemo(() => ({
    labels: daily.map(d => d.date.slice(5)),
    datasets: [{ label: 'Avg score', data: daily.map(d => d.avg_score), backgroundColor: c.primary, borderRadius: 3, maxBarThickness: 26 }],
  }), [daily, c]);
  const chartOptions = useMemo(() => ({
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { display: false }, ticks: { color: c.muted, font: { size: 10 } } },
      y: { beginAtZero: true, max: 100, grid: { color: c.grid }, ticks: { color: c.muted, font: { size: 10 } } },
    },
  }), [c]);

  if (!data) return <Loading variant="cards" />;

  return (
    <div className="space-y-3">
      {data.daily.length > 0 && (
        <Panel><SectionHeader level="section" title="Daily average score" /><div className="h-48"><Bar data={chartData} options={chartOptions} /></div></Panel>
      )}
      <Panel pad="none">
        <div className="flex items-center justify-between" style={{ padding: '12px 16px 0' }}>
          <SectionHeader level="section" title="By agent" />
          <ExportButton rows={data.agents} headers={['Agent', 'Count', 'Avg score', 'Pass rate %', 'Autofail rate %']} filename="qa2-agent-report.csv"
            mapRow={a => [a.name, a.count, a.avg_score ?? '', a.pass_rate ?? '', a.autofail_rate ?? '']} />
        </div>
        {data.agents.length === 0 ? <EmptyState compact title="No scored evaluations in range" /> : (
          <TableScroll>
            <table className="w-full text-sm">
              <thead><tr style={{ color: 'var(--color-text-secondary)' }}>
                <th className="text-left font-semibold px-3 py-2">Agent</th><th className="text-left font-semibold px-3 py-2">Count</th>
                <th className="text-left font-semibold px-3 py-2">Avg score</th><th className="text-left font-semibold px-3 py-2">Pass rate</th>
                <th className="text-left font-semibold px-3 py-2">Autofail rate</th>
              </tr></thead>
              <tbody>
                {data.agents.map(a => (
                  <tr key={a.agent_id} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td className="px-3 py-2">{a.name}</td><td className="px-3 py-2">{a.count}</td>
                    <td className="px-3 py-2"><strong>{a.avg_score ?? '—'}</strong></td>
                    <td className="px-3 py-2">{a.pass_rate != null ? `${a.pass_rate}%` : '—'}</td>
                    <td className="px-3 py-2">{a.autofail_rate != null ? `${a.autofail_rate}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Panel>
    </div>
  );
}

function ParametersSection({ params }) {
  const c = useThemeColors();
  const [data, setData] = useState(null);
  useEffect(() => { setData(null); client.get('qa2/reports/parameters', { params }).then(r => setData(r.data)).catch(() => setData({ parameters: [] })); }, [params]);

  // Same hook-ordering rule as AgentSection above — computed before the
  // `!data` early return so useMemo always runs, every render.
  const top = (data?.parameters || []).slice(0, 12);
  const chartData = useMemo(() => ({
    labels: top.map(p => p.label.length > 28 ? p.label.slice(0, 27) + '…' : p.label),
    datasets: [{ label: 'Flag rate %', data: top.map(p => p.flag_rate), backgroundColor: c.warn, borderRadius: 3 }],
  }), [top, c]);
  const chartOptions = useMemo(() => ({
    indexAxis: 'y', responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { beginAtZero: true, max: 100, grid: { color: c.grid }, ticks: { color: c.muted, font: { size: 10 } } },
      y: { grid: { display: false }, ticks: { color: c.muted, font: { size: 10 } } },
    },
  }), [top, c]);

  if (!data) return <Loading variant="cards" />;

  return (
    <div className="space-y-3">
      {top.length > 0 && (
        <Panel><SectionHeader level="section" title="Top flagged parameters" subtitle="How often each question was answered negatively (autofail/penalty Yes, or scored No)." />
          <div style={{ height: Math.max(180, top.length * 28) }}><Bar data={chartData} options={chartOptions} /></div>
        </Panel>
      )}
      <Panel pad="none">
        <div className="flex items-center justify-between" style={{ padding: '12px 16px 0' }}>
          <SectionHeader level="section" title="All parameters" />
          <ExportButton rows={data.parameters} headers={['Parameter', 'Role', 'Answered', 'Flagged', 'Flag rate %']} filename="qa2-parameters-report.csv"
            mapRow={p => [p.label, p.role, p.answered, p.flagged, p.flag_rate]} />
        </div>
        {data.parameters.length === 0 ? <EmptyState compact title="No answered parameters in range" /> : (
          <TableScroll>
            <table className="w-full text-sm">
              <thead><tr style={{ color: 'var(--color-text-secondary)' }}>
                <th className="text-left font-semibold px-3 py-2">Parameter</th><th className="text-left font-semibold px-3 py-2">Role</th>
                <th className="text-left font-semibold px-3 py-2">Answered</th><th className="text-left font-semibold px-3 py-2">Flagged</th>
                <th className="text-left font-semibold px-3 py-2">Flag rate</th>
              </tr></thead>
              <tbody>
                {data.parameters.map(p => (
                  <tr key={p.lineage_id} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td className="px-3 py-2">{p.label}</td><td className="px-3 py-2">{p.role}</td>
                    <td className="px-3 py-2">{p.answered}</td><td className="px-3 py-2">{p.flagged}</td>
                    <td className="px-3 py-2"><strong>{p.flag_rate}%</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Panel>
    </div>
  );
}

function ReviewersSection({ params }) {
  const [data, setData] = useState(null);
  useEffect(() => { setData(null); client.get('qa2/reports/reviewers', { params }).then(r => setData(r.data)).catch(() => setData({ reviewers: [] })); }, [params]);
  if (!data) return <Loading variant="cards" />;
  const fmtMin = (s) => `${Math.round(s / 60)}m`;

  return (
    <Panel pad="none">
      <div className="flex items-center justify-between" style={{ padding: '12px 16px 0' }}>
        <SectionHeader level="section" title="By reviewer" subtitle="Listen time comes from qa2_listen_log — did they actually listen before scoring." />
        <ExportButton rows={data.reviewers} headers={['Reviewer', 'Count', 'Avg score given', 'Avg active time', 'Flagged', 'Overridden', 'Listen time']} filename="qa2-reviewers-report.csv"
          mapRow={r => [r.name, r.count, r.avg_score ?? '', fmtMin(r.avg_active_seconds), r.flagged_count, r.overridden_count, fmtMin(r.listen_seconds)]} />
      </div>
      {data.reviewers.length === 0 ? <EmptyState compact title="No reviewer activity in range" /> : (
        <TableScroll>
          <table className="w-full text-sm">
            <thead><tr style={{ color: 'var(--color-text-secondary)' }}>
              <th className="text-left font-semibold px-3 py-2">Reviewer</th><th className="text-left font-semibold px-3 py-2">Count</th>
              <th className="text-left font-semibold px-3 py-2">Avg score given</th><th className="text-left font-semibold px-3 py-2">Avg time/review</th>
              <th className="text-left font-semibold px-3 py-2">Flagged</th><th className="text-left font-semibold px-3 py-2">Overridden</th>
              <th className="text-left font-semibold px-3 py-2">Listen time</th>
            </tr></thead>
            <tbody>
              {data.reviewers.map(r => (
                <tr key={r.reviewer_id} style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td className="px-3 py-2">{r.name}</td><td className="px-3 py-2">{r.count}</td>
                  <td className="px-3 py-2">{r.avg_score ?? '—'}</td><td className="px-3 py-2">{fmtMin(r.avg_active_seconds)}</td>
                  <td className="px-3 py-2">{r.flagged_count}</td><td className="px-3 py-2">{r.overridden_count}</td>
                  <td className="px-3 py-2">{fmtMin(r.listen_seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </Panel>
  );
}

function AutofailsSection({ params }) {
  const [data, setData] = useState(null);
  useEffect(() => { setData(null); client.get('qa2/reports/autofails', { params }).then(r => setData(r.data)).catch(() => setData({ total: 0, by_parameter: [], recent: [] })); }, [params]);
  if (!data) return <Loading variant="cards" />;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <KpiTile icon={ShieldAlert} label="Total autofails" value={data.total} tone="danger" />
        <KpiTile icon={ListChecks} label="Distinct triggers" value={data.by_parameter.length} tone="muted" />
      </div>
      {data.by_parameter.length > 0 && (
        <Panel pad="none">
          <div style={{ padding: '12px 16px 0' }}><SectionHeader level="section" title="Triggered by" /></div>
          <TableScroll>
            <table className="w-full text-sm">
              <thead><tr style={{ color: 'var(--color-text-secondary)' }}><th className="text-left font-semibold px-3 py-2">Parameter</th><th className="text-left font-semibold px-3 py-2">Times</th></tr></thead>
              <tbody>{data.by_parameter.map(p => (
                <tr key={p.lineage_id} style={{ borderTop: '1px solid var(--color-border)' }}><td className="px-3 py-2">{p.label}</td><td className="px-3 py-2">{p.count}</td></tr>
              ))}</tbody>
            </table>
          </TableScroll>
        </Panel>
      )}
      <Panel pad="none">
        <div className="flex items-center justify-between" style={{ padding: '12px 16px 0' }}>
          <SectionHeader level="section" title="Recent" />
          <ExportButton rows={data.recent} headers={['Date', 'Company', 'Method', 'Agent', 'Reviewer']} filename="qa2-autofails-report.csv"
            mapRow={e => [e.submitted_at || '', e.company, e.method, e.agent, e.reviewer]} />
        </div>
        {data.recent.length === 0 ? <EmptyState compact title="No autofails in range" /> : (
          <TableScroll>
            <table className="w-full text-sm">
              <thead><tr style={{ color: 'var(--color-text-secondary)' }}>
                <th className="text-left font-semibold px-3 py-2">Date</th><th className="text-left font-semibold px-3 py-2">Company</th>
                <th className="text-left font-semibold px-3 py-2">Method</th><th className="text-left font-semibold px-3 py-2">Agent</th>
                <th className="text-left font-semibold px-3 py-2">Reviewer</th>
              </tr></thead>
              <tbody>{data.recent.map(e => (
                <tr key={e.evaluation_id} style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td className="px-3 py-2">{e.submitted_at ? new Date(e.submitted_at).toLocaleDateString() : '—'}</td>
                  <td className="px-3 py-2">{e.company}</td><td className="px-3 py-2">{e.method}</td>
                  <td className="px-3 py-2">{e.agent}</td><td className="px-3 py-2">{e.reviewer}</td>
                </tr>
              ))}</tbody>
            </table>
          </TableScroll>
        )}
      </Panel>
    </div>
  );
}

function CalibrationSection({ params }) {
  const [data, setData] = useState(null);
  useEffect(() => { setData(null); client.get('qa2/reports/calibration', { params: { company_id: params.company_id } }).then(r => setData(r.data)).catch(() => setData({ groups: [], avg_variance: null })); }, [params.company_id]);
  if (!data) return <Loading variant="cards" />;

  return (
    <div className="space-y-3">
      <KpiTile icon={ScaleIcon} label="Average variance" value={data.avg_variance ?? '—'} sub="points, across scored groups" tone="muted" />
      <Panel pad="none">
        <div className="flex items-center justify-between" style={{ padding: '12px 16px 0' }}>
          <SectionHeader level="section" title="Calibration groups" subtitle="Higher variance = raters disagreeing — worth a look in the Calibration tab." />
          <ExportButton rows={data.groups} headers={['Company', 'Method', 'Agent', 'Scored', 'Variance']} filename="qa2-calibration-report.csv"
            mapRow={g => [g.company, g.method, g.agent, g.scored_count, g.variance ?? '']} />
        </div>
        {data.groups.length === 0 ? <EmptyState compact title="No calibration groups yet" /> : (
          <TableScroll>
            <table className="w-full text-sm">
              <thead><tr style={{ color: 'var(--color-text-secondary)' }}>
                <th className="text-left font-semibold px-3 py-2">Company</th><th className="text-left font-semibold px-3 py-2">Method</th>
                <th className="text-left font-semibold px-3 py-2">Agent</th><th className="text-left font-semibold px-3 py-2">Scored</th>
                <th className="text-left font-semibold px-3 py-2">Variance</th>
              </tr></thead>
              <tbody>{data.groups.map(g => (
                <tr key={g.calibration_group_id} style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td className="px-3 py-2">{g.company}</td><td className="px-3 py-2">{g.method}</td>
                  <td className="px-3 py-2">{g.agent}</td><td className="px-3 py-2">{g.scored_count}</td>
                  <td className="px-3 py-2"><strong>{g.variance ?? '—'}</strong></td>
                </tr>
              ))}</tbody>
            </table>
          </TableScroll>
        )}
      </Panel>
    </div>
  );
}

function CoverageSection({ params }) {
  const [data, setData] = useState(null);
  useEffect(() => { setData(null); client.get('qa2/reports/coverage', { params }).then(r => setData(r.data)).catch(() => setData({ rows: [] })); }, [params]);
  if (!data) return <Loading variant="cards" />;

  return (
    <Panel pad="none">
      <div className="flex items-center justify-between" style={{ padding: '12px 16px 0' }}>
        <SectionHeader level="section" title="Sampling coverage" subtitle="How much of the recorded call volume actually entered the pool." />
        <ExportButton rows={data.rows} headers={['Company', 'Method', 'Total calls', 'Assigned', 'Scored', 'Coverage %']} filename="qa2-coverage-report.csv"
          mapRow={r => [r.company, r.method, r.total, r.assigned, r.scored, r.coverage_pct]} />
      </div>
      {data.rows.length === 0 ? <EmptyState compact title="No calls recorded in range" /> : (
        <TableScroll>
          <table className="w-full text-sm">
            <thead><tr style={{ color: 'var(--color-text-secondary)' }}>
              <th className="text-left font-semibold px-3 py-2">Company</th><th className="text-left font-semibold px-3 py-2">Method</th>
              <th className="text-left font-semibold px-3 py-2">Total calls</th><th className="text-left font-semibold px-3 py-2">Assigned</th>
              <th className="text-left font-semibold px-3 py-2">Scored</th><th className="text-left font-semibold px-3 py-2">Coverage</th>
            </tr></thead>
            <tbody>{data.rows.map(r => (
              <tr key={`${r.company_id}:${r.method_id || 'x'}`} style={{ borderTop: '1px solid var(--color-border)' }}>
                <td className="px-3 py-2">{r.company}</td><td className="px-3 py-2">{r.method}</td>
                <td className="px-3 py-2">{r.total}</td><td className="px-3 py-2">{r.assigned}</td>
                <td className="px-3 py-2">{r.scored}</td><td className="px-3 py-2"><strong>{r.coverage_pct}%</strong></td>
              </tr>
            ))}</tbody>
          </table>
        </TableScroll>
      )}
    </Panel>
  );
}

export default function ReportsTab({ scope }) {
  const [section, setSection] = useState('agent');
  const [companies, setCompanies] = useState([]);
  const [companyId, setCompanyId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const myCompanyIds = scope?.operationalCompanyIds === 'all' || scope?.isCompliance ? null : (scope?.operationalCompanyIds || []);
  useEffect(() => {
    client.get('compliance/companies').then(r => {
      const all = r.data.companies || [];
      setCompanies(myCompanyIds ? all.filter(c => myCompanyIds.includes(c.id)) : all);
    }).catch(() => {});
  }, [myCompanyIds]);

  const params = useMemo(() => {
    const p = {};
    if (companyId) p.company_id = companyId;
    if (from) p.from = from;
    if (to) p.to = to;
    return p;
  }, [companyId, from, to]);

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <SectionHeader level="page" icon={BarChart3} title="Reports" subtitle="QA v2 scoring reports — filter by company and date range." />

      <Panel className="flex flex-wrap items-end gap-2">
        <div className="min-w-[180px]">
          <ThemedSelect value={companyId} onChange={e => setCompanyId(e.target.value)}>
            <option value="">All companies</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </ThemedSelect>
        </div>
        <ThemedDate value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} />
        <ThemedDate value={to} min={from || undefined} onChange={e => setTo(e.target.value)} />
        {(from || to || companyId) && (
          <button className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }} onClick={() => { setCompanyId(''); setFrom(''); setTo(''); }}>Clear</button>
        )}
      </Panel>

      <PillTabs items={SECTIONS} value={section} onChange={setSection} />

      {section === 'agent' && <AgentSection params={params} />}
      {section === 'parameters' && <ParametersSection params={params} />}
      {section === 'reviewers' && <ReviewersSection params={params} />}
      {section === 'autofails' && <AutofailsSection params={params} />}
      {section === 'calibration' && <CalibrationSection params={params} />}
      {section === 'coverage' && <CoverageSection params={params} />}
    </div>
  );
}
