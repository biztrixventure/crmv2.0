import { useState, useRef, useCallback, useEffect } from 'react';

// useFlash — the ONE transient message pattern. Eight admin sections had each
// re-implemented `flash(type, text)` + setTimeout with two different durations
// (4000 / 5000) and no unmount cleanup (a state update after unmount).
//
//   const { msg, flash, clear } = useFlash();
//   …
//   flash('success', 'Profile saved.');
//   {msg && <Alert type={msg.type}>{msg.text}</Alert>}
//
// Render through UI/Alert — it takes the text as `message` OR as children, so
// either call shape works.
//
// `msg` is { type: 'success'|'error'|'warning'|'info', text } or null. Errors are
// sticky by default: a failure the user never saw is worse than a banner that
// lingers. Pass { stickyErrors: false } to auto-dismiss those too.
export default function useFlash({ ttl = 4000, stickyErrors = true } = {}) {
  const [msg, setMsg] = useState(null);
  const timer = useRef(null);

  const stop = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  useEffect(() => stop, []);

  const clear = useCallback(() => { stop(); setMsg(null); }, []);

  const flash = useCallback((type, text) => {
    stop();
    setMsg({ type, text });
    if (!(stickyErrors && type === 'error')) {
      timer.current = setTimeout(() => { timer.current = null; setMsg(null); }, ttl);
    }
  }, [ttl, stickyErrors]);

  return { msg, flash, clear };
}
