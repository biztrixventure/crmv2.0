import { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Phone, RefreshCw, X, Copy, Check, PhoneCall, Clock, CheckCircle, SkipForward } from 'lucide-react';
import client from '../../api/client';

// Fronters' floating "My Numbers" — same Document Picture-in-Picture pattern as
// the closer's call checklist: pops a real always-on-top OS window that floats
// OVER the VICIdial dialer tab. Tap a number to copy it (paste into the dialer),
// then mark the outcome (Called / Callback / Done / Skip) right there. Falls back
// to an in-page panel where PiP isn't supported. INLINE styles only — the PiP
// window has none of the app's CSS.
const supportsPiP = typeof window !== 'undefined' && 'documentPictureInPicture' in window;

const STATUS = {
  new:       { l: 'New',      c: '#2563eb', bg: '#eff6ff' },
  called:    { l: 'Called',   c: '#d97706', bg: '#fef3c7' },
  callback:  { l: 'Callback', c: '#7c3aed', bg: '#f3e8ff' },
  completed: { l: 'Done',     c: '#059669', bg: '#d1fae5' },
  skip:      { l: 'Skip',     c: '#6b7280', bg: '#f3f4f6' },
};
const FILTERS = ['all', 'new', 'called', 'callback', 'completed'];

function NumbersBody({ numbers, loading, filter, setFilter, onCopy, copied, onStatus, onRefresh, onClose }) {
  const C = { card: '#ffffff', text: '#0f172a', sub: '#64748b', border: '#e2e8f0', head: '#4f46e5' };
  const iconBtn = { background: 'transparent', border: 'none', color: '#fff', padding: 4, borderRadius: 6, cursor: 'pointer', display: 'flex' };
  const counts = numbers.reduce((a, n) => { a.all++; a[n.status] = (a[n.status] || 0) + 1; return a; }, { all: 0 });
  const list = filter === 'all' ? numbers : numbers.filter(n => n.status === filter);

  const act = (n, status, Icon, color, title) => (
    n.status !== status ? (
      <button onClick={() => onStatus(n.id, status, n.source)} title={title}
        style={{ border: 'none', background: 'transparent', padding: 4, borderRadius: 6, cursor: 'pointer', display: 'flex' }}>
        <Icon size={14} color={color} />
      </button>
    ) : null
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: C.card, fontFamily: 'system-ui,-apple-system,sans-serif', color: C.text }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: C.head, color: '#fff', flexShrink: 0 }}>
        <Phone size={16} />
        <span style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>My Numbers</span>
        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: 'rgba(255,255,255,0.2)' }}>{counts.new || 0} new</span>
        <button onClick={onRefresh} title="Refresh" style={iconBtn}>
          <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
        </button>
        {onClose && <button onClick={onClose} title="Close" style={iconBtn}><X size={15} /></button>}
      </div>

      {/* filter chips */}
      <div style={{ display: 'flex', gap: 4, padding: '6px 8px', flexWrap: 'wrap', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        {FILTERS.map(f => {
          const active = filter === f;
          const label = f === 'all' ? 'All' : STATUS[f].l;
          const n = counts[f] || (f === 'all' ? counts.all : 0);
          return (
            <button key={f} onClick={() => setFilter(f)}
              style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${active ? C.head : C.border}`, background: active ? C.head : '#fff', color: active ? '#fff' : C.sub }}>
              {label} {n}
            </button>
          );
        })}
      </div>

      {/* list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
        {loading && !numbers.length ? (
          <p style={{ fontSize: 12, textAlign: 'center', padding: '28px 0', color: C.sub }}>Loading…</p>
        ) : list.length === 0 ? (
          <p style={{ fontSize: 12, textAlign: 'center', padding: '28px 0', color: C.sub }}>No numbers{filter !== 'all' ? ` (${filter})` : ' assigned'}.</p>
        ) : list.map(n => {
          const s = STATUS[n.status] || STATUS.new;
          const isCopied = copied === n.phone_number;
          return (
            <div key={n.id} style={{ padding: '7px 8px', borderRadius: 10, marginBottom: 2, background: '#fff', border: `1px solid ${C.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button onClick={() => onCopy(n.phone_number)} title="Tap to copy"
                  style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', fontFamily: 'ui-monospace,monospace', fontWeight: 700, fontSize: 14, color: C.text, flex: 1, textAlign: 'left' }}>
                  {n.phone_number}
                </button>
                {isCopied
                  ? <span style={{ fontSize: 10, fontWeight: 700, color: '#059669', display: 'flex', alignItems: 'center', gap: 2 }}><Check size={11} /> copied</span>
                  : <button onClick={() => onCopy(n.phone_number)} title="Copy" style={{ border: 'none', background: 'transparent', padding: 3, cursor: 'pointer', display: 'flex' }}><Copy size={13} color={C.sub} /></button>}
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 999, background: s.bg, color: s.c }}>{s.l}</span>
              </div>
              {n.customer_name && <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>{n.customer_name}</div>}
              <div style={{ display: 'flex', gap: 2, marginTop: 4 }}>
                {act(n, 'called', PhoneCall, '#d97706', 'Mark Called')}
                {act(n, 'callback', Clock, '#7c3aed', 'Mark Callback')}
                {act(n, 'completed', CheckCircle, '#059669', 'Mark Done')}
                {act(n, 'skip', SkipForward, '#6b7280', 'Skip')}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ padding: '6px 10px', fontSize: 10, textAlign: 'center', borderTop: `1px solid ${C.border}`, color: C.sub, flexShrink: 0 }}>
        Floats over your dialer · tap a number to copy
      </div>
    </div>
  );
}

export default function FronterNumbersWidget({ user }) {
  const [numbers, setNumbers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter]   = useState('all');
  const [copied, setCopied]   = useState(null);
  const [inPageOpen, setInPageOpen] = useState(false);
  const [pipOpen, setPipOpen] = useState(false);
  const pipWinRef  = useRef(null);
  const pipRootRef = useRef(null);
  const copyTimer  = useRef(null);

  // INTENTIONAL PARALLEL (confirmed, not forgotten): this widget reads BOTH
  // legacy number_lists AND the newer distribution_batch_items assigned to me,
  // merged into one list. Each item is tagged with its `source` so a status
  // update PUTs to the right endpoint (number-lists vs distribution-batches).
  // TODO(consolidation): once all number assignment flows through
  // distribution_batch_items, migrate number_lists into it and drop this dual
  // fetch + the source-routing in setStatus. Kept parallel for now so nothing
  // in the existing number-lists flow breaks during rollout.
  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      user?.company_id
        ? client.get('number-lists', { params: { company_id: user.company_id } }).then(r => (r.data.numbers || []).map(n => ({ ...n, source: 'list' }))).catch(() => [])
        : Promise.resolve([]),
      client.get('distribution-batches/my-numbers').then(r => (r.data.numbers || []).map(n => ({ ...n, source: 'batch' }))).catch(() => []),
    ]).then(([list, batch]) => setNumbers([...batch, ...list])).finally(() => setLoading(false));
  }, [user?.company_id]);

  const copyNumber = useCallback((num) => {
    const digits = String(num || '').replace(/\D/g, '');
    navigator.clipboard?.writeText(digits).catch(() => {});
    setCopied(num);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(c => (c === num ? null : c)), 1200);
  }, []);

  const setStatus = useCallback((id, status, source) => {
    const url = source === 'batch' ? `distribution-batches/items/${id}` : `number-lists/${id}`;
    client.put(url, { status })
      .then(() => setNumbers(prev => prev.map(n => n.id === id ? { ...n, status } : n)))
      .catch(() => {});
  }, []);

  useEffect(() => { if (inPageOpen || pipOpen) load(); }, [inPageOpen, pipOpen, load]);
  // Keep it fresh while open (managers may assign mid-shift).
  useEffect(() => {
    if (!inPageOpen && !pipOpen) return;
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [inPageOpen, pipOpen, load]);

  const closePiP = useCallback(() => { try { pipWinRef.current?.close(); } catch { /* already closed */ } }, []);

  const openPiP = useCallback(async () => {
    try {
      const pip = await window.documentPictureInPicture.requestWindow({ width: 320, height: 480 });
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
      setInPageOpen(true);
    }
  }, []);

  // Re-render the PiP tree on any state change.
  useEffect(() => {
    if (pipOpen && pipRootRef.current) {
      pipRootRef.current.render(
        <NumbersBody numbers={numbers} loading={loading} filter={filter} setFilter={setFilter}
          onCopy={copyNumber} copied={copied} onStatus={setStatus} onRefresh={load} onClose={closePiP} />
      );
    }
  }, [pipOpen, numbers, loading, filter, copied, copyNumber, setStatus, load, closePiP]);

  useEffect(() => () => { try { pipWinRef.current?.close(); } catch { /* noop */ } }, []);

  const launch = () => { if (supportsPiP) openPiP(); else setInPageOpen(true); };

  return (
    <>
      {!inPageOpen && !pipOpen && (
        <button onClick={launch} title="My Numbers (floating)"
          className="fixed left-4 bottom-20 z-[60] w-12 h-12 rounded-full flex items-center justify-center text-white shadow-lg hover:scale-105 active:scale-95 transition-transform"
          style={{ background: 'var(--gradient-sidebar)' }}>
          <Phone size={20} />
        </button>
      )}

      {inPageOpen && (
        <div className="fixed left-4 bottom-4 z-[60] w-80 max-w-[calc(100vw-32px)] rounded-2xl overflow-hidden animate-scale-in"
          style={{ height: 470, boxShadow: 'var(--shadow-xl)', border: '1px solid var(--color-border)' }}>
          <NumbersBody numbers={numbers} loading={loading} filter={filter} setFilter={setFilter}
            onCopy={copyNumber} copied={copied} onStatus={setStatus} onRefresh={load} onClose={() => setInPageOpen(false)} />
        </div>
      )}
    </>
  );
}
