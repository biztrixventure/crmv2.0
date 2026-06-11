import { useEffect, useState, useCallback, useMemo, lazy, Suspense } from "react";
import { usePersistedState } from "../hooks/usePersistedState";
import { useAuth } from "../contexts/AuthContext";
import { useVersionCheck } from "../hooks/useVersionCheck";
import UpdateBanner from "../components/UI/UpdateBanner";
import { useTheme } from "../contexts/ThemeContext";
import { useFeatureFlags } from "../contexts/FeatureFlagsContext";
import { useNavigate } from "react-router-dom";
import {
  Users, DollarSign, Send, Phone, BarChart3, TrendingUp,
  CheckCircle, XCircle, Clock, Hash, Car, User, ArrowRight,
  Search, Star, Shield, FileText, RefreshCw, AlertCircle, Plus,
  MessageSquare, Trash2, Activity, ChevronLeft, ChevronRight, CalendarDays, HelpCircle, FileSpreadsheet, Trophy, Copy,
} from "lucide-react";
import { Card, Badge, Alert } from "../components/UI";
import DateRangePicker, { getPresetRange } from "../components/UI/DateRangePicker";
import { AppHeader } from "../components/Layout";
import { useSales } from "../hooks/useSales";
import { useTransfers } from "../hooks/useTransfers";
import { useNotifications } from "../hooks/useNotifications";
import { useDashboardStats } from "../hooks/useDashboardStats";
import { useShellLayout } from "../hooks/useShellLayout";
import StatCardTriple from "../components/UI/StatCardTriple";
import SaleStatusBadge from "../components/UI/SaleStatusBadge";
import SaleStatusFilterPills from "../components/UI/SaleStatusFilterPills";
import TransferStatusFilterPills from "../components/UI/TransferStatusFilterPills";
import FilterBar from "../components/UI/FilterBar";
import ManagerCallbacksTab from "../components/Callbacks/ManagerCallbacksTab";
import CallbackNumbers from "../components/CallbackNumbers/CallbackNumbers";
import NumberUploadManager from "../components/Numbers/NumberUploadManager";
import SaleSearch from "../components/Sales/SaleSearch";
import FAQPanel from "../components/FAQ/FAQPanel";
import ScriptPanel from "../components/FAQ/ScriptPanel";
import FAQManager from "../components/Admin/FAQManager/FAQManager";
import ScriptManager from "../components/Admin/ScriptManager/ScriptManager";
import EngagementBanners from "../components/Engagement/EngagementBanners";
import SpiffWidget from "../components/Engagement/SpiffWidget";
import SaleModal from "../components/Closer/SaleModal";
import CrossRoleContent from "../components/Navigation/CrossRoleContent";
import TeamManagementPanel from "../components/Navigation/TeamManagementPanel";
import RoleManagementPanel from "../components/Navigation/RoleManagementPanel";
import ReviewsPanel from "../components/Navigation/ReviewsPanel";
import ReportsPanel from "../components/Navigation/ReportsPanel";
import EventsCalendar from "../components/Calendar/EventsCalendar";
import ManagerExportModal from "../components/Manager/ManagerExportModal";
const FormBuilder  = lazy(() => import("../components/Admin/FormBuilder/FormBuilder"));
const SpiffManager = lazy(() => import("../components/Admin/Engagement/SpiffManager"));
import TransferDetailDrawer from "../components/Shared/TransferDetailDrawer";
import SaleDetailDrawer from "../components/Shared/SaleDetailDrawer";
import client from "../api/client";
import DevCredit from "../components/DevCredit";
import { getTransferDisplayStatus } from "../utils/transferStatus";
import { fmtDateET, todayET, fmtSaleDate } from "../utils/timezone";

const SALE_BADGE  = { open: 'info', sold: 'success', cancelled: 'error', follow_up: 'warning', closed_won: 'success', closed_lost: 'error', pending_review: 'warning', needs_revision: 'error' };
const SALE_LABEL  = { open: 'Pending', sold: 'Sold', cancelled: 'Cancelled', follow_up: 'Follow Up', closed_won: 'Approved', closed_lost: 'Lost', pending_review: 'In Review', needs_revision: 'Needs Revision' };
const XFER_BADGE  = { pending: 'warning', assigned: 'info', completed: 'success', cancelled: 'error', rejected: 'error' };
const PAGE_SIZE   = 25;

// ── Overview helpers ──────────────────────────────────────────────────────────
const MEDAL_COLORS    = ['#f59e0b', '#94a3b8', '#b45309'];
const AVATAR_PALETTE  = ['#6366f1','#0891b2','#059669','#dc2626','#7c3aed','#ea580c','#0284c7','#65a30d','#c026d3','#0d9488'];
const getInitials     = n => (n || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
const getAvatarColor  = n => AVATAR_PALETTE[(n?.charCodeAt(0) || 0) % AVATAR_PALETTE.length];

const SkeletonLeaderRow = () => (
  <div className="flex items-center gap-3 py-2.5">
    <div className="w-5 h-5 rounded-full animate-pulse flex-shrink-0" style={{ backgroundColor: 'var(--color-border)' }} />
    <div className="w-7 h-7 rounded-full animate-pulse flex-shrink-0" style={{ backgroundColor: 'var(--color-border)' }} />
    <div className="flex-1 space-y-1.5">
      <div className="h-3.5 w-3/4 rounded animate-pulse" style={{ backgroundColor: 'var(--color-border)' }} />
      <div className="h-1.5 w-full rounded-full animate-pulse" style={{ backgroundColor: 'var(--color-border)' }} />
    </div>
    <div className="w-16 space-y-1.5 flex-shrink-0">
      <div className="h-3 rounded animate-pulse" style={{ backgroundColor: 'var(--color-border)' }} />
      <div className="h-2.5 rounded animate-pulse" style={{ backgroundColor: 'var(--color-border)' }} />
    </div>
  </div>
);

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

const ManagerShell = () => {
  const { user, logout, updateUser, hasPermission } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { isEnabled } = useFeatureFlags();
  const navigate = useNavigate();
  const notifHook = useNotifications();
  const { stats, fetchStats } = useDashboardStats();
  useEffect(() => { fetchStats(); }, [fetchStats]);
  const updateAvailable = useVersionCheck();

  const { sales, loading: salesLoading, fetchSales, createSale, updateSale, deleteSale } = useSales(user?.company_id);
  const { transfers, loading: xferLoading, fetchTransfers, updateTransfer } = useTransfers(user?.company_id);

  const companyId = user?.company_id;
  const [dateRange, setDateRange] = useState(() => getPresetRange('today'));
  const { date_from, date_to } = dateRange;

  // ── Cross-role top nav (matches StaffShell pattern) ───────────────────────
  // These sit in the AppHeader top-nav row alongside Dashboard. Selecting one
  // hides the dashboard content area and renders <CrossRoleContent> instead.
  // Mirrors StaffShell.crossNavItems gating so a manager who lacks a permission
  // doesn't see the item.
  const crossNavItems = [
    { key: 'calendar', label: 'Calendar', icon: CalendarDays },
    ...(hasPermission('view_company_members') || hasPermission('create_user') || hasPermission('edit_user') || hasPermission('manage_company_users')
      ? [{ key: 'team',    label: 'Team',    icon: Users    }] : []),
    ...(hasPermission('manage_roles') || hasPermission('manage_company_roles')
      ? [{ key: 'roles',   label: 'Roles',   icon: Shield   }] : []),
    ...(hasPermission('manage_forms') && isEnabled('form_builder')
      ? [{ key: 'forms',   label: 'Forms',   icon: FileText }] : []),
    ...((hasPermission('view_all_call_reviews') || hasPermission('view_call_reviews')) && isEnabled('call_reviews')
      ? [{ key: 'reviews', label: 'Reviews', icon: Star     }] : []),
    ...((hasPermission('view_fronter_stats') || hasPermission('view_closer_stats') || hasPermission('view_company_reports') || hasPermission('view_reports')) && isEnabled('reports')
      ? [{ key: 'reports', label: 'Reports', icon: BarChart3}] : []),
  ];

  // ── Tab logic ─────────────────────────────────────────────────────────────
  // Inline tabs here are workflow-specific (team transfers/sales/callbacks/
  // numbers/spiffs/activity_log/faqs/scripts). Cross-role admin surfaces
  // (Calendar/Team/Roles/Forms/Reviews/Reports) have moved to crossNavItems
  // above so the dashboard tab bar doesn't carry duplicate destinations.
  // CODE_TABS = the catalog gated by permissions + feature flags. The admin
  // layout override (shell.layout.manager) can only narrow this — hide,
  // rename, reorder — never widen. Permission-gated tabs stay hidden
  // regardless of admin config.
  const CODE_TABS = [
    { key: 'overview',     label: 'Overview',        icon: TrendingUp,   always: true },
    ...((hasPermission('view_team_transfers') || hasPermission('view_all_company_transfers')) && isEnabled('transfers')
      ? [{ key: 'transfers',  label: 'Team Transfers', icon: Send       }] : []),
    ...((hasPermission('view_team_sales') || hasPermission('view_all_company_sales')) && isEnabled('sales')
      ? [{ key: 'team_sales', label: 'Team Sales',     icon: DollarSign }] : []),
    ...((hasPermission('create_sale') || hasPermission('view_own_sales')) && isEnabled('sales')
      ? [{ key: 'my_sales',   label: 'My Sales',       icon: DollarSign }] : []),
    ...(hasPermission('view_team_callbacks') && isEnabled('callbacks')
      ? [{ key: 'callbacks',  label: 'Team Callbacks', icon: Phone      }] : []),
    ...((hasPermission('manage_callback_numbers') || hasPermission('view_team_callback_numbers') || hasPermission('reassign_callback_numbers')) && (isEnabled('callback_numbers') || isEnabled('number_assignment'))
      ? [{ key: 'numbers',    label: 'Numbers',        icon: Hash       }] : []),
    ...(hasPermission('search_sales') && isEnabled('search_sales')
      ? [{ key: 'search',     label: 'Sale Search',    icon: Search     }] : []),
    // SPIFFs — company admins / managers can run incentives scoped to their
    // company. Superadmin still uses /admin's SPIFF tab for cross-company.
    ...(['company_admin', 'operations_manager', 'closer_manager', 'fronter_manager', 'manager'].includes(user?.role)
      ? [{ key: 'spiffs',     label: 'SPIFFs',         icon: Trophy     }] : []),
    { key: 'activity_log', label: 'Activity Log', icon: Activity },
    { key: 'faqs',         label: 'FAQs',         icon: HelpCircle },
    { key: 'scripts',      label: 'Scripts',      icon: FileText },
  ];
  const {
    applyTabs: applyManagerLayout,
    defaultTab: managerDefaultTab,
    isCardVisible: isMgrCardVisible,
    isFilterVisible: isMgrFilterVisible,
    isActionVisible: isMgrActionVisible,
    cardLabel: mgrCardLabel,
  } = useShellLayout('manager');
  const TABS = useMemo(() => applyManagerLayout(CODE_TABS), [applyManagerLayout, CODE_TABS]);

  const tabKeys = useMemo(() => new Set(TABS.map(t => t.key)), [TABS]);

  // Persisted across reloads — per-role storage key so manager state stays
  // distinct from any other role using the same machine.
  const mgrTabKey = `biztrix.managerTab.${user?.role || 'default'}`;
  const mgrNavKey = `biztrix.managerNav.${user?.role || 'default'}`;
  const [activeTab, setActiveTab] = usePersistedState(mgrTabKey, 'overview');
  const [activeNav, setActiveNav] = usePersistedState(mgrNavKey, 'dashboard');
  const [exportOpen, setExportOpen] = useState(false);

  // Reconcile activeTab when admin layout hides the persisted tab key.
  // Without this, landing on a tab the admin just disabled would show
  // an empty body until the user manually picks another tab.
  useEffect(() => {
    if (TABS.length && !TABS.some(t => t.key === activeTab)) {
      const fallback = managerDefaultTab(TABS) || TABS[0]?.key;
      if (fallback) setActiveTab(fallback);
    }
  }, [TABS, activeTab, managerDefaultTab, setActiveTab]);

  // Report the active section to the assistant for section-specific guidance.
  useEffect(() => { window.crmAssistant?.setSection?.(activeNav !== 'dashboard' ? activeNav : activeTab); }, [activeTab, activeNav]);

  // ── Overview data ─────────────────────────────────────────────────────────
  const [fronterLb, setFronterLb]       = useState([]);
  const [closerLb, setCloserLb]         = useState([]);
  const [loading, setLoading]           = useState(false);
  const [overviewTotals, setOverviewTotals] = useState({ transfers: 0, sales: 0, approved: 0, pendingReview: 0 });

  // ── Pagination ────────────────────────────────────────────────────────────
  const [xferPage, setXferPage]           = useState(1);
  const [salesPage, setSalesPage]         = useState(1);
  const [activityPage,    setActivityPage]    = useState(1);
  const [activityLogs,    setActivityLogs]    = useState([]);
  const [activityTotal,   setActivityTotal]   = useState(0);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityAgent,   setActivityAgent]   = useState('');

  // ── Tab-specific server-side state ────────────────────────────────────────
  const [xferTabRows,    setXferTabRows]    = useState([]);
  const [xferTabTotal,   setXferTabTotal]   = useState(0);
  const [xferTabLoading, setXferTabLoading] = useState(false);
  const [xferStatus,     setXferStatus]     = useState('');
  const [xferAgent,      setXferAgent]      = useState('');
  const [xferTodayOnly,  setXferTodayOnly]  = useState(false);
  const [xferTodayCount, setXferTodayCount] = useState(null);

  const [salesTabRows,    setSalesTabRows]    = useState([]);
  const [salesTabTotal,   setSalesTabTotal]   = useState(0);
  const [salesTabLoading, setSalesTabLoading] = useState(false);
  const [salesStatus,     setSalesStatus]     = useState('');
  const [salesSearch,     setSalesSearch]     = useState('');
  const [xferSearch,      setXferSearch]      = useState('');
  const [salesAgent,      setSalesAgent]      = useState('');

  const [companyAgents, setCompanyAgents] = useState([]);

  // ── Detail drawers ────────────────────────────────────────────────────────
  const [detailTransfer, setDetailTransfer] = useState(null);
  const [detailSale, setDetailSale]         = useState(null);

  // ── Rate call / Set dispo ─────────────────────────────────────────────────
  const RATINGS = ['excellent', 'good', 'average', 'below_average', 'bad'];
  const DISPOS  = ['sale', 'no_sale', 'callback', 'not_interested', 'hung_up', 'voicemail', 'other'];
  const RATING_COLOR = { excellent: '#16a34a', good: '#2563eb', average: '#d97706', below_average: '#ea580c', bad: '#dc2626' };

  const [rateTarget, setRateTarget]   = useState(null);
  const [ratingVal, setRatingVal]     = useState('good');
  const [ratingNotes, setRatingNotes] = useState('');
  const [ratingSaving, setRatingSaving] = useState(false);
  const [ratingMsg, setRatingMsg]     = useState('');

  const [dispoTarget, setDispoTarget] = useState(null);
  const [dispoVal, setDispoVal]       = useState('sale');
  const [dispoNotes, setDispoNotes]   = useState('');
  const [dispoSaving, setDispoSaving] = useState(false);
  const [dispoMsg, setDispoMsg]       = useState('');

  const handleRateCall = async () => {
    setRatingSaving(true);
    try {
      await client.post(`reviews/transfer/${rateTarget.id}/review`, { rating: ratingVal, notes: ratingNotes });
      setRateTarget(null);
    } catch (err) {
      setRatingMsg(err.response?.data?.error || 'Failed to save rating');
    } finally {
      setRatingSaving(false);
    }
  };

  const handleSetDispo = async () => {
    setDispoSaving(true);
    try {
      await client.post(`reviews/transfer/${dispoTarget.id}/dispo`, { disposition: dispoVal, notes: dispoNotes });
      setDispoTarget(null);
    } catch (err) {
      setDispoMsg(err.response?.data?.error || 'Failed to save disposition');
    } finally {
      setDispoSaving(false);
    }
  };

  // ── My Sales (for closer_manager who also sells) ──────────────────────────
  const [saleModalOpen, setSaleModalOpen] = useState(false);
  const [saleTransfer, setSaleTransfer]   = useState(null);
  const [saleLoading, setSaleLoading]     = useState(false);
  const [saleError, setSaleError]         = useState('');
  const [saleSuccess, setSaleSuccess]     = useState('');

  const handleDateChange = (range) => {
    setDateRange(range);
    setXferPage(1);
    setSalesPage(1);
    setActivityPage(1);
  };

  const fetchActivityLogs = useCallback(async () => {
    if (!companyId) return;
    setActivityLoading(true);
    try {
      const params = { company_id: companyId, page: activityPage, limit: PAGE_SIZE, date_from, date_to };
      if (activityAgent) params.user_id = activityAgent;
      const res = await client.get('activity-logs', { params });
      setActivityLogs(res.data.logs || []);
      setActivityTotal(res.data.total || 0);
    } catch { /* non-critical */ } finally {
      setActivityLoading(false);
    }
  }, [companyId, activityPage, activityAgent, date_from, date_to]);

  const xferToday = todayET();

  const fetchXferTab = useCallback(async () => {
    if (!companyId) return;
    setXferTabLoading(true);
    try {
      const params = {
        company_id: companyId, page: xferPage, limit: PAGE_SIZE,
        date_from: xferTodayOnly ? xferToday : date_from,
        date_to:   xferTodayOnly ? xferToday : date_to,
      };
      if (xferStatus) params.status  = xferStatus;
      if (xferAgent)  params.user_id = xferAgent;
      if (xferSearch) params.search  = xferSearch;
      const res = await client.get('transfers', { params });
      setXferTabRows(res.data.transfers || []);
      setXferTabTotal(res.data.total    || 0);
    } catch {} finally { setXferTabLoading(false); }
  }, [companyId, xferPage, xferStatus, xferAgent, xferSearch, date_from, date_to, xferTodayOnly, xferToday]);

  const fetchSalesTab = useCallback(async () => {
    if (!companyId) return;
    setSalesTabLoading(true);
    try {
      const params = { company_id: companyId, page: salesPage, limit: PAGE_SIZE, date_from, date_to };
      if (salesStatus) params.status  = salesStatus;
      if (salesAgent)  params.user_id = salesAgent;
      if (salesSearch) params.search  = salesSearch;
      const res = await client.get('sales', { params });
      setSalesTabRows(res.data.sales || []);
      setSalesTabTotal(res.data.total || 0);
    } catch {} finally { setSalesTabLoading(false); }
  }, [companyId, salesPage, salesStatus, salesAgent, salesSearch, date_from, date_to]);

  const loadOverview = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      // Leaderboard data + accurate total counts — all parallel
      const [tRes, sRes, soldRes, wonRes, pendingRes] = await Promise.all([
        client.get('transfers', { params: { company_id: companyId, limit: 1000, date_from, date_to } }),
        client.get('sales',     { params: { company_id: companyId, limit: 1000, date_from, date_to } }),
        client.get('sales',     { params: { company_id: companyId, limit: 1, page: 1, date_from, date_to, status: 'sold' } }),
        client.get('sales',     { params: { company_id: companyId, limit: 1, page: 1, date_from, date_to, status: 'closed_won' } }),
        client.get('sales',     { params: { company_id: companyId, limit: 1, page: 1, date_from, date_to, status: 'pending_review' } }),
      ]);

      const allT = tRes.data.transfers || [];
      const allS = sRes.data.sales     || [];

      setOverviewTotals({
        transfers:     tRes.data.total || 0,
        sales:         sRes.data.total || 0,
        approved:      (soldRes.data.total || 0) + (wonRes.data.total || 0),
        pendingReview: pendingRes.data.total || 0,
      });

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
    } catch { /* non-critical */ } finally {
      setLoading(false);
    }
  }, [companyId, date_from, date_to]);

  useEffect(() => { loadOverview(); }, [loadOverview]);
  useEffect(() => { fetchTransfers({ date_from, date_to }); }, [fetchTransfers, date_from, date_to]);
  useEffect(() => { fetchSales({ date_from, date_to }); },     [fetchSales, date_from, date_to]);
  useEffect(() => { if (activeTab === 'activity_log') fetchActivityLogs(); }, [activeTab, fetchActivityLogs]);
  useEffect(() => { if (activeTab === 'transfers')  fetchXferTab();  }, [activeTab, fetchXferTab]);
  useEffect(() => { if (activeTab === 'team_sales') fetchSalesTab(); }, [activeTab, fetchSalesTab]);
  useEffect(() => {
    if (!companyId) return;
    client.get('users', { params: { company_id: companyId } })
      .then(r => setCompanyAgents(r.data.users || []))
      .catch(() => {});
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    const t = new Date().toISOString().split('T')[0];
    client.get('transfers', { params: { company_id: companyId, date_from: t, date_to: t, limit: 1, page: 1 } })
      .then(r => setXferTodayCount(r.data.total ?? 0))
      .catch(() => {});
  }, [companyId]);

  const handleLogout = () => { logout(); navigate('/login'); };

  const handleSaleSubmit = async (formData) => {
    setSaleLoading(true);
    setSaleError('');
    try {
      await createSale(formData);
      setSaleModalOpen(false);
      setSaleSuccess('Sale created!');
      setTimeout(() => setSaleSuccess(''), 5000);
    } catch (err) {
      setSaleError(err.response?.data?.errors?.map(e => e.msg).join(', ') || err.response?.data?.error || 'Failed');
    } finally {
      setSaleLoading(false);
    }
  };

  const pagedTransfers    = transfers.slice((xferPage - 1) * PAGE_SIZE, xferPage * PAGE_SIZE);
  const pagedSales        = sales.slice((salesPage - 1) * PAGE_SIZE, salesPage * PAGE_SIZE);

  return (
    <div className={`min-h-screen bg-bg ${user?.role === 'superadmin' ? '' : 'bsx-no-select'}`}>
      {updateAvailable && <UpdateBanner />}
      <AppHeader
        title={user?.role_name || 'Manager Dashboard'}
        logo={<div className="w-10 h-10 bg-gradient-sidebar rounded-lg flex items-center justify-center">
          <TrendingUp className="text-white" size={22} />
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

      <EngagementBanners />
      {activeNav !== 'dashboard' && <CrossRoleContent section={activeNav} user={user} />}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8"
        style={{ display: activeNav !== 'dashboard' ? 'none' : undefined }}>

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8 animate-fade-in">
          <div>
            <h2 className="text-3xl font-bold mb-1 text-text">Welcome back, {user?.first_name || user?.email}!</h2>
            <p className="text-text-secondary"><strong>{user?.role_name || user?.role}</strong> at <strong>{user?.company_name}</strong></p>
          </div>
          <div className="flex items-center gap-2">
            {isMgrActionVisible('export') && (
              <button onClick={() => setExportOpen(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all hover:opacity-90"
                style={{ background: 'var(--gradient-sidebar)' }}>
                <FileSpreadsheet size={16} /> Export
              </button>
            )}
            <button onClick={loadOverview} className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-semibold transition-all hover:bg-bg-secondary"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
              <RefreshCw size={16} /> Refresh
            </button>
          </div>
        </div>

        {exportOpen && <ManagerExportModal onClose={() => setExportOpen(false)} agents={companyAgents} />}

        {/* Tab bar */}
        <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
          <div className="flex gap-1 p-1 rounded-xl overflow-x-auto"
            style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            {TABS.map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150 whitespace-nowrap flex-shrink-0"
                style={{
                  background: activeTab === tab.key ? 'var(--gradient-sidebar)' : 'transparent',
                  color: activeTab === tab.key ? 'white' : 'var(--color-text-secondary)',
                  boxShadow: activeTab === tab.key ? 'var(--shadow-sm)' : 'none',
                }}>
                <tab.icon size={15} />{tab.label}
              </button>
            ))}
          </div>
          {isMgrFilterVisible('date_range') && (
            <DateRangePicker onChange={handleDateChange} defaultPreset="today" />
          )}
        </div>

        {/* ── OVERVIEW TAB ── */}
        {activeTab === 'overview' && (
          <div className="space-y-6">

            <SpiffWidget />

            {/* ── Stat cards ── */}
            {/* Drill-down: each card's onClick now ALSO synchronizes the
                destination tab's filter so the list count matches the card's
                number. Total Sales clears any residual status filter; Approved
                and Awaiting Review pre-apply the matching status. Previously a
                stale filter from the last visit could hide records the user
                expected to see. */}
            {/* Triple-segment cards — Today / MTD / Total each clickable.
                Today + Month come from useDashboardStats; Total uses the
                pre-existing overviewTotals so the manager's company-scoped
                aggregate stays correct even before stats hook loads. */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {isMgrCardVisible('transfers') && (
              <StatCardTriple
                label={mgrCardLabel('transfers', 'Total Transfers')}  icon={Send}        color="info"
                loading={loading || !stats}
                today={{ value: stats?.todayTransfers || 0, onClick: () => { setXferStatus?.(''); setXferPage?.(1); setDateRange(getPresetRange('today')); setActiveTab('transfers'); } }}
                month={{ value: stats?.monthTransfers || 0, onClick: () => { setXferStatus?.(''); setXferPage?.(1); setDateRange(getPresetRange('month')); setActiveTab('transfers'); } }}
                total={{ value: overviewTotals.transfers   , onClick: () => { setXferStatus?.(''); setXferPage?.(1); setDateRange(getPresetRange('all'));   setActiveTab('transfers'); } }}
                caption={overviewTotals.transfers > 0 && overviewTotals.sales > 0 ? `${Math.round((overviewTotals.sales / overviewTotals.transfers) * 100)}% → sales` : null}
              />
              )}
              {isMgrCardVisible('sales') && (
              <StatCardTriple
                label={mgrCardLabel('sales', 'Total Sales')}      icon={DollarSign}  color="success"
                loading={loading || !stats}
                today={{ value: stats?.todaySales || 0, onClick: () => { setSalesStatus(''); setSalesAgent?.(''); setSalesPage(1); setDateRange(getPresetRange('today')); setActiveTab('team_sales'); } }}
                month={{ value: stats?.monthSales || 0, onClick: () => { setSalesStatus(''); setSalesAgent?.(''); setSalesPage(1); setDateRange(getPresetRange('month')); setActiveTab('team_sales'); } }}
                total={{ value: overviewTotals.sales      , onClick: () => { setSalesStatus(''); setSalesAgent?.(''); setSalesPage(1); setDateRange(getPresetRange('all'));   setActiveTab('team_sales'); } }}
                caption={overviewTotals.sales > 0 ? `${overviewTotals.approved} approved` : null}
              />
              )}
              {isMgrCardVisible('approved') && (
              <StatCardTriple
                label={mgrCardLabel('approved', 'Approved')}         icon={CheckCircle} color="success"
                loading={loading || !stats}
                today={{ value: stats?.todayClosedWon || 0, onClick: () => { setSalesStatus('closed_won'); setSalesPage(1); setDateRange(getPresetRange('today')); setActiveTab('team_sales'); } }}
                month={{ value: stats?.monthClosedWon || 0, onClick: () => { setSalesStatus('closed_won'); setSalesPage(1); setDateRange(getPresetRange('month')); setActiveTab('team_sales'); } }}
                total={{ value: overviewTotals.approved   , onClick: () => { setSalesStatus('closed_won'); setSalesPage(1); setDateRange(getPresetRange('all'));   setActiveTab('team_sales'); } }}
                caption={overviewTotals.sales > 0 ? `${Math.round((overviewTotals.approved / overviewTotals.sales) * 100)}% win rate` : null}
              />
              )}
              {isMgrCardVisible('awaiting_review') && (
              <StatCardTriple
                label={mgrCardLabel('awaiting_review', 'Awaiting Review')}  icon={Clock}       color="warning"
                loading={loading || !stats}
                total={{ value: overviewTotals.pendingReview, onClick: () => { setSalesStatus('pending_review'); setSalesPage(1); setActiveTab('team_sales'); }, title: 'Show pending-review sales' }}
                caption={overviewTotals.pendingReview > 0 ? 'needs action' : 'all clear'}
              />
              )}
              {isMgrCardVisible('cancelled') && (
              <StatCardTriple
                label={mgrCardLabel('cancelled', 'Cancelled')}        icon={XCircle}     color="error"
                loading={loading || !stats}
                today={{ value: stats?.todayCancelled || 0, onClick: () => { setSalesStatus('cancelled'); setSalesPage(1); setDateRange(getPresetRange('today')); setActiveTab('team_sales'); } }}
                month={{ value: stats?.monthCancelled || 0, onClick: () => { setSalesStatus('cancelled'); setSalesPage(1); setDateRange(getPresetRange('month')); setActiveTab('team_sales'); } }}
                total={{ value: stats?.cancelledSales || 0, onClick: () => { setSalesStatus('cancelled'); setSalesPage(1); setDateRange(getPresetRange('all'));   setActiveTab('team_sales'); } }}
              />
              )}
              {isMgrCardVisible('resells') && (
              <StatCardTriple
                label={mgrCardLabel('resells', 'Resells')}          icon={RefreshCw}
                accent="#8b5cf6" gradientFrom="#ede9fe" color="primary"
                loading={loading || !stats}
                month={{ value: stats?.resellsThisMonth || 0, onClick: () => { setSalesStatus(''); setSalesAgent?.(''); setSalesPage(1); setDateRange(getPresetRange('month')); setActiveTab('team_sales'); }, title: 'Resells this month' }}
                total={{ value: stats?.resellsTotal     || 0, onClick: () => { setSalesStatus(''); setSalesAgent?.(''); setSalesPage(1); setDateRange(getPresetRange('all'));   setActiveTab('team_sales'); }, title: 'All resells' }}
                caption={(stats?.resellsTotal || 0) > 0 ? `${stats.resellsTotal} all-time` : 'no resells yet'}
              />
              )}
              {/* Dup Attempts — fronter re-submitted an existing phone. */}
              {isMgrCardVisible('dup_attempts') && (
              <StatCardTriple
                label={mgrCardLabel('dup_attempts', 'Dup Attempts')}     icon={Copy}        color="warning"
                loading={loading || !stats}
                today={{ value: stats?.dupToday || 0, title: 'Duplicate attempts today (refresh + reengage + sale_overlap)' }}
                month={{ value: stats?.dupMonth || 0, title: 'Duplicate attempts this month' }}
                total={{ value: stats?.dupTotal || 0, title: 'All-time duplicate attempts' }}
                caption="refresh · reengage · overlap"
              />
              )}
            </div>

            {/* ── Conversion funnel ── */}
            {!loading && overviewTotals.transfers > 0 && (
              <Card className="px-6 py-4">
                <div className="flex items-center gap-4 flex-wrap sm:flex-nowrap">
                  <p className="text-xs font-bold uppercase tracking-widest whitespace-nowrap" style={{ color: 'var(--color-text-tertiary)' }}>
                    Funnel
                  </p>
                  <div className="flex-1 flex items-center">
                    {/* Step: Transfers */}
                    <div className="flex flex-col items-center flex-1">
                      <p className="text-xl font-black text-info-600">{overviewTotals.transfers}</p>
                      <p className="text-[11px] text-text-secondary font-medium">Transfers</p>
                    </div>
                    {/* Arrow 1 */}
                    <div className="flex flex-col items-center px-1">
                      <span className="text-[10px] font-bold" style={{ color: 'var(--color-text-tertiary)' }}>
                        {overviewTotals.transfers > 0 ? `${Math.round((overviewTotals.sales / overviewTotals.transfers) * 100)}%` : '—'}
                      </span>
                      <div className="flex items-center gap-0.5">
                        <div className="h-px w-6 sm:w-10" style={{ backgroundColor: 'var(--color-border)' }} />
                        <ArrowRight size={12} style={{ color: 'var(--color-text-tertiary)' }} />
                      </div>
                    </div>
                    {/* Step: Sales */}
                    <div className="flex flex-col items-center flex-1">
                      <p className="text-xl font-black text-success-600">{overviewTotals.sales}</p>
                      <p className="text-[11px] text-text-secondary font-medium">Sales</p>
                    </div>
                    {/* Arrow 2 */}
                    <div className="flex flex-col items-center px-1">
                      <span className="text-[10px] font-bold" style={{ color: 'var(--color-text-tertiary)' }}>
                        {overviewTotals.sales > 0 ? `${Math.round((overviewTotals.approved / overviewTotals.sales) * 100)}%` : '—'}
                      </span>
                      <div className="flex items-center gap-0.5">
                        <div className="h-px w-6 sm:w-10" style={{ backgroundColor: 'var(--color-border)' }} />
                        <ArrowRight size={12} style={{ color: 'var(--color-text-tertiary)' }} />
                      </div>
                    </div>
                    {/* Step: Approved */}
                    <div className="flex flex-col items-center flex-1">
                      <p className="text-xl font-black" style={{ color: 'var(--color-success-700, #15803d)' }}>{overviewTotals.approved}</p>
                      <p className="text-[11px] text-text-secondary font-medium">Approved</p>
                    </div>
                    {/* Pending wedge */}
                    {overviewTotals.pendingReview > 0 && (
                      <>
                        <div className="flex flex-col items-center px-1">
                          <span className="text-[10px] font-bold text-warning-500">+{overviewTotals.pendingReview}</span>
                          <div className="flex items-center gap-0.5">
                            <div className="h-px w-6 sm:w-10" style={{ backgroundColor: 'var(--color-warning-200)' }} />
                            <ArrowRight size={12} className="text-warning-400" />
                          </div>
                        </div>
                        <div className="flex flex-col items-center flex-1">
                          <p className="text-xl font-black text-warning-600">{overviewTotals.pendingReview}</p>
                          <p className="text-[11px] text-text-secondary font-medium">In Review</p>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </Card>
            )}

            {/* ── Leaderboards ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* Fronter leaderboard */}
              {hasPermission('view_fronter_stats') && (
                <Card className="p-6">
                  <div className="flex items-center justify-between mb-5">
                    <h3 className="text-base font-bold text-text flex items-center gap-2">
                      <BarChart3 size={16} /> Fronter Leaderboard
                    </h3>
                    {!loading && fronterLb.length > 0 && (
                      <span className="text-xs text-text-tertiary">{fronterLb.length} agents</span>
                    )}
                  </div>
                  {loading
                    ? <div className="space-y-1">{[1,2,3,4].map(i => <SkeletonLeaderRow key={i} />)}</div>
                    : fronterLb.length === 0
                      ? (
                        <div className="flex flex-col items-center py-8 gap-2">
                          <Send size={28} className="text-text-tertiary opacity-40" />
                          <p className="text-sm text-text-secondary">No transfers in this period.</p>
                        </div>
                      )
                      : fronterLb.slice(0, 8).map((f, i) => {
                          const maxT    = fronterLb[0]?.transfers || 1;
                          const pct     = Math.round((f.transfers / maxT) * 100);
                          const convPct = f.transfers > 0 ? Math.round((f.completed / f.transfers) * 100) : 0;
                          return (
                            <div key={f.id} className="flex items-center gap-3 py-2.5 border-b last:border-0" style={{ borderColor: 'var(--color-border)' }}>
                              {/* Rank badge */}
                              <div className="w-5 flex-shrink-0 flex items-center justify-center">
                                {i < 3
                                  ? <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black text-white"
                                      style={{ backgroundColor: MEDAL_COLORS[i] }}>{i + 1}</div>
                                  : <span className="text-xs font-bold text-text-tertiary">{i + 1}</span>
                                }
                              </div>
                              {/* Avatar */}
                              <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0"
                                style={{ backgroundColor: getAvatarColor(f.name) }}>
                                {getInitials(f.name)}
                              </div>
                              {/* Name + bar */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-sm font-semibold text-text truncate">{f.name}</span>
                                  <span className="text-xs text-text-secondary ml-2 flex-shrink-0">{f.transfers} leads</span>
                                </div>
                                <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-border)' }}>
                                  <div className="h-full rounded-full transition-all duration-500"
                                    style={{ width: `${pct}%`, background: 'var(--gradient-sidebar)' }} />
                                </div>
                              </div>
                              {/* Stats */}
                              <div className="text-right flex-shrink-0 w-16">
                                <p className="text-xs font-bold text-success-600">{f.completed} <span className="font-normal text-text-tertiary">closed</span></p>
                                <p className="text-[10px] text-text-tertiary">{convPct}% conv</p>
                              </div>
                            </div>
                          );
                        })
                  }
                </Card>
              )}

              {/* Closer leaderboard */}
              {hasPermission('view_closer_stats') && (
                <Card className="p-6">
                  <div className="flex items-center justify-between mb-5">
                    <h3 className="text-base font-bold text-text flex items-center gap-2">
                      <TrendingUp size={16} /> Closer Leaderboard
                    </h3>
                    {!loading && closerLb.length > 0 && (
                      <span className="text-xs text-text-tertiary">{closerLb.length} closers</span>
                    )}
                  </div>
                  {loading
                    ? <div className="space-y-1">{[1,2,3,4].map(i => <SkeletonLeaderRow key={i} />)}</div>
                    : closerLb.length === 0
                      ? (
                        <div className="flex flex-col items-center py-8 gap-2">
                          <DollarSign size={28} className="text-text-tertiary opacity-40" />
                          <p className="text-sm text-text-secondary">No sales in this period.</p>
                        </div>
                      )
                      : closerLb.slice(0, 8).map((c, i) => {
                          const maxW   = closerLb[0]?.won || 1;
                          const pct    = Math.round((c.won / maxW) * 100);
                          const winPct = c.sales > 0 ? Math.round((c.won / c.sales) * 100) : 0;
                          return (
                            <div key={c.id} className="flex items-center gap-3 py-2.5 border-b last:border-0" style={{ borderColor: 'var(--color-border)' }}>
                              {/* Rank badge */}
                              <div className="w-5 flex-shrink-0 flex items-center justify-center">
                                {i < 3
                                  ? <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black text-white"
                                      style={{ backgroundColor: MEDAL_COLORS[i] }}>{i + 1}</div>
                                  : <span className="text-xs font-bold text-text-tertiary">{i + 1}</span>
                                }
                              </div>
                              {/* Avatar */}
                              <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0"
                                style={{ backgroundColor: getAvatarColor(c.name) }}>
                                {getInitials(c.name)}
                              </div>
                              {/* Name + bar */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-sm font-semibold text-text truncate">{c.name}</span>
                                  <span className="text-xs text-text-secondary ml-2 flex-shrink-0">{c.sales} sales</span>
                                </div>
                                <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-border)' }}>
                                  <div className="h-full rounded-full transition-all duration-500"
                                    style={{ width: `${pct}%`, background: 'linear-gradient(135deg,#16a34a,#15803d)' }} />
                                </div>
                              </div>
                              {/* Stats */}
                              <div className="text-right flex-shrink-0 w-20">
                                {hasPermission('view_financial_data') && c.monthly > 0
                                  ? <p className="text-xs font-bold text-primary-600">${c.monthly.toLocaleString()}<span className="text-[10px] text-text-tertiary font-normal">/mo</span></p>
                                  : <p className="text-xs font-bold text-success-600">{c.won} <span className="font-normal text-text-tertiary">won</span></p>
                                }
                                <p className="text-[10px] text-text-tertiary">{winPct}% win rate</p>
                              </div>
                            </div>
                          );
                        })
                  }
                </Card>
              )}
            </div>
          </div>
        )}

        {/* ── TEAM TRANSFERS TAB ── */}
        {activeTab === 'transfers' && (
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h3 className="text-xl font-bold text-text flex items-center gap-2"><Send size={20} /> Team Transfers</h3>
              <span className="text-sm text-text-secondary">{xferTabTotal} total</span>
            </div>

            {/* Today chip */}
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <button
                onClick={() => { setXferTodayOnly(v => !v); setXferPage(1); }}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all"
                style={{
                  backgroundColor: xferTodayOnly ? '#eff6ff' : 'var(--color-bg-secondary)',
                  color:            xferTodayOnly ? '#2563eb' : 'var(--color-text-secondary)',
                  borderColor:      xferTodayOnly ? '#bfdbfe' : 'var(--color-border)',
                }}>
                <CalendarDays size={12} />
                Created Today
                {xferTodayCount !== null && (
                  <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold"
                    style={{ backgroundColor: xferTodayOnly ? '#bfdbfe' : 'var(--color-border)', color: xferTodayOnly ? '#1d4ed8' : 'var(--color-text-secondary)' }}>
                    {xferTodayCount}
                  </span>
                )}
                {xferTodayOnly && <XCircle size={10} />}
              </button>
            </div>

            {/* Unified FilterBar — shared chrome across every shell list */}
            <FilterBar
              search={{
                value: xferSearch,
                onChange: (v) => { setXferSearch(v); setXferPage(1); },
                placeholder: 'Search customer / phone…',
              }}
              statusPills={
                <TransferStatusFilterPills
                  value={xferStatus}
                  onChange={(k) => { setXferStatus(k); setXferPage(1); }}
                />
              }
              extras={isMgrFilterVisible('agent_select') && companyAgents.length > 0 && (
                <select value={xferAgent} onChange={e => { setXferAgent(e.target.value); setXferPage(1); }}
                  className="input text-xs h-auto" style={{ minWidth: 160, paddingTop: 6, paddingBottom: 6 }}>
                  <option value="">All agents</option>
                  {companyAgents.map(a => (
                    <option key={a.user_id} value={a.user_id}>{a.first_name} {a.last_name}</option>
                  ))}
                </select>
              )}
              onClearAll={() => { setXferSearch(''); setXferStatus(''); setXferAgent(''); setXferPage(1); }}
            />

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
                        {['Customer', 'Phone', 'Fronter', 'Closer', 'Status', 'Disposition', 'Date', 'Action'].map(h => (
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
                          <td className="py-3 px-3 text-text-secondary text-xs">{t.fronter_name || '—'}</td>
                          <td className="py-3 px-3 text-text-secondary text-xs">{t.closer ? `${t.closer.first_name || ''} ${t.closer.last_name || ''}`.trim() || '—' : '—'}</td>
                          <td className="py-3 px-3">{(() => { const ds = getTransferDisplayStatus(t); return <Badge variant={ds.variant} size="sm">{ds.label}</Badge>; })()}</td>
                          <td className="py-3 px-3">
                            {(t.latest_disposition || t.sale_closer_disposition) ? (() => {
                              const d = t.latest_disposition;
                              const name  = d?.disposition_name || t.sale_closer_disposition;
                              const color = d?.color || '#6b7280';
                              return (
                                <div className="flex flex-col gap-0.5">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold w-fit"
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
                            })() : <span className="text-text-tertiary text-xs">—</span>}
                          </td>
                          <td className="py-3 px-3 text-text-secondary text-xs">{fmtDateET(t.created_at)}</td>
                          <td className="py-3 px-3">
                            <div className="flex flex-wrap gap-1">
                              {user?.role !== 'fronter_manager' && hasPermission('submit_call_review') && (
                                <button onClick={e => { e.stopPropagation(); setRateTarget(t); setRatingVal('good'); setRatingNotes(''); setRatingMsg(''); }}
                                  className="px-2 py-1.5 rounded-lg text-xs font-semibold border"
                                  style={{ borderColor: 'var(--color-primary-300)', color: 'var(--color-primary-600)' }}>
                                  <Star size={11} className="inline mr-1" />Rate
                                </button>
                              )}
                              {user?.role !== 'fronter_manager' && hasPermission('submit_call_dispo') && (
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

            <FilterBar
              search={{
                value: salesSearch,
                onChange: (v) => { setSalesSearch(v); setSalesPage(1); },
                placeholder: 'Search customer / phone / reference…',
              }}
              statusPills={
                <SaleStatusFilterPills
                  value={salesStatus}
                  onChange={(k) => { setSalesStatus(k); setSalesPage(1); }}
                />
              }
              extras={isMgrFilterVisible('agent_select') && companyAgents.length > 0 && (
                <select value={salesAgent} onChange={e => { setSalesAgent(e.target.value); setSalesPage(1); }}
                  className="input text-xs h-auto" style={{ minWidth: 160, paddingTop: 6, paddingBottom: 6 }}>
                  <option value="">All agents</option>
                  {companyAgents.map(a => (
                    <option key={a.user_id} value={a.user_id}>{a.first_name} {a.last_name}</option>
                  ))}
                </select>
              )}
              onClearAll={() => { setSalesSearch(''); setSalesStatus(''); setSalesAgent(''); setSalesPage(1); }}
            />

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
                        {['Customer', 'Reference', 'Status', 'Fronter', 'Closer', hasPermission('view_financial_data') ? 'Monthly' : null, 'Sale Date', hasPermission('delete_sale') ? 'Action' : null].filter(Boolean).map(h => (
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
                          <td className="py-3 px-3"><div className="flex items-center gap-1.5 flex-wrap"><SaleStatusBadge sale={s} size="sm" />{s.is_resell && <span title={`Resell · ${s.resell_intent || ''}`} className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded whitespace-nowrap" style={{ backgroundColor: '#ddd6fe', color: '#5b21b6' }}>↻ {(s.resell_intent || 'resell').replace(/_/g, ' ')}</span>}</div></td>
                          <td className="py-3 px-3 text-text-secondary text-xs">{s.fronter_name || '—'}</td>
                          <td className="py-3 px-3 text-text-secondary text-xs">{s.closer_name || '—'}</td>
                          {hasPermission('view_financial_data') && <td className="py-3 px-3 text-xs font-semibold text-success-600">{s.monthly_payment ? `$${s.monthly_payment}/mo` : '—'}</td>}
                          {/* Show the actual sale_date (carried in the bulk upload) rather
                              than the row's created_at — created_at reflects when the row
                              was inserted/updated, which is misleading for back-filled sales. */}
                          {/* sale_date is a date-only column ("YYYY-MM-DD"). fmtSaleDate
                              prints it as the calendar day stored, never shifting one
                              day backward in US timezones the way fmtDateET would. */}
                          <td className="py-3 px-3 text-text-secondary text-xs">{s.sale_date ? fmtSaleDate(s.sale_date) : fmtDateET(s.created_at)}</td>
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

        {/* ── ACTIVITY LOG TAB ── */}
        {activeTab === 'activity_log' && (
          <Card className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h3 className="text-xl font-bold text-text flex items-center gap-2"><Activity size={20} /> Activity Log</h3>
              {companyAgents.length > 0 && (
                <select
                  value={activityAgent}
                  onChange={e => { setActivityAgent(e.target.value); setActivityPage(1); }}
                  className="input py-1.5 text-sm h-auto" style={{ minWidth: 160 }}>
                  <option value="">All agents</option>
                  {companyAgents.map(a => (
                    <option key={a.user_id} value={a.user_id}>
                      {`${a.first_name || ''} ${a.last_name || ''}`.trim() || a.email || ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {activityLoading ? (
              <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
            ) : activityLogs.length === 0 ? (
              <p className="text-text-secondary text-center py-8">No activity yet.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        {['Actor', 'Action', 'Customer', 'Change', 'Date'].map(h => (
                          <th key={h} className="text-left py-3 px-3 text-xs font-semibold text-text-secondary uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {activityLogs.map(log => (
                        <tr key={log.id} className="border-b border-border hover:bg-bg-secondary">
                          <td className="py-3 px-3 font-semibold text-text text-sm">
                            {log.actor ? `${log.actor.first_name || ''} ${log.actor.last_name || ''}`.trim() || '—' : '—'}
                            {log.metadata?.manager_override && (
                              <span className="ml-1.5 px-1.5 py-0.5 text-xs rounded font-bold bg-warning-100 text-warning-700">Mgr</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-xs text-text-secondary capitalize">{log.action?.replace(/_/g, ' ')}</td>
                          <td className="py-3 px-3 text-xs text-text-secondary">{log.metadata?.customer_name || '—'}</td>
                          <td className="py-3 px-3 text-xs">
                            {log.old_value?.disposition && (
                              <span className="text-text-tertiary">{log.old_value.disposition} → </span>
                            )}
                            <span className="font-semibold text-text">{log.new_value?.disposition || '—'}</span>
                          </td>
                          <td className="py-3 px-3 text-xs text-text-tertiary">{fmtDateET(log.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination page={activityPage} total={activityTotal} pageSize={PAGE_SIZE} onChange={setActivityPage} />
              </>
            )}
          </Card>
        )}

        {/* ── PANEL TABS (reuse existing components) ── */}
        {activeTab === 'callbacks' && <ManagerCallbacksTab user={user} />}
        {activeTab === 'numbers'   && (
          <div className="space-y-6">
            {isEnabled('callback_numbers') && <CallbackNumbers user={user} />}
            {isEnabled('number_assignment') && hasPermission('manage_callback_numbers') && <NumberUploadManager companyId={companyId} />}
          </div>
        )}
        {activeTab === 'search'    && <SaleSearch />}
        {activeTab === 'faqs'      && (hasPermission('manage_faqs') ? <FAQManager /> : <FAQPanel />)}
        {activeTab === 'scripts'   && (hasPermission('manage_faqs') ? <ScriptManager /> : <ScriptPanel />)}
        {activeTab === 'calendar'  && <EventsCalendar canEdit={false} />}
        {activeTab === 'team'      && <TeamManagementPanel companyId={companyId} />}
        {activeTab === 'roles'     && <RoleManagementPanel companyId={companyId} />}
        {activeTab === 'reviews'   && <ReviewsPanel companyId={companyId} />}
        {activeTab === 'reports'   && <ReportsPanel companyId={companyId} />}
        {activeTab === 'forms'     && (
          <div className="animate-fade-in">
            <Suspense fallback={<div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>}>
              <FormBuilder />
            </Suspense>
          </div>
        )}
        {activeTab === 'spiffs'    && (
          <Suspense fallback={<div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>}>
            <SpiffManager />
          </Suspense>
        )}
        <DevCredit />
      </main>

      <SaleModal isOpen={saleModalOpen} onClose={() => setSaleModalOpen(false)}
        user={user} transfer={saleTransfer} onSubmit={handleSaleSubmit} isLoading={saleLoading} />

      {/* Rate Call modal */}
      {rateTarget && (
        <div className="fixed inset-0 z-50 overflow-y-auto" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="flex min-h-full items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl p-6 shadow-2xl"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <h3 className="text-lg font-bold text-text mb-1 flex items-center gap-2"><Star size={18} style={{ color: '#f59e0b' }} /> Rate Call</h3>
            <p className="text-sm text-text-secondary mb-4">Customer: <strong>{rateTarget.form_data?.customer_name || rateTarget.form_data?.FirstName || 'Unknown'}</strong></p>
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

      {/* Set Dispo modal */}
      {dispoTarget && (
        <div className="fixed inset-0 z-50 overflow-y-auto" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="flex min-h-full items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl p-6 shadow-2xl"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <h3 className="text-lg font-bold text-text mb-1 flex items-center gap-2">
              <MessageSquare size={18} style={{ color: 'var(--color-primary-600)' }} /> Set Disposition
            </h3>
            <p className="text-sm text-text-secondary mb-4">Customer: <strong>{dispoTarget.form_data?.customer_name || dispoTarget.form_data?.FirstName || 'Unknown'}</strong></p>
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

      <TransferDetailDrawer transfer={detailTransfer} onClose={() => setDetailTransfer(null)} />
      <SaleDetailDrawer     sale={detailSale}         onClose={() => setDetailSale(null)} />
    </div>
  );
};

export default ManagerShell;
