import { useState, useCallback } from 'react';
import client from '../api/client';

/**
 * useScripts — standalone call-script knowledge base (independent of FAQs).
 * Listing is role-scoped server-side; create/update/delete require manage_faqs.
 */
export const useScripts = () => {
  const [scripts, setScripts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  const fetchScripts = useCallback(async (params = {}) => {
    setLoading(true);
    setError(null);
    try {
      const res = await client.get('scripts', { params });
      setScripts(res.data.scripts || []);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load scripts');
    } finally {
      setLoading(false);
    }
  }, []);

  const createScript = useCallback(async (payload) => {
    const res = await client.post('scripts', payload);
    setScripts(prev => [res.data.script, ...prev]);
    return res.data.script;
  }, []);

  const updateScript = useCallback(async (id, updates) => {
    const res = await client.put(`scripts/${id}`, updates);
    setScripts(prev => prev.map(s => s.id === id ? res.data.script : s));
    return res.data.script;
  }, []);

  const deleteScript = useCallback(async (id) => {
    await client.delete(`scripts/${id}`);
    setScripts(prev => prev.filter(s => s.id !== id));
  }, []);

  return { scripts, loading, error, fetchScripts, createScript, updateScript, deleteScript };
};
