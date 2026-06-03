import { useState, useEffect, useCallback } from 'react';
import { usePersistedState } from '../hooks/usePersistedState';
import { Shield, Building2, Clock, FileText, ArrowRight, PhoneCall, Star, Hash, CalendarDays, Info } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useVersionCheck } from '../hooks/useVersionCheck';
import UpdateBanner from '../components/UI/UpdateBanner';
import { useTheme } from '../contexts/ThemeContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { AppHeader } from '../components/Layout';
import EngagementBanners from '../components/Engagement/EngagementBanners';
import { useNotifications } from '../hooks/useNotifications';
import client from '../api/client';
import DevCredit from '../components/DevCredit';

import CompaniesTab        from '../components/Compliance/CompaniesTab';
import QueueTab            from '../components/Compliance/QueueTab';
import SalesTab            from '../components/Compliance/SalesTab';
import TransfersTab        from '../components/Compliance/TransfersTab';
import CallbacksTab        from '../components/Compliance/CallbacksTab';
import ReviewsTab          from '../components/Compliance/ReviewsTab';
import CallbackNumbersTab  from '../components/Compliance/CallbackNumbersTab';
import EventsCalendar      from '../components/Calendar/EventsCalendar';
import ComplianceInfoModal from '../components/Compliance/ComplianceInfoModal';

const TABS = [
  { key: 'companies', label: 'Companies',    icon: Building2 },
  { key: 'calendar',  label: 'Calendar',     icon: CalendarDays },
  { key: 'queue',     label: 'Review Queue', icon: Clock },
  { key: 'sales',     label: 'All Sales',    icon: FileText },
  { key: 'transfers', label: 'Transfers',    icon: ArrowRight },
  { key: 'callbacks', label: 'Callbacks',    icon: PhoneCall },
  { key: 'reviews',   label: 'Call Reviews', icon: Star },
  { key: 'numbers',   label: 'Call Numbers', icon: Hash },
];

const ComplianceShell = () => {
  const { user, logout, updateUser } = useAuth();
  const { theme, toggleTheme }       = useTheme();
  const navigate = useNavigate();
  const notifHook = useNotifications();
  const updateAvailable = useVersionCheck();

  // Honor an initial-tab hint passed via router state (the AdminPanel sidebar
  // links straight into specific tabs, e.g. "All Sales", so superadmin lands on
  // the right view instead of always on Companies).
  const location = useLocation();
  const initialTab = TABS.find(t => t.key === location.state?.tab)?.key || 'companies';
  const [activeTab, setActiveTab]   = useState(initialTab);
  const [tabInit, setTabInit]       = useState({});
  const [infoOpen, setInfoOpen]     = useState(false);

  // Report the active section to the assistant for section-specific guidance.
  useEffect(() => { window.crmAssistant?.setSection?.(activeTab); }, [activeTab]);
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
    <div className={`min-h-screen ${user?.role === 'superadmin' ? '' : 'bsx-no-select'}`} style={{ backgroundColor: 'var(--color-bg)' }}>
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
            key={tabInit.company || 'all'}
            companyList={companyList}
            initCompany={tabInit.company || ''}
          />
        )}
        {activeTab === 'transfers' && (
          <TransfersTab
            key={tabInit.company || 'all'}
            companyList={companyList}
            initCompany={tabInit.company || ''}
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
