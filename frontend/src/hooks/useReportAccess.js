import { useEffect, useState } from 'react';
import client from '../api/client';

// ============================================================================
// useReportAccess -- may this person open Company Reports, and from where?
//
// The answer cannot come from the token: a superadmin can switch the reports
// ON or OFF for one named person (User Control Center -> Reports, mig 333),
// which no role permission shows. So the shells ask the same endpoint the
// report itself uses. One request per user per minute, shared by every caller.
//
// Returns null while unknown -- callers fall back to the role permissions so
// the nav does not flicker for the common case.
// ============================================================================
const TTL_MS = 60 * 1000;
let cached = { userId: null, at: 0, value: null };
let inflight = null;

function fetchAccess(userId) {
  if (cached.userId === userId && cached.value && Date.now() - cached.at < TTL_MS) return Promise.resolve(cached.value);
  if (inflight && inflight.userId === userId) return inflight.promise;
  const promise = client.get('company-reports/scope')
    .then(({ data }) => {
      const value = {
        can: (data.companies || []).length > 0,
        source: data.source || null,          // 'superadmin' | 'estate' | 'person' | 'role' | 'none'
        multi: !!data.multi,
      };
      cached = { userId, at: Date.now(), value };
      return value;
    })
    .catch(() => null)
    .finally(() => { inflight = null; });
  inflight = { userId, promise };
  return promise;
}

export function useReportAccess(userId) {
  const [value, setValue] = useState(() => (cached.userId === userId ? cached.value : null));
  useEffect(() => {
    if (!userId) return undefined;
    let alive = true;
    fetchAccess(userId).then(v => { if (alive && v) setValue(v); });
    return () => { alive = false; };
  }, [userId]);
  return value;
}
