import React from 'react';
import {
  BarChart3,
  Users,
  Shield,
  Building2,
  FileText,
} from 'lucide-react';

/**
 * AdminSidebar Component
 * Displays navigation menu with Lucide icons
 */
const AdminSidebar = ({ navItems, activeTab, onTabChange }) => {
  // Icon mapping from item ID to Lucide component
  const iconMap = {
    dashboard: <BarChart3 size={20} />,
    users: <Users size={20} />,
    roles: <Shield size={20} />,
    companies: <Building2 size={20} />,
    forms: <FileText size={20} />,
  };

  return (
    <aside
      className="sidebar w-64 border-r shadow-sm"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <nav className="p-6 space-y-2">
        <h3 className="text-lg font-semibold mb-6 px-4">Admin Menu</h3>
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            className="w-full text-left px-4 py-3 rounded-lg transition-all smooth-transition flex items-center space-x-3"
            style={{
              backgroundColor:
                activeTab === item.id
                  ? 'var(--color-primary-600)'
                  : 'transparent',
              color:
                activeTab === item.id
                  ? 'white'
                  : 'var(--color-text)',
            }}
            onMouseEnter={(e) => {
              if (activeTab !== item.id) {
                e.currentTarget.style.backgroundColor =
                  'var(--color-primary-100)';
              }
            }}
            onMouseLeave={(e) => {
              if (activeTab !== item.id) {
                e.currentTarget.style.backgroundColor = 'transparent';
              }
            }}
          >
            <span className="flex-shrink-0">
              {iconMap[item.id] || item.icon}
            </span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
};

export default AdminSidebar;
