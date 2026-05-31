import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

// CopyableText — selectable + copy icon for arbitrary text (notes, addresses,
// etc.) on shells that use .bsx-no-select. Pairs with CopyableNumber: same
// opt-in pattern but no number formatting. The visible text stays unchanged
// — only selection and copy are enabled.
//
// Props:
//   value     — required, the text to display + copy
//   size      — icon size (default 12)
//   inline    — render the icon next to the text (default true). Set false
//               for a separate header/label position.
const CopyableText = ({ value, size = 12, className = '', style = {}, inline = true }) => {
  const [copied, setCopied] = useState(false);
  const text = String(value || '').trim();
  if (!text) return null;

  const copy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true); setTimeout(() => setCopied(false), 1400);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { /* ignore */ }
      document.body.removeChild(ta);
    }
  };

  const btn = (
    <button type="button" onClick={copy} title={copied ? 'Copied' : 'Copy'}
      className="p-0.5 rounded hover:bg-bg-secondary opacity-60 hover:opacity-100 transition-opacity"
      style={{ color: copied ? 'var(--color-success-600)' : 'var(--color-text-tertiary)' }}>
      {copied ? <Check size={size} /> : <Copy size={size} />}
    </button>
  );

  if (inline) {
    return (
      <span className={`bsx-allow-select inline-flex items-start gap-1 ${className}`} style={style}>
        <span className="whitespace-pre-wrap break-words">{value}</span>
        {btn}
      </span>
    );
  }
  // Non-inline: caller positions the button (e.g., next to a header label).
  return (
    <>
      <span className={`bsx-allow-select whitespace-pre-wrap break-words ${className}`} style={style}>{value}</span>
      {btn}
    </>
  );
};

export default CopyableText;
