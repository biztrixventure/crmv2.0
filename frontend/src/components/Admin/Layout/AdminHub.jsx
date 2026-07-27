import { useState, useEffect, useMemo } from 'react';
import { SectionHeader, PillTabs, EmptyState } from '../../UI/kit';

// AdminHub — renders one grouped sidebar entry (see config/adminHubs.js) as a
// page header + PillTabs sub-nav + the selected member's existing component.
//
// It renders members through a `renderTab(id)` callback rather than importing
// them, so AdminPanel keeps ownership of what each tab id maps to and none of
// those components change.
//
// Readonly admins: `allowed(id)` filters the sub-tabs, so an RO granted only
// "FAQs" sees a Knowledge Base hub containing exactly FAQs. If a hub somehow
// renders with nothing allowed, it says so instead of showing an empty frame.
export default function AdminHub({ hub, activeMember, onMemberChange, allowed = () => true, renderTab }) {
  const members = useMemo(() => hub.members.filter(m => allowed(m.id)), [hub, allowed]);

  // Track the selection locally so clicking a sub-tab doesn't round-trip
  // through the parent's persisted tab state on every click.
  const [current, setCurrent] = useState(activeMember || members[0]?.id);

  // Follow the parent when it deep-links to a specific member, and self-correct
  // if the current pick isn't available (e.g. RO governance hides it).
  useEffect(() => {
    if (activeMember && members.some(m => m.id === activeMember)) { setCurrent(activeMember); return; }
    if (!members.some(m => m.id === current)) setCurrent(members[0]?.id);
  }, [activeMember, members, current]);

  if (!members.length) {
    return (
      <EmptyState
        icon={hub.icon}
        title={`No ${hub.label} sections available`}
        hint="Your administrator hasn't granted access to anything in this group."
      />
    );
  }

  const pick = (id) => { setCurrent(id); onMemberChange?.(id); };

  return (
    <div>
      <SectionHeader level="page" icon={hub.icon} title={hub.label} subtitle={hub.subtitle} />
      {members.length > 1 && (
        <PillTabs
          className="mb-5"
          value={current}
          onChange={pick}
          items={members.map(m => ({ key: m.id, label: m.label, icon: m.icon }))}
        />
      )}
      {renderTab(current)}
    </div>
  );
}
