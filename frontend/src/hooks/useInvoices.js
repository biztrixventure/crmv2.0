import { useState, useCallback } from 'react';
import client from '../api/client';

/**
 * useInvoices -- invoices, line items and payments.
 *
 * `summary` is company-wide, not page-wide: the server computes it over every
 * non-void invoice, so the KPI strip does not change when you paginate.
 *
 * recordPayment does NOT patch the invoice locally. amount_paid and status are
 * maintained by a database trigger (mig 284), so the server response is the
 * only honest picture -- guessing here is how the UI ends up showing paid on
 * an invoice the database still calls partial.
 */
export const useInvoices = (companyId = null) => {
  const [invoices, setInvoices] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState({ invoiced: 0, collected: 0, outstanding: 0, overdue: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchInvoices = useCallback(async (filters = {}) => {
    setLoading(true);
    setError(null);
    try {
      const params = { company_id: companyId, ...filters };
      const response = await client.get('accounting/invoices', { params });
      setInvoices(response.data.invoices || []);
      setTotal(response.data.total || 0);
      if (response.data.summary) setSummary(response.data.summary);
      return response.data;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load invoices');
      return null;
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  const fetchInvoice = useCallback(async (id) => {
    setError(null);
    try {
      const response = await client.get(`accounting/invoices/${id}`, { params: { company_id: companyId } });
      return response.data.invoice;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load the invoice');
      return null;
    }
  }, [companyId]);

  const createInvoice = useCallback(async (payload) => {
    setError(null);
    try {
      const response = await client.post('accounting/invoices', { company_id: companyId, ...payload });
      await fetchInvoices();
      return response.data.invoice;
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to create the invoice';
      setError(msg);
      throw err;
    }
  }, [companyId, fetchInvoices]);

  const updateInvoice = useCallback(async (id, updates) => {
    setError(null);
    try {
      const response = await client.put(`accounting/invoices/${id}`, { company_id: companyId, ...updates });
      await fetchInvoices();
      return response.data.invoice;
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to update the invoice';
      setError(msg);
      throw err;
    }
  }, [companyId, fetchInvoices]);

  const sendInvoice = useCallback(async (id) => {
    setError(null);
    try {
      const response = await client.post(`accounting/invoices/${id}/send`, { company_id: companyId });
      await fetchInvoices();
      return response.data.invoice;
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to send the invoice';
      setError(msg);
      throw err;
    }
  }, [companyId, fetchInvoices]);

  const recordPayment = useCallback(async (id, payment) => {
    setError(null);
    try {
      const response = await client.post(`accounting/invoices/${id}/payments`, { company_id: companyId, ...payment });
      await fetchInvoices();
      // journal_note is a real, non-fatal message (no chart of accounts yet) --
      // pass it back so the page can show it instead of pretending nothing happened.
      return response.data;
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to record the payment';
      setError(msg);
      throw err;
    }
  }, [companyId, fetchInvoices]);

  const deletePayment = useCallback(async (invoiceId, paymentId) => {
    setError(null);
    try {
      const response = await client.delete(`accounting/invoices/${invoiceId}/payments/${paymentId}`, {
        params: { company_id: companyId },
      });
      await fetchInvoices();
      return response.data;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to remove the payment');
      throw err;
    }
  }, [companyId, fetchInvoices]);

  const voidInvoice = useCallback(async (id, reason) => {
    setError(null);
    try {
      const response = await client.post(`accounting/invoices/${id}/void`, { company_id: companyId, reason });
      await fetchInvoices();
      return response.data.invoice;
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to void the invoice';
      setError(msg);
      throw err;
    }
  }, [companyId, fetchInvoices]);

  const deleteInvoice = useCallback(async (id) => {
    setError(null);
    try {
      await client.delete(`accounting/invoices/${id}`, { params: { company_id: companyId } });
      await fetchInvoices();
      return true;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to delete the invoice');
      throw err;
    }
  }, [companyId, fetchInvoices]);

  return {
    invoices, total, summary, loading, error,
    fetchInvoices, fetchInvoice, createInvoice, updateInvoice, sendInvoice,
    recordPayment, deletePayment, voidInvoice, deleteInvoice,
  };
};

export default useInvoices;
