import { useState, useCallback } from 'react';
import client from '../api/client';

/**
 * useLeaveRequests -- requests, balances and leave types.
 *
 * approve() can come back 422 with { remaining_days, requested_days, hint }
 * rather than a flat failure: the request would overdraw the balance. That is
 * not an error to swallow -- it is the decision the approver has to make, so
 * the whole response body is thrown along with the error for the page to read.
 *
 * The balance movement itself is a database trigger (mig 287). Every action
 * here re-reads the affected balance from the server response instead of
 * adjusting a local number, because the trigger is the only thing that knows
 * what actually happened.
 */
export const useLeaveRequests = (companyId = null) => {
  const [requests, setRequests] = useState([]);
  const [balances, setBalances] = useState([]);
  const [types, setTypes] = useState([]);
  const [scope, setScope] = useState('none');
  const [canApprove, setCanApprove] = useState(false);
  const [myEmployeeId, setMyEmployeeId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchRequests = useCallback(async (filters = {}) => {
    setLoading(true);
    setError(null);
    try {
      const params = { company_id: companyId, ...filters };
      const response = await client.get('hr/leave/requests', { params });
      setRequests(response.data.requests || []);
      setScope(response.data.scope || 'none');
      setCanApprove(!!response.data.can_approve);
      setMyEmployeeId(response.data.my_employee_id || null);
      return response.data;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load leave requests');
      return null;
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  const fetchBalances = useCallback(async (filters = {}) => {
    setError(null);
    try {
      const params = { company_id: companyId, ...filters };
      const response = await client.get('hr/leave/balances', { params });
      setBalances(response.data.balances || []);
      return response.data;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load leave balances');
      return null;
    }
  }, [companyId]);

  const fetchTypes = useCallback(async () => {
    try {
      const response = await client.get('hr/leave/types', { params: { company_id: companyId } });
      setTypes(response.data.types || []);
      return response.data.types || [];
    } catch {
      setTypes([]);
      return [];
    }
  }, [companyId]);

  const saveType = useCallback(async (payload, id = null) => {
    setError(null);
    try {
      const response = id
        ? await client.put(`hr/leave/types/${id}`, { company_id: companyId, ...payload })
        : await client.post('hr/leave/types', { company_id: companyId, ...payload });
      await fetchTypes();
      return response.data.type;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save the leave type');
      throw err;
    }
  }, [companyId, fetchTypes]);

  const setEntitlement = useCallback(async (payload) => {
    setError(null);
    try {
      const response = await client.put('hr/leave/balances', { company_id: companyId, ...payload });
      await fetchBalances({ year: payload.year });
      return response.data.balance;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to set the entitlement');
      throw err;
    }
  }, [companyId, fetchBalances]);

  const createRequest = useCallback(async (payload) => {
    setError(null);
    try {
      const response = await client.post('hr/leave/requests', { company_id: companyId, ...payload });
      await fetchRequests();
      return response.data.request;
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to submit the leave request';
      setError(msg);
      throw err;
    }
  }, [companyId, fetchRequests]);

  const updateRequest = useCallback(async (id, updates) => {
    setError(null);
    try {
      const response = await client.put(`hr/leave/requests/${id}`, { company_id: companyId, ...updates });
      await fetchRequests();
      return response.data.request;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to update the leave request');
      throw err;
    }
  }, [companyId, fetchRequests]);

  // allowOverdraw is an explicit second step, never a default: the first call
  // comes back 422 naming the shortfall, and the approver decides.
  const approveRequest = useCallback(async (id, { note, allowOverdraw = false } = {}) => {
    setError(null);
    try {
      const response = await client.post(`hr/leave/requests/${id}/approve`, {
        company_id: companyId, note, allow_overdraw: allowOverdraw,
      });
      await fetchRequests();
      await fetchBalances();
      return response.data;
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to approve the request';
      setError(msg);
      // Carry the overdraw detail so the caller can offer "approve anyway".
      err.overdraw = err.response?.status === 422 ? err.response.data : null;
      throw err;
    }
  }, [companyId, fetchRequests, fetchBalances]);

  const rejectRequest = useCallback(async (id, reason) => {
    setError(null);
    try {
      const response = await client.post(`hr/leave/requests/${id}/reject`, { company_id: companyId, reason });
      await fetchRequests();
      await fetchBalances();
      return response.data;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to reject the request');
      throw err;
    }
  }, [companyId, fetchRequests, fetchBalances]);

  const cancelRequest = useCallback(async (id, reason) => {
    setError(null);
    try {
      const response = await client.post(`hr/leave/requests/${id}/cancel`, { company_id: companyId, reason });
      await fetchRequests();
      await fetchBalances();
      return response.data;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to cancel the request');
      throw err;
    }
  }, [companyId, fetchRequests, fetchBalances]);

  return {
    requests, balances, types, scope, canApprove, myEmployeeId, loading, error,
    fetchRequests, fetchBalances, fetchTypes, saveType, setEntitlement,
    createRequest, updateRequest, approveRequest, rejectRequest, cancelRequest,
  };
};

export default useLeaveRequests;
