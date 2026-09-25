import { useEffect, useState } from 'react';

// ============================================================================
// Is the person typing on a TOUCH keyboard (phone / tablet)?
//
// Enter must not send there. A soft keyboard has no Shift to hold while
// pressing Enter, so "Enter = send" left no way at all to start a new line on
// a phone -- and fired half-typed messages every time someone reached for one.
// On a hardware keyboard Enter = send / Shift+Enter = newline stays.
//
// `(hover: none) and (pointer: coarse)` is the same test global.css already
// uses to floor tap targets at 44px, so one definition of "this is a phone"
// covers both. Not a width query: a narrow desktop window still has a real
// keyboard, and a wide tablet still does not.
// ============================================================================
export const TOUCH_QUERY = '(hover: none) and (pointer: coarse)';

export const isTouchKeyboard = () => typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia(TOUCH_QUERY).matches;

export function useTouchKeyboard() {
  const [touch, setTouch] = useState(isTouchKeyboard);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(TOUCH_QUERY);
    const onChange = (e) => setTouch(e.matches);
    // addEventListener on a MediaQueryList is Safari 14+; keep the old
    // addListener as the fallback so iOS 13 phones -- exactly the devices this
    // hook exists for -- are not left on the desktop behaviour.
    if (mq.addEventListener) { mq.addEventListener('change', onChange); return () => mq.removeEventListener('change', onChange); }
    mq.addListener(onChange); return () => mq.removeListener(onChange);
  }, []);
  return touch;
}
