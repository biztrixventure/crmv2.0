// ============================================================================
// KanbanBoard — PUBLIC, no-login task board (kan.bn-style). /board/:token.
// The share token is the only credential. First visit asks the visitor's name
// (localStorage), stamped on what they create. Anyone with the link can add
// lists, cards, tags, and annotated screenshots.
//
// This version: unified pointer drag (works on touch + mouse), a tag-filter +
// search bar, client-side image downscaling with thumbnails (fast loads), and a
// responsive layout that collapses cleanly to phone width.
// ============================================================================
import { useState, useEffect, useRef, useCallback, useMemo, useContext } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { ThemeContext } from '../contexts/ThemeContext';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001/api' });

// Follow the CRM theme (warm light / obsidian dark) — every colour is a CSS
// variable from global.css, so the board recolours with the app theme + toggle.
const C = {
  bg: 'var(--color-bg)', board: 'var(--color-bg-secondary)', surface: 'var(--color-surface)',
  surfaceHover: 'var(--color-surface-hover)', border: 'var(--color-border)', text: 'var(--color-text)',
  sub: 'var(--color-text-secondary)', faint: 'var(--color-text-tertiary)', primary: 'var(--color-primary)',
  primarySoft: 'var(--color-primary-100)', danger: 'var(--color-error-600)', ok: 'var(--color-success-500)',
};
const TAG_HUES = [231, 160, 32, 350, 265, 190, 315, 96];
const tagHue = (t) => TAG_HUES[[...String(t)].reduce((a, c) => a + c.charCodeAt(0), 0) % TAG_HUES.length];
// Translucent hue → readable on both the warm-cream light and obsidian dark themes.
const tagStyle = (t, on = false) => { const h = tagHue(t); return on
  ? { background: `hsl(${h} 65% 47%)`, color: '#fff', border: `1px solid hsl(${h} 65% 47%)` }
  : { background: `hsl(${h} 60% 50% / 0.16)`, color: `hsl(${h} 72% 55%)`, border: `1px solid hsl(${h} 60% 50% / 0.32)` }; };

// Downscale an image (File or dataURL) to a max dimension, return a JPEG dataURL.
async function downscale(src, maxDim, quality = 0.82) {
  const dataUrl = typeof src === 'string' ? src : await fileToDataUrl(src);
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      if (scale === 1 && typeof src === 'string') return res(dataUrl);
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      res(cv.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => res(dataUrl);
    img.src = dataUrl;
  });
}
function fileToDataUrl(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); }); }

export default function KanbanBoard() {
  const { token } = useParams();
  const [name, setName] = useState(() => localStorage.getItem('kanban_name') || '');
  const [nameInput, setNameInput] = useState('');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [openCardId, setOpenCard] = useState(null);
  const [newCol, setNewCol] = useState('');
  const [addingCol, setAddingCol] = useState(false);
  const [q, setQ] = useState('');
  const [activeTags, setActiveTags] = useState([]);   // AND filter
  const modalOpen = useRef(false);
  const drag = useRef({ active: false, id: null, ghost: null });
  const [dragId, setDragId] = useState(null);
  const { theme, toggleTheme } = useContext(ThemeContext) || {};

  const load = useCallback(async () => {
    try { const r = await api.get(`kanban/b/${token}`); setData(r.data); setErr(''); }
    catch (e) { setErr(e.response?.data?.error || 'Board not found'); }
  }, [token]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => { if (!modalOpen.current && !drag.current.active) load(); }, 5000);
    return () => clearInterval(t);
  }, [load]);

  const saveName = () => { const n = nameInput.trim().slice(0, 60); if (!n) return; localStorage.setItem('kanban_name', n); setName(n); };

  // ── mutations (optimistic) ──
  const addCard = async (columnId, title) => {
    if (!title.trim()) return;
    try { const r = await api.post(`kanban/b/${token}/cards`, { column_id: columnId, title, author_name: name }); setData(d => ({ ...d, cards: [...d.cards, r.data.card] })); }
    catch { load(); }
  };
  const addColumn = async () => {
    if (!newCol.trim()) return;
    try { const r = await api.post(`kanban/b/${token}/columns`, { title: newCol }); setData(d => ({ ...d, columns: [...d.columns, r.data.column] })); setNewCol(''); setAddingCol(false); }
    catch { load(); }
  };
  const renameColumn = async (col, title) => { setData(d => ({ ...d, columns: d.columns.map(c => c.id === col.id ? { ...c, title } : c) })); try { await api.patch(`kanban/b/${token}/columns/${col.id}`, { title }); } catch { load(); } };
  const deleteColumn = async (col) => {
    if (!window.confirm(`Delete list "${col.title}" and its cards?`)) return;
    setData(d => ({ ...d, columns: d.columns.filter(c => c.id !== col.id), cards: d.cards.filter(c => c.column_id !== col.id) }));
    try { await api.delete(`kanban/b/${token}/columns/${col.id}`); } catch { load(); }
  };

  const moveCard = async (cardId, columnId, beforeCardId) => {
    const cards = [...data.cards];
    const moving = cards.find(c => c.id === cardId); if (!moving) return;
    const inCol = cards.filter(c => c.id !== cardId && c.column_id === columnId).sort((a, b) => a.position - b.position);
    const idx = beforeCardId ? inCol.findIndex(c => c.id === beforeCardId) : inCol.length;
    inCol.splice(idx < 0 ? inCol.length : idx, 0, { ...moving, column_id: columnId });
    const moves = inCol.map((c, i) => ({ id: c.id, column_id: columnId, position: i }));
    const byId = Object.fromEntries(moves.map(m => [m.id, m]));
    setData(d => ({ ...d, cards: d.cards.map(c => byId[c.id] ? { ...c, column_id: columnId, position: byId[c.id].position } : c) }));
    try { await api.put(`kanban/b/${token}/reorder`, { moves }); } catch { load(); }
  };

  // ── unified pointer drag (mouse + touch). A press that never moves = a tap → open.
  const startDrag = (e, card) => {
    if (e.target.closest('button,a,input,textarea,select')) return;
    const startX = e.clientX, startY = e.clientY;
    let armed = false;
    const onMove = (ev) => {
      if (!armed) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 8) return;
        armed = true; drag.current.active = true; drag.current.id = card.id; setDragId(card.id);
        const g = document.createElement('div');
        g.textContent = card.title.slice(0, 60);
        Object.assign(g.style, { position: 'fixed', zIndex: 9999, pointerEvents: 'none', maxWidth: '240px', padding: '8px 10px', borderRadius: '10px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 8px 24px rgba(0,0,0,.35)', font: '13px system-ui', color: 'var(--color-text)', transform: 'rotate(2deg)' });
        document.body.appendChild(g); drag.current.ghost = g;
      }
      const g = drag.current.ghost; if (g) { g.style.left = ev.clientX + 12 + 'px'; g.style.top = ev.clientY + 12 + 'px'; }
      const colEl = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-col]');
      document.querySelectorAll('[data-col]').forEach(el => { el.style.outline = (colEl === el) ? `2px solid ${C.primary}` : 'none'; });
    };
    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
      document.querySelectorAll('[data-col]').forEach(el => { el.style.outline = 'none'; });
      if (drag.current.ghost) { drag.current.ghost.remove(); drag.current.ghost = null; }
      const wasActive = drag.current.active; drag.current.active = false; drag.current.id = null; setDragId(null);
      if (!wasActive) { setOpenCard(card.id); return; }   // tap → open
      const colEl = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-col]');
      if (!colEl) return;
      const targetCol = colEl.dataset.col;
      const cardEls = [...colEl.querySelectorAll('[data-card]')].filter(el => el.dataset.card !== card.id);
      let beforeId = null;
      for (const el of cardEls) { const r = el.getBoundingClientRect(); if (ev.clientY < r.top + r.height / 2) { beforeId = el.dataset.card; break; } }
      moveCard(card.id, targetCol, beforeId);
    };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  };

  const allTags = useMemo(() => { const s = new Set(); (data?.cards || []).forEach(c => (c.tags || []).forEach(t => s.add(t))); return [...s].sort(); }, [data]);
  const toggleTag = (t) => setActiveTags(a => a.includes(t) ? a.filter(x => x !== t) : [...a, t]);
  const matches = (card) => {
    if (activeTags.length && !activeTags.every(t => (card.tags || []).includes(t))) return false;
    if (q.trim()) { const hay = `${card.title} ${card.description || ''} ${(card.tags || []).join(' ')}`.toLowerCase(); if (!hay.includes(q.trim().toLowerCase())) return false; }
    return true;
  };

  if (err) return <Center><div style={{ color: C.danger, fontWeight: 600 }}>{err}</div></Center>;
  if (!name) return <NameGate value={nameInput} onChange={setNameInput} onSave={saveName} />;
  if (!data) return <Center><Spinner /> <span style={{ color: C.sub, marginLeft: 8 }}>Loading board…</span></Center>;

  const cardsOf = (colId) => data.cards.filter(c => c.column_id === colId && matches(c)).sort((a, b) => a.position - b.position);
  const openCard = data.cards.find(c => c.id === openCardId) || null;
  const total = data.cards.length, shown = data.cards.filter(matches).length;

  return (
    <div style={{ minHeight: '100dvh', background: C.bg, fontFamily: 'system-ui, -apple-system, sans-serif', color: C.text, display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, position: 'sticky', top: 0, zIndex: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', flexWrap: 'wrap' }}>
          <div style={{ width: 26, height: 26, borderRadius: 8, background: `linear-gradient(135deg, ${C.primary}, #7c3aed)`, flexShrink: 0 }} />
          <div style={{ fontWeight: 800, fontSize: 17, minWidth: 0, flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data.board.title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ position: 'relative' }}>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search cards…" style={{ ...inp, width: 'min(46vw, 220px)', paddingLeft: 30 }} />
              <span style={{ position: 'absolute', left: 9, top: 7, color: C.faint, fontSize: 14 }}>⌕</span>
            </div>
            {toggleTheme && (
              <button onClick={toggleTheme} title="Toggle light / dark" style={{ ...btnGhost, border: `1px solid ${C.border}`, padding: '5px 9px', fontSize: 15, lineHeight: 1 }}>{theme === 'dark' ? '☀' : '☾'}</button>
            )}
            <span title="signed-in name" style={{ fontSize: 12, color: C.sub, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 24, height: 24, borderRadius: '50%', background: C.primarySoft, color: C.primary, display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 11 }}>{name.slice(0, 2).toUpperCase()}</span>
              <button onClick={() => { localStorage.removeItem('kanban_name'); setName(''); setNameInput(name); }} style={{ ...btnGhost, padding: '2px 4px', fontSize: 12, color: C.primary }}>change</button>
            </span>
          </div>
        </div>

        {/* Tag filter bar — every tag used on the board, tap to filter (AND) */}
        {(allTags.length > 0) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 16px 10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: C.faint }}>Tags</span>
            {allTags.map(t => {
              const on = activeTags.includes(t);
              return <button key={t} onClick={() => toggleTag(t)} style={{ ...tagStyle(t, on), fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 999, cursor: 'pointer' }}>{t}</button>;
            })}
            {(activeTags.length > 0 || q) && <button onClick={() => { setActiveTags([]); setQ(''); }} style={{ ...btnGhost, fontSize: 12, color: C.sub }}>Clear</button>}
            {(activeTags.length > 0 || q) && <span style={{ fontSize: 12, color: C.faint }}>{shown} / {total}</span>}
          </div>
        )}
      </header>

      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <GridBg />
        <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', gap: 12, padding: 16, alignItems: 'flex-start', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {data.columns.slice().sort((a, b) => a.position - b.position).map(col => (
            <Column key={col.id} col={col} cards={cardsOf(col.id)} dragId={dragId}
              onAddCard={addCard} onRename={renameColumn} onDelete={deleteColumn} onStartDrag={startDrag} />
          ))}
          <div style={{ width: 'min(84vw, 288px)', flexShrink: 0 }}>
            {addingCol ? (
              <div style={{ background: C.surface, borderRadius: 14, padding: 10, border: `1px solid ${C.border}` }}>
                <input autoFocus value={newCol} onChange={e => setNewCol(e.target.value)} onKeyDown={e => e.key === 'Enter' && addColumn()} placeholder="List title…" style={inp} />
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}><button onClick={addColumn} style={btnPrimary}>Add list</button><button onClick={() => { setAddingCol(false); setNewCol(''); }} style={btnGhost}>Cancel</button></div>
              </div>
            ) : (
              <button onClick={() => setAddingCol(true)} style={{ ...btnGhost, width: '100%', padding: 12, background: 'color-mix(in srgb, var(--color-surface) 55%, transparent)', border: `1.5px dashed ${C.border}`, borderRadius: 14, color: C.sub, fontWeight: 600 }}>+ Add another list</button>
            )}
          </div>
        </div>
      </div>

      {openCard && (
        <CardModal token={token} card={openCard} name={name} modalOpen={modalOpen}
          onClose={() => setOpenCard(null)}
          onChange={(patch) => setData(d => ({ ...d, cards: d.cards.map(c => c.id === openCard.id ? { ...c, ...patch } : c) }))}
          onDelete={() => { setData(d => ({ ...d, cards: d.cards.filter(c => c.id !== openCard.id) })); setOpenCard(null); }} />
      )}
    </div>
  );
}

// ── column ───────────────────────────────────────────────────────────────────
function Column({ col, cards, dragId, onAddCard, onRename, onDelete, onStartDrag }) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(col.title);
  return (
    <div data-col={col.id} style={{ width: 'min(84vw, 288px)', flexShrink: 0, background: C.board, borderRadius: 14, padding: 8, maxHeight: 'calc(100dvh - 150px)', display: 'flex', flexDirection: 'column', transition: 'outline .1s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px 8px' }}>
        {editing
          ? <input autoFocus value={name} onChange={e => setName(e.target.value)} onBlur={() => { setEditing(false); onRename(col, name); }} onKeyDown={e => e.key === 'Enter' && (setEditing(false), onRename(col, name))} style={{ ...inp, fontWeight: 700 }} />
          : <div onClick={() => setEditing(true)} style={{ fontWeight: 700, fontSize: 14, flex: 1, cursor: 'text' }}>{col.title} <span style={{ color: C.faint, fontWeight: 600, fontSize: 12 }}>{cards.length}</span></div>}
        <button onClick={() => onDelete(col)} title="Delete list" style={{ ...btnGhost, color: C.faint, fontSize: 17, lineHeight: 1, padding: 2 }}>×</button>
      </div>

      <div style={{ overflowY: 'auto', flex: 1, minHeight: 8, margin: '0 -2px', padding: '0 2px' }}>
        {cards.map(card => (
          <div key={card.id} data-card={card.id} onPointerDown={e => onStartDrag(e, card)}
            style={{ background: C.surface, borderRadius: 11, padding: '9px 11px', marginBottom: 7, boxShadow: '0 1px 2px rgba(20,30,50,.08)', cursor: 'grab', border: `1px solid ${C.border}`, opacity: dragId === card.id ? 0.4 : 1, touchAction: 'none', userSelect: 'none' }}>
            {!!(card.tags || []).length && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                {card.tags.map(t => <span key={t} style={{ ...tagStyle(t), fontSize: 10.5, fontWeight: 700, padding: '1px 7px', borderRadius: 999 }}>{t}</span>)}
              </div>
            )}
            <div style={{ fontSize: 13.5, lineHeight: 1.38, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{card.title}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 7, fontSize: 11, color: C.faint }}>
              {card.attachment_count > 0 && <span title="images">🖼 {card.attachment_count}</span>}
              {card.description && <span title="has description">≡</span>}
              {card.created_by_name && <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 16, height: 16, borderRadius: '50%', background: C.primarySoft, color: C.primary, display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 8 }}>{card.created_by_name.slice(0, 2).toUpperCase()}</span></span>}
            </div>
          </div>
        ))}
      </div>

      {adding ? (
        <div style={{ marginTop: 6 }}>
          <textarea autoFocus value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onAddCard(col.id, title); setTitle(''); } }} placeholder="Task title… (Enter to add)" rows={2} style={{ ...inp, resize: 'vertical' }} />
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}><button onClick={() => { onAddCard(col.id, title); setTitle(''); }} style={btnPrimary}>Add card</button><button onClick={() => { setAdding(false); setTitle(''); }} style={btnGhost}>Cancel</button></div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} style={{ ...btnGhost, marginTop: 4, textAlign: 'left', color: C.sub, fontWeight: 600 }}>+ Add a card</button>
      )}
    </div>
  );
}

// ── card modal ─────────────────────────────────────────────────────────────
function CardModal({ token, card, name, onClose, onChange, onDelete, modalOpen }) {
  const [title, setTitle] = useState(card.title);
  const [desc, setDesc] = useState(card.description || '');
  const [tags, setTags] = useState(card.tags || []);
  const [tagInput, setTagInput] = useState('');
  const [atts, setAtts] = useState(null);
  const [annotating, setAnnotating] = useState(null);   // { id, data_url }
  const [lightbox, setLightbox] = useState(null);
  const [busyImg, setBusyImg] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => { modalOpen.current = true; return () => { modalOpen.current = false; }; }, [modalOpen]);
  useEffect(() => { api.get(`kanban/b/${token}/cards/${card.id}/attachments`).then(r => setAtts(r.data.attachments || [])).catch(() => setAtts([])); }, [token, card.id]);

  const saveField = async (patch) => { onChange(patch); try { await api.patch(`kanban/b/${token}/cards/${card.id}`, patch); } catch {} };
  const addTag = () => { const t = tagInput.trim().slice(0, 40); if (!t || tags.includes(t)) { setTagInput(''); return; } const next = [...tags, t]; setTags(next); setTagInput(''); saveField({ tags: next }); };
  const removeTag = (t) => { const next = tags.filter(x => x !== t); setTags(next); saveField({ tags: next }); };

  const uploadOne = async (file) => {
    const [full, thumb] = await Promise.all([downscale(file, 1600, 0.82), downscale(file, 360, 0.7)]);
    const r = await api.post(`kanban/b/${token}/cards/${card.id}/attachments`, { data_url: full, thumb_url: thumb, name: file.name, author_name: name });
    setAtts(a => [...(a || []), r.data.attachment]); onChange({ attachment_count: (card.attachment_count || 0) + 1 });
  };
  const onFiles = async (files) => {
    setBusyImg(true);
    try { for (const f of files) if (f.type.startsWith('image/')) await uploadOne(f); }
    catch (e) { alert(e.response?.data?.error || 'Upload failed'); }
    finally { setBusyImg(false); }
  };
  const onPaste = (e) => { const imgs = [...(e.clipboardData?.items || [])].filter(i => i.type.startsWith('image/')).map(i => i.getAsFile()).filter(Boolean); if (imgs.length) { e.preventDefault(); onFiles(imgs); } };
  const delAtt = async (a) => { if (!window.confirm('Delete this image?')) return; setAtts(list => list.filter(x => x.id !== a.id)); onChange({ attachment_count: Math.max(0, (card.attachment_count || 1) - 1) }); try { await api.delete(`kanban/b/${token}/attachments/${a.id}`); } catch {} };

  const openFull = async (a) => { try { const r = await api.get(`kanban/b/${token}/attachments/${a.id}/full`); return r.data.attachment.data_url; } catch { return a.thumb_url; } };
  const startAnnotate = async (a) => { const full = await openFull(a); setAnnotating({ id: a.id, data_url: full }); };
  const openLightbox = async (a) => { setLightbox({ id: a.id, data_url: a.thumb_url }); const full = await openFull(a); setLightbox({ id: a.id, data_url: full }); };
  const saveAnnotation = async (fullDataUrl) => {
    const thumb = await downscale(fullDataUrl, 360, 0.7);
    try { const r = await api.put(`kanban/b/${token}/attachments/${annotating.id}`, { data_url: fullDataUrl, thumb_url: thumb }); setAtts(list => list.map(x => x.id === annotating.id ? { ...x, thumb_url: r.data.attachment.thumb_url || thumb } : x)); }
    catch (e) { alert(e.response?.data?.error || 'Save failed'); }
    setAnnotating(null);
  };
  const del = async () => { if (!window.confirm('Delete this card?')) return; try { await api.delete(`kanban/b/${token}/cards/${card.id}`); } catch {} onDelete(); };

  return (
    <div onClick={onClose} onPaste={onPaste} style={{ position: 'fixed', inset: 0, background: 'rgba(15,20,35,.5)', zIndex: 50, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 'min(5vh, 40px) 12px', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.surface, borderRadius: 16, width: 'min(680px, 100%)', padding: 18, boxShadow: '0 24px 70px rgba(0,0,0,.32)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <textarea value={title} onChange={e => setTitle(e.target.value)} onBlur={() => title.trim() && title !== card.title && saveField({ title })} rows={1} style={{ ...inp, fontSize: 17, fontWeight: 700, resize: 'none', flex: 1 }} />
          <button onClick={onClose} style={{ ...btnGhost, fontSize: 22, color: C.faint }}>×</button>
        </div>
        <div style={{ fontSize: 12, color: C.faint, margin: '2px 2px 14px' }}>Added by {card.created_by_name || 'someone'}</div>

        <Section label="Tags">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {tags.map(t => <span key={t} style={{ ...tagStyle(t), fontSize: 12, fontWeight: 700, padding: '3px 9px', borderRadius: 999, display: 'inline-flex', gap: 6, alignItems: 'center' }}>{t}<span onClick={() => removeTag(t)} style={{ cursor: 'pointer', opacity: 0.75, fontWeight: 900 }}>×</span></span>)}
            <input value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTag()} placeholder="+ add tag" style={{ ...inp, width: 110, padding: '4px 9px' }} />
          </div>
        </Section>

        <Section label="Description — what to do / changes needed">
          <textarea value={desc} onChange={e => setDesc(e.target.value)} onBlur={() => desc !== (card.description || '') && saveField({ description: desc })} placeholder="Explain the task, the change, steps…" rows={5} style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }} />
        </Section>

        <Section label={`Images & screenshots${busyImg ? ' — uploading…' : ' (paste, or add — then annotate)'}`}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {(atts || []).map(a => (
              <div key={a.id} style={{ width: 140 }}>
                <img src={a.thumb_url} alt={a.name || ''} loading="lazy" onClick={() => openLightbox(a)} style={{ width: 140, height: 100, objectFit: 'cover', borderRadius: 10, border: `1px solid ${C.border}`, cursor: 'zoom-in', background: C.board }} />
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <button onClick={() => startAnnotate(a)} style={{ ...btnGhost, flex: 1, fontSize: 11, padding: '3px 6px', border: `1px solid ${C.border}` }}>✏ Annotate</button>
                  <button onClick={() => delAtt(a)} style={{ ...btnGhost, fontSize: 11, padding: '3px 6px', color: C.danger }}>Delete</button>
                </div>
              </div>
            ))}
            <button onClick={() => fileRef.current?.click()} disabled={busyImg} style={{ width: 140, height: 100, borderRadius: 10, border: `1.5px dashed ${C.border}`, background: C.bg, color: C.sub, cursor: 'pointer', fontSize: 13 }}>{busyImg ? '…' : '+ Add / paste'}</button>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => { onFiles([...e.target.files]); e.target.value = ''; }} />
          </div>
        </Section>

        <div style={{ display: 'flex', marginTop: 16, gap: 8 }}>
          <button onClick={del} style={{ ...btnGhost, color: C.danger, border: `1px solid ${C.border}` }}>Delete card</button>
          <button onClick={onClose} style={{ ...btnPrimary, marginLeft: 'auto' }}>Done</button>
        </div>
      </div>

      {annotating && <Annotator src={annotating.data_url} onCancel={() => setAnnotating(null)} onSave={saveAnnotation} />}
      {lightbox && <div onClick={() => setLightbox(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', zIndex: 60, display: 'grid', placeItems: 'center', padding: 16 }}><img src={lightbox.data_url} style={{ maxWidth: '100%', maxHeight: '92vh', borderRadius: 8 }} /></div>}
    </div>
  );
}

// ── image annotator (pen / rect / arrow / text; flatten to JPEG) ─────────────
function Annotator({ src, onSave, onCancel }) {
  const canvasRef = useRef(null);
  const [color, setColor] = useState('#e11d48');
  const [tool, setTool] = useState('pen');
  const [size, setSize] = useState(4);
  const draw = useRef({ active: false, x0: 0, y0: 0, snapshot: null });
  const undoStack = useRef([]);

  useEffect(() => {
    const canvas = canvasRef.current, ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => { const maxW = Math.min(1100, window.innerWidth - 40); const s = Math.min(1, maxW / img.width); canvas.width = img.width * s; canvas.height = img.height * s; ctx.drawImage(img, 0, 0, canvas.width, canvas.height); };
    img.src = src;
  }, [src]);

  const pos = (e) => { const r = canvasRef.current.getBoundingClientRect(); return { x: (e.clientX - r.left) * (canvasRef.current.width / r.width), y: (e.clientY - r.top) * (canvasRef.current.height / r.height) }; };
  const pushUndo = () => { const c = canvasRef.current; undoStack.current.push(c.getContext('2d').getImageData(0, 0, c.width, c.height)); if (undoStack.current.length > 30) undoStack.current.shift(); };
  const undo = () => { const s = undoStack.current.pop(); if (s) canvasRef.current.getContext('2d').putImageData(s, 0, 0); };
  const arrow = (ctx, x0, y0, x1, y1) => { const a = Math.atan2(y1 - y0, x1 - x0), h = 12 + size * 2; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - h * Math.cos(a - 0.4), y1 - h * Math.sin(a - 0.4)); ctx.lineTo(x1 - h * Math.cos(a + 0.4), y1 - h * Math.sin(a + 0.4)); ctx.closePath(); ctx.fillStyle = color; ctx.fill(); };
  const pressure = (e) => (e.pressure && e.pressure > 0 && e.pressure < 1 ? e.pressure : (e.pointerType === 'mouse' ? 0.5 : (e.pressure || 0.5)));
  const down = (e) => {
    e.preventDefault(); if (e.pointerId != null) e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = pos(e); const ctx = canvasRef.current.getContext('2d');
    if (tool === 'text') { const txt = window.prompt('Text:'); if (!txt) return; pushUndo(); ctx.fillStyle = color; ctx.font = `bold ${size * 6}px system-ui`; ctx.textBaseline = 'top'; ctx.fillText(txt, p.x, p.y); return; }
    pushUndo();
    draw.current = { active: true, x0: p.x, y0: p.y, prev: p, mid: p, snapshot: ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height) };
  };
  const move = (e) => {
    if (!draw.current.active) return; e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (tool === 'pen') {
      // Smooth: quadratic curve through midpoints. Pressure: variable width from
      // the stylus (0.5 fallback for mouse). Coalesced events keep fast strokes fluid.
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of evs) {
        const p = pos(ev); const d = draw.current;
        const mid = { x: (d.prev.x + p.x) / 2, y: (d.prev.y + p.y) / 2 };
        ctx.lineWidth = Math.max(0.5, size * (0.35 + pressure(ev) * 1.4));
        ctx.beginPath(); ctx.moveTo(d.mid.x, d.mid.y); ctx.quadraticCurveTo(d.prev.x, d.prev.y, mid.x, mid.y); ctx.stroke();
        d.prev = p; d.mid = mid;
      }
    } else {
      const p = pos(e); ctx.putImageData(draw.current.snapshot, 0, 0); ctx.lineWidth = size;
      const { x0, y0 } = draw.current; if (tool === 'rect') ctx.strokeRect(x0, y0, p.x - x0, p.y - y0); else if (tool === 'arrow') arrow(ctx, x0, y0, p.x, p.y);
    }
  };
  const up = () => { draw.current.active = false; };
  const TOOLS = [['pen', '✏'], ['rect', '▭'], ['arrow', '↗'], ['text', 'T']];

  return (
    <div onClick={e => e.stopPropagation()} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.8)', zIndex: 70, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: C.surface, padding: '8px 12px', borderRadius: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        {TOOLS.map(([k, ic]) => <button key={k} onClick={() => setTool(k)} style={{ ...btnGhost, background: tool === k ? C.primary : 'var(--color-surface-hover)', color: tool === k ? '#fff' : 'var(--color-text)', fontWeight: 800, minWidth: 36 }}>{ic}</button>)}
        {['#e11d48', '#4f46e5', '#059669', '#d97706', '#111827', '#ffffff'].map(c => <button key={c} onClick={() => setColor(c)} style={{ width: 24, height: 24, borderRadius: 7, background: c, border: color === c ? '3px solid #111' : `1px solid ${C.border}`, cursor: 'pointer' }} />)}
        <input type="range" min={2} max={18} value={size} onChange={e => setSize(+e.target.value)} title="brush size" />
        <button onClick={undo} style={btnGhost}>Undo</button>
      </div>
      <canvas ref={canvasRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
        style={{ maxWidth: '100%', maxHeight: '70vh', background: '#fff', borderRadius: 10, cursor: 'crosshair', touchAction: 'none' }} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onCancel} style={{ ...btnGhost, background: 'var(--color-surface)', border: `1px solid ${C.border}` }}>Cancel</button>
        <button onClick={() => onSave(canvasRef.current.toDataURL('image/jpeg', 0.85))} style={btnPrimary}>Save annotation</button>
      </div>
    </div>
  );
}

// ── small pieces ─────────────────────────────────────────────────────────────
const Center = ({ children }) => <div style={{ minHeight: '100dvh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui' }}>{children}</div>;
const Section = ({ label, children }) => <div style={{ marginTop: 14 }}><div style={{ fontSize: 11.5, fontWeight: 700, color: C.faint, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>{children}</div>;
const Spinner = () => <span style={{ width: 18, height: 18, border: `2.5px solid ${C.border}`, borderTopColor: C.primary, borderRadius: '50%', display: 'inline-block', animation: 'kbspin 0.7s linear infinite' }} />;

// Themed grid background — a fine dot grid with hollow boxes + crosses at the
// coarser meet-points (SVG patterns, tuned subtle so cards/text stay high-contrast).
const GridBg = () => (
  <svg aria-hidden="true" width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', color: 'var(--color-border)', opacity: 0.7 }}>
    <defs>
      <pattern id="kb-dots" width="26" height="26" patternUnits="userSpaceOnUse">
        <circle cx="1" cy="1" r="1" fill="currentColor" />
      </pattern>
      <pattern id="kb-marks" width="104" height="104" patternUnits="userSpaceOnUse">
        <rect x="-3.5" y="-3.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
        <rect x="48.5" y="48.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.6" />
        <path d="M23 78 h6 M26 75 v6 M78 23 h6 M81 20 v6" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#kb-dots)" />
    <rect width="100%" height="100%" fill="url(#kb-marks)" />
  </svg>
);

function NameGate({ value, onChange, onSave }) {
  return (
    <Center>
      <div style={{ background: C.surface, borderRadius: 18, padding: 28, width: 'min(400px, 92vw)', boxShadow: '0 16px 48px rgba(20,30,50,.16)', textAlign: 'center' }}>
        <div style={{ width: 46, height: 46, borderRadius: 13, margin: '0 auto 14px', background: `linear-gradient(135deg, ${C.primary}, #7c3aed)` }} />
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>Welcome 👋</div>
        <div style={{ color: C.sub, fontSize: 14, marginBottom: 18 }}>Enter your name so others know who added what. No account needed.</div>
        <input autoFocus value={value} onChange={e => onChange(e.target.value)} onKeyDown={e => e.key === 'Enter' && onSave()} placeholder="Your name" style={{ ...inp, fontSize: 16, textAlign: 'center' }} />
        <button onClick={onSave} disabled={!value.trim()} style={{ ...btnPrimary, width: '100%', marginTop: 12, padding: 11, opacity: value.trim() ? 1 : 0.5 }}>Open board</button>
      </div>
    </Center>
  );
}

// Themed field: dark surface + light text in dark mode (never white-on-white).
const inp = { width: '100%', border: `1px solid ${C.border}`, borderRadius: 9, padding: '7px 11px', fontSize: 14, color: 'var(--color-text)', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', background: 'var(--color-surface)' };
const btnPrimary = { background: C.primary, color: '#fff', border: 'none', borderRadius: 9, padding: '7px 15px', fontWeight: 700, fontSize: 13, cursor: 'pointer' };
const btnGhost = { background: 'transparent', color: C.text, border: 'none', borderRadius: 9, padding: '6px 10px', fontSize: 13, cursor: 'pointer' };

if (typeof document !== 'undefined' && !document.getElementById('kbspin-style')) {
  const s = document.createElement('style'); s.id = 'kbspin-style'; s.textContent = '@keyframes kbspin{to{transform:rotate(360deg)}}'; document.head.appendChild(s);
}
