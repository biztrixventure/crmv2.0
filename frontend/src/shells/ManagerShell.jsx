import { useEffect, useState, useCallback, useMemo, lazy, Suspense } from "react";
import { useHistoryTab } from "../hooks/useHistoryTab";
import { useListLayout } from "../hooks/useListLayout";
import { useAuth } from "../contexts/AuthContext";
import { useVersionCheck } from "../hooks/useVersionCheck";
import UpdateBanner from "../components/UI/UpdateBanner";
import DotGridBg from "../components/UI/DotGridBg";
import BatchInbox from "../components/Distribution/BatchInbox";
import BatchRoster from "../components/Distribution/BatchRoster";
import NoteShortcodesManager from "../components/Numbers/NoteShortcodesManager";
import ThemedSelect from '../components/UI/Select';
import TeamManager from '../components/Admin/Teams/TeamManager';
import MyTeam from '../components/Admin/Teams/MyTeam';
import QuotaReport from '../components/Teams/QuotaReport';
import { useTheme } from "../contexts/ThemeContext";
import { useFeatureFlags } from "../contexts/FeatureFlagsContext";
import { useNavigate } from "react-router-dom";
import {
  Users, DollarSign, Send, Phone, BarChart3, TrendingUp,
  CheckCircle, XCircle, Clock, Hash, Car, User, ArrowRight,
  Search, Star, Shield, FileText, RefreshCw, AlertCircle, Plus,
  MessageSquare, Trash2, Activity, ChevronLeft, ChevronRight, CalendarDays, HelpCircle, FileSpreadsheet, Trophy, Copy,
  UserCircle, Database, Settings2, Zap, Building2, CreditCard,
  LayoutGrid, ChevronUp, ChevronDown, ChevronsUpDown, Target,
} from "lucide-react";
import { Badge, Alert } from "../components/UI";
import { Panel, TableScroll, Loading, EmptyState, SectionHeader } from "../components/UI/kit";
import ChromeTabs from "../components/UI/ChromeTabs";
import CompanyPerformance from "../components/Manager/CompanyPerformance";

// ── Two-tier nav, the ComplianceShell pattern (docs/ui-design-system.md) ─────
// This shell had grown to ~20 sibling tabs on one strip, which is a scroll bar
// pretending to be navigation: you cannot see where you are, and half the set
// is always off-screen. Compliance solves it with task GROUPS on top and the
// active group's tabs below, so the second row is never longer than ~5.
//
// Groups reference tab KEYS ONLY — no key is renamed, moved out of CODE_TABS,
// or invented here, because readonly-admin governance stores those ids. A tab
// that matches no group still renders, under "More", so adding a tab to
// CODE_TABS later can never make it silently disappear.
const TAB_GROUPS = [
  { id: 'g_overview',  label: 'Overview',  icon: TrendingUp, tabs: ['overview'] },
  { id: 'g_records',   label: 'Records',   icon: Database,   tabs: ['transfers', 'team_sales', 'my_sales', 'search', 'activity_log'] },
  { id: 'g_callbacks', label: 'Callbacks', icon: Phone,      tabs: ['callbacks', 'numbers', 'batches'] },
  { id: 'g_team',      label: 'Team',      icon: Users,      tabs: ['my_team', 'teams', 'quota_report', 'spiffs'] },
  { id: 'g_resources', label: 'Resources', icon: HelpCircle, tabs: ['faqs', 'scripts', 'note_shortcodes'] },
  { id: 'g_tools',     label: 'Tools',     icon: Shield,     tabs: ['tool_customer_profiles', 'tool_data_analyzer', 'tool_chat_control', 'dnc', 'card_validator'] },
];
import DateRangePicker, { getPresetRange } from "../components/UI/DateRangePicker";
import { AppHeader } from "../components/Layout";
import { useSales } from "../hooks/useSales";
import { useTransfers } from "../hooks/useTransfers";
import { useNotifications } from "../hooks/useNotifications";
import { useNavFocus } from "../contexts/FocusContext";
import { useSaleDeepLink } from "../hooks/useSaleDeepLink";
import { useDashboardStats } from "../hooks/useDashboardStats";
import { useShellLayout } from "../hooks/useShellLayout";
import StatCardTriple from "../components/UI/StatCardTriple";
import Tooltip from "../components/UI/Tooltip";

// Column-header explanations — hover any header to learn what it means.
const TRANSFER_COL_TIPS = {
  Customer: 'Lead name captured on the transfer',
  Phone: 'Customer phone number',
  Fronter: 'Agent who generated the lead / created the transfer',
  Closer: 'Agent the transfer was assigned to',
  Status: 'Where the transfer is in the flow: pending → assigned → completed',
  Disposition: "The closer's call outcome (from the dialer or set manually)",
  Date: 'When the transfer was created',
  Action: 'Rate the call, set a disposition, or delete the transfer',
};
const SALE_COL_TIPS = {
  Customer: 'Customer the policy was sold to',
  Reference: 'Policy reference / confirmation number',
  Status: 'Compliance stage: Open → Pending Review → Approved (or Cancelled)',
  Fronter: 'Agent who generated the lead',
  Closer: 'Agent who made the sale',
  Monthly: 'Monthly payment on the policy',
  'Sale Date': 'The day the sale was made (not when the row was imported)',
  Action: 'Delete this sale',
};
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
import TargetsStrip from "../components/Engagement/TargetsStrip";
import SaleModal from "../components/Closer/SaleModal";
import CrossRoleContent from "../components/Navigation/CrossRoleContent";
import { transferPhone } from "../utils/phone";
import TeamManagementPanel from "../components/Navigation/TeamManagementPanel";
import RoleManagementPanel from "../components/Navigation/RoleManagementPanel";
import ReviewsPanel from "../components/Navigation/ReviewsPanel";
import ReportsPanel from "../components/Navigation/ReportsPanel";
import EventsCalendar from "../components/Calendar/EventsCalendar";
import ManagerExportModal from "../components/Manager/ManagerExportModal";
import DuplicateRecordsModal from "../components/Shared/DuplicateRecordsModal";
const FormBuilder  = lazy(() => import("../components/Admin/FormBuilder/FormBuilder"));
const SpiffManager = lazy(() => import("../components/Admin/Engagement/SpiffManager"));
// Delegatable superadmin tools (shown only when a superadmin grants the flag).
// (MyTeam is the team-lead home tab — imported eagerly above, small component.)
const CustomerProfile = lazy(() => import("../components/Admin/CustomerProfile/CustomerProfile"));
const DataAnalyzer    = lazy(() => import("../components/Admin/DataAnalyzer/DataAnalyzer"));
const ChatAdmin       = lazy(() => import("../components/Admin/Chat/ChatAdmin"));
const ComplianceReviewPanel = lazy(() => import("../components/Workspace/ComplianceReviewPanel"));
const BusinessRulesHub      = lazy(() => import("../components/Admin/BusinessRules/BusinessRulesHub"));
const FeatureFlagsManager   = lazy(() => import("../components/Admin/FeatureFlagsManager"));
const CompanyManagement     = lazy(() => import("../components/Admin/CompanyManagement").then(m => ({ default: m.CompanyManagement })));
import TransferDetailDrawer from "../components/Shared/TransferDetailDrawer";
import SaleDetailDrawer from "../components/Shared/SaleDetailDrawer";
import client from "../api/client";
import DevCredit from "../components/DevCredit";
import { getTransferDisplayStatus } from "../utils/transferStatus";
import { fmtDateET, todayET, fmtSaleDate } from "../utils/timezone";

const SALE_BADGE  = { open: 'info', sold: 'success', cancelled: 'error', follow_up: 'warning', closed_won: 'success', closed_lost: 'error', pending_review: 'warning', needs_revision: 'error' };
const SALE_LABEL  = { open: 'Pending', sold: 'Sold', cancelled: 'Cancelled', follow_up: 'Follow Up', closed_won: 'Approved', closed_lost: 'Lost', pending_review: 'In Review', needs_revision: 'Needs Revision' };
const XFER_BADGE  = { pending: 'warning', assigned: 'info', completed: 'success', cancelled: 'error', rejected: 'error' };
const DEFAULT_PAGE_SIZE = 25;   // list.layout override resolves at runtime (useListLayout)

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

// Per-card visual meta (icon + color tints). The label / description / which
// numbers each card shows now come from the KPI catalog + SuperAdmin overrides
// (resolved via useShellLayout.cardConfig); only the look lives here.
const MGR_CARD_META = {
  transfers:       { icon: Send,        color: 'info' },
  sales:           { icon: DollarSign,  color: 'success' },
  approved:        { icon: CheckCircle, color: 'success' },
  awaiting_review: { icon: Clock,       color: 'warning' },
  returned:        { icon: AlertCircle, color: 'error', accent: '#f97316', gradientFrom: '#fff7ed' },
  cancelled:       { icon: XCircle,     color: 'error' },
  resells:         { icon: RefreshCw,   color: 'primary', accent: '#8b5cf6', gradientFrom: '#ede9fe' },
  dup_attempts:    { icon: Copy,        color: 'warning' },
};
const MGR_CARD_ORDER = ['transfers', 'sales', 'approved', 'awaiting_review', 'returned', 'cancelled', 'resells', 'dup_attempts'];

// ── Record-table header cells, matching the Compliance record tabs ──────────
// Function declarations, not const arrows: this file sits in an import cycle
// through Compliance/shared (via ManagerCallbacksTab), and a const in a cycle
// is a temporal-dead-zone blank page waiting on the next bundler reshuffle.
function Th({ children, className = '' }) {
  return (
    <th className={`px-3 py-2 text-left text-xs font-bold uppercase tracking-wide whitespace-nowrap ${className}`}
      style={{ color: 'var(--color-text-secondary)' }}>{children}</th>
  );
}

function SortTh({ col, sort, onSort, children }) {
  const active = sort.col === col;
  return (
    <th onClick={() => onSort(col)}
      className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap transition-colors"
      style={{ color: active ? 'var(--color-primary-600)' : 'var(--color-text-secondary)' }}>
      {children}
      {active
        ? (sort.dir === 'asc'
            ? <ChevronUp size={10} className="ml-0.5 inline-block" />
            : <ChevronDown size={10} className="ml-0.5 inline-block" />)
        : <ChevronsUpDown size={10} className="ml-0.5 inline-block opacity-30" />}
    </th>
  );
}

// A company_admin's KPI strip leads with the metric their room is judged on and
// drops the cards belonging to the other side of the pipeline:
//   dup_attempts counts duplicate TRANSFER submissions, and /stats only computes
//     it for fronter-side callers — a closer company's admin read a hard 0.
//   returned + resells are closer-desk states. Resells belong to the closer's
//     company and are hidden from fronters by resell.hide_from_fronter anyway,
//     so a fronter admin's card was 0 by construction too.
// Both lists are subsets of MGR_CARD_ORDER — no new card keys, so the
// superadmin card config keeps deciding visibility and content of each one.
const FRONTER_CARD_ORDER = ['transfers', 'sales', 'approved', 'awaiting_review', 'cancelled', 'dup_attempts'];
const CLOSER_CARD_ORDER  = ['sales', 'approved', 'awaiting_review', 'returned', 'cancelled', 'resells', 'transfers'];

const ManagerShell = ({ workspaceMode = false }) => {
  const { user, logout, updateUser, hasPermission, canExport } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { isEnabled, isEnabledStrict } = useFeatureFlags();
  // Superadmin-configurable rows-per-page (list.layout.manager.<role>); falls
  // back to the built-in 25 until configured, so nothing changes on rollout.
  const { pageSize: PAGE_SIZE } = useListLayout('manager', { pageSize: DEFAULT_PAGE_SIZE });
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
    ...(hasPermission('manage_roles') || hasPermission('manage_company_roles') || hasPermission('create_role') || hasPermission('update_role') || hasPermission('delete_role')
      ? [{ key: 'roles',   label: 'Roles',   icon: Shield   }] : []),
    ...(hasPermission('manage_forms') && isEnabled('form_builder')
      ? [{ key: 'forms',   label: 'Forms',   icon: FileText }] : []),
    ...((hasPermission('view_all_call_reviews') || hasPermission('view_call_reviews')) && isEnabled('call_reviews')
      ? [{ key: 'reviews', label: 'Reviews', icon: Star     }] : []),
    ...((hasPermission('view_fronter_stats') || hasPermission('view_closer_stats') || hasPermission('view_company_reports') || hasPermission('view_reports')) && isEnabled('reports')
      ? [{ key: 'reports', label: 'Reports', icon: BarChart3}] : []),
    // Monthly-payment reminders — team view of due policies.
    ...((hasPermission('view_team_sales') || hasPermission('view_all_company_sales'))
      ? [{ key: 'payments', label: 'Payments', icon: DollarSign }] : []),
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
    // Team-lead home — your own team's live progress + roster/goal management.
    // Shown to every manager role (they may lead or belong to a team).
    ...(['company_admin', 'operations_manager', 'closer_manager', 'fronter_manager', 'manager'].includes(user?.role)
      ? [{ key: 'my_team',    label: 'My Team',        icon: Users      }] : []),
    // Team structure (create/edit/delete teams) is company-org management — only
    // company_admin + operations_manager (superadmin uses the Admin panel).
    // Fronter/closer managers do NOT see this; they manage their OWN team from
    // the "My Team" tab above.
    ...(['company_admin', 'operations_manager'].includes(user?.role)
      ? [{ key: 'teams',      label: 'Teams',          icon: UserCircle }] : []),
    // Quota performance. Shown to every manager role, because the SERVER scopes
    // it: a company_admin gets every team, a fronter/closer manager who leads a
    // team gets only that team. Gating it here by role as well would hide the
    // page from the lead it was built for.
    ...(['company_admin', 'operations_manager', 'closer_manager', 'fronter_manager', 'manager'].includes(user?.role)
      ? [{ key: 'quota_report', label: 'Quotas',       icon: Target     }] : []),
    { key: 'activity_log', label: 'Activity Log', icon: Activity },
    // Batches = upload → assign → dispositions → reporting, one surface.
    // "Assigned Numbers" is retired from the nav (renderer kept for deep-links).
    { key: 'batches',      label: 'Batches',      icon: Send },
    { key: 'note_shortcodes', label: 'Note Shortcuts', icon: FileText },
    { key: 'faqs',         label: 'FAQs',         icon: HelpCircle },
    { key: 'scripts',      label: 'Scripts',      icon: FileText },
    // Delegated superadmin tools — STRICT gate: hidden unless the flag is
    // catalogued AND enabled for this user (default-off, never shown by accident).
    ...(isEnabledStrict('tool_customer_profiles') ? [{ key: 'tool_customer_profiles', label: 'Customer Profiles', icon: UserCircle    }] : []),
    ...(isEnabledStrict('tool_data_analyzer')     ? [{ key: 'tool_data_analyzer',     label: 'Data Analyzer',     icon: Database      }] : []),
    ...(isEnabledStrict('tool_chat_control')      ? [{ key: 'tool_chat_control',      label: 'Chat Control',      icon: MessageSquare }] : []),
    ...(isEnabledStrict('tool_blacklist_lookup')  ? [{ key: 'dnc',                    label: 'DNC Check',         icon: Shield        }] : []),
    ...(isEnabledStrict('tool_card_validator')    ? [{ key: 'card_validator',         label: 'Card Validator',    icon: CreditCard    }] : []),
    ...(isEnabledStrict('tool_compliance_review') ? [{ key: 'tool_compliance_review', label: 'Compliance Review', icon: Shield        }] : []),
    ...(isEnabledStrict('tool_business_rules')    ? [{ key: 'tool_business_rules',    label: 'Business Rules',    icon: Settings2     }] : []),
    ...(isEnabledStrict('tool_feature_admin')     ? [{ key: 'tool_feature_admin',     label: 'Feature Flags',     icon: Zap           }] : []),
    ...(isEnabledStrict('tool_company_admin')     ? [{ key: 'tool_company_admin',     label: 'Companies',         icon: Building2     }] : []),
  ];
  const {
    applyTabs: applyManagerLayout,
    defaultTab: managerDefaultTab,
    isCardVisible: isMgrCardVisible,
    isFilterVisible: isMgrFilterVisible,
    isActionVisible: isMgrActionVisible,
    cardConfig: mgrCardConfig,
  } = useShellLayout('manager');
  // ── Which side of the pipeline is this company_admin on? ──────────────────
  // A fronter company's admin and a closer company's admin were handed the
  // IDENTICAL tab set, so each carried half a shell belonging to the other
  // side: the closer company's admin got lead-distribution surfaces (Numbers,
  // Batches, Assigned Numbers) its agents never touch, and a fronter company's
  // admin got sale-desk tooling (Sale Search, DNC Check, Card Validator) that
  // only makes sense while a closer is on a call.
  //
  // Narrowing ONLY applies to company_admin, and only when the company type is
  // known — every other manager role, and any admin whose company_type has not
  // loaded yet, sees exactly what it saw before. Tab ids are untouched (hidden,
  // never renamed or deleted) because readonly-admin governance stores them.
  const coType    = user?.company_type || null;
  const isCoAdmin = user?.role === 'company_admin';
  const FRONTER_SIDE_TABS = ['numbers', 'batches'];
  const CLOSER_SIDE_TABS  = ['search', 'dnc', 'card_validator'];
  const sideAllowsTab = useCallback((key) => {
    if (!isCoAdmin || !coType) return true;
    if (coType === 'closer'  && FRONTER_SIDE_TABS.includes(key)) return false;
    if (coType === 'fronter' && CLOSER_SIDE_TABS.includes(key))  return false;
    return true;
  }, [isCoAdmin, coType]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Fronter-side viewers don't rate or disposition closer calls — their agents
  // weren't on them. Previously only fronter_manager was excluded, which left a
  // fronter company's admin with Rate / Dispo buttons on every transfer row.
  const isFronterSideViewer = user?.role === 'fronter_manager' || (isCoAdmin && coType === 'fronter');

  // Same rule for the KPI strip. Any role other than company_admin — and an
  // admin whose company_type hasn't loaded — keeps the full default order.
  const cardOrder = (!isCoAdmin || !coType)
    ? MGR_CARD_ORDER
    : (coType === 'fronter' ? FRONTER_CARD_ORDER : CLOSER_CARD_ORDER);
  const closerBoardFirst = isCoAdmin && coType === 'closer';

  const TABS = useMemo(
    () => applyManagerLayout(CODE_TABS).filter(t => sideAllowsTab(t.key)),
    [applyManagerLayout, CODE_TABS, sideAllowsTab],
  );

  // Groups, resolved against the tabs this user ACTUALLY has. An empty group
  // never renders, so a fronter admin sees no "Tools" chrome tab just because
  // the catalog defines one.
  const navGroups = useMemo(() => {
    const out = TAB_GROUPS
      .map(g => ({ ...g, items: TABS.filter(t => g.tabs.includes(t.key)) }))
      .filter(g => g.items.length > 0);
    const claimed = new Set(TAB_GROUPS.flatMap(g => g.tabs));
    const orphans = TABS.filter(t => !claimed.has(t.key));
    if (orphans.length) out.push({ id: 'g_more', label: 'More', icon: LayoutGrid, items: orphans });
    return out;
  }, [TABS]);


  const tabKeys = useMemo(() => new Set(TABS.map(t => t.key)), [TABS]);

  // Persisted across reloads — per-role storage key so manager state stays
  // distinct from any other role using the same machine.
  const mgrTabKey = `biztrix.managerTab.${user?.role || 'default'}`;
  const mgrNavKey = `biztrix.managerNav.${user?.role || 'default'}`;
  // Same storage keys as before — a reload still restores the tab. The change
  // is that each switch now pushes a history entry, so the iOS edge swipe goes
  // back a tab instead of falling through and dismissing the installed app.
  const [activeTab, setActiveTab] = useHistoryTab(mgrTabKey, 'overview');
  const [activeNav, setActiveNav] = useHistoryTab(mgrNavKey, 'dashboard', { param: 'nav' });

  // Which task group owns the current tab. MUST stay below the activeTab
  // declaration — it was above it, which is a temporal-dead-zone read on every
  // render, and it blanked the whole shell. Neither `vite build --minify false`
  // nor the terser build catches that: esbuild does no TDZ analysis and the
  // error only exists at runtime.
  const activeGroup = navGroups.find(g => g.items.some(t => t.key === activeTab)) || navGroups[0];
  const [exportOpen, setExportOpen] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);

  // Reconcile activeTab when admin layout hides the persisted tab key.
  // Without this, landing on a tab the admin just disabled would show
  // an empty body until the user manually picks another tab.
  useEffect(() => {
    if (TABS.length && !TABS.some(t => t.key === activeTab)) {
      const fallback = managerDefaultTab(TABS) || TABS[0]?.key;
      // `replace`: reconciling away a tab the admin hid is a correction, not a
      // place the user navigated to, so it must not become a back-stack entry.
      if (fallback) setActiveTab(fallback, { replace: true });
    }
  }, [TABS, activeTab, managerDefaultTab, setActiveTab]);

  // Notification deep-link → jump to the matching tab.
  const focus = useNavFocus();
  useEffect(() => {
    if (!focus) return;
    // batch was missing: this shell has a Batches tab, so a batch_received
    // notification resolved to a kind nobody here consumed.
    const KIND_TAB = { transfer: 'transfers', sale: 'sales', callback: 'callbacks', batch: 'batches' };
    const tab = KIND_TAB[focus.kind];
    setActiveNav('dashboard');
    if (tab && tabKeys.has(tab)) setActiveTab(tab);
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // Server-side sort, the same shape the Compliance record tabs use. Both
  // endpoints already accepted sort_by/sort_dir (TRANSFER_SORT / SALE_SORT) —
  // this shell simply never sent them, so its records were stuck on newest
  // first and you could not, say, pull the biggest monthly payments to the top.
  const [xferSort,  setXferSort]  = useState({ col: 'created_at', dir: 'desc' });
  const [salesSort, setSalesSort] = useState({ col: 'sale_date',  dir: 'desc' });
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

  // A notification carrying `open: 'drawer'` opens the record itself, not just
  // its tab (the tab switch is the `focus` effect further up, which still
  // runs). This call lives HERE, below the state it feeds, rather than next to
  // that effect: `setDetailSale` is a const declared on the line above, so
  // calling it from up there would be a temporal-dead-zone read — the kind
  // that builds green and blanks the page at runtime.
  useSaleDeepLink(focus, setDetailSale);

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
        sort_by: xferSort.col, sort_dir: xferSort.dir,
      };
      if (xferStatus) params.status  = xferStatus;
      if (xferAgent)  params.user_id = xferAgent;
      if (xferSearch) params.search  = xferSearch;
      const res = await client.get('transfers', { params });
      setXferTabRows(res.data.transfers || []);
      setXferTabTotal(res.data.total    || 0);
    } catch {} finally { setXferTabLoading(false); }
  }, [companyId, xferPage, xferStatus, xferAgent, xferSearch, date_from, date_to, xferTodayOnly, xferToday, xferSort]);

  const fetchSalesTab = useCallback(async () => {
    if (!companyId) return;
    setSalesTabLoading(true);
    try {
      // exclude_post_date: an un-charged post-date is a reminder, not a sale.
      // This tab has no disposition sub-tabs, so without the flag a post-date
      // surfaced here (and in the counts below) on its future sale_date, before
      // anyone had charged the card.
      const params = { company_id: companyId, page: salesPage, limit: PAGE_SIZE, date_from, date_to, sort_by: salesSort.col, sort_dir: salesSort.dir, exclude_post_date: true };
      if (salesStatus) params.status  = salesStatus;
      if (salesAgent)  params.user_id = salesAgent;
      if (salesSearch) params.search  = salesSearch;
      const res = await client.get('sales', { params });
      setSalesTabRows(res.data.sales || []);
      setSalesTabTotal(res.data.total || 0);
    } catch {} finally { setSalesTabLoading(false); }
  }, [companyId, salesPage, salesStatus, salesAgent, salesSearch, date_from, date_to, salesSort]);

  const loadOverview = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      // Leaderboard data + accurate total counts — all parallel
      const [tRes, sRes, soldRes, wonRes, pendingRes] = await Promise.all([
        client.get('transfers', { params: { company_id: companyId, limit: 1000, date_from, date_to } }),
        client.get('sales',     { params: { company_id: companyId, limit: 1000, date_from, date_to, exclude_post_date: true } }),
        client.get('sales',     { params: { company_id: companyId, limit: 1, page: 1, date_from, date_to, status: 'sold',           exclude_post_date: true } }),
        client.get('sales',     { params: { company_id: companyId, limit: 1, page: 1, date_from, date_to, status: 'closed_won',     exclude_post_date: true } }),
        client.get('sales',     { params: { company_id: companyId, limit: 1, page: 1, date_from, date_to, status: 'pending_review', exclude_post_date: true } }),
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

  // Clicking the active column flips direction; a new column starts descending,
  // because for every column here (newest date, biggest payment, latest status)
  // the interesting end is the top. Page resets to 1 — sorting while on page 4
  // of the old order lands you somewhere meaningless.
  const toggleXferSort = useCallback((col) => {
    setXferSort(s => ({ col, dir: s.col === col && s.dir === 'desc' ? 'asc' : 'desc' }));
    setXferPage(1);
  }, []);
  const toggleSalesSort = useCallback((col) => {
    setSalesSort(s => ({ col, dir: s.col === col && s.dir === 'desc' ? 'asc' : 'desc' }));
    setSalesPage(1);
  }, []);

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

  // ── KPI metric map ──────────────────────────────────────────────────────
  // Every data point a manager KPI card can display, keyed to match the
  // kpiCatalog metric keys. The SuperAdmin builder decides which of these land
  // in which card / slot; here we just supply each one's value + drill-down.
  const goSales = (status, range) => () => {
    setSalesStatus(status); setSalesAgent?.(''); setSalesPage(1);
    setDateRange(getPresetRange(range)); setActiveTab('team_sales');
  };
  const goXfer = (range) => () => {
    setXferStatus?.(''); setXferPage?.(1);
    setDateRange(getPresetRange(range)); setActiveTab('transfers');
  };
  const mgrMetrics = {
    transfers_today: { value: stats?.todayTransfers || 0, onClick: goXfer('today'), title: 'Transfers today' },
    transfers_month: { value: stats?.monthTransfers || 0, onClick: goXfer('month'), title: 'Transfers this month' },
    // ── "Total" means ALL TIME, not "whatever the date picker says" ─────────
    // overviewTotals comes from loadOverview, which passes date_from/date_to,
    // so with the default "Today" preset the segment labelled Total showed the
    // same number as the Today segment beside it — measured live as Transfers
    // Today 0 / Total 0 on a company holding 17,459, and Sales Today 1 /
    // Total 1 on 6,474. /stats/dashboard is already all-time AND role-scoped
    // server-side, so read the totals from there and keep overviewTotals for
    // the funnel + leaderboards, which SHOULD follow the picker.
    transfers_total: { value: stats?.totalTransfers ?? overviewTotals.transfers, onClick: goXfer('all'),   title: 'All transfers' },
    sales_today:     { value: stats?.todaySales || 0,     onClick: goSales('', 'today'),  title: 'Sales today' },
    sales_month:     { value: stats?.monthSales || 0,     onClick: goSales('', 'month'),  title: 'Sales this month' },
    sales_total:     { value: stats?.totalSales ?? overviewTotals.sales, onClick: goSales('', 'all'),    title: 'All sales' },
    approved_today:  { value: stats?.todayClosedWon || 0, onClick: goSales('closed_won', 'today') },
    approved_month:  { value: stats?.monthClosedWon || 0, onClick: goSales('closed_won', 'month') },
    // closedWon only: overviewTotals.approved summed status 'sold' + 'closed_won',
    // and 'sold' is 0 in every company in this database — the extra term bought
    // nothing but a second round-trip and a number that moved with the picker.
    approved_total:  { value: stats?.closedWon ?? overviewTotals.approved,    onClick: goSales('closed_won', 'all') },
    pending_total:   { value: stats?.awaitingCompliance ?? overviewTotals.pendingReview, onClick: () => { setSalesStatus('pending_review'); setSalesPage(1); setActiveTab('team_sales'); }, title: 'Show pending-review sales' },
    returned:        { value: stats?.needsRevision || 0, onClick: () => { setSalesStatus('needs_revision'); setSalesPage(1); setActiveTab('team_sales'); }, title: 'Sales compliance returned for revision' },
    cancelled_today: { value: stats?.todayCancelled || 0, onClick: goSales('cancelled', 'today') },
    cancelled_month: { value: stats?.monthCancelled || 0, onClick: goSales('cancelled', 'month') },
    cancelled_total: { value: stats?.cancelledSales || 0, onClick: goSales('cancelled', 'all') },
    resells_month:   { value: stats?.resellsThisMonth || 0, onClick: goSales('', 'month'), title: 'Resells this month' },
    resells_total:   { value: stats?.resellsTotal || 0,     onClick: goSales('', 'all'),   title: 'All resells' },
    dup_today:       { value: stats?.dupToday || 0, onClick: () => setDupOpen(true), title: 'View duplicate records (today)' },
    dup_month:       { value: stats?.dupMonth || 0, onClick: () => setDupOpen(true), title: 'View duplicate records (this month)' },
    dup_total:       { value: stats?.dupTotal || 0, onClick: () => setDupOpen(true), title: 'View all duplicate records' },
  };

  const renderMgrCard = (key) => {
    if (!isMgrCardVisible(key)) return null;
    const meta = MGR_CARD_META[key] || {};
    const cfg  = mgrCardConfig(key);
    const segments = (cfg.segments || [])
      .map(s => { const m = mgrMetrics[s.metric]; return m ? { key: s.metric, label: s.label, value: m.value, onClick: m.onClick, title: m.title, isPrimary: s.primary } : null; })
      .filter(Boolean);
    if (!segments.length) return null;
    return (
      <StatCardTriple key={key} label={cfg.label} icon={meta.icon} color={meta.color}
        accent={meta.accent} gradientFrom={meta.gradientFrom}
        loading={loading || !stats} segments={segments}
        caption={cfg.description || undefined} />
    );
  };

  return (
    <div className={`min-h-screen bg-bg relative ${user?.role === 'superadmin' ? '' : 'bsx-no-select'}`}>
      <DotGridBg />
      {updateAvailable && <UpdateBanner />}
      <AppHeader
        title={workspaceMode ? 'Custom Access Workspace' : (user?.role_name || 'Manager Dashboard')}
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
        onBrandClick={() => user?.role === 'superadmin' ? navigate('/admin') : setActiveNav('dashboard')}
      />

      <EngagementBanners />
      {activeNav !== 'dashboard' && <CrossRoleContent section={activeNav} user={user} />}
      {/* Compliance's shell padding — full width, no max-w cap. */}
      <main className="w-full px-4 sm:px-6 lg:px-8 xl:px-10 py-6 sm:py-8 relative z-10"
        style={{ display: activeNav !== 'dashboard' ? 'none' : undefined }}>

        {/* Page identity — SectionHeader level="page", the same treatment every
            migrated surface uses. The gradient survives only as the 9x9 icon
            chip; the hairline baseline under it is what makes the nav below
            read as belonging to this page instead of floating. */}
        <SectionHeader
          level="page"
          icon={TrendingUp}
          title={workspaceMode ? 'Custom Access Workspace' : (user?.company_name || 'Dashboard')}
          subtitle={`${user?.role_name || user?.role}${user?.first_name ? ` · ${[user.first_name, user.last_name].filter(Boolean).join(' ')}` : ''}`}
          actions={<div className="flex items-center gap-2 flex-wrap flex-shrink-0">
            {/* Export gated ONLY by Data Egress (canExport). We deliberately do
                NOT also gate on the shell-layout action toggle: that config
                loads async (~2s after mount) so it made the button flash in then
                vanish for fronter/closer/ops managers (shell.layout.manager had
                actions.export=false). Data Egress → Export Access is the single
                source of truth for who can export. */}
            {canExport() && (
              <button onClick={() => setExportOpen(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all hover:opacity-90"
                style={{ background: 'var(--gradient-sidebar)' }}>
                <FileSpreadsheet size={16} /> Export
              </button>
            )}
            <button onClick={loadOverview} className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-semibold transition-all hover:bg-bg-secondary"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
              <RefreshCw size={16} /> Refresh
            </button>
          </div>}
        />

        {exportOpen && <ManagerExportModal onClose={() => setExportOpen(false)} agents={companyAgents} />}
        {dupOpen && <DuplicateRecordsModal onClose={() => setDupOpen(false)} title="Duplicate Transfer Records" />}

        {/* Tier 1 — task groups. basis-full below sm puts the date picker on its
            own line rather than letting it eat ~180px out of the strip on a
            phone; with flex-1 the tabs shrank instead of the picker wrapping.
            Clicking a group jumps to its first tab, so there are no dead clicks. */}
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <ChromeTabs variant="chrome" className="basis-full sm:basis-0 sm:flex-1 min-w-0"
            items={navGroups.map(g => ({
              key: g.id, label: g.label, icon: g.icon,
              count: g.items.length > 1 ? g.items.length : null,
            }))}
            value={activeGroup?.id}
            onChange={gid => {
              const g = navGroups.find(x => x.id === gid);
              if (g?.items[0]) setActiveTab(g.items[0].key);
            }} />
          {isMgrFilterVisible('date_range') && (
            <DateRangePicker onChange={handleDateChange} defaultPreset="today" />
          )}
        </div>

        {/* Tier 2 — the active group's tabs. A one-tab group shows no second
            row at all; it still needs the bottom margin the row would have
            provided, or the content jumps up against the chrome tabs. */}
        {activeGroup && activeGroup.items.length > 1 ? (
          <ChromeTabs variant="pill" size="sm" className="mt-4 mb-6"
            items={activeGroup.items.map(t => ({ key: t.key, label: t.label, icon: t.icon }))}
            value={activeTab}
            onChange={setActiveTab} />
        ) : <div className="mb-6" />}

        {/* ── OVERVIEW TAB ── */}
        {activeTab === 'overview' && (
          <div className="space-y-6">

            <TargetsStrip />

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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {cardOrder.map(renderMgrCard)}
            </div>

            {/* ── One performance surface ──
                Five stacked panels used to live here: Team Performance, the
                funnel, the agent table and two leaderboards. Each answered an
                overlapping slice of the same question, each fetched its own
                window, and they disagreed with each other at the edges — the
                leaderboards ranked a 1,000-row sample while the funnel counted
                the full range. One panel, one request, one date range, one
                agent selector, so nothing on screen can contradict its
                neighbour. */}
            {/* Deliberately NOT seeded from the shell's date picker: that
                defaults to "Today", and a performance panel opening on a single
                day shows zeros and reads as broken. It owns its own window and
                opens on 30 days. */}
            {(hasPermission('view_fronter_stats') || hasPermission('view_closer_stats')) && (
              <CompanyPerformance />
            )}
          </div>
        )}

        {/* ── TEAM TRANSFERS TAB ── */}
        {activeTab === 'transfers' && (
          <Panel pad="lg">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h3 className="text-xl font-bold text-text flex items-center gap-2"><Send size={20} /> Team Transfers</h3>
              <span className="text-sm text-text-secondary">{xferTabTotal} total</span>
            </div>

            {/* Today chip */}
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <button
                onClick={() => { setXferTodayOnly(v => !v); setXferPage(1); }}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all"
                /* The active state was three baked-in blues (#eff6ff fill,
                   #2563eb text, #bfdbfe border). A near-white fill stays
                   near-white in dark mode while the text around it flips to
                   near-white too, so the pressed state read as an unreadable
                   1.15:1 smear. color-mix keeps the tint tied to the theme's
                   own info color at both ends. */
                style={{
                  backgroundColor: xferTodayOnly ? 'color-mix(in srgb, var(--color-info-600) 18%, transparent)' : 'var(--color-bg-secondary)',
                  color:            xferTodayOnly ? 'var(--color-info-600)' : 'var(--color-text-secondary)',
                  borderColor:      xferTodayOnly ? 'color-mix(in srgb, var(--color-info-600) 40%, transparent)' : 'var(--color-border)',
                }}>
                <CalendarDays size={12} />
                Created Today
                {xferTodayCount !== null && (
                  <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold"
                    style={{ backgroundColor: xferTodayOnly ? 'color-mix(in srgb, var(--color-info-600) 30%, transparent)' : 'var(--color-border)', color: xferTodayOnly ? 'var(--color-info-600)' : 'var(--color-text-secondary)' }}>
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
                <ThemedSelect value={xferAgent} onChange={e => { setXferAgent(e.target.value); setXferPage(1); }}
                  className="input text-xs h-auto" style={{ minWidth: 160, paddingTop: 6, paddingBottom: 6 }}>
                  <option value="">All agents</option>
                  {companyAgents.map(a => (
                    <option key={a.user_id} value={a.user_id}>{a.first_name} {a.last_name}</option>
                  ))}
                </ThemedSelect>
              )}
              onClearAll={() => { setXferSearch(''); setXferStatus(''); setXferAgent(''); setXferPage(1); }}
            />

            {xferTabLoading ? (
              <Loading variant="table" rows={5} />
            ) : xferTabRows.length === 0 ? (
              <EmptyState icon={Send} title="No transfers found"
                hint="Nothing matches the current date range and filters." />
            ) : (
              <>
                {/* Compliance record-tab treatment: a bordered surface holding
                    a condensed table, first column pinned so scrolling right
                    never leaves you reading an unidentifiable row, and the
                    customer's phone stacked under their name instead of eating
                    a whole column — that one change takes ~90px off the width
                    a phone has to scroll through. */}
                <div className="rounded-xl overflow-hidden"
                  style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <TableScroll stickyFirst inheritRowBg label="Team transfers">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                        <SortTh col="customer"   sort={xferSort} onSort={toggleXferSort}>Customer</SortTh>
                        <SortTh col="fronter"    sort={xferSort} onSort={toggleXferSort}>Fronter</SortTh>
                        <SortTh col="closer"     sort={xferSort} onSort={toggleXferSort}>Closer</SortTh>
                        <SortTh col="status"     sort={xferSort} onSort={toggleXferSort}>Status</SortTh>
                        <Th>Disposition</Th>
                        <SortTh col="created_at" sort={xferSort} onSort={toggleXferSort}>Date</SortTh>
                        <Th>Action</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {xferTabRows.map(t => (
                        <tr key={t.id} onClick={() => setDetailTransfer(t)}
                          className="cursor-pointer transition-colors"
                          style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}
                          onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)'; }}
                          onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'var(--color-surface)'; }}>
                          <td className="px-3 py-1.5">
                            <p className="m-0 font-semibold" style={{ color: 'var(--color-text)' }}>
                              {t.form_data?.customer_name || t.form_data?.FirstName || 'Lead'}
                            </p>
                            <p className="m-0 mt-0.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                              {transferPhone(t) || '—'}
                            </p>
                          </td>
                          <td className="px-3 py-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{t.fronter_name || '—'}</td>
                          <td className="px-3 py-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{t.closer ? `${t.closer.first_name || ''} ${t.closer.last_name || ''}`.trim() || '—' : '—'}</td>
                          <td className="px-3 py-1.5">{(() => { const ds = getTransferDisplayStatus(t); return <Badge variant={ds.variant} size="sm">{ds.label}</Badge>; })()}</td>
                          <td className="px-3 py-1.5">
                            {(t.latest_disposition || t.sale_closer_disposition) ? (() => {
                              const d = t.latest_disposition;
                              const name  = d?.disposition_name || t.sale_closer_disposition;
                              const color = d?.color || '#6b7280';
                              // Consistency: a dialer/fetch dispo carries setter_name; a dispo
                              // derived from the linked sale has none — fall back to the
                              // assigned closer so every row shows "by <closer>".
                              const closerName = t.closer ? `${t.closer.first_name || ''} ${t.closer.last_name || ''}`.trim() : '';
                              const setter = d?.setter_name || closerName || null;
                              return (
                                <div className="flex flex-col gap-0.5">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold w-fit"
                                    style={{ backgroundColor: color + '22', color, border: `1px solid ${color}44` }}>
                                    <MessageSquare size={9} />
                                    {name}
                                  </span>
                                  {setter && (
                                    <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                                      by {setter}
                                    </span>
                                  )}
                                </div>
                              );
                            })() : <span className="text-text-tertiary text-xs">—</span>}
                          </td>
                          <td className="px-3 py-1.5 text-xs whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>{fmtDateET(t.created_at)}</td>
                          <td className="px-3 py-1.5">
                            <div className="flex flex-wrap gap-1">
                              {!isFronterSideViewer && hasPermission('submit_call_review') && (
                                <button onClick={e => { e.stopPropagation(); setRateTarget(t); setRatingVal('good'); setRatingNotes(''); setRatingMsg(''); }}
                                  className="px-2 py-1.5 rounded-lg text-xs font-semibold border"
                                  style={{ borderColor: 'var(--color-primary-300)', color: 'var(--color-primary-600)' }}>
                                  <Star size={11} className="inline mr-1" />Rate
                                </button>
                              )}
                              {!isFronterSideViewer && hasPermission('submit_call_dispo') && (
                                <button onClick={e => { e.stopPropagation(); setDispoTarget(t); setDispoVal('sale'); setDispoNotes(''); setDispoMsg(''); }}
                                  className="px-2 py-1.5 rounded-lg text-xs font-semibold border"
                                  style={{ borderColor: 'var(--color-info-300)', color: 'var(--color-info-600)' }}>
                                  <MessageSquare size={11} className="inline mr-1" />Dispo
                                </button>
                              )}
                              {hasPermission('delete_transfer') && (
                                <Tooltip text="Delete this transfer">
                                  <button onClick={e => { e.stopPropagation(); if (window.confirm('Delete this transfer?')) { client.delete(`transfers/${t.id}`).then(() => fetchXferTab()); } }}
                                    className="px-2 py-1.5 rounded-lg text-xs font-semibold border"
                                    style={{ borderColor: 'var(--color-error-300)', color: 'var(--color-error-600)' }}>
                                    <Trash2 size={11} className="inline" />
                                  </button>
                                </Tooltip>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
                </div>
                <Pagination page={xferPage} total={xferTabTotal} pageSize={PAGE_SIZE} onChange={setXferPage} />
              </>
            )}
          </Panel>
        )}

        {/* ── TEAM SALES TAB ── */}
        {activeTab === 'team_sales' && (
          <Panel pad="lg">
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
                <ThemedSelect value={salesAgent} onChange={e => { setSalesAgent(e.target.value); setSalesPage(1); }}
                  className="input text-xs h-auto" style={{ minWidth: 160, paddingTop: 6, paddingBottom: 6 }}>
                  <option value="">All agents</option>
                  {companyAgents.map(a => (
                    <option key={a.user_id} value={a.user_id}>{a.first_name} {a.last_name}</option>
                  ))}
                </ThemedSelect>
              )}
              onClearAll={() => { setSalesSearch(''); setSalesStatus(''); setSalesAgent(''); setSalesPage(1); }}
            />

            {salesTabLoading ? (
              <Loading variant="table" rows={5} />
            ) : salesTabRows.length === 0 ? (
              <EmptyState icon={DollarSign} title="No sales found"
                hint="Nothing matches the current date range and filters." />
            ) : (
              <>
                <div className="rounded-xl overflow-hidden"
                  style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <TableScroll stickyFirst inheritRowBg label="Team sales">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                        <SortTh col="customer"  sort={salesSort} onSort={toggleSalesSort}>Customer</SortTh>
                        <SortTh col="status"    sort={salesSort} onSort={toggleSalesSort}>Status</SortTh>
                        <SortTh col="fronter"   sort={salesSort} onSort={toggleSalesSort}>Fronter</SortTh>
                        <SortTh col="closer"    sort={salesSort} onSort={toggleSalesSort}>Closer</SortTh>
                        {hasPermission('view_financial_data') && (
                          <SortTh col="monthly_payment" sort={salesSort} onSort={toggleSalesSort}>Monthly</SortTh>
                        )}
                        <SortTh col="sale_date" sort={salesSort} onSort={toggleSalesSort}>Sale Date</SortTh>
                        {/* Superadmin-set flag (Compliance Sales tab Update popup) — the
                            company's own payout status, separate from the individual
                            closer's "Paid to closer" incentive. company_admin only. */}
                        {isCoAdmin && <Th>Paid to Partner</Th>}
                        {hasPermission('delete_sale') && <Th>Action</Th>}
                      </tr>
                    </thead>
                    <tbody>
                      {salesTabRows.map(s => (
                        <tr key={s.id} onClick={() => setDetailSale(s)}
                          className="cursor-pointer transition-colors"
                          style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}
                          onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)'; }}
                          onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'var(--color-surface)'; }}>
                          {/* Reference moves under the name, the way the
                              Compliance sales tab stacks it — it was a whole
                              column for a value you only ever read alongside
                              the customer anyway. */}
                          <td className="px-3 py-1.5">
                            <p className="m-0 font-semibold" style={{ color: 'var(--color-text)' }}>{s.customer_name || '—'}</p>
                            {s.reference_no && (
                              <p className="m-0 mt-0.5 text-xs font-mono" style={{ color: 'var(--color-text-tertiary)' }}>#{s.reference_no}</p>
                            )}
                          </td>
                          <td className="px-3 py-1.5"><div className="flex items-center gap-1.5 flex-wrap"><SaleStatusBadge sale={s} size="sm" />{s.is_resell && <span title={`Resell · ${s.resell_intent || ''}`} className="inline-flex items-center gap-1 text-[11px] sm:text-[10px] leading-none font-bold uppercase tracking-wide px-1.5 py-0.5 rounded whitespace-nowrap" style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary-600) 20%, transparent)', color: 'var(--color-primary-600)' }}>↻ {(s.resell_intent || 'resell').replace(/_/g, ' ')}</span>}</div></td>
                          <td className="px-3 py-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{s.fronter_name || '—'}</td>
                          <td className="px-3 py-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{s.closer_name || '—'}</td>
                          {hasPermission('view_financial_data') && <td className="px-3 py-1.5 text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--color-success-600)' }}>{s.monthly_payment ? `$${s.monthly_payment}/mo` : '—'}</td>}
                          {/* Show the actual sale_date (carried in the bulk upload) rather
                              than the row's created_at — created_at reflects when the row
                              was inserted/updated, which is misleading for back-filled sales. */}
                          {/* sale_date is a date-only column ("YYYY-MM-DD"). fmtSaleDate
                              prints it as the calendar day stored, never shifting one
                              day backward in US timezones the way fmtDateET would. */}
                          <td className="px-3 py-1.5 text-xs whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>{s.sale_date ? fmtSaleDate(s.sale_date) : fmtDateET(s.created_at)}</td>
                          {isCoAdmin && (
                            <td className="px-3 py-1.5">
                              <span className="inline-flex items-center text-[11px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap"
                                style={{
                                  backgroundColor: s.paid_to_partner ? 'var(--color-success-100)' : 'var(--color-bg-secondary)',
                                  color: s.paid_to_partner ? 'var(--color-success-700)' : 'var(--color-text-tertiary)',
                                }}>
                                {s.paid_to_partner ? 'Paid' : 'Pending'}
                              </span>
                            </td>
                          )}
                          {hasPermission('delete_sale') && (
                            <td className="px-3 py-1.5">
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
                </TableScroll>
                </div>
                <Pagination page={salesPage} total={salesTabTotal} pageSize={PAGE_SIZE} onChange={setSalesPage} />
              </>
            )}
          </Panel>
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
            <Panel pad="lg">
              {salesLoading ? <Loading variant="table" rows={5} />
                : sales.filter(s => s.closer_id === user?.id).length === 0 ? <EmptyState compact icon={DollarSign} title="No personal sales yet" />
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
            </Panel>
          </div>
        )}

        {/* ── ACTIVITY LOG TAB ── */}
        {activeTab === 'activity_log' && (
          <Panel pad="lg">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h3 className="text-xl font-bold text-text flex items-center gap-2"><Activity size={20} /> Activity Log</h3>
              {companyAgents.length > 0 && (
                <ThemedSelect
                  value={activityAgent}
                  onChange={e => { setActivityAgent(e.target.value); setActivityPage(1); }}
                  className="input py-1.5 text-sm h-auto" style={{ minWidth: 160 }}>
                  <option value="">All agents</option>
                  {companyAgents.map(a => (
                    <option key={a.user_id} value={a.user_id}>
                      {`${a.first_name || ''} ${a.last_name || ''}`.trim() || a.email || ''}
                    </option>
                  ))}
                </ThemedSelect>
              )}
            </div>
            {activityLoading ? (
              <Loading variant="table" rows={5} />
            ) : activityLogs.length === 0 ? (
              <EmptyState icon={Activity} title="No activity yet"
                hint="Actions taken on this company's records will appear here." />
            ) : (
              <>
                <TableScroll stickyFirst label="Activity log">
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
                </TableScroll>
                <Pagination page={activityPage} total={activityTotal} pageSize={PAGE_SIZE} onChange={setActivityPage} />
              </>
            )}
          </Panel>
        )}

        {/* ── PANEL TABS (reuse existing components) ── */}
        {activeTab === 'my_team'   && <MyTeam />}
        {activeTab === 'teams'     && <TeamManager />}
        {activeTab === 'quota_report' && <QuotaReport />}
        {activeTab === 'callbacks' && <ManagerCallbacksTab user={user} />}
        {activeTab === 'numbers'   && (
          <div className="space-y-6">
            {isEnabled('callback_numbers') && <CallbackNumbers user={user} />}
            {/* Number Assignment (day-scoped number_lists) retired — uploading and
                assigning numbers now happens in Batches. */}
          </div>
        )}
        {activeTab === 'search'    && <SaleSearch />}
        {activeTab === 'batches'   && <BatchInbox />}
        {activeTab === 'roster'    && <BatchRoster />}
        {activeTab === 'note_shortcodes' && <NoteShortcodesManager />}
        {activeTab === 'faqs'      && (hasPermission('manage_faqs') ? <FAQManager /> : <FAQPanel />)}
        {activeTab === 'scripts'   && (hasPermission('manage_faqs') ? <ScriptManager /> : <ScriptPanel />)}
        {activeTab === 'calendar'  && <EventsCalendar canEdit={false} />}
        {activeTab === 'team'      && <TeamManagementPanel companyId={companyId} />}
        {activeTab === 'roles'     && <RoleManagementPanel companyId={companyId} />}
        {activeTab === 'reviews'   && <ReviewsPanel companyId={companyId} />}
        {activeTab === 'reports'   && <ReportsPanel companyId={companyId} />}
        {activeTab === 'forms'     && (
          <div className="animate-fade-in">
            <Suspense fallback={<Loading variant="block" height={200} />}>
              <FormBuilder />
            </Suspense>
          </div>
        )}
        {activeTab === 'spiffs'    && (
          <Suspense fallback={<Loading variant="block" height={200} />}>
            <SpiffManager />
          </Suspense>
        )}
        {/* Delegated superadmin tools — gated by the tool flag on the nav side. */}
        {activeTab === 'tool_customer_profiles' && isEnabledStrict('tool_customer_profiles') && (
          <Suspense fallback={<Loading variant="block" height={200} />}>
            <CustomerProfile />
          </Suspense>
        )}
        {activeTab === 'tool_data_analyzer' && isEnabledStrict('tool_data_analyzer') && (
          <Suspense fallback={<Loading variant="block" height={200} />}>
            <DataAnalyzer />
          </Suspense>
        )}
        {activeTab === 'tool_chat_control' && isEnabledStrict('tool_chat_control') && (
          <Suspense fallback={<Loading variant="block" height={200} />}>
            <ChatAdmin />
          </Suspense>
        )}
        {activeTab === 'tool_compliance_review' && isEnabledStrict('tool_compliance_review') && (
          <Suspense fallback={<Loading variant="block" height={200} />}>
            <ComplianceReviewPanel />
          </Suspense>
        )}
        {activeTab === 'tool_business_rules' && isEnabledStrict('tool_business_rules') && (
          <Suspense fallback={<Loading variant="block" height={200} />}>
            <BusinessRulesHub />
          </Suspense>
        )}
        {activeTab === 'tool_feature_admin' && isEnabledStrict('tool_feature_admin') && (
          <Suspense fallback={<Loading variant="block" height={200} />}>
            <FeatureFlagsManager />
          </Suspense>
        )}
        {activeTab === 'tool_company_admin' && isEnabledStrict('tool_company_admin') && (
          <Suspense fallback={<Loading variant="block" height={200} />}>
            <CompanyManagement />
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
            <ThemedSelect value={dispoVal} onChange={e => setDispoVal(e.target.value)} className="input mb-3">
              {DISPOS.map(d => <option key={d} value={d}>{d.replace(/_/g, ' ')}</option>)}
            </ThemedSelect>
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
