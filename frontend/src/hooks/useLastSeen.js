/**
 * useLastSeen(ids) — last_seen_at timestamps for a set of users, for the
 * "Last seen 5 minutes ago" line under offline users in chat. One batched
 * request per distinct id-set, 60s module-level cache shared across consumers.
 */
import { useEffect, useState } from 'react';
import client from '../api/client';

const TTL_MS = 60_000;
const _cache = new Map();   // key → { at, map }

export function useLastSeen(ids = []) {
  const key = [...new Set(ids)].filter(Boolean).sort().join(',');
  const [map, setMap] = useState(() => _cache.get(key)?.map || {});

  useEffect(() => {
    if (!key) { setMap({}); return; }
    const hit = _cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) { setMap(hit.map); return; }
    let alive = true;
    client.get('presence/last-seen', { params: { ids: key } })
      .then(r => {
        const m = r.data?.last_seen || {};
        _cache.set(key, { at: Date.now(), map: m });
        if (alive) setMap(m);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [key]);

  return map;   // { userId: isoTimestamp }
}
