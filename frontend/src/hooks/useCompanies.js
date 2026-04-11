import { useState, useCallback } from 'react';
import client from '../api/client';

/**
 * Custom hook to manage companies data
 * Fetches available companies for user assignment based on permissions
 */
export const useCompanies = () => {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Fetch available companies for user assignment
  const fetchAvailableCompanies = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await client.get('companies/available');
      setCompanies(response.data.companies || []);
      return response.data.companies;
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to fetch companies';
      setError(errorMsg);
      console.error('Fetch companies error:', errorMsg);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    companies,
    loading,
    error,
    fetchAvailableCompanies,
  };
};
