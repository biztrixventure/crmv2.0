import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import client from "../api/client";
import { setRealtimeAuth } from "../api/supabase";

export const AuthContext = createContext(null);

// Decode JWT payload without a library
const getTokenExpiry = (token) => {
  try {
    return JSON.parse(atob(token.split('.')[1])).exp * 1000; // ms
  } catch { return null; }
};

export const AuthProvider = ({ children }) => {
  const [user,  setUser]  = useState(() => {
    const s = localStorage.getItem("user");
    return s ? JSON.parse(s) : null;
  });
  const [token, setToken] = useState(() => localStorage.getItem("token"));
  const [isRefreshing, setIsRefreshing] = useState(!!localStorage.getItem("token"));
  const refreshedRef   = useRef(false);
  const timerRef       = useRef(null);
  const refreshTokRef  = useRef(localStorage.getItem("refresh_token"));

  // ── internal refresh ────────────────────────────────────────────────────────
  const doRefresh = useCallback(async () => {
    const rt = refreshTokRef.current;
    if (!rt) return;
    try {
      const res = await client.post("auth/refresh", { refresh_token: rt });
      const newToken = res.data.token;
      const newRT    = res.data.refresh_token || rt;
      setToken(newToken);
      refreshTokRef.current = newRT;
      localStorage.setItem("token", newToken);
      localStorage.setItem("refresh_token", newRT);
      setRealtimeAuth(newToken);
    } catch {
      // Refresh failed — clear everything and send to login
      setUser(null);
      setToken(null);
      refreshTokRef.current = null;
      localStorage.removeItem("token");
      localStorage.removeItem("refresh_token");
      localStorage.removeItem("user");
      window.location.href = "/login";
    }
  }, []);

  // ── schedule next refresh 3 min before expiry ────────────────────────────────
  const scheduleRefresh = useCallback((accessToken) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const exp = getTokenExpiry(accessToken);
    if (!exp) return;
    const delay = exp - Date.now() - 3 * 60 * 1000; // 3 min buffer
    if (delay <= 0) {
      // Already expired or within buffer — refresh immediately
      doRefresh();
    } else {
      timerRef.current = setTimeout(doRefresh, delay);
    }
  }, [doRefresh]);

  // ── public login ─────────────────────────────────────────────────────────────
  const login = useCallback((userData, accessToken, refreshToken) => {
    setUser(userData);
    setToken(accessToken);
    setIsRefreshing(false);
    refreshedRef.current  = true;
    refreshTokRef.current = refreshToken || null;
    localStorage.setItem("user",          JSON.stringify(userData));
    localStorage.setItem("token",         accessToken);
    if (refreshToken) localStorage.setItem("refresh_token", refreshToken);
    setRealtimeAuth(accessToken);
    scheduleRefresh(accessToken);
  }, [scheduleRefresh]);

  // ── public logout ─────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    // Detach THIS device's push subscription from the user logging out, so the
    // next user on this browser doesn't inherit their notifications. Done while
    // the token is still in localStorage so the DELETE authenticates as them,
    // and we tear down the browser subscription so the next login mints a fresh
    // one. Best-effort — never block logout on it.
    try {
      const reg = await navigator.serviceWorker?.getRegistration?.();
      const sub = reg && await reg.pushManager?.getSubscription?.();
      if (sub) {
        await client.delete("push/unsubscribe", { data: { endpoint: sub.endpoint } }).catch(() => {});
        await sub.unsubscribe().catch(() => {});
      }
    } catch { /* push unsupported / no service worker — ignore */ }
    setUser(null);
    setToken(null);
    setIsRefreshing(false);
    refreshedRef.current  = false;
    refreshTokRef.current = null;
    localStorage.removeItem("user");
    localStorage.removeItem("token");
    localStorage.removeItem("refresh_token");
  }, []);

  const updateUser = useCallback((updates) => {
    const updated = { ...user, ...updates };
    setUser(updated);
    localStorage.setItem("user", JSON.stringify(updated));
  }, [user]);

  // ── on mount: validate stored token, schedule refresh ───────────────────────
  useEffect(() => {
    if (!token) { setIsRefreshing(false); return; }
    if (refreshedRef.current) return;
    refreshedRef.current = true;

    const exp = getTokenExpiry(token);
    const now = Date.now();

    if (exp && exp < now) {
      // Token already expired — try refresh before /auth/me
      doRefresh().then(() => {
        const freshToken = localStorage.getItem("token");
        if (!freshToken) return;
        setIsRefreshing(true);
        client.get("auth/me")
          .then(res => { setUser(res.data); localStorage.setItem("user", JSON.stringify(res.data)); })
          .catch(() => {})
          .finally(() => setIsRefreshing(false));
      });
      return;
    }

    // Token still valid — schedule refresh then fetch fresh user data
    if (exp) scheduleRefresh(token);
    setRealtimeAuth(token);
    setIsRefreshing(true);
    client.get("auth/me")
      .then(res => { setUser(res.data); localStorage.setItem("user", JSON.stringify(res.data)); })
      .catch(() => {})
      .finally(() => setIsRefreshing(false));

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const hasPermission = useCallback((name) => {
    if (!user) return false;
    if (user.role === "superadmin") return true;
    return Array.isArray(user.permissions) && user.permissions.includes(name);
  }, [user]);

  // Centralized read-only flag — components gate Create/Update/Delete UI on
  // this and the backend's readonlyGuard middleware enforces the same rule
  // server-side, so a hidden button can't be re-enabled via devtools.
  const isReadOnly = user?.role === 'readonly_admin';

  // Per-user feature flags for a readonly_admin (managed by SuperAdmin in
  // the Readonly Admins page). Loaded once after login; falls back to "all
  // permissive" so a fresh deploy never accidentally locks down a screen.
  // Helpers expose the same API for non-RO users too so call-sites can
  // call without role-branching: roFlag('view_financial_data') === true
  // for superadmin / closer / fronter / etc.
  const [roFlags, setRoFlags] = useState(null);
  useEffect(() => {
    if (!isReadOnly || !user?.id) { setRoFlags(null); return; }
    let cancelled = false;
    client.get('business-config').then(r => {
      if (cancelled) return;
      const v = r.data?.config?.[`readonly_admin.flags.${user.id}`];
      setRoFlags(v && typeof v === 'object' ? v : {});
    }).catch(() => setRoFlags({}));
    return () => { cancelled = true; };
  }, [isReadOnly, user?.id]);

  // roFlag(key) — returns the boolean value of a readonly_admin flag.
  // For non-readonly users always returns true (the flag is irrelevant).
  // Missing keys default to true so adding a new gate never silently
  // hides surfaces from existing RO users until the SuperAdmin reviews it.
  const roFlag = useCallback((key) => {
    if (!isReadOnly) return true;
    if (!roFlags) return true;
    return roFlags[key] !== false;
  }, [isReadOnly, roFlags]);

  return (
    <AuthContext.Provider value={{
      user, token, login, logout, updateUser, hasPermission, isReadOnly,
      roFlags, roFlag,
      isRefreshing, isAuthenticated: !!user && !!token,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
