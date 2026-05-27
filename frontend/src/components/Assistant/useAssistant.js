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
  const drag = useRef({ active: false, dx: 0, dy: 0, moved: false });
  const raf = useRef(null);

  const persistPos = useCallback((p) => { try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* ignore */ } }, []);

  const onPointerMove = useCallback((e) => {
    if (!drag.current.active) return;
    drag.current.moved = true;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const x = clamp(e.clientX - drag.current.dx, MARGIN, window.innerWidth - SIZE - MARGIN);
      const y = clamp(e.clientY - drag.current.dy, MARGIN, window.innerHeight - SIZE - MARGIN);
      setPos({ x, y });
    });
  }, []);

  const onPointerUp = useCallback(() => {
    if (!drag.current.active) return;
    drag.current.active = false;
    setDragging(false);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    // A click (no drag) = "help me with this screen".
    if (!drag.current.moved) helpRef.current?.();
    // Snap to the nearest left/right edge.
    setPos(prev => {
      const mid = prev.x + SIZE / 2;
      const snapped = { x: mid < window.innerWidth / 2 ? MARGIN : window.innerWidth - SIZE - MARGIN, y: prev.y };
      persistPos(snapped);
      return snapped;
    });
  }, [onPointerMove, persistPos]);

  const onHandlePointerDown = useCallback((e) => {
    drag.current = { active: true, dx: e.clientX - pos.x, dy: e.clientY - pos.y, moved: false };
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

  const mascotState = dragging ? 'idle'
    : !tip ? 'idle'
    : tip.kind === 'alert' ? 'alert'
    : tip.kind === 'happy' ? 'happy'
    : 'talking';

  // The mascot sits left/right → tooltip should open toward screen centre.
  const side = pos.x + SIZE / 2 < (typeof window !== 'undefined' ? window.innerWidth : 1200) / 2 ? 'right' : 'left';

  return {
    pos, side, dragging, onHandlePointerDown,
    prefs,
    toggleMute:     () => setPrefs(p => ({ ...p, muted: !p.muted })),
    toggleMinimize: () => setPrefs(p => ({ ...p, minimized: !p.minimized })),
    toggleTooltips: () => setPrefs(p => ({ ...p, tooltipsOff: !p.tooltipsOff })),
    tip: prefs.muted || prefs.tooltipsOff || prefs.minimized ? null : tip,
    acceptTip, dismissTip: dismiss,
    showHelp: () => helpRef.current?.(),
    mascotState, data, role,
  };
}
