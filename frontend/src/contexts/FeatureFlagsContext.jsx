import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import client from '../api/client';

const CACHE_KEY = 'bx_feature_flags';

const readCache = () => {
  try {
    const s = localStorage.getItem(CACHE_KEY);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
};

const writeCache = (flags) => {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(flags)); } catch {}
};

const clearCache = () => {
  try { localStorage.removeItem(CACHE_KEY); } catch {}
};

const FeatureFlagsContext = createContext({
  flags: {},
  isEnabled: () => false,
  loading: false,
  refresh: () => {},
});

export const FeatureFlagsProvider = ({ children }) => {
  // Seed from localStorage so the correct values are available on first render,
  // preventing the "show then hide" flicker caused by the API round-trip.
  const [flags, setFlags]     = useState(() => readCache() || {});
  const [loading, setLoading] = useState(true);
  const { isAuthenticated }   = useAuth();

  const refresh = useCallback(async () => {
    try {
      const res = await client.get('feature-flags');
      const newFlags = res.data.flags || {};
      setFlags(newFlags);
      writeCache(newFlags);
    } catch {
      // non-critical — leave cached/stale flags in place
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      refresh();
    } else {
      setFlags({});
      setLoading(false);
      clearCache();
    }
  }, [isAuthenticated, refresh]);

  // Returns true if the feature is enabled for the current user's company.
  // Defaults to true only for genuinely unknown flags (new flag not yet in DB catalog).
  const isEnabled = (key) => {
    if (!(key in flags)) return true;
    return flags[key]?.is_enabled ?? false;
  };

  return (
    <FeatureFlagsContext.Provider value={{ flags, isEnabled, loading, refresh }}>
      {children}
    </FeatureFlagsContext.Provider>
  );
};

export const useFeatureFlags = () => useContext(FeatureFlagsContext);
