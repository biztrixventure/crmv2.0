import { useState, useCallback, useEffect } from 'react';
import {
  BarChart3, Users, TrendingUp, Send, DollarSign,
  CheckCircle, Clock, Download, ArrowRight,
} from 'lucide-react';
import { Card } from '../UI';
import DateRangePicker, { getPresetRange } from '../UI/DateRangePicker';
import client from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';

// ── helpers ───────────────────────────────────────────────────────────────────
const MEDAL      = ['#f59e0b', '#94a3b8', '#b45309'];
const AVATAR_PAL = ['#6366f1','#0891b2','#059669','#dc2626','#7c3aed','#ea580c','#0284c7','#65a30d','#c026d3','#0d9488'];
const initials   = n => (n || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
const avatarClr  = n => AVATAR_PAL[(n?.charCodeAt(0) || 0) % AVATAR_PAL.length];

const downloadCSV = (rows, headers, filename) => {
  const csv = [headers, ...rows]
    .map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })),
    download: filename,
  });
  a.click(); URL.revokeObjectURL(a.href);
};

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
  const { hasPermission } = useAuth();

  const [fronters,   setFronters]   = useState([]);
  const [closers,    setClosers]    = useState([]);
  const [summary,    setSummary]    = useState({ transfers: 0, sales: 0, won: 0, pending: 0, revenue: 0 });
  const [loading,    setLoading]    = useState(false);
  const [activeTab,  setActiveTab]  = useState('fronters');
  const [dateRange,  setDateRange]  = useState(() => getPresetRange('30d'));
  const { date_from, date_to } = dateRange;

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const [tRes, sRes, soldRes, wonRes, pendRes] = await Promise.all([
        client.get('transfers', { params: { company_id: companyId, limit: 1000, date_from, date_to } }),
        client.get('sales',     { params: { company_id: companyId, limit: 1000, date_from, date_to } }),
        client.get('sales',     { params: { company_id: companyId, limit: 1, page: 1, date_from, date_to, status: 'sold' } }),
        client.get('sales',     { params: { company_id: companyId, limit: 1, page: 1, date_from, date_to, status: 'closed_won' } }),
        client.get('sales',     { params: { company_id: companyId, limit: 1, page: 1, date_from, date_to, status: 'pending_review' } }),
      ]);

      const allT = tRes.data.transfers || [];
      const allS = sRes.data.sales     || [];

      // Sale lookup by transfer_id — gives accurate fronter conversion count
      const saleByXfer = {};
      allS.forEach(s => { if (s.transfer_id) saleByXfer[s.transfer_id] = s; });

      // Summary stats (use server totals for accuracy)
      const revenue = allS
        .filter(s => ['sold', 'closed_won'].includes(s.status))
        .reduce((sum, s) => sum + Number(s.monthly_payment || 0), 0);
      setSummary({
        transfers: tRes.data.total || 0,
        sales:     sRes.data.total || 0,
        won:       (soldRes.data.total || 0) + (wonRes.data.total || 0),
        pending:   pendRes.data.total || 0,
        revenue,
      });

      // Fronter stats — sort by converted, then total
      const fm = {};
      allT.forEach(t => {
        const k = t.created_by; if (!k) return;
        if (!fm[k]) fm[k] = { id: k, name: t.fronter_name || 'Unknown', total: 0, completed: 0, rejected: 0, converted: 0 };
        fm[k].total++;
        if (t.status === 'completed') fm[k].completed++;
        if (t.status === 'rejected')  fm[k].rejected++;
        const linked = saleByXfer[t.id];
        if (linked && ['sold', 'closed_won'].includes(linked.status)) fm[k].converted++;
      });
      setFronters(Object.values(fm).sort((a, b) => b.converted - a.converted || b.total - a.total));

      // Closer stats
      const cm = {};
      allS.forEach(s => {
        const k = s.closer_id; if (!k) return;
        if (!cm[k]) cm[k] = { id: k, name: s.closer_name || k.slice(0, 8), total: 0, won: 0, revenue: 0 };
        cm[k].total++;
        if (['sold', 'closed_won'].includes(s.status)) {
          cm[k].won++;
          cm[k].revenue += Number(s.monthly_payment || 0);
        }
      });
      setClosers(Object.values(cm).sort((a, b) => b.won - a.won));
    } catch { /* non-critical */ } finally { setLoading(false); }
  }, [companyId, date_from, date_to]);

  useEffect(() => { load(); }, [load]);

  const handleExport = () => {
    const today = new Date().toISOString().split('T')[0];
    if (activeTab === 'fronters') {
      downloadCSV(
        fronters.map((f, i) => [
          i + 1, f.name, f.total, f.completed, f.converted, f.rejected,
          f.total > 0 ? `${Math.round((f.converted / f.total) * 100)}%` : '0%',
        ]),
        ['Rank', 'Name', 'Leads', 'Connected', 'Converted', 'Rejected', 'Conv %'],
        `fronters_report_${today}.csv`
      );
    } else {
      downloadCSV(
        closers.map((c, i) => [
          i + 1, c.name, c.total, c.won,
          c.total > 0 ? `${Math.round((c.won / c.total) * 100)}%` : '0%',
          `$${c.revenue.toLocaleString()}`,
        ]),
        ['Rank', 'Name', 'Sales', 'Won', 'Win Rate', 'Monthly Rev'],
        `closers_report_${today}.csv`
      );
    }
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
          { label: 'In Review', value: summary.pending,   icon: Clock,       color: 'warning' },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>{label}</p>
              <div className={`p-1.5 rounded-lg bg-${color}-100 dark:bg-${color}-900`}>
                <Icon size={13} className={`text-${color}-600`} />
              </div>
            </div>
            {loading
              ? <div className="h-7 w-12 rounded animate-pulse" style={{ backgroundColor: 'var(--color-border)' }} />
              : <p className={`text-2xl font-bold text-${color}-600`} style={{ letterSpacing: '-0.03em' }}>{value}</p>
            }
          </Card>
        ))}
      </div>

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
                <span className="text-sm text-text-secondary">Est. monthly revenue:</span>
                <span className="text-sm font-bold text-success-600">${summary.revenue.toLocaleString()}</span>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ── Tab bar + Export ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1 p-1 rounded-xl"
          style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          {[
            { key: 'fronters', label: 'Fronters', icon: Users,      count: fronters.length },
            { key: 'closers',  label: 'Closers',  icon: TrendingUp, count: closers.length  },
          ].map(({ key, label, icon: Icon, count }) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150 whitespace-nowrap"
              style={{
                background: activeTab === key ? 'var(--gradient-sidebar)' : 'transparent',
                color:      activeTab === key ? 'white' : 'var(--color-text-secondary)',
                boxShadow:  activeTab === key ? 'var(--shadow-sm)' : 'none',
              }}>
              <Icon size={14} />
              {label}
              {!loading && count > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md"
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

        <button onClick={handleExport} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-opacity hover:opacity-90"
          style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)' }}>
          <Download size={14} />
          Export CSV
        </button>
      </div>

      {/* ── Fronters table ── */}
      {activeTab === 'fronters' && (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-base font-bold text-text flex items-center gap-2">
              <Users size={16} /> Fronter Performance
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
                      <div>
                        <p className="text-xs font-bold text-info-600">{f.completed}</p>
                        <p className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>connected</p>
                      </div>
                      <div>
                        <p className="text-xs font-bold text-success-600">{f.converted}</p>
                        <p className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>converted</p>
                      </div>
                      <div>
                        <p className="text-xs font-bold text-error-600">{f.rejected}</p>
                        <p className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>rejected</p>
                      </div>
                    </div>
                    {/* Conv rate */}
                    <div className="text-right flex-shrink-0 min-w-[48px]">
                      <p className="text-sm font-black" style={{ color: rateColor }}>{convPct}%</p>
                      <p className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>conv rate</p>
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
                      <div>
                        <p className="text-xs font-bold text-success-600">{c.won}</p>
                        <p className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>won</p>
                      </div>
                      {hasPermission('view_financial_data') && (
                        <div>
                          <p className="text-xs font-bold text-primary-600">${c.revenue.toLocaleString()}</p>
                          <p className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>/mo rev</p>
                        </div>
                      )}
                    </div>
                    {/* Win rate */}
                    <div className="text-right flex-shrink-0 min-w-[48px]">
                      <p className="text-sm font-black" style={{ color: rateColor }}>{winPct}%</p>
                      <p className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>win rate</p>
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
