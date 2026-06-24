import { useState, useEffect, useRef, useCallback } from 'react';
import { ClipboardCheck, RefreshCw, X, GripVertical, Check } from 'lucide-react';
import client from '../../api/client';

// Floating "call checklist" for closers — a small draggable panel (YouTube
// mini-player style) that floats over the screen so they can tick questions off
// while on a call. Ticking is purely local/ephemeral (nothing logged). The
// Refresh button clears the ticks + re-pulls the latest questions for the next
// call. Compliance manages the questions; closers only read + tick.
export default function CallChecklistWidget() {
  const [open, setOpen]           = useState(false);
  const [questions, setQuestions] = useState([]);
  const [checked, setChecked]     = useState(() => new Set());
  const [loading, setLoading]     = useState(false);
  const [pos, setPos]             = useState(null);   // {x,y}; null → default corner
  const panelRef = useRef(null);

  const load = useCallback(() => {
    setLoading(true);
    client.get('call-checklist')
      .then(r => setQuestions(r.data.questions || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { if (open) load(); }, [open, load]);

  const toggle = (id) => setChecked(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const refresh = () => { setChecked(new Set()); load(); };

  // Drag by the header — clamp inside the viewport.
  const startDrag = (e) => {
    const rect = panelRef.current.getBoundingClientRect();
    const ox = e.clientX - rect.left, oy = e.clientY - rect.top;
    const move = (ev) => setPos({
      x: Math.max(8, Math.min(window.innerWidth  - rect.width  - 8, ev.clientX - ox)),
      y: Math.max(8, Math.min(window.innerHeight - rect.height - 8, ev.clientY - oy)),
    });
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };

  const doneCount = questions.reduce((n, q) => n + (checked.has(q.id) ? 1 : 0), 0);
  const pct = questions.length ? Math.round((doneCount / questions.length) * 100) : 0;

  return (
    <>
      {/* Launcher */}
      {!open && (
        <button onClick={() => setOpen(true)} title="Call checklist"
          className="fixed left-4 bottom-4 z-[60] w-12 h-12 rounded-full flex items-center justify-center text-white shadow-lg hover:scale-105 active:scale-95 transition-transform"
          style={{ background: 'var(--gradient-sidebar)' }}>
          <ClipboardCheck size={22} />
        </button>
      )}

      {/* Floating panel */}
      {open && (
        <div ref={panelRef}
          className="fixed z-[60] w-80 max-w-[calc(100vw-32px)] rounded-2xl overflow-hidden flex flex-col animate-scale-in"
          style={{
            left: pos ? pos.x : 16,
            top:  pos ? pos.y : undefined,
            bottom: pos ? undefined : 16,
            maxHeight: '72vh',
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-xl)',
          }}>
          {/* Header / drag handle */}
          <div onMouseDown={startDrag}
            className="flex items-center gap-2 px-3 py-2.5 cursor-move select-none text-white"
            style={{ background: 'var(--gradient-sidebar)' }}>
            <GripVertical size={15} className="opacity-60" />
            <ClipboardCheck size={16} />
            <span className="text-sm font-bold flex-1">Call Checklist</span>
            <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-md bg-white/20">{doneCount}/{questions.length}</span>
            <button onClick={refresh} title="Refresh (clear ticks)" className="p-1 rounded-md hover:bg-white/20">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <button onClick={() => setOpen(false)} title="Close" className="p-1 rounded-md hover:bg-white/20">
              <X size={15} />
            </button>
          </div>

          {/* Progress */}
          <div className="h-1.5" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
            <div className="h-full transition-all duration-300" style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#10b981,#059669)' }} />
          </div>

          {/* Questions */}
          <div className="overflow-y-auto p-2 space-y-1">
            {loading && !questions.length ? (
              <p className="text-xs text-center py-8" style={{ color: 'var(--color-text-tertiary)' }}>Loading…</p>
            ) : questions.length === 0 ? (
              <p className="text-xs text-center py-8" style={{ color: 'var(--color-text-tertiary)' }}>No questions set yet.</p>
            ) : questions.map((q) => {
              const done = checked.has(q.id);
              return (
                <button key={q.id} onClick={() => toggle(q.id)}
                  className="w-full flex items-start gap-2.5 text-left px-2.5 py-2 rounded-xl transition-colors hover:bg-bg-secondary"
                  style={{ backgroundColor: done ? 'rgba(16,185,129,0.08)' : 'transparent' }}>
                  <span className="mt-0.5 w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 transition-colors"
                    style={{ backgroundColor: done ? '#059669' : 'transparent', border: done ? 'none' : '2px solid var(--color-border)' }}>
                    {done && <Check size={13} className="text-white" />}
                  </span>
                  <span className="text-[13px] leading-snug"
                    style={{ color: done ? 'var(--color-text-tertiary)' : 'var(--color-text)', textDecoration: done ? 'line-through' : 'none' }}>
                    {q.text}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Footer hint */}
          {questions.length > 0 && (
            <div className="px-3 py-2 text-[10px] text-center border-t" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-tertiary)' }}>
              Drag the header to move · Refresh to start the next call
            </div>
          )}
        </div>
      )}
    </>
  );
}
