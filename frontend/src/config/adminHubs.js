// ============================================================================
// adminHubs.js — groups scattered sidebar tabs into hub tabs.
//
// The sidebar had grown to 36 rows, with seven of them (including Clients &
// Plans and the User Control Center) dumped in an unnamed "More" pile because
// the grouping config had drifted from the actual tab list. These hubs collapse
// families of related surfaces into one sidebar row with sub-tabs inside.
//
// NOTHING IS REMOVED. Every member id stays a real, routable tab id:
//   • a deep link or a persisted `biztrix.adminTab` pointing at a member still
//     works — AdminPanel opens the hub with that member selected;
//   • readonly-admin governance keeps working per-surface, because nav_allowed
//     stores those same member ids. A hub appears only if the RO is allowed at
//     least one member, and it shows only the members they're allowed.
// So this is a navigation change, not a permissions change. adminTabs.js (the
// governance domain) is deliberately left untouched.
//
// `members[0]` is what the hub opens on when you click the hub itself.
// ============================================================================
import {
  BookOpen, Megaphone, Hash, Paintbrush, Database, Lock,
  HelpCircle, MessageSquareText, Radio, Trophy, Send, Users, Tag, PhoneCall,
  Eraser, Eye, Download, Palette, Smartphone,
} from 'lucide-react';

export const ADMIN_HUBS = [
  {
    id: 'hub-knowledge',
    label: 'Knowledge Base',
    icon: BookOpen,
    subtitle: 'The answers and scripts agents read on a call.',
    members: [
      { id: 'faqs',    label: 'FAQs',    icon: HelpCircle },
      { id: 'scripts', label: 'Scripts', icon: MessageSquareText },
    ],
  },
  {
    id: 'hub-engagement',
    label: 'Engagement',
    icon: Megaphone,
    subtitle: 'What the floor sees: broadcasts, banners, and incentives.',
    members: [
      { id: 'announcements', label: 'Announcements', icon: Megaphone },
      { id: 'marquee',       label: 'Marquee',       icon: Radio },
      { id: 'spiff',         label: 'SPIFF',         icon: Trophy },
    ],
  },
  {
    id: 'hub-numbers',
    label: 'Numbers',
    icon: Hash,
    subtitle: 'Upload, assign and work numbers — Batches is the whole flow.',
    // Intelligence / Assigned Numbers / Number Assignment retired: Batches now
    // owns upload → assignment → dispositions → reporting. Their tab ids stay in
    // adminTabs.js (RO governance references them), they are just off the nav.
    members: [
      { id: 'batches',         label: 'Batches',           icon: Send },
      { id: 'note-shortcodes', label: 'Note Shortcuts',    icon: Tag },
    ],
  },
  {
    id: 'hub-look',
    label: 'Look & Feel',
    icon: Paintbrush,
    subtitle: 'How the CRM is named, how it looks, and how it installs.',
    members: [
      { id: 'branding',   label: 'Branding & SEO', icon: Palette },
      { id: 'appearance', label: 'Appearance',     icon: Paintbrush },
      // The PWA sits here because its manifest IS the branding: name, icon and
      // theme colour are read from the same place, and an installed app that
      // disagreed with the site would be a branding bug, not a platform one.
      { id: 'pwa',        label: 'Progressive Web App', icon: Smartphone },
    ],
  },
  {
    id: 'hub-data',
    label: 'Data Tools',
    icon: Database,
    subtitle: 'Query, export and repair records in bulk.',
    members: [
      { id: 'data-analyzer', label: 'Data Analyzer', icon: Database },
      { id: 'data-cleanup',  label: 'Data Cleanup',  icon: Eraser },
    ],
  },
  {
    id: 'hub-governance',
    label: 'Access & Governance',
    icon: Lock,
    subtitle: 'Who may see what, and what may leave the system.',
    members: [
      { id: 'readonly-admins', label: 'Readonly Admins', icon: Eye },
      { id: 'egress',          label: 'Data Egress',     icon: Download },
    ],
  },
];

// member tab id -> the hub that now hosts it
export const HUB_BY_MEMBER = Object.fromEntries(
  ADMIN_HUBS.flatMap(h => h.members.map(m => [m.id, h])),
);

export const HUB_BY_ID = Object.fromEntries(ADMIN_HUBS.map(h => [h.id, h]));

// Every id that is now reached THROUGH a hub — the sidebar hides these as
// standalone rows, but they remain valid tab ids everywhere else.
export const HUB_MEMBER_IDS = new Set(Object.keys(HUB_BY_MEMBER));

export const isHubId = (id) => Boolean(HUB_BY_ID[id]);

// Resolve any tab id to what should actually render:
//   'faqs'          -> { hub: knowledge, member: 'faqs' }
//   'hub-knowledge' -> { hub: knowledge, member: 'faqs' }  (first member)
//   'companies'     -> null                                 (a plain tab)
export function resolveHub(tabId) {
  const direct = HUB_BY_ID[tabId];
  if (direct) return { hub: direct, member: direct.members[0]?.id };
  const owner = HUB_BY_MEMBER[tabId];
  if (owner) return { hub: owner, member: tabId };
  return null;
}
