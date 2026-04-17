import { useState } from 'react';
import { Moon, Sun, LogOut, Settings, ChevronDown } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import NotificationBell from '../../UI/NotificationBell';
import ProfileModal from '../../Profile/ProfileModal';

const AdminHeader = ({
  theme, onToggleTheme, onLogout,
  notifications = [], unreadCount = 0,
  onMarkRead, onMarkAllRead, onDeleteNotification, onClearNotifications,
}) => {
  const { user, updateUser } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);

  const initials = user?.first_name
    ? `${user.first_name[0]}${user.last_name?.[0] || ''}`.toUpperCase()
    : (user?.email?.[0] || 'A').toUpperCase();

  return (
    <>
      <header
        className="h-16 px-6 flex items-center justify-between sticky top-0 z-40"
        style={{
          backgroundColor: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-border)',
          backdropFilter: 'blur(12px)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        {/* Left: Logo + Title */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--gradient-sidebar)', boxShadow: 'var(--shadow-sm)' }}>
            <Settings size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold leading-tight" style={{ color: 'var(--color-text)' }}>
              Admin Panel
            </h1>
            <p className="text-xs leading-tight" style={{ color: 'var(--color-text-tertiary)' }}>
              BizTrix CRM v2.0
            </p>
          </div>
          <div className="hidden sm:block w-px h-7 mx-2" style={{ backgroundColor: 'var(--color-border)' }} />
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
            style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>
            <div className="w-1.5 h-1.5 rounded-full bg-success-500 animate-pulse" />
            Live
          </div>
        </div>

        {/* Right */}
        <div className="flex items-center gap-2">
          <NotificationBell
            notifications={notifications}
            unreadCount={unreadCount}
            onMarkRead={onMarkRead}
            onMarkAllRead={onMarkAllRead}
            onDelete={onDeleteNotification}
            onClearAll={onClearNotifications}
          />

          {/* Theme toggle */}
          <button
            onClick={onToggleTheme}
            className="w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:scale-105"
            style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
            title="Toggle theme"
          >
            {theme === 'light'
              ? <Moon size={17} style={{ color: 'var(--color-text-secondary)' }} />
              : <Sun  size={17} style={{ color: 'var(--color-text-secondary)' }} />
            }
          </button>

          {/* User pill — clickable to open profile */}
          <button
            onClick={() => setProfileOpen(true)}
            className="hidden sm:flex items-center gap-2.5 pl-2 pr-3 py-1.5 rounded-xl transition-all hover:bg-bg-secondary group"
            style={{ border: '1px solid var(--color-border)' }}
            title="View profile"
          >
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
              style={{ background: 'var(--gradient-sidebar)' }}>
              {initials}
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold leading-tight" style={{ color: 'var(--color-text)' }}>
                {user?.first_name ? `${user.first_name} ${user.last_name || ''}`.trim() : user?.email}
              </p>
              <p className="text-xs leading-tight" style={{ color: 'var(--color-text-tertiary)' }}>
                {user?.role_name || user?.role || 'Admin'}
              </p>
            </div>
            <ChevronDown size={12} className="text-text-tertiary group-hover:text-text-secondary transition-colors" />
          </button>

          {/* Logout */}
          <button
            onClick={onLogout}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 hover:scale-[1.02]"
            style={{ background: 'var(--gradient-sidebar)', boxShadow: 'var(--shadow-sm)' }}
          >
            <LogOut size={15} />
            <span className="hidden sm:inline">Logout</span>
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
