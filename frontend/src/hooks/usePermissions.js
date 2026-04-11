import { useState, useEffect } from 'react';
import client from '../api/client';

/**
 * Custom hook to manage permissions
 * Fetches available permissions grouped by category
 */
export const usePermissions = () => {
  const [permissions, setPermissions] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchPermissions = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await client.get('/api/roles/permissions');
      setPermissions(response.data);
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to fetch permissions';
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  // Flatten permissions for easier access
  const flatPermissions = Object.values(permissions).flat() || [];

  return {
    permissions,
    flatPermissions,
    loading,
    error,
    fetchPermissions,
  };
};
