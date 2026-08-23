import { useState, useCallback } from 'react';
import client from '../api/client';

/**
 * useAccountingReports -- P&L, balance sheet, trial balance, dashboard summary.
 *
 * Note the shapes differ on purpose and the hook does not smooth that over:
 * the P&L takes a date RANGE (it is a period report), the balance sheet takes a
 * single as_of date (it is a point in time). Handing a balance sheet a range is
 * the most common way to make one not balance, so the two are kept apart here
 * rather than sharing a filter object.
 *
 * The balance sheet response carries `balanced` and `difference`. Show them.
 * A sheet that quietly presents a tidy total while the ledger disagrees is
 * worse than one that says it is out by 12.40.
 */
export const useAccountingReports = (companyId = null) => {
  const [summary, setSummary] = useState(null);
  const [profitLoss, setProfitLoss] = useState(null);
  const [balanceSheet, setBalanceSheet] = useState(null);
  const [trialBalance, setTrialBalance] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await client.get('accounting/reports/summary', { params: { company_id: companyId } });
      setSummary(response.data);
      return response.data;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load the accounting summary');
      return null;
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  const fetchProfitLoss = useCallback(async ({ date_from, date_to } = {}) => {
    setLoading(true);
    setError(null);
    try {
      const response = await client.get('accounting/reports/profit-loss', {
        params: { company_id: companyId, date_from, date_to },
      });
      setProfitLoss(response.data);
      return response.data;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load the profit and loss');
      return null;
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  const fetchBalanceSheet = useCallback(async (asOf = null) => {
    setLoading(true);
    setError(null);
    try {
      const response = await client.get('accounting/reports/balance-sheet', {
        params: { company_id: companyId, as_of: asOf },
      });
      setBalanceSheet(response.data);
      return response.data;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load the balance sheet');
      return null;
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  const fetchTrialBalance = useCallback(async (asOf = null) => {
    setLoading(true);
    setError(null);
    try {
      const response = await client.get('accounting/reports/trial-balance', {
        params: { company_id: companyId, as_of: asOf },
      });
      setTrialBalance(response.data);
      return response.data;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load the trial balance');
      return null;
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  return {
    summary, profitLoss, balanceSheet, trialBalance, loading, error,
    fetchSummary, fetchProfitLoss, fetchBalanceSheet, fetchTrialBalance,
  };
};

export default useAccountingReports;
