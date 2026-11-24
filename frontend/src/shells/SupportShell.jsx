// ============================================================================
// SupportShell -- the support agent's home (/support, role level
// `support_agent`, mig 355-356).
//
// Thin on purpose: the REAL AppHeader on top (bell, chat, mail, profile,
// logout -- the same one every shell carries, so a support agent does not lose
// their notifications), and the classic-looking desk underneath it. All of the
// desk lives in components/Support.
// ============================================================================
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Headset } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useNotifications } from '../hooks/useNotifications';
import { useVersionCheck } from '../hooks/useVersionCheck';
import { getRoleRoute } from '../utils/roleRouting';
import { AppHeader } from '../components/Layout';
import UpdateBanner from '../components/UI/UpdateBanner';
import SupportWorkspace from '../components/Support/SupportWorkspace';
import SupportReports from '../components/Support/SupportReports';
import { useSupportManager } from '../hooks/useSupportManager';

export default function SupportShell() {
  const { user, logout, updateUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const notifHook = useNotifications();
  const updateAvailable = useVersionCheck();
  // A support agent who is ALSO the support manager (mig 358) can flip between
  // their own desk and the admin view.
  const supportManager = useSupportManager(user?.id);
  const [view, setView] = useState('desk');

  const handleLogout = () => { logout(); navigate('/login'); };

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f0f0f0' }}>
      {updateAvailable && <UpdateBanner />}
      <AppHeader
        title="Customer Support"
        logo={
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'var(--gradient-sidebar)' }}>
            <Headset className="text-white" size={22} />
          </div>
        }
        companyLogoUrl={user?.company_logo_url}
        theme={theme} onThemeToggle={toggleTheme}
        userEmail={user?.email}
        userRole={user?.role_name || user?.role}
        onLogout={handleLogout}
        user={user} onUpdateUser={updateUser}
        notifications={notifHook.notifications}
        unreadCount={notifHook.unreadCount}
        onMarkRead={notifHook.markRead}
        onMarkAllRead={notifHook.markAllRead}
        onDeleteNotification={notifHook.deleteNotification}
        onClearNotifications={notifHook.clearAll}
        onBrandClick={() => navigate(getRoleRoute(user?.role))}
      />
      {supportManager && (
        <div className="flex gap-2 px-4 pt-3">
          {[['desk', 'My Desk'], ['reports', 'Support Reports']].map(([k, label]) => (
            <button key={k} type="button" onClick={() => setView(k)} aria-pressed={view === k}
              className="px-3 py-1.5 rounded text-sm font-semibold border"
              style={view === k
                ? { background: '#1f4e8c', color: '#fff', borderColor: '#1f4e8c' }
                : { background: '#fff', color: '#222', borderColor: '#999' }}>
              {label}
            </button>
          ))}
        </div>
      )}
      {supportManager && view === 'reports' ? <SupportReports /> : <SupportWorkspace />}
    </div>
  );
}
