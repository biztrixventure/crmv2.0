import { useState, useCallback } from 'react';
import client from '../api/client';

/**
 * Custom hook to manage form fields
 * Used by admin form builder and fronter transfer form
 */
export const useFormFields = () => {
  const [fields, setFields] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Fetch all form fields
  const fetchFields = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await client.get('forms/fields');
      setFields(response.data.fields || []);
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to fetch form fields';
      setError(errorMsg);
      console.error('Fetch form fields error:', errorMsg);
    } finally {
      setLoading(false);
    }
  }, []);

  // Create a form field
  const createField = useCallback(async (fieldData) => {
    setLoading(true);
    setError(null);
    try {
      const response = await client.post('forms/fields', fieldData);
      setFields(prev => [...prev, response.data.field]);
      return response.data.field;
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to create field';
      setError(errorMsg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Update a form field
  const updateField = useCallback(async (fieldId, updates) => {
    setLoading(true);
    setError(null);
    try {
      await client.put(`forms/fields/${fieldId}`, updates);
      await fetchFields(); // Refresh
      return true;
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to update field';
      setError(errorMsg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [fetchFields]);

  // Delete a form field
  const deleteField = useCallback(async (fieldId) => {
    setLoading(true);
    setError(null);
    try {
      await client.delete(`forms/fields/${fieldId}`);
      setFields(prev => prev.filter(f => f.id !== fieldId));
      return true;
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to delete field';
      setError(errorMsg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    fields,
    loading,
    error,
    fetchFields,
    createField,
    updateField,
    deleteField,
  };
};
