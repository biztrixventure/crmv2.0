import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { useNavigate } from "react-router-dom";
import {
  TrendingUp, DollarSign, Target, Clock,
  CheckCircle, XCircle, Plus, Hash, User, Car, Phone, Search,
} from "lucide-react";
import { Card, Badge, Alert } from "../components/UI";
import { AppHeader } from "../components/Layout";
import { useDashboardStats } from "../hooks/useDashboardStats";
import { useTransfers } from "../hooks/useTransfers";
import { useSales } from "../hooks/useSales";
import { useNotifications } from "../hooks/useNotifications";
import SaleModal from "../components/Closer/SaleModal";
import CallbacksPage from "../components/Callbacks/CallbacksPage";
import SaleSearch from "../components/Sales/SaleSearch";
import client from "../api/client";

const statusBadge = { pending: 'warning', assigned: 'info', completed: 'success', cancelled: 'error' };
const saleBadge   = { open: 'info', sold: 'success', cancelled: 'error', follow_up: 'info', closed_won: 'success', closed_lost: 'error' };
const saleLabel   = { open: 'Pending', sold: 'Sold', cancelled: 'Cancelled', follow_up: 'Follow Up', closed_won: 'Won', closed_lost: 'Lost' };

const CloserDashboard = () => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const { stats, loading: statsLoading, fetchStats } = useDashboardStats();
  const { transfers, loading: tLoading, fetchTransfers } = useTransfers(user?.company_id);
  const { sales, loading: sLoading, fetchSales, createSale, updateSale } = useSales(user?.company_id);
  const notifHook = useNotifications();
  const [activeTab, setActiveTab] = useState('sales');

  // Reject modal state
  const [rejectTarget, setRejectTarget]   = useState(null);
  const [rejectReason, setRejectReason]   = useState('');
  const [rejecting, setRejecting]         = useState(false);
  const [rejectMsg, setRejectMsg]         = useState('');

  // Modal state
  const [modalOpen, setModalOpen]       = useState(false);
  const [activeTransfer, setActiveTransfer] = useState(null); // transfer being converted
  const [saleLoading, setSaleLoading]   = useState(false);
  const [saleError, setSaleError]       = useState('');
  const [saleSuccess, setSaleSuccess]   = useState('');

  useEffect(() => {
    fetchStats();
    fetchTransfers();
    fetchSales();
  }, []);

  const handleLogout = () => { logout(); navigate('/login'); };

  // Open modal for a specific transfer (or standalone)
  const openSaleModal = (transfer = null) => {
    setActiveTransfer(transfer);
    setSaleError('');
    setSaleSuccess('');
    setModalOpen(true);
  };

  const handleSaleSubmit = async (formData) => {
    setSaleLoading(true);
    setSaleError('');
    try {
      await createSale(formData);
      setModalOpen(false);
      setSaleSuccess(`Sale created! Ref: ${formData.reference_no || 'Generated'}`);
      fetchStats();
      fetchTransfers();
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

  const handleUpdateSale = async (saleId, status) => {
    try {
      await updateSale(saleId, { status });
      fetchStats();
    } catch {}
  };

  const handleRejectTransfer = async () => {
    if (!rejectReason.trim()) { setRejectMsg('Reason required.'); return; }
    setRejecting(true);
    try {
      await client.post(`transfers/${rejectTarget.id}/reject`, { reason: rejectReason });
      setRejectTarget(null);
      setRejectReason('');
      setRejectMsg('');
      fetchTransfers();
      fetchStats();
    } catch (err) {
      setRejectMsg(err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Failed to reject');
    } finally {
      setRejecting(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg">
      <AppHeader
        title="Closer Dashboard"
        logo={
          <div className="w-10 h-10 bg-gradient-sidebar rounded-lg flex items-center justify-center">
            <TrendingUp className="text-white" size={24} />
          </div>
        }
        theme={theme}
        onThemeToggle={toggleTheme}
        userEmail={user?.email}
        userRole={user?.role_name || user?.role}
        onLogout={handleLogout}
        notifications={notifHook.notifications}
        unreadCount={notifHook.unreadCount}
        onMarkRead={notifHook.markRead}
        onMarkAllRead={notifHook.markAllRead}
        onDeleteNotification={notifHook.deleteNotification}
        onClearNotifications={notifHook.clearAll}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Welcome + Quick Create Sale */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8 animate-fade-in">
          <div>
            <h2 className="text-3xl font-bold mb-1 text-text">
              Welcome back, {user?.first_name || user?.email}!
            </h2>
            <p className="text-text-secondary">
              <strong>{user?.role_name || user?.role}</strong> at <strong>{user?.company_name}</strong>
            </p>
          </div>
          <button
            onClick={() => openSaleModal(null)}
            className="flex items-center gap-2 py-3 px-6 rounded-xl font-bold text-white transition-all duration-200 hover:scale-105"
            style={{ background: 'var(--gradient-sidebar)', boxShadow: 'var(--shadow-md)' }}
          >
            <Plus size={20} />
            New Sale
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 mb-6 p-1 rounded-xl w-fit"
          style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          {[
            { key: 'sales',     label: 'My Sales',    icon: DollarSign },
            { key: 'callbacks', label: 'Callbacks',   icon: Phone      },
            { key: 'search',    label: 'Search Sales', icon: Search     },
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

        {activeTab === 'callbacks' && <CallbacksPage user={user} />}
        {activeTab === 'search'    && <SaleSearch />}
        {activeTab === 'sales' && <div>

        {/* Alerts */}
        {saleSuccess && (
          <Alert type="success" title="Sale Created!" message={saleSuccess}
            dismissible onDismiss={() => setSaleSuccess('')} />
        )}
        {saleError && (
          <Alert type="error" title="Sale Failed" message={saleError}
            dismissible onDismiss={() => setSaleError('')} />
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-8">
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-text-secondary mb-1">My Sales</p>
                <p className="text-3xl font-bold text-text">{statsLoading ? '—' : stats.totalSales || 0}</p>
              </div>
              <div className="p-3 rounded-xl bg-success-100 dark:bg-success-900">
                <DollarSign size={22} className="text-success-600" />
              </div>
            </div>
          </Card>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-text-secondary mb-1">Sold</p>
                <p className="text-3xl font-bold text-success-600">{statsLoading ? '—' : stats.closedWon || 0}</p>
              </div>
              <div className="p-3 rounded-xl bg-success-100 dark:bg-success-900">
                <CheckCircle size={22} className="text-success-600" />
              </div>
            </div>
          </Card>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-text-secondary mb-1">Conversion</p>
                <p className="text-3xl font-bold text-info-600">{statsLoading ? '—' : `${stats.conversionRate || 0}%`}</p>
              </div>
              <div className="p-3 rounded-xl bg-info-100 dark:bg-info-900">
                <Target size={22} className="text-info-600" />
              </div>
            </div>
          </Card>
          <Card className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-text-secondary mb-1">Assigned</p>
                <p className="text-3xl font-bold text-warning-600">{statsLoading ? '—' : stats.assignedTransfers || 0}</p>
              </div>
              <div className="p-3 rounded-xl bg-warning-100 dark:bg-warning-900">
                <Clock size={22} className="text-warning-600" />
              </div>
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Assigned Transfers */}
          <Card className="p-6">
            <h3 className="text-xl font-bold mb-4 text-text flex items-center gap-2">
              <Clock size={20} /> Assigned Transfers
            </h3>
            {tLoading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
              </div>
            ) : transfers.length === 0 ? (
              <p className="text-text-secondary text-center py-8">No transfers assigned to you yet.</p>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                {transfers.slice(0, 15).map(t => (
                  <div key={t.id} className="p-4 rounded-xl border transition-all duration-150 hover:shadow-md"
                    style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)' }}>
                    <div className="flex items-start justify-between mb-1">
                      <div>
                        <p className="font-semibold text-text">
                          {t.form_data?.FirstName
                            ? `${t.form_data.FirstName} ${t.form_data.LastName || ''}`.trim()
                            : t.form_data?.customer_name || 'Unknown Customer'}
                        </p>
                        <p className="text-xs text-text-secondary mt-0.5">
                          {t.form_data?.Phone || t.form_data?.customer_phone || t.form_data?.customer_email || ''}
                        </p>
                      </div>
                      <Badge variant={statusBadge[t.status] || 'secondary'} size="sm">{t.status}</Badge>
                    </div>
                    {t.status === 'assigned' && (
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={() => openSaleModal(t)}
                          className="flex-1 py-2 px-3 rounded-lg font-semibold text-sm text-white flex items-center justify-center gap-1 transition-all hover:scale-[1.02]"
                          style={{ background: 'var(--gradient-sidebar)' }}
                        >
                          <DollarSign size={13} /> Convert to Sale
                        </button>
                        <button
                          onClick={() => { setRejectTarget(t); setRejectReason(''); setRejectMsg(''); }}
                          className="px-3 py-2 rounded-lg font-semibold text-sm border flex items-center gap-1 transition-all hover:bg-error-50"
                          style={{ borderColor: 'var(--color-error-300)', color: 'var(--color-error-600)' }}
                        >
                          <XCircle size={13} /> Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* My Sales */}
          <Card className="p-6">
            <h3 className="text-xl font-bold mb-4 text-text flex items-center gap-2">
              <DollarSign size={20} /> My Sales
            </h3>
            {sLoading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
              </div>
            ) : sales.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-text-secondary mb-3">No sales yet.</p>
                <button
                  onClick={() => openSaleModal(null)}
                  className="py-2 px-4 rounded-lg text-sm font-semibold text-white"
                  style={{ background: 'var(--gradient-sidebar)' }}
                >
                  Create your first sale
                </button>
              </div>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                {sales.slice(0, 15).map(s => (
                  <div key={s.id} className="p-4 rounded-xl border transition-all duration-150 hover:shadow-md"
                    style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)' }}>
                    <div className="flex items-start justify-between mb-1">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <User size={13} style={{ color: 'var(--color-text-tertiary)' }} />
                          <p className="font-semibold text-text truncate">{s.customer_name || 'Sale'}</p>
                        </div>
                        {s.car_year && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <Car size={11} style={{ color: 'var(--color-text-tertiary)' }} />
                            <p className="text-xs text-text-secondary">
                              {s.car_year} {s.car_make} {s.car_model}
                            </p>
                          </div>
                        )}
                        {s.reference_no && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <Hash size={11} style={{ color: 'var(--color-text-tertiary)' }} />
                            <p className="text-xs font-mono text-text-tertiary">{s.reference_no}</p>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1 ml-2">
                        <Badge variant={saleBadge[s.status] || 'secondary'} size="sm">
                          {saleLabel[s.status] || s.status}
                        </Badge>
                        {s.monthly_payment && (
                          <span className="text-xs font-semibold text-success-600">
                            ${s.monthly_payment}/mo
                          </span>
                        )}
                      </div>
                    </div>
                    {s.status === 'open' && (
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={() => handleUpdateSale(s.id, 'sold')}
                          className="flex-1 py-1.5 px-3 rounded-lg text-xs font-bold text-white flex items-center justify-center gap-1 transition-all hover:scale-[1.02]"
                          style={{ backgroundColor: '#16a34a' }}
                        >
                          <CheckCircle size={12} /> Mark Sold
                        </button>
                        <button
                          onClick={() => handleUpdateSale(s.id, 'cancelled')}
                          className="flex-1 py-1.5 px-3 rounded-lg text-xs font-bold text-red-600 flex items-center justify-center gap-1 border transition-all hover:bg-red-50"
                          style={{ borderColor: '#ef4444' }}
                        >
                          <XCircle size={12} /> Cancel
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
        </div>}
      </main>

      {/* Sale Modal */}
      <SaleModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        user={user}
        transfer={activeTransfer}
        onSubmit={handleSaleSubmit}
        isLoading={saleLoading}
      />

      {/* Reject Transfer Modal */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-md mx-4 rounded-2xl p-6 shadow-2xl"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <h3 className="text-lg font-bold text-text mb-1">Reject Transfer</h3>
            <p className="text-sm text-text-secondary mb-4">
              Customer: <strong>
                {rejectTarget.form_data?.FirstName
                  ? `${rejectTarget.form_data.FirstName} ${rejectTarget.form_data.LastName || ''}`.trim()
                  : rejectTarget.form_data?.customer_name || 'Unknown'}
              </strong>
            </p>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Reason for rejection <span className="text-error-500">*</span>
            </label>
            <textarea
              value={rejectReason} onChange={e => setRejectReason(e.target.value)}
              placeholder="e.g. Customer already closed, wrong product, call dropped…"
              rows={3} className="input mb-3"
            />
            {rejectMsg && <p className="text-sm text-error-600 mb-3">{rejectMsg}</p>}
            <div className="flex gap-3">
              <button onClick={() => setRejectTarget(null)}
                className="flex-1 py-2 rounded-lg border font-semibold text-sm transition-colors"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                Cancel
              </button>
              <button onClick={handleRejectTransfer} disabled={rejecting}
                className="flex-1 py-2 rounded-lg font-semibold text-sm text-white transition-all disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-error-600)' }}>
                {rejecting ? 'Rejecting…' : 'Confirm Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CloserDashboard;
