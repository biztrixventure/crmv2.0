import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import client from '../api/client';

const FeatureFlagsContext = createContext({
  flags: {},
  isEnabled: () => false,
  loading: false,
  refresh: () => {},
});

export const FeatureFlagsProvider = ({ children }) => {
  const [flags, setFlags]   = useState({});
  const [loading, setLoading] = useState(true);
  const { isAuthenticated } = useAuth();

  const refresh = useCallback(async () => {
    try {
      // GET /feature-flags returns company-scoped flag states
      const res = await client.get('feature-flags');
      // Response is { flags: { key: { is_enabled, label, ... } } } (object map)
      setFlags(res.data.flags || {});
    } catch {
      // non-critical — leave stale flags in place
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
    }
  }, [isAuthenticated, refresh]);

  // Returns true if the feature is enabled for the current user's company.
  // Defaults to true if the flag is unknown (new flag not yet in DB).
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
