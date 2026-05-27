import { useState, useEffect, useRef } from 'react';
import { Volume2, VolumeX, Minus, MessageSquare, MessageSquareOff } from 'lucide-react';
import { useAssistant } from './useAssistant';
import AssistantTooltip from './AssistantTooltip';
import './assistant.css';

const SIZE = 72;

// The mascot SVG — a friendly gold blob with blinking eyes + an antenna whose
// tip colour reflects the current state.
const MascotSVG = ({ state }) => {
  const tip = state === 'alert' ? '#ef4444' : state === 'happy' ? '#22c55e' : '#fde68a';
  return (
    <svg width={SIZE} height={SIZE} viewBox="0 0 72 72" style={{ display: 'block', filter: 'drop-shadow(0 6px 10px rgba(0,0,0,0.25))' }}>
      <defs>
        <linearGradient id="crmBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c9a86a" />
          <stop offset="100%" stopColor="#a8885c" />
        </linearGradient>
      </defs>
      {/* antenna */}
      <line x1="36" y1="12" x2="36" y2="4" stroke="#a8885c" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="36" cy="4" r="3.5" fill={tip}>
        <animate attributeName="opacity" values="1;0.5;1" dur="1.6s" repeatCount="indefinite" />
      </circle>
      {/* body */}
      <rect x="10" y="14" width="52" height="48" rx="22" fill="url(#crmBody)" />
      {/* ears */}
      <ellipse cx="16" cy="22" rx="6" ry="10" fill="#a8885c" transform="rotate(-20 16 22)" />
      <ellipse cx="56" cy="22" rx="6" ry="10" fill="#a8885c" transform="rotate(20 56 22)" />
      {/* eyebrows — angled for alert, raised for happy (emotional expression) */}
      {state === 'alert' && (<>
        <line x1="21" y1="27" x2="32" y2="29" stroke="#3b2f1c" strokeWidth="2" strokeLinecap="round" />
        <line x1="51" y1="27" x2="40" y2="29" stroke="#3b2f1c" strokeWidth="2" strokeLinecap="round" />
      </>)}
      {state === 'happy' && (<>
        <path d="M22 27 q5 -3 10 0" stroke="#3b2f1c" strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M40 27 q5 -3 10 0" stroke="#3b2f1c" strokeWidth="2" fill="none" strokeLinecap="round" />
      </>)}
      {/* eyes */}
      <circle cx="27" cy="36" r="8" fill="#fff" />
      <circle cx="45" cy="36" r="8" fill="#fff" />
      <circle cx="28" cy="37" r="3.6" fill="#3b2f1c" />
      <circle cx="46" cy="37" r="3.6" fill="#3b2f1c" />
      {/* eyelids (blink) */}
      <rect className="crm-eyelid" x="19" y="28" width="16" height="9" rx="4.5" fill="#c9a86a" />
      <rect className="crm-eyelid" x="37" y="28" width="16" height="9" rx="4.5" fill="#c9a86a" />
      {/* cheeks */}
      <circle cx="20" cy="46" r="3.5" fill="#e8b4b8" opacity="0.7" />
      <circle cx="52" cy="46" r="3.5" fill="#e8b4b8" opacity="0.7" />
      {/* mouth — smile, or 'o' when alert */}
      {state === 'alert'
        ? <circle cx="36" cy="50" r="3.5" fill="#3b2f1c" />
        : <path d={state === 'happy' ? 'M28 48 q8 9 16 0' : 'M30 49 q6 5 12 0'} stroke="#3b2f1c" strokeWidth="2.5" fill="none" strokeLinecap="round" />}
    </svg>
  );
};

const CtrlBtn = ({ title, onClick, children }) => (
  <button title={title} onPointerDown={(e) => e.stopPropagation()} onClick={onClick}
    className="w-7 h-7 rounded-full flex items-center justify-center transition-transform hover:scale-110"
    style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', boxShadow: 'var(--shadow-sm)' }}>
    {children}
  </button>
);

const MascotAssistant = () => {
  const a = useAssistant();
  const [hover, setHover] = useState(false);

  // Play a one-shot "pop" whenever the mascot surfaces a new tip (context switch
  // or fresh guidance) — a little emotional reaction to the user's navigation.
  const [react, setReact] = useState(false);
  const lastTipId = useRef(null);
  useEffect(() => {
    const id = a.tip?.id;
    if (!id || id === lastTipId.current) return;
    lastTipId.current = id;
    setReact(true);
    const t = setTimeout(() => setReact(false), 650);
    return () => clearTimeout(t);
  }, [a.tip?.id]);

  // Minimized → a small restore puck on the bottom edge.
  if (a.prefs.minimized) {
    return (
      <button
        onClick={a.toggleMinimize}
        title="Show assistant"
        className="crm-assistant-root"
        style={{ left: a.pos.x, top: a.pos.y, width: 40, height: 40, borderRadius: 20, border: '1px solid var(--color-border)', background: 'var(--gradient-sidebar)', boxShadow: 'var(--shadow-md)' }}
      >
        <span style={{ fontSize: 18 }}>🐾</span>
      </button>
    );
  }

  return (
    <div
      className="crm-assistant-root"
      style={{ left: a.pos.x, top: a.pos.y, width: SIZE, height: SIZE }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Controls (show on hover) */}
      {hover && (
        <div className="absolute flex flex-col gap-1.5" style={{ bottom: SIZE + 8, [a.side === 'right' ? 'left' : 'right']: 8 }}>
          <CtrlBtn title={a.prefs.muted ? 'Unmute' : 'Mute'} onClick={a.toggleMute}>
            {a.prefs.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </CtrlBtn>
          <CtrlBtn title={a.prefs.tooltipsOff ? 'Enable tips' : 'Disable tips'} onClick={a.toggleTooltips}>
            {a.prefs.tooltipsOff ? <MessageSquareOff size={14} /> : <MessageSquare size={14} />}
          </CtrlBtn>
          <CtrlBtn title="Minimize" onClick={a.toggleMinimize}>
            <Minus size={14} />
          </CtrlBtn>
        </div>
      )}

      {/* Mascot (drag handle) */}
      <div
        className={`crm-assistant-mascot is-${a.mascotState} ${a.dragging ? 'is-dragging' : ''} ${react ? 'crm-pop' : ''}`}
        onPointerDown={a.onHandlePointerDown}
        style={{ cursor: a.dragging ? 'grabbing' : 'grab' }}
        title="Click me for help on this screen · drag to move"
      >
        <MascotSVG state={a.mascotState} />
      </div>

      <AssistantTooltip tip={a.tip} side={a.side} onAccept={a.acceptTip} onDismiss={a.dismissTip} />
    </div>
  );
};

export default MascotAssistant;
