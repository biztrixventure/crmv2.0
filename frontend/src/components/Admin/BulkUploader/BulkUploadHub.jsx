import { useState } from 'react';
import { Send, DollarSign } from 'lucide-react';
import BulkUploader from './BulkUploader';
import BulkSaleUploader from '../BulkSaleUploader/BulkSaleUploader';

// Single "Bulk Upload" page with two tabs: Transfers and Sales.
const TABS = [
  { key: 'transfers', label: 'Transfer Upload', icon: Send },
  { key: 'sales',     label: 'Sale Upload',     icon: DollarSign },
];

const BulkUploadHub = () => {
  const [tab, setTab] = useState('transfers');
  return (
    <div className="space-y-5">
      <div className="flex gap-1 p-1 rounded-xl w-fit" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
            style={{
              background: tab === t.key ? 'var(--gradient-sidebar)' : 'transparent',
              color: tab === t.key ? 'white' : 'var(--color-text-secondary)',
              boxShadow: tab === t.key ? 'var(--shadow-sm)' : 'none',
            }}>
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>
      {tab === 'transfers' ? <BulkUploader /> : <BulkSaleUploader />}
    </div>
  );
};

export default BulkUploadHub;
