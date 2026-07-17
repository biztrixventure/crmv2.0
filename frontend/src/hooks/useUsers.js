import { useState, useCallback } from 'react';
import client from '../api/client';

/**
 * Custom hook to manage users data
 * Handles fetching, creating, updating, and deleting users
 */
export const useUsers = (companyId = null) => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [total, setTotal] = useState(0);

  // Fetch users
  const fetchUsers = useCallback(async (filters = {}) => {
    setLoading(true);
    setError(null);
    try {
      const params = {
        company_id: companyId,
        ...filters,
      };
      const response = await client.get('users', { params });
      setUsers(response.data.users || []);
      setTotal(response.data.total || 0);
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to fetch users';
      setError(errorMsg);
      console.error('Fetch users error:', errorMsg);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  // Create user — payload: { full_name, email, role_id, password, company_id, require_verification }
  const createUser = useCallback(async (payload) => {
    setLoading(true);
    setError(null);
    try {
      const response = await client.post('users', payload);
      setUsers(prev => [...prev, response.data.user]);
      return response.data;
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to create user';
      setError(errorMsg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Update user
  const updateUser = useCallback(async (userAssignmentId, updates) => {
    setLoading(true);
    setError(null);
    try {
      // Separate password from other updates (password goes to different endpoint)
      const passwordUpdate = updates.password;
      const otherUpdates = { ...updates };
      delete otherUpdates.password;

      // Run the two independently: a failure updating DETAILS must NOT block the
      // password reset (and vice-versa), and each error is attributed clearly.
      // Previously they were chained, so a details error silently ate the
      // password change — that's why "I can't change the password" happened.
      let detailsErr = null, passwordErr = null;
      if (Object.keys(otherUpdates).length > 0) {
        try { await client.put(`users/${userAssignmentId}`, otherUpdates); }
        catch (e) { detailsErr = e.response?.data?.error || 'Failed to update user details'; }
      }
      if (passwordUpdate && passwordUpdate.trim()) {
        try { await client.put(`users/${userAssignmentId}/password`, { password: passwordUpdate }); }
        catch (e) { passwordErr = e.response?.data?.error || 'Failed to update password'; }
      }

      // Refetch to get updated data
      await fetchUsers();
      if (detailsErr || passwordErr) {
        const msg = [detailsErr && `Details: ${detailsErr}`, passwordErr && `Password: ${passwordErr}`].filter(Boolean).join(' · ');
        setError(msg);
        throw new Error(msg);
      }
      return true;
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to update user';
      setError(errorMsg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [fetchUsers]);

  // Deactivate / reactivate a user — flips is_active without deleting the record.
  // Updates the row in place so it stays visible with an updated status.
  const setUserActive = useCallback(async (userAssignmentId, isActive) => {
    setError(null);
    try {
      await client.put(`users/${userAssignmentId}`, { is_active: isActive });
      setUsers(prev => prev.map(u => u.id === userAssignmentId ? { ...u, is_active: isActive } : u));
      return true;
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to update user status';
      setError(errorMsg);
      throw err;
    }
  }, []);

  // Permanently delete a user (removes the auth account). Distinct from deactivation.
  const deleteUser = useCallback(async (userAssignmentId) => {
    setLoading(true);
    setError(null);
    try {
      await client.delete(`users/${userAssignmentId}`);
      setUsers(prev => prev.filter((u) => u.id !== userAssignmentId));
      return true;
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to delete user';
      setError(errorMsg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Resend invite
  const resendInvite = useCallback(async (userId) => {
    setLoading(true);
    setError(null);
    try {
      const response = await client.post(`users/${userId}/send-invite`);
      return response.data;
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to send invite';
      setError(errorMsg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    users,
    total,
    loading,
    error,
    fetchUsers,
    createUser,
    updateUser,
    setUserActive,
    deleteUser,
    resendInvite,
  };
};
