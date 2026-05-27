import { useEffect, useRef, useState, useCallback } from 'react';
import { pickTip } from './rules';
import { markTipShown, markTipIgnored } from './behaviorStore';

/**
 * useRuleEngine — turns the behavior snapshot into at-most-one active tip.
 * Re-evaluates when `data` changes and on a slow timer (so idle-based rules
 * fire). Non-blocking, O(rules). Tracks what's been shown this session to avoid
 * repeating non-alert suggestions.
 */
export function useRuleEngine(data, { enabled = true } = {}) {
  const [tip, setTip] = useState(null);
  const sessionShown = useRef(new Set());
  const tipRef = useRef(null);
  useEffect(() => { tipRef.current = tip; }, [tip]);

  const evaluate = useCallback(() => {
    if (!enabled) { setTip(null); return; }
    if (tipRef.current) return;                       // leave the current tip until dismissed
    const next = pickTip(data, { sessionShown: sessionShown.current });
    if (next) {
      sessionShown.current.add(next.id);
      markTipShown(next.id);
      setTip(next);
    }
  }, [data, enabled]);

  useEffect(() => { evaluate(); }, [evaluate]);
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(evaluate, 8000);            // catch idle/time-based rules
    return () => clearInterval(t);
  }, [evaluate, enabled]);

  const dismiss = useCallback((ignore = false) => {
    const cur = tipRef.current;
    if (cur && ignore) markTipIgnored(cur.id);
    setTip(null);
  }, []);

  // Force-show a tip on demand (mascot click → contextual help). Bypasses cooldown.
  const show = useCallback((t) => { if (t) { markTipShown(t.id); setTip(t); } }, []);

  return { tip, dismiss, show };
}
