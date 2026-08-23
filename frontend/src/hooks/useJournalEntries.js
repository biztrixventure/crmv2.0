import { useState, useCallback } from 'react';
import client from '../api/client';

/**
 * useJournalEntries -- the double-entry ledger.
 *
 * postEntry and voidEntry surface the server own sentence on failure rather
 * than a generic message: an unbalanced entry comes back as a 422 that names
 * the exact difference, which is the only thing the person can act on.
 */
export const useJournalEntries = (companyId = null) => {
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchEntries = useCallback(async (filters = {}) => {
    setLoading(true);
    setError(null);
    try {
      const params = { company_id: companyId, ...filters };
      const response = await client.get('accounting/journal', { params });
      setEntries(response.data.entries || []);
      setTotal(response.data.total || 0);
      return response.data;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load journal entries');
      return null;
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  const fetchEntry = useCallback(async (id) => {
    setError(null);
    try {
      const response = await client.get(`accounting/journal/${id}`, { params: { company_id: companyId } });
      return response.data.entry;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load the entry');
      return null;
    }
  }, [companyId]);

  // Running balance for one account. Posted entries only -- that is the server
  // rule, restated here so nobody expects drafts to show up.
  const fetchLedger = useCallback(async (accountId, range = {}) => {
    setLoading(true);
    setError(null);
    try {
      const params = { company_id: companyId, account_id: accountId, ...range };
      const response = await client.get('accounting/journal/ledger', { params });
      return response.data;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load the ledger');
      return null;
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  const createEntry = useCallback(async (payload) => {
    setError(null);
    try {
      const response = await client.post('accounting/journal', { company_id: companyId, ...payload });
      await fetchEntries();
      return response.data.entry;
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to create the entry';
      setError(msg);
      throw err;
    }
  }, [companyId, fetchEntries]);

  const updateEntry = useCallback(async (id, updates) => {
    setError(null);
    try {
      const response = await client.put(`accounting/journal/${id}`, { company_id: companyId, ...updates });
      await fetchEntries();
      return response.data.entry;
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to update the entry';
      setError(msg);
      throw err;
    }
  }, [companyId, fetchEntries]);

  const postEntry = useCallback(async (id) => {
    setError(null);
    try {
      const response = await client.post(`accounting/journal/${id}/post`, { company_id: companyId });
      await fetchEntries();
      return response.data.entry;
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to post the entry';
      setError(msg);
      throw err;
    }
  }, [companyId, fetchEntries]);

  const voidEntry = useCallback(async (id, reason) => {
    setError(null);
    try {
      const response = await client.post(`accounting/journal/${id}/void`, { company_id: companyId, reason });
      await fetchEntries();
      return response.data;
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to void the entry';
      setError(msg);
      throw err;
    }
  }, [companyId, fetchEntries]);

  const deleteEntry = useCallback(async (id) => {
    setError(null);
    try {
      await client.delete(`accounting/journal/${id}`, { params: { company_id: companyId } });
      await fetchEntries();
      return true;
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to delete the entry';
      setError(msg);
      throw err;
    }
  }, [companyId, fetchEntries]);

  return {
    entries, total, loading, error,
    fetchEntries, fetchEntry, fetchLedger,
    createEntry, updateEntry, postEntry, voidEntry, deleteEntry,
  };
};

export default useJournalEntries;
