import React from 'react';
import { Moon, Sun, LogOut, Settings, User } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';

/**
 * AdminHeader Component
 * Premium header with user info, theme toggle, and navigation
 */
const AdminHeader = ({ theme, onToggleTheme, onLogout }) => {
  const { user } = useAuth();

  return (
    <nav className="header shadow-sm border-b sticky top-0 z-40"
         style={{ borderColor: 'var(--color-border)', backdropFilter: 'blur(12px)' }}>
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Left: Logo & Title */}
          <div className="flex items-center space-x-4">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                 style={{ background: 'var(--gradient-sidebar)', boxShadow: 'var(--shadow-sm)' }}>
              <Settings size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold" style={{ color: 'var(--color-text)' }}>Admin Panel</h1>
              <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>BizTrix CRM v2.0</p>
            </div>
          </div>

          {/* Right: User Info + Theme + Logout */}
          <div className="flex items-center space-x-3">
            {/* User Info */}
            <div className="hidden sm:flex items-center gap-3 px-3 py-1.5 rounded-xl"
                 style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center"
                   style={{ background: 'var(--gradient-sidebar)' }}>
                <User size={16} className="text-white" />
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  {user?.first_name ? `${user.first_name} ${user.last_name || ''}`.trim() : user?.email}
                </p>
                <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                  {user?.role_name || user?.role || 'Admin'}
                </p>
              </div>
            </div>

            {/* Theme Toggle */}
            <button
              onClick={onToggleTheme}
              className="p-2.5 rounded-xl transition-all duration-300 hover:scale-105"
              style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
              title="Toggle dark mode"
            >
              {theme === 'light' ? (
                <Moon size={18} style={{ color: 'var(--color-text)' }} />
              ) : (
                <Sun size={18} style={{ color: 'var(--color-text)' }} />
              )}
            </button>

            {/* Logout */}
            <button
              onClick={onLogout}
              className="px-4 py-2.5 rounded-xl transition-all duration-300 flex items-center space-x-2 text-white font-medium hover:scale-105"
              style={{ background: 'var(--gradient-sidebar)', boxShadow: 'var(--shadow-sm)' }}
            >
              <LogOut size={16} />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default AdminHeader;
