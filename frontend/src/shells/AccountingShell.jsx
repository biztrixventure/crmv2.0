// ============================================================================
// AccountingShell -- the /accounting surface.
//
// Thin on purpose, the way QA2Shell is and QAShell (5,039 lines) is not: every
// tab is its own file under pages/accounting/, and the chrome (scope loading,
// company picker, empty states) is shared with /hr via ModuleShell.
//
// Tab visibility comes from GET /accounting/my-scope, NOT from hasPermission
// alone. A DESIGNATION (mig 290, module_designations) is a runtime fact rather
// than a role grant, so the permissions array from /auth/me will never mention
// it -- a compliance manager who was made the accountant would see an empty
// shell if this trusted the token. Same reason QA v2 asks for /qa2/my-scope.
// ============================================================================
import { Scale, FileText, Receipt, ListTree, BookOpen } from 'lucide-react';
import ModuleShell from '../components/Modules/ModuleShell';
import AccountingDashboard from '../pages/accounting/AccountingDashboard';
import InvoicesPage from '../pages/accounting/InvoicesPage';
import ExpensesPage from '../pages/accounting/ExpensesPage';
import ChartOfAccountsPage from '../pages/accounting/ChartOfAccountsPage';
import JournalPage from '../pages/accounting/JournalPage';

const buildTabs = (p) => [
  { key: 'dashboard', label: 'Dashboard', icon: Scale,    show: !!p['accounting.reports.view'] },
  { key: 'invoices',  label: 'Invoices',  icon: FileText, show: !!p['accounting.invoices.view'] || !!p['accounting.invoices.manage'] },
  { key: 'expenses',  label: 'Expenses',  icon: Receipt,  show: !!p['accounting.expenses.submit'] || !!p['accounting.expenses.view'] || !!p['accounting.expenses.approve'] },
  { key: 'accounts',  label: 'Chart of accounts', icon: ListTree, show: !!p['accounting.accounts.view'] },
  { key: 'journal',   label: 'Journal',   icon: BookOpen, show: !!p['accounting.journal.view'] },
];

export default function AccountingShell() {
  return (
    <ModuleShell
      moduleKey="accounting"
      title="Accounting"
      icon={Scale}
      defaultTab="dashboard"
      buildTabs={buildTabs}
      render={(tab, scope) => (
        <>
          {tab === 'dashboard' && <AccountingDashboard scope={scope} />}
          {tab === 'invoices'  && <InvoicesPage scope={scope} />}
          {tab === 'expenses'  && <ExpensesPage scope={scope} />}
          {tab === 'accounts'  && <ChartOfAccountsPage scope={scope} />}
          {tab === 'journal'   && <JournalPage scope={scope} />}
        </>
      )}
    />
  );
}
