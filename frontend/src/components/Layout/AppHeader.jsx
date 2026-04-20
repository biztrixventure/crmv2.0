import { useState } from 'react';
import { Moon, Sun, LogOut, ChevronDown } from 'lucide-react';
import Button from '../UI/Button';
import NotificationBell from '../UI/NotificationBell';
import ProfileModal from '../Profile/ProfileModal';

const AppHeader = ({
  title = 'BizTrix CRM',
  logo = null,
  theme = 'light',
  onThemeToggle = () => {},
  userEmail = '',
  userRole = '',
  user = null,
  onUpdateUser = () => {},
  onLogout = () => {},
  actions = [],
  // Cross-role navigation
  navItems = [],
  activeNav = 'dashboard',
  onNavChange = () => {},
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
  const [profileOpen, setProfileOpen] = useState(false);

  return (
    <>
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

          {/* User Info — clickable to open profile */}
          {userEmail && (
            <button
              onClick={() => setProfileOpen(true)}
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all hover:bg-bg-secondary group"
              title="View profile"
            >
              {/* Avatar initials */}
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                style={{ background: 'var(--gradient-sidebar)' }}>
                {[user?.first_name, user?.last_name]
                  .filter(Boolean).map(n => n[0].toUpperCase()).join('')
                  || userEmail[0].toUpperCase()}
              </div>
              <div className="text-right">
                <p className="font-semibold text-sm text-text leading-tight">
                  {[user?.first_name, user?.last_name].filter(Boolean).join(' ') || userEmail}
                </p>
                {userRole && <p className="text-xs text-text-secondary leading-tight">{userRole}</p>}
              </div>
              <ChevronDown size={13} className="text-text-tertiary group-hover:text-text-secondary transition-colors" />
            </button>
          )}

          {/* Logout */}
          <Button variant="primary" size="sm" onClick={onLogout} className="flex items-center gap-2">
            <LogOut size={18} />
            <span className="hidden sm:inline">Logout</span>
          </Button>
        </div>
      </header>

      {/* Cross-role nav bar — only renders when cross-role items exist */}
      {navItems.length > 0 && (
        <nav
          className="px-4 sm:px-6 lg:px-8 flex items-center gap-1 h-11 sticky top-16 z-40"
          style={{
            backgroundColor: 'var(--color-surface)',
            borderBottom: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <div className="max-w-7xl w-full mx-auto flex items-center gap-1">
            {/* My Dashboard — always first */}
            <button
              onClick={() => onNavChange('dashboard')}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all duration-150"
              style={{
                backgroundColor: activeNav === 'dashboard' ? 'var(--color-primary-50)' : 'transparent',
                color: activeNav === 'dashboard' ? 'var(--color-primary-600)' : 'var(--color-text-secondary)',
              }}
            >
              My Dashboard
            </button>

            {/* Divider */}
            <div className="w-px h-5 mx-1 flex-shrink-0" style={{ backgroundColor: 'var(--color-border)' }} />

            {/* Cross-role items */}
            {navItems.map(item => (
              <button
                key={item.key}
                onClick={() => onNavChange(item.key)}
                className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all duration-150"
                style={{
                  backgroundColor: activeNav === item.key ? 'var(--color-primary-50)' : 'transparent',
                  color: activeNav === item.key ? 'var(--color-primary-600)' : 'var(--color-text-secondary)',
                }}
              >
                {item.icon && <item.icon size={14} />}
                {item.label}
              </button>
            ))}
          </div>
        </nav>
      )}

      {/* Profile modal — rendered outside header flow */}
      {user && (
        <ProfileModal
          isOpen={profileOpen}
          onClose={() => setProfileOpen(false)}
          user={{ ...user, email: user.email || userEmail, role_name: user.role_name || userRole }}
          onUpdateUser={(updates) => { onUpdateUser(updates); setProfileOpen(false); }}
        />
      )}
    </>
  );
};

export default AppHeader;
