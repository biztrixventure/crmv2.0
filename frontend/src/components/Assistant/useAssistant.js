import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { setPage } from './behaviorStore';
import { useBehaviorTracker } from './useBehaviorTracker';
import { useRuleEngine } from './useRuleEngine';
import { helpFor } from './rules';

const POS_KEY  = 'crm_assistant_pos_v1';
const PREF_KEY = 'crm_assistant_prefs_v1';
const SIZE = 72;           // mascot box px
const MARGIN = 16;

// ── Playful reactions ────────────────────────────────────────────────────────
// Three rapid clicks → the mascot scoots somewhere new and snarks about it.
// Six pointer reversals while dragging → dizzy animation + a second snark.
const RAPID_CLICK_COUNT  = 3;
const RAPID_CLICK_WINDOW = 1500;     // ms
const SHAKE_REVERSALS    = 6;
const SHAKE_WINDOW       = 1500;     // ms
const SARCASM_DURATION   = 3500;     // ms
const DIZZY_DURATION     = 1800;     // ms

const SARCASTIC_CLICK = [
  "Quit poking me. I'm working too.",
  "If you click me one more time, I'm filing HR.",
  "Bored? There's a dashboard right there.",
  "Fine. I'll move. Happy?",
  "New rule: each click costs you a coffee.",
  "I have feelings, you know. Mostly annoyance.",
  "I moved. You'll find me. Eventually.",
];
const SARCASTIC_SHAKE = [
  "Whoa — easy on the centrifuge!",
  "I am NOT a snow globe.",
  "Stop. The room is spinning… oh, that's me.",
  "Cool. Now I'm dizzy. Hope you're proud.",
  "If I throw up, it's on your screen.",
  "My ancestors were rocks. They did NOT consent to this.",
];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const readJSON = (k, fallback) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Map a route path to a coarse "page" context the rules understand.
function routeToPage(path) {
  const p = path.toLowerCase();
  if (p.includes('callback')) return 'callbacks';
  if (p.includes('compliance')) return 'compliance';
  if (p.includes('transfer')) return 'transfers';
  if (p.includes('sale')) return 'sales';
  if (p.includes('lead')) return 'leads';
  if (p.includes('chat')) return 'chat';
  if (p.includes('admin')) return 'admin';
  if (p.includes('manager') || p.includes('operations')) return 'manager';
  if (p.includes('dashboard') || p === '/' ) return 'dashboard';
  if (p.includes('closer') || p.includes('fronter') || p.includes('staff')) return 'dashboard';
  return 'dashboard';
}

// Soft-glow a target element to guide the user toward it.
function highlightTarget(selector) {
  if (!selector) return;
  const el = document.querySelector(selector);
  if (!el) return;
  el.classList.add('crm-assistant-glow');
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => el.classList.remove('crm-assistant-glow'), 4000);
}

export function useAssistant() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const role = user?.role || 'guest';
  const page = routeToPage(location.pathname);
  const { data } = useBehaviorTracker();

  // Rules read role + page, so guidance is tailored per user type.
  const augmented = useMemo(() => ({ ...data, role }), [data, role]);

  const [prefs, setPrefs] = useState(() => ({ muted: false, minimized: false, tooltipsOff: false, ...readJSON(PREF_KEY, {}) }));
  useEffect(() => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* ignore */ } }, [prefs]);

  const { tip, dismiss, show } = useRuleEngine(augmented, { enabled: !prefs.muted && !prefs.tooltipsOff && !prefs.minimized });

  // On-demand "how do I use this?" — set lazily via ref so the drag handler
  // (defined below) can trigger it on a click without ordering issues.
  const helpRef = useRef(() => {});
  useEffect(() => { helpRef.current = () => { if (!prefs.muted) show(helpFor(role, page, data.section)); }; }, [show, role, page, data.section, prefs.muted]);

  // Auto-show contextual guidance once per section/page per session, shortly
  // after landing — so every sidebar section greets the user with relevant help.
  const tipRef = useRef(tip);
  useEffect(() => { tipRef.current = tip; }, [tip]);
  const autoShown = useRef(new Set());
  const ctxKey = data.section || page;
  useEffect(() => {
    if (prefs.muted || prefs.tooltipsOff || prefs.minimized || !ctxKey) return;
    if (autoShown.current.has(ctxKey)) return;
    const t = setTimeout(() => {
      if (tipRef.current) return;                 // don't override an active tip
      autoShown.current.add(ctxKey);
      show(helpFor(role, page, data.section));
    }, 1300);
    return () => clearTimeout(t);
  }, [ctxKey, role, page, data.section, prefs.muted, prefs.tooltipsOff, prefs.minimized, show]);

  // Route → page context.
  useEffect(() => { setPage(page); }, [page]);

  // ── position + drag (no dep; pointer events + rAF) ──────────────────────────
  const [pos, setPos] = useState(() => {
    const saved = readJSON(POS_KEY, null);
    if (saved && typeof saved.x === 'number') return saved;
    const w = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const h = typeof window !== 'undefined' ? window.innerHeight : 800;
    return { x: w - SIZE - MARGIN, y: h - SIZE - MARGIN - 40 };
  });
  const [dragging, setDragging] = useState(false);
  // Drag bookkeeping also carries the shake detector's running state so a
  // single pointer-move handler can update both without extra subscriptions.
  const drag = useRef({ active: false, dx: 0, dy: 0, moved: false, lastX: 0, lastDir: 0, reversals: 0, reversalStart: 0 });
  const raf = useRef(null);

  // Transient effect overlay — overrides mascotState + tip for a few seconds.
  // { state: 'dizzy'|null, message: string|null, id: number }
  const [effect, setEffect] = useState({ state: null, message: null, id: 0 });
  const effectTimer = useRef(null);
  const showEffect = useCallback((state, message, duration = SARCASM_DURATION) => {
    clearTimeout(effectTimer.current);
    setEffect(prev => ({ state, message, id: prev.id + 1 }));
    effectTimer.current = setTimeout(() => {
      setEffect(prev => ({ state: null, message: null, id: prev.id + 1 }));
    }, duration);
  }, []);
  useEffect(() => () => clearTimeout(effectTimer.current), []);

  // Click-spam counter (rapid clicks → relocate + snark).
  const clickHits = useRef([]);
  // Relocate to a fresh random spot at least a third of the viewport away from
  // the current position, so the jump is actually visible.
  const relocateRandom = useCallback(() => {
    const w = window.innerWidth, h = window.innerHeight;
    const minDist = Math.min(w, h) / 3;
    setPos(prev => {
      for (let i = 0; i < 12; i++) {
        const x = MARGIN + Math.random() * (w - SIZE - 2 * MARGIN);
        const y = MARGIN + Math.random() * (h - SIZE - 2 * MARGIN);
        if (Math.hypot(x - prev.x, y - prev.y) >= minDist) {
          // Snap to nearest edge so the mascot's resting place still feels intentional.
          const snapped = { x: x + SIZE / 2 < w / 2 ? MARGIN : w - SIZE - MARGIN, y };
          persistPos(snapped);
          return snapped;
        }
      }
      return prev;
    });
  }, [/* persistPos defined below; safe because called via closure at click-time */]);

  const persistPos = useCallback((p) => { try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* ignore */ } }, []);

  const onPointerMove = useCallback((e) => {
    if (!drag.current.active) return;
    drag.current.moved = true;
    // Shake detection: count horizontal direction reversals within SHAKE_WINDOW.
    // Six reversals (≈ three shakes) trigger the dizzy reaction.
    const dx = e.clientX - drag.current.lastX;
    if (Math.abs(dx) > 2) {
      const dir = dx > 0 ? 1 : -1;
      const now = Date.now();
      if (drag.current.lastDir && dir !== drag.current.lastDir) {
        if (now - drag.current.reversalStart > SHAKE_WINDOW) drag.current.reversals = 0;
        if (!drag.current.reversals) drag.current.reversalStart = now;
        drag.current.reversals += 1;
        if (drag.current.reversals >= SHAKE_REVERSALS) {
          drag.current.reversals = 0;
          // Dizzy first, then a sarcastic recovery line.
          showEffect('dizzy', null, DIZZY_DURATION);
          setTimeout(() => showEffect(null, pick(SARCASTIC_SHAKE), SARCASM_DURATION), DIZZY_DURATION - 200);
        }
      }
      drag.current.lastDir = dir;
      drag.current.lastX   = e.clientX;
    }
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const x = clamp(e.clientX - drag.current.dx, MARGIN, window.innerWidth - SIZE - MARGIN);
      const y = clamp(e.clientY - drag.current.dy, MARGIN, window.innerHeight - SIZE - MARGIN);
      setPos({ x, y });
    });
  }, [showEffect]);

  const onPointerUp = useCallback(() => {
    if (!drag.current.active) return;
    drag.current.active = false;
    setDragging(false);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    // A click (no drag) = "help me with this screen" — UNLESS the user just
    // clicked the mascot RAPID_CLICK_COUNT times within RAPID_CLICK_WINDOW, in
    // which case the mascot scoots away and snarks instead of helping.
    if (!drag.current.moved) {
      const now = Date.now();
      clickHits.current = clickHits.current.filter(t => now - t < RAPID_CLICK_WINDOW);
      clickHits.current.push(now);
      if (clickHits.current.length >= RAPID_CLICK_COUNT) {
        clickHits.current = [];
        relocateRandom();
        showEffect(null, pick(SARCASTIC_CLICK), SARCASM_DURATION);
      } else {
        helpRef.current?.();
        // Snap to the nearest left/right edge (preserves the original behavior).
        setPos(prev => {
          const mid = prev.x + SIZE / 2;
          const snapped = { x: mid < window.innerWidth / 2 ? MARGIN : window.innerWidth - SIZE - MARGIN, y: prev.y };
          persistPos(snapped);
          return snapped;
        });
        return;
      }
      return;
    }
    // Real drag → snap to edge as before.
    setPos(prev => {
      const mid = prev.x + SIZE / 2;
      const snapped = { x: mid < window.innerWidth / 2 ? MARGIN : window.innerWidth - SIZE - MARGIN, y: prev.y };
      persistPos(snapped);
      return snapped;
    });
  }, [onPointerMove, persistPos, relocateRandom, showEffect]);

  const onHandlePointerDown = useCallback((e) => {
    drag.current = {
      active: true, dx: e.clientX - pos.x, dy: e.clientY - pos.y, moved: false,
      lastX: e.clientX, lastDir: 0, reversals: 0, reversalStart: 0,
    };
    setDragging(true);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }, [pos.x, pos.y, onPointerMove, onPointerUp]);

  // Keep on-screen when the viewport resizes.
  useEffect(() => {
    const onResize = () => setPos(prev => ({
      x: clamp(prev.x, MARGIN, window.innerWidth - SIZE - MARGIN),
      y: clamp(prev.y, MARGIN, window.innerHeight - SIZE - MARGIN),
    }));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ── tip actions ─────────────────────────────────────────────────────────────
  const acceptTip = useCallback(() => {
    const a = tip?.action;
    if (a?.goto) navigate(a.goto);
    if (a?.target) setTimeout(() => highlightTarget(a.target), a?.goto ? 350 : 0);
    dismiss(false);
  }, [tip, navigate, dismiss]);

  // Transient effects (dizzy / sarcasm) win over the rule-engine state so the
  // user always sees their interaction echoed back. Dragging still wins over
  // a sarcasm message but not over dizzy (which only triggers via dragging).
  const baseState = !tip ? 'idle'
    : tip.kind === 'alert' ? 'alert'
    : tip.kind === 'happy' ? 'happy'
    : 'talking';
  const mascotState = effect.state === 'dizzy' ? 'dizzy'
    : dragging                                 ? 'idle'
    : effect.message                           ? 'happy'
    : baseState;
  // Sarcastic line briefly hijacks the tooltip — no action button, no auto-dismiss.
  const sarcasticTip = effect.message ? { id: `sarcasm-${effect.id}`, message: effect.message, kind: 'happy', sarcastic: true } : null;

  // The mascot sits left/right → tooltip should open toward screen centre.
  const side = pos.x + SIZE / 2 < (typeof window !== 'undefined' ? window.innerWidth : 1200) / 2 ? 'right' : 'left';

  return {
    pos, side, dragging, onHandlePointerDown,
    prefs,
    toggleMute:     () => setPrefs(p => ({ ...p, muted: !p.muted })),
    toggleMinimize: () => setPrefs(p => ({ ...p, minimized: !p.minimized })),
    toggleTooltips: () => setPrefs(p => ({ ...p, tooltipsOff: !p.tooltipsOff })),
    // Sarcastic tip ignores tooltipsOff (it's a reaction, not guidance) but
    // still respects mute/minimize.
    tip: prefs.muted || prefs.minimized ? null : (sarcasticTip || (prefs.tooltipsOff ? null : tip)),
    acceptTip, dismissTip: dismiss,
    showHelp: () => helpRef.current?.(),
    mascotState, data, role,
  };
}
