import ChromeTabs from '../ChromeTabs';

// PillTabs — the ONE sub-navigation. A thin wrapper over the existing ChromeTabs
// pill variant so migrating a surface is a one-line swap and any future restyle
// happens in exactly one place.
//
// Rule of thumb (same as the Compliance shell):
//   • ChromeTabs variant="chrome"  → PRIMARY nav of a shell (connected tabs).
//     In the AdminPanel the sidebar IS the primary nav, so admin tabs skip it.
//   • PillTabs (pill, sm)          → sub-nav INSIDE a tab. Everything else.
//
// This retires the three hand-rolled families: the inset segmented track
// (EgressGovernance / VICIdial / BulkUploadHub / DataCleanup), the gradient pill
// row (ChatAdmin), and the ad-hoc rounded-lg button rows.
//
//   <PillTabs items={[{ key, label, icon, count }]} value={tab} onChange={setTab} />
export default function PillTabs({ items = [], value, onChange, className = '' }) {
  return <ChromeTabs variant="pill" size="sm" items={items} value={value} onChange={onChange} className={className} />;
}
