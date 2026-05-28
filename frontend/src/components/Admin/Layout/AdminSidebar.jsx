import React from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Users, Shield, Building2, FileText, ChevronRight, Zap, Network, HelpCircle, MessageSquareText, UploadCloud, Megaphone, Radio, Trophy, MessagesSquare, CalendarDays, DollarSign, ArrowRight, PhoneCall } from 'lucide-react';

// Items with an `href` navigate to another shell instead of switching an
// internal admin tab. `state.tab` pre-selects a tab inside the target shell.
const NAV_SECTIONS = [
  {
    label: 'Overview',
    items: [
      { id: 'dashboard',    label: 'Dashboard',    icon: BarChart3   },
      { id: 'calendar',     label: 'Calendar',     icon: CalendarDays },
    ],
  },
  {
    label: 'Cross-Company',
    items: [
      { id: 'cc-sales',     label: 'All Sales',     icon: DollarSign,  href: '/compliance', state: { tab: 'sales'     } },
      { id: 'cc-transfers', label: 'All Transfers', icon: ArrowRight,  href: '/compliance', state: { tab: 'transfers' } },
      { id: 'cc-callbacks', label: 'All Callbacks', icon: PhoneCall,   href: '/compliance', state: { tab: 'callbacks' } },
    ],
  },
  {
    label: 'Management',
    items: [
      { id: 'users',        label: 'Users',        icon: Users      },
      { id: 'roles',        label: 'Roles',        icon: Shield     },
      { id: 'companies',    label: 'Companies',    icon: Building2  },
      { id: 'forms',        label: 'Form Builder', icon: FileText   },
      { id: 'faqs',         label: 'FAQs',         icon: HelpCircle },
      { id: 'scripts',      label: 'Scripts',      icon: MessageSquareText },
      { id: 'bulk-upload',  label: 'Bulk Upload',  icon: UploadCloud },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { id: 'sale-search', label: 'Lead Search', icon: Network },
    ],
  },
  {
    label: 'Engagement',
    items: [
      { id: 'announcements', label: 'Announcements', icon: Megaphone },
      { id: 'marquee',       label: 'Marquee',       icon: Radio },
      { id: 'spiff',         label: 'SPIFF',         icon: Trophy },
      { id: 'chat',          label: 'Chat Control',  icon: MessagesSquare },
    ],
  },
  {
    label: 'System',
    items: [
      { id: 'features', label: 'Feature Flags', icon: Zap },
    ],
  },
];

const AdminSidebar = ({ navItems, activeTab, onTabChange, badgeCounts = {} }) => {
  const navigate = useNavigate();
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
        {NAV_SECTIONS.map(section => (
          <div key={section.label}>
            <p className="text-xs font-bold uppercase tracking-widest px-3 mb-2"
              style={{ color: 'var(--color-text-tertiary)' }}>
              {section.label}
            </p>
            <div className="space-y-0.5">
              {section.items
                .filter(item => navItems.find(n => n.id === item.id))
                .map(item => {
                  const isActive = activeTab === item.id;
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
                            backgroundColor: isActive ? 'rgba(255,255,255,0.25)' : '#ef4444',
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

      {/* Bottom: version */}
      <div className="p-4 border-t flex-shrink-0"
        style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white"
            style={{ background: 'var(--gradient-sidebar)' }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.875rem' }}>B</span>
          </div>
          <div>
            <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>BizTrix CRM</p>
            <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>v2.0</p>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default AdminSidebar;
