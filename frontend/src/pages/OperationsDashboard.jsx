import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { useNavigate } from "react-router-dom";
import {
  Settings, TrendingUp, Send, DollarSign, Users,
  Phone, Search, BarChart3, RefreshCw, CheckCircle,
  XCircle, Clock, AlertCircle,
} from "lucide-react";
import { Card, Badge } from "../components/UI";
import { AppHeader } from "../components/Layout";
import { useDashboardStats } from "../hooks/useDashboardStats";
import { useNotifications } from "../hooks/useNotifications";
import CallbacksPage from "../components/Callbacks/CallbacksPage";
import SaleSearch from "../components/Sales/SaleSearch";
import client from "../api/client";

const TRANSFER_BADGE = { pending: 'warning', assigned: 'info', completed: 'success', cancelled: 'error', rejected: 'error' };
const SALE_BADGE     = { open: 'info', sold: 'success', cancelled: 'error', follow_up: 'warning', closed_won: 'success', closed_lost: 'error' };

const OperationsDashboard = () => {
  const { user, logout }               = useAuth();
  const { theme, toggleTheme }         = useTheme();
  const navigate                       = useNavigate();
  const { stats, loading: statsLoading, fetchStats } = useDashboardStats();
  const notifHook                      = useNotifications();

  const [activeTab, setActiveTab] = useState('overview');

  const [transfers, setTransfers]   = useState([]);
  const [sales, setSales]           = useState([]);
  const [fronters, setFronters]     = useState([]);
  const [closersLb, setClosersLb]   = useState([]);
  const [loading, setLoading]       = useState(false);

  // Reassign state
  const [availableClosers, setAvailableClosers] = useState([]);
  const [reassignTarget, setReassignTarget]     = useState(null);
  const [reassignCloser, setReassignCloser]     = useState('');
  const [reassigning, setReassigning]           = useState(false);

  const companyId = user?.company_id;

  const loadAll = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    fetchStats();
    try {
      const [tRes, sRes, closersRes] = await Promise.all([
        client.get('transfers', { params: { company_id: companyId, limit: 200 } }),
        client.get('sales',     { params: { company_id: companyId, limit: 200 } }),
        client.get('transfers/closers', { params: { company_id: companyId } }),
      ]);

      const allT = tRes.data.transfers || [];
      const allS = sRes.data.sales     || [];
      setTransfers(allT);
      setSales(allS);
      setAvailableClosers(closersRes.data.closers || []);

      // Build fronter leaderboard
      const fm = {};
      allT.forEach(t => {
        const k = t.created_by;
        const name = t.user_profiles
          ? `${t.user_profiles.first_name || ''} ${t.user_profiles.last_name || ''}`.trim() || 'Unknown'
          : 'Unknown';
        if (!fm[k]) fm[k] = { id: k, name, total: 0, completed: 0, rejected: 0 };
        fm[k].total++;
        if (t.status === 'completed') fm[k].completed++;
        if (t.status === 'rejected')  fm[k].rejected++;
      });
      setFronters(Object.values(fm).sort((a, b) => b.completed - a.completed));

      // Build closer leaderboard
      const cm = {};
      allS.forEach(s => {
        const k = s.closer_id;
        if (!k) return;
        if (!cm[k]) cm[k] = { id: k, name: k.slice(0, 8), total: 0, won: 0 };
        cm[k].total++;
        if (['sold', 'closed_won'].includes(s.status)) cm[k].won++;
      });
      setClosersLb(Object.values(cm).sort((a, b) => b.won - a.won));
    } catch { /* non-critical */ } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleLogout = () => { logout(); navigate('/login'); };

  const doReassign = async () => {
    if (!reassignCloser || !reassignTarget) return;
    setReassigning(true);
    try {
      await client.put(`transfers/${reassignTarget.id}`, { assigned_closer_id: reassignCloser });
      setReassignTarget(null);
      loadAll();
    } catch { /* non-critical */ } finally {
      setReassigning(false);
    }
  };

  const rejectedTransfers = transfers.filter(t => t.status === 'rejected');

  const TABS = [
    { key: 'overview',    label: 'Overview',     icon: BarChart3  },
    { key: 'transfers',   label: 'Transfers',    icon: Send       },
    { key: 'sales',       label: 'Sales',        icon: DollarSign },
    { key: 'leaderboard', label: 'Leaderboard',  icon: TrendingUp },
    { key: 'search',      label: 'Search Sales', icon: Search     },
    { key: 'callbacks',   label: 'Callbacks',    icon: Phone      },
  ];

  return (
    <div className="min-h-screen bg-bg">
      <AppHeader
        title="Operations Manager"
        logo={<div className="w-10 h-10 bg-gradient-sidebar rounded-lg flex items-center justify-center"><Settings className="text-white" size={24} /></div>}
        theme={theme} onThemeToggle={toggleTheme}
        userEmail={user?.email} userRole={user?.role_name || 'Operations Manager'} onLogout={handleLogout}
        notifications={notifHook.notifications} unreadCount={notifHook.unreadCount}
        onMarkRead={notifHook.markRead} onMarkAllRead={notifHook.markAllRead}
        onDeleteNotification={notifHook.deleteNotification} onClearNotifications={notifHook.clearAll}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6 animate-fade-in flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold mb-1 text-text">Welcome, {user?.first_name || user?.email}!</h2>
            <p className="text-text-secondary"><strong>{user?.role_name || 'Operations Manager'}</strong> at <strong>{user?.company_name}</strong></p>
          </div>
          <button onClick={loadAll} className="p-2 rounded-lg hover:bg-bg-secondary transition-colors">
            <RefreshCw size={18} style={{ color: 'var(--color-text-secondary)' }} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-1 mb-6 p-1 rounded-xl w-fit"
          style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150"
              style={{
                backgroundColor: activeTab === tab.key ? 'var(--color-surface)' : 'transparent',
                color:            activeTab === tab.key ? 'var(--color-primary-600)' : 'var(--color-text-secondary)',
                boxShadow:        activeTab === tab.key ? 'var(--shadow-sm)' : 'none',
              }}>
              <tab.icon size={15} />
              {tab.label}
              {tab.key === 'transfers' && rejectedTransfers.length > 0 && (
                <span className="ml-1 w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center text-white"
                  style={{ backgroundColor: 'var(--color-error-500)' }}>{rejectedTransfers.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── OVERVIEW ──────────────────────────────────────────── */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Total Transfers', value: statsLoading ? '—' : stats.totalTransfers || 0,  icon: Send,        color: 'info'    },
                { label: 'Total Sales',     value: statsLoading ? '—' : stats.totalSales     || 0,  icon: DollarSign,  color: 'success' },
                { label: 'Conversion',      value: statsLoading ? '—' : `${stats.conversionRate || 0}%`, icon: TrendingUp, color: 'primary' },
                { label: 'Rejected',        value: rejectedTransfers.length,                          icon: XCircle,     color: 'error'   },
              ].map(s => (
                <Card key={s.label} className="p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-text-secondary mb-1">{s.label}</p>
                      <p className={`text-3xl font-bold text-${s.color}-600`}>{s.value}</p>
                    </div>
                    <div className={`p-3 rounded-xl bg-${s.color}-100 dark:bg-${s.color}-900`}>
                      <s.icon size={20} className={`text-${s.color}-600`} />
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            {/* Rejected alert */}
            {rejectedTransfers.length > 0 && (
              <Card className="p-5 border-2" style={{ borderColor: 'var(--color-error-200)' }}>
                <h3 className="font-bold text-error-600 flex items-center gap-2 mb-3">
                  <AlertCircle size={18} /> {rejectedTransfers.length} Rejected Transfer(s) Need Reassignment
                </h3>
                <div className="space-y-2">
                  {rejectedTransfers.slice(0, 5).map(t => (
                    <div key={t.id} className="flex items-center justify-between p-3 rounded-xl"
                      style={{ backgroundColor: 'var(--color-error-50)' }}>
                      <div>
                        <p className="font-semibold text-text text-sm">
                          {t.form_data?.FirstName
                            ? `${t.form_data.FirstName} ${t.form_data.LastName || ''}`.trim()
                            : t.form_data?.customer_name || 'Customer'}
                        </p>
                        <p className="text-xs text-error-600">{t.rejection_reason || 'No reason'}</p>
                      </div>
                      <button onClick={() => { setReassignTarget(t); setReassignCloser(''); }}
                        className="px-3 py-1.5 text-sm font-bold rounded-lg text-white"
                        style={{ background: 'var(--gradient-sidebar)' }}>
                        Reassign
                      </button>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Quick leaderboards */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="p-5">
                <h3 className="font-bold text-text mb-3 flex items-center gap-2"><Users size={16} /> Top Fronters</h3>
                {fronters.slice(0, 5).map((f, i) => (
                  <div key={f.id} className="flex items-center gap-3 py-2 border-b last:border-0"
                    style={{ borderColor: 'var(--color-border)' }}>
                    <span className="text-sm font-bold w-5 text-center" style={{ color: 'var(--color-text-tertiary)' }}>{i + 1}</span>
                    <span className="flex-1 text-sm font-semibold text-text">{f.name}</span>
                    <span className="text-xs text-text-secondary">{f.total} leads</span>
                    <span className="text-xs font-bold text-success-600">{f.completed} won</span>
                  </div>
                ))}
              </Card>
              <Card className="p-5">
                <h3 className="font-bold text-text mb-3 flex items-center gap-2"><TrendingUp size={16} /> Top Closers</h3>
                {closersLb.slice(0, 5).map((c, i) => (
                  <div key={c.id} className="flex items-center gap-3 py-2 border-b last:border-0"
                    style={{ borderColor: 'var(--color-border)' }}>
                    <span className="text-sm font-bold w-5 text-center" style={{ color: 'var(--color-text-tertiary)' }}>{i + 1}</span>
                    <span className="flex-1 text-sm font-semibold text-text">{c.name}</span>
                    <span className="text-xs text-text-secondary">{c.total} sales</span>
                    <span className="text-xs font-bold text-success-600">{c.won} won</span>
                  </div>
                ))}
              </Card>
            </div>
          </div>
        )}

        {/* ── TRANSFERS ─────────────────────────────────────────── */}
        {activeTab === 'transfers' && (
          <Card className="p-6">
            <h3 className="text-xl font-bold text-text mb-4">All Transfers</h3>
            {loading ? (
              <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
            ) : transfers.length === 0 ? (
              <p className="text-text-secondary text-center py-8">No transfers yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                      {['Customer', 'Phone', 'Status', 'Rejection Reason', 'Date', 'Action'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-bold text-text-secondary uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {transfers.map(t => (
                      <tr key={t.id} className="hover:bg-bg-secondary transition-colors"
                        style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td className="px-4 py-3 font-semibold text-text">
                          {t.form_data?.FirstName
                            ? `${t.form_data.FirstName} ${t.form_data.LastName || ''}`.trim()
                            : t.form_data?.customer_name || '—'}
                        </td>
                        <td className="px-4 py-3 text-text-secondary">{t.form_data?.Phone || t.form_data?.customer_phone || '—'}</td>
                        <td className="px-4 py-3"><Badge variant={TRANSFER_BADGE[t.status] || 'secondary'} size="sm">{t.status}</Badge></td>
                        <td className="px-4 py-3 text-xs text-error-600">{t.rejection_reason || '—'}</td>
                        <td className="px-4 py-3 text-xs text-text-tertiary">{new Date(t.created_at).toLocaleDateString()}</td>
                        <td className="px-4 py-3">
                          {(t.status === 'rejected' || t.status === 'pending') && (
                            <button onClick={() => { setReassignTarget(t); setReassignCloser(''); }}
                              className="px-2 py-1 rounded text-xs font-bold text-white"
                              style={{ background: 'var(--gradient-sidebar)' }}>
                              Reassign
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        {/* ── SALES ─────────────────────────────────────────────── */}
        {activeTab === 'sales' && (
          <Card className="p-6">
            <h3 className="text-xl font-bold text-text mb-4">All Sales</h3>
            {loading ? (
              <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
            ) : sales.length === 0 ? (
              <p className="text-text-secondary text-center py-8">No sales yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                      {['Customer', 'Phone', 'Reference', 'Vehicle', 'Plan', 'Monthly', 'Status', 'Date'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-bold text-text-secondary uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sales.map(s => (
                      <tr key={s.id} className="hover:bg-bg-secondary transition-colors"
                        style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td className="px-4 py-3 font-semibold text-text">{s.customer_name || '—'}</td>
                        <td className="px-4 py-3 text-text-secondary">{s.customer_phone || '—'}</td>
                        <td className="px-4 py-3 font-mono text-xs text-text-secondary">{s.reference_no || '—'}</td>
                        <td className="px-4 py-3 text-xs text-text-secondary">{[s.car_year, s.car_make, s.car_model].filter(Boolean).join(' ') || '—'}</td>
                        <td className="px-4 py-3 text-xs text-text-secondary">{s.plan || '—'}</td>
                        <td className="px-4 py-3 text-xs font-semibold text-success-600">{s.monthly_payment ? `$${s.monthly_payment}` : '—'}</td>
                        <td className="px-4 py-3"><Badge variant={SALE_BADGE[s.status] || 'secondary'} size="sm">{s.status}</Badge></td>
                        <td className="px-4 py-3 text-xs text-text-tertiary">{new Date(s.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        {/* ── LEADERBOARD ───────────────────────────────────────── */}
        {activeTab === 'leaderboard' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-6">
              <h3 className="text-xl font-bold text-text mb-4 flex items-center gap-2"><Users size={20} /> Fronter Leaderboard</h3>
              {fronters.length === 0 ? <p className="text-text-secondary text-center py-4">No data yet.</p> : (
                <div className="space-y-3">
                  {fronters.map((f, i) => (
                    <div key={f.id} className="flex items-center gap-3 p-3 rounded-xl border"
                      style={{ borderColor: 'var(--color-border)' }}>
                      <span className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                        style={{ background: i < 3 ? 'var(--gradient-sidebar)' : 'var(--color-bg-secondary)',
                          color: i < 3 ? 'white' : 'var(--color-text-secondary)' }}>{i + 1}</span>
                      <span className="flex-1 font-semibold text-text text-sm">{f.name}</span>
                      <span className="text-xs text-text-secondary">{f.total}</span>
                      <span className="text-xs font-bold text-success-600">{f.completed} won</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card className="p-6">
              <h3 className="text-xl font-bold text-text mb-4 flex items-center gap-2"><TrendingUp size={20} /> Closer Leaderboard</h3>
              {closersLb.length === 0 ? <p className="text-text-secondary text-center py-4">No data yet.</p> : (
                <div className="space-y-3">
                  {closersLb.map((c, i) => (
                    <div key={c.id} className="flex items-center gap-3 p-3 rounded-xl border"
                      style={{ borderColor: 'var(--color-border)' }}>
                      <span className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                        style={{ background: i < 3 ? 'var(--gradient-sidebar)' : 'var(--color-bg-secondary)',
                          color: i < 3 ? 'white' : 'var(--color-text-secondary)' }}>{i + 1}</span>
                      <span className="flex-1 font-semibold text-text text-sm">{c.name}</span>
                      <span className="text-xs text-text-secondary">{c.total} sales</span>
                      <span className="text-xs font-bold text-success-600">{c.won} won</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}

        {activeTab === 'search'    && <SaleSearch />}
        {activeTab === 'callbacks' && <CallbacksPage user={user} />}
      </main>

      {/* Reassign Modal */}
      {reassignTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-md mx-4 rounded-2xl p-6 shadow-2xl"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <h3 className="text-lg font-bold text-text mb-4">Reassign Transfer</h3>
            <p className="text-sm text-text-secondary mb-4">
              Customer: <strong>
                {reassignTarget.form_data?.FirstName
                  ? `${reassignTarget.form_data.FirstName} ${reassignTarget.form_data.LastName || ''}`.trim()
                  : reassignTarget.form_data?.customer_name || 'Unknown'}
              </strong>
            </p>
            <select value={reassignCloser} onChange={e => setReassignCloser(e.target.value)} className="input mb-4">
              <option value="">— Select closer —</option>
              {availableClosers.map(c => (
                <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>
              ))}
            </select>
            <div className="flex gap-3">
              <button onClick={() => setReassignTarget(null)}
                className="flex-1 py-2 rounded-lg border font-semibold text-sm"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Cancel</button>
              <button onClick={doReassign} disabled={!reassignCloser || reassigning}
                className="flex-1 py-2 rounded-lg font-semibold text-sm text-white disabled:opacity-50"
                style={{ background: 'var(--gradient-sidebar)' }}>
                {reassigning ? 'Reassigning…' : 'Reassign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OperationsDashboard;
