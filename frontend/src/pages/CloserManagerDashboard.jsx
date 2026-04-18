import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../contexts/AuthContext";
import SaleSearch from "../components/Sales/SaleSearch";
import { useTheme } from "../contexts/ThemeContext";
import { useNavigate } from "react-router-dom";
import {
  Award, Users, DollarSign, TrendingUp, Target, BarChart3,
  Clock, CheckCircle, XCircle, Hash, Car, User, ArrowRight, Search, Phone, PlusCircle,
} from "lucide-react";
import { Card, Badge, Alert } from "../components/UI";
import DateRangePicker, { getPresetRange } from "../components/UI/DateRangePicker";
import SaleModal from "../components/Closer/SaleModal";
import { AppHeader } from "../components/Layout";
import { useDashboardStats } from "../hooks/useDashboardStats";
import { useSales } from "../hooks/useSales";
import { useTransfers } from "../hooks/useTransfers";
import { useNotifications } from "../hooks/useNotifications";
import CallbacksOverview from "../components/Callbacks/CallbacksOverview";
import CallbackNumbers from "../components/CallbackNumbers/CallbackNumbers";
import client from "../api/client";

const saleBadge = { open: 'info', sold: 'success', cancelled: 'error', follow_up: 'info', closed_won: 'success', closed_lost: 'error' };
const saleLabel = { open: 'Pending', sold: 'Sold', cancelled: 'Cancelled', follow_up: 'Follow Up', closed_won: 'Won', closed_lost: 'Lost' };
const xferBadge = { pending: 'warning', assigned: 'info', completed: 'success', cancelled: 'error' };

const CloserManagerDashboard = () => {
  const { user, logout, hasPermission, updateUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const { stats, loading: statsLoading, fetchStats } = useDashboardStats();
  const { sales, loading: salesLoading, fetchSales, createSale } = useSales(user?.company_id);
  const { transfers, loading: xferLoading, fetchTransfers, updateTransfer } = useTransfers(user?.company_id);
  const notifHook = useNotifications();

  const [closers, setClosers] = useState([]);
  const [assigning, setAssigning] = useState(null);
  const [activeTab, setActiveTab] = useState('sales');

  // Sale creation (closer capability)
  const [saleModalOpen, setSaleModalOpen]     = useState(false);
  const [saleTransfer, setSaleTransfer]       = useState(null);
  const [saleLoading, setSaleLoading]         = useState(false);
  const [saleError, setSaleError]             = useState('');
  const [saleSuccess, setSaleSuccess]         = useState('');

  // Reject transfer (closer capability)
  const [rejectTarget, setRejectTarget]       = useState(null);
  const [rejectReason, setRejectReason]       = useState('');
  const [rejecting, setRejecting]             = useState(false);
  const [rejectMsg, setRejectMsg]             = useState('');

  const [dateRange, setDateRange] = useState(() => getPresetRange('30d'));
  const { date_from, date_to }    = dateRange;

  useEffect(() => { fetchStats(); fetchClosers(); }, []);
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

  const handleLogout = () => { logout(); navigate("/login"); };

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
    } finally {
      setSaleLoading(false);
    }
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
    } finally {
      setRejecting(false);
    }
  };

  const handleAssign = async (transferId, closerId) => {
    if (!closerId) return;
    setAssigning(transferId);
    try {
      await updateTransfer(transferId, { assigned_to: closerId, status: 'assigned' });
      fetchStats();
    } catch {}
    setAssigning(null);
  };

  const pendingTransfers  = transfers.filter(t => t.status === 'pending');
  const assignedTransfers = transfers.filter(t => t.status === 'assigned');

  // Per-closer breakdown from sales
  const closerStats = closers.map(c => {
    const cs = sales.filter(s => s.closer_id === c.user_id || s.created_by === c.user_id);
    return {
      ...c,
      total:   cs.length,
      sold:    cs.filter(s => s.status === 'sold' || s.status === 'closed_won').length,
      pending: cs.filter(s => s.status === 'open').length,
    };
  });

  return (
    <div className="min-h-screen bg-bg">
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
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {saleSuccess && (
          <Alert type="success" title="Sale Created!" message={saleSuccess}
            dismissible onDismiss={() => setSaleSuccess('')} className="mb-4" />
        )}

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8 animate-fade-in">
          <div>
            <h2 className="text-3xl font-bold mb-1 text-text">Team Management</h2>
            <p className="text-text-secondary">Closer team at <strong>{user?.company_name}</strong></p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {pendingTransfers.length > 0 && (
              <div className="flex items-center gap-2 py-2 px-4 rounded-xl font-semibold text-sm"
                style={{ backgroundColor: 'rgba(245,158,11,0.1)', color: '#b45309', border: '1px solid rgba(245,158,11,0.3)' }}>
                <Clock size={16} />
                {pendingTransfers.length} transfer{pendingTransfers.length > 1 ? 's' : ''} need assignment
              </div>
            )}
            <button
              onClick={() => openSaleModal(null)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm text-white transition-all hover:scale-105"
              style={{ background: 'var(--gradient-sidebar)', boxShadow: 'var(--shadow-md)' }}
            >
              <PlusCircle size={16} /> New Sale
            </button>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-8">
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-text-secondary mb-1">Team Size</p>
                <p className="text-3xl font-bold text-text">{closers.length || stats.teamSize || 0}</p>
              </div>
              <div className="p-3 rounded-xl bg-info-100 dark:bg-info-900"><Users size={22} className="text-info-600" /></div>
            </div>
          </Card>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-text-secondary mb-1">Total Sales</p>
                <p className="text-3xl font-bold text-success-600">{statsLoading ? '—' : stats.totalSales || 0}</p>
              </div>
              <div className="p-3 rounded-xl bg-success-100 dark:bg-success-900"><DollarSign size={22} className="text-success-600" /></div>
            </div>
          </Card>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-text-secondary mb-1">Conversion</p>
                <p className="text-3xl font-bold text-info-600">{statsLoading ? '—' : `${stats.conversionRate || 0}%`}</p>
              </div>
              <div className="p-3 rounded-xl bg-info-100 dark:bg-info-900"><Target size={22} className="text-info-600" /></div>
            </div>
          </Card>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-text-secondary mb-1">Won</p>
                <p className="text-3xl font-bold text-success-600">{statsLoading ? '—' : stats.closedWon || 0}</p>
              </div>
              <div className="p-3 rounded-xl bg-success-100 dark:bg-success-900"><TrendingUp size={22} className="text-success-600" /></div>
            </div>
          </Card>
        </div>

        {/* Tabs */}
        <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
          <div className="flex gap-1 p-1 rounded-xl w-fit"
            style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            {[
              { key: 'sales',     label: 'All Sales',     icon: DollarSign },
              { key: 'transfers', label: `Transfers${pendingTransfers.length > 0 ? ` (${pendingTransfers.length})` : ''}`, icon: ArrowRight },
              { key: 'team',            label: 'Team Stats',       icon: BarChart3 },
              { key: 'tracked_numbers', label: 'Tracked Numbers',  icon: Hash      },
              { key: 'callbacks',       label: 'Team Callbacks',   icon: Phone     },
              ...(hasPermission('search_sales') ? [{ key: 'search', label: 'Sale Search', icon: Search }] : []),
            ].map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150"
                style={{
                  backgroundColor: activeTab === tab.key ? 'var(--color-surface)' : 'transparent',
                  color: activeTab === tab.key ? 'var(--color-primary-600)' : 'var(--color-text-secondary)',
                  boxShadow: activeTab === tab.key ? 'var(--shadow-sm)' : 'none',
                }}>
                <tab.icon size={15} />
                {tab.label}
              </button>
            ))}
          </div>
          <DateRangePicker onChange={setDateRange} defaultPreset="30d" />
        </div>

        {/* === Tab: All Sales === */}
        {activeTab === 'sales' && (
          <Card className="p-6">
            <h3 className="text-xl font-bold mb-4 text-text flex items-center gap-2">
              <DollarSign size={20} /> Team Sales
            </h3>
            {salesLoading ? (
              <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
            ) : sales.length === 0 ? (
              <p className="text-text-secondary text-center py-8">No sales recorded yet.</p>
            ) : (
              <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                {sales.map(s => (
                  <div key={s.id} className="p-4 rounded-xl border transition-all duration-150 hover:shadow-md"
                    style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)' }}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <User size={13} style={{ color: 'var(--color-text-tertiary)' }} />
                          <p className="font-semibold text-text truncate">{s.customer_name || 'Sale'}</p>
                        </div>
                        {s.car_year && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <Car size={11} style={{ color: 'var(--color-text-tertiary)' }} />
                            <p className="text-xs text-text-secondary">{s.car_year} {s.car_make} {s.car_model}</p>
                          </div>
                        )}
                        {s.reference_no && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <Hash size={11} style={{ color: 'var(--color-text-tertiary)' }} />
                            <p className="text-xs font-mono text-text-tertiary">{s.reference_no}</p>
                          </div>
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
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* === Tab: Transfers === */}
        {activeTab === 'transfers' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-6">
              <h3 className="text-xl font-bold mb-4 text-text flex items-center gap-2">
                <Clock size={20} className="text-warning-600" /> Pending Assignment
                {pendingTransfers.length > 0 && <Badge variant="warning" size="sm">{pendingTransfers.length}</Badge>}
              </h3>
              {xferLoading ? (
                <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
              ) : pendingTransfers.length === 0 ? (
                <div className="text-center py-8">
                  <CheckCircle size={32} className="mx-auto mb-2 text-success-500" />
                  <p className="text-text-secondary">All transfers assigned!</p>
                </div>
              ) : (
                <div className="space-y-4 max-h-[500px] overflow-y-auto pr-1">
                  {pendingTransfers.map(t => (
                    <div key={t.id} className="p-4 rounded-xl border"
                      style={{ borderColor: 'rgba(245,158,11,0.3)', backgroundColor: 'rgba(245,158,11,0.04)' }}>
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <p className="font-semibold text-text">{t.form_data?.customer_name || 'Transfer'}</p>
                          <p className="text-xs text-text-secondary mt-0.5">
                            {t.form_data?.customer_phone || t.form_data?.customer_email || ''}
                          </p>
                        </div>
                        <Badge variant="warning" size="sm">Pending</Badge>
                      </div>
                      <label className="text-xs font-medium text-text-secondary mb-1 block">Assign to Closer:</label>
                      <select className="input text-sm" defaultValue=""
                        onChange={e => handleAssign(t.id, e.target.value)}
                        disabled={assigning === t.id}>
                        <option value="">Select closer...</option>
                        {closers.map(c => (
                          <option key={c.user_id} value={c.user_id}>
                            {c.first_name} {c.last_name} ({c.email})
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-6">
              <h3 className="text-xl font-bold mb-4 text-text flex items-center gap-2">
                <Users size={20} className="text-info-600" /> Active Assignments
                {assignedTransfers.length > 0 && <Badge variant="info" size="sm">{assignedTransfers.length}</Badge>}
              </h3>
              {xferLoading ? (
                <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
              ) : assignedTransfers.length === 0 ? (
                <p className="text-text-secondary text-center py-8">No active assignments.</p>
              ) : (
                <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                  {assignedTransfers.map(t => {
                    const isMyTransfer = t.assigned_closer_id === user?.id;
                    return (
                      <div key={t.id} className="p-4 rounded-xl border transition-all hover:shadow-md"
                        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)' }}>
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <p className="font-semibold text-text">{t.form_data?.customer_name || 'Transfer'}</p>
                            <p className="text-xs text-text-secondary mt-0.5">
                              {t.form_data?.customer_phone || t.form_data?.customer_email || ''}
                            </p>
                          </div>
                          <Badge variant={xferBadge[t.status] || 'secondary'} size="sm">{t.status}</Badge>
                        </div>
                        <p className="text-xs text-text-tertiary mb-2">{new Date(t.created_at).toLocaleDateString()}</p>
                        {isMyTransfer && (
                          <div className="flex gap-2 mt-2">
                            <button
                              onClick={() => openSaleModal(t)}
                              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
                              style={{ background: 'var(--gradient-sidebar)' }}
                            >
                              <DollarSign size={12} /> Convert to Sale
                            </button>
                            <button
                              onClick={() => { setRejectTarget(t); setRejectReason(''); setRejectMsg(''); }}
                              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold"
                              style={{ backgroundColor: 'var(--color-error-50)', color: 'var(--color-error-600)', border: '1px solid var(--color-error-200)' }}
                            >
                              <XCircle size={12} /> Reject
                            </button>
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

        {/* === Tab: Team Stats === */}
        {activeTab === 'team' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-6">
              <h3 className="text-xl font-bold mb-4 text-text flex items-center gap-2">
                <BarChart3 size={20} /> Closer Performance
              </h3>
              {closers.length === 0 ? (
                <p className="text-text-secondary text-center py-8">No closers in team yet.</p>
              ) : (
                <div className="space-y-3">
                  {closerStats.map(c => (
                    <div key={c.user_id} className="p-4 rounded-xl border"
                      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)' }}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                            style={{ background: 'var(--gradient-sidebar)' }}>
                            {(c.first_name?.[0] || c.email?.[0] || '?').toUpperCase()}
                          </div>
                          <p className="font-semibold text-sm text-text">
                            {c.first_name ? `${c.first_name} ${c.last_name || ''}`.trim() : c.email}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 text-sm">
                          <span className="font-bold text-success-600">{c.sold} sold</span>
                          <span className="text-text-secondary">{c.total} total</span>
                        </div>
                      </div>
                      <div className="w-full h-2 rounded-full overflow-hidden"
                        style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                        {c.total > 0 && (
                          <div className="h-full rounded-full bg-success-500 transition-all"
                            style={{ width: `${(c.sold / c.total) * 100}%` }} />
                        )}
                      </div>
                      <div className="flex justify-between mt-1 text-xs text-text-tertiary">
                        <span>{c.pending} open</span>
                        <span>{c.total > 0 ? Math.round((c.sold / c.total) * 100) : 0}% conversion</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-6">
              <h3 className="text-xl font-bold mb-4 text-text flex items-center gap-2">
                <Award size={20} /> Performance Summary
              </h3>
              <div className="space-y-3">
                {[
                  { label: 'Open Deals',     val: stats.openSales || 0,       color: 'text-info-600'    },
                  { label: 'Sold / Won',      val: stats.closedWon || 0,       color: 'text-success-600' },
                  { label: 'Cancelled/Lost', val: stats.closedLost || 0,      color: 'text-error-600'   },
                  { label: 'Total Transfers', val: stats.totalTransfers || 0,  color: 'text-text'        },
                ].map(row => (
                  <div key={row.label} className="flex items-center justify-between p-3 rounded-xl"
                    style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                    <span className="text-text-secondary font-medium">{row.label}</span>
                    <span className={`text-xl font-bold ${row.color}`}>{row.val}</span>
                  </div>
                ))}
              </div>
              {(stats.closedWon || 0) + (stats.closedLost || 0) > 0 && (
                <div className="mt-5">
                  <p className="text-sm text-text-secondary mb-2">Win/Loss Ratio</p>
                  <div className="w-full h-4 rounded-full overflow-hidden flex"
                    style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                    <div className="h-full bg-success-500 transition-all"
                      style={{ width: `${((stats.closedWon || 0) / ((stats.closedWon || 0) + (stats.closedLost || 0))) * 100}%` }} />
                    <div className="h-full bg-error-500 transition-all"
                      style={{ width: `${((stats.closedLost || 0) / ((stats.closedWon || 0) + (stats.closedLost || 0))) * 100}%` }} />
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-xs text-success-600 font-medium">Won</span>
                    <span className="text-xs text-error-600 font-medium">Lost</span>
                  </div>
                </div>
              )}
            </Card>
          </div>
        )}

        {/* === Tab: Sale Search === */}
        {activeTab === 'search' && (
          <Card className="p-6">
            <h3 className="text-xl font-bold mb-4 text-text flex items-center gap-2">
              <Search size={20} /> Sale Record Search
            </h3>
            <SaleSearch companyId={user?.company_id} user={user} />
          </Card>
        )}

        {activeTab === 'tracked_numbers' && <CallbackNumbers user={user} />}
        {activeTab === 'callbacks'       && <CallbacksOverview user={user} />}
      </main>

      {/* Sale conversion modal */}
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

      {/* Reject transfer modal */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={e => { if (e.target === e.currentTarget) setRejectTarget(null); }}>
          <div className="w-full max-w-md rounded-2xl p-6"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <h3 className="text-lg font-bold text-text mb-4">Reject Transfer</h3>
            <p className="text-sm text-text-secondary mb-3">
              Rejecting: <strong>{rejectTarget.form_data?.customer_name || 'Transfer'}</strong>
            </p>
            <textarea
              className="input w-full resize-none mb-3" rows={3}
              placeholder="Reason for rejection…"
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
            />
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
      )}
    </div>
  );
};

export default CloserManagerDashboard;
