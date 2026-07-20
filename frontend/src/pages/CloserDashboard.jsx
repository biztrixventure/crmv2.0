import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { transferPhone } from "../utils/phone";
import { useTheme } from "../contexts/ThemeContext";
import { useNavigate } from "react-router-dom";
import ThemedSelect from '../components/UI/Select';
import {
  TrendingUp, DollarSign, Target, Clock,
  CheckCircle, XCircle, Plus, Hash, User, Car, Phone, Search,
  Star, MessageSquare, Users, Shield, FileText, BarChart3,
} from "lucide-react";
import { Card, Badge, Alert, AutoResizeTextarea } from "../components/UI";
import DateRangePicker, { getPresetRange } from "../components/UI/DateRangePicker";
import { AppHeader } from "../components/Layout";
import { useDashboardStats } from "../hooks/useDashboardStats";
import { useTransfers } from "../hooks/useTransfers";
import { useSales } from "../hooks/useSales";
import { useCancellationReasons } from "../hooks/useCancellationReasons";
import { useNotifications } from "../hooks/useNotifications";
import SaleModal from "../components/Closer/SaleModal";
import CallbacksPage from "../components/Callbacks/CallbacksPage";
import SaleSearch from "../components/Sales/SaleSearch";
import CallbackNumbers from "../components/CallbackNumbers/CallbackNumbers";
import CrossRoleContent from "../components/Navigation/CrossRoleContent";
import client from "../api/client";

const statusBadge  = { pending: 'warning', assigned: 'info', completed: 'success', cancelled: 'error' };
const saleBadge    = { open: 'info', sold: 'success', cancelled: 'error', follow_up: 'warning', closed_won: 'success', closed_lost: 'error', pending_review: 'warning', needs_revision: 'error' };
const saleLabel    = { open: 'Open', sold: 'Sold', cancelled: 'Cancelled', follow_up: 'Callback', closed_won: 'Won', closed_lost: 'Lost', pending_review: 'In Review', needs_revision: 'Needs Revision' };
const RATINGS      = ['excellent', 'good', 'average', 'below_average', 'bad'];
const DISPOS       = ['sale', 'no_sale', 'callback', 'not_interested', 'hung_up', 'voicemail', 'other'];
const RATING_COLOR = { excellent: '#16a34a', good: '#2563eb', average: '#d97706', below_average: '#ea580c', bad: '#dc2626' };

const CloserDashboard = () => {
  const { user, logout, updateUser, hasPermission } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const { stats, loading: statsLoading, fetchStats } = useDashboardStats();
  const { transfers, loading: tLoading, fetchTransfers } = useTransfers(user?.company_id);
  const { sales, loading: sLoading, fetchSales, createSale, updateSale } = useSales(user?.company_id);
  const notifHook = useNotifications();
  const [activeTab, setActiveTab] = useState('sales');
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
    ...(hasPermission('view_fronter_stats') || hasPermission('view_closer_stats') || hasPermission('view_company_reports')
      ? [{ key: 'reports', label: 'Reports', icon: BarChart3}] : []),
  ];

  // Reject modal state
  const [rejectTarget, setRejectTarget]   = useState(null);
  const [rejectReason, setRejectReason]   = useState('');
  const [rejecting, setRejecting]         = useState(false);
  const [rejectMsg, setRejectMsg]         = useState('');

  // Rate call modal
  const [rateTarget, setRateTarget]       = useState(null);
  const [ratingVal, setRatingVal]         = useState('good');
  const [ratingNotes, setRatingNotes]     = useState('');
  const [ratingSaving, setRatingSaving]   = useState(false);
  const [ratingMsg, setRatingMsg]         = useState('');

  // Set dispo modal
  const [dispoTarget, setDispoTarget]     = useState(null);
  const [dispoVal, setDispoVal]           = useState('sale');
  const [dispoNotes, setDispoNotes]       = useState('');
  const [dispoSaving, setDispoSaving]     = useState(false);
  const [dispoMsg, setDispoMsg]           = useState('');

  // Global success banners
  const [reviewSuccess, setReviewSuccess] = useState('');

  // Modal state
  const [modalOpen, setModalOpen]       = useState(false);
  const [activeTransfer, setActiveTransfer] = useState(null); // transfer being converted
  const [saleLoading, setSaleLoading]   = useState(false);
  const [saleError, setSaleError]       = useState('');
  const [saleSuccess, setSaleSuccess]   = useState('');

  const [dateRange, setDateRange] = useState(() => getPresetRange('30d'));
  const { date_from, date_to }    = dateRange;

  useEffect(() => { fetchStats(); }, []);
  useEffect(() => { fetchTransfers({ date_from, date_to }); }, [fetchTransfers, date_from, date_to]);
  useEffect(() => { fetchSales({ date_from, date_to }); },    [fetchSales, date_from, date_to]);

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
      const res = await createSale(formData);
      setModalOpen(false);
      // Item 4 — server-side advisory: even if the closer outran the banner,
      // the response says the customer holds an active policy.
      const advisory = res?.advisory?.active_policy
        ? ' ⚠ Note: this customer holds an active policy — check the Resell flow if this duplicates coverage.'
        : '';
      setSaleSuccess(`Sale created! Ref: ${formData.reference_no || 'Generated'}${advisory}`);
      fetchStats();
      fetchTransfers({ date_from, date_to });
      fetchSales({ date_from, date_to });
      if (formData.status === 'follow_up') setActiveTab('callbacks');
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

  // FIX 3 — cancelling now requires a canonical reason (same catalog compliance
  // uses). The Cancel button opens this mini-modal instead of firing directly.
  const { activeReasons } = useCancellationReasons();
  const [cancelTarget, setCancelTarget] = useState(null);   // the sale being cancelled
  const [cancelKey, setCancelKey]       = useState('');
  const [cancelNote, setCancelNote]     = useState('');
  const [cancelBusy, setCancelBusy]     = useState(false);
  const [cancelErr, setCancelErr]       = useState('');
  const submitCancel = async () => {
    if (!cancelKey) { setCancelErr('Pick a cancellation reason.'); return; }
    setCancelBusy(true); setCancelErr('');
    try {
      await updateSale(cancelTarget.id, {
        status: 'cancelled',
        cancellation_reason_key: cancelKey,
        cancellation_reason_note: cancelNote.trim() || undefined,
      });
      fetchStats();
      setCancelTarget(null); setCancelKey(''); setCancelNote('');
    } catch (err) {
      setCancelErr(err.response?.data?.error || err.message || 'Failed to cancel');
    } finally { setCancelBusy(false); }
  };

  const handleSubmitForReview = async (saleId) => {
    try {
      await client.post(`sales/${saleId}/submit-review`);
      setSaleSuccess('Sale submitted for compliance review!');
      fetchSales({ date_from, date_to });
      fetchStats();
      setTimeout(() => setSaleSuccess(''), 5000);
    } catch (err) {
      setSaleError(err.response?.data?.error || 'Failed to submit for review');
    }
  };

  const handleRateCall = async () => {
    setRatingSaving(true);
    setRatingMsg('');
    try {
      await client.post(`reviews/transfer/${rateTarget.id}/review`, { rating: ratingVal, notes: ratingNotes || undefined });
      setRateTarget(null);
      setReviewSuccess('Rating saved!');
      setTimeout(() => setReviewSuccess(''), 4000);
    } catch (err) {
      setRatingMsg(err.response?.data?.error || 'Failed to save rating');
    } finally {
      setRatingSaving(false);
    }
  };

  const handleSetDispo = async () => {
    setDispoSaving(true);
    setDispoMsg('');
    try {
      await client.post(`reviews/transfer/${dispoTarget.id}/dispo`, { disposition: dispoVal, notes: dispoNotes || undefined });
      setDispoTarget(null);
      setReviewSuccess('Disposition saved!');
      setTimeout(() => setReviewSuccess(''), 4000);
      if (dispoVal === 'callback') setActiveTab('callbacks');
    } catch (err) {
      setDispoMsg(err.response?.data?.error || 'Failed to save disposition');
    } finally {
      setDispoSaving(false);
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
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" style={{ display: activeNav !== 'dashboard' ? 'none' : undefined }}>

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
          {hasPermission('create_sale') && (
          <button
            onClick={() => openSaleModal(null)}
            className="flex items-center gap-2 py-3 px-6 rounded-xl font-bold text-white transition-all duration-200 hover:scale-105"
            style={{ background: 'var(--gradient-sidebar)', boxShadow: 'var(--shadow-md)' }}
          >
            <Plus size={20} />
            New Sale
          </button>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
          <div className="flex gap-1 p-1 rounded-xl w-fit"
            style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            {[
              { key: 'sales',           label: 'My Sales',        icon: DollarSign },
              ...(hasPermission('view_callbacks')           ? [{ key: 'callbacks',       label: 'Callbacks',       icon: Phone  }] : []),
              ...(hasPermission('manage_callback_numbers')  ? [{ key: 'tracked_numbers', label: 'Tracked Numbers', icon: Hash   }] : []),
              ...(hasPermission('search_sales')             ? [{ key: 'search',          label: 'Search Sales',    icon: Search }] : []),
            ].map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150"
                style={{
                  background: activeTab === tab.key ? 'var(--gradient-sidebar)' : 'transparent',
                  color: activeTab === tab.key ? 'white' : 'var(--color-text-secondary)',
                  boxShadow: activeTab === tab.key ? 'var(--shadow-sm)' : 'none',
                }}>
                <tab.icon size={15} />
                {tab.label}
              </button>
            ))}
          </div>
          <DateRangePicker onChange={setDateRange} defaultPreset="30d" />
        </div>

        {activeTab === 'callbacks'       && <CallbacksPage user={user} />}
        {activeTab === 'tracked_numbers' && <CallbackNumbers user={user} />}
        {activeTab === 'search'          && <SaleSearch />}
        {activeTab === 'sales' && <div>

        {/* Alerts */}
        {saleSuccess && (
          <Alert type="success" title="Sale Created!" message={saleSuccess}
            dismissible onDismiss={() => setSaleSuccess('')} />
        )}
        {reviewSuccess && (
          <Alert type="success" title="Saved!" message={reviewSuccess}
            dismissible onDismiss={() => setReviewSuccess('')} />
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
                          {transferPhone(t) || t.form_data?.customer_email || ''}
                        </p>
                      </div>
                      <Badge variant={statusBadge[t.status] || 'secondary'} size="sm">{t.status}</Badge>
                    </div>
                    {t.status === 'assigned' && (
                      <div className="flex gap-2 mt-3">
                        {hasPermission('create_sale') && (
                        <button
                          onClick={() => openSaleModal(t)}
                          className="flex-1 py-2 px-3 rounded-lg font-semibold text-sm text-white flex items-center justify-center gap-1 transition-all hover:scale-[1.02]"
                          style={{ background: 'var(--gradient-sidebar)' }}
                        >
                          <DollarSign size={13} /> Convert to Sale
                        </button>
                        )}
                        {hasPermission('reject_transfer') && (
                        <button
                          onClick={() => { setRejectTarget(t); setRejectReason(''); setRejectMsg(''); }}
                          className="px-3 py-2 rounded-lg font-semibold text-sm border flex items-center gap-1 transition-all hover:bg-error-50"
                          style={{ borderColor: 'var(--color-error-300)', color: 'var(--color-error-600)' }}
                        >
                          <XCircle size={13} /> Reject
                        </button>
                        )}
                      </div>
                    )}
                    <div className="flex gap-2 mt-2">
                      {hasPermission('submit_call_review') && (
                      <button
                        onClick={() => { setRateTarget(t); setRatingVal('good'); setRatingNotes(''); setRatingMsg(''); }}
                        className="flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold border flex items-center justify-center gap-1 transition-all hover:bg-primary-50"
                        style={{ borderColor: 'var(--color-primary-300)', color: 'var(--color-primary-600)' }}
                      >
                        <Star size={11} /> Rate Call
                      </button>
                      )}
                      {hasPermission('submit_call_dispo') && (
                      <button
                        onClick={() => { setDispoTarget(t); setDispoVal('sale'); setDispoNotes(''); setDispoMsg(''); }}
                        className="flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold border flex items-center justify-center gap-1 transition-all hover:bg-info-50"
                        style={{ borderColor: 'var(--color-info-300)', color: 'var(--color-info-600)' }}
                      >
                        <MessageSquare size={11} /> Set Dispo
                      </button>
                      )}
                    </div>
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
                {hasPermission('create_sale') && (
                <button
                  onClick={() => openSaleModal(null)}
                  className="py-2 px-4 rounded-lg text-sm font-semibold text-white"
                  style={{ background: 'var(--gradient-sidebar)' }}
                >
                  Create your first sale
                </button>
                )}
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
                        {s.group_count > 1 && (
                          <span title="Multi-vehicle bundle — this is one car of one deal"
                            className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded whitespace-nowrap"
                            style={{ backgroundColor: '#d1fae5', color: '#065f46' }}>
                            {s.group_count}-car deal
                          </span>
                        )}
                        {s.monthly_payment && hasPermission('view_financial_data') && (
                          <span className="text-xs font-semibold text-success-600">
                            ${s.monthly_payment}/mo
                          </span>
                        )}
                      </div>
                    </div>
                    {(s.status === 'open' || s.status === 'needs_revision') && hasPermission('update_sale') && (
                      <div className="flex flex-col gap-2 mt-3">
                        {s.status === 'needs_revision' && s.compliance_note && (
                          <div className="text-xs px-2 py-1.5 rounded-lg"
                            style={{ backgroundColor: 'var(--color-warning-50)', color: 'var(--color-warning-700)', border: '1px solid var(--color-warning-200)' }}>
                            <strong>Compliance note:</strong> {s.compliance_note}
                          </div>
                        )}
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleSubmitForReview(s.id)}
                            className="flex-1 py-1.5 px-3 rounded-lg text-xs font-bold text-white flex items-center justify-center gap-1 transition-all hover:scale-[1.02]"
                            style={{ background: 'var(--gradient-sidebar)' }}
                          >
                            <Shield size={12} /> {s.status === 'needs_revision' ? 'Resubmit' : 'Submit for Review'}
                          </button>
                          {s.status === 'open' && (
                            <button
                              onClick={() => { setCancelTarget(s); setCancelKey(''); setCancelNote(''); setCancelErr(''); }}
                              className="px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 border transition-all hover:bg-error-50"
                              style={{ borderColor: 'var(--color-error-300)', color: 'var(--color-error-600)' }}
                            >
                              <XCircle size={12} /> Cancel
                            </button>
                          )}
                        </div>
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

      {/* FIX 3 — cancel-with-reason modal (same canonical catalog compliance uses) */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={() => !cancelBusy && setCancelTarget(null)}>
          <div className="w-full max-w-sm rounded-2xl border p-5" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
            onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-base mb-1" style={{ color: 'var(--color-text)' }}>Cancel this sale?</h3>
            <p className="text-xs mb-4" style={{ color: 'var(--color-text-secondary)' }}>
              {cancelTarget.customer_name || 'Sale'}{cancelTarget.reference_no ? ` · #${cancelTarget.reference_no}` : ''} — a reason is required and is recorded in the audit history.
            </p>
            <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>Reason <span style={{ color: '#ef4444' }}>*</span></label>
            <ThemedSelect value={cancelKey} onChange={e => setCancelKey(e.target.value)} className="input text-sm w-full mb-3">
              <option value="">— pick a reason —</option>
              {activeReasons.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
            </ThemedSelect>
            <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>Note (optional)</label>
            <AutoResizeTextarea value={cancelNote} onChange={e => setCancelNote(e.target.value)} rows={2}
              className="input text-sm w-full mb-3" placeholder="Anything compliance should know…" />
            {cancelErr && <p className="text-xs mb-2" style={{ color: '#dc2626' }}>{cancelErr}</p>}
            <div className="flex gap-2">
              <button onClick={() => setCancelTarget(null)} disabled={cancelBusy}
                className="px-3 py-2 rounded-xl text-sm font-semibold" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text)' }}>Keep sale</button>
              <button onClick={submitCancel} disabled={cancelBusy || !cancelKey}
                className="flex-1 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#ef4444,#dc2626)' }}>{cancelBusy ? 'Cancelling…' : 'Cancel sale'}</button>
            </div>
          </div>
        </div>
      )}

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
        <div className="fixed inset-0 z-50 overflow-y-auto"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="flex min-h-full items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl p-6 shadow-2xl"
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
            <AutoResizeTextarea
              value={rejectReason} onChange={e => setRejectReason(e.target.value)}
              placeholder="e.g. Customer already closed, wrong product, call dropped…"
              minRows={3} className="input mb-3"
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
        </div>
      )}

      {/* Rate Call Modal */}
      {rateTarget && (
        <div className="fixed inset-0 z-50 overflow-y-auto"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="flex min-h-full items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl p-6 shadow-2xl"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <h3 className="text-lg font-bold text-text mb-1 flex items-center gap-2">
              <Star size={18} style={{ color: '#f59e0b' }} /> Rate This Call
            </h3>
            <p className="text-sm text-text-secondary mb-4">
              Customer: <strong>
                {rateTarget.form_data?.FirstName
                  ? `${rateTarget.form_data.FirstName} ${rateTarget.form_data.LastName || ''}`.trim()
                  : rateTarget.form_data?.customer_name || 'Unknown'}
              </strong>
            </p>
            <label className="block text-sm font-medium text-text-secondary mb-2">Rating</label>
            <div className="flex gap-2 mb-4 flex-wrap">
              {RATINGS.map(r => (
                <button key={r} onClick={() => setRatingVal(r)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition-all capitalize"
                  style={{
                    borderColor: ratingVal === r ? RATING_COLOR[r] : 'var(--color-border)',
                    backgroundColor: ratingVal === r ? `${RATING_COLOR[r]}15` : 'transparent',
                    color: ratingVal === r ? RATING_COLOR[r] : 'var(--color-text-secondary)',
                  }}>
                  {r.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Notes (optional)</label>
            <AutoResizeTextarea value={ratingNotes} onChange={e => setRatingNotes(e.target.value)}
              placeholder="Any notes about this call…" minRows={2} maxRows={6} className="input mb-3" />
            {ratingMsg && <p className="text-sm text-error-600 mb-3">{ratingMsg}</p>}
            <div className="flex gap-3">
              <button onClick={() => setRateTarget(null)}
                className="flex-1 py-2 rounded-lg border font-semibold text-sm"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                Cancel
              </button>
              <button onClick={handleRateCall} disabled={ratingSaving}
                className="flex-1 py-2 rounded-lg font-semibold text-sm text-white disabled:opacity-50"
                style={{ background: 'var(--gradient-sidebar)' }}>
                {ratingSaving ? 'Saving…' : 'Save Rating'}
              </button>
            </div>
          </div>
          </div>
        </div>
      )}

      {/* Set Dispo Modal */}
      {dispoTarget && (
        <div className="fixed inset-0 z-50 overflow-y-auto"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="flex min-h-full items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl p-6 shadow-2xl"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <h3 className="text-lg font-bold text-text mb-1 flex items-center gap-2">
              <MessageSquare size={18} style={{ color: 'var(--color-primary-600)' }} /> Set Disposition
            </h3>
            <p className="text-sm text-text-secondary mb-4">
              Customer: <strong>
                {dispoTarget.form_data?.FirstName
                  ? `${dispoTarget.form_data.FirstName} ${dispoTarget.form_data.LastName || ''}`.trim()
                  : dispoTarget.form_data?.customer_name || 'Unknown'}
              </strong>
            </p>
            <label className="block text-sm font-medium text-text-secondary mb-1">Disposition</label>
            <ThemedSelect value={dispoVal} onChange={e => setDispoVal(e.target.value)} className="input mb-3">
              {DISPOS.map(d => (
                <option key={d} value={d}>{d.replace(/_/g, ' ')}</option>
              ))}
            </ThemedSelect>
            <label className="block text-sm font-medium text-text-secondary mb-1">Notes (optional)</label>
            <AutoResizeTextarea value={dispoNotes} onChange={e => setDispoNotes(e.target.value)}
              placeholder="Any notes about this disposition…" minRows={2} maxRows={6} className="input mb-3" />
            {dispoMsg && <p className="text-sm text-error-600 mb-3">{dispoMsg}</p>}
            <div className="flex gap-3">
              <button onClick={() => setDispoTarget(null)}
                className="flex-1 py-2 rounded-lg border font-semibold text-sm"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                Cancel
              </button>
              <button onClick={handleSetDispo} disabled={dispoSaving}
                className="flex-1 py-2 rounded-lg font-semibold text-sm text-white disabled:opacity-50"
                style={{ background: 'var(--gradient-sidebar)' }}>
                {dispoSaving ? 'Saving…' : 'Save Dispo'}
              </button>
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CloserDashboard;
