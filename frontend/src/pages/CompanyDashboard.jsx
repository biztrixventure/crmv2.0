import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { useNavigate } from "react-router-dom";
import {
  Building2, Users, TrendingUp, DollarSign,
  Search, Settings, Shield, BarChart3, RefreshCw,
  Send, Calendar,
} from "lucide-react";
import { Card, Badge } from "../components/UI";
import { AppHeader } from "../components/Layout";
import { useDashboardStats } from "../hooks/useDashboardStats";
import { useNotifications } from "../hooks/useNotifications";
import { UserManagement } from "../components/Admin/UserManagement";
import RoleManagement from "../components/Admin/RoleManagement/RoleManagement";
import client from "../api/client";

const SALE_BADGE     = { open: 'info', sold: 'success', cancelled: 'error', follow_up: 'warning', closed_won: 'success', closed_lost: 'error' };
const TRANSFER_BADGE = { pending: 'warning', assigned: 'info', completed: 'success', cancelled: 'error', rejected: 'error' };

// ── Records search panel ──────────────────────────────────────────────────────
const RecordsSearch = ({ companyId, type }) => {
  const [results, setResults]   = useState([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(false);
  const [search, setSearch]     = useState('');
  const [status, setStatus]     = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const [page, setPage]         = useState(1);
  const LIMIT = 25;

  const doSearch = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const res = await client.get(type === 'sales' ? 'sales' : type, {
        params: {
          company_id: companyId,
          search:     search   || undefined,
          status:     status   || undefined,
          date_from:  dateFrom || undefined,
          date_to:    dateTo   || undefined,
          page:       p,
          limit:      LIMIT,
        },
      });
      setResults(res.data[type] || res.data.transfers || res.data.callbacks || []);
      setTotal(res.data.total || 0);
      setPage(p);
    } catch { /* non-critical */ } finally {
      setLoading(false);
    }
  }, [companyId, search, status, dateFrom, dateTo, type]);

  useEffect(() => { doSearch(1); }, []);

  const handleSearch = (e) => { e.preventDefault(); doSearch(1); };

  const SALE_STATUSES     = ['open','sold','cancelled','follow_up','closed_won','closed_lost'];
  const TRANSFER_STATUSES = ['pending','assigned','completed','cancelled','rejected'];
  const CALLBACK_STATUSES = ['pending','completed','cancelled','no_answer'];

  const statuses = type === 'sales' ? SALE_STATUSES : type === 'transfers' ? TRANSFER_STATUSES : CALLBACK_STATUSES;

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="relative lg:col-span-2">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={type === 'sales' ? 'Name, phone, reference…' : 'Customer name, phone…'}
            className="input pl-9" />
        </div>
        <select value={status} onChange={e => setStatus(e.target.value)} className="input">
          <option value="">All statuses</option>
          {statuses.map(s => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input" title="From date" />
        <input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   className="input" title="To date" />
        <button type="submit"
          className="lg:col-span-5 py-2.5 rounded-xl font-semibold text-sm text-white"
          style={{ background: 'var(--gradient-sidebar)' }}>
          Search — {total} record{total !== 1 ? 's' : ''}
        </button>
      </form>

      {loading ? (
        <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
      ) : results.length === 0 ? (
        <p className="text-text-secondary text-center py-8">No records found.</p>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            {type === 'sales' ? (
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                    {['Customer','Phone','Reference','Vehicle','Monthly','Status','Date'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-bold text-text-secondary uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map(s => (
                    <tr key={s.id} className="hover:bg-bg-secondary" style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td className="px-4 py-3 font-semibold text-text">{s.customer_name || '—'}</td>
                      <td className="px-4 py-3 text-text-secondary">{s.customer_phone || '—'}</td>
                      <td className="px-4 py-3 font-mono text-xs text-text-secondary">{s.reference_no || '—'}</td>
                      <td className="px-4 py-3 text-xs text-text-secondary">{[s.car_year,s.car_make,s.car_model].filter(Boolean).join(' ') || '—'}</td>
                      <td className="px-4 py-3 text-xs font-semibold text-success-600">{s.monthly_payment ? `$${s.monthly_payment}` : '—'}</td>
                      <td className="px-4 py-3"><Badge variant={SALE_BADGE[s.status] || 'secondary'} size="sm">{s.status}</Badge></td>
                      <td className="px-4 py-3 text-xs text-text-tertiary">{new Date(s.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : type === 'transfers' ? (
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                    {['Customer','Phone','Status','Date'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-bold text-text-secondary uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map(t => (
                    <tr key={t.id} className="hover:bg-bg-secondary" style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td className="px-4 py-3 font-semibold text-text">
                        {t.form_data?.FirstName
                          ? `${t.form_data.FirstName} ${t.form_data.LastName || ''}`.trim()
                          : t.form_data?.customer_name || '—'}
                      </td>
                      <td className="px-4 py-3 text-text-secondary">{t.form_data?.Phone || t.form_data?.customer_phone || '—'}</td>
                      <td className="px-4 py-3"><Badge variant={TRANSFER_BADGE[t.status] || 'secondary'} size="sm">{t.status}</Badge></td>
                      <td className="px-4 py-3 text-xs text-text-tertiary">{new Date(t.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                    {['Customer','Phone','Scheduled','Status'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-bold text-text-secondary uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map(c => (
                    <tr key={c.id} className="hover:bg-bg-secondary" style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td className="px-4 py-3 font-semibold text-text">{c.customer_name || '—'}</td>
                      <td className="px-4 py-3 text-text-secondary">{c.customer_phone || '—'}</td>
                      <td className="px-4 py-3 text-text-secondary text-xs">{new Date(c.callback_at).toLocaleString()}</td>
                      <td className="px-4 py-3"><Badge variant={c.status === 'pending' ? 'warning' : c.status === 'completed' ? 'success' : 'error'} size="sm">{c.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {total > LIMIT && (
            <div className="flex items-center justify-between px-4 py-3"
              style={{ borderTop: '1px solid var(--color-border)' }}>
              <span className="text-sm text-text-secondary">{(page-1)*LIMIT+1}–{Math.min(page*LIMIT,total)} of {total}</span>
              <div className="flex gap-2">
                <button disabled={page===1} onClick={()=>doSearch(page-1)}
                  className="px-3 py-1 rounded text-sm font-semibold disabled:opacity-40"
                  style={{color:'var(--color-text-secondary)'}}>Previous</button>
                <button disabled={page*LIMIT>=total} onClick={()=>doSearch(page+1)}
                  className="px-3 py-1 rounded text-sm font-semibold disabled:opacity-40"
                  style={{color:'var(--color-text-secondary)'}}>Next</button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
};

// ── Main dashboard ────────────────────────────────────────────────────────────
const CompanyDashboard = () => {
  const { user, logout, updateUser }               = useAuth();
  const { theme, toggleTheme }         = useTheme();
  const navigate                       = useNavigate();
  const { stats, loading: statsLoading, fetchStats } = useDashboardStats();
  const notifHook                      = useNotifications();

  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => { fetchStats(); }, []);

  const handleLogout = () => { logout(); navigate("/login"); };

  const TABS = [
    { key: 'overview',   label: 'Overview',    icon: BarChart3  },
    { key: 'users',      label: 'Users',       icon: Users      },
    { key: 'roles',      label: 'Roles',       icon: Shield     },
    { key: 'sales',      label: 'Sales',       icon: DollarSign },
    { key: 'transfers',  label: 'Transfers',   icon: Send       },
    { key: 'callbacks',  label: 'Callbacks',   icon: Calendar   },
  ];

  return (
    <div className="min-h-screen bg-bg">
      <AppHeader
        title="Company Admin"
        logo={<div className="w-10 h-10 bg-gradient-sidebar rounded-lg flex items-center justify-center"><Building2 className="text-white" size={24} /></div>}
        theme={theme} onThemeToggle={toggleTheme}
        userEmail={user?.email} userRole={user?.role_name || user?.role} onLogout={handleLogout}
        user={user} onUpdateUser={updateUser}
        notifications={notifHook.notifications} unreadCount={notifHook.unreadCount}
        onMarkRead={notifHook.markRead} onMarkAllRead={notifHook.markAllRead}
        onDeleteNotification={notifHook.deleteNotification} onClearNotifications={notifHook.clearAll}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6 animate-fade-in flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold mb-1 text-text">Welcome, {user?.first_name || user?.email}!</h2>
            <p className="text-text-secondary"><strong>{user?.company_name}</strong></p>
          </div>
          <button onClick={fetchStats} className="p-2 rounded-lg hover:bg-bg-secondary transition-colors">
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
            </button>
          ))}
        </div>

        {/* ── OVERVIEW ──────────────────────────────────────────── */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Total Transfers', value: stats.totalTransfers || 0,  icon: Send,        color: 'info'    },
              { label: 'Total Sales',     value: stats.totalSales     || 0,  icon: DollarSign,  color: 'success' },
              { label: 'Conversion %',    value: `${stats.conversionRate || 0}%`, icon: TrendingUp, color: 'primary' },
              { label: 'Active Users',    value: stats.activeUsers    || 0,  icon: Users,       color: 'warning' },
            ].map(s => (
              <Card key={s.label} className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-text-secondary mb-1">{s.label}</p>
                    <p className={`text-3xl font-bold text-${s.color}-600`}>
                      {statsLoading ? '—' : s.value}
                    </p>
                  </div>
                  <div className={`p-3 rounded-xl bg-${s.color}-100 dark:bg-${s.color}-900`}>
                    <s.icon size={20} className={`text-${s.color}-600`} />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {activeTab === 'users'     && <UserManagement />}
        {activeTab === 'roles'     && <RoleManagement />}
        {activeTab === 'sales'     && <RecordsSearch companyId={user?.company_id} type="sales" />}
        {activeTab === 'transfers' && <RecordsSearch companyId={user?.company_id} type="transfers" />}
        {activeTab === 'callbacks' && <RecordsSearch companyId={user?.company_id} type="callbacks" />}
      </main>
    </div>
  );
};

export default CompanyDashboard;
