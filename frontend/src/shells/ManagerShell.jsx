import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { useFeatureFlags } from "../contexts/FeatureFlagsContext";
import { useNavigate } from "react-router-dom";
import {
  Users, DollarSign, Send, Phone, BarChart3, TrendingUp,
  CheckCircle, XCircle, Clock, Hash, Car, User, ArrowRight,
  Search, Star, Shield, FileText, RefreshCw, AlertCircle, Plus,
} from "lucide-react";
import { Card, Badge, Alert } from "../components/UI";
import DateRangePicker, { getPresetRange } from "../components/UI/DateRangePicker";
import { AppHeader } from "../components/Layout";
import { useDashboardStats } from "../hooks/useDashboardStats";
import { useSales } from "../hooks/useSales";
import { useTransfers } from "../hooks/useTransfers";
import { useNotifications } from "../hooks/useNotifications";
import CallbacksOverview from "../components/Callbacks/CallbacksOverview";
import CallbackNumbers from "../components/CallbackNumbers/CallbackNumbers";
import NumberUploadManager from "../components/Numbers/NumberUploadManager";
import SaleSearch from "../components/Sales/SaleSearch";
import SaleModal from "../components/Closer/SaleModal";
import CrossRoleContent from "../components/Navigation/CrossRoleContent";
import TeamManagementPanel from "../components/Navigation/TeamManagementPanel";
import RoleManagementPanel from "../components/Navigation/RoleManagementPanel";
import ReviewsPanel from "../components/Navigation/ReviewsPanel";
import ReportsPanel from "../components/Navigation/ReportsPanel";
import FormBuilder from "../components/Admin/FormBuilder/FormBuilder";
import TransferDetailDrawer from "../components/Shared/TransferDetailDrawer";
import SaleDetailDrawer from "../components/Shared/SaleDetailDrawer";
import client from "../api/client";

const SALE_BADGE  = { open: 'info', sold: 'success', cancelled: 'error', follow_up: 'warning', closed_won: 'success', closed_lost: 'error', pending_review: 'warning', needs_revision: 'error' };
const SALE_LABEL  = { open: 'Pending', sold: 'Sold', cancelled: 'Cancelled', follow_up: 'Follow Up', closed_won: 'Approved', closed_lost: 'Lost', pending_review: 'In Review', needs_revision: 'Needs Revision' };
const XFER_BADGE  = { pending: 'warning', assigned: 'info', completed: 'success', cancelled: 'error', rejected: 'error' };

const ManagerShell = () => {
  const { user, logout, updateUser, hasPermission } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { isEnabled } = useFeatureFlags();
  const navigate = useNavigate();
  const notifHook = useNotifications();

  const { stats, loading: statsLoading, fetchStats } = useDashboardStats();
  const { sales, loading: salesLoading, fetchSales, createSale, updateSale } = useSales(user?.company_id);
  const { transfers, loading: xferLoading, fetchTransfers, updateTransfer } = useTransfers(user?.company_id);

  const companyId = user?.company_id;
  const [dateRange, setDateRange] = useState(() => getPresetRange('30d'));
  const { date_from, date_to } = dateRange;

  // ── Tab logic ─────────────────────────────────────────────────────────────
  const TABS = [
    { key: 'overview',  label: 'Overview',        icon: TrendingUp, always: true },
    ...((hasPermission('view_team_transfers') || hasPermission('view_all_company_transfers')) && isEnabled('transfers')
      ? [{ key: 'transfers',  label: 'Team Transfers', icon: Send       }] : []),
    ...(hasPermission('view_team_sales') && isEnabled('sales')
      ? [{ key: 'team_sales', label: 'Team Sales',     icon: DollarSign }] : []),
    ...(hasPermission('create_sale') && isEnabled('sales')
      ? [{ key: 'my_sales',   label: 'My Sales',       icon: DollarSign }] : []),
    ...(hasPermission('view_team_callbacks') && isEnabled('callbacks')
      ? [{ key: 'callbacks',  label: 'Team Callbacks', icon: Phone      }] : []),
    ...((hasPermission('view_fronter_stats') || hasPermission('view_closer_stats') || hasPermission('view_company_reports')) && isEnabled('reports')
      ? [{ key: 'reports',    label: 'Reports',        icon: BarChart3  }] : []),
    ...(hasPermission('view_all_call_reviews') && isEnabled('call_reviews')
      ? [{ key: 'reviews',    label: 'Reviews',        icon: Star       }] : []),
    ...(hasPermission('create_user') || hasPermission('edit_user')
      ? [{ key: 'team',       label: 'Team',           icon: Users      }] : []),
    ...(hasPermission('manage_roles')
      ? [{ key: 'roles',      label: 'Roles',          icon: Shield     }] : []),
    ...(hasPermission('manage_forms') && isEnabled('form_builder')
      ? [{ key: 'forms',      label: 'Form Builder',   icon: FileText   }] : []),
    ...(hasPermission('manage_callback_numbers') && (isEnabled('callback_numbers') || isEnabled('number_assignment'))
      ? [{ key: 'numbers',    label: 'Numbers',        icon: Hash       }] : []),
    ...(hasPermission('search_sales') && isEnabled('search_sales')
      ? [{ key: 'search',     label: 'Sale Search',    icon: Search     }] : []),
  ];

  const [activeTab, setActiveTab] = useState('overview');
  const [activeNav, setActiveNav] = useState('dashboard');

  // ── Overview data ─────────────────────────────────────────────────────────
  const [fronterLb, setFronterLb] = useState([]);
  const [closerLb, setCloserLb]   = useState([]);
  const [loading, setLoading]     = useState(false);

  // ── Reassign ──────────────────────────────────────────────────────────────
  const [availableClosers, setAvailableClosers] = useState([]);
  const [reassignTarget, setReassignTarget]     = useState(null);
  const [reassignCloser, setReassignCloser]     = useState('');
  const [reassigning, setReassigning]           = useState(false);
  const [reassignMsg, setReassignMsg]           = useState('');

  // ── Detail drawers ────────────────────────────────────────────────────────
  const [detailTransfer, setDetailTransfer] = useState(null);
  const [detailSale, setDetailSale]         = useState(null);

  // ── My Sales (for closer_manager who also sells) ──────────────────────────
  const [saleModalOpen, setSaleModalOpen] = useState(false);
  const [saleTransfer, setSaleTransfer]   = useState(null);
  const [saleLoading, setSaleLoading]     = useState(false);
  const [saleError, setSaleError]         = useState('');
  const [saleSuccess, setSaleSuccess]     = useState('');

  const loadOverview = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    fetchStats();
    try {
      const [tRes, sRes, closersRes] = await Promise.all([
        client.get('transfers', { params: { company_id: companyId, limit: 200, date_from, date_to } }),
        client.get('sales',     { params: { company_id: companyId, limit: 200, date_from, date_to } }),
        client.get('transfers/closers', { params: { company_id: companyId } }),
      ]);

      const allT = tRes.data.transfers || [];
      const allS = sRes.data.sales     || [];

      // Fronter leaderboard
      const fronterMap = {};
      allT.forEach(t => {
        const id = t.created_by; if (!id) return;
        if (!fronterMap[id]) fronterMap[id] = { id, name: t.fronter_name || id.slice(0, 8), transfers: 0, completed: 0 };
        fronterMap[id].transfers++;
        if (t.status === 'completed') fronterMap[id].completed++;
      });
      setFronterLb(Object.values(fronterMap).sort((a, b) => b.completed - a.completed));

      // Closer leaderboard
      const closerMap = {};
      allS.forEach(s => {
        const id = s.closer_id; if (!id) return;
        if (!closerMap[id]) closerMap[id] = { id, name: s.closer_name || id.slice(0, 8), sales: 0, won: 0, monthly: 0 };
        closerMap[id].sales++;
        if (['sold', 'closed_won'].includes(s.status)) { closerMap[id].won++; closerMap[id].monthly += Number(s.monthly_payment || 0); }
      });
      setCloserLb(Object.values(closerMap).sort((a, b) => b.won - a.won));
      setAvailableClosers(closersRes.data?.closers || []);
    } catch { /* non-critical */ } finally {
      setLoading(false);
    }
  }, [companyId, date_from, date_to]);

  useEffect(() => { loadOverview(); }, [loadOverview]);
  useEffect(() => { fetchTransfers({ date_from, date_to }); }, [fetchTransfers, date_from, date_to]);
  useEffect(() => { fetchSales({ date_from, date_to }); },     [fetchSales, date_from, date_to]);

  const handleLogout = () => { logout(); navigate('/login'); };

  const handleReassign = async () => {
    if (!reassignCloser) { setReassignMsg('Select a closer.'); return; }
    setReassigning(true);
    try {
      await client.put(`transfers/${reassignTarget.id}`, { assigned_closer_id: reassignCloser });
      setReassignTarget(null);
      setReassignCloser('');
      setReassignMsg('');
      loadOverview();
    } catch (err) {
      setReassignMsg(err.response?.data?.error || 'Failed to reassign');
    } finally {
      setReassigning(false);
    }
  };

  const handleSaleSubmit = async (formData) => {
    setSaleLoading(true);
    setSaleError('');
    try {
      await createSale(formData);
      setSaleModalOpen(false);
      setSaleSuccess('Sale created!');
      fetchStats();
      setTimeout(() => setSaleSuccess(''), 5000);
    } catch (err) {
      setSaleError(err.response?.data?.errors?.map(e => e.msg).join(', ') || err.response?.data?.error || 'Failed');
    } finally {
      setSaleLoading(false);
    }
  };

  const pendingTransfers = transfers.filter(t => ['pending', 'rejected'].includes(t.status));

  return (
    <div className="min-h-screen bg-bg">
      <AppHeader
        title={user?.role_name || 'Manager Dashboard'}
        logo={<div className="w-10 h-10 bg-gradient-sidebar rounded-lg flex items-center justify-center">
          <TrendingUp className="text-white" size={22} />
        </div>}
        theme={theme} onThemeToggle={toggleTheme}
        userEmail={user?.email} userRole={user?.role_name || user?.role}
        onLogout={handleLogout} user={user} onUpdateUser={updateUser}
        notifications={notifHook.notifications} unreadCount={notifHook.unreadCount}
        onMarkRead={notifHook.markRead} onMarkAllRead={notifHook.markAllRead}
        onDeleteNotification={notifHook.deleteNotification} onClearNotifications={notifHook.clearAll}
        navItems={[]} activeNav={activeNav} onNavChange={setActiveNav}
      />

      {activeNav !== 'dashboard' && <CrossRoleContent section={activeNav} user={user} />}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8"
        style={{ display: activeNav !== 'dashboard' ? 'none' : undefined }}>

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8 animate-fade-in">
          <div>
            <h2 className="text-3xl font-bold mb-1 text-text">Welcome back, {user?.first_name || user?.email}!</h2>
            <p className="text-text-secondary"><strong>{user?.role_name || user?.role}</strong> at <strong>{user?.company_name}</strong></p>
          </div>
          <button onClick={loadOverview} className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-semibold transition-all hover:bg-bg-secondary"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
            <RefreshCw size={16} /> Refresh
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
          <div className="flex gap-1 p-1 rounded-xl w-fit overflow-x-auto"
            style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            {TABS.map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150 whitespace-nowrap"
                style={{
                  background: activeTab === tab.key ? 'var(--gradient-sidebar)' : 'transparent',
                  color: activeTab === tab.key ? 'white' : 'var(--color-text-secondary)',
                  boxShadow: activeTab === tab.key ? 'var(--shadow-sm)' : 'none',
                }}>
                <tab.icon size={15} />{tab.label}
              </button>
            ))}
          </div>
          <DateRangePicker onChange={setDateRange} defaultPreset="30d" />
        </div>

        {/* ── OVERVIEW TAB ── */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Stats cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              {[
                { label: 'Total Transfers', value: stats.totalTransfers || 0,   icon: Send,       color: 'info'    },
                { label: 'Total Sales',     value: stats.totalSales    || 0,     icon: DollarSign, color: 'success' },
                { label: 'Approved Sales',  value: stats.closedWon     || 0,     icon: CheckCircle,color: 'success' },
                { label: 'Pending',         value: pendingTransfers.length || 0, icon: Clock,      color: 'warning' },
              ].map(({ label, value, icon: Icon, color }) => (
                <Card key={label} className="p-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-text-secondary mb-1">{label}</p>
                      <p className={`text-3xl font-bold text-${color}-600`} style={{ fontFamily: 'var(--font-display)', letterSpacing: '-0.03em' }}>{statsLoading ? '—' : value}</p>
                    </div>
                    <div className={`p-3 rounded-xl bg-${color}-100 dark:bg-${color}-900`}>
                      <Icon size={22} className={`text-${color}-600`} />
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            {/* Pending transfers alert */}
            {pendingTransfers.length > 0 && hasPermission('reassign_transfer') && (
              <Card className="p-6">
                <h3 className="text-lg font-bold mb-4 text-text flex items-center gap-2">
                  <AlertCircle size={20} className="text-warning-600" /> Pending / Rejected Transfers ({pendingTransfers.length})
                </h3>
                <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                  {pendingTransfers.slice(0, 10).map(t => (
                    <div key={t.id} onClick={() => setDetailTransfer(t)}
                      className="flex items-center justify-between p-3 rounded-xl border cursor-pointer hover:shadow-md transition-all"
                      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)' }}>
                      <div>
                        <p className="font-semibold text-text text-sm">
                          {t.form_data?.customer_name || t.form_data?.FirstName || 'Lead'}
                        </p>
                        {t.rejection_reason && <p className="text-xs text-error-600 mt-0.5">Reason: {t.rejection_reason}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={XFER_BADGE[t.status] || 'secondary'} size="sm">{t.status}</Badge>
                        <button onClick={e => { e.stopPropagation(); setReassignTarget(t); setReassignCloser(''); setReassignMsg(''); }}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold text-white"
                          style={{ background: 'var(--gradient-sidebar)' }}>
                          Reassign
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Leaderboards */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {hasPermission('view_fronter_stats') && (
                <Card className="p-6">
                  <h3 className="text-lg font-bold mb-4 text-text flex items-center gap-2"><BarChart3 size={18} /> Fronter Leaderboard</h3>
                  {loading ? <div className="flex justify-center py-6"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
                    : fronterLb.length === 0 ? <p className="text-text-secondary text-sm py-4">No data yet.</p>
                    : fronterLb.slice(0, 8).map((f, i) => (
                      <div key={f.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-bold w-6 text-text-tertiary">#{i + 1}</span>
                          <span className="text-sm font-semibold text-text">{f.name}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-text-secondary">{f.transfers} leads</span>
                          <span className="text-xs font-bold text-success-600">{f.completed} closed</span>
                        </div>
                      </div>
                    ))
                  }
                </Card>
              )}
              {hasPermission('view_closer_stats') && (
                <Card className="p-6">
                  <h3 className="text-lg font-bold mb-4 text-text flex items-center gap-2"><TrendingUp size={18} /> Closer Leaderboard</h3>
                  {loading ? <div className="flex justify-center py-6"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
                    : closerLb.length === 0 ? <p className="text-text-secondary text-sm py-4">No data yet.</p>
                    : closerLb.slice(0, 8).map((c, i) => (
                      <div key={c.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-bold w-6 text-text-tertiary">#{i + 1}</span>
                          <span className="text-sm font-semibold text-text">{c.name}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-text-secondary">{c.sales} sales</span>
                          <span className="text-xs font-bold text-success-600">{c.won} won</span>
                          {hasPermission('view_financial_data') && c.monthly > 0 && (
                            <span className="text-xs font-bold text-primary-600">${c.monthly.toLocaleString()}/mo</span>
                          )}
                        </div>
                      </div>
                    ))
                  }
                </Card>
              )}
            </div>
          </div>
        )}

        {/* ── TEAM TRANSFERS TAB ── */}
        {activeTab === 'transfers' && (
          <Card className="p-6">
            <h3 className="text-xl font-bold mb-4 text-text flex items-center gap-2"><Send size={20} /> Team Transfers</h3>
            {xferLoading ? <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
              : transfers.length === 0 ? <p className="text-text-secondary text-center py-8">No transfers in this period.</p>
              : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        {['Customer', 'Phone', 'Status', 'Closer', 'Date', 'Action'].map(h => (
                          <th key={h} className="text-left py-3 px-3 text-xs font-semibold text-text-secondary uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {transfers.slice(0, 50).map(t => (
                        <tr key={t.id} onClick={() => setDetailTransfer(t)}
                          className="border-b border-border hover:bg-bg-secondary transition-colors cursor-pointer">
                          <td className="py-3 px-3 font-semibold text-text">
                            {t.form_data?.customer_name || t.form_data?.FirstName || 'Lead'}
                          </td>
                          <td className="py-3 px-3 text-text-secondary text-xs">{t.form_data?.customer_phone || t.form_data?.Phone || '—'}</td>
                          <td className="py-3 px-3"><Badge variant={XFER_BADGE[t.status] || 'secondary'} size="sm">{t.status}</Badge></td>
                          <td className="py-3 px-3 text-text-secondary text-xs">{t.closer?.first_name || '—'}</td>
                          <td className="py-3 px-3 text-text-secondary text-xs">{new Date(t.created_at).toLocaleDateString()}</td>
                          <td className="py-3 px-3">
                            {hasPermission('reassign_transfer') && ['pending', 'rejected'].includes(t.status) && (
                              <button onClick={e => { e.stopPropagation(); setReassignTarget(t); setReassignCloser(''); setReassignMsg(''); }}
                                className="px-3 py-1.5 rounded-lg text-xs font-bold text-white"
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

        {/* ── TEAM SALES TAB ── */}
        {activeTab === 'team_sales' && (
          <Card className="p-6">
            <h3 className="text-xl font-bold mb-4 text-text flex items-center gap-2"><DollarSign size={20} /> Team Sales</h3>
            {salesLoading ? <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
              : sales.length === 0 ? <p className="text-text-secondary text-center py-8">No sales in this period.</p>
              : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        {['Customer', 'Reference', 'Status', 'Closer', hasPermission('view_financial_data') ? 'Monthly' : null, 'Date'].filter(Boolean).map(h => (
                          <th key={h} className="text-left py-3 px-3 text-xs font-semibold text-text-secondary uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sales.slice(0, 50).map(s => (
                        <tr key={s.id} onClick={() => setDetailSale(s)}
                          className="border-b border-border hover:bg-bg-secondary transition-colors cursor-pointer">
                          <td className="py-3 px-3 font-semibold text-text">{s.customer_name || '—'}</td>
                          <td className="py-3 px-3 text-xs font-mono text-text-tertiary">{s.reference_no || '—'}</td>
                          <td className="py-3 px-3"><Badge variant={SALE_BADGE[s.status] || 'secondary'} size="sm">{SALE_LABEL[s.status] || s.status}</Badge></td>
                          <td className="py-3 px-3 text-text-secondary text-xs">{s.closer_name || '—'}</td>
                          {hasPermission('view_financial_data') && <td className="py-3 px-3 text-xs font-semibold text-success-600">{s.monthly_payment ? `$${s.monthly_payment}/mo` : '—'}</td>}
                          <td className="py-3 px-3 text-text-secondary text-xs">{new Date(s.created_at).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </Card>
        )}

        {/* ── MY SALES TAB (closer-manager who also closes) ── */}
        {activeTab === 'my_sales' && (
          <div>
            {saleSuccess && <Alert type="success" title="Done!" message={saleSuccess} dismissible onDismiss={() => setSaleSuccess('')} />}
            {saleError   && <Alert type="error"   title="Error" message={saleError}   dismissible onDismiss={() => setSaleError('')}   />}
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-text">My Sales</h3>
              {hasPermission('create_sale') && (
                <button onClick={() => { setSaleTransfer(null); setSaleModalOpen(true); }}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold text-white"
                  style={{ background: 'var(--gradient-sidebar)' }}>
                  <Plus size={16} /> New Sale
                </button>
              )}
            </div>
            <Card className="p-6">
              {salesLoading ? <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
                : sales.filter(s => s.closer_id === user?.id).length === 0 ? <p className="text-text-secondary text-center py-8">No personal sales yet.</p>
                : (
                  <div className="space-y-3">
                    {/* Filter client-side from pre-fetched list; server scopes to closer_id for closer role */}
                    {sales.filter(s => s.closer_id === user?.id).map(s => (
                      <div key={s.id} onClick={() => setDetailSale(s)}
                        className="p-4 rounded-xl border hover:shadow-md transition-all cursor-pointer"
                        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)' }}>
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-semibold text-text">{s.customer_name || 'Sale'}</p>
                            <p className="text-xs text-text-secondary">{s.reference_no}</p>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <Badge variant={SALE_BADGE[s.status] || 'secondary'} size="sm">{SALE_LABEL[s.status] || s.status}</Badge>
                            {s.monthly_payment && hasPermission('view_financial_data') && (
                              <span className="text-xs font-semibold text-success-600">${s.monthly_payment}/mo</span>
                            )}
                          </div>
                        </div>
                        {hasPermission('update_sale') && s.status === 'open' && (
                          <div className="flex gap-2 mt-3">
                            <button onClick={e => { e.stopPropagation(); updateSale(s.id, { status: 'sold' }).then(() => fetchSales({ date_from, date_to })); }}
                              className="flex-1 py-1.5 px-3 rounded-lg text-xs font-bold text-white"
                              style={{ backgroundColor: '#16a34a' }}>
                              <CheckCircle size={12} className="inline mr-1" /> Mark Sold
                            </button>
                            <button onClick={e => { e.stopPropagation(); updateSale(s.id, { status: 'cancelled' }).then(() => fetchSales({ date_from, date_to })); }}
                              className="flex-1 py-1.5 px-3 rounded-lg text-xs font-bold text-red-600 border"
                              style={{ borderColor: '#ef4444' }}>
                              <XCircle size={12} className="inline mr-1" /> Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
            </Card>
          </div>
        )}

        {/* ── PANEL TABS (reuse existing components) ── */}
        {activeTab === 'callbacks' && <CallbacksOverview user={user} companyId={companyId} />}
        {activeTab === 'numbers'   && (
          <div className="space-y-6">
            {isEnabled('callback_numbers') && <CallbackNumbers user={user} />}
            {isEnabled('number_assignment') && hasPermission('manage_callback_numbers') && <NumberUploadManager companyId={companyId} />}
          </div>
        )}
        {activeTab === 'search'    && <SaleSearch />}
        {activeTab === 'team'      && <TeamManagementPanel companyId={companyId} />}
        {activeTab === 'roles'     && <RoleManagementPanel companyId={companyId} />}
        {activeTab === 'reviews'   && <ReviewsPanel companyId={companyId} />}
        {activeTab === 'reports'   && <ReportsPanel companyId={companyId} />}
        {activeTab === 'forms'     && (
          <div className="animate-fade-in">
            <FormBuilder />
          </div>
        )}
      </main>

      {/* Reassign modal */}
      {reassignTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-md mx-4 rounded-2xl p-6 shadow-2xl"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <h3 className="text-lg font-bold text-text mb-1">Reassign Transfer</h3>
            <p className="text-sm text-text-secondary mb-4">
              Customer: <strong>{reassignTarget.form_data?.customer_name || reassignTarget.form_data?.FirstName || 'Unknown'}</strong>
            </p>
            <label className="block text-sm font-medium text-text-secondary mb-1">Select Closer</label>
            <select value={reassignCloser} onChange={e => setReassignCloser(e.target.value)} className="input mb-3">
              <option value="">— Choose closer —</option>
              {availableClosers.map(c => (
                <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>
              ))}
            </select>
            {reassignMsg && <p className="text-sm text-error-600 mb-3">{reassignMsg}</p>}
            <div className="flex gap-3">
              <button onClick={() => setReassignTarget(null)} className="flex-1 py-2 rounded-lg border font-semibold text-sm"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Cancel</button>
              <button onClick={handleReassign} disabled={reassigning}
                className="flex-1 py-2 rounded-lg font-semibold text-sm text-white disabled:opacity-50"
                style={{ background: 'var(--gradient-sidebar)' }}>
                {reassigning ? 'Reassigning…' : 'Reassign'}
              </button>
            </div>
          </div>
        </div>
      )}

      <SaleModal isOpen={saleModalOpen} onClose={() => setSaleModalOpen(false)}
        user={user} transfer={saleTransfer} onSubmit={handleSaleSubmit} isLoading={saleLoading} />

      <TransferDetailDrawer transfer={detailTransfer} onClose={() => setDetailTransfer(null)} />
      <SaleDetailDrawer     sale={detailSale}         onClose={() => setDetailSale(null)} />
    </div>
  );
};

export default ManagerShell;
