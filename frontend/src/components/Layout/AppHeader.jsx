import { useState } from 'react';
import { Moon, Sun, LogOut, ChevronDown, LayoutGrid } from 'lucide-react';
import NotificationBell from '../UI/NotificationBell';
import ChatLauncher from '../Chat/ChatLauncher';
import ProfileModal from '../Profile/ProfileModal';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import { useFocus } from '../../contexts/FocusContext';

const CompanyLogoImg = ({ src }) => {
  const [errored, setErrored] = useState(false);
  if (errored) return (
    <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
      style={{ background: 'var(--gradient-sidebar)', boxShadow: '0 2px 8px rgba(168,136,92,0.35)' }}>
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.1rem', color: 'white' }}>B</span>
    </div>
  );
  return (
    <img src={src} alt="Company logo" onError={() => setErrored(true)}
      className="h-9 w-auto max-w-[120px] rounded-xl object-contain flex-shrink-0"
      style={{ boxShadow: 'var(--shadow-sm)' }} />
  );
};

// Shared icon button — matches NotificationBell / ChatLauncher styling so the
// whole control cluster reads as one set.
const IconBtn = ({ onClick, title, children }) => (
  <button
    onClick={onClick}
    title={title}
    aria-label={title}
    className="w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 hover:scale-105 flex-shrink-0"
    style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}
    onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--color-primary-50, #f5f3ff)'; }}
    onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'var(--color-surface)'; }}
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
  const { openFromNotification } = useFocus();

  // Push notification setup — lives here so it only runs when authenticated
  const {
    permission: pushPermission,
    subscribed: pushSubscribed,
    loading:    pushLoading,
    error:      pushError,
    subscribe:  enablePush,
  } = usePushNotifications();

  const initials = [user?.first_name, user?.last_name]
    .filter(Boolean)
    .map(n => n[0].toUpperCase())
    .join('') || (userEmail?.[0]?.toUpperCase() ?? 'U');

  const displayName = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || userEmail;
  const companyName = user?.company_name || user?.company?.name || '';

  const Divider = () => <div className="w-px h-6 mx-1.5 flex-shrink-0 hidden sm:block" style={{ backgroundColor: 'var(--color-border)' }} />;

  return (
    <>
      <div className="sticky top-0 z-50">
        {/* Main header bar */}
        <header
          className={`header h-16 px-3 sm:px-5 lg:px-8 flex items-center justify-between gap-3 ${className}`}
          {...props}
        >
          {/* Left: Logo & Title */}
          <div className="flex items-center gap-3 min-w-0">
            {companyLogoUrl ? (
              <CompanyLogoImg src={companyLogoUrl} />
            ) : logo ?? (
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--gradient-sidebar)', boxShadow: '0 2px 8px rgba(168,136,92,0.35)' }}>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.1rem', color: 'white' }}>B</span>
              </div>
            )}
            <div className="hidden sm:flex flex-col min-w-0 leading-none">
              <span className="font-bold truncate"
                style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', letterSpacing: '-0.01em', color: 'var(--color-primary-700)', lineHeight: 1.15 }}>
                {title}
              </span>
              <span className="text-xs truncate mt-0.5" style={{ color: 'var(--color-text-tertiary)', letterSpacing: '0.03em' }}>
                {companyName || 'CRM Platform'}
              </span>
            </div>
          </div>

          {/* Center: Custom Actions */}
          {actions.length > 0 && (
            <div className="flex items-center gap-2 flex-1 justify-center min-w-0">
              {actions.map((action, idx) => <div key={idx}>{action}</div>)}
            </div>
          )}

          {/* Right: Chat + Notifications + Theme · Profile · Logout */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Control cluster */}
            <ChatLauncher />
            <NotificationBell
              notifications={notifications}
              unreadCount={unreadCount}
              onMarkRead={onMarkRead}
              onMarkAllRead={onMarkAllRead}
              onDelete={onDeleteNotification}
              onClearAll={onClearNotifications}
              onNavigate={openFromNotification}
              pushSubscribed={pushSubscribed}
              pushPermission={pushPermission}
              pushLoading={pushLoading}
              pushError={pushError}
              onEnablePush={enablePush}
            />
            <IconBtn onClick={onThemeToggle} title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}>
              {theme === 'light'
                ? <Moon size={16} style={{ color: 'var(--color-text-secondary)' }} />
                : <Sun  size={16} style={{ color: 'var(--color-accent)' }} />}
            </IconBtn>

            <Divider />

            {/* Profile pill */}
            {userEmail && (
              <button
                onClick={() => setProfileOpen(true)}
                className="hidden sm:flex items-center gap-2.5 pl-1.5 pr-3 h-9 rounded-xl transition-all duration-200 flex-shrink-0 group"
                style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--color-primary-50, #f5f3ff)'; e.currentTarget.style.borderColor = 'var(--color-primary-300)'; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'var(--color-surface)'; e.currentTarget.style.borderColor = 'var(--color-border)'; }}
                title="View profile"
              >
                <div className="relative flex-shrink-0">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-white"
                    style={{ background: 'var(--gradient-sidebar)', boxShadow: '0 1px 4px rgba(168,136,92,0.4)', fontSize: '11px' }}>
                    {initials}
                  </div>
                  <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: '#22c55e', border: '2px solid var(--color-surface)' }} />
                </div>
                <div className="min-w-0 text-left">
                  <p className="text-xs font-semibold leading-tight truncate max-w-[130px]" style={{ color: 'var(--color-text)' }}>
                    {displayName}
                  </p>
                  {userRole && (
                    <p className="leading-tight truncate capitalize" style={{ color: 'var(--color-text-tertiary)', fontSize: '10px' }}>
                      {userRole.replace(/_/g, ' ')}
                    </p>
                  )}
                </div>
                <ChevronDown size={12} className="transition-transform duration-200 group-hover:translate-y-0.5"
                  style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
              </button>
            )}

            {/* Avatar-only profile on mobile */}
            {userEmail && (
              <button onClick={() => setProfileOpen(true)} title="View profile"
                className="sm:hidden w-9 h-9 rounded-xl flex items-center justify-center font-bold text-white flex-shrink-0"
                style={{ background: 'var(--gradient-sidebar)', fontSize: '11px', boxShadow: '0 1px 4px rgba(168,136,92,0.4)' }}>
                {initials}
              </button>
            )}

            {/* Logout */}
            <button
              onClick={onLogout}
              className="h-9 flex items-center gap-1.5 px-2.5 sm:px-3 rounded-xl text-sm font-semibold text-white transition-all duration-200 hover:opacity-90 hover:scale-[1.02] flex-shrink-0"
              style={{ background: 'var(--gradient-sidebar)', boxShadow: '0 2px 8px rgba(168,136,92,0.3)' }}
              title="Logout"
            >
              <LogOut size={14} />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </header>

        {/* Gradient accent line below header */}
        <div className="h-px w-full"
          style={{ background: 'linear-gradient(to right, transparent, var(--color-primary-300), var(--color-cream-400), var(--color-primary-300), transparent)' }} />

        {/* Cross-role nav bar */}
        {navItems.length > 0 && (
          <nav className="px-3 sm:px-5 lg:px-8 flex items-center h-11 overflow-x-auto"
            style={{ backgroundColor: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
            <div className="max-w-7xl w-full mx-auto flex items-center gap-0.5">
              <NavTab active={activeNav === 'dashboard'} onClick={() => onNavChange('dashboard')} icon={LayoutGrid} label="My Dashboard" />
              <div className="w-px h-5 mx-1.5 flex-shrink-0" style={{ backgroundColor: 'var(--color-border)' }} />
              {navItems.map(item => (
                <NavTab key={item.key} active={activeNav === item.key} onClick={() => onNavChange(item.key)} icon={item.icon} label={item.label} />
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

// Cross-role nav tab — active gets a soft tinted pill + underline accent.
const NavTab = ({ active, onClick, icon: Icon, label }) => (
  <button
    onClick={onClick}
    className="relative flex items-center gap-2 px-3.5 h-11 text-sm font-semibold whitespace-nowrap transition-colors duration-150"
    style={{ color: active ? 'var(--color-primary-700)' : 'var(--color-text-secondary)' }}
    onMouseEnter={e => { if (!active) e.currentTarget.style.color = 'var(--color-text)'; }}
    onMouseLeave={e => { if (!active) e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
  >
    {Icon && <Icon size={14} />}
    {label}
    {active && (
      <span className="absolute bottom-0 left-2.5 right-2.5 h-0.5 rounded-t-full" style={{ background: 'var(--gradient-sidebar)' }} />
    )}
  </button>
);

export default AppHeader;
