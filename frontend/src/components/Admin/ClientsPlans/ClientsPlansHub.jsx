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
import { Panel, SectionHeader, PillTabs } from '../../UI/kit';
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
    <div>
      <SectionHeader
        level="page"
        icon={Users2}
        title="Clients & Plans"
        subtitle="Everything about your warranty carriers (clients) and products (plans) — catalog, cascade mapping, product details, portal logins, and usage."
      />

      <PillTabs value={tab} onChange={setTab}
        items={TABS.map(t => ({ key: t.key, label: t.label, icon: t.icon }))} />

      <Panel pad="lg" className="min-h-[320px] mt-3">
        {tab === 'catalog' && <ClientPlanManager />}
        {tab === 'details' && <PlanMetadataPanel />}
        {tab === 'usage'   && <ClientUsagePanel />}
        {tab === 'portal'  && <ClientPortalTab />}
        {tab === 'guests'  && <GuestLinksPanel />}
      </Panel>
    </div>
  );
}
