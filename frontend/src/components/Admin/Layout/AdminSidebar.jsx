import React from 'react';
import {
  BarChart3, Users, Shield, Building2, FileText,
} from 'lucide-react';

/**
 * AdminSidebar Component
 * Premium sidebar with icons and active state animations
 */
const AdminSidebar = ({ navItems, activeTab, onTabChange }) => {
  const iconMap = {
    dashboard: <BarChart3 size={20} />,
    users: <Users size={20} />,
    roles: <Shield size={20} />,
    companies: <Building2 size={20} />,
    forms: <FileText size={20} />,
  };

  return (
    <aside className="w-64 border-r flex-shrink-0 overflow-y-auto"
           style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <nav className="p-4 space-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wider px-4 py-2 mb-2"
            style={{ color: 'var(--color-text-tertiary)' }}>
          Navigation
        </h3>
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className="w-full text-left px-4 py-3 rounded-xl transition-all duration-200 flex items-center space-x-3 group relative"
              style={{
                backgroundColor: isActive ? 'var(--color-primary-600)' : 'transparent',
                color: isActive ? 'white' : 'var(--color-text)',
                fontWeight: isActive ? '600' : '500',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)';
                  e.currentTarget.style.transform = 'translateX(4px)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.transform = 'translateX(0)';
                }
              }}
            >
              {/* Active indicator bar */}
              {isActive && (
                <div className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full"
                     style={{ backgroundColor: 'white' }}></div>
              )}
              <span className="flex-shrink-0">
                {iconMap[item.id] || item.icon}
              </span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Version info at bottom */}
      <div className="absolute bottom-0 left-0 w-64 p-4 border-t"
           style={{ borderColor: 'var(--color-border)' }}>
        <p className="text-xs text-center" style={{ color: 'var(--color-text-tertiary)' }}>
          BizTrix CRM v2.0
        </p>
      </div>
    </aside>
  );
};

export default AdminSidebar;
