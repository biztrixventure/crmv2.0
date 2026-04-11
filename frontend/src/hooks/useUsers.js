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

  // Create user
  const createUser = useCallback(async (email, firstName, lastName, roleId, password) => {
    setLoading(true);
    setError(null);
    try {
      const response = await client.post('users', {
        email,
        first_name: firstName,
        last_name: lastName,
        role_id: roleId,
        company_id: companyId,
        password,  // NEW: include password if provided
      });
      setUsers([...users, response.data.user]);
      return response.data;
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to create user';
      setError(errorMsg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [users, companyId]);

  // Update user
  const updateUser = useCallback(async (userAssignmentId, updates) => {
    setLoading(true);
    setError(null);
    try {
      // Separate password from other updates (password goes to different endpoint)
      const passwordUpdate = updates.password;
      const otherUpdates = { ...updates };
      delete otherUpdates.password;

      // Update user profile/role if there are non-password updates
      if (Object.keys(otherUpdates).length > 0) {
        await client.put(`users/${userAssignmentId}`, otherUpdates);
      }

      // Update password separately if provided (different endpoint)
      if (passwordUpdate && passwordUpdate.trim()) {
        await client.put(`users/${userAssignmentId}/password`, {
          password: passwordUpdate,
        });
      }

      // Refetch to get updated data
      await fetchUsers();
      return true;
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to update user';
      setError(errorMsg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [fetchUsers]);

  // Delete user (soft delete - deactivate)
  const deleteUser = useCallback(async (userAssignmentId) => {
    setLoading(true);
    setError(null);
    try {
      await client.delete(`users/${userAssignmentId}`);
      setUsers(users.filter((u) => u.id !== userAssignmentId));
      return true;
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to delete user';
      setError(errorMsg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [users]);

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
    deleteUser,
    resendInvite,
  };
};
