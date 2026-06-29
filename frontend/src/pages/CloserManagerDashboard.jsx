import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../contexts/AuthContext";
import { transferPhone } from "../utils/phone";
import SaleSearch from "../components/Sales/SaleSearch";
import { useTheme } from "../contexts/ThemeContext";
import { useNavigate } from "react-router-dom";
import {
  Award, Users, DollarSign, TrendingUp, Target, BarChart3,
  Clock, CheckCircle, XCircle, Hash, Car, User, ArrowRight, Search, Phone, PlusCircle,
  Shield, FileText, Star, ChevronLeft, ChevronRight,
} from "lucide-react";
import { Card, Badge, Alert } from "../components/UI";
import DateRangePicker, { getPresetRange } from "../components/UI/DateRangePicker";
import SaleModal from "../components/Closer/SaleModal";
import { AppHeader } from "../components/Layout";
import { useSales } from "../hooks/useSales";
import { useTransfers } from "../hooks/useTransfers";
import { useNotifications } from "../hooks/useNotifications";
import CallbacksOverview from "../components/Callbacks/CallbacksOverview";
import CallbackNumbers from "../components/CallbackNumbers/CallbackNumbers";
import CrossRoleContent from "../components/Navigation/CrossRoleContent";
import client from "../api/client";

const saleBadge  = { open: 'info', sold: 'success', cancelled: 'error', follow_up: 'info', closed_won: 'success', closed_lost: 'error' };
const saleLabel  = { open: 'Pending', sold: 'Sold', cancelled: 'Cancelled', follow_up: 'Follow Up', closed_won: 'Won', closed_lost: 'Lost' };
const xferBadge  = { pending: 'warning', assigned: 'info', completed: 'success', cancelled: 'error' };
const PAGE_SIZE  = 25;

const Pagination = ({ page, total, onPage }) => {
  const totalPages = Math.ceil(total / PAGE_SIZE);
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between pt-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
      <span className="text-xs text-text-secondary">
        {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
      </span>
      <div className="flex items-center gap-1">
        <button onClick={() => onPage(page - 1)} disabled={page <= 1}
          className="p-1.5 rounded-lg disabled:opacity-40 transition-colors hover:bg-bg-secondary"
          style={{ color: 'var(--color-text-secondary)' }}>
          <ChevronLeft size={16} />
        </button>
        <span className="text-xs font-semibold px-2" style={{ color: 'var(--color-text)' }}>
          {page} / {totalPages}
        </span>
        <button onClick={() => onPage(page + 1)} disabled={page >= totalPages}
          className="p-1.5 rounded-lg disabled:opacity-40 transition-colors hover:bg-bg-secondary"
          style={{ color: 'var(--color-text-secondary)' }}>
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
};

const CloserManagerDashboard = () => {
  const { user, logout, hasPermission, updateUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const { sales, loading: salesLoading, fetchSales, createSale, updateSale } = useSales(user?.company_id);
  const { transfers, loading: xferLoading, fetchTransfers, updateTransfer } = useTransfers(user?.company_id);
  const notifHook = useNotifications();

  const [closers, setClosers]   = useState([]);
  const [assigning, setAssigning] = useState(null);
  const [activeTab, setActiveTab] = useState('my_sales');
  const [activeNav, setActiveNav] = useState('dashboard');

  const crossNavItems = [
    ...(hasPermission('view_company_members') || hasPermission('create_user') || hasPermission('edit_user')
      ? [{ key: 'team',    label: 'Team',    icon: Users    }] : []),
    ...(hasPermission('manage_roles')
      ? [{ key: 'roles',   label: 'Roles',   icon: Shield   }] : []),
    ...(hasPermission('manage_forms')
      ? [{ key: 'forms',   label: 'Forms',   icon: FileText }] : []),
    ...(hasPermission('view_call_reviews') || hasPermission('view_all_call_reviews')
      ? [{ key: 'reviews', label: 'Reviews', icon: Star     }] : []),
    ...(hasPermission('view_fronter_stats') || hasPermission('view_company_reports')
      ? [{ key: 'reports', label: 'Reports', icon: BarChart3}] : []),
  ];

  // ── Sale modal ─────────────────────────────────────────────────────────────
  const [saleModalOpen, setSaleModalOpen]   = useState(false);
  const [saleTransfer, setSaleTransfer]     = useState(null);
  const [saleLoading, setSaleLoading]       = useState(false);
  const [saleError, setSaleError]           = useState('');
  const [saleSuccess, setSaleSuccess]       = useState('');

  // ── Reject transfer ────────────────────────────────────────────────────────
  const [rejectTarget, setRejectTarget]   = useState(null);
  const [rejectReason, setRejectReason]   = useState('');
  const [rejecting, setRejecting]         = useState(false);
  const [rejectMsg, setRejectMsg]         = useState('');

  // ── Pagination ─────────────────────────────────────────────────────────────
  const [salesPage, setSalesPage]     = useState(1);
  const [xferPage, setXferPage]       = useState(1);

  const [dateRange, setDateRange] = useState(() => getPresetRange('30d'));
  const { date_from, date_to }    = dateRange;

  const handleDateChange = useCallback((range) => {
    setDateRange(range);
    setSalesPage(1);
    setXferPage(1);
  }, []);

  useEffect(() => { fetchClosers(); }, []);
  useEffect(() => { fetchSales({ date_from, date_to }); },     [fetchSales, date_from, date_to]);
  useEffect(() => { fetchTransfers({ date_from, date_to }); }, [fetchTransfers, date_from, date_to]);

  const fetchClosers = useCallback(async () => {
    try {
      const res = await client.get('users', { params: { company_id: user?.company_id } });
      const all = res.data.users || [];
      setClosers(all.filter(u =>
        u.role_level === 'closer' || u.role_name === 'Closer' ||
        (u.role || '').toLowerCase() === 'closer'
      ));
    } catch {}
  }, [user?.company_id]);

  const handleLogout = () => { logout(); navigate('/login'); };

  const openSaleModal = (transfer) => {
    setSaleTransfer(transfer);
    setSaleError('');
    setSaleModalOpen(true);
  };

  const handleSaleSubmit = async (formData) => {
    setSaleLoading(true);
    setSaleError('');
    try {
      await createSale(formData);
      setSaleModalOpen(false);
      setSaleSuccess(`Sale created! Ref: ${formData.reference_no || 'Generated'}`);
      fetchTransfers({ date_from, date_to });
      setTimeout(() => setSaleSuccess(''), 5000);
    } catch (err) {
      const msg = err.response?.data?.errors
        ? err.response.data.errors.map(e => e.msg).join(', ')
        : err.response?.data?.error || err.message || 'Failed to create sale';
      setSaleError(msg);
    } finally { setSaleLoading(false); }
  };

  const handleRejectTransfer = async () => {
    if (!rejectReason.trim()) { setRejectMsg('Reason required.'); return; }
    setRejecting(true);
    try {
      await client.post(`transfers/${rejectTarget.id}/reject`, { reason: rejectReason });
      setRejectTarget(null);
      setRejectReason('');
      setRejectMsg('');
      fetchTransfers({ date_from, date_to });
    } catch (err) {
      setRejectMsg(err.response?.data?.error || 'Failed to reject');
    } finally { setRejecting(false); }
  };

  const handleAssign = async (transferId, closerId) => {
    if (!closerId) return;
    setAssigning(transferId);
    try { await updateTransfer(transferId, { assigned_to: closerId, status: 'assigned' }); }
    catch {}
    setAssigning(null);
  };

  // ── Derived ────────────────────────────────────────────────────────────────
  const pendingTransfers  = transfers.filter(t => t.status === 'pending');
  const assignedTransfers = transfers.filter(t => t.status === 'assigned');

  const myTransfers  = transfers.filter(t => t.assigned_closer_id === user?.id);
  const mySales      = sales.filter(s => s.closer_id === user?.id || s.created_by === user?.id);
  const mySold       = mySales.filter(s => s.status === 'sold' || s.status === 'closed_won').length;
  const myConversion = mySales.length > 0 ? Math.round((mySold / mySales.length) * 100) : 0;

  // Date-filtered team stats (react to DateRangePicker)
  const totalSales     = sales.length;
  const wonSales       = sales.filter(s => s.status === 'sold' || s.status === 'closed_won').length;
  const conversionRate = totalSales > 0 ? Math.round((wonSales / totalSales) * 100) : 0;

  const closerStats = closers.map(c => {
    const cs = sales.filter(s => s.closer_id === c.user_id || s.created_by === c.user_id);
    return {
      ...c,
      total:   cs.length,
      sold:    cs.filter(s => s.status === 'sold' || s.status === 'closed_won').length,
      pending: cs.filter(s => s.status === 'open').length,
    };
  });

  // Client-side paginated slices
  const pagedSales    = sales.slice((salesPage - 1) * PAGE_SIZE, salesPage * PAGE_SIZE);
  const pagedXfer     = transfers.slice((xferPage - 1) * PAGE_SIZE, xferPage * PAGE_SIZE);
  const pagedPending  = pendingTransfers.slice((xferPage - 1) * PAGE_SIZE, xferPage * PAGE_SIZE);

  const TABS = [
    { key: 'my_sales',  label: 'My Sales',      icon: DollarSign },
    ...(hasPermission('view_team_sales')          ? [{ key: 'sales',          label: 'All Sales',       icon: DollarSign }] : []),
    { key: 'transfers', label: `Transfers${pendingTransfers.length > 0 ? ` (${pendingTransfers.length})` : ''}`, icon: ArrowRight },
    ...(hasPermission('view_closer_stats')        ? [{ key: 'team',           label: 'Team Stats',      icon: BarChart3  }] : []),
    ...(hasPermission('manage_callback_numbers')  ? [{ key: 'tracked_numbers',label: 'Numbers',         icon: Hash       }] : []),
    ...(hasPermission('view_team_callbacks')      ? [{ key: 'callbacks',      label: 'Callbacks',       icon: Phone      }] : []),
    ...(hasPermission('search_sales')             ? [{ key: 'search',         label: 'Search',          icon: Search     }] : []),
  ];

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      <AppHeader
        title="Closer Manager"
        logo={<div className="w-10 h-10 bg-gradient-sidebar rounded-lg flex items-center justify-center"><Award className="text-white" size={24} /></div>}
        theme={theme} onThemeToggle={toggleTheme}
        userEmail={user?.email} userRole={user?.role_name || user?.role} onLogout={handleLogout}
        user={user} onUpdateUser={updateUser}
        notifications={notifHook.notifications}
        unreadCount={notifHook.unreadCount}
        onMarkRead={notifHook.markRead}
        onMarkAllRead={notifHook.markAllRead}
        onDeleteNotification={notifHook.deleteNotification}
        onClearNotifications={notifHook.clearAll}
        navItems={crossNavItems} activeNav={activeNav} onNavChange={setActiveNav}
      />

      {activeNav !== 'dashboard' && <CrossRoleContent section={activeNav} user={user} />}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in"
        style={{ display: activeNav !== 'dashboard' ? 'none' : undefined }}>

        {saleSuccess && (
          <Alert type="success" title="Sale Created!" message={saleSuccess}
            dismissible onDismiss={() => setSaleSuccess('')} className="mb-4" />
        )}

        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h2 className="text-2xl font-bold text-text">Team Management</h2>
            <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
              Closer team at <strong>{user?.company_name}</strong>
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {pendingTransfers.length > 0 && (
              <div className="flex items-center gap-2 py-2 px-4 rounded-xl text-sm font-semibold"
                style={{ backgroundColor: 'rgba(245,158,11,0.1)', color: '#b45309', border: '1px solid rgba(245,158,11,0.3)' }}>
                <Clock size={15} />
                {pendingTransfers.length} pending assignment
              </div>
            )}
            {hasPermission('create_sale') && (
              <button onClick={() => openSaleModal(null)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm text-white transition-all hover:scale-105"
                style={{ background: 'var(--gradient-sidebar)', boxShadow: 'var(--shadow-md)' }}>
                <PlusCircle size={16} /> New Sale
              </button>
            )}
          </div>
        </div>

        {/* Date-reactive Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-text-secondary mb-1">Team Size</p>
                <p className="text-2xl font-bold text-text">{closers.length}</p>
              </div>
              <div className="p-2.5 rounded-xl bg-info-100"><Users size={18} className="text-info-600" /></div>
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-text-secondary mb-1">Total Sales</p>
                <p className="text-2xl font-bold text-success-600">{salesLoading ? '—' : totalSales}</p>
              </div>
              <div className="p-2.5 rounded-xl bg-success-100"><DollarSign size={18} className="text-success-600" /></div>
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-text-secondary mb-1">Conversion</p>
                <p className="text-2xl font-bold text-info-600">{salesLoading ? '—' : `${conversionRate}%`}</p>
              </div>
              <div className="p-2.5 rounded-xl bg-info-100"><Target size={18} className="text-info-600" /></div>
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-text-secondary mb-1">Won</p>
                <p className="text-2xl font-bold text-success-600">{salesLoading ? '—' : wonSales}</p>
              </div>
              <div className="p-2.5 rounded-xl bg-success-100"><TrendingUp size={18} className="text-success-600" /></div>
            </div>
          </Card>
        </div>

        {/* Tab bar + date picker */}
        <div className="mb-6 flex items-center justify-between gap-3 flex-wrap">
          <div className="overflow-x-auto flex-1 min-w-0">
            <div className="flex gap-1 p-1 rounded-xl w-fit min-w-full sm:min-w-0"
              style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
              {TABS.map(tab => (
                <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all duration-150 whitespace-nowrap flex-shrink-0"
                  style={{
                    background:  activeTab === tab.key ? 'var(--gradient-sidebar)' : 'transparent',
                    color:       activeTab === tab.key ? 'white' : 'var(--color-text-secondary)',
                    boxShadow:   activeTab === tab.key ? 'var(--shadow-sm)' : 'none',
                  }}>
                  <tab.icon size={13} />
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-shrink-0">
            <DateRangePicker onChange={handleDateChange} defaultPreset="30d" />
          </div>
        </div>

        {/* ── MY SALES ───────────────────────────────────────────────────── */}
        {activeTab === 'my_sales' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'My Sales',   value: mySales.length,                                      color: 'success' },
                { label: 'Sold',       value: mySold,                                              color: 'success' },
                { label: 'Conversion', value: `${myConversion}%`,                                  color: 'info'    },
                { label: 'Assigned',   value: myTransfers.filter(t => t.status === 'assigned').length, color: 'warning' },
              ].map(s => (
                <Card key={s.label} className="p-5">
                  <p className="text-xs text-text-secondary mb-1">{s.label}</p>
                  <p className={`text-2xl font-bold text-${s.color}-600`}>{s.value}</p>
                </Card>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* My Assigned Transfers */}
              <Card className="p-6">
                <h3 className="text-base font-bold mb-4 text-text flex items-center gap-2">
                  <Clock size={17} /> Assigned Transfers
                </h3>
                {xferLoading ? (
                  <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
                ) : myTransfers.length === 0 ? (
                  <p className="text-sm text-text-secondary text-center py-8">No transfers assigned yet.</p>
                ) : (
                  <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                    {myTransfers.map(t => (
                      <div key={t.id} className="p-4 rounded-xl border"
                        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)' }}>
                        <div className="flex items-start justify-between mb-1">
                          <div>
                            <p className="text-sm font-semibold text-text">
                              {t.form_data?.FirstName
                                ? `${t.form_data.FirstName} ${t.form_data.LastName || ''}`.trim()
                                : t.form_data?.customer_name || 'Unknown'}
                            </p>
                            <p className="text-xs text-text-secondary mt-0.5">{transferPhone(t) || ''}</p>
                          </div>
                          <Badge variant={xferBadge[t.status] || 'secondary'} size="sm">{t.status}</Badge>
                        </div>
                        <p className="text-xs text-text-tertiary mb-2">{new Date(t.created_at).toLocaleDateString()}</p>
                        {t.status === 'assigned' && (
                          <div className="flex gap-2 mt-2">
                            {hasPermission('create_sale') && (
                              <button onClick={() => openSaleModal(t)}
                                className="flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold text-white flex items-center justify-center gap-1"
                                style={{ background: 'var(--gradient-sidebar)' }}>
                                <DollarSign size={12} /> Convert
                              </button>
                            )}
                            {hasPermission('reject_transfer') && (
                              <button onClick={() => { setRejectTarget(t); setRejectReason(''); setRejectMsg(''); }}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold border flex items-center gap-1"
                                style={{ borderColor: 'var(--color-error-300)', color: 'var(--color-error-600)' }}>
                                <XCircle size={12} /> Reject
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {/* My Sales list */}
              <Card className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-bold text-text flex items-center gap-2"><DollarSign size={17} /> My Sales</h3>
                  {hasPermission('create_sale') && (
                    <button onClick={() => openSaleModal(null)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white"
                      style={{ background: 'var(--gradient-sidebar)' }}>
                      <PlusCircle size={13} /> New Sale
                    </button>
                  )}
                </div>
                {salesLoading ? (
                  <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
                ) : mySales.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-sm text-text-secondary mb-3">No sales yet.</p>
                    {hasPermission('create_sale') && (
                      <button onClick={() => openSaleModal(null)}
                        className="py-2 px-4 rounded-lg text-sm font-semibold text-white"
                        style={{ background: 'var(--gradient-sidebar)' }}>
                        Create first sale
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                    {mySales.map(s => (
                      <div key={s.id} className="p-4 rounded-xl border"
                        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)' }}>
                        <div className="flex items-start justify-between mb-1">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <User size={12} style={{ color: 'var(--color-text-tertiary)' }} />
                              <p className="text-sm font-semibold text-text truncate">{s.customer_name || 'Sale'}</p>
                            </div>
                            {s.reference_no && (
                              <p className="text-xs font-mono text-text-tertiary mt-0.5">{s.reference_no}</p>
                            )}
                            <p className="text-xs text-text-tertiary mt-1">{new Date(s.created_at).toLocaleDateString()}</p>
                          </div>
                          <div className="flex flex-col items-end gap-1 ml-2">
                            <Badge variant={saleBadge[s.status] || 'secondary'} size="sm">
                              {saleLabel[s.status] || s.status}
                            </Badge>
                            {s.monthly_payment && (
                              <span className="text-xs font-semibold text-success-600">${s.monthly_payment}/mo</span>
                            )}
                          </div>
                        </div>
                        {s.status === 'open' && hasPermission('update_sale') && (
                          <div className="flex gap-2 mt-2">
                            <button
                              onClick={() => updateSale(s.id, { status: 'sold' }).then(() => fetchSales({ date_from, date_to }))}
                              className="flex-1 py-1.5 px-3 rounded-lg text-xs font-bold text-white flex items-center justify-center gap-1"
                              style={{ backgroundColor: '#16a34a' }}>
                              <CheckCircle size={11} /> Mark Sold
                            </button>
                            <button
                              onClick={() => updateSale(s.id, { status: 'cancelled' }).then(() => fetchSales({ date_from, date_to }))}
                              className="flex-1 py-1.5 px-3 rounded-lg text-xs font-bold border flex items-center justify-center gap-1"
                              style={{ borderColor: '#ef4444', color: '#dc2626' }}>
                              <XCircle size={11} /> Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}

        {/* ── ALL SALES ──────────────────────────────────────────────────── */}
        {activeTab === 'sales' && (
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-text flex items-center gap-2">
                <DollarSign size={17} /> Team Sales
              </h3>
              <span className="text-xs text-text-secondary">{sales.length} total</span>
            </div>
            {salesLoading ? (
              <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
            ) : sales.length === 0 ? (
              <p className="text-sm text-text-secondary text-center py-8">No sales in this period.</p>
            ) : (
              <>
                <div className="space-y-2">
                  {pagedSales.map(s => (
                    <div key={s.id} className="p-4 rounded-xl border hover:shadow-sm transition-all"
                      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)' }}>
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <User size={12} style={{ color: 'var(--color-text-tertiary)' }} />
                            <p className="text-sm font-semibold text-text truncate">{s.customer_name || 'Sale'}</p>
                          </div>
                          {s.car_year && (
                            <div className="flex items-center gap-1 mt-0.5">
                              <Car size={11} style={{ color: 'var(--color-text-tertiary)' }} />
                              <p className="text-xs text-text-secondary">{s.car_year} {s.car_make} {s.car_model}</p>
                            </div>
                          )}
                          {s.reference_no && (
                            <p className="text-xs font-mono text-text-tertiary mt-0.5">{s.reference_no}</p>
                          )}
                          <p className="text-xs text-text-tertiary mt-1">{new Date(s.created_at).toLocaleDateString()}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1 ml-2">
                          <Badge variant={saleBadge[s.status] || 'secondary'} size="sm">
                            {saleLabel[s.status] || s.status}
                          </Badge>
                          {s.monthly_payment && hasPermission('view_financial_data') && (
                            <span className="text-xs font-semibold text-success-600">${s.monthly_payment}/mo</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <Pagination page={salesPage} total={sales.length} onPage={setSalesPage} />
              </>
            )}
          </Card>
        )}

        {/* ── TRANSFERS ──────────────────────────────────────────────────── */}
        {activeTab === 'transfers' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-6">
              <h3 className="text-base font-bold mb-4 text-text flex items-center gap-2">
                <Clock size={17} className="text-warning-600" /> Pending Assignment
                {pendingTransfers.length > 0 && <Badge variant="warning" size="sm">{pendingTransfers.length}</Badge>}
              </h3>
              {xferLoading ? (
                <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
              ) : pendingTransfers.length === 0 ? (
                <div className="text-center py-8">
                  <CheckCircle size={28} className="mx-auto mb-2 text-success-500" />
                  <p className="text-sm text-text-secondary">All transfers assigned!</p>
                </div>
              ) : (
                <>
                  <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
                    {pagedPending.map(t => (
                      <div key={t.id} className="p-4 rounded-xl border"
                        style={{ borderColor: 'rgba(245,158,11,0.3)', backgroundColor: 'rgba(245,158,11,0.04)' }}>
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <p className="text-sm font-semibold text-text">{t.form_data?.customer_name || 'Transfer'}</p>
                            <p className="text-xs text-text-secondary mt-0.5">{transferPhone(t) || t.form_data?.customer_email || ''}</p>
                          </div>
                          <Badge variant="warning" size="sm">Pending</Badge>
                        </div>
                        {hasPermission('assign_transfer') && (
                          <>
                            <label className="text-xs font-medium text-text-secondary mb-1 block">Assign to Closer:</label>
                            <select className="input text-sm" defaultValue=""
                              onChange={e => handleAssign(t.id, e.target.value)}
                              disabled={assigning === t.id}>
                              <option value="">Select closer…</option>
                              {closers.map(c => (
                                <option key={c.user_id} value={c.user_id}>
                                  {c.first_name} {c.last_name} ({c.email})
                                </option>
                              ))}
                            </select>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                  <Pagination page={xferPage} total={pendingTransfers.length} onPage={setXferPage} />
                </>
              )}
            </Card>

            <Card className="p-6">
              <h3 className="text-base font-bold mb-4 text-text flex items-center gap-2">
                <Users size={17} className="text-info-600" /> Active Assignments
                {assignedTransfers.length > 0 && <Badge variant="info" size="sm">{assignedTransfers.length}</Badge>}
              </h3>
              {xferLoading ? (
                <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
              ) : assignedTransfers.length === 0 ? (
                <p className="text-sm text-text-secondary text-center py-8">No active assignments.</p>
              ) : (
                <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                  {assignedTransfers.map(t => {
                    const isMyTransfer = t.assigned_closer_id === user?.id;
                    return (
                      <div key={t.id} className="p-4 rounded-xl border hover:shadow-sm transition-all"
                        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)' }}>
                        <div className="flex items-start justify-between mb-1">
                          <div>
                            <p className="text-sm font-semibold text-text">{t.form_data?.customer_name || 'Transfer'}</p>
                            <p className="text-xs text-text-secondary mt-0.5">{transferPhone(t) || t.form_data?.customer_email || ''}</p>
                          </div>
                          <Badge variant={xferBadge[t.status] || 'secondary'} size="sm">{t.status}</Badge>
                        </div>
                        <p className="text-xs text-text-tertiary mb-2">{new Date(t.created_at).toLocaleDateString()}</p>
                        {isMyTransfer && (
                          <div className="flex gap-2 mt-2">
                            {hasPermission('create_sale') && (
                              <button onClick={() => openSaleModal(t)}
                                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
                                style={{ background: 'var(--gradient-sidebar)' }}>
                                <DollarSign size={12} /> Convert
                              </button>
                            )}
                            {hasPermission('reject_transfer') && (
                              <button onClick={() => { setRejectTarget(t); setRejectReason(''); setRejectMsg(''); }}
                                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold"
                                style={{ backgroundColor: 'var(--color-error-50)', color: 'var(--color-error-600)', border: '1px solid var(--color-error-200)' }}>
                                <XCircle size={12} /> Reject
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        )}

        {/* ── TEAM STATS ─────────────────────────────────────────────────── */}
        {activeTab === 'team' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-6">
              <h3 className="text-base font-bold mb-4 text-text flex items-center gap-2">
                <BarChart3 size={17} /> Closer Performance
              </h3>
              {closers.length === 0 ? (
                <p className="text-sm text-text-secondary text-center py-8">No closers in team yet.</p>
              ) : (
                <div className="space-y-3">
                  {closerStats.map(c => (
                    <div key={c.user_id} className="p-4 rounded-xl border"
                      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)' }}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                            style={{ background: 'var(--gradient-sidebar)' }}>
                            {(c.first_name?.[0] || c.email?.[0] || '?').toUpperCase()}
                          </div>
                          <p className="text-sm font-semibold text-text">
                            {c.first_name ? `${c.first_name} ${c.last_name || ''}`.trim() : c.email}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 text-sm">
                          <span className="font-bold text-success-600">{c.sold} sold</span>
                          <span className="text-text-secondary text-xs">{c.total} total</span>
                        </div>
                      </div>
                      <div className="w-full h-2 rounded-full overflow-hidden"
                        style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                        {c.total > 0 && (
                          <div className="h-full rounded-full bg-success-500 transition-all"
                            style={{ width: `${(c.sold / c.total) * 100}%` }} />
                        )}
                      </div>
                      <div className="flex justify-between mt-1">
                        <span className="text-xs text-text-tertiary">{c.pending} open</span>
                        <span className="text-xs text-text-tertiary">
                          {c.total > 0 ? Math.round((c.sold / c.total) * 100) : 0}% conversion
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-6">
              <h3 className="text-base font-bold mb-4 text-text flex items-center gap-2">
                <Award size={17} /> Period Summary
              </h3>
              <div className="space-y-3">
                {[
                  { label: 'Open Deals',      val: sales.filter(s => s.status === 'open').length,                                    color: 'text-info-600'    },
                  { label: 'Sold / Won',       val: wonSales,                                                                          color: 'text-success-600' },
                  { label: 'Cancelled / Lost', val: sales.filter(s => ['cancelled', 'closed_lost'].includes(s.status)).length,        color: 'text-error-600'   },
                  { label: 'Total Transfers',  val: transfers.length,                                                                  color: 'text-text'        },
                ].map(row => (
                  <div key={row.label} className="flex items-center justify-between p-3 rounded-xl"
                    style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                    <span className="text-sm text-text-secondary font-medium">{row.label}</span>
                    <span className={`text-xl font-bold ${row.color}`}>{row.val}</span>
                  </div>
                ))}
              </div>
              {wonSales + sales.filter(s => ['cancelled', 'closed_lost'].includes(s.status)).length > 0 && (
                <div className="mt-5">
                  <p className="text-xs text-text-secondary mb-2">Win / Loss</p>
                  <div className="w-full h-3 rounded-full overflow-hidden flex"
                    style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                    {(() => {
                      const lost = sales.filter(s => ['cancelled', 'closed_lost'].includes(s.status)).length;
                      const total = wonSales + lost;
                      return (
                        <>
                          <div className="h-full bg-success-500 transition-all" style={{ width: `${(wonSales / total) * 100}%` }} />
                          <div className="h-full bg-error-500 transition-all"   style={{ width: `${(lost / total) * 100}%` }} />
                        </>
                      );
                    })()}
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-xs text-success-600 font-medium">Won ({wonSales})</span>
                    <span className="text-xs text-error-600 font-medium">Lost ({sales.filter(s => ['cancelled', 'closed_lost'].includes(s.status)).length})</span>
                  </div>
                </div>
              )}
            </Card>
          </div>
        )}

        {/* ── OTHER TABS ─────────────────────────────────────────────────── */}
        {activeTab === 'search'          && <SaleSearch companyId={user?.company_id} user={user} />}
        {activeTab === 'tracked_numbers' && <CallbackNumbers user={user} />}
        {activeTab === 'callbacks'       && <CallbacksOverview user={user} />}
      </main>

      {/* ── SALE MODAL ─────────────────────────────────────────────────── */}
      <SaleModal
        isOpen={saleModalOpen}
        onClose={() => setSaleModalOpen(false)}
        user={user}
        transfer={saleTransfer}
        onSubmit={handleSaleSubmit}
        isLoading={saleLoading}
      />
      {saleError && saleModalOpen && (
        <div className="fixed bottom-4 right-4 z-[60] max-w-sm p-4 rounded-xl shadow-xl text-sm text-error-700"
          style={{ backgroundColor: 'var(--color-error-50)', border: '1px solid var(--color-error-200)' }}>
          {saleError}
        </div>
      )}

      {/* ── REJECT MODAL ───────────────────────────────────────────────── */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 overflow-y-auto" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={e => { if (e.target === e.currentTarget) setRejectTarget(null); }}>
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="w-full max-w-md rounded-2xl p-6"
              style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <h3 className="text-lg font-bold text-text mb-3">Reject Transfer</h3>
              <p className="text-sm text-text-secondary mb-3">
                Rejecting: <strong>{rejectTarget.form_data?.customer_name || 'Transfer'}</strong>
              </p>
              <textarea className="input w-full mb-3 resize-none" rows={3}
                placeholder="Reason for rejection…"
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)} />
              {rejectMsg && <p className="text-xs text-error-600 mb-2">{rejectMsg}</p>}
              <div className="flex gap-3">
                <button onClick={() => setRejectTarget(null)}
                  className="flex-1 py-2 rounded-xl text-sm font-semibold border"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  Cancel
                </button>
                <button onClick={handleRejectTransfer} disabled={rejecting}
                  className="flex-1 py-2 rounded-xl text-sm font-semibold text-white"
                  style={{ background: 'var(--color-error-600)', opacity: rejecting ? 0.6 : 1 }}>
                  {rejecting ? 'Rejecting…' : 'Confirm Reject'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CloserManagerDashboard;
