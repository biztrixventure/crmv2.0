import { useState, useCallback } from 'react';
import client from '../api/client';

/**
 * usePayroll -- pay periods, runs, entries, deductions, and my payslips.
 *
 * Two doors, deliberately separate calls:
 *   fetchRuns / fetchRun  need hr.payroll.view or .manage  (the operator view)
 *   fetchMyPayslips       needs hr.payroll.view_own        (the employee view)
 *
 * fetchMyPayslips takes no employee id at all. The server resolves the caller
 * own hr_employees row from (company_id, user_id), so nobody reads a colleague
 * payslip by guessing a uuid -- and returns FINALIZED runs only, because a
 * draft run is a spreadsheet in progress, not a payslip.
 *
 * Nothing here computes money. gross and net are generated columns and the run
 * totals are trigger-fed (mig 288); every mutation re-reads rather than
 * adjusting a local number.
 */
export const usePayroll = (companyId = null) => {
  const [runs, setRuns] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchPeriods = useCallback(async () => {
    setError(null);
    try {
      const response = await client.get('hr/payroll/periods', { params: { company_id: companyId } });
      setPeriods(response.data.periods || []);
      return response.data.periods || [];
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load pay periods');
      return [];
    }
  }, [companyId]);

  const createPeriod = useCallback(async (payload) => {
    setError(null);
    try {
      const response = await client.post('hr/payroll/periods', { company_id: companyId, ...payload });
      await fetchPeriods();
      return response.data.period;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to create the pay period');
      throw err;
    }
  }, [companyId, fetchPeriods]);

  const fetchRuns = useCallback(async (filters = {}) => {
    setLoading(true);
    setError(null);
    try {
      const params = { company_id: companyId, ...filters };
      const response = await client.get('hr/payroll/runs', { params });
      setRuns(response.data.runs || []);
      setCanManage(!!response.data.can_manage);
      return response.data;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load payroll runs');
      return null;
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  const fetchRun = useCallback(async (id) => {
    setLoading(true);
    setError(null);
    try {
      const response = await client.get(`hr/payroll/runs/${id}`, { params: { company_id: companyId } });
      return response.data;   // { run, entries, can_manage }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load the payroll run');
      return null;
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  // prefill:true seeds one entry per active employee at their base salary. It
  // is a STARTING POINT -- the operator edits every line before finalizing.
  const createRun = useCallback(async (payload) => {
    setError(null);
    try {
      const response = await client.post('hr/payroll/runs', { company_id: companyId, ...payload });
      await fetchRuns();
      return response.data.run;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to create the payroll run');
      throw err;
    }
  }, [companyId, fetchRuns]);

  const updateRun = useCallback(async (id, updates) => {
    setError(null);
    try {
      const response = await client.put(`hr/payroll/runs/${id}`, { company_id: companyId, ...updates });
      await fetchRuns();
      return response.data.run;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to update the payroll run');
      throw err;
    }
  }, [companyId, fetchRuns]);

  const saveEntry = useCallback(async (runId, payload) => {
    setError(null);
    try {
      const response = await client.post(`hr/payroll/runs/${runId}/entries`, { company_id: companyId, ...payload });
      return response.data.entry;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save the payroll entry');
      throw err;
    }
  }, [companyId]);

  const updateEntry = useCallback(async (entryId, updates) => {
    setError(null);
    try {
      const response = await client.put(`hr/payroll/entries/${entryId}`, { company_id: companyId, ...updates });
      return response.data.entry;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to update the payroll entry');
      throw err;
    }
  }, [companyId]);

  const deleteEntry = useCallback(async (entryId) => {
    setError(null);
    try {
      await client.delete(`hr/payroll/entries/${entryId}`, { params: { company_id: companyId } });
      return true;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to remove the payroll entry');
      throw err;
    }
  }, [companyId]);

  const addDeduction = useCallback(async (entryId, payload) => {
    setError(null);
    try {
      const response = await client.post(`hr/payroll/entries/${entryId}/deductions`, { company_id: companyId, ...payload });
      return response.data;   // { deduction, entry } -- entry carries the new totals
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to add the deduction');
      throw err;
    }
  }, [companyId]);

  const deleteDeduction = useCallback(async (deductionId) => {
    setError(null);
    try {
      const response = await client.delete(`hr/payroll/deductions/${deductionId}`, { params: { company_id: companyId } });
      return response.data;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to remove the deduction');
      throw err;
    }
  }, [companyId]);

  const finalizeRun = useCallback(async (id, { postJournal = true } = {}) => {
    setError(null);
    try {
      const response = await client.post(`hr/payroll/runs/${id}/finalize`, {
        company_id: companyId, post_journal: postJournal,
      });
      await fetchRuns();
      // journal_note is non-fatal ("no chart of accounts yet") -- show it.
      return response.data;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to finalize the payroll run');
      throw err;
    }
  }, [companyId, fetchRuns]);

  const voidRun = useCallback(async (id, reason) => {
    setError(null);
    try {
      const response = await client.post(`hr/payroll/runs/${id}/void`, { company_id: companyId, reason });
      await fetchRuns();
      return response.data;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to void the payroll run');
      throw err;
    }
  }, [companyId, fetchRuns]);

  const fetchMyPayslips = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await client.get('hr/payroll/my-payslips', { params: { company_id: companyId } });
      return response.data;   // { payslips, employee }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load your payslips');
      return null;
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  return {
    runs, periods, canManage, loading, error,
    fetchPeriods, createPeriod,
    fetchRuns, fetchRun, createRun, updateRun,
    saveEntry, updateEntry, deleteEntry, addDeduction, deleteDeduction,
    finalizeRun, voidRun, fetchMyPayslips,
  };
};

export default usePayroll;
