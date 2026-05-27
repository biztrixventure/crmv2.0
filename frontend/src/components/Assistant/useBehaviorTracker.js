import { useEffect, useRef, useState, useCallback } from 'react';
import { track as storeTrack, getData, subscribe, resetIdle } from './behaviorStore';

/**
 * useBehaviorTracker — React view over the behavior store.
 * Returns a live `data` snapshot (re-read on change + a slow tick so idleTime
 * advances) and a stable `track()`. Also installs lightweight global tracking:
 *   - window.crmAssistant.track(type, meta)         — call from anywhere
 *   - click on [data-assistant-event="lead_opened"] — declarative auto-track
 */
export function useBehaviorTracker() {
  const [data, setData] = useState(getData);
  const raf = useRef(null);

  const refresh = useCallback(() => { setData(getData()); }, []);

  useEffect(() => {
    const unsub = subscribe(refresh);
    // Slow tick (5s) keeps idleTime fresh without per-second re-renders.
    const tick = setInterval(refresh, 5000);

    // Declarative auto-tracking: any element with data-assistant-event fires it.
    const onClick = (e) => {
      const el = e.target.closest?.('[data-assistant-event]');
      if (el) storeTrack(el.getAttribute('data-assistant-event'), { id: el.getAttribute('data-assistant-id') || undefined });
    };
    document.addEventListener('click', onClick, true);

    // Global imperative API for existing CRM code: window.crmAssistant.track(...)
    window.crmAssistant = window.crmAssistant || {};
    window.crmAssistant.track = (type, meta) => storeTrack(type, meta);

    return () => { unsub(); clearInterval(tick); cancelAnimationFrame(raf.current); document.removeEventListener('click', onClick, true); };
  }, [refresh]);

  const track = useCallback((type, meta) => storeTrack(type, meta), []);
  return { data, track, resetIdle };
}
