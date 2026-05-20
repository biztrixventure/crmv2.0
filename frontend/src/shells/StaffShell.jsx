import { useEffect, useState, useCallback, useRef } from "react";
import { toastError } from "../utils/toast";
import { useAuth } from "../contexts/AuthContext";
import { useVersionCheck } from "../hooks/useVersionCheck";
import UpdateBanner from "../components/UI/UpdateBanner";
import { useTheme } from "../contexts/ThemeContext";
import { useFeatureFlags } from "../contexts/FeatureFlagsContext";
import { useNavigate } from "react-router-dom";
import {
  DollarSign, Send, Phone, Hash, Search, Target, Clock,
  CheckCircle, XCircle, Plus, User, Car, Star, MessageSquare,
  Users, Shield, FileText, BarChart3, AlertTriangle, RefreshCw, CalendarPlus, Pencil, Trash2,
  ChevronLeft, ChevronRight, HelpCircle,
} from "lucide-react";

const PAGE_SIZE = 25;

const Pagination = ({ page, total, pageSize, onChange }) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between pt-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
      <span className="text-xs text-text-secondary">
        {Math.min((page - 1) * pageSize + 1, total)}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="flex items-center gap-2">
        <button onClick={() => onChange(page - 1)} disabled={page <= 1}
          className="p-1.5 rounded-lg border disabled:opacity-40 hover:bg-bg-secondary transition-colors"
          style={{ borderColor: 'var(--color-border)' }}>
          <ChevronLeft size={14} />
        </button>
        <span className="text-xs font-semibold text-text">{page} / {totalPages}</span>
        <button onClick={() => onChange(page + 1)} disabled={page >= totalPages}
          className="p-1.5 rounded-lg border disabled:opacity-40 hover:bg-bg-secondary transition-colors"
          style={{ borderColor: 'var(--color-border)' }}>
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
};
import { Card, Badge, Alert } from "../components/UI";
import DateRangePicker, { getPresetRange } from "../components/UI/DateRangePicker";
import { AppHeader } from "../components/Layout";
import { useDashboardStats } from "../hooks/useDashboardStats";
import { useTransfers } from "../hooks/useTransfers";
import { useSales } from "../hooks/useSales";
import { useNotifications } from "../hooks/useNotifications";
import { useFormFields } from "../hooks/useFormFields";
import { useSaleConfigs } from "../hooks/useSaleConfigs";
import PhoneSearch from "../components/Closer/PhoneSearch";
import { getTransferDisplayStatus } from "../utils/transferStatus";
import { fmtDateET } from "../utils/timezone";
import SaleModal from "../components/Closer/SaleModal";
import CallbacksPage from "../components/Callbacks/CallbacksPage";
import CallbackNumbers from "../components/CallbackNumbers/CallbackNumbers";
import CallbacksOverview from "../components/Callbacks/CallbacksOverview";
import AssignedNumbersList from "../components/Numbers/AssignedNumbersList";
import SaleSearch from "../components/Sales/SaleSearch";
import FAQPanel from "../components/FAQ/FAQPanel";
import CrossRoleContent from "../components/Navigation/CrossRoleContent";
import TransferDetailDrawer from "../components/Shared/TransferDetailDrawer";
import SaleDetailDrawer from "../components/Shared/SaleDetailDrawer";
import client from "../api/client";
import DevCredit from "../components/DevCredit";

const TRANSFER_BADGE = { pending: 'warning', assigned: 'info', completed: 'success', cancelled: 'error', rejected: 'error' };
const SALE_BADGE = {
  open: 'info', sold: 'success', cancelled: 'error', follow_up: 'warning',
  closed_won: 'success', closed_lost: 'error',
  pending_review: 'warning', needs_revision: 'error',
};
const SALE_LABEL = {
  open: 'Sale Open', sold: 'Sold', cancelled: 'Cancelled', follow_up: 'Follow Up',
  closed_won: 'Approved', closed_lost: 'Lost',
  pending_review: 'In Review', needs_revision: 'Needs Revision',
};
const RATINGS = ['excellent', 'good', 'average', 'below_average', 'bad'];
const DISPOS  = ['sale', 'no_sale', 'callback', 'not_interested', 'hung_up', 'voicemail', 'other'];
const RATING_COLOR = { excellent: '#16a34a', good: '#2563eb', average: '#d97706', below_average: '#ea580c', bad: '#dc2626' };

const StaffShell = () => {
  const { user, logout, updateUser, hasPermission } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { isEnabled } = useFeatureFlags();
  const navigate = useNavigate();
  const updateAvailable = useVersionCheck();

  const isFronter  = user?.role === 'fronter' || (!hasPermission('create_sale') && hasPermission('create_transfer'));
  const isCloser   = user?.role === 'closer'  || hasPermission('create_sale');

  const defaultTab = isCloser ? 'sales' : isFronter ? 'transfers' : 'callbacks';
  const [activeTab, setActiveTab] = useState(defaultTab);
  const [activeNav, setActiveNav] = useState('dashboard');

  const { stats, loading: statsLoading, fetchStats } = useDashboardStats();
  const { transfers, loading: tLoading, fetchTransfers, createTransfer, deleteTransfer } = useTransfers(user?.company_id);
  const { sales, loading: sLoading, fetchSales, createSale, deleteSale } = useSales(user?.company_id);
  const { fields, fetchFields } = useFormFields();
  const { clients: saleClients, plans: salePlans, fetchConfigs } = useSaleConfigs(user?.company_id);
  const notifHook = useNotifications();

  const [dateRange, setDateRange] = useState(() => getPresetRange('30d'));
  const { date_from, date_to } = dateRange;

  // Cross-role nav
  const crossNavItems = [
    ...(hasPermission('view_company_members') || hasPermission('create_user') || hasPermission('edit_user') || hasPermission('manage_company_users')
      ? [{ key: 'team',    label: 'Team',    icon: Users    }] : []),
    ...(hasPermission('manage_roles') || hasPermission('manage_company_roles')
      ? [{ key: 'roles',   label: 'Roles',   icon: Shield   }] : []),
    ...(hasPermission('manage_forms')
      ? [{ key: 'forms',   label: 'Forms',   icon: FileText }] : []),
    ...(hasPermission('view_call_reviews') || hasPermission('view_all_call_reviews')
      ? [{ key: 'reviews', label: 'Reviews', icon: Star     }] : []),
    ...(hasPermission('view_fronter_stats') || hasPermission('view_closer_stats') || hasPermission('view_company_reports') || hasPermission('view_reports')
      ? [{ key: 'reports', label: 'Reports', icon: BarChart3}] : []),
  ];

  // Sale modal
  const [modalOpen, setModalOpen]               = useState(false);
  const [activeTransfer, setActiveTransfer]     = useState(null);
  const [saleLoading, setSaleLoading]           = useState(false);
  const [saleError, setSaleError]               = useState('');
  const [saleSuccess, setSaleSuccess]           = useState('');
  const [phoneSearchRefresh, setPhoneSearchRefresh] = useState(0);

  // Reject modal
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting]       = useState(false);
  const [rejectMsg, setRejectMsg]       = useState('');

  // Rate call modal
  const [rateTarget, setRateTarget]   = useState(null);
  const [ratingVal, setRatingVal]     = useState('good');
  const [ratingNotes, setRatingNotes] = useState('');
  const [ratingSaving, setRatingSaving] = useState(false);
  const [ratingMsg, setRatingMsg]     = useState('');

  // Dispo modal
  const [dispoTarget, setDispoTarget] = useState(null);
  const [dispoVal, setDispoVal]       = useState('sale');
  const [dispoNotes, setDispoNotes]   = useState('');
  const [dispoSaving, setDispoSaving] = useState(false);
  const [dispoMsg, setDispoMsg]       = useState('');

  const [reviewSuccess, setReviewSuccess] = useState('');

  // Detail drawers
  const [detailTransfer, setDetailTransfer] = useState(null);
  const [detailSale, setDetailSale]         = useState(null);

  // ── Team Transfers tab (rich server-side view) ───────────────────────────
  const [xferTabRows,    setXferTabRows]    = useState([]);
  const [xferTabTotal,   setXferTabTotal]   = useState(0);
  const [xferTabLoading, setXferTabLoading] = useState(false);
  const [xferStatus,     setXferStatus]     = useState('');
  const [xferAgent,      setXferAgent]      = useState('');
  const [xferPage,       setXferPage]       = useState(1);

  // ── Team Sales tab (rich server-side view) ───────────────────────────────
  const [salesTabRows,    setSalesTabRows]    = useState([]);
  const [salesTabTotal,   setSalesTabTotal]   = useState(0);
  const [salesTabLoading, setSalesTabLoading] = useState(false);
  const [salesStatus,     setSalesStatus]     = useState('');
  const [salesAgent,      setSalesAgent]      = useState('');
  const [salesPage,       setSalesPage]       = useState(1);

  // ── Company agents (for agent selector dropdowns) ────────────────────────
  const [companyAgents, setCompanyAgents] = useState([]);

  // Schedule callback from sale
  const [callbackSale, setCallbackSale]     = useState(null);
  const [callbackAt, setCallbackAt]         = useState('');
  const [callbackNotes, setCallbackNotes]   = useState('');
  const [callbackSaving, setCallbackSaving] = useState(false);
  const [callbackMsg, setCallbackMsg]       = useState('');

  // Submit for review state
  const [submitting, setSubmitting]     = useState(null); // sale id being submitted
  const [submitMsg, setSubmitMsg]       = useState('');

  // Edit sale state
  const [editSale, setEditSale]                 = useState(null);
  const [editSaleLoading, setEditSaleLoading]   = useState(false);
  const [editSaleError, setEditSaleError]       = useState('');

  // Create transfer form (fronter)
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData]             = useState({});
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [transferError, setTransferError]           = useState('');
  const [zipFronterLoading, setZipFronterLoading]   = useState(false);
  const [zipFronterInfo,    setZipFronterInfo]       = useState(null);
  const zipFronterTimer = useRef(null);

  // Local phone filter for fronter's My Leads list
  const [leadSearch, setLeadSearch] = useState('');

  useEffect(() => {
    fetchStats();
    if (isFronter) { fetchFields(); fetchConfigs(); }
  }, []);
  useEffect(() => { fetchTransfers({ date_from, date_to }); }, [fetchTransfers, date_from, date_to]);
  useEffect(() => { if (isCloser) fetchSales({ date_from, date_to }); }, [fetchSales, date_from, date_to, isCloser]);

  const fetchXferTab = useCallback(async () => {
    if (!user?.company_id) return;
    setXferTabLoading(true);
    try {
      const params = { company_id: user.company_id, page: xferPage, limit: PAGE_SIZE, date_from, date_to };
      if (xferStatus) params.status  = xferStatus;
      if (xferAgent)  params.user_id = xferAgent;
      const res = await client.get('transfers', { params });
      setXferTabRows(res.data.transfers || []);
      setXferTabTotal(res.data.total    || 0);
    } catch {} finally { setXferTabLoading(false); }
  }, [user?.company_id, xferPage, xferStatus, xferAgent, date_from, date_to]);

  const fetchSalesTab = useCallback(async () => {
    if (!user?.company_id) return;
    setSalesTabLoading(true);
    try {
      const params = { company_id: user.company_id, page: salesPage, limit: PAGE_SIZE, date_from, date_to };
      if (salesStatus) params.status  = salesStatus;
      if (salesAgent)  params.user_id = salesAgent;
      const res = await client.get('sales', { params });
      setSalesTabRows(res.data.sales || []);
      setSalesTabTotal(res.data.total || 0);
    } catch {} finally { setSalesTabLoading(false); }
  }, [user?.company_id, salesPage, salesStatus, salesAgent, date_from, date_to]);

  // Team tab data — only fetch when the tab is active
  useEffect(() => { if (activeTab === 'team_transfers') fetchXferTab();  }, [activeTab, fetchXferTab]);
  useEffect(() => { if (activeTab === 'team_sales')     fetchSalesTab(); }, [activeTab, fetchSalesTab]);

  // Company agents for filter dropdowns
  useEffect(() => {
    if (!user?.company_id) return;
    client.get('users', { params: { company_id: user.company_id } })
      .then(r => setCompanyAgents(r.data.users || [])).catch(() => {});
  }, [user?.company_id]);

  const handleLogout = () => { logout(); navigate('/login'); };

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
      // Auto-submit every created sale (one per car) for compliance review
      const created = res?.sales?.length ? res.sales : (res?.sale ? [res.sale] : []);
      await Promise.all(created.filter(s => s?.id).map(s => client.post(`sales/${s.id}/submit-review`)));
      setModalOpen(false);
      setSaleSuccess(created.length > 1 ? `${created.length} sales submitted to compliance!` : 'Sale submitted to compliance!');
      setPhoneSearchRefresh(prev => prev + 1);
      fetchStats();
      fetchTransfers({ date_from, date_to });
      fetchSales({ date_from, date_to });
      setTimeout(() => setSaleSuccess(''), 5000);
    } catch (err) {
      setSaleError(err.response?.data?.errors?.map(e => e.msg).join(', ') || err.response?.data?.error || 'Failed to create sale');
    } finally {
      setSaleLoading(false);
    }
  };

  const handleSaleEdit = async (formData) => {
    setEditSaleLoading(true);
    setEditSaleError('');
    try {
      await client.put(`sales/${editSale.id}`, formData);
      setEditSale(null);
      setSaleSuccess('Sale updated!');
      fetchSales({ date_from, date_to });
      setTimeout(() => setSaleSuccess(''), 5000);
    } catch (err) {
      setEditSaleError(err.response?.data?.errors?.map(e => e.msg).join(', ') || err.response?.data?.error || 'Failed to update sale');
    } finally {
      setEditSaleLoading(false);
    }
  };

  const handleSubmitForReview = async (saleId) => {
    setSubmitting(saleId);
    setSubmitMsg('');
    try {
      await client.post(`sales/${saleId}/submit-review`);
      fetchSales({ date_from, date_to });
      setSubmitMsg('');
    } catch (err) {
      setSubmitMsg(err.response?.data?.error || 'Failed to submit');
    } finally {
      setSubmitting(null);
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
      setRejectMsg(err.response?.data?.error || 'Failed to reject');
    } finally {
      setRejecting(false);
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
    } catch (err) {
      setDispoMsg(err.response?.data?.error || 'Failed to save disposition');
    } finally {
      setDispoSaving(false);
    }
  };

  const handleScheduleCallback = async () => {
    if (!callbackAt) { setCallbackMsg('Select a date and time.'); return; }
    setCallbackSaving(true);
    setCallbackMsg('');
    try {
      await client.post('callbacks', {
        customer_name:  callbackSale.customer_name || 'Unknown',
        customer_phone: callbackSale.customer_phone || '',
        callback_at:    new Date(callbackAt).toISOString(),
        notes:          callbackNotes || undefined,
        source:         'sale',
        source_id:      callbackSale.id,
        company_id:     user?.company_id,
      });
      setCallbackSale(null);
      setCallbackAt('');
      setCallbackNotes('');
      setReviewSuccess('Callback scheduled!');
      setTimeout(() => setReviewSuccess(''), 4000);
    } catch (err) {
      setCallbackMsg(err.response?.data?.error || 'Failed to schedule callback');
    } finally {
      setCallbackSaving(false);
    }
  };

  const handleSubmitTransfer = async (e) => {
    e.preventDefault();
    setTransferError('');
    setTransferSubmitting(true);
    try {
      await createTransfer({ ...formData });
      setShowCreateForm(false);
      setFormData({});
      setZipFronterInfo(null);
      fetchStats();
      fetchTransfers({ date_from, date_to });
    } catch (err) {
      setTransferError(err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Failed to submit');
    } finally {
      setTransferSubmitting(false);
    }
  };

  const handleFronterZipChange = (fieldName, val, allFields) => {
    setFormData(prev => ({ ...prev, [fieldName]: val }));
    clearTimeout(zipFronterTimer.current);
    if (val.replace(/\D/g, '').length < 5) { setZipFronterInfo(null); return; }
    zipFronterTimer.current = setTimeout(async () => {
      setZipFronterLoading(true);
      try {
        const res = await client.get(`zipcode/${val.trim()}`);
        setZipFronterInfo(res.data);
        setFormData(prev => {
          const next = { ...prev };
          const cityF  = allFields.find(f => ['City','city','customer_city'].includes(f.name));
          const stateF = allFields.find(f => ['State','state','customer_state'].includes(f.name));
          if (cityF)  next[cityF.name]  = res.data.city;
          if (stateF) next[stateF.name] = res.data.state;
          return next;
        });
      } catch { setZipFronterInfo(null); }
      finally { setZipFronterLoading(false); }
    }, 500);
  };

  const TABS = [
    ...((isCloser || hasPermission('view_own_sales')) && isEnabled('sales')
      ? [{ key: 'sales',          label: 'My Sales',        icon: DollarSign }] : []),
    ...((isFronter || hasPermission('view_own_transfers')) && isEnabled('transfers')
      ? [{ key: 'transfers',      label: 'My Transfers',    icon: Send       }] : []),
    ...((hasPermission('view_team_transfers') || hasPermission('view_all_company_transfers')) && isEnabled('transfers')
      ? [{ key: 'team_transfers', label: 'Team Transfers',  icon: Send       }] : []),
    ...((hasPermission('view_team_sales') || hasPermission('view_all_company_sales')) && isEnabled('sales')
      ? [{ key: 'team_sales',     label: 'Team Sales',      icon: DollarSign }] : []),
    ...(hasPermission('view_callbacks') && isEnabled('callbacks')
      ? [{ key: 'callbacks',      label: 'Callbacks',       icon: Phone      }] : []),
    ...(hasPermission('view_team_callbacks') && isEnabled('callbacks')
      ? [{ key: 'team_callbacks', label: 'Team Callbacks',  icon: Phone      }] : []),
    ...((hasPermission('manage_callback_numbers') || hasPermission('view_team_callback_numbers') || hasPermission('reassign_callback_numbers')) && isEnabled('callback_numbers')
      ? [{ key: 'tracked_numbers', label: 'Tracked Numbers', icon: Hash      }] : []),
    ...(isFronter && isEnabled('number_assignment')
      ? [{ key: 'numbers',        label: 'My Numbers',      icon: Hash       }] : []),
    ...(hasPermission('search_sales') && isEnabled('search_sales')
      ? [{ key: 'search',         label: 'Search Sales',    icon: Search     }] : []),
    { key: 'faqs',              label: 'FAQs',            icon: HelpCircle },
  ];

  return (
    <div className="min-h-screen bg-bg">
      {updateAvailable && <UpdateBanner />}
      <AppHeader
        title={user?.role_name || 'Dashboard'}
        logo={<div className="w-10 h-10 bg-gradient-sidebar rounded-lg flex items-center justify-center">
          {isCloser ? <DollarSign className="text-white" size={22} /> : <Send className="text-white" size={22} />}
        </div>}
        companyLogoUrl={user?.company_logo_url}
        theme={theme} onThemeToggle={toggleTheme}
        userEmail={user?.email} userRole={user?.role_name || user?.role}
        onLogout={handleLogout} user={user} onUpdateUser={updateUser}
        notifications={notifHook.notifications} unreadCount={notifHook.unreadCount}
        onMarkRead={notifHook.markRead} onMarkAllRead={notifHook.markAllRead}
        onDeleteNotification={notifHook.deleteNotification} onClearNotifications={notifHook.clearAll}
        navItems={crossNavItems} activeNav={activeNav} onNavChange={setActiveNav}
      />

      {activeNav !== 'dashboard' && <CrossRoleContent section={activeNav} user={user} />}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8"
        style={{ display: activeNav !== 'dashboard' ? 'none' : undefined }}>

        {/* Header row */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8 animate-fade-in">
          <div>
            <h2 className="text-3xl font-bold mb-1 text-text">
              Welcome back, {user?.first_name || user?.email}!
            </h2>
            <p className="text-text-secondary">
              <strong>{user?.role_name || user?.role}</strong> at <strong>{user?.company_name}</strong>
            </p>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
          <div className="flex gap-1 p-1 rounded-xl w-fit"
            style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            {TABS.map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150"
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

        {/* ── NON-SALES TABS ── */}
        {activeTab === 'callbacks'       && <CallbacksPage user={user} />}
        {activeTab === 'team_callbacks'  && <CallbacksOverview user={user} companyId={user?.company_id} />}
        {activeTab === 'tracked_numbers' && <CallbackNumbers user={user} />}
        {activeTab === 'numbers'         && <AssignedNumbersList user={user} />}
        {activeTab === 'search'          && <SaleSearch />}
        {activeTab === 'faqs'            && <FAQPanel />}

        {/* ── TEAM TRANSFERS TAB ── */}
        {activeTab === 'team_transfers' && (
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h3 className="text-xl font-bold text-text flex items-center gap-2"><Send size={20} /> Team Transfers</h3>
              <span className="text-sm text-text-secondary">{xferTabTotal} total</span>
            </div>

            {/* Filter bar */}
            <div className="flex flex-wrap gap-2 mb-4">
              <div className="flex gap-1 p-1 rounded-xl overflow-x-auto"
                style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                {[
                  { k: '',          l: 'All'       },
                  { k: 'pending',   l: 'Pending'   },
                  { k: 'assigned',  l: 'Assigned'  },
                  { k: 'completed', l: 'Completed' },
                  { k: 'rejected',  l: 'Rejected'  },
                  { k: 'cancelled', l: 'Cancelled' },
                ].map(({ k, l }) => (
                  <button key={k} onClick={() => { setXferStatus(k); setXferPage(1); }}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap flex-shrink-0"
                    style={{
                      background: xferStatus === k ? 'var(--gradient-sidebar)' : 'transparent',
                      color:      xferStatus === k ? 'white' : 'var(--color-text-secondary)',
                      boxShadow:  xferStatus === k ? 'var(--shadow-sm)' : 'none',
                    }}>
                    {l}
                  </button>
                ))}
              </div>
              {companyAgents.length > 0 && (
                <select value={xferAgent} onChange={e => { setXferAgent(e.target.value); setXferPage(1); }}
                  className="input text-xs h-auto" style={{ minWidth: 160, paddingTop: 6, paddingBottom: 6 }}>
                  <option value="">All agents</option>
                  {companyAgents.map(a => (
                    <option key={a.user_id} value={a.user_id}>{a.first_name} {a.last_name}</option>
                  ))}
                </select>
              )}
              {(xferStatus || xferAgent) && (
                <button onClick={() => { setXferStatus(''); setXferAgent(''); setXferPage(1); }}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors hover:bg-error-50"
                  style={{ color: 'var(--color-error-600)', border: '1px solid var(--color-error-200)' }}>
                  <XCircle size={11} /> Clear filters
                </button>
              )}
            </div>

            {xferTabLoading ? (
              <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
            ) : xferTabRows.length === 0 ? (
              <p className="text-text-secondary text-center py-8">No transfers found.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        {['Customer', 'Phone', 'Status', 'Disposition', 'Closer', 'Date', 'Action'].map(h => (
                          <th key={h} className="text-left py-3 px-3 text-xs font-semibold text-text-secondary uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {xferTabRows.map(t => (
                        <tr key={t.id} onClick={() => setDetailTransfer(t)}
                          className="border-b border-border hover:bg-bg-secondary transition-colors cursor-pointer">
                          <td className="py-3 px-3 font-semibold text-text">
                            {t.form_data?.customer_name || t.form_data?.FirstName || 'Lead'}
                          </td>
                          <td className="py-3 px-3 text-text-secondary text-xs">{t.form_data?.customer_phone || t.form_data?.Phone || '—'}</td>
                          <td className="py-3 px-3">{(() => { const ds = getTransferDisplayStatus(t); return <Badge variant={ds.variant} size="sm">{ds.label}</Badge>; })()}</td>
                          <td className="py-3 px-3">
                            {(t.latest_disposition || t.sale_closer_disposition) ? (() => {
                              const d     = t.latest_disposition;
                              const name  = d?.disposition_name || t.sale_closer_disposition;
                              const color = d?.color || '#6b7280';
                              return (
                                <div className="flex flex-col gap-0.5">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold w-fit"
                                    style={{ backgroundColor: color + '22', color, border: `1px solid ${color}44` }}>
                                    <MessageSquare size={9} />{name}
                                  </span>
                                  {d?.setter_name && (
                                    <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>by {d.setter_name}</span>
                                  )}
                                </div>
                              );
                            })() : <span className="text-text-tertiary text-xs">—</span>}
                          </td>
                          <td className="py-3 px-3 text-text-secondary text-xs">{t.closer?.first_name || '—'}</td>
                          <td className="py-3 px-3 text-text-secondary text-xs">{fmtDateET(t.created_at)}</td>
                          <td className="py-3 px-3">
                            <div className="flex flex-wrap gap-1">
                              {hasPermission('submit_call_review') && (
                                <button onClick={e => { e.stopPropagation(); setRateTarget(t); setRatingVal('good'); setRatingNotes(''); setRatingMsg(''); }}
                                  className="px-2 py-1.5 rounded-lg text-xs font-semibold border"
                                  style={{ borderColor: 'var(--color-primary-300)', color: 'var(--color-primary-600)' }}>
                                  <Star size={11} className="inline mr-1" />Rate
                                </button>
                              )}
                              {hasPermission('submit_call_dispo') && (
                                <button onClick={e => { e.stopPropagation(); setDispoTarget(t); setDispoVal('sale'); setDispoNotes(''); setDispoMsg(''); }}
                                  className="px-2 py-1.5 rounded-lg text-xs font-semibold border"
                                  style={{ borderColor: 'var(--color-info-300)', color: 'var(--color-info-600)' }}>
                                  <MessageSquare size={11} className="inline mr-1" />Dispo
                                </button>
                              )}
                              {hasPermission('delete_transfer') && (
                                <button onClick={e => { e.stopPropagation(); if (window.confirm('Delete this transfer?')) { client.delete(`transfers/${t.id}`).then(() => fetchXferTab()); } }}
                                  className="px-2 py-1.5 rounded-lg text-xs font-semibold border"
                                  style={{ borderColor: 'var(--color-error-300)', color: 'var(--color-error-600)' }}>
                                  <Trash2 size={11} className="inline" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination page={xferPage} total={xferTabTotal} pageSize={PAGE_SIZE} onChange={setXferPage} />
              </>
            )}
          </Card>
        )}

        {/* ── TEAM SALES TAB ── */}
        {activeTab === 'team_sales' && (
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h3 className="text-xl font-bold text-text flex items-center gap-2"><DollarSign size={20} /> Team Sales</h3>
              <span className="text-sm text-text-secondary">{salesTabTotal} total</span>
            </div>

            {/* Filter bar */}
            <div className="flex flex-wrap gap-2 mb-4">
              <div className="flex gap-1 p-1 rounded-xl overflow-x-auto"
                style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                {[
                  { k: '',               l: 'All'       },
                  { k: 'open',           l: 'Pending'   },
                  { k: 'sold',           l: 'Sold'      },
                  { k: 'pending_review', l: 'In Review' },
                  { k: 'needs_revision', l: 'Needs Fix' },
                  { k: 'closed_won',     l: 'Approved'  },
                  { k: 'cancelled',      l: 'Cancelled' },
                  { k: 'closed_lost',    l: 'Lost'      },
                ].map(({ k, l }) => (
                  <button key={k} onClick={() => { setSalesStatus(k); setSalesPage(1); }}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap flex-shrink-0"
                    style={{
                      background: salesStatus === k ? 'var(--gradient-sidebar)' : 'transparent',
                      color:      salesStatus === k ? 'white' : 'var(--color-text-secondary)',
                      boxShadow:  salesStatus === k ? 'var(--shadow-sm)' : 'none',
                    }}>
                    {l}
                  </button>
                ))}
              </div>
              {companyAgents.length > 0 && (
                <select value={salesAgent} onChange={e => { setSalesAgent(e.target.value); setSalesPage(1); }}
                  className="input text-xs h-auto" style={{ minWidth: 160, paddingTop: 6, paddingBottom: 6 }}>
                  <option value="">All agents</option>
                  {companyAgents.map(a => (
                    <option key={a.user_id} value={a.user_id}>{a.first_name} {a.last_name}</option>
                  ))}
                </select>
              )}
              {(salesStatus || salesAgent) && (
                <button onClick={() => { setSalesStatus(''); setSalesAgent(''); setSalesPage(1); }}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors hover:bg-error-50"
                  style={{ color: 'var(--color-error-600)', border: '1px solid var(--color-error-200)' }}>
                  <XCircle size={11} /> Clear filters
                </button>
              )}
            </div>

            {salesTabLoading ? (
              <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
            ) : salesTabRows.length === 0 ? (
              <p className="text-text-secondary text-center py-8">No sales found.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        {['Customer', 'Reference', 'Status', 'Closer', hasPermission('view_financial_data') ? 'Monthly' : null, 'Date', hasPermission('delete_sale') ? 'Action' : null].filter(Boolean).map(h => (
                          <th key={h} className="text-left py-3 px-3 text-xs font-semibold text-text-secondary uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {salesTabRows.map(s => (
                        <tr key={s.id} onClick={() => setDetailSale(s)}
                          className="border-b border-border hover:bg-bg-secondary transition-colors cursor-pointer">
                          <td className="py-3 px-3 font-semibold text-text">{s.customer_name || '—'}</td>
                          <td className="py-3 px-3 text-xs font-mono text-text-tertiary">{s.reference_no || '—'}</td>
                          <td className="py-3 px-3"><Badge variant={SALE_BADGE[s.status] || 'secondary'} size="sm">{SALE_LABEL[s.status] || s.status}</Badge></td>
                          <td className="py-3 px-3 text-text-secondary text-xs">{s.closer_name || '—'}</td>
                          {hasPermission('view_financial_data') && <td className="py-3 px-3 text-xs font-semibold text-success-600">{s.monthly_payment ? `$${s.monthly_payment}/mo` : '—'}</td>}
                          <td className="py-3 px-3 text-text-secondary text-xs">{fmtDateET(s.created_at)}</td>
                          {hasPermission('delete_sale') && (
                            <td className="py-3 px-3">
                              <button onClick={e => { e.stopPropagation(); if (window.confirm('Delete this sale?')) { deleteSale(s.id).then(() => fetchSalesTab()); } }}
                                className="p-1.5 rounded-lg border transition-colors hover:bg-error-50"
                                style={{ borderColor: 'var(--color-error-300)', color: 'var(--color-error-600)' }}>
                                <Trash2 size={13} />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination page={salesPage} total={salesTabTotal} pageSize={PAGE_SIZE} onChange={setSalesPage} />
              </>
            )}
          </Card>
        )}

        {/* ── MY SALES TAB (closer view) ── */}
        {activeTab === 'sales' && isCloser && (
          <div>
            {saleSuccess && <Alert type="success" title="Sale Created!" message={saleSuccess} dismissible onDismiss={() => setSaleSuccess('')} />}
            {saleError   && <Alert type="error"   title="Error"         message={saleError}   dismissible onDismiss={() => setSaleError('')}   />}
            {reviewSuccess && <Alert type="success" title="Saved!" message={reviewSuccess} dismissible onDismiss={() => setReviewSuccess('')} />}
            {submitMsg   && <Alert type="error"   title="Error"         message={submitMsg}   dismissible onDismiss={() => setSubmitMsg('')}    />}

            {/* Phone search — find leads from linked fronter companies by number */}
            <div className="mb-6">
              <PhoneSearch onCreateSale={openSaleModal} companyTimezone={user?.company_timezone} refreshTrigger={phoneSearchRefresh} />
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-8">
              {[
                { label: 'My Sales',        value: stats.totalSales || 0,          icon: DollarSign, color: 'success' },
                { label: 'Approved',        value: stats.closedWon || 0,           icon: CheckCircle,color: 'success' },
                { label: 'Awaiting Review', value: stats.awaitingCompliance || 0,  icon: Clock,      color: 'warning' },
                { label: 'Conversion',      value: `${stats.conversionRate || 0}%`,icon: Target,     color: 'info'    },
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

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Assigned Transfers — only transfers explicitly assigned to this closer */}
              <Card className="p-6">
                <h3 className="text-xl font-bold mb-4 text-text flex items-center gap-2">
                  <Clock size={20} /> Assigned Transfers
                </h3>
                {tLoading ? (
                  <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
                ) : transfers.length === 0 ? (
                  <p className="text-text-secondary text-center py-8">No transfers assigned yet.</p>
                ) : (
                  <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                    {transfers.slice(0, 15).map(t => (
                      <div key={t.id} onClick={() => setDetailTransfer(t)}
                        className="p-4 rounded-xl border transition-all hover:shadow-md cursor-pointer"
                        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)' }}>
                        <div className="flex items-start justify-between mb-1">
                          <div>
                            <p className="font-semibold text-text">
                              {t.form_data?.FirstName ? `${t.form_data.FirstName} ${t.form_data.LastName || ''}`.trim()
                                : t.form_data?.customer_name || 'Unknown'}
                            </p>
                            <p className="text-xs text-text-secondary mt-0.5">
                              {t.form_data?.Phone || t.form_data?.customer_phone || ''}
                            </p>
                          </div>
                          <Badge variant={TRANSFER_BADGE[t.status] || 'secondary'} size="sm">{t.status}</Badge>
                        </div>
                        {t.status === 'assigned' && (
                          <div className="flex gap-2 mt-3">
                            {hasPermission('create_sale') && (
                              <button onClick={e => { e.stopPropagation(); openSaleModal(t); }}
                                className="flex-1 py-2 px-3 rounded-lg font-semibold text-sm text-white flex items-center justify-center gap-1 hover:scale-[1.02] transition-all"
                                style={{ background: 'var(--gradient-sidebar)' }}>
                                <DollarSign size={13} /> Convert to Sale
                              </button>
                            )}
                            {hasPermission('reject_transfer') && (
                              <button onClick={e => { e.stopPropagation(); setRejectTarget(t); setRejectReason(''); setRejectMsg(''); }}
                                className="px-3 py-2 rounded-lg font-semibold text-sm border flex items-center gap-1 hover:bg-error-50 transition-all"
                                style={{ borderColor: 'var(--color-error-300)', color: 'var(--color-error-600)' }}>
                                <XCircle size={13} /> Reject
                              </button>
                            )}
                          </div>
                        )}
                        <div className="flex gap-2 mt-2">
                          {hasPermission('submit_call_review') && (
                            <button onClick={e => { e.stopPropagation(); setRateTarget(t); setRatingVal('good'); setRatingNotes(''); setRatingMsg(''); }}
                              className="flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold border flex items-center justify-center gap-1 hover:bg-primary-50 transition-all"
                              style={{ borderColor: 'var(--color-primary-300)', color: 'var(--color-primary-600)' }}>
                              <Star size={11} /> Rate Call
                            </button>
                          )}
                          {hasPermission('submit_call_dispo') && (
                            <button onClick={e => { e.stopPropagation(); setDispoTarget(t); setDispoVal('sale'); setDispoNotes(''); setDispoMsg(''); }}
                              className="flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold border flex items-center justify-center gap-1 hover:bg-info-50 transition-all"
                              style={{ borderColor: 'var(--color-info-300)', color: 'var(--color-info-600)' }}>
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
                  <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
                ) : sales.length === 0 ? (
                  <p className="text-text-secondary text-center py-8">
                    No sales yet. Use phone search above to find a lead and create a sale.
                  </p>
                ) : (
                  <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                    {sales.slice(0, 15).map(s => (
                      <div key={s.id} onClick={() => setDetailSale(s)}
                        className="p-4 rounded-xl border transition-all hover:shadow-md cursor-pointer"
                        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)' }}>

                        {/* Compliance note banner for needs_revision */}
                        {s.status === 'needs_revision' && s.compliance_note && (
                          <div className="mb-3 p-3 rounded-lg flex items-start gap-2"
                            style={{ backgroundColor: 'var(--color-error-50)', border: '1px solid var(--color-error-200)' }}>
                            <AlertTriangle size={14} className="text-error-600 mt-0.5 flex-shrink-0" />
                            <div>
                              <p className="text-xs font-bold text-error-700 mb-0.5">Compliance note:</p>
                              <p className="text-xs text-error-600">{s.compliance_note}</p>
                            </div>
                          </div>
                        )}

                        <div className="flex items-start justify-between mb-1">
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
                          </div>
                          <div className="flex flex-col items-end gap-1 ml-2">
                            <Badge variant={SALE_BADGE[s.status] || 'secondary'} size="sm">
                              {SALE_LABEL[s.status] || s.status}
                            </Badge>
                            {s.monthly_payment && hasPermission('view_financial_data') && (
                              <span className="text-xs font-semibold text-success-600">${s.monthly_payment}/mo</span>
                            )}
                          </div>
                        </div>

                        {/* Action buttons based on status */}
                        {s.status === 'open' && (
                          <div className="flex gap-2 mt-3">
                            {hasPermission('submit_for_review') && (
                              <button
                                onClick={e => { e.stopPropagation(); handleSubmitForReview(s.id); }}
                                disabled={submitting === s.id}
                                className="flex-1 py-1.5 px-3 rounded-lg text-xs font-bold text-white flex items-center justify-center gap-1 hover:scale-[1.02] transition-all disabled:opacity-50"
                                style={{ background: 'var(--gradient-sidebar)' }}>
                                {submitting === s.id
                                  ? <><RefreshCw size={11} className="animate-spin" /> Submitting…</>
                                  : <><CheckCircle size={12} /> Submit for Review</>}
                              </button>
                            )}
                            <button
                              onClick={e => { e.stopPropagation(); setEditSale(s); setEditSaleError(''); }}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold border flex items-center gap-1 transition-all hover:bg-bg-secondary"
                              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                              <Pencil size={11} /> Edit
                            </button>
                          </div>
                        )}

                        {s.status === 'pending_review' && (
                          <div className="mt-3 py-2 px-3 rounded-lg text-xs font-semibold text-center"
                            style={{ backgroundColor: 'var(--color-warning-50)', color: 'var(--color-warning-700)',
                              border: '1px solid var(--color-warning-200)' }}>
                            ⏳ Awaiting compliance review
                          </div>
                        )}

                        {s.status === 'needs_revision' && (
                          <div className="flex gap-2 mt-3">
                            <button
                              onClick={e => { e.stopPropagation(); setEditSale(s); setEditSaleError(''); }}
                              className="flex-1 py-1.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-all hover:scale-[1.02]"
                              style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
                              <Pencil size={11} /> Edit Sale
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); handleSubmitForReview(s.id); }}
                              disabled={submitting === s.id}
                              className="flex-1 py-1.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-all disabled:opacity-50"
                              style={{ backgroundColor: 'var(--color-error-600)', color: '#fff' }}>
                              {submitting === s.id
                                ? <><RefreshCw size={11} className="animate-spin" /> Resubmitting…</>
                                : <><RefreshCw size={11} /> Resubmit</>}
                            </button>
                          </div>
                        )}

                        {/* Schedule callback from sale */}
                        {hasPermission('manage_callbacks') && (
                          <button
                            onClick={e => { e.stopPropagation(); setCallbackSale(s); setCallbackAt(''); setCallbackNotes(''); setCallbackMsg(''); }}
                            className="w-full mt-2 py-1.5 px-3 rounded-lg text-xs font-semibold border flex items-center justify-center gap-1 transition-all hover:bg-info-50"
                            style={{ borderColor: 'var(--color-info-300)', color: 'var(--color-info-600)' }}>
                            <CalendarPlus size={11} /> Schedule Callback
                          </button>
                        )}
                        {hasPermission('delete_sale') && (
                          <button
                            onClick={e => { e.stopPropagation(); if (window.confirm('Delete this sale? This cannot be undone.')) { deleteSale(s.id).then(() => fetchSales({ date_from, date_to })); } }}
                            className="w-full mt-1 py-1.5 px-3 rounded-lg text-xs font-semibold border flex items-center justify-center gap-1 transition-all hover:bg-error-50"
                            style={{ borderColor: 'var(--color-error-300)', color: 'var(--color-error-600)' }}>
                            <Trash2 size={11} /> Delete Sale
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}

        {/* ── MY TRANSFERS TAB (fronter view) ── */}
        {activeTab === 'transfers' && isFronter && (
          <div>
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {[
                { label: 'Total Leads',       value: stats.totalTransfers || 0,       color: 'info',    icon: Send         },
                { label: 'Approved Sales',    value: stats.closedWon || 0,            color: 'success', icon: CheckCircle  },
                { label: 'Awaiting Review',   value: stats.awaitingCompliance || 0,   color: 'warning', icon: Clock        },
                { label: 'Conversion',        value: `${stats.conversionRate || 0}%`, color: 'primary', icon: Target       },
              ].map(({ label, value, color, icon: Icon }) => (
                <Card key={label} className="p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-text-secondary mb-1">{label}</p>
                      <p className={`text-3xl font-bold text-${color}-600`} style={{ fontFamily: 'var(--font-display)', letterSpacing: '-0.03em' }}>{statsLoading ? '—' : value}</p>
                    </div>
                    <div className={`p-3 rounded-xl bg-${color}-100 dark:bg-${color}-900`}>
                      <Icon size={20} className={`text-${color}-600`} />
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Create Lead */}
              {hasPermission('create_transfer') && (
                <Card className="p-6">
                  <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ background: 'var(--gradient-sidebar)' }}>
                        <Plus size={15} className="text-white" />
                      </div>
                      <div>
                        <h3 className="text-base font-bold" style={{ color: 'var(--color-text)' }}>New Lead</h3>
                        <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Transfer a call to a closer</p>
                      </div>
                    </div>
                    {!showCreateForm && (
                      <button onClick={() => setShowCreateForm(true)}
                        className="flex items-center gap-1.5 py-2 px-4 rounded-xl text-sm font-bold text-white transition-all hover:scale-[1.02]"
                        style={{ background: 'var(--gradient-sidebar)', boxShadow: 'var(--shadow-md)' }}>
                        <Plus size={14} /> Create Lead
                      </button>
                    )}
                  </div>
                  {showCreateForm ? (
                    <form onSubmit={handleSubmitTransfer} className="animate-slide-up">
                      {/* Section header */}
                      <div className="flex items-center gap-2.5 mb-4">
                        <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
                          style={{ background: 'var(--gradient-sidebar)' }}>
                          <Send size={11} className="text-white" />
                        </div>
                        <span className="text-[11px] font-bold uppercase tracking-widest"
                          style={{ color: 'var(--color-text-secondary)' }}>
                          Customer Details
                        </span>
                        <div className="flex-1 h-px" style={{ backgroundColor: 'var(--color-border)' }} />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-5 items-start gap-x-4 gap-y-5">
                        {fields.filter(f => f.show_to_fronter !== false).sort((a, b) => (a.order || 0) - (b.order || 0)).map(field => {
                          const spanClass = { 1: 'sm:col-span-1', 2: 'sm:col-span-2', 3: 'sm:col-span-3', 4: 'sm:col-span-4', 5: 'sm:col-span-5' }[field.column_span] || 'sm:col-span-1';
                          return (
                            <div key={field.id} className={`self-start ${spanClass}`}>
                              <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5"
                                style={{ color: 'var(--color-text-secondary)' }}>
                                {field.label}
                                {field.is_required && <span className="ml-0.5" style={{ color: '#ef4444' }}>*</span>}
                              </label>
                              {field.field_type === 'textarea' ? (
                                <textarea value={formData[field.name] || ''} onChange={e => setFormData({ ...formData, [field.name]: e.target.value })}
                                  className="input resize-none" rows="3" required={field.is_required} placeholder={field.placeholder || ''} />
                              ) : field.field_type === 'select' ? (
                                <select value={formData[field.name] || ''} onChange={e => setFormData({ ...formData, [field.name]: e.target.value })}
                                  className="input" required={field.is_required}>
                                  <option value="">Select {field.label}</option>
                                  {(field.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                </select>
                              ) : field.field_type === 'sale_client' ? (
                                <select value={formData[field.name] || ''} onChange={e => setFormData({ ...formData, [field.name]: e.target.value })}
                                  className="input" required={field.is_required}>
                                  <option value="">Select client…</option>
                                  {saleClients.map(c => <option key={c.id} value={c.value}>{c.value}</option>)}
                                </select>
                              ) : field.field_type === 'sale_plan' ? (
                                <select value={formData[field.name] || ''} onChange={e => setFormData({ ...formData, [field.name]: e.target.value })}
                                  className="input" required={field.is_required}>
                                  <option value="">Select plan…</option>
                                  {salePlans.map(p => <option key={p.id} value={p.value}>{p.value}</option>)}
                                </select>
                              ) : field.field_type === 'zip' ? (
                                <div className="relative">
                                  <input type="text"
                                    value={formData[field.name] || ''}
                                    onChange={e => handleFronterZipChange(field.name, e.target.value, fields)}
                                    className="input pr-8" required={field.is_required}
                                    placeholder={field.placeholder || 'e.g. 90210'} maxLength={10} />
                                  {zipFronterLoading && (
                                    <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                                      <div className="animate-spin rounded-full h-4 w-4 border-b-2"
                                        style={{ borderColor: 'var(--color-primary-600)' }} />
                                    </div>
                                  )}
                                  {!zipFronterLoading && zipFronterInfo && (formData[field.name] || '').replace(/\D/g, '').length >= 5 && (
                                    <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                                      {zipFronterInfo.city}, {zipFronterInfo.state}
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <input type={field.field_type === 'phone' || field.field_type === 'tel' ? 'tel' : field.field_type}
                                  value={formData[field.name] || ''} onChange={e => setFormData({ ...formData, [field.name]: e.target.value })}
                                  className="input" required={field.is_required} placeholder={field.placeholder || ''} />
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {transferError && (
                        <div className="mt-4 flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold"
                          style={{ backgroundColor: '#fee2e2', color: '#dc2626', border: '1px solid #fca5a5' }}>
                          <AlertTriangle size={14} /> {transferError}
                        </div>
                      )}

                      <div className="flex gap-3 pt-5 mt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
                        <button type="button"
                          onClick={() => { setShowCreateForm(false); setFormData({}); setZipFronterInfo(null); }}
                          className="flex-1 py-2.5 rounded-xl font-semibold text-sm transition-colors hover:bg-bg-secondary"
                          style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                          Cancel
                        </button>
                        <button type="submit" disabled={transferSubmitting}
                          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-sm text-white disabled:opacity-50 transition-all hover:scale-[1.02] active:scale-[0.98]"
                          style={{ background: 'var(--gradient-sidebar)', boxShadow: 'var(--shadow-md)' }}>
                          {transferSubmitting
                            ? <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> Submitting…</>
                            : <><Send size={13} /> Transfer Lead</>
                          }
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-10 rounded-2xl border-dashed border-2"
                      style={{ borderColor: 'var(--color-border)' }}>
                      <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
                        style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                        <Send size={22} style={{ color: 'var(--color-text-tertiary)' }} />
                      </div>
                      <p className="font-semibold text-sm mb-1" style={{ color: 'var(--color-text)' }}>Ready to transfer?</p>
                      <p className="text-xs mb-4" style={{ color: 'var(--color-text-tertiary)' }}>Fill customer details to route call to a closer.</p>
                      <button onClick={() => setShowCreateForm(true)}
                        className="flex items-center gap-1.5 py-2 px-5 rounded-xl text-sm font-bold text-white transition-all hover:scale-[1.02]"
                        style={{ background: 'var(--gradient-sidebar)', boxShadow: 'var(--shadow-md)' }}>
                        <Plus size={14} /> Create Lead
                      </button>
                    </div>
                  )}
                </Card>
              )}

              {/* My Leads */}
              <Card className="p-6">
                <h3 className="text-xl font-bold mb-4 text-text flex items-center gap-2"><FileText size={20} /> My Leads</h3>
                <div className="relative mb-3">
                  <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
                  <input
                    type="tel"
                    value={leadSearch}
                    onChange={e => setLeadSearch(e.target.value)}
                    placeholder="Filter by phone or name…"
                    className="input pl-8 text-sm"
                  />
                </div>
                {tLoading ? (
                  <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
                ) : transfers.length === 0 ? (
                  <p className="text-text-secondary text-center py-8">No leads yet.</p>
                ) : (
                  <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                    {transfers.filter(t => {
                      if (!leadSearch.trim()) return true;
                      const q = leadSearch.trim().toLowerCase();
                      const phone = (t.form_data?.customer_phone || t.form_data?.Phone || '').toLowerCase();
                      const name  = (t.form_data?.customer_name  || `${t.form_data?.FirstName || ''} ${t.form_data?.LastName || ''}`).toLowerCase();
                      return phone.includes(q) || name.includes(q);
                    }).map(t => (
                      <div key={t.id} onClick={() => setDetailTransfer(t)}
                        className="p-4 rounded-xl border hover:shadow-md transition-all cursor-pointer"
                        style={{
                          borderColor: t.sale_status === 'needs_revision' ? 'var(--color-error-300)' : 'var(--color-border)',
                          backgroundColor: t.sale_status === 'needs_revision' ? 'var(--color-error-50)' : 'var(--color-bg)',
                        }}>
                        <div className="flex items-start justify-between mb-1">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-text truncate">
                              {t.form_data?.customer_name || (t.form_data?.FirstName ? `${t.form_data.FirstName} ${t.form_data.LastName || ''}`.trim() : 'Lead')}
                            </p>
                            <p className="text-xs text-text-secondary mt-0.5">{t.form_data?.Phone || t.form_data?.customer_phone || ''}</p>
                            {t.status === 'rejected' && t.rejection_reason && (
                              <p className="text-xs text-error-600 mt-0.5">Rejected: {t.rejection_reason}</p>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            {(() => { const ds = getTransferDisplayStatus(t); return <Badge variant={ds.variant} size="sm">{ds.label}</Badge>; })()}
                            {(() => {
                              const d     = t.latest_disposition;
                              const name  = d?.disposition_name || t.sale_closer_disposition;
                              const color = d?.color || '#6b7280';
                              if (name) return (
                                <div className="flex flex-col items-end gap-0.5">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold"
                                    style={{ backgroundColor: color + '22', color, border: `1px solid ${color}44` }}>
                                    <MessageSquare size={9} />
                                    {name}
                                  </span>
                                  {d?.setter_name && (
                                    <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                                      by {d.setter_name}
                                    </span>
                                  )}
                                </div>
                              );
                              return (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold"
                                  style={{ backgroundColor: '#f3f4f6', color: '#9ca3af', border: '1px solid #e5e7eb' }}>
                                  <Clock size={9} /> In Progress
                                </span>
                              );
                            })()}
                          </div>
                        </div>
                        {t.sale_status === 'needs_revision' && t.sale_compliance_note && (
                          <div className="mt-2 flex items-start gap-1.5 px-2 py-1.5 rounded-lg"
                            style={{ backgroundColor: 'var(--color-error-100)', border: '1px solid var(--color-error-200)' }}>
                            <AlertTriangle size={12} className="text-error-600 mt-0.5 flex-shrink-0" />
                            <p className="text-xs text-error-600">{t.sale_compliance_note}</p>
                          </div>
                        )}
                        <div className="flex items-center justify-between mt-2">
                          <p className="text-xs text-text-tertiary">{fmtDateET(t.created_at)}</p>
                          {t.status !== 'completed' && !t.sale_id && (
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                if (window.confirm('Delete this lead? This cannot be undone.')) {
                                  deleteTransfer(t.id).catch(err =>
                                    toastError(err, 'Failed to delete lead')
                                  );
                                }
                              }}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold transition-all hover:bg-error-50"
                              style={{ color: 'var(--color-error-600)', border: '1px solid var(--color-error-200)' }}>
                              <Trash2 size={11} /> Delete
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}
        <DevCredit />
      </main>

      {/* ── MODALS ── */}


      <SaleModal isOpen={modalOpen} onClose={() => setModalOpen(false)} user={user}
        transfer={activeTransfer} onSubmit={handleSaleSubmit} isLoading={saleLoading} />

      {/* Edit sale modal */}
      <SaleModal isOpen={!!editSale} onClose={() => { setEditSale(null); setEditSaleError(''); }} user={user}
        existingSale={editSale} onSubmit={handleSaleEdit} isLoading={editSaleLoading} />
      {editSaleError && (
        <div className="fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-semibold text-white shadow-lg"
          style={{ backgroundColor: 'var(--color-error-600)' }}>
          {editSaleError}
        </div>
      )}

      {rejectTarget && (
        <div className="fixed inset-0 z-50 overflow-y-auto" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="flex min-h-full items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl p-6 shadow-2xl"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <h3 className="text-lg font-bold text-text mb-1">Reject Transfer</h3>
            <p className="text-sm text-text-secondary mb-4">
              Customer: <strong>{rejectTarget.form_data?.FirstName
                ? `${rejectTarget.form_data.FirstName} ${rejectTarget.form_data.LastName || ''}`.trim()
                : rejectTarget.form_data?.customer_name || 'Unknown'}</strong>
            </p>
            <label className="block text-sm font-medium text-text-secondary mb-1">Reason <span className="text-error-500">*</span></label>
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)}
              placeholder="Reason for rejection…" rows={3} className="input mb-3" />
            {rejectMsg && <p className="text-sm text-error-600 mb-3">{rejectMsg}</p>}
            <div className="flex gap-3">
              <button onClick={() => setRejectTarget(null)} className="flex-1 py-2 rounded-lg border font-semibold text-sm"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Cancel</button>
              <button onClick={handleRejectTransfer} disabled={rejecting}
                className="flex-1 py-2 rounded-lg font-semibold text-sm text-white disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-error-600)' }}>
                {rejecting ? 'Rejecting…' : 'Confirm Reject'}
              </button>
            </div>
          </div>
          </div>
        </div>
      )}

      {rateTarget && (
        <div className="fixed inset-0 z-50 overflow-y-auto" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="flex min-h-full items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl p-6 shadow-2xl"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <h3 className="text-lg font-bold text-text mb-1 flex items-center gap-2"><Star size={18} style={{ color: '#f59e0b' }} /> Rate Call</h3>
            <p className="text-sm text-text-secondary mb-4">Customer: <strong>{rateTarget.form_data?.customer_name || 'Unknown'}</strong></p>
            <div className="flex gap-2 mb-4 flex-wrap">
              {RATINGS.map(r => (
                <button key={r} onClick={() => setRatingVal(r)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition-all capitalize"
                  style={{ borderColor: ratingVal === r ? RATING_COLOR[r] : 'var(--color-border)',
                    backgroundColor: ratingVal === r ? `${RATING_COLOR[r]}15` : 'transparent',
                    color: ratingVal === r ? RATING_COLOR[r] : 'var(--color-text-secondary)' }}>
                  {r.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
            <textarea value={ratingNotes} onChange={e => setRatingNotes(e.target.value)}
              placeholder="Notes (optional)…" rows={2} className="input mb-3" />
            {ratingMsg && <p className="text-sm text-error-600 mb-3">{ratingMsg}</p>}
            <div className="flex gap-3">
              <button onClick={() => setRateTarget(null)} className="flex-1 py-2 rounded-lg border font-semibold text-sm"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Cancel</button>
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

      {dispoTarget && (
        <div className="fixed inset-0 z-50 overflow-y-auto" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="flex min-h-full items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl p-6 shadow-2xl"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <h3 className="text-lg font-bold text-text mb-1 flex items-center gap-2">
              <MessageSquare size={18} style={{ color: 'var(--color-primary-600)' }} /> Set Disposition
            </h3>
            <p className="text-sm text-text-secondary mb-4">Customer: <strong>{dispoTarget.form_data?.customer_name || 'Unknown'}</strong></p>
            <select value={dispoVal} onChange={e => setDispoVal(e.target.value)} className="input mb-3">
              {DISPOS.map(d => <option key={d} value={d}>{d.replace(/_/g, ' ')}</option>)}
            </select>
            <textarea value={dispoNotes} onChange={e => setDispoNotes(e.target.value)}
              placeholder="Notes (optional)…" rows={2} className="input mb-3" />
            {dispoMsg && <p className="text-sm text-error-600 mb-3">{dispoMsg}</p>}
            <div className="flex gap-3">
              <button onClick={() => setDispoTarget(null)} className="flex-1 py-2 rounded-lg border font-semibold text-sm"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Cancel</button>
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

      {/* Schedule Callback from Sale modal */}
      {callbackSale && (
        <div className="fixed inset-0 z-50 overflow-y-auto" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="flex min-h-full items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl p-6 shadow-2xl"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <h3 className="text-lg font-bold text-text mb-1 flex items-center gap-2">
              <CalendarPlus size={18} style={{ color: 'var(--color-info-600)' }} /> Schedule Callback
            </h3>
            <p className="text-sm text-text-secondary mb-4">
              Customer: <strong>{callbackSale.customer_name || 'Unknown'}</strong>
              {callbackSale.customer_phone && <span className="ml-2 text-xs text-text-tertiary">{callbackSale.customer_phone}</span>}
            </p>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Date &amp; Time <span className="text-error-500">*</span>
            </label>
            <input
              type="datetime-local"
              value={callbackAt}
              onChange={e => setCallbackAt(e.target.value)}
              min={new Date().toISOString().slice(0, 16)}
              className="input mb-3"
            />
            <label className="block text-sm font-medium text-text-secondary mb-1">Notes</label>
            <textarea
              value={callbackNotes}
              onChange={e => setCallbackNotes(e.target.value)}
              placeholder="Optional notes…"
              rows={2}
              className="input mb-3"
            />
            {callbackMsg && <p className="text-sm text-error-600 mb-3">{callbackMsg}</p>}
            <div className="flex gap-3">
              <button onClick={() => setCallbackSale(null)} className="flex-1 py-2 rounded-lg border font-semibold text-sm"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                Cancel
              </button>
              <button onClick={handleScheduleCallback} disabled={callbackSaving}
                className="flex-1 py-2 rounded-lg font-semibold text-sm text-white disabled:opacity-50"
                style={{ background: 'var(--gradient-sidebar)' }}>
                {callbackSaving ? 'Saving…' : 'Schedule'}
              </button>
            </div>
          </div>
          </div>
        </div>
      )}

      <TransferDetailDrawer transfer={detailTransfer} onClose={() => setDetailTransfer(null)} />
      <SaleDetailDrawer     sale={detailSale}         onClose={() => setDetailSale(null)} />
    </div>
  );
};

export default StaffShell;
