// ClientsPlansHub — the consolidated "Clients & Plans" command center. One tab,
// Chrome-style sub-tabs, gathering every client/plan setting that used to be
// scattered:
//   • Catalog & mapping → the existing ClientPlanManager (clients, plans, cascade)
//   • Plan details      → structured product metadata (PlanMetadataPanel)
//   • Portal accounts   → the external client-portal logins (ClientPortalTab)
//   • Usage & lifecycle → per client/plan sales rollup (ClientUsagePanel)
// It EMBEDS the existing components unchanged, so no working flow breaks — the
// old screens keep functioning; this is an additive unified home.
import { useState } from 'react';
import { Layers, Package, KeyRound, BarChart3, Users2, Link2 } from 'lucide-react';
import ChromeTabs from '../../UI/ChromeTabs';
import ClientPlanManager from '../ClientPlans/ClientPlanManager';
import ClientPortalTab from '../Chat/ClientPortalTab';
import PlanMetadataPanel from './PlanMetadataPanel';
import ClientUsagePanel from './ClientUsagePanel';
import GuestLinksPanel from './GuestLinksPanel';

const TABS = [
  { key: 'catalog',  label: 'Clients & Plans', icon: Layers },
  { key: 'details',  label: 'Plan details',    icon: Package },
  { key: 'usage',    label: 'Usage & Lifecycle', icon: BarChart3 },
  { key: 'portal',   label: 'Portal accounts', icon: KeyRound },
  { key: 'guests',   label: 'Guest links',     icon: Link2 },
];

export default function ClientsPlansHub() {
  const [tab, setTab] = useState('catalog');

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-text flex items-center gap-2">
          <Users2 size={24} style={{ color: 'var(--color-primary-600)' }} />
          Clients &amp; Plans
        </h1>
        <p className="text-sm text-text-secondary mt-0.5">
          Everything about your warranty carriers (clients) and products (plans) — catalog, cascade mapping, product details, portal logins, and usage.
        </p>
      </div>

      <ChromeTabs variant="pill" size="sm" value={tab} onChange={setTab}
        items={TABS.map(t => ({ key: t.key, label: t.label, icon: t.icon }))} />

      <div className="rounded-2xl p-5 min-h-[320px] mt-3" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        {tab === 'catalog' && <ClientPlanManager />}
        {tab === 'details' && <PlanMetadataPanel />}
        {tab === 'usage'   && <ClientUsagePanel />}
        {tab === 'portal'  && <ClientPortalTab />}
        {tab === 'guests'  && <GuestLinksPanel />}
      </div>
    </div>
  );
}
