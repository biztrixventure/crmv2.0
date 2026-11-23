import { useEffect, useRef } from 'react';

// The classic blue-title-bar dialog used by every prompt on the support desk.
// Escape closes it, focus starts inside it and goes back to whatever opened it.
export default function SxDialog({ title, onClose, children, footer, busy = false }) {
  const boxRef = useRef(null);
  // Callers pass a fresh onClose / busy every render. Read them through a ref so
  // the effect below runs ONCE -- otherwise every keystroke in the dialog would
  // re-run it and throw focus back to the first field.
  const live = useRef({ onClose, busy });
  live.current = { onClose, busy };

  useEffect(() => {
    const opener = document.activeElement;
    const first = boxRef.current?.querySelector('select, textarea, input, button:not(.sx-dialog-x)');
    first?.focus();
    const onKey = (e) => { if (e.key === 'Escape' && !live.current.busy) live.current.onClose(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  return (
    // .sx is repeated here because the veil is position:fixed and takes the
    // desk's fonts and colours from it; min-height is reset for the same reason.
    <div className="sx sx-veil" style={{ minHeight: 0 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="sx-dialog" role="dialog" aria-modal="true" aria-label={title} ref={boxRef}>
        <div className="sx-dialog-title">
          <span>{title}</span>
          <button type="button" className="sx-dialog-x" onClick={onClose} disabled={busy} aria-label="Close">x</button>
        </div>
        <div className="sx-dialog-body">{children}</div>
        {footer && <div className="sx-dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}
