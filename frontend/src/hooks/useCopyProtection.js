import { useEffect, useState } from 'react';
import client from '../api/client';

/*
 * useCopyProtection(shellId)
 *
 * Master switch for the "no text selection / no copy" lock a shell applies to
 * its own root (`.bsx-no-select`). Superadmin is always exempt — that check
 * stays at the shell call-site, this hook only answers "is the lock armed?".
 *
 * Config key: `ui.copy_protection` → { staff: true, ... }
 *   - Missing key / missing shell entry → TRUE (locked). Default-on keeps the
 *     historical behavior for every deployment that never touches the toggle,
 *     and means a failed config fetch fails *secure* instead of leaking copy.
 *   - Superadmin flips it in Business Rules → Copy Protection.
 *
 * Note this is a different, softer layer than `.copy-locked` (readonly_admin
 * governance `no_copy`): that one also beats `.bsx-allow-select` and is not
 * affected by this toggle.
 */
export const COPY_PROTECTION_KEY = 'ui.copy_protection';
export const DEFAULT_COPY_PROTECTION = { staff: true };

let _cache = null, _at = 0;
const TTL_MS = 30_000;

const clean = (raw) => {
  if (!raw || typeof raw !== 'object') return DEFAULT_COPY_PROTECTION;
  return { ...DEFAULT_COPY_PROTECTION, ...raw };
};

// Is the selection lock armed for this shell? Default-on when unknown.
export const isShellCopyLocked = (cfg, shellId) => (cfg || {})[shellId] !== false;

export function useCopyProtection(shellId) {
  const [cfg, setCfg] = useState(_cache || DEFAULT_COPY_PROTECTION);

  useEffect(() => {
    if (_cache && Date.now() - _at < TTL_MS) { setCfg(_cache); return; }
    let cancelled = false;
    client.get('business-config')
      .then(r => {
        if (cancelled) return;
        const resolved = clean(r.data?.config?.[COPY_PROTECTION_KEY]);
        _cache = resolved; _at = Date.now(); setCfg(resolved);
      })
      .catch(() => { /* silent → default (locked) */ });
    return () => { cancelled = true; };
  }, []);

  return isShellCopyLocked(cfg, shellId);
}

export function clearCopyProtectionCache() { _cache = null; _at = 0; }
