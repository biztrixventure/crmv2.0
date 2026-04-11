import { useState, useEffect } from 'react';
import client from '../api/client';

/**
 * Custom hook to manage roles data
 * Handles fetching, creating, updating, and deleting roles
 */
export const useRoles = (companyId = null) => {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Fetch roles
  const fetchRoles = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = companyId ? { company_id: companyId } : {};
      const response = await client.get('/api/roles', { params });
      setRoles(response.data.roles || []);
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to fetch roles';
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  // Create role
  const createRole = async (name, description, level, permissions) => {
    setLoading(true);
    setError(null);
    try {
      const response = await client.post('/api/roles', {
        name,
        description,
        level,
        permissions,
      });
      setRoles([...roles, response.data.role]);
      return response.data.role;
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to create role';
      setError(errorMsg);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  // Update role
  const updateRole = async (roleId, description, permissions) => {
    setLoading(true);
    setError(null);
    try {
      await client.put(`/api/roles/${roleId}`, {
        description,
        permissions,
      });
      // Refetch to get updated data
      await fetchRoles();
      return true;
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to update role';
      setError(errorMsg);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  // Delete role
  const deleteRole = async (roleId) => {
    setLoading(true);
    setError(null);
    try {
      await client.delete(`/api/roles/${roleId}`);
      setRoles(roles.filter(r => r.id !== roleId));
      return true;
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to delete role';
      setError(errorMsg);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return {
    roles,
    loading,
    error,
    fetchRoles,
    createRole,
    updateRole,
    deleteRole,
  };
};
