import { useState, useCallback } from 'react';
import client from '../api/client';

/**
 * useChartOfAccounts -- the per-company ledger account catalog.
 *
 * Asks for tree=true and keeps BOTH shapes: the flat list is what every
 * <select> needs, the tree is what the Chart of Accounts page draws. Deriving
 * one from the other in each consumer is how two surfaces end up disagreeing
 * about which account is a child of which.
 */
export const useChartOfAccounts = (companyId = null) => {
  const [accounts, setAccounts] = useState([]);
  const [tree, setTree] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchAccounts = useCallback(async (filters = {}) => {
    setLoading(true);
    setError(null);
    try {
      const params = { company_id: companyId, tree: true, ...filters };
      const response = await client.get('accounting/accounts', { params });
      setAccounts(response.data.accounts || []);
      setTree(response.data.tree || []);
      return response.data;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load the chart of accounts');
      return null;
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  const createAccount = useCallback(async (payload) => {
    setError(null);
    try {
      const response = await client.post('accounting/accounts', { company_id: companyId, ...payload });
      await fetchAccounts();
      return response.data.account;
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to create the account';
      setError(msg);
      throw err;
    }
  }, [companyId, fetchAccounts]);

  const updateAccount = useCallback(async (id, updates) => {
    setError(null);
    try {
      const response = await client.put(`accounting/accounts/${id}`, { company_id: companyId, ...updates });
      await fetchAccounts();
      return response.data.account;
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to update the account';
      setError(msg);
      throw err;
    }
  }, [companyId, fetchAccounts]);

  const deleteAccount = useCallback(async (id) => {
    setError(null);
    try {
      await client.delete(`accounting/accounts/${id}`, { params: { company_id: companyId } });
      await fetchAccounts();
      return true;
    } catch (err) {
      // A 409 here is expected and useful (the account has journal lines) --
      // surface the server sentence rather than a generic failure.
      const msg = err.response?.data?.error || err.message || 'Failed to delete the account';
      setError(msg);
      throw err;
    }
  }, [companyId, fetchAccounts]);

  const seedDefaults = useCallback(async () => {
    setError(null);
    try {
      const response = await client.post('accounting/accounts/seed-defaults', { company_id: companyId });
      await fetchAccounts();
      return response.data;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to seed the chart of accounts');
      throw err;
    }
  }, [companyId, fetchAccounts]);

  return { accounts, tree, loading, error, fetchAccounts, createAccount, updateAccount, deleteAccount, seedDefaults };
};

export default useChartOfAccounts;
