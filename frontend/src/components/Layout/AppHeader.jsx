import React from 'react';
import { Moon, Sun, LogOut } from 'lucide-react';
import Button from '../UI/Button';
import NotificationBell from '../UI/NotificationBell';

/**
 * Global AppHeader Component
 *
 * Props:
 * - notifications, unreadCount, onMarkRead, onMarkAllRead, onDeleteNotification, onClearNotifications
 *   → pass these to enable the notification bell
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
  // Notifications
  notifications = [],
  unreadCount = 0,
  onMarkRead = () => {},
  onMarkAllRead = () => {},
  onDeleteNotification = () => {},
  onClearNotifications = () => {},
  className = '',
  ...props
}) => {
  return (
    <header className={`header h-16 px-4 sm:px-6 lg:px-8 flex items-center justify-between ${className}`} {...props}>
      {/* Left: Logo & Title */}
      <div className="flex items-center gap-4">
        {logo ? logo : (
          <div className="w-10 h-10 bg-gradient-sidebar rounded-lg flex items-center justify-center">
            <span className="text-xl font-bold text-white">B</span>
          </div>
        )}
        <h1 className="text-2xl font-bold text-primary-600">{title}</h1>
      </div>

      {/* Center: Custom Actions */}
      {actions.length > 0 && (
        <div className="flex items-center gap-2 flex-1 justify-center">
          {actions.map((action, idx) => <div key={idx}>{action}</div>)}
        </div>
      )}

      {/* Right: Notifications + Theme + User + Logout */}
      <div className="flex items-center gap-3">
        {/* Notification Bell */}
        <NotificationBell
          notifications={notifications}
          unreadCount={unreadCount}
          onMarkRead={onMarkRead}
          onMarkAllRead={onMarkAllRead}
          onDelete={onDeleteNotification}
          onClearAll={onClearNotifications}
        />

        {/* Theme Toggle */}
        <Button variant="ghost" size="sm" onClick={onThemeToggle}
          title="Toggle dark mode" aria-label="Toggle dark mode">
          {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
        </Button>

        {/* User Info */}
        {userEmail && (
          <div className="hidden sm:block text-right">
            <p className="font-semibold text-sm text-text">{userEmail}</p>
            {userRole && <p className="text-xs text-text-secondary">{userRole}</p>}
          </div>
        )}

        {/* Logout */}
        <Button variant="primary" size="sm" onClick={onLogout} className="flex items-center gap-2">
          <LogOut size={18} />
          <span className="hidden sm:inline">Logout</span>
        </Button>
      </div>
    </header>
  );
};

export default AppHeader;
