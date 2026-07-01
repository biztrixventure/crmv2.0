import { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Phone, RefreshCw, X, Copy, Check, PhoneCall, Clock, CheckCircle, SkipForward, StickyNote } from 'lucide-react';
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

// Per-number note editor with "/" shortcode autocomplete. INLINE styles only
// (lives inside the PiP window, which has none of the app CSS). Mirrors the
// chat message-shortcut UX (type /code → insert full text). Shortcodes are
// server-side, merged across three tiers (personal > company > global) with a
// tier badge; any user can add/delete their OWN personal ones right here.
function NoteEditor({ initial, shortcodes, onSave, onCancel, onSavePersonal, onDeletePersonal }) {
  const [val, setVal] = useState(initial || '');
  const [menu, setMenu] = useState(null);   // { token, items } | null
  const [adding, setAdding] = useState(null); // { code, text } | null — personal mini-form
  const taRef = useRef(null);
  const C = { border: '#e2e8f0', sub: '#64748b', head: '#4f46e5', text: '#0f172a', bg: '#f8fafc' };
  const tierColor = { mine: '#059669', company: '#2563eb', global: '#94a3b8' };

  const recompute = (text, pos) => {
    const upto = text.slice(0, pos);
    const m = upto.match(/(?:^|\s)\/([a-z0-9]*)$/i);   // "/token" at the cursor
    if (!m) return setMenu(null);
    const token = m[1].toLowerCase();
    const items = (shortcodes || []).filter(s => s.code.toLowerCase().startsWith(token)).slice(0, 8);
    setMenu({ token, items });
  };
  const onChange = (e) => { setVal(e.target.value); recompute(e.target.value, e.target.selectionStart); };
  const pick = (sc) => {
    const ta = taRef.current; const pos = ta ? ta.selectionStart : val.length;
    const slashPos = pos - ((menu?.token.length || 0) + 1);
    const next = val.slice(0, slashPos) + sc.text + val.slice(pos);
    setVal(next); setMenu(null);
    requestAnimationFrame(() => { if (ta) { const c = slashPos + sc.text.length; ta.focus(); ta.setSelectionRange(c, c); } });
  };
  const onKeyDown = (e) => {
    if (!menu) return;
    if (e.key === 'Escape') { e.preventDefault(); setMenu(null); }
    else if (e.key === 'Enter' && menu.items[0]) { e.preventDefault(); pick(menu.items[0]); }
  };
  const startAdd = (code = '') => { setMenu(null); setAdding({ code, text: '' }); };
  const submitAdd = () => {
    if (!adding.code.trim() || !adding.text.trim()) return;
    onSavePersonal?.(adding.code.trim(), adding.text.trim());
    setAdding(null);
  };

  const btn = { border: 'none', background: 'transparent', cursor: 'pointer' };
  const mini = { fontSize: 12, padding: '4px 6px', borderRadius: 6, border: `1px solid ${C.border}`, outline: 'none' };

  return (
    <div style={{ position: 'relative', marginTop: 5 }}>
      <textarea ref={taRef} value={val} onChange={onChange} onKeyDown={onKeyDown} rows={2} autoFocus
        placeholder="Add a note… type / for shortcuts"
        style={{ width: '100%', fontSize: 12, padding: '6px 8px', borderRadius: 8, border: `1px solid ${C.border}`, resize: 'none', outline: 'none', fontFamily: 'inherit', color: C.text }} />
      {menu && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: '100%', zIndex: 50, marginTop: 2, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.15)', maxHeight: 168, overflowY: 'auto' }}>
          {menu.items.map(sc => (
            <div key={sc.id} style={{ display: 'flex', alignItems: 'center', borderBottom: `1px solid ${C.border}` }}>
              <button onMouseDown={(e) => { e.preventDefault(); pick(sc); }}
                style={{ ...btn, display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, textAlign: 'left', padding: '6px 8px' }}>
                <span style={{ fontFamily: 'ui-monospace,monospace', fontWeight: 700, fontSize: 11, color: C.head, flexShrink: 0 }}>/{sc.code}</span>
                <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', color: tierColor[sc.tier], flexShrink: 0 }}>{sc.tier}</span>
                <span style={{ fontSize: 11, color: C.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{sc.text}</span>
              </button>
              {sc.tier === 'mine' && onDeletePersonal && (
                <button onMouseDown={(e) => { e.preventDefault(); onDeletePersonal(sc.id); }} title="Delete my shortcut"
                  style={{ ...btn, padding: '0 6px', color: '#ef4444', flexShrink: 0, display: 'flex' }}><X size={12} /></button>
              )}
            </div>
          ))}
          {menu.token && onSavePersonal && (
            <button onMouseDown={(e) => { e.preventDefault(); startAdd(menu.token); }}
              style={{ ...btn, display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', background: C.bg, fontSize: 11, fontWeight: 700, color: C.head }}>
              ＋ Add “/{menu.token}” as my shortcut
            </button>
          )}
          {!menu.items.length && !menu.token && (
            <div style={{ padding: '8px', fontSize: 11, color: C.sub }}>No shortcuts</div>
          )}
        </div>
      )}

      {adding && (
        <div style={{ marginTop: 6, padding: 8, borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.sub, marginBottom: 4 }}>New personal shortcut (only you)</div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontFamily: 'ui-monospace,monospace', fontWeight: 700, color: C.sub }}>/</span>
            <input value={adding.code} onChange={e => setAdding(a => ({ ...a, code: e.target.value }))} placeholder="code" style={{ ...mini, width: 64 }} />
            <input value={adding.text} onChange={e => setAdding(a => ({ ...a, text: e.target.value }))} placeholder="full text" style={{ ...mini, flex: 1, minWidth: 0 }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 5 }}>
            <button onClick={() => setAdding(null)} style={{ ...btn, fontSize: 11, fontWeight: 700, color: C.sub }}>Cancel</button>
            <button onClick={submitAdd} disabled={!adding.code.trim() || !adding.text.trim()}
              style={{ ...btn, fontSize: 11, fontWeight: 700, color: '#fff', background: C.head, borderRadius: 6, padding: '4px 10px', opacity: (!adding.code.trim() || !adding.text.trim()) ? 0.5 : 1 }}>Save mine</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
        {onSavePersonal
          ? <button onClick={() => startAdd('')} style={{ ...btn, fontSize: 11, fontWeight: 700, color: C.head }}>＋ my shortcut</button>
          : <span />}
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={onCancel} style={{ ...btn, fontSize: 11, fontWeight: 700, color: C.sub }}>Cancel</button>
          <button onClick={() => onSave(val)} style={{ ...btn, fontSize: 11, fontWeight: 700, color: '#fff', background: C.head, borderRadius: 6, padding: '4px 10px' }}>Save</button>
        </div>
      </div>
    </div>
  );
}

function NumbersBody({ numbers, loading, filter, setFilter, onCopy, copied, onStatus, onRefresh, onClose, shortcodes, onSaveNote, onSavePersonal, onDeletePersonal }) {
  const C = { card: '#ffffff', text: '#0f172a', sub: '#64748b', border: '#e2e8f0', head: '#4f46e5' };
  const iconBtn = { background: 'transparent', border: 'none', color: '#fff', padding: 4, borderRadius: 6, cursor: 'pointer', display: 'flex' };
  const counts = numbers.reduce((a, n) => { a.all++; a[n.status] = (a[n.status] || 0) + 1; return a; }, { all: 0 });
  const list = filter === 'all' ? numbers : numbers.filter(n => n.status === filter);
  const [openNote, setOpenNote] = useState(null);

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
              <div style={{ display: 'flex', gap: 2, marginTop: 4, alignItems: 'center' }}>
                {act(n, 'called', PhoneCall, '#d97706', 'Mark Called')}
                {act(n, 'callback', Clock, '#7c3aed', 'Mark Callback')}
                {act(n, 'completed', CheckCircle, '#059669', 'Mark Done')}
                {act(n, 'skip', SkipForward, '#6b7280', 'Skip')}
                <button onClick={() => setOpenNote(o => o === n.id ? null : n.id)} title={n.notes ? 'Edit note' : 'Add note'}
                  style={{ border: 'none', background: 'transparent', padding: 4, borderRadius: 6, cursor: 'pointer', display: 'flex', marginLeft: 'auto' }}>
                  <StickyNote size={14} color={n.notes ? '#4f46e5' : '#94a3b8'} />
                </button>
              </div>
              {openNote === n.id ? (
                <NoteEditor initial={n.notes} shortcodes={shortcodes}
                  onCancel={() => setOpenNote(null)}
                  onSave={(v) => { onSaveNote(n, v); setOpenNote(null); }}
                  onSavePersonal={onSavePersonal} onDeletePersonal={onDeletePersonal} />
              ) : n.notes ? (
                <div onClick={() => setOpenNote(n.id)} title="Edit note"
                  style={{ fontSize: 11, color: '#475569', marginTop: 3, whiteSpace: 'pre-wrap', cursor: 'pointer' }}>{n.notes}</div>
              ) : null}
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
  const [shortcodes, setShortcodes] = useState([]);   // /code note shortcuts (company-scoped)
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

  // Save a per-number note (routes to the item's own source, both accept notes).
  const saveNote = useCallback((item, notes) => {
    const url = item.source === 'batch' ? `distribution-batches/items/${item.id}` : `number-lists/${item.id}`;
    client.put(url, { notes })
      .then(() => setNumbers(prev => prev.map(n => n.id === item.id ? { ...n, notes } : n)))
      .catch(() => {});
  }, []);

  // Load /code shortcuts (personal + company + global) and collapse to one per
  // code with PERSONAL > company > global precedence for the autocomplete.
  const loadShortcodes = useCallback(() => {
    client.get('note-shortcodes').then(r => {
      const raw = r.data.shortcodes || [];
      const rank = { mine: 3, company: 2, global: 1 };
      const by = new Map();
      for (const s of raw) { const cur = by.get(s.code); if (!cur || rank[s.tier] > rank[cur.tier]) by.set(s.code, s); }
      setShortcodes([...by.values()].sort((a, b) => (a.sort_order - b.sort_order) || a.code.localeCompare(b.code)));
    }).catch(() => {});
  }, []);
  const savePersonal = useCallback(async (code, text) => {
    try { await client.post('note-shortcodes/mine', { code, text }); loadShortcodes(); } catch { /* ignore */ }
  }, [loadShortcodes]);
  const deletePersonal = useCallback(async (id) => {
    try { await client.delete(`note-shortcodes/mine/${id}`); loadShortcodes(); } catch { /* ignore */ }
  }, [loadShortcodes]);

  useEffect(() => { if (inPageOpen || pipOpen) load(); }, [inPageOpen, pipOpen, load]);
  useEffect(() => { if (inPageOpen || pipOpen) loadShortcodes(); }, [inPageOpen, pipOpen, loadShortcodes]);
  // Keep it fresh while open (managers may assign mid-shift).
  // PERF (audit Y5): a 30s poll is fine at current fronter counts. If the fronter
  // headcount grows ~10x, replace this interval with Supabase Realtime on
  // distribution_batch_items (subscribe instead of poll) to cut steady DB load.
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
          onCopy={copyNumber} copied={copied} onStatus={setStatus} onRefresh={load} onClose={closePiP}
          shortcodes={shortcodes} onSaveNote={saveNote} onSavePersonal={savePersonal} onDeletePersonal={deletePersonal} />
      );
    }
  }, [pipOpen, numbers, loading, filter, copied, copyNumber, setStatus, load, closePiP, shortcodes, saveNote, savePersonal, deletePersonal]);

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
            onCopy={copyNumber} copied={copied} onStatus={setStatus} onRefresh={load} onClose={() => setInPageOpen(false)}
            shortcodes={shortcodes} onSaveNote={saveNote} onSavePersonal={savePersonal} onDeletePersonal={deletePersonal} />
        </div>
      )}
    </>
  );
}
