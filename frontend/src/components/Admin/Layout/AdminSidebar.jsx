import React from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Users, Shield, Building2, FileText, ChevronRight, Zap, Network, HelpCircle, MessageSquareText, UploadCloud, Megaphone, Radio, Trophy, MessagesSquare, CalendarDays, DollarSign, ArrowRight, PhoneCall, Database, Car, Tag, Settings2, Eye, Eraser, UserCircle, Download, ClipboardCheck, Palette, Paintbrush, Hash, Send, LayoutGrid, BookOpen, Lock } from 'lucide-react';
import { useBranding } from '../../../contexts/BrandingContext';

// Items with an `href` navigate to another shell instead of switching an
// internal admin tab. `state.tab` pre-selects a tab inside the target shell.
// Sidebar grouping. Hub ids (config/adminHubs.js) stand in for whole families
// of tabs — 'hub-numbers' replaces five separate rows, and so on.
//
// Two bugs this also fixes: 'users' and 'roles' were listed here but never
// existed in AdminPanel's navItems, so they rendered for nobody; and seven real
// tabs (Teams, Clients & Plans, User Control Center, …) were mapped nowhere and
// fell into an unnamed "More" pile at the bottom. Everything now has a home.
const NAV_SECTIONS = [
  {
    label: 'Overview',
    items: [
      { id: 'dashboard',    label: 'Dashboard',    icon: BarChart3   },
      { id: 'calendar',     label: 'Calendar',     icon: CalendarDays },
    ],
  },
  {
    // One row into the Compliance shell, which has its own Records nav once
    // you're there — three near-identical rows here were redundant.
    label: 'Cross-Company',
    items: [
      { id: 'cc-sales',     label: 'Records',       icon: DollarSign,     href: '/compliance', state: { tab: 'sales'    } },
      { id: 'cc-qa',        label: 'QA Department', icon: ClipboardCheck, href: '/compliance', state: { tab: 'qa_admin' } },
    ],
  },
  {
    label: 'Management',
    items: [
      { id: 'companies',     label: 'Companies',       icon: Building2  },
      { id: 'teams',         label: 'Teams',           icon: Users      },
      { id: 'user-control',  label: 'User Control',    icon: UserCircle },
      { id: 'clients-plans', label: 'Clients & Plans', icon: Tag        },
      { id: 'forms',         label: 'Form Builder',    icon: FileText   },
      { id: 'hub-knowledge', label: 'Knowledge Base',  icon: BookOpen   },
      { id: 'bulk-upload',   label: 'Bulk Upload',     icon: UploadCloud },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { id: 'sale-search',       label: 'Lead Search',       icon: Network },
      { id: 'customer-profiles', label: 'Customer Profiles', icon: UserCircle },
      { id: 'hub-data',          label: 'Data Tools',        icon: Database },
      { id: 'hub-numbers',       label: 'Numbers',           icon: Hash },
      { id: 'vicidial',          label: 'VICIdial',          icon: PhoneCall },
      { id: 'task-boards',       label: 'Task Boards',       icon: ClipboardCheck },
    ],
  },
  {
    label: 'Engagement',
    items: [
      { id: 'hub-engagement', label: 'Engagement',        icon: Megaphone },
      { id: 'payments',       label: 'Payment Reminders', icon: CalendarDays },
      { id: 'chat',           label: 'Chat Control',      icon: MessagesSquare },
    ],
  },
  {
    label: 'System',
    items: [
      { id: 'features',       label: 'Feature Flags',       icon: Zap       },
      { id: 'business-rules', label: 'Business Rules',      icon: Settings2 },
      { id: 'blacklist',      label: 'Blacklist / DNC',     icon: Shield    },
      { id: 'hub-governance', label: 'Access & Governance', icon: Lock      },
      { id: 'hub-look',       label: 'Look & Feel',         icon: Paintbrush },
    ],
  },
];

// Icons for items that live in navItems but have no NAV_SECTIONS home yet.
// Purely cosmetic — anything missing here still renders with a default icon.
const EXTRA_ICONS = {
  numbers: Hash,
  batches: Send,
  roster: Users,
  'note-shortcodes': Tag,
};

const AdminSidebar = ({ navItems, activeTab, onTabChange, badgeCounts = {} }) => {
  const navigate = useNavigate();
  const { siteName } = useBranding();

  // navItems is the source of truth for WHICH tabs exist (it already carries
  // every role/permission gate from AdminPanel). NAV_SECTIONS only supplies
  // icons + grouping. Any navItems entry with no section mapping falls into a
  // trailing "More" group instead of silently vanishing — so a newly added tab
  // always shows in the sidebar even if nobody remembers to slot it here.
  const knownIds = new Set(NAV_SECTIONS.flatMap(s => s.items.map(i => i.id)));
  const extraItems = navItems.filter(n => !knownIds.has(n.id));
  const sections = extraItems.length
    ? [...NAV_SECTIONS, {
        label: 'More',
        items: extraItems.map(n => ({ id: n.id, label: n.label, icon: EXTRA_ICONS[n.id] || LayoutGrid })),
      }]
    : NAV_SECTIONS;

  return (
    <aside className="w-64 flex-shrink-0 flex flex-col"
      style={{
        backgroundColor: 'var(--color-surface)',
        borderRight: '1px solid var(--color-border)',
        height: 'calc(100vh - 64px)',
        position: 'sticky',
        top: 64,
      }}>

      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-5">
        {sections.map(section => (
          <div key={section.label}>
            <p className="text-xs font-bold uppercase tracking-widest px-3 mb-2"
              style={{ color: 'var(--color-text-tertiary)' }}>
              {section.label}
            </p>
            <div className="space-y-0.5">
              {section.items
                .filter(item => navItems.find(n => n.id === item.id))
                .map(item => {
                  // A hub row stays highlighted while any of its members is the
                  // active tab — otherwise opening FAQs would leave the whole
                  // sidebar looking unselected.
                  const navItem = navItems.find(n => n.id === item.id);
                  const isActive = activeTab === item.id
                    || (navItem?.memberIds?.includes(activeTab) ?? false);
                  const badge = badgeCounts[item.id];
                  return (
                    <button
                      key={item.id}
                      onClick={() => item.href ? navigate(item.href, { state: item.state }) : onTabChange(item.id)}
                      className="w-full text-left px-3 py-2.5 rounded-xl transition-all duration-150 flex items-center gap-3 group"
                      style={{
                        background: isActive ? 'var(--gradient-sidebar)' : 'transparent',
                        color: isActive ? 'white' : 'var(--color-text-secondary)',
                        fontWeight: isActive ? '600' : '500',
                        fontSize: '14px',
                      }}
                      onMouseEnter={e => {
                        if (!isActive) e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)';
                      }}
                      onMouseLeave={e => {
                        if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                    >
                      {/* Icon */}
                      <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all`}
                        style={{
                          backgroundColor: isActive ? 'rgba(255,255,255,0.2)' : 'var(--color-bg-secondary)',
                        }}>
                        <item.icon size={16}
                          style={{ color: isActive ? 'white' : 'var(--color-text-secondary)' }} />
                      </div>

                      <span className="flex-1">{item.label}</span>

                      {/* Badge */}
                      {badge > 0 && (
                        <span className="text-xs font-bold px-1.5 py-0.5 rounded-full min-w-5 text-center"
                          style={{
                            backgroundColor: isActive ? 'rgba(255,255,255,0.25)' : 'var(--color-error-500)',
                            color: 'white',
                          }}>
                          {badge}
                        </span>
                      )}

                      {/* Chevron */}
                      {isActive && <ChevronRight size={14} style={{ color: 'rgba(255,255,255,0.7)' }} />}
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom: version. Needs an opaque background — the nav above it scrolls,
          and a transparent footer lets nav items show through behind it. */}
      <div className="p-4 border-t flex-shrink-0"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white"
            style={{ background: 'var(--gradient-sidebar)' }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.875rem' }}>{(siteName || 'C').charAt(0).toUpperCase()}</span>
          </div>
          <div>
            <p className="text-xs font-semibold truncate" style={{ color: 'var(--color-text)' }}>{siteName}</p>
            <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>v2.0</p>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default AdminSidebar;
