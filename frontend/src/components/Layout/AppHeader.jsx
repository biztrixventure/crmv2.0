import { useState } from 'react';
import { Moon, Sun, LogOut, ChevronDown } from 'lucide-react';
import NotificationBell from '../UI/NotificationBell';
import ProfileModal from '../Profile/ProfileModal';

const CompanyLogoImg = ({ src }) => {
  const [errored, setErrored] = useState(false);
  if (errored) return (
    <div
      className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
      style={{ background: 'var(--gradient-sidebar)', boxShadow: '0 2px 8px rgba(168,136,92,0.35)' }}
    >
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.1rem', color: 'white' }}>B</span>
    </div>
  );
  return (
    <img
      src={src}
      alt="Company logo"
      onError={() => setErrored(true)}
      className="h-9 w-auto max-w-[120px] rounded-xl object-contain flex-shrink-0"
      style={{ boxShadow: 'var(--shadow-sm)' }}
    />
  );
};

const IconBtn = ({ onClick, title, children }) => (
  <button
    onClick={onClick}
    title={title}
    aria-label={title}
    className="w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-150 hover:scale-105 flex-shrink-0"
    style={{
      backgroundColor: 'var(--color-bg-secondary)',
      border: '1px solid var(--color-border)',
    }}
  >
    {children}
  </button>
);

const AppHeader = ({
  title = 'BizTrix CRM',
  logo = null,
  companyLogoUrl = null,
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

  const displayName = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || userEmail;

  return (
    <>
      <div className="sticky top-0 z-50">
        {/* Main header bar */}
        <header
          className={`header h-16 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-3 ${className}`}
          {...props}
        >
          {/* Left: Logo & Title */}
          <div className="flex items-center gap-3 min-w-0">
            {companyLogoUrl ? (
              <CompanyLogoImg src={companyLogoUrl} />
            ) : logo ?? (
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{
                  background: 'var(--gradient-sidebar)',
                  boxShadow: '0 2px 8px rgba(168,136,92,0.35)',
                }}
              >
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.1rem', color: 'white' }}>
                  B
                </span>
              </div>
            )}
            <div className="hidden sm:flex flex-col min-w-0">
              <span
                className="leading-tight font-bold truncate"
                style={{
                  fontSize: '1.05rem',
                  letterSpacing: '-0.02em',
                  color: 'var(--color-primary-700)',
                }}
              >
                {title}
              </span>
              <span
                className="text-xs leading-tight truncate"
                style={{ color: 'var(--color-text-tertiary)', letterSpacing: '0.02em' }}
              >
                CRM Platform
              </span>
            </div>
          </div>

          {/* Center: Custom Actions */}
          {actions.length > 0 && (
            <div className="flex items-center gap-2 flex-1 justify-center">
              {actions.map((action, idx) => <div key={idx}>{action}</div>)}
            </div>
          )}

          {/* Right: Notifications + Theme + User + Logout */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Notification bell */}
            <NotificationBell
              notifications={notifications}
              unreadCount={unreadCount}
              onMarkRead={onMarkRead}
              onMarkAllRead={onMarkAllRead}
              onDelete={onDeleteNotification}
              onClearAll={onClearNotifications}
            />

            {/* Theme toggle */}
            <IconBtn onClick={onThemeToggle} title="Toggle theme">
              {theme === 'light'
                ? <Moon size={16} style={{ color: 'var(--color-text-secondary)' }} />
                : <Sun  size={16} style={{ color: 'var(--color-accent)' }} />
              }
            </IconBtn>

            {/* Profile pill — filled, never transparent */}
            {userEmail && (
              <button
                onClick={() => setProfileOpen(true)}
                className="hidden sm:flex items-center gap-2.5 pl-2 pr-3 h-9 rounded-xl transition-all duration-150 flex-shrink-0 group"
                style={{
                  backgroundColor: 'var(--color-bg-secondary)',
                  border: '1px solid var(--color-border)',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.backgroundColor = 'var(--color-primary-100)';
                  e.currentTarget.style.borderColor = 'var(--color-primary-300)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)';
                  e.currentTarget.style.borderColor = 'var(--color-border)';
                }}
                title="View profile"
              >
                {/* Avatar */}
                <div
                  className="w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                  style={{
                    background: 'var(--gradient-sidebar)',
                    boxShadow: '0 1px 4px rgba(168,136,92,0.4)',
                    fontSize: '10px',
                  }}
                >
                  {initials}
                </div>

                {/* Name + role */}
                <div className="min-w-0">
                  <p
                    className="text-xs font-semibold leading-tight truncate max-w-[120px]"
                    style={{ color: 'var(--color-text)' }}
                  >
                    {displayName}
                  </p>
                  {userRole && (
                    <p
                      className="text-xs leading-tight truncate capitalize"
                      style={{ color: 'var(--color-text-tertiary)', fontSize: '10px' }}
                    >
                      {userRole.replace(/_/g, ' ')}
                    </p>
                  )}
                </div>

                <ChevronDown size={11} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
              </button>
            )}

            {/* Logout */}
            <button
              onClick={onLogout}
              className="h-9 flex items-center gap-1.5 px-3 rounded-xl text-sm font-semibold text-white transition-all duration-150 hover:opacity-90 hover:scale-[1.02] flex-shrink-0"
              style={{
                background: 'var(--gradient-sidebar)',
                boxShadow: '0 2px 8px rgba(168,136,92,0.3)',
              }}
              title="Logout"
            >
              <LogOut size={14} />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </header>

        {/* Gradient accent line below header */}
        <div
          className="h-px w-full"
          style={{ background: 'linear-gradient(to right, transparent, var(--color-primary-300), var(--color-cream-400), var(--color-primary-300), transparent)' }}
        />

        {/* Cross-role nav bar */}
        {navItems.length > 0 && (
          <nav
            className="px-4 sm:px-6 lg:px-8 flex items-center h-11"
            style={{
              backgroundColor: 'var(--color-surface)',
              borderBottom: '1px solid var(--color-border)',
              boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
            }}
          >
            <div className="max-w-7xl w-full mx-auto flex items-center gap-1">
              {/* My Dashboard */}
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
                    style={{ background: 'var(--gradient-sidebar)' }}
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
                      style={{ background: 'var(--gradient-sidebar)' }}
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
