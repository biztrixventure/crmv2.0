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
        onClick={() => window.location.reload()}
        className="flex-shrink-0 px-3 py-1 rounded-lg text-xs font-semibold transition-all hover:opacity-90 active:scale-95"
        style={{ background: "rgba(255,255,255,0.2)", color: "white", border: "1px solid rgba(255,255,255,0.3)" }}
      >
        Reload now
      </button>
    </div>
  );
}
