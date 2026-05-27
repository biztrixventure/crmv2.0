import { useState, useEffect, useRef, useCallback } from 'react';
import client from '../api/client';
import { buildSynonymMap } from '../utils/smartSearch';

const CACHE_KEY = 'search_synonyms_cache_v1';

/**
 * useSearchTools — loads the synonym map (cached) for query expansion and exposes
 * a debounced logSearch() so the superadmin analytics can track what agents look
 * for. `section` is 'faq' | 'script'. Degrades silently if the backend tables
 * aren't migrated yet.
 */
export function useSearchTools(section) {
  const [synMap, setSynMap] = useState(() => {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { return {}; }
  });
  const logTimer = useRef(null);

  useEffect(() => {
    client.get('search/synonyms')
      .then((r) => {
        const map = buildSynonymMap(r.data.synonyms || []);
        setSynMap(map);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(map)); } catch { /* quota */ }
      })
      .catch(() => { /* no synonyms — search still works */ });
  }, []);

  // Debounced: log only once the agent pauses, and only meaningful queries.
  const logSearch = useCallback((query, resultCount) => {
    const q = (query || '').trim();
    clearTimeout(logTimer.current);
    if (q.length < 2) return;
    logTimer.current = setTimeout(() => {
      client.post('search/log', { query: q, section, result_count: resultCount }).catch(() => {});
    }, 1000);
  }, [section]);

  return { synMap, logSearch };
}
