import React from 'react';
import { Moon, Sun, LogOut } from 'lucide-react';
import Button from '../UI/Button';

/**
 * Global AppHeader Component
 *
 * Features:
 * - Unified header used across all pages
 * - Logo/brand area on left
 * - Customizable actions in center
 * - Theme toggle + user info + logout on right
 * - Responsive design
 * - Accessibility-first
 *
 * Replaces 4 instances of duplicated header code!
 */
const AppHeader = ({
  title = 'BizTrix CRM',
  logo = null,
  theme = 'light',
  onThemeToggle = () => {},
  userEmail = '',
  userRole = '',
  onLogout = () => {},
  actions = [],
  className = '',
  ...props
}) => {
  return (
    <header className={`header h-16 px-4 sm:px-6 lg:px-8 flex items-center justify-between ${className}`} {...props}>
      {/* Left: Logo & Title */}
      <div className="flex items-center gap-4">
        {logo ? (
          logo
        ) : (
          <div className="w-10 h-10 bg-gradient-sidebar rounded-lg flex items-center justify-center">
            <span className="text-xl font-bold text-white">B</span>
          </div>
        )}
        <h1 className="text-2xl font-bold text-primary-600">{title}</h1>
      </div>

      {/* Center: Custom Actions */}
      {actions.length > 0 && (
        <div className="flex items-center gap-2 flex-1 justify-center">
          {actions.map((action, idx) => (
            <div key={idx}>{action}</div>
          ))}
        </div>
      )}

      {/* Right: Theme Toggle + User Info + Logout */}
      <div className="flex items-center gap-4">
        {/* Theme Toggle */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onThemeToggle}
          title="Toggle dark mode"
          aria-label="Toggle dark mode"
        >
          {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
        </Button>

        {/* User Info */}
        {userEmail && (
          <div className="hidden sm:block text-right">
            <p className="font-semibold text-sm text-text">{userEmail}</p>
            {userRole && (
              <p className="text-xs text-text-secondary">{userRole}</p>
            )}
          </div>
        )}

        {/* Logout Button */}
        <Button
          variant="primary"
          size="sm"
          onClick={onLogout}
          className="flex items-center gap-2"
        >
          <LogOut size={18} />
          <span className="hidden sm:inline">Logout</span>
        </Button>
      </div>
    </header>
  );
};

export default AppHeader;
