import { X } from 'lucide-react';

// Smart-ish speech bubble anchored beside the mascot. `side` flips to whichever
// half of the screen has room (computed in useAssistant), so it never runs off
// the edge — a lightweight stand-in for Floating UI with zero deps.
const AssistantTooltip = ({ tip, side = 'right', onAccept, onDismiss }) => {
  if (!tip) return null;
  const onRight = side === 'right';

  return (
    <div
      className="crm-assistant-bubble absolute z-10"
      style={{
        bottom: 6,
        [onRight ? 'left' : 'right']: 84,
        width: 248,
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 16,
        boxShadow: 'var(--shadow-lg, 0 12px 32px rgba(0,0,0,0.18))',
        padding: '12px 12px 10px',
      }}
      role="status"
    >
      {/* little pointer toward the mascot */}
      <span
        style={{
          position: 'absolute', bottom: 16, [onRight ? 'left' : 'right']: -6, width: 12, height: 12,
          backgroundColor: 'var(--color-surface)',
          borderLeft: onRight ? '1px solid var(--color-border)' : 'none',
          borderBottom: onRight ? '1px solid var(--color-border)' : 'none',
          borderRight: onRight ? 'none' : '1px solid var(--color-border)',
          borderTop: onRight ? 'none' : '1px solid var(--color-border)',
          transform: 'rotate(45deg)',
        }}
      />
      <button onClick={() => onDismiss(true)} title="Dismiss (don't show again today)"
        className="absolute top-2 right-2 p-0.5 rounded-md hover:opacity-70"
        style={{ color: 'var(--color-text-tertiary)' }}>
        <X size={13} />
      </button>

      <p className="text-sm pr-4 leading-snug" style={{ color: 'var(--color-text)' }}>{tip.message}</p>

      <div className="flex items-center gap-2 mt-2.5">
        {tip.action ? (
          <button onClick={onAccept}
            className="text-xs font-bold px-2.5 py-1 rounded-lg text-white"
            style={{ background: 'var(--gradient-sidebar)' }}>
            {tip.action.label || 'Show me'}
          </button>
        ) : (
          <button onClick={() => onDismiss(false)}
            className="text-xs font-bold px-2.5 py-1 rounded-lg text-white"
            style={{ background: 'var(--gradient-sidebar)' }}>
            Got it
          </button>
        )}
        <button onClick={() => onDismiss(false)} className="text-xs font-semibold px-1.5 py-1 rounded-lg"
          style={{ color: 'var(--color-text-tertiary)' }}>
          Later
        </button>
      </div>
    </div>
  );
};

export default AssistantTooltip;
