import { useState } from 'react';
import { Moon, Sun, LogOut, Settings, ChevronDown, PanelLeftClose, PanelLeft, Menu } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import NotificationBell from '../../UI/NotificationBell';
import ChatLauncher from '../../Chat/ChatLauncher';
import MailLauncher from '../../Mail/MailLauncher';
import ProfileModal from '../../Profile/ProfileModal';
import { useFocus } from '../../../contexts/FocusContext';
import { useBranding } from '../../../contexts/BrandingContext';

const AdminHeader = ({
  theme, onToggleTheme, onLogout,
  notifications = [], unreadCount = 0,
  onMarkRead, onMarkAllRead, onDeleteNotification, onClearNotifications,
  sidebarOpen = true, onToggleSidebar, onOpenMobileNav,
}) => {
  const { user, updateUser } = useAuth();
  const { siteName, logoUrl } = useBranding();
  const [profileOpen, setProfileOpen] = useState(false);
  const { openFromNotification } = useFocus();

  const initials = user?.first_name
    ? `${user.first_name[0]}${user.last_name?.[0] || ''}`.toUpperCase()
    : (user?.email?.[0] || 'A').toUpperCase();

  return (
    <>
      <header
        className="h-16 px-3 sm:px-4 lg:px-6 flex items-center justify-between gap-2 sticky top-0 z-40"
        style={{
          backgroundColor: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-border)',
          backdropFilter: 'blur(12px)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        {/* Left: Sidebar toggle + Logo + Title */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {/* Below `lg` the sidebar is an off-canvas drawer, so the control is a
              hamburger that OPENS it. At `lg`+ it's the collapse toggle for the
              persistent column — two different jobs, so two buttons rather than
              one that means different things at different widths. */}
          {onOpenMobileNav && (
            <button
              onClick={onOpenMobileNav}
              className="lg:hidden w-9 h-9 rounded-xl flex items-center justify-center transition-all flex-shrink-0"
              style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
              aria-label="Open navigation"
            >
              <Menu size={18} style={{ color: 'var(--color-text-secondary)' }} />
            </button>
          )}
          {onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              className="hidden lg:flex w-9 h-9 rounded-xl items-center justify-center transition-all hover:scale-105 flex-shrink-0"
              style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
              title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            >
              {sidebarOpen
                ? <PanelLeftClose size={17} style={{ color: 'var(--color-text-secondary)' }} />
                : <PanelLeft      size={17} style={{ color: 'var(--color-text-secondary)' }} />
              }
            </button>
          )}
          {/* Brand first, section second. The product name is what identifies
              the app, so it takes the primary line and "Admin Panel" becomes the
              context beneath it — previously this was inverted, which buried the
              CRM's name in 11px tertiary text under a generic heading. Both
              come from Branding & SEO, so renaming the CRM renames this. */}
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden"
            style={{ background: 'var(--gradient-sidebar)', boxShadow: 'var(--shadow-sm)' }}>
            {logoUrl
              ? <img src={logoUrl} alt="" className="w-full h-full object-cover" />
              : <Settings size={18} className="text-white" />}
          </div>
          {/* The brand text is the first thing to go when width runs out — the
              logo chip beside it already identifies the app, and the real page
              title comes from each tab's SectionHeader. `min-w-0` (not
              flex-shrink-0) so `truncate` can actually engage. */}
          <div className="hidden md:block min-w-0">
            <h1 className="text-base font-bold leading-tight truncate" style={{ color: 'var(--color-text)', fontFamily: 'var(--font-display)' }}>
              {siteName}
            </h1>
            <p className="text-xs leading-tight whitespace-nowrap m-0" style={{ color: 'var(--color-text-tertiary)' }}>
              Admin Panel
            </p>
          </div>
          <div className="hidden lg:block w-px h-7 mx-2 flex-shrink-0" style={{ backgroundColor: 'var(--color-border)' }} />
          {/* Tint via color-mix, not --color-primary-100: that token is light in
              BOTH themes, so it renders a light chip on the dark UI. */}
          <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold flex-shrink-0"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--color-success-600) 14%, transparent)',
              color: 'var(--color-success-600)',
            }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--color-success-600)' }} />
            Live
          </div>
        </div>

        {/* Right */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          <MailLauncher />
          <ChatLauncher />
          <NotificationBell
            notifications={notifications}
            unreadCount={unreadCount}
            onMarkRead={onMarkRead}
            onMarkAllRead={onMarkAllRead}
            onDelete={onDeleteNotification}
            onClearAll={onClearNotifications}
            onNavigate={openFromNotification}
          />

          {/* Theme toggle */}
          <button
            onClick={onToggleTheme}
            className="w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:scale-105"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}
            title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          >
            {theme === 'light'
              ? <Moon size={17} style={{ color: 'var(--color-text-secondary)' }} />
              : <Sun  size={17} style={{ color: 'var(--color-accent)' }} />
            }
          </button>

          <div className="hidden xl:block w-px h-6 mx-1" style={{ backgroundColor: 'var(--color-border)' }} />

          {/* Below `xl` the name+role text is what doesn't fit, not the control
              itself — so the pill collapses to its avatar rather than
              disappearing. Same tap, same profile modal. */}
          <button
            onClick={() => setProfileOpen(true)}
            className="xl:hidden w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 relative"
            style={{ background: 'var(--gradient-sidebar)' }}
            aria-label="View profile"
            title="View profile"
          >
            <span className="text-xs font-bold text-white">{initials}</span>
          </button>

          {/* User pill — clickable to open profile */}
          <button
            onClick={() => setProfileOpen(true)}
            className="hidden xl:flex items-center gap-2.5 pl-1.5 pr-3 py-1.5 rounded-xl transition-all group"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--color-primary-600) 10%, var(--color-surface))'; e.currentTarget.style.borderColor = 'var(--color-primary-600)'; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'var(--color-surface)'; e.currentTarget.style.borderColor = 'var(--color-border)'; }}
            title="View profile"
          >
            <div className="relative flex-shrink-0">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white"
                style={{ background: 'var(--gradient-sidebar)' }}>
                {initials}
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: 'var(--color-success-500)', border: '2px solid var(--color-surface)' }} />
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold leading-tight" style={{ color: 'var(--color-text)' }}>
                {user?.first_name ? `${user.first_name} ${user.last_name || ''}`.trim() : user?.email}
              </p>
              <p className="text-xs leading-tight capitalize" style={{ color: 'var(--color-text-tertiary)' }}>
                {(user?.role_name || user?.role || 'Admin').replace(/_/g, ' ')}
              </p>
            </div>
            <ChevronDown size={12} className="transition-transform duration-200 group-hover:translate-y-0.5" style={{ color: 'var(--color-text-tertiary)' }} />
          </button>

          {/* Logout */}
          <button
            onClick={onLogout}
            className="flex items-center justify-center gap-2 w-9 h-9 lg:w-auto lg:h-auto lg:px-3 lg:py-2 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 hover:scale-[1.02] flex-shrink-0"
            style={{ background: 'var(--gradient-sidebar)', boxShadow: 'var(--shadow-sm)' }}
            aria-label="Logout"
            title="Logout"
          >
            <LogOut size={15} />
            <span className="hidden lg:inline">Logout</span>
          </button>
        </div>
      </header>

      {user && (
        <ProfileModal
          isOpen={profileOpen}
          onClose={() => setProfileOpen(false)}
          user={user}
          onUpdateUser={(updates) => { updateUser(updates); setProfileOpen(false); }}
        />
      )}
    </>
  );
};

export default AdminHeader;
