import { useState, useCallback, useRef } from 'react';
import client from '../api/client';

/**
 * Custom hook to manage transfers data
 * Handles fetching, creating, and updating transfers
 */
export const useTransfers = (companyId = null) => {
  const [transfers, setTransfers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [total, setTotal] = useState(0);
  const lastFilters = useRef({});

  // Fetch transfers (role-based filtering done server-side)
  const fetchTransfers = useCallback(async (filters = {}) => {
    lastFilters.current = filters;
    setLoading(true);
    setError(null);
    try {
      const params = { company_id: companyId, ...filters };
      const response = await client.get('transfers', { params });
      setTransfers(response.data.transfers || []);
      setTotal(response.data.total || 0);
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to fetch transfers';
      setError(errorMsg);
      console.error('Fetch transfers error:', errorMsg);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  // Create a new transfer — payload must include assigned_closer_id
  const createTransfer = useCallback(async (payload) => {
    setLoading(true);
    setError(null);
    try {
      const { assigned_closer_id, ...rest } = payload;
      const response = await client.post('transfers', {
        company_id:         companyId,
        form_data:          rest,
        assigned_closer_id,
      });
      const { transfer, action } = response.data;
      // 'updated' (Check 1) returns the existing row in place — replace it, don't
      // prepend a duplicate. New rows go to the top.
      setTransfers(prev => action === 'updated' && prev.some(t => t.id === transfer.id)
        ? prev.map(t => (t.id === transfer.id ? transfer : t))
        : [transfer, ...prev]);
      return response.data;   // { transfer, action }
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to create transfer';
      setError(errorMsg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  // Update transfer status or assignment
  const updateTransfer = useCallback(async (transferId, updates) => {
    setLoading(true);
    setError(null);
    try {
      const response = await client.put(`transfers/${transferId}`, updates);
      await fetchTransfers(lastFilters.current);
      return response.data.transfer;
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to update transfer';
      setError(errorMsg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [fetchTransfers]);

  const deleteTransfer = useCallback(async (transferId) => {
    try {
      await client.delete(`transfers/${transferId}`);
      setTransfers(prev => prev.filter(t => t.id !== transferId));
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to delete transfer';
      setError(errorMsg);
      throw err;
    }
  }, []);

  return {
    transfers,
    total,
    loading,
    error,
    fetchTransfers,
    createTransfer,
    updateTransfer,
    deleteTransfer,
  };
};
