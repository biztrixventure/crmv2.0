import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import client from "../api/client";

export const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser]   = useState(() => {
    const stored = localStorage.getItem("user");
    return stored ? JSON.parse(stored) : null;
  });
  const [token, setToken] = useState(() => localStorage.getItem("token"));
  const refreshedRef = useRef(false);

  const login = useCallback((userData, accessToken) => {
    setUser(userData);
    setToken(accessToken);
    localStorage.setItem("user", JSON.stringify(userData));
    localStorage.setItem("token", accessToken);
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    localStorage.removeItem("user");
    localStorage.removeItem("token");
    refreshedRef.current = false;
  }, []);

  const updateUser = useCallback((updates) => {
    const updated = { ...user, ...updates };
    setUser(updated);
    localStorage.setItem("user", JSON.stringify(updated));
  }, [user]);

  // On mount (or when token appears), fetch fresh role + permissions from DB.
  // This ensures that if an admin changed this user's role/permissions,
  // after a page refresh they see the updated dashboard immediately.
  useEffect(() => {
    if (!token || refreshedRef.current) return;
    refreshedRef.current = true;
    client.get("auth/me")
      .then(res => {
        const fresh = res.data;
        setUser(fresh);
        localStorage.setItem("user", JSON.stringify(fresh));
      })
      .catch(() => {
        // 401 → axios interceptor already redirects to /login
      });
  }, [token]);

  // Returns true if logged-in user has given permission name.
  // SuperAdmin always gets true. Others check user.permissions[].
  const hasPermission = useCallback((name) => {
    if (!user) return false;
    if (user.role === "superadmin") return true;
    return Array.isArray(user.permissions) && user.permissions.includes(name);
  }, [user]);

  const value = {
    user,
    token,
    login,
    logout,
    updateUser,
    hasPermission,
    isAuthenticated: !!user && !!token,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
};
