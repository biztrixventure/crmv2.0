import { useState, useEffect, useCallback, useMemo } from 'react';
import { usePersistedState } from '../hooks/usePersistedState';
import { useShellLayout } from '../hooks/useShellLayout';
import { Shield, Building2, Clock, FileText, ArrowRight, PhoneCall, Star, Hash, CalendarDays, Info, ListChecks } from 'lucide-react';
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
import { CalendarClock } from 'lucide-react';

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

const CODE_TABS = [
  { key: 'companies',   label: 'Companies',          icon: Building2 },
  { key: 'calendar',    label: 'Calendar',           icon: CalendarDays },
  { key: 'queue',       label: 'Review Queue',       icon: Clock },
  { key: 'sales',       label: 'All Sales',          icon: FileText },
  { key: 'bulk_status', label: 'Bulk Status Update', icon: ListChecks },
  { key: 'transfers',   label: 'Transfers',          icon: ArrowRight },
  { key: 'callbacks',   label: 'Callbacks',          icon: PhoneCall },
  { key: 'reviews',     label: 'Call Reviews',       icon: Star },
  { key: 'numbers',     label: 'Call Numbers',       icon: Hash },
];

const ComplianceShell = () => {
  const { user, logout, updateUser } = useAuth();
  const { theme, toggleTheme }       = useTheme();
  const navigate = useNavigate();
  const notifHook = useNotifications();
  const updateAvailable = useVersionCheck();

  // Layer admin override onto the code-defined catalog.
  const { applyTabs: applyComplianceLayout, defaultTab: complianceDefaultTab } = useShellLayout('compliance');
  const TABS = useMemo(() => applyComplianceLayout(CODE_TABS), [applyComplianceLayout]);

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

        {/* Tab bar (+ superadmin numbers-info button) */}
        <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <div className="flex flex-wrap gap-1 p-1 rounded-xl w-fit"
          style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
              style={{
                background: activeTab === t.key ? 'var(--gradient-sidebar)' : 'transparent',
                color:      activeTab === t.key ? 'white' : 'var(--color-text-secondary)',
                boxShadow:  activeTab === t.key ? 'var(--shadow-sm)' : 'none',
              }}>
              <t.icon size={14} />
              {t.label}
            </button>
          ))}
          {/* Dynamic disposition tabs (e.g. Post Date), sit beside All Sales. */}
          {dispoTabs.map(d => {
            const k = `dispo:${d.value}`;
            const active = activeTab === k;
            return (
              <button key={k} onClick={() => setActiveTab(k)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
                style={{
                  background: active ? 'var(--gradient-sidebar)' : 'transparent',
                  color:      active ? 'white' : 'var(--color-text-secondary)',
                  boxShadow:  active ? 'var(--shadow-sm)' : 'none',
                }}>
                <CalendarClock size={14} />
                {d.label}
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
        <DevCredit />
      </main>
    </div>
  );
};

export default ComplianceShell;
