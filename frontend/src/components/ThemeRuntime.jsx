import { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import client from '../api/client';
import { applyTheme, clearTheme } from '../utils/themeApply';

// ThemeRuntime — applies the saved Appearance theme app-wide, every shell.
//
// On auth it reads business_config for the signed-in user's company (the GET
// resolves company override on top of the global default) and injects the
// `theme` override; missing/invalid → clearTheme() so global.css governs. The
// startup cache (applyCachedTheme in main.jsx) already painted the last-good
// theme before React mounted, so this fetch just corrects/keeps it — no flash.
// Renders nothing.
export default function ThemeRuntime() {
  const { isAuthenticated, isRefreshing, user } = useAuth();
  const companyId = user?.company_id || null;

  useEffect(() => {
    // Not signed in (and not mid-refresh) → drop any override + cache so a
    // previous session's company theme never lingers on the login screen.
    if (!isAuthenticated && !isRefreshing) { clearTheme(); return; }
    if (!isAuthenticated) return;   // refreshing — keep the cached paint

    let cancelled = false;
    const params = companyId ? { company_id: companyId } : undefined;
    client.get('business-config', { params })
      .then((r) => {
        if (cancelled) return;
        const theme = r.data?.config?.theme;
        if (theme && theme.light && theme.dark) applyTheme(theme);
        else clearTheme();
      })
      .catch(() => { /* keep cached paint on error */ });
    return () => { cancelled = true; };
  }, [isAuthenticated, isRefreshing, companyId]);

  return null;
}
