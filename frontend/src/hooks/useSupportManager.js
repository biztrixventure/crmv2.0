import { useEffect, useState } from 'react';
import client from '../api/client';

// ============================================================================
// useSupportManager -- is this person the support manager?
//
// A superadmin switches it on per PERSON (User Control Center -> Modules ->
// Support manager, mig 358), so the token cannot know: the shells ask
// GET /support/my-access, the same answer the support routes enforce. One
// request per user per minute, shared by every caller.
//
// false while unknown and on any error, so Support Reports stays hidden rather
// than flashing for the many people who do not have it.
// ============================================================================
const TTL_MS = 60 * 1000;
let cached = { userId: null, at: 0, value: false };
let inflight = null;

function fetchAccess(userId) {
  if (cached.userId === userId && Date.now() - cached.at < TTL_MS) return Promise.resolve(cached.value);
  if (inflight && inflight.userId === userId) return inflight.promise;
  const promise = client.get('support/my-access')
    .then(({ data }) => {
      cached = { userId, at: Date.now(), value: !!data?.manager };
      return cached.value;
    })
    .catch(() => false)
    .finally(() => { inflight = null; });
  inflight = { userId, promise };
  return promise;
}

export function useSupportManager(userId) {
  const [value, setValue] = useState(() => (cached.userId === userId ? cached.value : false));
  useEffect(() => {
    if (!userId) return undefined;
    let alive = true;
    fetchAccess(userId).then(v => { if (alive) setValue(v); });
    return () => { alive = false; };
  }, [userId]);
  return value;
}
