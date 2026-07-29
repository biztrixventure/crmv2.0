import { useEffect, useState } from 'react';

// useIsMobile — "is this a phone-sized viewport right now".
//
// One definition, in one place, because the drawers now make a BEHAVIOURAL
// decision from it (a sale-review deep link opens the compact essentials view
// on a phone and the full drawer on a desktop), and a behavioural fork that
// disagrees with the CSS breakpoint is the kind of bug nobody reproduces.
//
// 640px = Tailwind's `sm`, so this and every `sm:` utility in the drawers flip
// at exactly the same width. Deliberately viewport-based, not user-agent
// based: a narrow desktop window gets the compact view too, which is correct —
// the constraint being solved is width, not hardware.
//
// matchMedia, not a resize listener: it fires only when the answer actually
// CHANGES, so rotating a phone re-renders once instead of on every frame.
const MOBILE_QUERY = '(max-width: 639.98px)';

export function useIsMobile(query = MOBILE_QUERY) {
  const [isMobile, setIsMobile] = useState(() => {
    // Read synchronously on the very first render. Reading in an effect
    // instead would paint the full drawer for one frame and then swap it for
    // the compact one, which reads as a glitch on the slowest devices —
    // exactly the devices this view exists for.
    try { return window.matchMedia(query).matches; } catch { return false; }
  });

  useEffect(() => {
    let mq;
    try { mq = window.matchMedia(query); } catch { return undefined; }
    const onChange = (e) => setIsMobile(e.matches);
    setIsMobile(mq.matches);   // resync in case it changed before we attached
    // addEventListener is the modern API; addListener is the Safari <14
    // fallback. Both are removed the same way they were added.
    if (mq.addEventListener) {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, [query]);

  return isMobile;
}

export default useIsMobile;
