// ============================================================================
// AccountingShell -- the /accounting surface.
//
// Kept thin on purpose, the way QA2Shell is and QAShell (5,039 lines) is not:
// every tab is its own file under pages/accounting/.
//
// Tab visibility comes from GET /accounting/my-scope, NOT from hasPermission
// alone. A DESIGNATION (mig 290, module_designations) is a runtime fact rather
// than a role grant, so the permissions array from /auth/me will never mention
// it -- a compliance manager who was made the accountant would see an empty
// shell if this trusted the token. Same reason QA v2 asks for /qa2/my-scope.
// ============================================================================
import { useState, useEffect } from 'react';
import { LogOut, Scale, FileText, Receipt, ListTree, BookOpen, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useHistoryTab } from '../hooks/useHistoryTab';
import { getRoleRoute } from '../utils/roleRouting';
import client from '../api/client';
import DotGridBg from '../components/UI/DotGridBg';
import { PillTabs, Loading, EmptyState } from '../components/UI/kit';
import AccountingDashboard from '../pages/accounting/AccountingDashboard';
import InvoicesPage from '../pages/accounting/InvoicesPage';
import ExpensesPage from '../pages/accounting/ExpensesPage';
import ChartOfAccountsPage from '../pages/accounting/ChartOfAccountsPage';
import JournalPage from '../pages/accounting/JournalPage';

export default function AccountingShell() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [scope, setScope] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let dead = false;
    client.get('accounting/my-scope')
      .then(r => { if (!dead) setScope({ ...r.data, user_id: user?.id }); })
      .catch(e => { if (!dead) setLoadError(e.response?.data?.error || 'Could not load your accounting access'); });
    return () => { dead = true; };
  }, [user?.id]);

  const p = scope?.permissions || {};
  const tabs = [
    { key: 'dashboard', label: 'Dashboard', icon: Scale,    show: !!p['accounting.reports.view'] },
    { key: 'invoices',  label: 'Invoices',  icon: FileText, show: !!p['accounting.invoices.view'] || !!p['accounting.invoices.manage'] },
    { key: 'expenses',  label: 'Expenses',  icon: Receipt,  show: !!p['accounting.expenses.submit'] || !!p['accounting.expenses.view'] || !!p['accounting.expenses.approve'] },
    { key: 'accounts',  label: 'Chart of accounts', icon: ListTree, show: !!p['accounting.accounts.view'] },
    { key: 'journal',   label: 'Journal',   icon: BookOpen, show: !!p['accounting.journal.view'] },
  ].filter(t => t.show);

  const [tab, setTab] = useHistoryTab(null, 'dashboard', { persist: false });
  const activeTab = tabs.some(t => t.key === tab) ? tab : (tabs[0]?.key || null);

  return (
    <div className="min-h-screen flex flex-col relative" style={{ background: 'var(--color-bg)' }}>
      <DotGridBg />
      <header className="flex items-center gap-4 px-5 py-3 border-b relative z-10 flex-wrap"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <div className="flex items-center gap-2 font-extrabold" style={{ color: 'var(--color-text)' }}>
          <Scale size={20} style={{ color: 'var(--color-primary-600)' }} /> Accounting
        </div>
        {!scope && !loadError && <Loading variant="inline" size={16} />}
        {loadError && <span className="text-xs" style={{ color: 'var(--color-error-600)' }}>{loadError}</span>}
        {scope && tabs.length > 0 && <PillTabs items={tabs} value={activeTab} onChange={setTab} />}
        <div className="ml-auto flex items-center gap-3">
          {/* This is a module, not a home. Someone who reached it from their own
              shell needs the way back without hunting for it. */}
          <button onClick={() => navigate(getRoleRoute(user?.role))}
            className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
            <ArrowLeft size={14} />My dashboard
          </button>
          <button onClick={toggleTheme} className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
          <span className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{user?.email}</span>
          <button onClick={logout} className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
            <LogOut size={14} />Logout
          </button>
        </div>
      </header>

      <main className="flex-1 p-2 sm:p-5 overflow-auto relative z-10">
        {!scope && !loadError && <Loading variant="cards" />}
        {scope && tabs.length === 0 && (
          <EmptyState icon={Scale} title="No accounting access"
            hint="Your role does not include the accounting module. A superadmin can grant it from the User Control Center." />
        )}
        {activeTab === 'dashboard' && <AccountingDashboard scope={scope} />}
        {activeTab === 'invoices'  && <InvoicesPage scope={scope} />}
        {activeTab === 'expenses'  && <ExpensesPage scope={scope} />}
        {activeTab === 'accounts'  && <ChartOfAccountsPage scope={scope} />}
        {activeTab === 'journal'   && <JournalPage scope={scope} />}
      </main>
    </div>
  );
}
