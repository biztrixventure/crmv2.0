import React from 'react';
import { Moon, Sun, LogOut, Settings } from 'lucide-react';

/**
 * AdminHeader Component
 * Displays header with theme toggle and logout
 */
const AdminHeader = ({ theme, onToggleTheme, onLogout }) => {
  return (
    <nav
      className="header shadow-sm border-b"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center space-x-4">
            <div className="w-10 h-10 bg-gradient-sidebar rounded-lg flex items-center justify-center">
              <Settings size={24} className="text-white" />
            </div>
            <h1 className="text-2xl font-bold">Admin Panel</h1>
          </div>

          <div className="flex items-center space-x-4">
            <button
              onClick={onToggleTheme}
              className="p-2 rounded-lg btn-secondary transition-colors"
              title="Toggle dark mode"
            >
              {theme === 'light' ? (
                <Moon size={20} />
              ) : (
                <Sun size={20} />
              )}
            </button>
            <button
              onClick={onLogout}
              className="px-4 py-2 rounded-lg transition-colors flex items-center space-x-2"
              style={{
                backgroundColor: 'var(--color-primary-600)',
                color: 'white',
              }}
            >
              <LogOut size={18} />
              <span>Logout</span>
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default AdminHeader;
