import { useState, useEffect, useCallback, useMemo } from 'react';
import { usePersistedState } from '../hooks/usePersistedState';
import { useShellLayout } from '../hooks/useShellLayout';
import { Shield, Building2, Clock, FileText, ArrowRight, PhoneCall, Star, Hash, CalendarDays, Info, ListChecks, ScrollText, HelpCircle, ClipboardCheck, CreditCard, Headphones } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useVersionCheck } from '../hooks/useVersionCheck';
import UpdateBanner from '../components/UI/UpdateBanner';
import { useTheme } from '../contexts/ThemeContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { AppHeader } from '../components/Layout';
import EngagementBanners from '../components/Engagement/EngagementBanners';
import { useNotifications } from '../hooks/useNotifications';
import { useFormFields } from '../hooks/useFormFields';
import { useFocus } from '../contexts/FocusContext';
import { dispositionTabs, isPostDateDispo } from '../utils/dispositions';
import client from '../api/client';
import DevCredit from '../components/DevCredit';
import { CalendarClock, AlertTriangle } from 'lucide-react';
import PaymentRemindersPanel from '../components/Payments/PaymentRemindersPanel';
import ComplianceDncReport from '../components/Shared/ComplianceDncReport';
import CardValidator from '../components/Shared/CardValidator';
import { useFeatureFlags } from '../contexts/FeatureFlagsContext';

import CompaniesTab        from '../components/Compliance/CompaniesTab';
import QueueTab            from '../components/Compliance/QueueTab';
import SalesTab            from '../components/Compliance/SalesTab';
import TransfersTab        from '../components/Compliance/TransfersTab';
import CallbacksTab        from '../components/Compliance/CallbacksTab';
import ReviewsTab          from '../components/Compliance/ReviewsTab';
import CallbackNumbersTab  from '../components/Compliance/CallbackNumbersTab';
import BulkStatusUpdate    from '../components/Compliance/BulkStatusUpdate';
import EventsCalendar      from '../components/Calendar/EventsCalendar';
import ComplianceInfoModal from '../components/Compliance/ComplianceInfoModal';
import ScriptManager      from '../components/Admin/ScriptManager/ScriptManager';
import FAQManager         from '../components/Admin/FAQManager/FAQManager';
import CallQuestionsManager from '../components/Compliance/CallQuestionsManager';
import RecordingReviewTab  from '../components/Compliance/RecordingReviewTab';
import BatchInbox          from '../components/Distribution/BatchInbox';
import BatchRoster         from '../components/Distribution/BatchRoster';

const CODE_TABS = [
  { key: 'companies',   label: 'Companies',          icon: Building2 },
  { key: 'calendar',    label: 'Calendar',           icon: CalendarDays },
  { key: 'queue',       label: 'Review Queue',       icon: Clock },
  { key: 'payments',    label: 'Payments at Risk',   icon: AlertTriangle },
  { key: 'sales',       label: 'All Sales',          icon: FileText },
  { key: 'rec_review',  label: 'Recording Review',   icon: Headphones },
  { key: 'batches',     label: 'Batches',            icon: Building2 },
  { key: 'roster',      label: 'Assigned Numbers',   icon: ListChecks },
  { key: 'bulk_status', label: 'Bulk Status Update', icon: ListChecks },
  { key: 'transfers',   label: 'Transfers',          icon: ArrowRight },
  { key: 'callbacks',   label: 'Callbacks',          icon: PhoneCall },
  { key: 'reviews',     label: 'Call Reviews',       icon: Star },
  { key: 'numbers',     label: 'Call Numbers',       icon: Hash },
  { key: 'scripts',     label: 'Scripts & Rebuttals', icon: ScrollText },
  { key: 'faqs',        label: 'FAQs',               icon: HelpCircle },
  { key: 'questions',   label: 'Call Questions',     icon: ClipboardCheck },
  { key: 'dnc',         label: 'DNC Check',          icon: Shield, flag: 'tool_blacklist_lookup' },
  { key: 'card_validator', label: 'Card Validator',  icon: CreditCard, flag: 'tool_card_validator' },
];

// ── Two-tier navigation (UX cleanup) ─────────────────────────────────────────
// 18 flat tabs were unusable — group them into 6 task-shaped clusters. This is
// pure chrome: tab KEYS, content rendering, admin layout (useShellLayout),
// deep-links and persistence are untouched. Tabs the admin layout hides simply
// drop out of their group; a key we don't recognize (future tabs) lands in
// "More" so nothing can ever disappear.
const TAB_GROUPS = [
  { id: 'overview', label: 'Overview',        icon: Building2,      keys: ['companies', 'calendar'] },
  { id: 'review',   label: 'Compliance Work', icon: Clock,          keys: ['queue', 'rec_review', 'payments', 'bulk_status'] },
  { id: 'records',  label: 'Records',         icon: FileText,       keys: ['sales', 'transfers', 'callbacks'] },
  { id: 'numbers',  label: 'Numbers',         icon: Hash,           keys: ['batches', 'roster', 'numbers'] },
  { id: 'quality',  label: 'Quality',         icon: Star,           keys: ['reviews', 'questions', 'scripts', 'faqs'] },
  { id: 'tools',    label: 'Tools',           icon: Shield,         keys: ['dnc', 'card_validator'] },
];

const ComplianceShell = () => {
  const { user, logout, updateUser } = useAuth();
  const { theme, toggleTheme }       = useTheme();
  const navigate = useNavigate();
  const notifHook = useNotifications();
  const updateAvailable = useVersionCheck();
  const { isEnabledStrict } = useFeatureFlags();

  // Layer admin override onto the code-defined catalog. Feature-gated tabs
  // (e.g. DNC) drop out unless their flag is on for this company — but superadmin
  // always sees them (superadmin bypasses feature gating everywhere).
  const isSuperadmin = user?.role === 'superadmin';
  const { applyTabs: applyComplianceLayout, defaultTab: complianceDefaultTab } = useShellLayout('compliance');
  const TABS = useMemo(
    () => applyComplianceLayout(CODE_TABS.filter(t => !t.flag || isSuperadmin || isEnabledStrict(t.flag))),
    [applyComplianceLayout, isEnabledStrict, isSuperadmin],
  );

  // Dynamic disposition tabs (e.g. "Post Date") — one per non-"sale" disposition
  // the admin configured on the sale-disposition form field. Renaming a
  // disposition in Form Builder retitles the tab automatically.
  const { fields: dispoFields, fetchFields } = useFormFields();
  useEffect(() => { fetchFields(); }, [fetchFields]);
  const dispoTabs = useMemo(() => dispositionTabs(dispoFields), [dispoFields]);

  // Honor an initial-tab hint passed via router state (the AdminPanel sidebar
  // links straight into specific tabs, e.g. "All Sales", so superadmin lands on
  // the right view instead of always on Companies).
  const location = useLocation();
  const initialTab = TABS.find(t => t.key === location.state?.tab)?.key
    || complianceDefaultTab(TABS)
    || TABS[0]?.key
    || 'companies';
  const [activeTab, setActiveTab]   = useState(initialTab);

  // Reconcile activeTab when admin layout hides the persisted tab key.
  // Dynamic disposition tabs (dispo:*) are exempt — they aren't in TABS.
  useEffect(() => {
    if (activeTab.startsWith('dispo:')) return;
    if (TABS.length && !TABS.some(t => t.key === activeTab)) {
      const fallback = complianceDefaultTab(TABS) || TABS[0]?.key;
      if (fallback) setActiveTab(fallback);
    }
  }, [TABS, activeTab, complianceDefaultTab]);
  const [tabInit, setTabInit]       = useState({});
  const [infoOpen, setInfoOpen]     = useState(false);

  // Group the (admin-filtered, admin-ordered) TABS into the fixed clusters,
  // preserving the layout's order inside each group. Unknown keys → "More".
  const groups = useMemo(() => {
    const groupOf = new Map();
    TAB_GROUPS.forEach(g => g.keys.forEach(k => groupOf.set(k, g.id)));
    const byId = Object.fromEntries(TAB_GROUPS.map(g => [g.id, { ...g, tabs: [] }]));
    const more = { id: 'more', label: 'More', icon: ListChecks, tabs: [] };
    TABS.forEach(t => { const gid = groupOf.get(t.key); (gid ? byId[gid] : more).tabs.push(t); });
    const list = TAB_GROUPS.map(g => byId[g.id]).filter(g => g.tabs.length);
    if (more.tabs.length) list.push(more);
    return list;
  }, [TABS]);

  // The group that owns the active tab (dispo:* tabs live beside All Sales).
  const dispoHostId = useMemo(
    () => groups.find(g => g.tabs.some(t => t.key === 'sales'))?.id || groups[0]?.id,
    [groups],
  );
  const activeGroupId = useMemo(() => {
    if (activeTab.startsWith('dispo:')) return dispoHostId;
    return groups.find(g => g.tabs.some(t => t.key === activeTab))?.id || groups[0]?.id;
  }, [groups, activeTab, dispoHostId]);
  const activeGroup = groups.find(g => g.id === activeGroupId);

  // Report the active section to the assistant for section-specific guidance.
  useEffect(() => { window.crmAssistant?.setSection?.(activeTab); }, [activeTab]);

  // Notification deep-link: a clicked notification (bell or OS push) sets a
  // focus target → jump to the matching tab so the record is in view + the row
  // self-highlights (useFocusHighlight) for ~5s.
  const { focus } = useFocus();
  useEffect(() => {
    if (!focus) return;
    const KIND_TAB = { sale: 'sales', transfer: 'transfers', callback: 'callbacks', number: 'numbers' };
    const tab = KIND_TAB[focus.kind];
    if (tab && TABS.some(t => t.key === tab)) setActiveTab(tab);
  }, [focus, TABS]);
  const [companyList, setCompanyList] = useState([]);
  const [loadingCo, setLoadingCo]   = useState(false);

  const loadCompanies = useCallback(async () => {
    setLoadingCo(true);
    try {
      const res = await client.get('compliance/companies');
      setCompanyList(res.data.companies || []);
    } catch { /* non-critical */ } finally { setLoadingCo(false); }
  }, []);

  useEffect(() => { loadCompanies(); }, [loadCompanies]);

  // Cross-tab navigation: CompaniesTab "View Sales" → SalesTab pre-filtered
  const navigateTo = useCallback((tab, init = {}) => {
    setTabInit(init);
    setActiveTab(tab);
  }, []);

  const handleLogout = () => { logout(); navigate('/login'); };

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      {updateAvailable && <UpdateBanner />}
      <AppHeader
        title="Compliance"
        logo={
          <div className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ background: 'var(--gradient-sidebar)' }}>
            <Shield className="text-white" size={22} />
          </div>
        }
        companyLogoUrl={user?.company_logo_url}
        theme={theme} onThemeToggle={toggleTheme}
        userEmail={user?.email}
        userRole={user?.role_name || 'Compliance Manager'}
        onLogout={handleLogout}
        user={user} onUpdateUser={updateUser}
        notifications={notifHook.notifications}
        unreadCount={notifHook.unreadCount}
        onMarkRead={notifHook.markRead}
        onMarkAllRead={notifHook.markAllRead}
        onDeleteNotification={notifHook.deleteNotification}
        onClearNotifications={notifHook.clearAll}
      />

      <EngagementBanners />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Two-tier nav: 6 task groups on top, the active group's tabs below.
            Clicking a group jumps straight to its first tab (no dead clicks). */}
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex flex-wrap gap-1 p-1 rounded-xl w-fit"
            style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            {groups.map(g => {
              const active = g.id === activeGroupId;
              return (
                <button key={g.id}
                  onClick={() => { if (!active && g.tabs[0]) setActiveTab(g.tabs[0].key); }}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all"
                  style={{
                    background: active ? 'var(--gradient-sidebar)' : 'transparent',
                    color:      active ? 'white' : 'var(--color-text-secondary)',
                    boxShadow:  active ? 'var(--shadow-sm)' : 'none',
                  }}>
                  <g.icon size={15} />
                  {g.label}
                  {g.tabs.length > 1 && (
                    <span className="text-[10px] font-bold px-1.5 rounded-full"
                      style={{ background: active ? 'rgba(255,255,255,0.25)' : 'var(--color-surface)', color: active ? '#fff' : 'var(--color-text-tertiary)' }}>
                      {g.tabs.length + (g.id === dispoHostId ? dispoTabs.length : 0)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {user?.role === 'superadmin' && (
            <button onClick={() => setInfoOpen(true)} title="What do these numbers mean?"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-colors flex-shrink-0"
              style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-surface)' }}>
              <Info size={15} /> Numbers info
            </button>
          )}
        </div>

        {/* Second tier — the active group's tabs (+ dispo tabs beside All Sales). */}
        {activeGroup && (activeGroup.tabs.length > 1 || (activeGroupId === dispoHostId && dispoTabs.length > 0)) && (
          <div className="flex flex-wrap gap-1 mb-6 w-fit">
            {activeGroup.tabs.map(t => (
              <button key={t.key} onClick={() => setActiveTab(t.key)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-all"
                style={{
                  background: activeTab === t.key ? 'var(--color-primary-100, #e0e7ff)' : 'transparent',
                  color:      activeTab === t.key ? 'var(--color-primary-700, #4338ca)' : 'var(--color-text-secondary)',
                  border:     `1px solid ${activeTab === t.key ? 'var(--color-primary-300, #c7d2fe)' : 'var(--color-border)'}`,
                }}>
                <t.icon size={13} />
                {t.label}
              </button>
            ))}
            {/* Dynamic disposition tabs (e.g. Post Date) sit beside All Sales. */}
            {activeGroupId === dispoHostId && dispoTabs.map(d => {
              const k = `dispo:${d.value}`;
              const active = activeTab === k;
              return (
                <button key={k} onClick={() => setActiveTab(k)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-all"
                  style={{
                    background: active ? 'var(--color-primary-100, #e0e7ff)' : 'transparent',
                    color:      active ? 'var(--color-primary-700, #4338ca)' : 'var(--color-text-secondary)',
                    border:     `1px solid ${active ? 'var(--color-primary-300, #c7d2fe)' : 'var(--color-border)'}`,
                  }}>
                  <CalendarClock size={13} />
                  {d.label}
                </button>
              );
            })}
          </div>
        )}
        {/* single-tab group still needs its bottom margin */}
        {activeGroup && activeGroup.tabs.length <= 1 && !(activeGroupId === dispoHostId && dispoTabs.length > 0) && <div className="mb-3" />}

        {infoOpen && <ComplianceInfoModal onClose={() => setInfoOpen(false)} />}

        {/* Tab content */}
        {activeTab === 'companies' && (
          <CompaniesTab
            companyList={companyList}
            loading={loadingCo}
            onRefresh={loadCompanies}
            onNavigate={navigateTo}
          />
        )}
        {activeTab === 'calendar' && (
          <EventsCalendar canEdit={false} />
        )}
        {activeTab === 'queue' && (
          <QueueTab companyList={companyList} />
        )}
        {activeTab === 'sales' && (
          <SalesTab
            key={`${tabInit.company || 'all'}:${tabInit.status || ''}`}
            companyList={companyList}
            initCompany={tabInit.company || ''}
            initStatus={tabInit.status || ''}
          />
        )}
        {/* Disposition tab content — same SalesTab, scoped to one disposition. */}
        {activeTab.startsWith('dispo:') && (
          <SalesTab
            key={activeTab}
            companyList={companyList}
            disposition={activeTab.slice(6)}
            isPostDate={isPostDateDispo(activeTab.slice(6))}
          />
        )}
        {activeTab === 'rec_review' && <RecordingReviewTab companyList={companyList} />}
        {activeTab === 'batches' && <BatchInbox />}
        {activeTab === 'roster' && <BatchRoster />}
        {activeTab === 'payments' && <PaymentRemindersPanel />}
        {activeTab === 'dnc' && <ComplianceDncReport />}
        {activeTab === 'card_validator' && <CardValidator />}
        {activeTab === 'bulk_status' && <BulkStatusUpdate />}
        {activeTab === 'transfers' && (
          <TransfersTab
            key={`${tabInit.company || 'all'}:${tabInit.status || ''}`}
            companyList={companyList}
            initCompany={tabInit.company || ''}
            initStatus={tabInit.status || ''}
          />
        )}
        {activeTab === 'callbacks' && (
          <CallbacksTab companyList={companyList} />
        )}
        {activeTab === 'reviews' && (
          <ReviewsTab companyList={companyList} />
        )}
        {activeTab === 'numbers' && (
          <CallbackNumbersTab companyList={companyList} />
        )}
        {/* Full knowledge-base CRUD — compliance manages scripts/rebuttals + FAQs
            for every audience (fronter + closer + both), same as the superadmin. */}
        {activeTab === 'scripts' && <ScriptManager />}
        {activeTab === 'faqs'    && <FAQManager />}
        {activeTab === 'questions' && <CallQuestionsManager />}
        <DevCredit />
      </main>
    </div>
  );
};

export default ComplianceShell;
