import { useEffect, useState } from 'react';
import client from '../api/client';

// Shared map of user_id → chat font color (set by SuperAdmin in Chat Control →
// Font Colors). Lets any surface tint a user's name in their assigned color
// consistently — chat search, conversation list, and the closer/fronter
// dropdowns on the Sale + Transfer forms.
//
// One module-level fetch is shared across every consumer; 60s TTL so a color
// change from the admin reflects on the next mount without hammering the API.
const TTL_MS = 60_000;
let _cache = null;        // { at, map }
let _inflight = null;

async function fetchColors() {
  if (_cache && Date.now() - _cache.at < TTL_MS) return _cache.map;
  if (!_inflight) {
    _inflight = client.get('chat/styles')
      .then(r => {
        const map = {};
        (r.data?.styles || []).forEach(s => { if (s.font_color) map[s.user_id] = s.font_color; });
        _cache = { at: Date.now(), map };
        return map;
      })
      .catch(() => { _cache = { at: Date.now(), map: {} }; return _cache.map; })
      .finally(() => { _inflight = null; });
  }
  return _inflight;
}

export function useUserColors() {
  const [map, setMap] = useState(_cache?.map || {});

  useEffect(() => {
    let alive = true;
    fetchColors().then(m => { if (alive) setMap(m); });
    return () => { alive = false; };
  }, []);

  // Returns the user's color or a caller-supplied fallback (default null so the
  // caller can decide the base color).
  const colorFor = (userId, fallback = null) => map[userId] || fallback;
  return { colorFor, colors: map };
}
