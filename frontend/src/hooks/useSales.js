import { useState, useCallback } from 'react';
import client from '../api/client';

/**
 * useSales — fetch, create, update, delete sales.
 */
export const useSales = (companyId = null) => {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [total, setTotal] = useState(0);

  const fetchSales = useCallback(async (filters = {}) => {
    setLoading(true);
    setError(null);
    try {
      const params = { company_id: companyId, ...filters };
      const response = await client.get('sales', { params });
      setSales(response.data.sales || []);
      setTotal(response.data.total || 0);
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to fetch sales';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  /**
   * createSale — accepts full sale data object (new business fields).
   * Previously only accepted transferId; now accepts the complete form payload.
   */
  const createSale = useCallback(async (saleData) => {
    setLoading(true);
    setError(null);
    try {
      const payload = typeof saleData === 'string'
        ? { transfer_id: saleData, company_id: companyId }   // legacy: string = transferId
        : { company_id: companyId, ...saleData };
      const response = await client.post('sales', payload);
      // Backend returns { sale (primary), sales (all created, one per car), count }
      const created = response.data.sales?.length ? response.data.sales : [response.data.sale].filter(Boolean);
      setSales(prev => [...created, ...prev]);
      return response.data;
    } catch (err) {
      const msg = err.response?.data?.errors
        ? err.response.data.errors.map(e => e.msg).join(', ')
        : err.response?.data?.error || err.message || 'Failed to create sale';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  const updateSale = useCallback(async (saleId, updates) => {
    setLoading(true);
    setError(null);
    try {
      const response = await client.put(`sales/${saleId}`, updates);
      await fetchSales();
      return response.data.sale;
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to update sale';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [fetchSales]);

  const deleteSale = useCallback(async (saleId) => {
    setLoading(true);
    setError(null);
    try {
      await client.delete(`sales/${saleId}`);
      setSales(prev => prev.filter(s => s.id !== saleId));
      return true;
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to delete sale';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { sales, total, loading, error, fetchSales, createSale, updateSale, deleteSale };
};
