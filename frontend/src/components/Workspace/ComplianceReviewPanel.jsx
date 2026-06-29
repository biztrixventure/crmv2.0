import { useState, useEffect } from 'react';
import client from '../../api/client';
import SalesTab from '../Compliance/SalesTab';
import TransfersTab from '../Compliance/TransfersTab';
import CallbacksTab from '../Compliance/CallbacksTab';
import QueueTab from '../Compliance/QueueTab';
import ReviewsTab from '../Compliance/ReviewsTab';

// Compliance review surface for the Custom Access workspace — reuses the real
// Compliance tabs. Backend authorises the caller via the tool_compliance_review
// flag (or compliance_manager/superadmin), so these load the same cross-company
// data a compliance manager sees.
const SUBTABS = [
  { key: 'sales',     label: 'Sales' },
  { key: 'transfers', label: 'Transfers' },
  { key: 'callbacks', label: 'Callbacks' },
  { key: 'queue',     label: 'Queue' },
  { key: 'reviews',   label: 'Reviews' },
];

export default function ComplianceReviewPanel() {
  const [companyList, setCompanyList] = useState([]);
  const [tab, setTab] = useState('sales');

  useEffect(() => {
    client.get('compliance/companies').then(r => setCompanyList(r.data.companies || [])).catch(() => {});
  }, []);

  return (
    <div>
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {SUBTABS.map(t => {
          const on = tab === t.key;
          return (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className="px-3 py-1.5 rounded-lg text-sm font-semibold transition-all"
              style={{
                background: on ? 'var(--gradient-sidebar)' : 'transparent',
                color:      on ? '#fff' : 'var(--color-text-secondary)',
                border:     on ? 'none' : '1px solid var(--color-border)',
                boxShadow:  on ? 'var(--shadow-sm)' : 'none',
              }}>
              {t.label}
            </button>
          );
        })}
      </div>
      {tab === 'sales'     && <SalesTab companyList={companyList} />}
      {tab === 'transfers' && <TransfersTab companyList={companyList} />}
      {tab === 'callbacks' && <CallbacksTab companyList={companyList} />}
      {tab === 'queue'     && <QueueTab companyList={companyList} />}
      {tab === 'reviews'   && <ReviewsTab companyList={companyList} />}
    </div>
  );
}
