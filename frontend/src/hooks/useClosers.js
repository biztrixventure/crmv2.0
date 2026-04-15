import { useState, useCallback } from 'react';
import client from '../api/client';

export const useClosers = (companyId) => {
  const [closers, setClosers]   = useState([]);
  const [loading, setLoading]   = useState(false);

  const fetchClosers = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const res = await client.get('transfers/closers', { params: { company_id: companyId } });
      setClosers(res.data.closers || []);
    } catch {
      setClosers([]);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  return { closers, loading, fetchClosers };
};
