import { useState, useCallback } from 'react';
import client from '../api/client';

/**
 * useFaqs — fetch + manage FAQ knowledge base entries.
 * Listing is role-scoped server-side; create/update/delete require manage_faqs.
 */
export const useFaqs = () => {
  const [faqs, setFaqs]       = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  const fetchFaqs = useCallback(async (params = {}) => {
    setLoading(true);
    setError(null);
    try {
      const res = await client.get('faqs', { params });
      setFaqs(res.data.faqs || []);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load FAQs');
    } finally {
      setLoading(false);
    }
  }, []);

  const createFaq = useCallback(async (payload) => {
    const res = await client.post('faqs', payload);
    setFaqs(prev => [res.data.faq, ...prev]);
    return res.data.faq;
  }, []);

  const updateFaq = useCallback(async (id, updates) => {
    const res = await client.put(`faqs/${id}`, updates);
    setFaqs(prev => prev.map(f => f.id === id ? res.data.faq : f));
    return res.data.faq;
  }, []);

  const deleteFaq = useCallback(async (id) => {
    await client.delete(`faqs/${id}`);
    setFaqs(prev => prev.filter(f => f.id !== id));
  }, []);

  return { faqs, loading, error, fetchFaqs, createFaq, updateFaq, deleteFaq };
};
