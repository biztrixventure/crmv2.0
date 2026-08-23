import { useState, useCallback } from 'react';
import client from '../api/client';

/**
 * usePerformanceReviews -- cycles, reviews, goals and competency ratings.
 *
 * The ladder is pending_self -> pending_manager -> pending_signoff -> completed,
 * and each rung has its own endpoint because each rung belongs to a different
 * person. There is deliberately no generic setStatus(): the server would refuse
 * it anyway, and offering one in the client invites a UI that pretends a
 * reviewer can write a self-assessment.
 *
 * submitSelf and submitManager both accept { goals, ratings }. Which COLUMN
 * those land in is decided server-side by which endpoint was called, so one
 * side can never overwrite the other rating.
 */
export const usePerformanceReviews = (companyId = null) => {
  const [reviews, setReviews] = useState([]);
  const [cycles, setCycles] = useState([]);
  const [scope, setScope] = useState('mine');
  const [canManage, setCanManage] = useState(false);
  const [myEmployeeId, setMyEmployeeId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchCycles = useCallback(async () => {
    setError(null);
    try {
      const response = await client.get('hr/reviews/cycles', { params: { company_id: companyId } });
      setCycles(response.data.cycles || []);
      setCanManage(!!response.data.can_manage);
      return response.data.cycles || [];
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load review cycles');
      return [];
    }
  }, [companyId]);

  const saveCycle = useCallback(async (payload, id = null) => {
    setError(null);
    try {
      const response = id
        ? await client.put(`hr/reviews/cycles/${id}`, { company_id: companyId, ...payload })
        : await client.post('hr/reviews/cycles', { company_id: companyId, ...payload });
      await fetchCycles();
      return response.data.cycle;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save the cycle');
      throw err;
    }
  }, [companyId, fetchCycles]);

  // Idempotent on the server: employees who already have a review in this cycle
  // are skipped, so re-launching after a new hire joins is safe.
  const launchCycle = useCallback(async (id, employeeIds = null) => {
    setError(null);
    try {
      const response = await client.post(`hr/reviews/cycles/${id}/launch`, {
        company_id: companyId,
        employee_ids: employeeIds || undefined,
      });
      await fetchCycles();
      return response.data;   // { created, skipped }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to launch the cycle');
      throw err;
    }
  }, [companyId, fetchCycles]);

  const fetchReviews = useCallback(async (filters = {}) => {
    setLoading(true);
    setError(null);
    try {
      const params = { company_id: companyId, ...filters };
      const response = await client.get('hr/reviews', { params });
      setReviews(response.data.reviews || []);
      setScope(response.data.scope || 'mine');
      setCanManage(!!response.data.can_manage);
      setMyEmployeeId(response.data.my_employee_id || null);
      return response.data;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load reviews');
      return null;
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  const fetchReview = useCallback(async (id) => {
    setLoading(true);
    setError(null);
    try {
      const response = await client.get(`hr/reviews/${id}`, { params: { company_id: companyId } });
      return response.data;   // { review, is_subject, is_reviewer, can_manage }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load the review');
      return null;
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  const createReview = useCallback(async (payload) => {
    setError(null);
    try {
      const response = await client.post('hr/reviews', { company_id: companyId, ...payload });
      await fetchReviews();
      return response.data.review;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to create the review');
      throw err;
    }
  }, [companyId, fetchReviews]);

  const updateReview = useCallback(async (id, updates) => {
    setError(null);
    try {
      const response = await client.put(`hr/reviews/${id}`, { company_id: companyId, ...updates });
      return response.data.review;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to update the review');
      throw err;
    }
  }, [companyId]);

  // submit:false saves without advancing the ladder -- that is the draft path.
  const submitSelf = useCallback(async (id, payload) => {
    setError(null);
    try {
      const response = await client.post(`hr/reviews/${id}/self`, { company_id: companyId, ...payload });
      return response.data.review;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save the self-assessment');
      throw err;
    }
  }, [companyId]);

  const submitManager = useCallback(async (id, payload) => {
    setError(null);
    try {
      const response = await client.post(`hr/reviews/${id}/manager`, { company_id: companyId, ...payload });
      return response.data.review;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save the manager review');
      throw err;
    }
  }, [companyId]);

  const signOff = useCallback(async (id, comments) => {
    setError(null);
    try {
      const response = await client.post(`hr/reviews/${id}/signoff`, {
        company_id: companyId, signoff_comments: comments,
      });
      await fetchReviews();
      return response.data.review;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to sign off the review');
      throw err;
    }
  }, [companyId, fetchReviews]);

  // Goes back exactly ONE rung -- see the route comment. There is no jump-to-any.
  const reopen = useCallback(async (id) => {
    setError(null);
    try {
      const response = await client.post(`hr/reviews/${id}/reopen`, { company_id: companyId });
      await fetchReviews();
      return response.data;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to reopen the review');
      throw err;
    }
  }, [companyId, fetchReviews]);

  const addGoal = useCallback(async (reviewId, payload) => {
    setError(null);
    try {
      const response = await client.post(`hr/reviews/${reviewId}/goals`, { company_id: companyId, ...payload });
      return response.data.goal;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to add the goal');
      throw err;
    }
  }, [companyId]);

  const updateGoal = useCallback(async (goalId, updates) => {
    setError(null);
    try {
      const response = await client.put(`hr/reviews/goals/${goalId}`, { company_id: companyId, ...updates });
      return response.data.goal;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to update the goal');
      throw err;
    }
  }, [companyId]);

  const deleteGoal = useCallback(async (goalId) => {
    setError(null);
    try {
      await client.delete(`hr/reviews/goals/${goalId}`, { params: { company_id: companyId } });
      return true;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to delete the goal');
      throw err;
    }
  }, [companyId]);

  const addRating = useCallback(async (reviewId, competency) => {
    setError(null);
    try {
      const response = await client.post(`hr/reviews/${reviewId}/ratings`, { company_id: companyId, competency });
      return response.data.rating;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to add the competency');
      throw err;
    }
  }, [companyId]);

  const updateRating = useCallback(async (ratingId, updates) => {
    setError(null);
    try {
      const response = await client.put(`hr/reviews/ratings/${ratingId}`, { company_id: companyId, ...updates });
      return response.data.rating;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to update the rating');
      throw err;
    }
  }, [companyId]);

  return {
    reviews, cycles, scope, canManage, myEmployeeId, loading, error,
    fetchCycles, saveCycle, launchCycle,
    fetchReviews, fetchReview, createReview, updateReview,
    submitSelf, submitManager, signOff, reopen,
    addGoal, updateGoal, deleteGoal, addRating, updateRating,
  };
};

export default usePerformanceReviews;
