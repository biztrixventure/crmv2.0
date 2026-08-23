import { useState, useCallback } from 'react';
import client from '../api/client';

/**
 * useExpenses -- expense claims, both sides of the desk.
 *
 * `scope` is a REQUEST, not a guarantee. The server decides what you actually
 * get: someone with only accounting.expenses.submit is pinned to their own
 * claims however they ask, and the response echoes the scope it applied. The
 * page reads response.scope, never the argument it sent.
 */
export const useExpenses = (companyId = null) => {
  const [expenses, setExpenses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [total, setTotal] = useState(0);
  const [scope, setScope] = useState('mine');
  const [canApprove, setCanApprove] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchExpenses = useCallback(async (filters = {}) => {
    setLoading(true);
    setError(null);
    try {
      const params = { company_id: companyId, ...filters };
      const response = await client.get('accounting/expenses', { params });
      setExpenses(response.data.expenses || []);
      setTotal(response.data.total || 0);
      setScope(response.data.scope || 'mine');
      setCanApprove(!!response.data.can_approve);
      return response.data;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load expenses');
      return null;
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  const fetchCategories = useCallback(async () => {
    try {
      const response = await client.get('accounting/expenses/categories', { params: { company_id: companyId } });
      setCategories(response.data.categories || []);
      return response.data.categories || [];
    } catch {
      // A missing category list must not block filing a claim -- category is
      // optional on the expense itself.
      setCategories([]);
      return [];
    }
  }, [companyId]);

  const createCategory = useCallback(async (payload) => {
    setError(null);
    try {
      const response = await client.post('accounting/expenses/categories', { company_id: companyId, ...payload });
      await fetchCategories();
      return response.data.category;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to create the category');
      throw err;
    }
  }, [companyId, fetchCategories]);

  const createExpense = useCallback(async (payload) => {
    setError(null);
    try {
      const response = await client.post('accounting/expenses', { company_id: companyId, ...payload });
      await fetchExpenses();
      return response.data.expense;
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to create the claim';
      setError(msg);
      throw err;
    }
  }, [companyId, fetchExpenses]);

  const updateExpense = useCallback(async (id, updates) => {
    setError(null);
    try {
      const response = await client.put(`accounting/expenses/${id}`, { company_id: companyId, ...updates });
      await fetchExpenses();
      return response.data.expense;
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to update the claim';
      setError(msg);
      throw err;
    }
  }, [companyId, fetchExpenses]);

  // submit / withdraw / approve / reject / reimburse all share one shape, so
  // they share one implementation. Anything else drifts.
  const act = useCallback(async (id, action, body = {}) => {
    setError(null);
    try {
      const response = await client.post(`accounting/expenses/${id}/${action}`, { company_id: companyId, ...body });
      await fetchExpenses();
      return response.data;
    } catch (err) {
      const msg = err.response?.data?.error || err.message || `Failed to ${action} the claim`;
      setError(msg);
      throw err;
    }
  }, [companyId, fetchExpenses]);

  const submitExpense    = useCallback((id) => act(id, 'submit'), [act]);
  const withdrawExpense  = useCallback((id) => act(id, 'withdraw'), [act]);
  const approveExpense   = useCallback((id) => act(id, 'approve'), [act]);
  const rejectExpense    = useCallback((id, reason) => act(id, 'reject', { reason }), [act]);
  const reimburseExpense = useCallback((id) => act(id, 'reimburse'), [act]);

  const deleteExpense = useCallback(async (id) => {
    setError(null);
    try {
      await client.delete(`accounting/expenses/${id}`, { params: { company_id: companyId } });
      await fetchExpenses();
      return true;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to delete the claim');
      throw err;
    }
  }, [companyId, fetchExpenses]);

  return {
    expenses, categories, total, scope, canApprove, loading, error,
    fetchExpenses, fetchCategories, createCategory,
    createExpense, updateExpense, deleteExpense,
    submitExpense, withdrawExpense, approveExpense, rejectExpense, reimburseExpense,
  };
};

export default useExpenses;
