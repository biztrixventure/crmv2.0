import { useState } from 'react';
import { Send, DollarSign } from 'lucide-react';
import BulkUploader from './BulkUploader';
import BulkSaleUploader from '../BulkSaleUploader/BulkSaleUploader';
import { PillTabs } from '../../UI/kit';

// Single "Bulk Upload" page with two tabs: Transfers and Sales.
const TABS = [
  { key: 'transfers', label: 'Transfer Upload', icon: Send },
  { key: 'sales',     label: 'Sale Upload',     icon: DollarSign },
];

const BulkUploadHub = () => {
  const [tab, setTab] = useState('transfers');
  return (
    <div className="space-y-5">
      <PillTabs value={tab} onChange={setTab}
        items={TABS.map(t => ({ key: t.key, label: t.label, icon: t.icon }))} />
      {tab === 'transfers' ? <BulkUploader /> : <BulkSaleUploader />}
    </div>
  );
};

export default BulkUploadHub;
