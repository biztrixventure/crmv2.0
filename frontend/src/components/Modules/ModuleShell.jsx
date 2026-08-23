// ============================================================================
// ModuleShell -- the chrome both /accounting and /hr sit inside.
//
// One file, because the two shells differ only in their title, icon and tab
// list; duplicating the scope-loading, the company picker and the empty states
// is how they drift apart.
//
// The header is the REAL AppHeader, the same one StaffShell / ManagerShell /
// ComplianceShell / QAShell use. That is deliberate: it is what carries mail,
// chat, the notification bell (with push enrolment), the theme toggle, the
// profile card and logout. These modules first shipped with a hand-rolled strip
// that had only a theme link and an email address, so someone working in
// Accounting lost their inbox and their notifications -- a shell that drops the
// app's own furniture reads as a different, lesser app.
//
// Module-specific controls (company picker, tab strip, the way back) sit in a
// sub-bar UNDER the header rather than inside it, so AppHeader stays untouched
// and every other shell is unaffected.
//
// Two states this has to tell apart, and the reason it exists:
//
//   has_any === false    -> genuinely no access. Say so.
//   needs_company        -> plenty of access, no company CHOSEN yet. A
//                           superadmin has no company of their own
//                           (authMiddleware sets company_id = null), so every
//                           list would come back correctly but uselessly
//                           empty. Showing "no access" there would be a lie,
//                           and showing empty tables would look like a bug.
//
// The chosen company is remembered per module in localStorage and passed as
// ?company_id= on every call, which resolveScopedCompanyId already honours for
// superadmin / readonly_admin (and safely ignores for everyone else -- a
// non-member falls back to their own company rather than 403-ing).
// ============================================================================
import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Building2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useHistoryTab } from '../../hooks/useHistoryTab';
import { useNotifications } from '../../hooks/useNotifications';
import { useVersionCheck } from '../../hooks/useVersionCheck';
import { getRoleRoute } from '../../utils/roleRouting';
import client from '../../api/client';
import { AppHeader } from '../Layout';
import DotGridBg from '../UI/DotGridBg';
import UpdateBanner from '../UI/UpdateBanner';
import ThemedSelect from '../UI/Select';
import { PillTabs, Loading, EmptyState } from '../UI/kit';

export default function ModuleShell({
  moduleKey,          // 'accounting' | 'hr'
  title,
  icon: Icon,
  buildTabs,          // (permissions, scope) => [{ key, label, icon, show }]
  render,             // (activeTab, scope) => node
  banner,             // optional (scope) => node, drawn above the content
  defaultTab,
}) {
  const { user, logout, updateUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const notifHook = useNotifications();
  const updateAvailable = useVersionCheck();

  const storageKey = `module.${moduleKey}.company`;
  const [companyId, setCompanyId] = useState(() => {
    try { return localStorage.getItem(storageKey) || ''; } catch { return ''; }
  });
  const [scope, setScope] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const loadScope = useCallback(async (cid) => {
    setLoadError(null);
    try {
      const r = await client.get(`${moduleKey}/my-scope`, {
        params: cid ? { company_id: cid } : undefined,
      });
      setScope({ ...r.data, user_id: user?.id });
      return r.data;
    } catch (e) {
      setLoadError(e.response?.data?.error || `Could not load your ${title} access`);
      return null;
    }
  }, [moduleKey, title, user?.id]);

  useEffect(() => { loadScope(companyId); }, [loadScope, companyId]);

  const pickCompany = (id) => {
    setCompanyId(id);
    try { id ? localStorage.setItem(storageKey, id) : localStorage.removeItem(storageKey); } catch { /* private mode */ }
    setScope(null);   // force the loading state rather than showing the old company's numbers
  };

  const handleLogout = () => { logout(); navigate('/login'); };

  const tabs = (scope ? buildTabs(scope.permissions || {}, scope) : []).filter(t => t.show);
  const [tab, setTab] = useHistoryTab(null, defaultTab, { persist: false });
  const activeTab = tabs.some(t => t.key === tab) ? tab : (tabs[0]?.key || null);

  const showPicker = !!scope?.companies?.length;
  const blockedOnCompany = !!scope?.needs_company;

  return (
    <div className="min-h-screen relative" style={{ backgroundColor: 'var(--color-bg)' }}>
      <DotGridBg />
      {updateAvailable && <UpdateBanner />}

      <AppHeader
        title={title}
        logo={
          <div className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ background: 'var(--gradient-sidebar)' }}>
            <Icon className="text-white" size={22} />
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

      {/* Module sub-bar: the controls that belong to THIS module only. Kept out
          of AppHeader so the shared header stays identical everywhere. */}
      <div className="flex items-center gap-3 px-4 sm:px-6 lg:px-8 py-2.5 border-b relative z-10 flex-wrap"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        {showPicker && (
          <div className="flex items-center gap-2" style={{ minWidth: 210 }}>
            <Building2 size={14} style={{ color: 'var(--color-text-tertiary)' }} />
            <ThemedSelect value={companyId} onChange={e => pickCompany(e.target.value)}>
              <option value="">Choose a company...</option>
              {scope.companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </ThemedSelect>
          </div>
        )}

        {!scope && !loadError && <Loading variant="inline" size={16} />}
        {loadError && <span className="text-xs" style={{ color: 'var(--color-error-600)' }}>{loadError}</span>}
        {scope && !blockedOnCompany && tabs.length > 0 && (
          <PillTabs items={tabs} value={activeTab} onChange={setTab} />
        )}

        {/* This is a module, not a home. Someone who reached it from their own
            shell needs the way back without hunting for it. */}
        <button onClick={() => navigate(getRoleRoute(user?.role))}
          className="ml-auto flex items-center gap-1 text-xs font-semibold"
          style={{ color: 'var(--color-text-secondary)' }}>
          <ArrowLeft size={14} />My dashboard
        </button>
      </div>

      <main className="w-full px-4 sm:px-6 lg:px-8 xl:px-10 py-6 sm:py-8 relative z-10">
        {!scope && !loadError && <Loading variant="cards" />}

        {scope && !scope.has_any && (
          <EmptyState icon={Icon} title={`No ${title.toLowerCase()} access`}
            hint="Your role does not include this module. A superadmin can grant it from the User Control Center." />
        )}

        {scope && scope.has_any && blockedOnCompany && (
          <EmptyState icon={Building2} title="Pick a company"
            hint={scope.cross_company
              ? 'You can reach every company, which means none is assumed. Choose one above and this module will scope to it.'
              : 'You belong to more than one company. Choose which one to work in.'} />
        )}

        {scope && scope.has_any && !blockedOnCompany && (
          <>
            {banner?.(scope)}
            {tabs.length === 0
              ? <EmptyState icon={Icon} title={`Nothing to show in ${title.toLowerCase()}`}
                  hint="You have access to the module but none of its sections." />
              : render(activeTab, scope)}
          </>
        )}
      </main>
    </div>
  );
}
