import { useState, useCallback } from 'react';
import client from '../api/client';

/**
 * useEmployees -- the employee directory, plus departments and positions.
 *
 * `canManage` comes from the server, not from a local permission check. The
 * same endpoint serves the wall-chart audience and the HR audience, and the
 * sensitive columns (salary, date of birth, address) are simply absent from the
 * payload for the first group -- so the flag tells the UI which form to render
 * without it having to guess why a field is undefined.
 */
export const useEmployees = (companyId = null) => {
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [positions, setPositions] = useState([]);
  const [total, setTotal] = useState(0);
  const [canManage, setCanManage] = useState(false);
  const [myEmployeeId, setMyEmployeeId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchEmployees = useCallback(async (filters = {}) => {
    setLoading(true);
    setError(null);
    try {
      const params = { company_id: companyId, ...filters };
      const response = await client.get('hr/employees', { params });
      setEmployees(response.data.employees || []);
      setTotal(response.data.total || 0);
      setCanManage(!!response.data.can_manage);
      setMyEmployeeId(response.data.my_employee_id || null);
      return response.data;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load the employee directory');
      return null;
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  const fetchEmployee = useCallback(async (id) => {
    setError(null);
    try {
      const response = await client.get(`hr/employees/${id}`, { params: { company_id: companyId } });
      return response.data;   // { employee, direct_reports }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load the employee');
      return null;
    }
  }, [companyId]);

  const fetchMe = useCallback(async () => {
    try {
      const response = await client.get('hr/employees/me', { params: { company_id: companyId } });
      return response.data.employee;    // null when this user has no HR record
    } catch {
      return null;
    }
  }, [companyId]);

  const createEmployee = useCallback(async (payload) => {
    setError(null);
    try {
      const response = await client.post('hr/employees', { company_id: companyId, ...payload });
      await fetchEmployees();
      return response.data.employee;
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to create the employee';
      setError(msg);
      throw err;
    }
  }, [companyId, fetchEmployees]);

  const updateEmployee = useCallback(async (id, updates) => {
    setError(null);
    try {
      const response = await client.put(`hr/employees/${id}`, { company_id: companyId, ...updates });
      await fetchEmployees();
      return response.data.employee;
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to update the employee';
      setError(msg);
      throw err;
    }
  }, [companyId, fetchEmployees]);

  const deleteEmployee = useCallback(async (id) => {
    setError(null);
    try {
      await client.delete(`hr/employees/${id}`, { params: { company_id: companyId } });
      await fetchEmployees();
      return true;
    } catch (err) {
      // 409 here means "they have HR history, terminate instead" -- a real
      // instruction, so pass the server sentence through untouched.
      setError(err.response?.data?.error || err.message || 'Failed to delete the employee');
      throw err;
    }
  }, [companyId, fetchEmployees]);

  const fetchDepartments = useCallback(async () => {
    try {
      const response = await client.get('hr/employees/departments', { params: { company_id: companyId } });
      setDepartments(response.data.departments || []);
      return response.data.departments || [];
    } catch {
      setDepartments([]);
      return [];
    }
  }, [companyId]);

  const fetchPositions = useCallback(async (departmentId = null) => {
    try {
      const response = await client.get('hr/employees/positions', {
        params: { company_id: companyId, department_id: departmentId || undefined },
      });
      setPositions(response.data.positions || []);
      return response.data.positions || [];
    } catch {
      setPositions([]);
      return [];
    }
  }, [companyId]);

  const saveDepartment = useCallback(async (payload, id = null) => {
    setError(null);
    try {
      const response = id
        ? await client.put(`hr/employees/departments/${id}`, { company_id: companyId, ...payload })
        : await client.post('hr/employees/departments', { company_id: companyId, ...payload });
      await fetchDepartments();
      return response.data.department;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save the department');
      throw err;
    }
  }, [companyId, fetchDepartments]);

  const deleteDepartment = useCallback(async (id) => {
    setError(null);
    try {
      await client.delete(`hr/employees/departments/${id}`, { params: { company_id: companyId } });
      await fetchDepartments();
      return true;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to delete the department');
      throw err;
    }
  }, [companyId, fetchDepartments]);

  const savePosition = useCallback(async (payload, id = null) => {
    setError(null);
    try {
      const response = id
        ? await client.put(`hr/employees/positions/${id}`, { company_id: companyId, ...payload })
        : await client.post('hr/employees/positions', { company_id: companyId, ...payload });
      await fetchPositions();
      return response.data.position;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save the position');
      throw err;
    }
  }, [companyId, fetchPositions]);

  const deletePosition = useCallback(async (id) => {
    setError(null);
    try {
      await client.delete(`hr/employees/positions/${id}`, { params: { company_id: companyId } });
      await fetchPositions();
      return true;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to delete the position');
      throw err;
    }
  }, [companyId, fetchPositions]);

  // CRM users in this company who do not have an HR record yet. This is what
  // makes "create employee from an existing user" possible without typing a uuid.
  const fetchLinkableUsers = useCallback(async () => {
    try {
      const response = await client.get('hr/employees/linkable-users', { params: { company_id: companyId } });
      return response.data.users || [];
    } catch {
      return [];
    }
  }, [companyId]);

  return {
    employees, departments, positions, total, canManage, myEmployeeId, loading, error,
    fetchEmployees, fetchEmployee, fetchMe, createEmployee, updateEmployee, deleteEmployee,
    fetchDepartments, saveDepartment, deleteDepartment,
    fetchPositions, savePosition, deletePosition,
    fetchLinkableUsers,
  };
};

export default useEmployees;
