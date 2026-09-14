// ============================================================================
// Accounting -> Books. The accountant's tools, one tab instead of three: the
// journal (every money movement), the chart of accounts (the list of accounts
// those movements land in) and the opening balances (what the company had and
// owed on day one). A manager who just wants to know what came in and went out
// never needs to open this -- Home and Reports say it.
// ============================================================================
import { useState } from 'react';
import { BookOpen, ListTree, Landmark } from 'lucide-react';
import { PillTabs } from '../../components/UI/kit';
import JournalPage from './JournalPage';
import ChartOfAccountsPage from './ChartOfAccountsPage';
import OpeningBalancesPage from './OpeningBalancesPage';

export default function BooksPage({ scope }) {
  const p = scope?.permissions || {};
  const items = [
    { key: 'journal',  label: 'Journal',           icon: BookOpen, show: !!p['accounting.journal.view'] },
    { key: 'accounts', label: 'Chart of accounts', icon: ListTree, show: !!p['accounting.accounts.view'] },
    { key: 'opening',  label: 'Opening balances',  icon: Landmark, show: !!p['accounting.journal.view'] },
  ].filter(i => i.show);
  const [view, setView] = useState(items[0]?.key || 'journal');
  const active = items.some(i => i.key === view) ? view : items[0]?.key;

  return (
    <div className="space-y-4">
      {items.length > 1 && <PillTabs items={items} value={active} onChange={setView} />}
      {active === 'journal' && <JournalPage scope={scope} />}
      {active === 'accounts' && <ChartOfAccountsPage scope={scope} />}
      {active === 'opening' && <OpeningBalancesPage scope={scope} />}
    </div>
  );
}
