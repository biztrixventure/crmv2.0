import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { usePersistedState } from "../hooks/usePersistedState";
import { toast } from "sonner";
import { toastError } from "../utils/toast";
import { useAuth } from "../contexts/AuthContext";
import { useVersionCheck } from "../hooks/useVersionCheck";
import UpdateBanner from "../components/UI/UpdateBanner";
import { useTheme } from "../contexts/ThemeContext";
import { useFeatureFlags } from "../contexts/FeatureFlagsContext";
import { useNavigate } from "react-router-dom";
import { vehicleFieldIssues } from "../utils/vehicleValidation";
import { smartFormat, isSuggestable, suggestionsFor, rememberValues } from "../utils/formAssist";
import { isCarMake, isCarModel, normalize as normalizeField, maxLengthFor } from "../utils/formFieldNorm";
import VehicleSelect from "../components/Form/VehicleSelect";
import CopyableNumber from "../components/UI/CopyableNumber";
import {
  DollarSign, Send, Phone, Hash, Search, Target, Clock,
  CheckCircle, XCircle, Plus, User, Car, Star, MessageSquare,
  Users, Shield, FileText, BarChart3, AlertTriangle, RefreshCw, CalendarPlus, Pencil, Trash2,
  ChevronLeft, ChevronRight, HelpCircle, CalendarDays, Copy,
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
import StatCardTriple from "../components/UI/StatCardTriple";
import SaleStatusBadge from "../components/UI/SaleStatusBadge";
import SaleStatusFilterPills from "../components/UI/SaleStatusFilterPills";
import TransferStatusFilterPills from "../components/UI/TransferStatusFilterPills";
import FilterBar from "../components/UI/FilterBar";
import DuplicateRecordsModal from "../components/Shared/DuplicateRecordsModal";
import DateRangePicker, { getPresetRange } from "../components/UI/DateRangePicker";
import { AppHeader } from "../components/Layout";
import { useDashboardStats } from "../hooks/useDashboardStats";
import { useShellLayout } from "../hooks/useShellLayout";
import { useTransfers } from "../hooks/useTransfers";
import { useSales } from "../hooks/useSales";
import { useNotifications } from "../hooks/useNotifications";
import { useFormFields } from "../hooks/useFormFields";
import { dispositionTabs, isPostDateDispo, prettyDispo } from "../utils/dispositions";
import { useSaleConfigs } from "../hooks/useSaleConfigs";
import PhoneSearch from "../components/Closer/PhoneSearch";
import { getTransferDisplayStatus } from "../utils/transferStatus";
import { fmtDateET, fmtSaleDate } from "../utils/timezone";
import SaleModal from "../components/Closer/SaleModal";
import CallbacksPage from "../components/Callbacks/CallbacksPage";
import CallbackNumbers from "../components/CallbackNumbers/CallbackNumbers";
import CallbacksOverview from "../components/Callbacks/CallbacksOverview";
import AssignedNumbersList from "../components/Numbers/AssignedNumbersList";
import SaleSearch from "../components/Sales/SaleSearch";
import FAQPanel from "../components/FAQ/FAQPanel";
import ScriptPanel from "../components/FAQ/ScriptPanel";
import EngagementBanners from "../components/Engagement/EngagementBanners";
import PendingFromDialer from "../components/Vicidial/PendingFromDialer";
import CloserPendingDispos from "../components/Vicidial/CloserPendingDispos";
import SpiffWidget from "../components/Engagement/SpiffWidget";
import CrossRoleContent from "../components/Navigation/CrossRoleContent";
import TransferDetailDrawer from "../components/Shared/TransferDetailDrawer";
import SaleDetailDrawer from "../components/Shared/SaleDetailDrawer";
import client from "../api/client";
import DevCredit from "../components/DevCredit";

const TRANSFER_BADGE = { pending: 'warning', assigned: 'info', completed: 'success', cancelled: 'error', rejected: 'error' };

// Closer-facing transfer status — the raw lifecycle keys are ambiguous from the
// closer's seat ("pending" / "completed" mean little). Map each to a plain label
// + one-line meaning shown as a tooltip so the closer knows exactly what to do.
const TRANSFER_STATUS_INFO = {
  pending:   { label: 'Awaiting assignment', desc: 'Lead created but not yet assigned to a closer.' },
  assigned:  { label: 'Ready to work',       desc: 'Assigned to you — convert it to a sale or reject it.' },
  completed: { label: 'Converted to sale',   desc: 'You already created a sale from this lead.' },
  rejected:  { label: 'Rejected',            desc: 'Sent back as not a valid/workable lead.' },
  cancelled: { label: 'Cancelled',           desc: 'This lead was cancelled.' },
};
const transferStatusInfo = (st) => TRANSFER_STATUS_INFO[st] || { label: (st || '—').replace(/_/g, ' '), desc: '' };

// Short, safe date formatter for card chips.
const fmtCardDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
};
// Pull a "Year Make Model" string out of a transfer's form_data, if present.
const transferVehicle = (fd) => {
  if (!fd) return '';
  const y = fd.CarYear || fd.car_year || fd.Year || '';
  const mk = fd.CarMake || fd.car_make || fd.Make || '';
  const md = fd.CarModel || fd.car_model || fd.Model || '';
  return [y, mk, md].filter(Boolean).join(' ').trim();
};
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

// Per-card visual meta for the staff KPI cards. Labels / descriptions / which
// numbers show now come from the KPI catalog + SuperAdmin overrides; only the
// icon + color tints live here.
const STAFF_CARD_META = {
  my_sales:                { icon: DollarSign,   color: 'success' },
  approved:                { icon: CheckCircle,  color: 'primary' },
  cancelled:               { icon: XCircle,      color: 'error' },
  awaiting_review:         { icon: Clock,        color: 'warning' },
  returned:                { icon: AlertTriangle, color: 'error', accent: '#f97316', gradientFrom: '#fff7ed' },
  resells:                 { icon: RefreshCw,    color: 'primary', accent: '#8b5cf6', gradientFrom: '#ede9fe' },
  total_leads:             { icon: Send,         color: 'info' },
  fronter_approved:        { icon: CheckCircle,  color: 'success' },
  fronter_awaiting_review: { icon: Clock,        color: 'warning' },
};
const STAFF_CLOSER_CARDS  = ['my_sales', 'approved', 'cancelled', 'awaiting_review', 'returned', 'resells'];
const STAFF_FRONTER_CARDS = ['total_leads', 'fronter_approved', 'fronter_awaiting_review'];

const StaffShell = () => {
  const { user, logout, updateUser, hasPermission } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { isEnabled } = useFeatureFlags();
  const navigate = useNavigate();
  const updateAvailable = useVersionCheck();

  const isFronter  = user?.role === 'fronter' || (!hasPermission('create_sale') && hasPermission('create_transfer'));
  const isCloser   = user?.role === 'closer'  || hasPermission('create_sale');

  const defaultTab = isCloser ? 'sales' : isFronter ? 'transfers' : 'callbacks';
  // Per-role storage keys so closer/fronter state doesn't bleed across accounts.
  const tabKey = `biztrix.staffTab.${user?.role || 'default'}`;
  const navKey = `biztrix.staffNav.${user?.role || 'default'}`;
  const secKey = `biztrix.closerSection.${user?.role || 'default'}`;
  const [activeTab, setActiveTab] = usePersistedState(tabKey, defaultTab);
  const [activeNav, setActiveNav] = usePersistedState(navKey, 'dashboard');

  const { stats, loading: statsLoading, fetchStats } = useDashboardStats();
  const { transfers, total: transferTotal, loading: tLoading, fetchTransfers, createTransfer, deleteTransfer } = useTransfers(user?.company_id);
  const { sales, total: salesTotal, loading: sLoading, fetchSales, createSale, deleteSale } = useSales(user?.company_id);
  const { fields, fetchFields } = useFormFields();
  const { clients: saleClients, plans: salePlans, fetchConfigs } = useSaleConfigs(user?.company_id);
  const notifHook = useNotifications();

  const [dateRange, setDateRange] = useState(() => getPresetRange('today'));
  const { date_from, date_to } = dateRange;

  // Cross-role nav
  const crossNavItems = [
    { key: 'calendar', label: 'Calendar', icon: CalendarDays },
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
  const [xferSearch,     setXferSearch]     = useState('');
  const [xferPage,       setXferPage]       = useState(1);

  // ── Team Sales tab (rich server-side view) ───────────────────────────────
  const [salesTabRows,    setSalesTabRows]    = useState([]);
  const [salesTabTotal,   setSalesTabTotal]   = useState(0);
  const [salesTabLoading, setSalesTabLoading] = useState(false);
  const [salesStatus,     setSalesStatus]     = useState('');
  const [salesAgent,      setSalesAgent]      = useState('');
  const [salesSearch,     setSalesSearch]     = useState('');
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
  // When set, the create form is confirming a VICIdial pending transfer (fills
  // the existing pending row) instead of creating a brand-new transfer.
  const [pendingDialer, setPendingDialer] = useState(null);
  const [dialerRefresh, setDialerRefresh] = useState(0);
  const [dupOpen, setDupOpen] = useState(false);
  const [closerSection, setCloserSection]   = usePersistedState(secKey, 'assigned'); // 'assigned' | 'sales'

  // Vehicle registry — populates the CarMake / CarModel typeahead inside the
  // fronter's New Transfer modal. Fetched once on mount; cheap enough that we
  // don't gate it behind showCreateForm.
  const [vehicleTree, setVehicleTree] = useState([]);
  useEffect(() => {
    client.get('vehicles').then(r => setVehicleTree(r.data.makes || [])).catch(() => {});
  }, []);
  const vehicleMakes = vehicleTree.map(m => m.name);
  const vehicleModelsFor = (makeName) => {
    const mk = vehicleTree.find(m => m.name.toLowerCase() === String(makeName || '').toLowerCase());
    return (mk?.models || []).map(m => m.name);
  };

  // Report the most specific active context to the mascot: a cross-role section
  // (calendar/team/…), the closer's Assigned/My-Sales sub-toggle, or the active
  // dashboard tab (callbacks, transfers, faqs, …) — so guidance is tab-specific.
  useEffect(() => {
    let sec;
    if (activeNav !== 'dashboard') sec = activeNav;
    else if (activeTab === 'sales') sec = closerSection === 'assigned' ? 'closer_assigned' : 'my_sales';
    else sec = activeTab;
    window.crmAssistant?.setSection?.(sec);
  }, [activeNav, activeTab, closerSection]);
  const [transfersPage, setTransfersPage]   = useState(1);  // fronter My Leads + closer Assigned
  // Status filter for the fronter My Leads list — set when a KPI card is clicked
  // (e.g. "Completed" → only completed leads). '' = all. Drives fetchTransfers.
  const [myLeadsStatus, setMyLeadsStatus]   = useState('');
  const [closerSalesPage, setCloserSalesPage] = useState(1);
  const [leadSearchQ, setLeadSearchQ]       = useState(''); // debounced server search for leads
  const [formData, setFormData]             = useState({});
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [transferError, setTransferError]           = useState('');
  // Fronter-scoped duplicate detection (own history only)
  const [dupCheck, setDupCheck]             = useState(null); // { result, message, transfer, sale }
  const dupTimer       = useRef(null);
  const lastPrefilledId = useRef(null);

  // Which dynamic field holds the phone/CLI — drives the duplicate check.
  const phoneFieldName = (fields || []).find(f =>
    ['phone', 'tel'].includes(f.field_type) ||
    /(phone|cli|mobile|cell|contact|number)/i.test(f.name || '') ||
    /(phone|cli|mobile|cell)/i.test(f.label || ''))?.name;
  const phoneValue = phoneFieldName ? (formData[phoneFieldName] || '') : '';

  // Debounced check against THIS fronter's own transfers/sales only.
  useEffect(() => {
    if (!showCreateForm || !phoneFieldName) return;
    if (String(phoneValue).replace(/\D/g, '').length < 7) { setDupCheck(null); return; }
    clearTimeout(dupTimer.current);
    dupTimer.current = setTimeout(async () => {
      try {
        const { data } = await client.get('transfers/duplicate-check', { params: { phone: phoneValue } });
        if (data.result === 'clean') { setDupCheck(null); return; }
        setDupCheck(data);
        // Auto-load the previous transfer's fields once, for both refresh (Case A)
        // and re-engage (Case B). A completed-sale match never prefills.
        if ((data.result === 'refresh' || data.result === 'reengage') && data.transfer && lastPrefilledId.current !== data.transfer.id) {
          lastPrefilledId.current = data.transfer.id;
          setFormData(prev => ({ ...prev, ...(data.transfer.form_data || {}) }));
        }
      } catch { /* non-blocking */ }
    }, 500);
    return () => clearTimeout(dupTimer.current);
  }, [phoneValue, showCreateForm, phoneFieldName]); // eslint-disable-line react-hooks/exhaustive-deps
  const [zipFronterLoading, setZipFronterLoading]   = useState(false);
  const [zipFronterInfo,    setZipFronterInfo]       = useState(null);
  const zipFronterTimer = useRef(null);

  // Local phone filter for fronter's My Leads list
  const [leadSearch, setLeadSearch] = useState('');

  useEffect(() => {
    fetchStats();
    if (isFronter) { fetchFields(); fetchConfigs(); }
    // Closers need the form fields too, to resolve the dynamic disposition tabs
    // (e.g. "Post Date") from the sale-disposition field options.
    else if (isCloser) { fetchFields(); }
  }, []);
  // Debounce the fronter lead filter into a server-side search; reset to page 1.
  useEffect(() => { const t = setTimeout(() => { setLeadSearchQ(leadSearch.trim()); setTransfersPage(1); }, 350); return () => clearTimeout(t); }, [leadSearch]);
  useEffect(() => { fetchTransfers({ date_from, date_to, page: transfersPage, limit: PAGE_SIZE, search: leadSearchQ || undefined, ...(myLeadsStatus ? { status: myLeadsStatus } : {}) }); }, [fetchTransfers, date_from, date_to, transfersPage, leadSearchQ, myLeadsStatus]);
  useEffect(() => {
    if (!isCloser) return;
    const base = { date_from, date_to, page: closerSalesPage, limit: PAGE_SIZE };
    if (closerSection.startsWith('dispo:')) base.disposition = closerSection.slice(6);  // dynamic disposition tab
    else if (salesStatus) base.status = salesStatus;
    fetchSales(base);
  }, [fetchSales, date_from, date_to, isCloser, closerSalesPage, salesStatus, closerSection]);
  // Keep page within range when the date filter narrows the dataset.
  useEffect(() => { setTransfersPage(1); setCloserSalesPage(1); }, [date_from, date_to]);

  const fetchXferTab = useCallback(async () => {
    if (!user?.company_id) return;
    setXferTabLoading(true);
    try {
      const params = { company_id: user.company_id, page: xferPage, limit: PAGE_SIZE, date_from, date_to };
      if (xferStatus) params.status  = xferStatus;
      if (xferAgent)  params.user_id = xferAgent;
      if (xferSearch) params.search  = xferSearch;
      const res = await client.get('transfers', { params });
      setXferTabRows(res.data.transfers || []);
      setXferTabTotal(res.data.total    || 0);
    } catch {} finally { setXferTabLoading(false); }
  }, [user?.company_id, xferPage, xferStatus, xferAgent, xferSearch, date_from, date_to]);

  const fetchSalesTab = useCallback(async () => {
    if (!user?.company_id) return;
    setSalesTabLoading(true);
    try {
      const params = { company_id: user.company_id, page: salesPage, limit: PAGE_SIZE, date_from, date_to };
      if (salesStatus) params.status  = salesStatus;
      if (salesAgent)  params.user_id = salesAgent;
      if (salesSearch) params.search  = salesSearch;
      const res = await client.get('sales', { params });
      setSalesTabRows(res.data.sales || []);
      setSalesTabTotal(res.data.total || 0);
    } catch {} finally { setSalesTabLoading(false); }
  }, [user?.company_id, salesPage, salesStatus, salesAgent, salesSearch, date_from, date_to]);

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
      const created = res?.sales?.length ? res.sales : (res?.sale ? [res.sale] : []);
      // Post-dated sales are NOT auto-submitted — they sit in the Post Date tab
      // (closer-editable, no compliance lock) until charged. Everything else is
      // auto-submitted for compliance review as before.
      const isPost = isPostDateDispo(formData.closer_disposition);
      if (!isPost) {
        await Promise.all(created.filter(s => s?.id).map(s => client.post(`sales/${s.id}/submit-review`)));
      }
      setModalOpen(false);
      setSaleSuccess(isPost
        ? 'Post-dated sale saved — in the Post Date tab until you charge it.'
        : (created.length > 1 ? `${created.length} sales submitted to compliance!` : 'Sale submitted to compliance!'));
      setPhoneSearchRefresh(prev => prev + 1);
      fetchStats();
      fetchTransfers({ date_from, date_to, page: transfersPage, limit: PAGE_SIZE, search: leadSearchQ || undefined, ...(myLeadsStatus ? { status: myLeadsStatus } : {}) });
      fetchSales({ date_from, date_to, page: closerSalesPage, limit: PAGE_SIZE, ...(salesStatus ? { status: salesStatus } : {}) });
      setTimeout(() => setSaleSuccess(''), 5000);
    } catch (err) {
      setSaleError(err.response?.data?.errors?.map(e => e.msg).join(', ') || err.response?.data?.error || 'Failed to create sale');
    } finally {
      setSaleLoading(false);
    }
  };

  // Charge a post-dated sale: flip its disposition to "sale" (and clear the
  // schedule) so it leaves the Post Date tab, then submit it to compliance so it
  // shows up — approvable — in All Sales. submit-review is best-effort (a legacy
  // already-in-review sale just stays in review).
  const chargeSale = async (saleId, dispoFilter) => {
    try {
      await client.put(`sales/${saleId}`, { closer_disposition: 'sale', charge_at: null });
      try { await client.post(`sales/${saleId}/submit-review`); } catch { /* already in review */ }
      setSaleSuccess('Charged — sent to compliance as a sale.');
      fetchSales({ date_from, date_to, page: closerSalesPage, limit: PAGE_SIZE, ...(dispoFilter ? { disposition: dispoFilter } : {}) });
      fetchStats();
      setTimeout(() => setSaleSuccess(''), 4000);
    } catch (err) {
      setSaleError(err.response?.data?.error || 'Failed to charge sale');
    }
  };

  const handleSaleEdit = async (formData) => {
    setEditSaleLoading(true);
    setEditSaleError('');
    try {
      await client.put(`sales/${editSale.id}`, formData);
      // Resubmit to compliance after a closer edit — but NOT while the sale is
      // still post-dated. Editing a post-date record (its charging time / note)
      // keeps it in the Post Date tab; it only enters review when the closer
      // either flips the disposition off "post date" here or clicks Charge.
      const nowPostDate = isPostDateDispo(formData.closer_disposition);
      const resubmit = !nowPostDate && ['needs_revision', 'open'].includes(editSale.status);
      if (resubmit) await client.post(`sales/${editSale.id}/submit-review`);
      setEditSale(null);
      setSaleSuccess(nowPostDate ? 'Post-dated sale updated.' : (resubmit ? 'Sale resubmitted to compliance!' : 'Sale updated!'));
      const dispoFilter = closerSection.startsWith('dispo:') ? closerSection.slice(6) : null;
      fetchSales({ date_from, date_to, page: closerSalesPage, limit: PAGE_SIZE, ...(dispoFilter ? { disposition: dispoFilter } : (salesStatus ? { status: salesStatus } : {})) });
      fetchStats();
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
      fetchSales({ date_from, date_to, page: closerSalesPage, limit: PAGE_SIZE, ...(salesStatus ? { status: salesStatus } : {}) });
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
      fetchTransfers({ date_from, date_to, page: transfersPage, limit: PAGE_SIZE, search: leadSearchQ || undefined, ...(myLeadsStatus ? { status: myLeadsStatus } : {}) });
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

  // VICIdial "pending from dialer" → open the SAME create-transfer form, prefill
  // the captured phone, and flag it so submit confirms the pending row.
  const openDialerPending = (item) => {
    const fd0 = item.form_data || {};
    const phone = fd0.customer_phone || fd0.Phone || item.normalized_phone || '';
    const next = {};
    (fields || []).filter(f => f.show_to_fronter !== false).forEach(f => {
      if (/phone|cli|mobile/i.test(f.name)) next[f.name] = phone;
    });
    next.Phone = phone; next.customer_phone = phone;
    setFormData(next);
    setDupCheck(null);
    setZipFronterInfo(null);
    lastPrefilledId.current = null;
    setPendingDialer(item);
    setShowCreateForm(true);
  };

  const handleSubmitTransfer = async (e) => {
    e.preventDefault();
    setTransferError('');
    // Vehicle sanity guard — block obviously shifted columns (bad year / numeric make).
    const vIssue = Object.values(vehicleFieldIssues((fields || []).filter(f => f.show_to_fronter !== false), formData))[0];
    if (vIssue) { setTransferError(vIssue); return; }
    setTransferSubmitting(true);
    try {
      if (pendingDialer) {
        // Fill the existing VICIdial pending row instead of creating a duplicate.
        await client.post(`vicidial/pending/${pendingDialer.id}/confirm`, { form_data: formData });
        toast.success('Transfer confirmed — sent to closer.');
        setDialerRefresh(x => x + 1);
      } else {
        const res = await createTransfer({ ...formData });
        const action = res?.action;
        toast.success(
          action === 'updated' ? 'Existing transfer refreshed — no new transfer counted.'
            : action === 'created_reengaged' ? 'New transfer created — this number was last contacted over 30 days ago.'
            : action === 'created_sale_warning' ? 'New transfer created (you already had a completed sale on this number).'
            : 'Transfer created.');
      }
      rememberValues((fields || []).filter(f => f.show_to_fronter !== false), formData);
      setShowCreateForm(false);
      setPendingDialer(null);
      setFormData({});
      setZipFronterInfo(null);
      setDupCheck(null);
      lastPrefilledId.current = null;
      fetchStats();
      fetchTransfers({ date_from, date_to, page: transfersPage, limit: PAGE_SIZE, search: leadSearchQ || undefined, ...(myLeadsStatus ? { status: myLeadsStatus } : {}) });
    } catch (err) {
      setTransferError(err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Failed to submit');
    } finally {
      setTransferSubmitting(false);
    }
  };

  const handleFronterZipChange = (fieldName, raw, allFields) => {
    // Strict 5-digit cap — strip every non-digit and clip to 5. Anything past
    // five was just causing the zip lookup to 404. The cap also enforces what
    // the form-level normalizer in formFieldNorm does for the same kind.
    const val = String(raw || '').replace(/\D/g, '').slice(0, 5);
    setFormData(prev => ({ ...prev, [fieldName]: val }));
    clearTimeout(zipFronterTimer.current);

    const cityF  = allFields.find(f => ['City','city','customer_city'].includes(f.name));
    const stateF = allFields.find(f => ['State','state','customer_state'].includes(f.name));

    if (val.length < 5) {
      // Backspacing under 5 digits clears both the autofilled city + state so
      // the user isn't left with stale geo from a previous zip lookup.
      setZipFronterInfo(null);
      setFormData(prev => {
        const next = { ...prev };
        if (cityF)  next[cityF.name]  = '';
        if (stateF) next[stateF.name] = '';
        return next;
      });
      return;
    }

    zipFronterTimer.current = setTimeout(async () => {
      setZipFronterLoading(true);
      try {
        const res = await client.get(`zipcode/${val}`);
        setZipFronterInfo(res.data);
        setFormData(prev => {
          const next = { ...prev };
          if (cityF)  next[cityF.name]  = res.data.city;
          if (stateF) next[stateF.name] = res.data.state;
          return next;
        });
      } catch { setZipFronterInfo(null); }
      finally { setZipFronterLoading(false); }
    }, 500);
  };

  const CODE_TABS = [
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
    { key: 'scripts',           label: 'Scripts',         icon: FileText   },
  ];
  const {
    applyTabs: applyStaffLayout,
    defaultTab: staffDefaultTab,
    isCardVisible: isStaffCardVisible,
    isFilterVisible: isStaffFilterVisible,
    cardConfig: staffCardConfig,
  } = useShellLayout('staff');
  const TABS = useMemo(() => applyStaffLayout(CODE_TABS), [applyStaffLayout, CODE_TABS]);

  // Reconcile activeTab when admin layout hides the persisted tab key.
  useEffect(() => {
    if (TABS.length && !TABS.some(t => t.key === activeTab)) {
      const fallback = staffDefaultTab(TABS) || TABS[0]?.key;
      if (fallback) setActiveTab(fallback);
    }
  }, [TABS, activeTab, staffDefaultTab, setActiveTab]);

  // ── KPI metric map ──────────────────────────────────────────────────────
  // Every data point a staff KPI card can show, keyed to match kpiCatalog. The
  // SuperAdmin builder picks which land in which card / slot; the drill-down
  // for each one is preserved here.
  const goCloser = (status, range) => () => { setCloserSection('sales'); setSalesStatus(status); setDateRange(getPresetRange(range)); };
  // Fronter leads KPIs → filter the fronter's own "My Leads" list (and jump to
  // its tab). Previously this set xferStatus, which only drives the separate
  // team_transfers tab — so the fronter's list never filtered and showed all.
  const goLeads  = (status, range) => () => { setActiveTab('transfers'); setMyLeadsStatus(status || ''); setTransfersPage(1); if (range) setDateRange(getPresetRange(range)); };
  const staffMetrics = {
    sales_today:     { value: stats.todaySales || 0,     onClick: goCloser('', 'today') },
    sales_month:     { value: stats.monthSales || 0,     onClick: goCloser('', 'month') },
    sales_total:     { value: stats.totalSales || 0,     onClick: goCloser('', 'all') },
    approved_today:  { value: stats.todayClosedWon || 0, onClick: goCloser('closed_won', 'today') },
    approved_month:  { value: stats.monthClosedWon || 0, onClick: goCloser('closed_won', 'month') },
    approved_total:  { value: stats.closedWon || 0,      onClick: goCloser('closed_won', 'all') },
    cancelled_today: { value: stats.todayCancelled || 0, onClick: goCloser('cancelled', 'today') },
    cancelled_month: { value: stats.monthCancelled || 0, onClick: goCloser('cancelled', 'month') },
    cancelled_total: { value: stats.cancelledSales || 0, onClick: goCloser('cancelled', 'all') },
    awaiting:        { value: stats.awaitingCompliance || 0, onClick: goCloser('pending_review', 'all'), title: 'Show all sales awaiting compliance review' },
    awaiting_inflight: { value: stats.awaitingCompliance || 0, onClick: goLeads('assigned'), title: 'Show leads in-flight with a closer' },
    returned:        { value: stats.needsRevision || 0, onClick: goCloser('needs_revision', 'all'), title: 'Sales compliance returned to you for revision' },
    resells_month:   { value: stats.resellsThisMonth || 0, onClick: goCloser('', 'month'), title: 'Resells this month' },
    resells_total:   { value: stats.resellsTotal || 0,     onClick: goCloser('', 'all'),   title: 'All resells' },
    leads_today:     { value: stats.todayTransfers || 0, onClick: goLeads('', 'today') },
    leads_month:     { value: stats.monthTransfers || 0, onClick: goLeads('', 'month') },
    leads_total:     { value: stats.totalTransfers || 0, onClick: goLeads('', 'all') },
    completed_today: { value: stats.todayCompletedTransfers || 0, onClick: goLeads('completed', 'today') },
    completed_month: { value: stats.monthCompletedTransfers || 0, onClick: goLeads('completed', 'month') },
    completed_total: { value: stats.completedTransfers || 0,      onClick: goLeads('completed', 'all') },
  };

  const renderStaffCard = (key) => {
    if (!isStaffCardVisible(key)) return null;
    const meta = STAFF_CARD_META[key] || {};
    const cfg  = staffCardConfig(key);
    const segments = (cfg.segments || [])
      .map(s => { const m = staffMetrics[s.metric]; return m ? { key: s.metric, label: s.label, value: m.value, onClick: m.onClick, title: m.title, isPrimary: s.primary } : null; })
      .filter(Boolean);
    if (!segments.length) return null;
    return (
      <StatCardTriple key={key} label={cfg.label} icon={meta.icon} color={meta.color}
        accent={meta.accent} gradientFrom={meta.gradientFrom}
        loading={statsLoading} segments={segments}
        caption={cfg.description || undefined} />
    );
  };

  return (
    <div className={`min-h-screen bg-bg ${user?.role === 'superadmin' ? '' : 'bsx-no-select'}`}>
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

      <EngagementBanners />
      {activeNav !== 'dashboard' && <CrossRoleContent section={activeNav} user={user} />}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8"
        style={{ display: activeNav !== 'dashboard' ? 'none' : undefined }}>
        <SpiffWidget />

        {/* VICIdial: transfers captured from the dialer on XFER, awaiting confirm.
            Shown by ownership, not role — /pending only returns transfers THIS
            user created (the fronter who XFERd). A closer who never XFERd has
            none, so the banner self-hides; no fragile role gate needed. */}
        <PendingFromDialer onPick={openDialerPending} refreshSignal={dialerRefresh} />

        {/* VICIdial: closer's dialer dispositions awaiting a lead (the closer
            assigns each to a lead). Self-hides when the closer has none. */}
        <CloserPendingDispos onChanged={() => fetchTransfers && fetchTransfers()} />

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
          <DateRangePicker
            onChange={setDateRange}
            defaultPreset="today"
            value={dateRange}
            onClear={() => {
              // Master clear: drop status filters on sales + transfers so the
              // user gets back to a clean view in one click. Date itself is
              // already being reset to defaultPreset by the picker internally.
              setSalesStatus(''); setSalesAgent(''); setSalesPage(1);
              setXferStatus('');  setXferAgent('');  setXferPage(1);
            }}
          />
        </div>

        {/* ── NON-SALES TABS ── */}
        {activeTab === 'callbacks'       && <CallbacksPage user={user} />}
        {activeTab === 'team_callbacks'  && <CallbacksOverview user={user} companyId={user?.company_id} />}
        {activeTab === 'tracked_numbers' && <CallbackNumbers user={user} />}
        {activeTab === 'numbers'         && <AssignedNumbersList user={user} />}
        {activeTab === 'search'          && <SaleSearch />}
        {activeTab === 'faqs'            && <FAQPanel />}
        {activeTab === 'scripts'         && <ScriptPanel />}

        {/* ── TEAM TRANSFERS TAB ── */}
        {activeTab === 'team_transfers' && (
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h3 className="text-xl font-bold text-text flex items-center gap-2"><Send size={20} /> Team Transfers</h3>
              <span className="text-sm text-text-secondary">{xferTabTotal} total</span>
            </div>

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
              extras={companyAgents.length > 0 && (
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
                          <td className="py-3 px-3 text-text-secondary text-xs"><CopyableNumber value={t.form_data?.customer_phone || t.form_data?.Phone || ''} /></td>
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
              extras={companyAgents.length > 0 && (
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
                          <td className="py-3 px-3"><div className="flex items-center gap-1.5 flex-wrap"><SaleStatusBadge sale={s} size="sm" />{s.is_resell && <span title={`Resell · ${s.resell_intent || ''}`} className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded whitespace-nowrap" style={{ backgroundColor: '#ddd6fe', color: '#5b21b6' }}>↻ {(s.resell_intent || 'resell').replace(/_/g, ' ')}</span>}</div></td>
                          <td className="py-3 px-3 text-text-secondary text-xs">{s.closer_name || '—'}</td>
                          {hasPermission('view_financial_data') && <td className="py-3 px-3 text-xs font-semibold text-success-600">{s.monthly_payment ? `$${s.monthly_payment}/mo` : '—'}</td>}
                          {/* Sale date = the day the sale actually happened (carried through
                              bulk upload). Falls back to created_at on legacy rows where
                              sale_date wasn't captured. Without this, every bulk-uploaded
                              row shows the UPLOAD day ("today") instead of the file's date. */}
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

        {/* ── MY SALES TAB (closer view) ── */}
        {activeTab === 'sales' && isCloser && (
          <div>
            {saleSuccess && <Alert type="success" title="Sale Created!" message={saleSuccess} dismissible onDismiss={() => setSaleSuccess('')} />}
            {saleError   && <Alert type="error"   title="Error"         message={saleError}   dismissible onDismiss={() => setSaleError('')}   />}
            {reviewSuccess && <Alert type="success" title="Saved!" message={reviewSuccess} dismissible onDismiss={() => setReviewSuccess('')} />}
            {submitMsg   && <Alert type="error"   title="Error"         message={submitMsg}   dismissible onDismiss={() => setSubmitMsg('')}    />}

            {/* Phone search — find leads from linked fronter companies by number */}
            <div className="mb-6">
              <PhoneSearch onCreateSale={openSaleModal} companyTimezone={user?.company_timezone} refreshTrigger={phoneSearchRefresh}
                onResellComplete={(newSale) => { if (newSale?.id) setEditSale(newSale); }} />
            </div>

            {/* Stats — triple-segment cards. Today / MTD / Total each clickable
                with its own filter scope. Closer sees: My Sales, Approved,
                Awaiting Review, Cancelled, Resells, Conversion. */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
              {STAFF_CLOSER_CARDS.map(renderStaffCard)}

              {/* Conversion — display-only, kept in the same row. */}
              {isStaffCardVisible('conversion') && (
              <Card
                className="p-4 min-h-[140px] flex flex-col justify-between"
                style={{ background: 'linear-gradient(135deg, var(--color-info-50, #ecfeff) 0%, var(--color-surface) 60%)', borderTop: '3px solid var(--color-info-500, #06b6d4)' }}
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Conversion</p>
                  <div className="p-2 rounded-xl shrink-0" style={{ backgroundColor: 'var(--color-info-100, #cffafe)' }}>
                    <Target size={16} className="text-info-600" />
                  </div>
                </div>
                <div className="text-center my-2">
                  <p className="text-4xl font-bold text-info-600 leading-none" style={{ fontFamily: 'var(--font-display)', letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>
                    {statsLoading ? '—' : `${stats.conversionRate || 0}%`}
                  </p>
                </div>
                <p className="text-[10px] text-text-tertiary text-center">Approved ÷ total transfers</p>
              </Card>
              )}

            </div>

            {/* Sub-nav: Assigned Transfers | My Sales | <dynamic disposition tabs> */}
            <div className="flex gap-1 p-1 rounded-xl w-fit mb-5 overflow-x-auto"
              style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
              {[{ k: 'assigned', l: 'Assigned Transfers', icon: Clock, count: transferTotal },
                { k: 'sales',    l: 'My Sales',           icon: DollarSign, count: salesTotal }].map(s => (
                <button key={s.k} onClick={() => { setCloserSection(s.k); setCloserSalesPage(1); }}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all whitespace-nowrap"
                  style={{ background: closerSection === s.k ? 'var(--gradient-sidebar)' : 'transparent',
                    color: closerSection === s.k ? 'white' : 'var(--color-text-secondary)',
                    boxShadow: closerSection === s.k ? 'var(--shadow-sm)' : 'none' }}>
                  <s.icon size={15} /> {s.l}
                  <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{ backgroundColor: closerSection === s.k ? 'rgba(255,255,255,0.25)' : 'var(--color-surface)',
                      color: closerSection === s.k ? 'white' : 'var(--color-text-tertiary)' }}>{s.count}</span>
                </button>
              ))}
              {/* One tab per non-"sale" disposition the admin configured. */}
              {dispositionTabs(fields).map(d => {
                const key = `dispo:${d.value}`;
                const active = closerSection === key;
                return (
                  <button key={key} onClick={() => { setCloserSection(key); setCloserSalesPage(1); }}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all whitespace-nowrap"
                    style={{ background: active ? 'var(--gradient-sidebar)' : 'transparent',
                      color: active ? 'white' : 'var(--color-text-secondary)',
                      boxShadow: active ? 'var(--shadow-sm)' : 'none' }}>
                    {isPostDateDispo(d.value) ? <CalendarPlus size={15} /> : <FileText size={15} />} {d.label}
                  </button>
                );
              })}
            </div>

            {closerSection === 'assigned' && (
              <Card className="p-6">
                <div className="mb-4">
                  <h3 className="text-xl font-bold text-text flex items-center gap-2">
                    <Clock size={20} /> Assigned Transfers
                    <span className="text-sm font-semibold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>{transferTotal}</span>
                  </h3>
                  <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                    Every lead handed to you — counts leads you still need to work <strong>and</strong> ones already
                    converted or rejected. This is why it differs from “My Sales” (only deals you created).
                  </p>
                </div>
                {tLoading ? (
                  <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
                ) : transfers.length === 0 ? (
                  <p className="text-text-secondary text-center py-8">No transfers assigned yet.</p>
                ) : (
                  <>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {transfers.map(t => {
                      const si = transferStatusInfo(t.status);
                      const veh = transferVehicle(t.form_data);
                      const dt = fmtCardDate(t.created_at || t.assigned_at);
                      return (
                      <div key={t.id} onClick={() => setDetailTransfer(t)}
                        className="p-4 rounded-xl border transition-all hover:shadow-md cursor-pointer"
                        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)' }}>
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="min-w-0">
                            <p className="font-semibold text-text truncate">
                              {t.form_data?.FirstName ? `${t.form_data.FirstName} ${t.form_data.LastName || ''}`.trim()
                                : t.form_data?.customer_name || 'Unknown'}
                            </p>
                            <p className="text-xs text-text-secondary mt-0.5">
                              <CopyableNumber value={t.form_data?.Phone || t.form_data?.customer_phone || ''} size={10} />
                            </p>
                            {t.vicidial_vendor_code && (
                              <span className="text-[10px] font-mono mt-1 px-1.5 py-0.5 rounded inline-flex items-center gap-0.5"
                                title="Dialer lead ID" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}>
                                <Hash size={8} />{t.vicidial_vendor_code}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1 flex-shrink-0">
                            <Badge variant={TRANSFER_BADGE[t.status] || 'secondary'} size="sm" title={si.desc}>{si.label}</Badge>
                            {/* Latest disposition the closer/fronter set on this lead — shown
                                next to the status so "Awaiting assignment" / "Ready to work"
                                also tells you what was last decided (callback, not interested…). */}
                            {t.latest_disposition?.disposition_name && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap"
                                title={`Last disposition${t.latest_disposition.note ? ` — ${t.latest_disposition.note}` : ''}`}
                                style={{
                                  backgroundColor: `${t.latest_disposition.color || '#6b7280'}22`,
                                  color: t.latest_disposition.color || '#6b7280',
                                }}>
                                {t.latest_disposition.disposition_name}
                              </span>
                            )}
                          </div>
                        </div>
                        {/* Date + vehicle context */}
                        <div className="flex items-center gap-3 flex-wrap text-[11px] mt-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
                          {dt && <span className="flex items-center gap-1"><CalendarDays size={11} /> {dt}</span>}
                          {veh && <span className="flex items-center gap-1"><Car size={11} /> {veh}</span>}
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
                      </div>
                      );
                    })}
                  </div>
                  <Pagination page={transfersPage} total={transferTotal} pageSize={PAGE_SIZE} onChange={setTransfersPage} />
                  </>
                )}
              </Card>
            )}

            {closerSection === 'sales' && (
              <Card className="p-6">
                <div className="mb-4">
                  <h3 className="text-xl font-bold text-text flex items-center gap-2">
                    <DollarSign size={20} /> My Sales
                    <span className="text-sm font-semibold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>{salesTotal}</span>
                  </h3>
                  <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                    Every sale you’ve created, in any status (draft, awaiting review, approved, returned…). Includes resells,
                    which is why it can exceed the leads assigned to you.
                  </p>
                </div>
                {sLoading ? (
                  <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
                ) : sales.length === 0 ? (
                  <p className="text-text-secondary text-center py-8">
                    No sales yet. Use phone search above to find a lead and create a sale.
                  </p>
                ) : (
                  <>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {sales.map(s => (
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
                            {(s.customer_phone || s.reference_no) && (
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap text-xs text-text-secondary">
                                {s.customer_phone && <CopyableNumber value={s.customer_phone} size={10} />}
                                {s.reference_no && <span className="font-mono" style={{ color: 'var(--color-text-tertiary)' }}>#{s.reference_no}</span>}
                              </div>
                            )}
                            {s.car_year && (
                              <div className="flex items-center gap-1 mt-0.5">
                                <Car size={11} style={{ color: 'var(--color-text-tertiary)' }} />
                                <p className="text-xs text-text-secondary">{s.car_year} {s.car_make} {s.car_model}</p>
                              </div>
                            )}
                            <div className="flex items-center gap-3 flex-wrap text-[11px] mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                              <span className="flex items-center gap-1"><CalendarDays size={11} /> Sale {fmtCardDate(s.sale_date || s.created_at)}</span>
                              {s.plan && <span className="truncate">{s.plan}</span>}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1 ml-2">
                            <SaleStatusBadge sale={s} size="sm" />
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
                            onClick={e => { e.stopPropagation(); if (window.confirm('Delete this sale? This cannot be undone.')) { deleteSale(s.id).then(() => fetchSales({ date_from, date_to, page: closerSalesPage, limit: PAGE_SIZE, ...(salesStatus ? { status: salesStatus } : {}) })); } }}
                            className="w-full mt-1 py-1.5 px-3 rounded-lg text-xs font-semibold border flex items-center justify-center gap-1 transition-all hover:bg-error-50"
                            style={{ borderColor: 'var(--color-error-300)', color: 'var(--color-error-600)' }}>
                            <Trash2 size={11} /> Delete Sale
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <Pagination page={closerSalesPage} total={salesTotal} pageSize={PAGE_SIZE} onChange={setCloserSalesPage} />
                  </>
                )}
              </Card>
            )}

            {/* Dynamic disposition tab (e.g. Post Date) — sales the closer
                marked with this disposition. Post-date sales carry a charge
                date + a "Charge → Sale" button that moves them to My Sales. */}
            {closerSection.startsWith('dispo:') && (() => {
              const dispo = closerSection.slice(6);
              const isPost = isPostDateDispo(dispo);
              return (
              <Card className="p-6">
                <div className="mb-4">
                  <h3 className="text-xl font-bold text-text flex items-center gap-2">
                    {isPost ? <CalendarPlus size={20} /> : <FileText size={20} />} {prettyDispo(dispo)}
                    <span className="text-sm font-semibold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>{salesTotal}</span>
                  </h3>
                  <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                    Sales you marked “{prettyDispo(dispo)}”.{isPost ? ' Each is charged at its scheduled time — click “Charge → Sale” once done to move it to My Sales.' : ''}
                  </p>
                </div>
                {sLoading ? (
                  <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
                ) : sales.length === 0 ? (
                  <p className="text-text-secondary text-center py-8">No “{prettyDispo(dispo)}” sales.</p>
                ) : (
                  <>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {sales.map(s => (
                      <div key={s.id} onClick={() => setDetailSale(s)}
                        className="p-4 rounded-xl border transition-all hover:shadow-md cursor-pointer"
                        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg)' }}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-semibold text-text truncate">{s.customer_name || 'Sale'}</p>
                            {s.customer_phone && <div className="text-xs text-text-secondary mt-0.5"><CopyableNumber value={s.customer_phone} size={10} /></div>}
                            {s.charge_at && (
                              <p className="text-[11px] mt-1 flex items-center gap-1 font-semibold" style={{ color: '#b45309' }}>
                                <CalendarDays size={11} /> Charge {new Date(s.charge_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                              </p>
                            )}
                          </div>
                          <SaleStatusBadge sale={s} size="sm" />
                        </div>
                        <div className="flex gap-2 mt-3" onClick={e => e.stopPropagation()}>
                          {isPost && (
                            <button onClick={() => chargeSale(s.id, dispo)}
                              className="flex-1 py-1.5 px-3 rounded-lg text-xs font-bold text-white flex items-center justify-center gap-1 hover:scale-[1.02] transition-all"
                              style={{ background: 'var(--gradient-sidebar)' }}>
                              <DollarSign size={12} /> Charge → Sale
                            </button>
                          )}
                          <button onClick={() => { setEditSale(s); setEditSaleError(''); }}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold border flex items-center gap-1 transition-all hover:bg-bg-secondary"
                            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                            <Pencil size={11} /> Edit
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <Pagination page={closerSalesPage} total={salesTotal} pageSize={PAGE_SIZE} onChange={setCloserSalesPage} />
                  </>
                )}
              </Card>
              );
            })()}
          </div>
        )}

        {/* ── MY TRANSFERS TAB (fronter view) ── */}
        {activeTab === 'transfers' && isFronter && (
          <div>
            {/* Stats — triple-segment cards for the fronter view. Same
                Today / MTD / Total clickable pattern as the closer side. */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              {STAFF_FRONTER_CARDS.map(renderStaffCard)}

              {/* Conversion — display-only, same color theme as the closer side. */}
              {isStaffCardVisible('conversion') && (
              <Card
                className="p-4 min-h-[140px] flex flex-col justify-between"
                style={{ background: 'linear-gradient(135deg, var(--color-info-50, #ecfeff) 0%, var(--color-surface) 60%)', borderTop: '3px solid var(--color-info-500, #06b6d4)' }}
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Conversion</p>
                  <div className="p-2 rounded-xl shrink-0" style={{ backgroundColor: 'var(--color-info-100, #cffafe)' }}>
                    <Target size={16} className="text-info-600" />
                  </div>
                </div>
                <div className="text-center my-2">
                  <p className="text-4xl font-bold text-info-600 leading-none" style={{ fontFamily: 'var(--font-display)', letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>
                    {statsLoading ? '—' : `${stats.conversionRate || 0}%`}
                  </p>
                </div>
                <p className="text-[10px] text-text-tertiary text-center">Approved ÷ total transfers</p>
              </Card>
              )}
            </div>

            {/* Create Transfer modal — fronter fields only, sized like the sale modal */}
            {showCreateForm && hasPermission('create_transfer') && (
              <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto"
                style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
                onClick={e => { if (e.target === e.currentTarget) { setShowCreateForm(false); setPendingDialer(null); setFormData({}); setZipFronterInfo(null); setDupCheck(null); lastPrefilledId.current = null; } }}>
                <div className="relative w-full max-w-5xl my-6 rounded-2xl animate-scale-in"
                  style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}>
                  <div className="flex items-center justify-between px-6 py-5 rounded-t-2xl" style={{ background: 'var(--gradient-sidebar)' }}>
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-white/20 rounded-xl"><Send size={20} className="text-white" /></div>
                      <div>
                        <h2 className="text-xl font-bold text-white">New Transfer / Lead</h2>
                        <p className="text-xs text-white/70">Route a call to a closer</p>
                      </div>
                    </div>
                    <button onClick={() => { setShowCreateForm(false); setPendingDialer(null); setFormData({}); setZipFronterInfo(null); setDupCheck(null); lastPrefilledId.current = null; }}
                      className="p-2 rounded-xl bg-white/20 hover:bg-white/30 transition-colors">
                      <XCircle size={18} className="text-white" />
                    </button>
                  </div>
                  <form onSubmit={handleSubmitTransfer} className="p-6">
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

                      {/* Fronter-scoped duplicate alert / sale warning (dismissible, non-blocking) */}
                      {dupCheck && (() => {
                        const warn = dupCheck.result !== 'refresh'; // sale + re-engage draw attention (amber); refresh = soft indigo
                        const accent = warn ? '#d97706' : 'var(--color-primary-600)';
                        const prev = dupCheck.transfer;
                        return (
                          <div className="mb-4 flex items-start gap-2.5 px-3.5 py-3 rounded-xl"
                            style={{
                              backgroundColor: warn ? '#fffbeb' : 'var(--color-primary-50, #eef2ff)',
                              border: `1px solid ${warn ? '#fcd34d' : 'var(--color-primary-300, #c7d2fe)'}`,
                            }}>
                            <AlertTriangle size={16} style={{ color: accent, flexShrink: 0, marginTop: 1 }} />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{dupCheck.message}</p>
                              {prev && (
                                <p className="text-[11px] mt-1 font-semibold" style={{ color: accent }}>
                                  Previous: {prev.date ? new Date(prev.date).toLocaleDateString() : '—'} · {prev.closer_name || 'not yet assigned'} · {prev.disposition || 'no disposition'}
                                </p>
                              )}
                            </div>
                            <button type="button" onClick={() => setDupCheck(null)} aria-label="Dismiss"
                              className="text-lg leading-none px-1 rounded hover:bg-black/5" style={{ color: 'var(--color-text-tertiary)' }}>×</button>
                          </div>
                        );
                      })()}

                      <div className="grid grid-cols-1 sm:grid-cols-5 items-start gap-x-4 gap-y-5">
                        {fields.filter(f => f.show_to_fronter !== false).sort((a, b) => (a.order || 0) - (b.order || 0)).map(field => {
                          const spanClass = { 1: 'sm:col-span-1', 2: 'sm:col-span-2', 3: 'sm:col-span-3', 4: 'sm:col-span-4', 5: 'sm:col-span-5' }[field.column_span] || 'sm:col-span-1';
                          // Auto-capitalize on blur + offer past values (datalist) for repeatable fields.
                          const fmtBlur = () => { const f = smartFormat(field, formData[field.name]); if (f !== (formData[field.name] || '')) setFormData(p => ({ ...p, [field.name]: f })); };
                          const sug = isSuggestable(field) ? suggestionsFor(field.name) : [];
                          const listId = sug.length ? `fft-${field.name}` : undefined;
                          return (
                            <div key={field.id} className={`self-start ${spanClass}`}>
                              <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5"
                                style={{ color: 'var(--color-text-secondary)' }}>
                                {field.label}
                                {field.is_required && <span className="ml-0.5" style={{ color: '#ef4444' }}>*</span>}
                              </label>
                              {isCarMake(field) ? (
                                /* CarMake → typeahead from /vehicles registry. Picking a make
                                   wipes the sibling model so a Honda Camry can't slip through
                                   after switching brands. MUST match before textarea/select. */
                                <VehicleSelect mode="make"
                                  value={formData[field.name] || ''}
                                  makes={vehicleMakes}
                                  strict
                                  onChange={v => {
                                    setFormData(prev => {
                                      const next = { ...prev, [field.name]: v };
                                      const modelF = fields.find(f => isCarModel(f));
                                      if (modelF && v !== (prev[field.name] || '')) next[modelF.name] = '';
                                      return next;
                                    });
                                  }}
                                  placeholder={field.placeholder || 'Type make…'} />
                              ) : isCarModel(field) ? (
                                /* CarModel → typeahead scoped to the currently-selected make. */
                                (() => {
                                  const makeF = fields.find(f => isCarMake(f));
                                  const activeMake = makeF ? (formData[makeF.name] || '') : '';
                                  return (
                                    <VehicleSelect mode="model"
                                      value={formData[field.name] || ''}
                                      models={vehicleModelsFor(activeMake)}
                                      requireMake strict
                                      onChange={v => setFormData({ ...formData, [field.name]: v })}
                                      placeholder={field.placeholder || 'Type model…'} />
                                  );
                                })()
                              ) : field.field_type === 'textarea' ? (
                                <textarea value={formData[field.name] || ''} onChange={e => setFormData({ ...formData, [field.name]: e.target.value })}
                                  onBlur={fmtBlur} className="input resize-none" rows="3" required={field.is_required} placeholder={field.placeholder || ''} />
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
                                  {/* No HTML maxLength: a 10-char paste like "90210-1234" would
                                      be clipped to "90210-1234" → "90210" anyway by the JS
                                      digit-strip below, but "(845) 587-6504" pasted into the
                                      zip slot would clip to "(845)" → "845" without the digit
                                      strip seeing the full value. Let normalize handle the cap. */}
                                  <input type="text" inputMode="numeric"
                                    value={formData[field.name] || ''}
                                    onChange={e => handleFronterZipChange(field.name, e.target.value, fields)}
                                    className="input pr-8" required={field.is_required}
                                    placeholder={field.placeholder || 'e.g. 90210'} />
                                  {zipFronterLoading && (
                                    <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                                      <div className="animate-spin rounded-full h-4 w-4 border-b-2"
                                        style={{ borderColor: 'var(--color-primary-600)' }} />
                                    </div>
                                  )}
                                  {!zipFronterLoading && zipFronterInfo && (formData[field.name] || '').length === 5 && (
                                    <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                                      {zipFronterInfo.city}, {zipFronterInfo.state}
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <>
                                  {/* Pipe through formFieldNorm so phone strips brackets/dashes
                                      and clips at 10 digits, VIN uppercases at 17, name strips
                                      digits, etc. — even when a fronter pastes "(555) 123-4567". */}
                                  <input type={field.field_type === 'phone' || field.field_type === 'tel' ? 'tel' : field.field_type}
                                    value={formData[field.name] || ''}
                                    onChange={e => setFormData({ ...formData, [field.name]: normalizeField(field, e.target.value) })}
                                    onBlur={fmtBlur} list={listId}
                                    maxLength={maxLengthFor(field)}
                                    className="input" required={field.is_required} placeholder={field.placeholder || ''} />
                                  {listId && <datalist id={listId}>{sug.map(s => <option key={s} value={s} />)}</datalist>}
                                </>
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
                          onClick={() => { setShowCreateForm(false); setPendingDialer(null); setFormData({}); setZipFronterInfo(null); setDupCheck(null); lastPrefilledId.current = null; }}
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
                  </div>
                </div>
            )}

            {/* My Leads — full width */}
            <Card className="p-6">
              <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
                <h3 className="text-xl font-bold text-text flex items-center gap-2">
                  <FileText size={20} /> My Leads
                  <span className="text-sm font-semibold px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>{transferTotal}</span>
                  {myLeadsStatus && (
                    <button onClick={() => { setMyLeadsStatus(''); setTransfersPage(1); }}
                      title="Clear filter — show all leads"
                      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold capitalize"
                      style={{ backgroundColor: 'var(--color-primary-50, #eef2ff)', color: 'var(--color-primary-700)', border: '1px solid var(--color-primary-200, #c7d2fe)' }}>
                      {myLeadsStatus.replace(/_/g, ' ')} <XCircle size={12} />
                    </button>
                  )}
                </h3>
                <div className="flex items-center gap-2 flex-1 sm:flex-none justify-end min-w-0">
                  <div className="relative flex-1 sm:flex-none sm:w-56">
                    <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
                    <input type="tel" value={leadSearch} onChange={e => setLeadSearch(e.target.value)}
                      placeholder="Filter by phone or name…" className="input pl-8 text-sm" />
                  </div>
                  <button onClick={() => setDupOpen(true)} title="View your duplicate-attempt records"
                    className="flex items-center gap-1.5 py-2 px-3 rounded-xl text-sm font-semibold transition-colors flex-shrink-0"
                    style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-surface)' }}>
                    <Copy size={14} /> Duplicates
                  </button>
                  {hasPermission('create_transfer') && (
                    <button onClick={() => { setShowCreateForm(true); setPendingDialer(null); setFormData({}); setDupCheck(null); lastPrefilledId.current = null; }}
                      className="flex items-center gap-1.5 py-2 px-4 rounded-xl text-sm font-bold text-white transition-all hover:scale-[1.02] flex-shrink-0"
                      style={{ background: 'var(--gradient-sidebar)', boxShadow: 'var(--shadow-md)' }}>
                      <Plus size={14} /> Create Transfer
                    </button>
                  )}
                </div>
              </div>

              {tLoading ? (
                <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-7 w-7 border-b-2 border-primary-600" /></div>
              ) : transfers.length === 0 ? (
                leadSearchQ ? (
                  <p className="text-text-secondary text-center py-10 text-sm">No leads match “{leadSearch}”.</p>
                ) : myLeadsStatus ? (
                  <p className="text-text-secondary text-center py-10 text-sm">
                    No leads match this filter.{' '}
                    <button onClick={() => { setMyLeadsStatus(''); setTransfersPage(1); }}
                      className="font-semibold underline" style={{ color: 'var(--color-primary-600)' }}>Show all leads</button>
                  </p>
                ) : (
                  <div className="flex flex-col items-center justify-center py-14 text-center">
                    <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                      <FileText size={22} style={{ color: 'var(--color-text-tertiary)' }} />
                    </div>
                    <p className="font-semibold text-sm mb-1" style={{ color: 'var(--color-text)' }}>No leads yet</p>
                    <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Create your first transfer to get started.</p>
                  </div>
                )
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                    {transfers.map(t => {
                      const name = t.form_data?.customer_name || (t.form_data?.FirstName ? `${t.form_data.FirstName} ${t.form_data.LastName || ''}`.trim() : 'Lead');
                      const phone = t.form_data?.Phone || t.form_data?.customer_phone || '';
                      const ds = getTransferDisplayStatus(t);
                      const d = t.latest_disposition;
                      const dispoName = d?.disposition_name || t.sale_closer_disposition;
                      const dispoColor = d?.color || '#6b7280';
                      const needsRev = t.sale_status === 'needs_revision';
                      return (
                        <div key={t.id} onClick={() => setDetailTransfer(t)}
                          className="p-4 rounded-2xl border transition-all hover:shadow-md cursor-pointer flex flex-col"
                          style={{ borderColor: needsRev ? 'var(--color-error-300)' : 'var(--color-border)',
                            backgroundColor: needsRev ? 'var(--color-error-50)' : 'var(--color-surface)' }}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold flex-shrink-0"
                                style={{ background: 'var(--gradient-sidebar)', fontSize: 13 }}>{(name[0] || 'L').toUpperCase()}</div>
                              <div className="min-w-0">
                                <p className="font-semibold text-text truncate">{name}</p>
                                {phone && <p className="text-xs text-text-secondary truncate"><CopyableNumber value={phone} size={10} /></p>}
                                {t.vicidial_vendor_code && (
                                  <span className="text-[10px] font-mono mt-1 px-1.5 py-0.5 rounded inline-flex items-center gap-0.5"
                                    title="Dialer lead ID" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}>
                                    <Hash size={8} />{t.vicidial_vendor_code}
                                  </span>
                                )}
                              </div>
                            </div>
                            <Badge variant={ds.variant} size="sm">{ds.label}</Badge>
                          </div>

                          {dispoName && (
                            <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold"
                                style={{ backgroundColor: dispoColor + '22', color: dispoColor, border: `1px solid ${dispoColor}44` }}>
                                <MessageSquare size={9} />{dispoName}
                              </span>
                              {d?.setter_name && <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>by {d.setter_name}</span>}
                            </div>
                          )}

                          {t.status === 'rejected' && t.rejection_reason && (
                            <p className="text-xs text-error-600 mt-2">Rejected: {t.rejection_reason}</p>
                          )}
                          {needsRev && t.sale_compliance_note && (
                            <div className="mt-2 flex items-start gap-1.5 px-2 py-1.5 rounded-lg"
                              style={{ backgroundColor: 'var(--color-error-100)', border: '1px solid var(--color-error-200)' }}>
                              <AlertTriangle size={12} className="text-error-600 mt-0.5 flex-shrink-0" />
                              <p className="text-xs text-error-600">{t.sale_compliance_note}</p>
                            </div>
                          )}

                          <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
                            <p className="text-xs text-text-tertiary">{fmtDateET(t.created_at)}</p>
                            {t.status !== 'completed' && !t.sale_id && (
                              <button onClick={e => { e.stopPropagation(); if (window.confirm('Delete this lead? This cannot be undone.')) { deleteTransfer(t.id).catch(err => toastError(err, 'Failed to delete lead')); } }}
                                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold transition-all hover:bg-error-50"
                                style={{ color: 'var(--color-error-600)', border: '1px solid var(--color-error-200)' }}>
                                <Trash2 size={11} /> Delete
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <Pagination page={transfersPage} total={transferTotal} pageSize={PAGE_SIZE} onChange={setTransfersPage} />
                </>
              )}
            </Card>
          </div>
        )}
        <DevCredit />
      </main>

      {/* ── MODALS ── */}

      {dupOpen && <DuplicateRecordsModal onClose={() => setDupOpen(false)} title="My Duplicate Records" />}

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
      <SaleDetailDrawer     sale={detailSale}         onClose={() => setDetailSale(null)}
        onResold={(newSale) => { setDetailSale(null); if (newSale?.id) setEditSale(newSale); }} />
    </div>
  );
};

export default StaffShell;
