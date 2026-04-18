import { useState, useCallback } from 'react';
import client from '../api/client';

export const useCallbackNumbers = (companyId = null) => {
  const [numbers,   setNumbers]   = useState([]);
  const [claimable, setClaimable] = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);

  const fetchNumbers = useCallback(async (filters = {}) => {
    setLoading(true);
    setError(null);
    try {
      const params = { ...(companyId ? { company_id: companyId } : {}), ...filters };
      const res = await client.get('callback-numbers', { params });
      setNumbers(res.data.numbers || []);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to fetch numbers');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  const fetchClaimable = useCallback(async () => {
    try {
      const params = companyId ? { company_id: companyId } : {};
      const res = await client.get('callback-numbers/claimable', { params });
      setClaimable(res.data.numbers || []);
    } catch { /* non-critical */ }
  }, [companyId]);

  const createNumber = useCallback(async (payload) => {
    const res = await client.post('callback-numbers', {
      ...(companyId ? { company_id: companyId } : {}),
      ...payload,
    });
    return res.data.number;
  }, [companyId]);

  const getDetail = useCallback(async (id) => {
    const res = await client.get(`callback-numbers/${id}`);
    return res.data;
  }, []);

  const logAttempt = useCallback(async (id, payload) => {
    const res = await client.post(`callback-numbers/${id}/attempt`, payload);
    return res.data.attempt;
  }, []);

  const claimNumber = useCallback(async (id) => {
    await client.post(`callback-numbers/${id}/claim`);
  }, []);

  const updateNumber = useCallback(async (id, payload) => {
    const res = await client.put(`callback-numbers/${id}`, payload);
    return res.data.number;
  }, []);

  const reassign = useCallback(async (id, newOwnerId) => {
    await client.put(`callback-numbers/${id}/reassign`, { new_owner_id: newOwnerId });
  }, []);

  const releaseNumber = useCallback(async (id) => {
    await client.delete(`callback-numbers/${id}`);
  }, []);

  const getTeamMembers = useCallback(async (numberId) => {
    const res = await client.get(`callback-numbers/${numberId}/team-members`);
    return res.data.members || [];
  }, []);

  return {
    numbers, claimable, loading, error,
    fetchNumbers, fetchClaimable,
    createNumber, getDetail,
    logAttempt, claimNumber,
    updateNumber, reassign, releaseNumber,
    getTeamMembers,
  };
};
