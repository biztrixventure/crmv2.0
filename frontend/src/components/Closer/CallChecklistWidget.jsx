import { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { ClipboardCheck, RefreshCw, X, Check } from 'lucide-react';
import client from '../../api/client';

// Closers' floating call checklist. Primary mode = Document Picture-in-Picture:
// clicking the button pops the checklist into a real always-on-top OS window
// that floats OVER other Chrome tabs (e.g. VICIdial) and other apps — like a
// YouTube mini-player. Falls back to an in-page panel where PiP isn't supported.
// Ticking is purely local/ephemeral; nothing is logged. Refresh clears the ticks
// and re-pulls the latest questions for the next call.
const supportsPiP = typeof window !== 'undefined' && 'documentPictureInPicture' in window;

// Presentational body — INLINE styles only, so it renders correctly inside a
// bare PiP window (which has none of the app's CSS) and in-page alike.
function ChecklistBody({ questions, checked, loading, onToggle, onRefresh, onClose }) {
  const done = questions.reduce((n, q) => n + (checked.has(q.id) ? 1 : 0), 0);
  const pct  = questions.length ? Math.round((done / questions.length) * 100) : 0;
  const C = { card: '#ffffff', text: '#0f172a', sub: '#64748b', border: '#e2e8f0', head: '#4f46e5', doneBg: 'rgba(16,185,129,0.08)' };
  const iconBtn = { background: 'transparent', border: 'none', color: '#fff', padding: 4, borderRadius: 6, cursor: 'pointer', display: 'flex' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: C.card, fontFamily: 'system-ui,-apple-system,sans-serif', color: C.text }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: C.head, color: '#fff', flexShrink: 0 }}>
        <ClipboardCheck size={16} />
        <span style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>Call Checklist</span>
        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: 'rgba(255,255,255,0.2)' }}>{done}/{questions.length}</span>
        <button onClick={onRefresh} title="Refresh (clear ticks)" style={iconBtn}>
          <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
        </button>
        {onClose && <button onClick={onClose} title="Close" style={iconBtn}><X size={15} /></button>}
      </div>
      <div style={{ height: 6, background: '#f1f5f9', flexShrink: 0 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg,#10b981,#059669)', transition: 'width .3s' }} />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {loading && !questions.length ? (
          <p style={{ fontSize: 12, textAlign: 'center', padding: '28px 0', color: C.sub }}>Loading…</p>
        ) : questions.length === 0 ? (
          <p style={{ fontSize: 12, textAlign: 'center', padding: '28px 0', color: C.sub }}>No questions set yet.</p>
        ) : questions.map((q) => {
          const d = checked.has(q.id);
          return (
            <button key={q.id} onClick={() => onToggle(q.id)}
              style={{ width: '100%', display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left', padding: '8px 10px', borderRadius: 12, border: 'none', background: d ? C.doneBg : 'transparent', cursor: 'pointer' }}>
              <span style={{ marginTop: 2, width: 20, height: 20, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: d ? '#059669' : 'transparent', border: d ? 'none' : `2px solid ${C.border}` }}>
                {d && <Check size={13} color="#fff" />}
              </span>
              <span style={{ fontSize: 13, lineHeight: 1.35, color: d ? C.sub : C.text, textDecoration: d ? 'line-through' : 'none' }}>{q.text}</span>
            </button>
          );
        })}
      </div>
      <div style={{ padding: '6px 10px', fontSize: 10, textAlign: 'center', borderTop: `1px solid ${C.border}`, color: C.sub, flexShrink: 0 }}>
        Floats over your other tabs · Refresh to start the next call
      </div>
    </div>
  );
}

export default function CallChecklistWidget() {
  const [questions, setQuestions] = useState([]);
  const [checked, setChecked]     = useState(() => new Set());
  const [loading, setLoading]     = useState(false);
  const [inPageOpen, setInPageOpen] = useState(false);
  const [pipOpen, setPipOpen]     = useState(false);
  const pipWinRef  = useRef(null);
  const pipRootRef = useRef(null);

  const load = useCallback(() => {
    setLoading(true);
    client.get('call-checklist').then(r => setQuestions(r.data.questions || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);
  const toggle  = useCallback((id) => setChecked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }), []);
  const refresh = useCallback(() => { setChecked(new Set()); load(); }, [load]);

  useEffect(() => { if (inPageOpen || pipOpen) load(); }, [inPageOpen, pipOpen, load]);

  const closePiP = useCallback(() => { try { pipWinRef.current?.close(); } catch { /* already closed */ } }, []);

  const openPiP = useCallback(async () => {
    try {
      const pip = await window.documentPictureInPicture.requestWindow({ width: 340, height: 470 });
      pipWinRef.current = pip;
      const st = pip.document.createElement('style');
      st.textContent = '*{box-sizing:border-box}html,body{margin:0;padding:0;height:100%}@keyframes spin{to{transform:rotate(360deg)}}';
      pip.document.head.appendChild(st);
      const root = createRoot(pip.document.body);
      pipRootRef.current = root;
      setPipOpen(true);
      pip.addEventListener('pagehide', () => {
        try { root.unmount(); } catch { /* noop */ }
        pipRootRef.current = null; pipWinRef.current = null; setPipOpen(false);
      });
    } catch {
      setInPageOpen(true);   // user denied / unsupported → in-page fallback
    }
  }, []);

  // Re-render the PiP window's React tree whenever state changes.
  useEffect(() => {
    if (pipOpen && pipRootRef.current) {
      pipRootRef.current.render(
        <ChecklistBody questions={questions} checked={checked} loading={loading}
          onToggle={toggle} onRefresh={refresh} onClose={closePiP} />
      );
    }
  }, [pipOpen, questions, checked, loading, toggle, refresh, closePiP]);

  // Close the PiP window if the shell unmounts.
  useEffect(() => () => { try { pipWinRef.current?.close(); } catch { /* noop */ } }, []);

  const launch = () => { if (supportsPiP) openPiP(); else setInPageOpen(true); };

  return (
    <>
      {!inPageOpen && !pipOpen && (
        <button onClick={launch} title="Call checklist"
          className="fixed left-4 bottom-4 z-[60] w-12 h-12 rounded-full flex items-center justify-center text-white shadow-lg hover:scale-105 active:scale-95 transition-transform"
          style={{ background: 'var(--gradient-sidebar)' }}>
          <ClipboardCheck size={22} />
        </button>
      )}

      {/* In-page fallback (non-Chrome / PiP denied) */}
      {inPageOpen && (
        <div className="fixed left-4 bottom-4 z-[60] w-80 max-w-[calc(100vw-32px)] rounded-2xl overflow-hidden animate-scale-in"
          style={{ height: 460, boxShadow: 'var(--shadow-xl)', border: '1px solid var(--color-border)' }}>
          <ChecklistBody questions={questions} checked={checked} loading={loading}
            onToggle={toggle} onRefresh={refresh} onClose={() => setInPageOpen(false)} />
        </div>
      )}
    </>
  );
}
