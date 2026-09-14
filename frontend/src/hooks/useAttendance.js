import { useState, useCallback, useRef } from 'react';
import client from '../api/client';

/**
 * useAttendance -- daily attendance, self and team.
 *
 * `scope` is what the SERVER decided, not what the caller asked for. Someone
 * with only hr.attendance.view_own gets scope:'own' and exactly their own rows,
 * whatever filters they pass. The calendar reads this to decide whether to draw
 * one row or the whole team.
 *
 * Default window is the current month -- the server applies it too. An
 * unbounded attendance query is a table scan nobody wanted.
 */
export const useAttendance = (companyId = null) => {
  const [attendance, setAttendance] = useState([]);
  const [scope, setScope] = useState('none');
  const [period, setPeriod] = useState({ date_from: null, date_to: null });
  const [summary, setSummary] = useState({ hours: 0 });
  const [canManage, setCanManage] = useState(false);
  const [myEmployeeId, setMyEmployeeId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // A refresh after saving re-asks for the SAME window. Calling with no
  // filters used to fall back to the whole month, so the team DAY view showed
  // each person's status from some other day right after "Save".
  const lastFilters = useRef({});
  const fetchAttendance = useCallback(async (filters) => {
    if (filters) lastFilters.current = filters;
    setLoading(true);
    setError(null);
    try {
      const params = { company_id: companyId, ...lastFilters.current };
      const response = await client.get('hr/attendance', { params });
      setAttendance(response.data.attendance || []);
      setScope(response.data.scope || 'none');
      setPeriod(response.data.period || { date_from: null, date_to: null });
      setSummary(response.data.summary || { hours: 0 });
      setCanManage(!!response.data.can_manage);
      setMyEmployeeId(response.data.my_employee_id || null);
      return response.data;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load attendance');
      return null;
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  const fetchMine = useCallback(async (range = {}) => {
    setLoading(true);
    setError(null);
    try {
      const response = await client.get('hr/attendance/me', { params: { company_id: companyId, ...range } });
      return response.data;    // { attendance, employee, period }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load your attendance');
      return null;
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  // Omitting employee_id records YOUR day (the self check-in). Passing one
  // needs hr.attendance.manage -- the server decides, not this hook.
  const recordAttendance = useCallback(async (payload) => {
    setError(null);
    try {
      const response = await client.post('hr/attendance', { company_id: companyId, ...payload });
      await fetchAttendance();
      return response.data.attendance;
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to save the attendance record';
      setError(msg);
      throw err;
    }
  }, [companyId, fetchAttendance]);

  const updateAttendance = useCallback(async (id, updates) => {
    setError(null);
    try {
      const response = await client.put(`hr/attendance/${id}`, { company_id: companyId, ...updates });
      await fetchAttendance();
      return response.data.attendance;
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to update the attendance record';
      setError(msg);
      throw err;
    }
  }, [companyId, fetchAttendance]);

  // One day, many people. This is how a manager marks a whole team present
  // without one request per person.
  const recordBulk = useCallback(async (records) => {
    setError(null);
    try {
      const response = await client.post('hr/attendance/bulk', { company_id: companyId, records });
      await fetchAttendance();
      return response.data;
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to save the attendance records';
      setError(msg);
      throw err;
    }
  }, [companyId, fetchAttendance]);

  const deleteAttendance = useCallback(async (id) => {
    setError(null);
    try {
      await client.delete(`hr/attendance/${id}`, { params: { company_id: companyId } });
      await fetchAttendance();
      return true;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to delete the attendance record');
      throw err;
    }
  }, [companyId, fetchAttendance]);

  // Corrections to days that already exist: one reason for the whole batch
  // (kept in the change log on every row), sent as PUTs so each day turns
  // manual -- the dialer sync never overwrites a correction.
  const correctDays = useCallback(async (changes, reason) => {
    setError(null);
    try {
      for (const c of changes) {
        await client.put(`hr/attendance/${c.id}`, { company_id: companyId, ...c.patch, change_reason: reason });
      }
      await fetchAttendance();
      return changes.length;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save the corrections');
      throw err;
    }
  }, [companyId, fetchAttendance]);

  // Hand a corrected day back to the dialer (the sync re-writes it).
  const resetDay = useCallback(async (id, reason) => {
    setError(null);
    try {
      const response = await client.post(`hr/attendance/${id}/reset`, { company_id: companyId, change_reason: reason });
      await fetchAttendance();
      return response.data;   // { attendance, removed }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to hand the day back');
      throw err;
    }
  }, [companyId, fetchAttendance]);

  // "Sync now" -- re-reads the dialer for a range and says what changed.
  const syncNow = useCallback(async (range = {}) => {
    setError(null);
    try {
      const response = await client.post('hr/attendance/sync', { company_id: companyId, ...range });
      await fetchAttendance();
      return response.data;   // { inserted, updated, removed, skipped? }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to sync from the dialer');
      throw err;
    }
  }, [companyId, fetchAttendance]);

  return {
    attendance, scope, period, summary, canManage, myEmployeeId, loading, error,
    fetchAttendance, fetchMine, recordAttendance, updateAttendance, recordBulk, deleteAttendance,
    correctDays, resetDay, syncNow,
  };
};

export default useAttendance;
