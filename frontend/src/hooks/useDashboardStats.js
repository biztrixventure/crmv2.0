import { useState, useCallback } from 'react';
import client from '../api/client';

/**
 * Custom hook for dashboard statistics
 * Fetches role-based metrics from the stats API
 */
export const useDashboardStats = () => {
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await client.get('stats/dashboard');
      setStats(response.data.stats || {});
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to fetch stats';
      setError(errorMsg);
      console.error('Fetch stats error:', errorMsg);
    } finally {
      setLoading(false);
    }
  }, []);

  return { stats, loading, error, fetchStats };
};
