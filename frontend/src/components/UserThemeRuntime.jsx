import { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { reconcileUserTheme, clearUserTheme } from '../utils/userTheme';

// UserThemeRuntime — applies the signed-in user's PERSONAL colour theme
// (localStorage, per-user) on top of the company theme (ThemeRuntime). Mounted
// AFTER ThemeRuntime so the user layer is injected last. On sign-out it strips
// the personal layer so the login screen shows the default/company palette.
// Renders nothing.
export default function UserThemeRuntime() {
  const { isAuthenticated, isRefreshing, user } = useAuth();
  const uid = user?.id || null;

  useEffect(() => {
    if (!isAuthenticated) {
      if (!isRefreshing) clearUserTheme(null, { cache: false }); // keep stored obj, just unpaint
      return;
    }
    if (uid) reconcileUserTheme(uid);
  }, [isAuthenticated, isRefreshing, uid]);

  return null;
}
