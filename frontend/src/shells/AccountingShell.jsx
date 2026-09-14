// ============================================================================
// AccountingShell -- the /accounting surface ("Accounts").
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
//
// Layout (stage 3 -- plain words first, accountant tools behind "Books"):
//   Home        money in, money out, what is owed, the headline numbers
//   Invoices    bill customers, record payments
//   Expenses    claims and approvals
//   Sales       CRM sales into the books: switches, rate card, statements (stage 5)
//   Reports     profit and loss, balance sheet, trial balance (+ CSV)
//   Books       journal + chart of accounts
//   Settings    money rules + exchange rates
//   Change log  who changed what, when, why
// ============================================================================
import { Scale, FileText, Receipt, BookOpen, History, FileBarChart, Settings, Coins } from 'lucide-react';
import ModuleShell from '../components/Modules/ModuleShell';
import AccountingDashboard from '../pages/accounting/AccountingDashboard';
import InvoicesPage from '../pages/accounting/InvoicesPage';
import ExpensesPage from '../pages/accounting/ExpensesPage';
import ReportsPage from '../pages/accounting/ReportsPage';
import BooksPage from '../pages/accounting/BooksPage';
import AccountingSettingsPage from '../pages/accounting/AccountingSettingsPage';
import SalesBooksPage from '../pages/accounting/SalesBooksPage';
import ChangeLogPage from '../pages/modules/ChangeLogPage';

const buildTabs = (p) => [
  { key: 'dashboard', label: 'Home',       icon: Scale,        show: !!p['accounting.reports.view'] },
  { key: 'invoices',  label: 'Invoices',   icon: FileText,     show: !!p['accounting.invoices.view'] || !!p['accounting.invoices.manage'] },
  { key: 'expenses',  label: 'Expenses',   icon: Receipt,      show: !!p['accounting.expenses.submit'] || !!p['accounting.expenses.view'] || !!p['accounting.expenses.approve'] },
  { key: 'sales',     label: 'Sales',      icon: Coins,        show: !!p['accounting.reports.view'] || !!p['accounting.accounts.view'] },
  { key: 'reports',   label: 'Reports',    icon: FileBarChart, show: !!p['accounting.reports.view'] },
  { key: 'books',     label: 'Books',      icon: BookOpen,     show: !!p['accounting.journal.view'] || !!p['accounting.accounts.view'] },
  { key: 'settings',  label: 'Settings',   icon: Settings,     show: !!p['accounting.accounts.view'] },
  { key: 'history',   label: 'Change log', icon: History,      show: !!p['accounting.history.view'] },
];

export default function AccountingShell() {
  return (
    <ModuleShell
      moduleKey="accounting"
      title="Accounts"
      icon={Scale}
      defaultTab="dashboard"
      buildTabs={buildTabs}
      render={(tab, scope, goTo, pickCompany) => (
        <>
          {tab === 'dashboard' && <AccountingDashboard scope={scope} goTo={goTo} pickCompany={pickCompany} />}
          {tab === 'invoices'  && <InvoicesPage scope={scope} />}
          {tab === 'expenses'  && <ExpensesPage scope={scope} />}
          {tab === 'sales'     && <SalesBooksPage scope={scope} />}
          {tab === 'reports'   && <ReportsPage scope={scope} />}
          {tab === 'books'     && <BooksPage scope={scope} />}
          {tab === 'settings'  && <AccountingSettingsPage scope={scope} />}
          {tab === 'history'   && <ChangeLogPage module="accounting" scope={scope} />}
        </>
      )}
    />
  );
}
