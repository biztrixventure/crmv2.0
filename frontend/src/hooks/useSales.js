import { useState, useCallback } from 'react';
import client from '../api/client';

/**
 * Custom hook to manage sales data
 * Handles fetching, creating, and updating sales
 */
export const useSales = (companyId = null) => {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [total, setTotal] = useState(0);

  // Fetch sales (role-based filtering done server-side)
  const fetchSales = useCallback(async (filters = {}) => {
    setLoading(true);
    setError(null);
    try {
      const params = { company_id: companyId, ...filters };
      const response = await client.get('sales', { params });
      setSales(response.data.sales || []);
      setTotal(response.data.total || 0);
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to fetch sales';
      setError(errorMsg);
      console.error('Fetch sales error:', errorMsg);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  // Create sale from transfer
  const createSale = useCallback(async (transferId) => {
    setLoading(true);
    setError(null);
    try {
      const response = await client.post('sales', {
        transfer_id: transferId,
        company_id: companyId,
      });
      const newSale = response.data.sale;
      setSales(prev => [newSale, ...prev]);
      return newSale;
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to create sale';
      setError(errorMsg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  // Update sale status
  const updateSale = useCallback(async (saleId, updates) => {
    setLoading(true);
    setError(null);
    try {
      const response = await client.put(`sales/${saleId}`, updates);
      await fetchSales(); // Refresh list
      return response.data.sale;
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to update sale';
      setError(errorMsg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [fetchSales]);

  return {
    sales,
    total,
    loading,
    error,
    fetchSales,
    createSale,
    updateSale,
  };
};
