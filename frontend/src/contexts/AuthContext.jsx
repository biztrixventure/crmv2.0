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

  // Governance for a readonly_admin (managed by SuperAdmin in the Readonly
  // Admins page). It rides on the user object from /auth/me + login, so it's
  // present SYNCHRONOUSLY on the first render (localStorage-hydrated) — this is
  // the no-flash guarantee: a disabled tab/button/export is never rendered even
  // for one paint, and copy-protection is active from frame 0. We deliberately
  // do NOT fetch it async (the old business-config fetch resolved after first
  // paint and caused a "briefly visible then hidden" flash).
  const governance = user?.governance || null;
  const roFlags = governance?.flags || null;   // back-compat: some call-sites read roFlags

  // roFlag(key) — boolean value of a readonly_admin capability flag. For non-RO
  // users always true (the flag is irrelevant). Missing keys default to true so
  // adding a new gate never silently hides a surface from existing RO users
  // until the SuperAdmin reviews it. EXCEPT no_copy, which defaults false (a
  // fresh RO must not be copy-locked by accident).
  const roFlag = useCallback((key) => {
    if (!isReadOnly) return key === 'no_copy' ? false : true;
    const flags = governance?.flags;
    if (!flags) return key === 'no_copy' ? false : true;
    if (key === 'no_copy') return flags.no_copy === true;
    return flags[key] !== false;
  }, [isReadOnly, governance]);
  const roCan = roFlag;   // readable alias at capability call-sites

  // roTabAllowed(tabId) — is this AdminPanel tab visible to the RO? null nav =
  // full parity (every eligible tab). Dashboard is never hidden.
  const roTabAllowed = useCallback((tabId) => {
    if (!isReadOnly) return true;
    const nav = governance?.nav;
    if (!Array.isArray(nav)) return true;                 // parity
    return tabId === 'dashboard' || nav.includes(tabId);
  }, [isReadOnly, governance]);

  // roExportAllowed(area) — may the RO download from this data area? Global
  // can_export kill-switch first, then the per-area toggle. Non-RO always true.
  const roExportAllowed = useCallback((area) => {
    if (!isReadOnly) return true;
    const flags = governance?.flags;
    if (flags && flags.can_export === false) return false;
    const ex = governance?.export;
    if (!ex || !area) return true;
    return ex[area] !== false;
  }, [isReadOnly, governance]);

  // Copy-protection master switch for this RO (drives the shell copy guard).
  const roNoCopy = isReadOnly && governance?.flags?.no_copy === true;

  // roControlAllowed(key) — may this RO see/use a specific ACTION button (e.g.
  // 'data-analyzer.send_batch')? governance.controls is the list of DISABLED
  // keys; absent from it = allowed (parity). Non-RO always true. When false the
  // caller should NOT render the button at all (it never exists for the RO).
  const roControlAllowed = useCallback((key) => {
    if (!isReadOnly || !key) return true;
    const disabled = governance?.controls;
    return !(Array.isArray(disabled) && disabled.includes(key));
  }, [isReadOnly, governance]);

  return (
    <AuthContext.Provider value={{
      user, token, login, logout, updateUser, hasPermission, isReadOnly,
      governance, roFlags, roFlag, roCan, roTabAllowed, roExportAllowed, roNoCopy, roControlAllowed,
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
