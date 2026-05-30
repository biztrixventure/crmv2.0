import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

// CopyableNumber — display a phone number in a way that's selectable + copyable
// even when the surrounding shell uses .bsx-no-select to prevent text copying.
// Opt-in via the .bsx-allow-select class so a closer/fronter/compliance/manager
// can still grab a customer's number to call, without enabling free-form copy
// of names, notes, or sale data elsewhere on the page.
//
// Click the icon → writes the normalized 10-digit value (not the formatted
// display) to the clipboard so dialers paste cleanly. Selecting the text
// manually still works the same way.
//
// Props:
//   value    — required, the raw stored number (may include brackets/dashes)
//   pretty   — optional, if false renders the raw digits instead of (XXX) XXX-XXXX
//   size     — optional, sets the icon size in px (default 12)
const CopyableNumber = ({ value, pretty = true, size = 12, className = '', style = {} }) => {
  const [copied, setCopied] = useState(false);
  const digits = String(value || '').replace(/\D/g, '');

  if (!digits) {
    return <span className={className} style={style}>—</span>;
  }

  // Standard US 10-digit format. International (11+ digits) stays raw so we
  // don't lie about the layout. Anything shorter (legacy / mis-entered) also
  // displays raw.
  const display = pretty && digits.length === 10
    ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
    : digits;

  const copy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(digits);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Fallback for browsers/contexts without clipboard API access.
      const ta = document.createElement('textarea');
      ta.value = digits;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { /* ignore */ }
      document.body.removeChild(ta);
    }
  };

  return (
    <span className={`bsx-allow-select inline-flex items-center gap-1 ${className}`} style={style}>
      <span className="tabular-nums">{display}</span>
      <button type="button" onClick={copy} title={copied ? 'Copied' : 'Copy number'}
        className="p-0.5 rounded hover:bg-bg-secondary opacity-60 hover:opacity-100 transition-opacity"
        style={{ color: copied ? 'var(--color-success-600)' : 'var(--color-text-tertiary)' }}>
        {copied ? <Check size={size} /> : <Copy size={size} />}
      </button>
    </span>
  );
};

export default CopyableNumber;
