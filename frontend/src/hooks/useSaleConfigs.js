import { useState, useCallback } from 'react';
import client from '../api/client';

/**
 * useSaleConfigs — fetch and manage Plans / Client options set by SuperAdmin.
 */
export const useSaleConfigs = (companyId = null) => {
  const [plans,   setPlans]   = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const fetchConfigs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = companyId ? { company_id: companyId } : {};
      const [plansRes, clientsRes] = await Promise.all([
        client.get('sale-configs', { params: { ...params, type: 'plan'   } }),
        client.get('sale-configs', { params: { ...params, type: 'client' } }),
      ]);
      setPlans(  plansRes.data.configs   || []);
      setClients(clientsRes.data.configs || []);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  const addConfig = useCallback(async (type, value, sort_order = 0) => {
    const res = await client.post('sale-configs', {
      type, value, sort_order,
      ...(companyId ? { company_id: companyId } : {}),
    });
    const cfg = res.data.config;
    if (type === 'plan')   setPlans(prev   => [...prev,   cfg].sort((a, b) => a.sort_order - b.sort_order || a.value.localeCompare(b.value)));
    if (type === 'client') setClients(prev => [...prev,   cfg]);
    return cfg;
  }, [companyId]);

  const deleteConfig = useCallback(async (id, type) => {
    await client.delete(`sale-configs/${id}`);
    if (type === 'plan')   setPlans(prev   => prev.filter(c => c.id !== id));
    if (type === 'client') setClients(prev => prev.filter(c => c.id !== id));
  }, []);

  const updateConfig = useCallback(async (id, type, updates) => {
    const res = await client.put(`sale-configs/${id}`, updates);
    const cfg = res.data.config;
    if (type === 'plan')   setPlans(prev   => prev.map(c => c.id === id ? cfg : c));
    if (type === 'client') setClients(prev => prev.map(c => c.id === id ? cfg : c));
    return cfg;
  }, []);

  return { plans, clients, loading, error, fetchConfigs, addConfig, deleteConfig, updateConfig };
};
