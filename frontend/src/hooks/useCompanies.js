import { useState, useCallback } from 'react';
import client from '../api/client';

/**
 * Custom hook to manage companies data
 * Fetches available companies for user assignment and manages full CRUD operations
 */
export const useCompanies = () => {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [total, setTotal] = useState(0);

  // Fetch all companies (SuperAdmin sees all, others see their assigned companies)
  const fetchCompanies = useCallback(async (filters = {}) => {
    setLoading(true);
    setError(null);
    try {
      const response = await client.get('companies', { params: filters });
      setCompanies(response.data.companies || []);
      setTotal(response.data.total || 0);
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

  // Fetch available companies for user assignment (permission-filtered)
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

  // Create new company
  const createCompany = useCallback(async (name, logoUrl) => {
    setLoading(true);
    setError(null);
    try {
      const response = await client.post('companies', {
        name,
        logo_url: logoUrl || null,
      });
      setCompanies([...companies, response.data.company]);
      return response.data.company;
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to create company';
      setError(errorMsg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [companies]);

  // Update company
  const updateCompany = useCallback(async (companyId, updates) => {
    setLoading(true);
    setError(null);
    try {
      const response = await client.put(`companies/${companyId}`, updates);
      // Refetch to get updated data
      await fetchCompanies();
      return response.data.company;
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to update company';
      setError(errorMsg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [fetchCompanies]);

  // Delete company (soft-delete by setting is_active = false)
  const deleteCompany = useCallback(async (companyId) => {
    setLoading(true);
    setError(null);
    try {
      await client.put(`companies/${companyId}`, { is_active: false });
      setCompanies(companies.filter((c) => c.id !== companyId));
      return true;
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to delete company';
      setError(errorMsg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [companies]);

  // Get company members
  const getCompanyMembers = useCallback(async (companyId) => {
    setLoading(true);
    setError(null);
    try {
      const response = await client.get(`companies/${companyId}/members`);
      return response.data.members || [];
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to fetch company members';
      setError(errorMsg);
      console.error('Fetch company members error:', errorMsg);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    companies,
    total,
    loading,
    error,
    fetchCompanies,
    fetchAvailableCompanies,
    createCompany,
    updateCompany,
    deleteCompany,
    getCompanyMembers,
  };
};
