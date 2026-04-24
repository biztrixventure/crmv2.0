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
  const [flags, setFlags] = useState({});
  const [loading, setLoading] = useState(true);
  const { isAuthenticated } = useAuth();

  const refresh = useCallback(async () => {
    try {
      const res = await client.get('feature-flags');
      const map = {};
      (res.data.flags || []).forEach(f => { map[f.key] = f; });
      setFlags(map);
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

  const isEnabled = (key) => flags[key]?.is_enabled ?? false;

  return (
    <FeatureFlagsContext.Provider value={{ flags, isEnabled, loading, refresh }}>
      {children}
    </FeatureFlagsContext.Provider>
  );
};

export const useFeatureFlags = () => useContext(FeatureFlagsContext);
