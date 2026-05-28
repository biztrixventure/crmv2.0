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
  const logout = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
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

  return (
    <AuthContext.Provider value={{
      user, token, login, logout, updateUser, hasPermission, isReadOnly,
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
