import { useState, useEffect, useCallback } from 'react';

// Tiny localStorage-backed useState. Used to persist the active tab/section
// in every shell so a browser reload (or accidental tab close) lands the
// user back on the page they were viewing.
//
// Each shell gets its own storage key so closer/fronter/manager/admin/
// compliance state doesn't bleed across roles when a user switches accounts.
export function usePersistedState(key, defaultValue) {
  const [value, setValue] = useState(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? defaultValue : JSON.parse(raw);
    } catch { return defaultValue; }
  });

  useEffect(() => {
    try { window.localStorage.setItem(key, JSON.stringify(value)); }
    catch { /* quota or private mode — ignore */ }
  }, [key, value]);

  const reset = useCallback(() => {
    try { window.localStorage.removeItem(key); } catch { /* ignore */ }
    setValue(defaultValue);
  }, [key, defaultValue]);

  return [value, setValue, reset];
}
