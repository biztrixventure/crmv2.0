import { useState, useRef, useEffect } from 'react';
import { Eye, EyeOff, MoreVertical, Trash2 } from 'lucide-react';

// HideDeleteMenu — row actions for catalog options (clients, plans, vehicle
// makes/models). An inline eye toggle HIDES the option from the form without
// deleting it; the 3-dots menu keeps the (rarer, destructive) Delete tucked away
// so it isn't hit by accident. Reused by ClientPlanManager + VehicleManager.
export default function HideDeleteMenu({ hidden, onToggleHidden, onDelete, busy = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <span className="flex items-center gap-0.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
      <button type="button" disabled={busy}
        onClick={(e) => { e.stopPropagation(); onToggleHidden(); }}
        title={hidden ? 'Hidden from the form — click to show' : 'Showing on the form — click to hide'}
        className="p-1 rounded hover:bg-bg-secondary transition-colors">
        {hidden
          ? <EyeOff size={13} style={{ color: 'var(--color-text-tertiary)' }} />
          : <Eye size={13} style={{ color: 'var(--color-primary-500)' }} />}
      </button>
      <span className="relative" ref={ref}>
        <button type="button" title="More"
          onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
          className="p-1 rounded hover:bg-bg-secondary transition-colors">
          <MoreVertical size={13} style={{ color: 'var(--color-text-tertiary)' }} />
        </button>
        {open && (
          <div className="absolute right-0 top-full mt-1 z-40 rounded-lg py-1 min-w-[120px]"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-lg,0 8px 24px rgba(0,0,0,.15))' }}>
            <button type="button" disabled={busy}
              onClick={(e) => { e.stopPropagation(); setOpen(false); onDelete(); }}
              className="w-full text-left px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 hover:bg-error-50 transition-colors"
              style={{ color: 'var(--color-error-600,#dc2626)' }}>
              <Trash2 size={12} /> Delete
            </button>
          </div>
        )}
      </span>
    </span>
  );
}
