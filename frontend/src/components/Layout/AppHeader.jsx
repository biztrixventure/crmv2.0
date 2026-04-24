import { useState } from 'react';
import { Moon, Sun, LogOut, ChevronDown } from 'lucide-react';
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
  navItems = [],
  activeNav = 'dashboard',
  onNavChange = () => {},
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

  const initials = [user?.first_name, user?.last_name]
    .filter(Boolean)
    .map(n => n[0].toUpperCase())
    .join('') || (userEmail?.[0]?.toUpperCase() ?? 'U');

  return (
    <>
      <div className="sticky top-0 z-50">
        <header
          className={`header h-16 px-4 sm:px-6 lg:px-8 flex items-center justify-between ${className}`}
          {...props}
        >
          {/* Left: Logo & Title */}
          <div className="flex items-center gap-3">
            {logo ?? (
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--gradient-sidebar)', boxShadow: 'var(--shadow-sm)' }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontWeight: 700,
                    fontSize: '1.1rem',
                    color: 'white',
                  }}
                >
                  B
                </span>
              </div>
            )}
            <h1
              className="hidden sm:block"
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '1.25rem',
                fontWeight: 700,
                letterSpacing: '-0.025em',
                color: 'var(--color-primary-600)',
              }}
            >
              {title}
            </h1>
          </div>

          {/* Center: Custom Actions */}
          {actions.length > 0 && (
            <div className="flex items-center gap-2 flex-1 justify-center">
              {actions.map((action, idx) => <div key={idx}>{action}</div>)}
            </div>
          )}

          {/* Right: Notifications + Theme + User + Logout */}
          <div className="flex items-center gap-2">
            <NotificationBell
              notifications={notifications}
              unreadCount={unreadCount}
              onMarkRead={onMarkRead}
              onMarkAllRead={onMarkAllRead}
              onDelete={onDeleteNotification}
              onClearAll={onClearNotifications}
            />

            {/* Theme Toggle */}
            <button
              onClick={onThemeToggle}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:scale-105"
              style={{
                backgroundColor: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border)',
              }}
              title="Toggle theme"
              aria-label="Toggle theme"
            >
              {theme === 'light'
                ? <Moon size={17} style={{ color: 'var(--color-text-secondary)' }} />
                : <Sun  size={17} style={{ color: 'var(--color-text-secondary)' }} />
              }
            </button>

            {/* User pill */}
            {userEmail && (
              <button
                onClick={() => setProfileOpen(true)}
                className="hidden sm:flex items-center gap-2.5 pl-2 pr-3 py-1.5 rounded-xl transition-all hover:bg-bg-secondary group"
                style={{ border: '1px solid var(--color-border)' }}
                title="View profile"
              >
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                  style={{ background: 'var(--gradient-sidebar)' }}
                >
                  {initials}
                </div>
                <div>
                  <p className="text-xs font-semibold leading-tight" style={{ color: 'var(--color-text)' }}>
                    {[user?.first_name, user?.last_name].filter(Boolean).join(' ') || userEmail}
                  </p>
                  {userRole && (
                    <p className="text-xs leading-tight" style={{ color: 'var(--color-text-tertiary)' }}>
                      {userRole}
                    </p>
                  )}
                </div>
                <ChevronDown
                  size={12}
                  className="text-text-tertiary group-hover:text-text-secondary transition-colors"
                />
              </button>
            )}

            {/* Logout */}
            <button
              onClick={onLogout}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 hover:scale-[1.02]"
              style={{
                background: 'linear-gradient(135deg, #7A4820 0%, #C4894A 100%)',
                boxShadow: '0 2px 8px rgba(196, 137, 74, 0.2)',
              }}
            >
              <LogOut size={15} />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </header>

        {/* Cross-role nav bar — only renders when cross-role items exist */}
        {navItems.length > 0 && (
          <nav
            className="px-4 sm:px-6 lg:px-8 flex items-center h-11"
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
                className="relative flex items-center gap-2 px-4 h-11 text-sm font-semibold transition-all duration-150"
                style={{
                  color: activeNav === 'dashboard'
                    ? 'var(--color-primary-600)'
                    : 'var(--color-text-secondary)',
                }}
              >
                My Dashboard
                {activeNav === 'dashboard' && (
                  <span
                    className="absolute bottom-0 left-3 right-3 h-0.5 rounded-t-full"
                    style={{ backgroundColor: 'var(--color-primary-600)' }}
                  />
                )}
              </button>

              <div className="w-px h-5 mx-1 flex-shrink-0" style={{ backgroundColor: 'var(--color-border)' }} />

              {/* Cross-role items */}
              {navItems.map(item => (
                <button
                  key={item.key}
                  onClick={() => onNavChange(item.key)}
                  className="relative flex items-center gap-2 px-4 h-11 text-sm font-semibold transition-all duration-150"
                  style={{
                    color: activeNav === item.key
                      ? 'var(--color-primary-600)'
                      : 'var(--color-text-secondary)',
                  }}
                >
                  {item.icon && <item.icon size={14} />}
                  {item.label}
                  {activeNav === item.key && (
                    <span
                      className="absolute bottom-0 left-3 right-3 h-0.5 rounded-t-full"
                      style={{ backgroundColor: 'var(--color-primary-600)' }}
                    />
                  )}
                </button>
              ))}
            </div>
          </nav>
        )}
      </div>

      {/* Profile modal */}
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
