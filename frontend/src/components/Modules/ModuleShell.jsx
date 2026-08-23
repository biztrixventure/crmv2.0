// ============================================================================
// ModuleShell -- the chrome both /accounting and /hr sit inside.
//
// One file, because the two shells differ only in their title, icon and tab
// list; duplicating the scope-loading, the company picker and the empty states
// is how they drift apart.
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
import { LogOut, ArrowLeft, Building2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useHistoryTab } from '../../hooks/useHistoryTab';
import { getRoleRoute } from '../../utils/roleRouting';
import client from '../../api/client';
import DotGridBg from '../UI/DotGridBg';
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
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

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

  const tabs = (scope ? buildTabs(scope.permissions || {}, scope) : []).filter(t => t.show);
  const [tab, setTab] = useHistoryTab(null, defaultTab, { persist: false });
  const activeTab = tabs.some(t => t.key === tab) ? tab : (tabs[0]?.key || null);

  const showPicker = !!scope?.companies?.length;
  const blockedOnCompany = !!scope?.needs_company;

  return (
    <div className="min-h-screen flex flex-col relative" style={{ background: 'var(--color-bg)' }}>
      <DotGridBg />
      <header className="flex items-center gap-4 px-5 py-3 border-b relative z-10 flex-wrap"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <div className="flex items-center gap-2 font-extrabold" style={{ color: 'var(--color-text)' }}>
          <Icon size={20} style={{ color: 'var(--color-primary-600)' }} /> {title}
        </div>

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

        <div className="ml-auto flex items-center gap-3">
          {/* This is a module, not a home. Someone who reached it from their own
              shell needs the way back without hunting for it. */}
          <button onClick={() => navigate(getRoleRoute(user?.role))}
            className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
            <ArrowLeft size={14} />My dashboard
          </button>
          <button onClick={toggleTheme} className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
          <span className="text-xs font-semibold hidden sm:inline" style={{ color: 'var(--color-text-secondary)' }}>{user?.email}</span>
          <button onClick={logout} className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
            <LogOut size={14} />Logout
          </button>
        </div>
      </header>

      <main className="flex-1 p-2 sm:p-5 overflow-auto relative z-10">
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
