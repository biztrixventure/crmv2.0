import React from "react";
import { RefreshCw } from "lucide-react";

export default function UpdateBanner() {
  return (
    <div
      className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-between px-4 py-2.5 gap-3"
      style={{
        background: "linear-gradient(90deg, var(--color-primary-700), var(--color-primary-500))",
        boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
      }}
    >
      <div className="flex items-center gap-2 text-white text-sm font-medium">
        <RefreshCw size={15} className="flex-shrink-0" />
        <span>New version available — reload to get the latest updates.</span>
      </div>
      <button
        onClick={async () => {
          // The service worker no longer calls skipWaiting() on its own — that
          // could swap the bundle under someone mid-form. So a new worker sits
          // in `waiting` until told, and a bare reload would NOT pick it up
          // while any tab still holds the old one. Telling it here makes this
          // button the single, deliberate moment an update gets applied.
          try {
            const reg = await navigator.serviceWorker?.getRegistration?.();
            if (reg?.waiting) {
              reg.waiting.postMessage({ type: 'SKIP_WAITING' });
              // Wait until the new worker is actually in control, so the page
              // that comes back is served by it and not the outgoing one.
              await new Promise(resolve => {
                navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
                setTimeout(resolve, 1500);   // never hang the button on a stuck worker
              });
            }
          } catch { /* no SW, or blocked — a plain reload is still correct */ }
          window.location.reload();
        }}
        className="flex-shrink-0 px-3 py-1 rounded-lg text-xs font-semibold transition-all hover:opacity-90 active:scale-95"
        style={{ background: "rgba(255,255,255,0.2)", color: "white", border: "1px solid rgba(255,255,255,0.3)" }}
      >
        Reload now
      </button>
    </div>
  );
}
