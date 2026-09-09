import { useState, useCallback, useEffect, useRef } from 'react';
import {
  BarChart3, Users, TrendingUp, Send, DollarSign,
  CheckCircle, Clock, Download, ArrowRight, Award, AlertTriangle,
} from 'lucide-react';
import { Card } from '../UI';
import { accent } from '../UI/kit';
import DateRangePicker, { getPresetRange } from '../UI/DateRangePicker';
import client from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useFeatureFlags } from '../../contexts/FeatureFlagsContext';
import Tooltip from '../UI/Tooltip';
import TeamPerformance from '../Manager/TeamPerformance';
import { toast } from '../../utils/toast';
import { writeExport, logClientExport } from '../../utils/exportSpec';
import { buildFilename } from '../../utils/downloadFilename';
import { useExportColumns } from '../../hooks/useExportColumns';

// Plain-English explanation for every metric shown on this page.
const METRIC_TIP = {
  Transfers: 'Leads handed to your team in this window',
  Sales: 'Policies sold in this window',
  Won: 'Sales approved by compliance (closed_won / sold)',
  'In Review': 'Sales waiting on compliance approval',
  connected: 'Transfers this fronter got connected (completed)',
  converted: 'Transfers that turned into an approved sale',
  rejected: 'Transfers the closer rejected',
  'conv rate': 'Converted ÷ total leads — fronter lead quality',
  won: 'Sales this closer got approved',
  'down rev': 'Sum of upfront down payments on their won sales',
  'win rate': 'Won ÷ total sales — closer close rate',
  QA: 'Mean QA score across their evaluations in this window. Blank means never reviewed, which is not the same as scoring zero.',
  'company QA': 'Mean over every QA review in the window, not over agents — one heavily-sampled agent should not weigh the same as one sampled once.',
};

// Which board is this company's own team, and which is the partner side. Both
// are worth seeing: a fronter company wants to know which closers convert its
// leads, a closer company which fronters send workable ones. Saying so beats
// leaving a manager to guess whose staff a table lists.
const BOARD_NOTE = {
  fronter: { fronters: 'your fronters',            closers: 'closers who worked your leads' },
  closer:  { fronters: 'fronters who sent you leads', closers: 'your closers' },
};

// ── helpers ───────────────────────────────────────────────────────────────────
const MEDAL      = ['#f59e0b', '#94a3b8', '#b45309'];
const AVATAR_PAL = ['#6366f1','#0891b2','#059669','#dc2626','#7c3aed','#ea580c','#0284c7','#65a30d','#c026d3','#0d9488'];
const initials   = n => (n || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
const avatarClr  = n => AVATAR_PAL[(n?.charCodeAt(0) || 0) % AVATAR_PAL.length];

// downloadCSV now comes from utils/exportSpec via writeExport (one writer, not
// four). The only thing this copy did differently was prepend a UTF-8 BOM for
// Excel; the shared writer declares charset=utf-8 on the blob instead.


// Every <p> in here carries m-0. global.css sets `p { margin: var(--spacing-md) 0 }`
// and, being loaded after Tailwind's preflight, wins — so an unqualified <p> in
// a compact row silently adds 12px above and below its own line. These cells
// were paying that twice over.
//
// Colour comes from accent(tone), never a `text-${tone}-600` template: Tailwind
// never emits a class built from a template string, and dark mode inverts the
// -600 scales, which the CSS variables behind accent() already account for.
const StatCell = ({ value, label, tone = 'default', tip }) => (
  <div>
    <p className="text-xs font-bold m-0" style={{ color: accent(tone).fg }}>{value}</p>
    <Tooltip text={tip}>
      <p className="text-[11px] sm:text-[10px] cursor-help m-0" style={{ color: 'var(--color-text-tertiary)' }}>{label}</p>
    </Tooltip>
  </div>
);

// A QA score is null, never 0, when nobody has reviewed that person — a manager
// has to be able to tell "scored badly" from "never assessed", and on the
// largest company only 26 of 62 active agents have ever been reviewed.
const qaText = q => (q ? `${q.score}%` : '—');
const qaTone = q => (!q ? 'muted' : q.score >= 90 ? 'success' : q.score >= 75 ? 'warn' : 'danger');
const qaTip  = q => (q
  ? `${q.score}% mean over ${q.reviews} QA review${q.reviews === 1 ? '' : 's'} · ${q.pass_rate}% passed`
  : METRIC_TIP.QA);

const SkeletonRow = () => (
  <div className="flex items-center gap-3 p-3 rounded-xl" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
    <div className="w-7 h-7 rounded-full animate-pulse flex-shrink-0" style={{ backgroundColor: 'var(--color-border)' }} />
    <div className="w-8 h-8 rounded-full animate-pulse flex-shrink-0" style={{ backgroundColor: 'var(--color-border)' }} />
    <div className="flex-1 space-y-1.5">
      <div className="h-3.5 w-2/3 rounded animate-pulse" style={{ backgroundColor: 'var(--color-border)' }} />
      <div className="h-1.5 w-full rounded-full animate-pulse" style={{ backgroundColor: 'var(--color-border)' }} />
    </div>
    <div className="flex gap-4">
      {[1,2,3].map(i => (
        <div key={i} className="w-10 space-y-1">
          <div className="h-3.5 rounded animate-pulse" style={{ backgroundColor: 'var(--color-border)' }} />
          <div className="h-2.5 rounded animate-pulse" style={{ backgroundColor: 'var(--color-border)' }} />
        </div>
      ))}
    </div>
  </div>
);

// ── main component ────────────────────────────────────────────────────────────
const ReportsPanel = ({ companyId }) => {
  // null = unconfigured → each leaderboard keeps its own default column set.
  const { allowedFor } = useExportColumns(['reports_fronters', 'reports_closers']);
  const { hasPermission, canExport } = useAuth();
  const { isEnabled } = useFeatureFlags();

  const [fronters,   setFronters]   = useState([]);
  const [closers,    setClosers]    = useState([]);
  const [summary,    setSummary]    = useState({ transfers: 0, sales: 0, won: 0, pending: 0, revenue: 0 });
  const [loading,    setLoading]    = useState(false);
  const [activeTab,  setActiveTab]  = useState('fronters');
  const [dateRange,  setDateRange]  = useState(() => getPresetRange('30d'));
  const { date_from, date_to } = dateRange;
  // Which side this company is (fronter / closer), the company QA figure, and
  // whether the window was so large the server had to stop counting.
  const [meta, setMeta] = useState({ side: null, qa: null, truncated: false });
  // Once someone picks a tab themselves, stop moving it under them on reload.
  const tabPicked = useRef(false);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      // ONE request, counted server-side.
      //
      // WAS: 1,000 transfers and 1,000 sales pulled to the browser and tallied
      // here, while the summary strip above used the server's exact COUNT. Past
      // the thousandth row those disagree — the strip reported 2,907 transfers
      // and the table under it ranked the first 1,000, with the headline
      // looking perfectly right. /stats/leaderboards drains both queries and
      // returns the boards AND the strip from the same tally, so they cannot
      // contradict each other, and it adds the QA score per person on the way.
      const { data } = await client.get('stats/leaderboards', { params: { date_from, date_to } });

      setSummary(data.summary || { transfers: 0, sales: 0, won: 0, pending: 0, revenue: 0 });
      setFronters(data.fronters || []);
      setClosers(data.closers || []);
      setMeta({ side: data.side || null, qa: data.qa || null, truncated: !!data.truncated });

      // Open on the board holding this company's own team. An ops manager at a
      // closer company landing on the fronters tab is looking at someone
      // else's staff first.
      if (!tabPicked.current && data.side) setActiveTab(data.side === 'closer' ? 'closers' : 'fronters');
    } catch { /* non-critical */ } finally { setLoading(false); }
  }, [companyId, date_from, date_to]);

  useEffect(() => { load(); }, [load]);

  const handleExport = async () => {
    const isFronters = activeTab === 'fronters';
    const dataset = isFronters ? 'reports_fronters' : 'reports_closers';
    const rows = isFronters ? fronters : closers;
    // These rows are aggregated in the browser, so there is no list request for
    // egressAudit to intercept — this soft log is the only audit this surface
    // can have, and it still enforces the daily export cap.
    if (!await logClientExport(dataset, rows.length, { company_id: companyId })) {
      toast.error('Export blocked by your daily limit.');
      return;
    }
    writeExport({
      dataset, surface: dataset, allowed: allowedFor(dataset), rows,
      filename: buildFilename({
        dataset: isFronters ? 'fronters-report' : 'closers-report',
        dateFrom: date_from, dateTo: date_to,
      }),
    });
  };

  const convRate = summary.transfers > 0 ? Math.round((summary.won / summary.transfers) * 100) : 0;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6 animate-fade-in">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-text flex items-center gap-2">
            <BarChart3 size={22} style={{ color: 'var(--color-primary-600)' }} />
            Reports &amp; Analytics
          </h2>
          <p className="text-sm text-text-secondary mt-0.5">Agent performance breakdown</p>
        </div>
        <DateRangePicker onChange={setDateRange} defaultPreset="30d" />
      </div>

      {/* ── Summary strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Transfers', value: summary.transfers, icon: Send,        color: 'info'    },
          { label: 'Sales',     value: summary.sales,     icon: DollarSign,  color: 'success' },
          { label: 'Won',       value: summary.won,       icon: CheckCircle, color: 'success' },
          { label: 'In Review', value: summary.pending,   icon: Clock,       color: 'warn'    },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="p-4">
            <div className="flex items-center justify-between mb-2">
              <Tooltip text={METRIC_TIP[label]}><p className="text-xs font-semibold uppercase tracking-wide cursor-help" style={{ color: 'var(--color-text-secondary)' }}>{label}</p></Tooltip>
              {/* accent(color), not `bg-${color}-100`: Tailwind never emits a
                  class built from a template string. These rendered only
                  because literal siblings elsewhere in the app happened to
                  produce the same names — and dark:bg-primary-900 is genuinely
                  absent from the built CSS, so one chip had no dark-mode
                  background at all. */}
              <div className="p-1.5 rounded-lg" style={{ background: accent(color).soft }}>
                <Icon size={13} style={{ color: accent(color).fg }} />
              </div>
            </div>
            {loading
              ? <div className="h-7 w-12 rounded animate-pulse" style={{ backgroundColor: 'var(--color-border)' }} />
              : <p className="text-2xl font-bold m-0" style={{ color: accent(color).fg, letterSpacing: '-0.03em' }}>{value}</p>
            }
          </Card>
        ))}
      </div>

      {/* A window big enough to hit the server's 40k-row ceiling is reported,
          not quietly presented as a complete tally — the whole point of moving
          this counting server-side. */}
      {meta.truncated && (
        <Card className="px-5 py-3 flex items-start gap-2">
          <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" style={{ color: accent('warn').fg }} />
          <p className="text-xs m-0" style={{ color: 'var(--color-text-secondary)' }}>
            This range holds more records than one report can count. Narrow the dates for exact figures.
          </p>
        </Card>
      )}

      {/* ── Conversion / Revenue banner ── */}
      {!loading && summary.transfers > 0 && (
        <Card className="px-5 py-3.5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex items-center gap-2">
              <ArrowRight size={14} style={{ color: 'var(--color-primary-500)' }} />
              <span className="text-sm text-text-secondary">Overall conversion:</span>
              <span className="text-sm font-bold text-primary-600">{convRate}%</span>
              <span className="text-xs text-text-tertiary">
                ({summary.won} won / {summary.transfers} transfers)
              </span>
            </div>
            {hasPermission('view_financial_data') && summary.revenue > 0 && (
              <div className="flex items-center gap-2">
                <DollarSign size={14} style={{ color: 'var(--color-success-600)' }} />
                <span className="text-sm text-text-secondary">Down-payment revenue:</span>
                <span className="text-sm font-bold text-success-600">${summary.revenue.toLocaleString()}</span>
              </div>
            )}
            {/* Company QA, with the coverage it rests on. The score alone would
                imply the whole roster had been assessed; most of it has not. */}
            {meta.qa?.score != null && (
              <div className="flex items-center gap-2">
                <Award size={14} style={{ color: accent(qaTone(meta.qa)).fg }} />
                <Tooltip text={METRIC_TIP['company QA']}>
                  <span className="text-sm text-text-secondary cursor-help">QA score:</span>
                </Tooltip>
                <span className="text-sm font-bold" style={{ color: accent(qaTone(meta.qa)).fg }}>{meta.qa.score}%</span>
                <span className="text-xs text-text-tertiary">
                  ({meta.qa.reviews} review{meta.qa.reviews === 1 ? '' : 's'} across {meta.qa.reviewed_agents} agent{meta.qa.reviewed_agents === 1 ? '' : 's'})
                </span>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ── Daily trend charts + quick top agents (with hover tooltips) ── */}
      <TeamPerformance />

      {/* ── Tab bar + Export ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1 p-1 rounded-xl"
          style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          {[
            { key: 'fronters', label: 'Fronters', icon: Users,      count: fronters.length },
            { key: 'closers',  label: 'Closers',  icon: TrendingUp, count: closers.length  },
          ].map(({ key, label, icon: Icon, count }) => (
            <button key={key} onClick={() => { tabPicked.current = true; setActiveTab(key); }}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150 whitespace-nowrap"
              style={{
                background: activeTab === key ? 'var(--gradient-sidebar)' : 'transparent',
                color:      activeTab === key ? 'white' : 'var(--color-text-secondary)',
                boxShadow:  activeTab === key ? 'var(--shadow-sm)' : 'none',
              }}>
              <Icon size={14} />
              {label}
              {!loading && count > 0 && (
                <span className="text-[11px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded-md"
                  style={{
                    backgroundColor: activeTab === key ? 'rgba(255,255,255,0.2)' : 'var(--color-border)',
                    color: activeTab === key ? 'white' : 'var(--color-text-secondary)',
                  }}>
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>

        {isEnabled('exports') && canExport('reports') && (
          <button onClick={handleExport} disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-opacity hover:opacity-90"
            style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)' }}>
            <Download size={14} />
            Export CSV
          </button>
        )}
      </div>

      {/* ── Fronters table ── */}
      {activeTab === 'fronters' && (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-base font-bold text-text flex items-center gap-2">
              <Users size={16} /> Fronter Performance
              {meta.side && (
                <span className="text-xs font-normal text-text-secondary">— {BOARD_NOTE[meta.side].fronters}</span>
              )}
            </h3>
            {!loading && fronters.length > 0 && (
              <span className="text-xs text-text-tertiary">{fronters.length} agents</span>
            )}
          </div>

          {loading ? (
            <div className="space-y-2">{[1,2,3,4,5].map(i => <SkeletonRow key={i} />)}</div>
          ) : fronters.length === 0 ? (
            <div className="flex flex-col items-center py-12 gap-2">
              <Send size={32} className="text-text-tertiary opacity-30" />
              <p className="text-sm text-text-secondary">No transfer data for this period.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {fronters.map((f, i) => {
                const maxT    = fronters[0]?.total || 1;
                const barPct  = Math.round((f.total / maxT) * 100);
                const convPct = f.total > 0 ? Math.round((f.converted / f.total) * 100) : 0;
                const rateColor = convPct >= 30 ? 'var(--color-success-600)'
                  : convPct >= 15 ? 'var(--color-warning-600)'
                  : 'var(--color-error-600)';
                return (
                  <div key={f.id}
                    className="flex items-center gap-3 p-3 rounded-xl transition-colors hover:bg-bg-secondary"
                    style={{ border: '1px solid var(--color-border)' }}>
                    {/* Medal / rank */}
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black flex-shrink-0"
                      style={{
                        backgroundColor: i < 3 ? MEDAL[i] : 'transparent',
                        color:           i < 3 ? 'white' : 'var(--color-text-tertiary)',
                        border:          i >= 3 ? '1px solid var(--color-border)' : 'none',
                      }}>
                      {i + 1}
                    </div>
                    {/* Avatar */}
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                      style={{ backgroundColor: avatarClr(f.name) }}>
                      {initials(f.name)}
                    </div>
                    {/* Name + progress bar */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-semibold text-text truncate">{f.name}</span>
                        <span className="text-xs ml-2 flex-shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
                          {f.total} leads
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-border)' }}>
                        <div className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${barPct}%`, background: 'var(--gradient-sidebar)' }} />
                      </div>
                    </div>
                    {/* Stats columns */}
                    <div className="hidden sm:flex items-center gap-4 flex-shrink-0 text-right">
                      <StatCell value={f.completed} label="connected" tone="info"    tip={METRIC_TIP.connected} />
                      <StatCell value={f.converted} label="converted" tone="success" tip={METRIC_TIP.converted} />
                      <StatCell value={f.rejected}  label="rejected"  tone="danger"  tip={METRIC_TIP.rejected} />
                      {/* QA belongs beside the funnel, not only inside the QA
                          shell: it is the number a coaching conversation
                          actually opens with. */}
                      <StatCell value={qaText(f.qa)} label="QA" tone={qaTone(f.qa)} tip={qaTip(f.qa)} />
                    </div>
                    {/* Conv rate */}
                    <div className="text-right flex-shrink-0 min-w-[48px]">
                      <p className="text-sm font-black" style={{ color: rateColor }}>{convPct}%</p>
                      <Tooltip text={METRIC_TIP['conv rate']}><p className="text-[11px] sm:text-[10px] cursor-help" style={{ color: 'var(--color-text-tertiary)' }}>conv rate</p></Tooltip>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* ── Closers table ── */}
      {activeTab === 'closers' && (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-base font-bold text-text flex items-center gap-2">
              <TrendingUp size={16} /> Closer Performance
              {meta.side && (
                <span className="text-xs font-normal text-text-secondary">— {BOARD_NOTE[meta.side].closers}</span>
              )}
            </h3>
            {!loading && closers.length > 0 && (
              <span className="text-xs text-text-tertiary">{closers.length} closers</span>
            )}
          </div>

          {loading ? (
            <div className="space-y-2">{[1,2,3,4,5].map(i => <SkeletonRow key={i} />)}</div>
          ) : closers.length === 0 ? (
            <div className="flex flex-col items-center py-12 gap-2">
              <DollarSign size={32} className="text-text-tertiary opacity-30" />
              <p className="text-sm text-text-secondary">No sales data for this period.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {closers.map((c, i) => {
                const maxW   = closers[0]?.won || 1;
                const barPct = Math.round((c.won / maxW) * 100);
                const winPct = c.total > 0 ? Math.round((c.won / c.total) * 100) : 0;
                const rateColor = winPct >= 50 ? 'var(--color-success-600)'
                  : winPct >= 25 ? 'var(--color-warning-600)'
                  : 'var(--color-error-600)';
                return (
                  <div key={c.id}
                    className="flex items-center gap-3 p-3 rounded-xl transition-colors hover:bg-bg-secondary"
                    style={{ border: '1px solid var(--color-border)' }}>
                    {/* Medal / rank */}
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black flex-shrink-0"
                      style={{
                        backgroundColor: i < 3 ? MEDAL[i] : 'transparent',
                        color:           i < 3 ? 'white' : 'var(--color-text-tertiary)',
                        border:          i >= 3 ? '1px solid var(--color-border)' : 'none',
                      }}>
                      {i + 1}
                    </div>
                    {/* Avatar */}
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                      style={{ backgroundColor: avatarClr(c.name) }}>
                      {initials(c.name)}
                    </div>
                    {/* Name + bar */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-semibold text-text truncate">{c.name}</span>
                        <span className="text-xs ml-2 flex-shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
                          {c.total} sales
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-border)' }}>
                        <div className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${barPct}%`, background: 'linear-gradient(135deg,#16a34a,#15803d)' }} />
                      </div>
                    </div>
                    {/* Stats */}
                    <div className="hidden sm:flex items-center gap-4 flex-shrink-0 text-right">
                      <StatCell value={c.won} label="won" tone="success" tip={METRIC_TIP.won} />
                      {hasPermission('view_financial_data') && (
                        <StatCell value={`$${Number(c.revenue || 0).toLocaleString()}`} label="down rev" tone="primary" tip={METRIC_TIP['down rev']} />
                      )}
                      <StatCell value={qaText(c.qa)} label="QA" tone={qaTone(c.qa)} tip={qaTip(c.qa)} />
                    </div>
                    {/* Win rate */}
                    <div className="text-right flex-shrink-0 min-w-[48px]">
                      <p className="text-sm font-black" style={{ color: rateColor }}>{winPct}%</p>
                      <Tooltip text={METRIC_TIP['win rate']}><p className="text-[11px] sm:text-[10px] cursor-help" style={{ color: 'var(--color-text-tertiary)' }}>win rate</p></Tooltip>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}
    </div>
  );
};

export default ReportsPanel;
