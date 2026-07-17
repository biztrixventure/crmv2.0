// ============================================================================
// KanbanBoard — PUBLIC, no-login task board (kan.bn-style). Reached at
// /board/:token. The share token in the URL is the only credential. On first
// visit we ask the visitor's name (kept in localStorage) and stamp it on what
// they create. Anyone with the link can add lists, cards, tags, images, and
// annotate screenshots. Self-contained: no CRM auth/theme context.
// ============================================================================
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001/api' });

const C = {
  bg: '#f4f5f7', surface: '#ffffff', border: '#e2e4e9', text: '#1a2233',
  sub: '#6b7280', primary: '#2563eb', danger: '#dc2626', chip: '#eef2ff', chipText: '#3730a3',
};
const TAG_COLORS = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777'];
const tagColor = (t) => TAG_COLORS[[...String(t)].reduce((a, c) => a + c.charCodeAt(0), 0) % TAG_COLORS.length];

export default function KanbanBoard() {
  const { token } = useParams();
  const [name, setName] = useState(() => localStorage.getItem('kanban_name') || '');
  const [nameInput, setNameInput] = useState('');
  const [data, setData] = useState(null);        // { board, columns, cards }
  const [err, setErr] = useState('');
  const [openCardId, setOpenCard] = useState(null);
  const [newCol, setNewCol] = useState('');
  const [addingCol, setAddingCol] = useState(false);
  const dragCard = useRef(null);                  // { id }
  const modalOpen = useRef(false);

  const load = useCallback(async () => {
    try { const r = await api.get(`kanban/b/${token}`); setData(r.data); setErr(''); }
    catch (e) { setErr(e.response?.data?.error || 'Board not found'); }
  }, [token]);

  useEffect(() => { load(); }, [load]);
  // Light polling so a few collaborators see each other's changes. Pause while a
  // card modal is open so we never clobber an in-progress edit.
  useEffect(() => {
    const t = setInterval(() => { if (!modalOpen.current) load(); }, 5000);
    return () => clearInterval(t);
  }, [load]);

  const saveName = () => {
    const n = nameInput.trim().slice(0, 60);
    if (!n) return;
    localStorage.setItem('kanban_name', n); setName(n);
  };

  // ── optimistic helpers ──
  const patchLocal = (cards) => setData(d => ({ ...d, cards }));

  const addCard = async (columnId, title) => {
    if (!title.trim()) return;
    try {
      const r = await api.post(`kanban/b/${token}/cards`, { column_id: columnId, title, author_name: name });
      setData(d => ({ ...d, cards: [...d.cards, r.data.card] }));
    } catch { load(); }
  };
  const addColumn = async () => {
    if (!newCol.trim()) return;
    try { const r = await api.post(`kanban/b/${token}/columns`, { title: newCol }); setData(d => ({ ...d, columns: [...d.columns, r.data.column] })); setNewCol(''); setAddingCol(false); }
    catch { load(); }
  };
  const renameColumn = async (col, title) => {
    setData(d => ({ ...d, columns: d.columns.map(c => c.id === col.id ? { ...c, title } : c) }));
    try { await api.patch(`kanban/b/${token}/columns/${col.id}`, { title }); } catch { load(); }
  };
  const deleteColumn = async (col) => {
    if (!window.confirm(`Delete list "${col.title}" and its cards?`)) return;
    setData(d => ({ ...d, columns: d.columns.filter(c => c.id !== col.id), cards: d.cards.filter(c => c.column_id !== col.id) }));
    try { await api.delete(`kanban/b/${token}/columns/${col.id}`); } catch { load(); }
  };

  // ── drag & drop (native) ──
  const onDropInColumn = async (columnId, beforeCardId) => {
    const dragged = dragCard.current; dragCard.current = null;
    if (!dragged) return;
    const cards = [...data.cards];
    const moving = cards.find(c => c.id === dragged.id);
    if (!moving) return;
    const rest = cards.filter(c => c.id !== dragged.id);
    const inCol = rest.filter(c => c.column_id === columnId).sort((a, b) => a.position - b.position);
    const idx = beforeCardId ? inCol.findIndex(c => c.id === beforeCardId) : inCol.length;
    inCol.splice(idx < 0 ? inCol.length : idx, 0, { ...moving, column_id: columnId });
    const moves = inCol.map((c, i) => ({ id: c.id, column_id: columnId, position: i }));
    // apply locally
    const byId = Object.fromEntries(moves.map(m => [m.id, m]));
    patchLocal(cards.map(c => byId[c.id] ? { ...c, column_id: columnId, position: byId[c.id].position } : c));
    try { await api.put(`kanban/b/${token}/reorder`, { moves }); } catch { load(); }
  };

  if (err) return <Center><div style={{ color: C.danger, fontWeight: 600 }}>{err}</div></Center>;
  if (!name) return <NameGate value={nameInput} onChange={setNameInput} onSave={saveName} />;
  if (!data) return <Center><div style={{ color: C.sub }}>Loading board…</div></Center>;

  const cardsOf = (colId) => data.cards.filter(c => c.column_id === colId).sort((a, b) => a.position - b.position);
  const openCard = data.cards.find(c => c.id === openCardId) || null;

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: 'system-ui, sans-serif', color: C.text }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', background: C.surface, borderBottom: `1px solid ${C.border}`, position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ fontWeight: 800, fontSize: 18 }}>{data.board.title}</div>
        <div style={{ marginLeft: 'auto', fontSize: 13, color: C.sub }}>You are <b style={{ color: C.text }}>{name}</b>
          <button onClick={() => { localStorage.removeItem('kanban_name'); setName(''); setNameInput(name); }} style={{ marginLeft: 8, fontSize: 12, color: C.primary, background: 'none', border: 'none', cursor: 'pointer' }}>change</button>
        </div>
      </header>

      <div style={{ display: 'flex', gap: 14, padding: 20, alignItems: 'flex-start', overflowX: 'auto', minHeight: 'calc(100vh - 57px)' }}>
        {data.columns.sort((a, b) => a.position - b.position).map(col => (
          <Column key={col.id} col={col} cards={cardsOf(col.id)}
            onAddCard={addCard} onRename={renameColumn} onDelete={deleteColumn}
            onOpenCard={setOpenCard} dragCard={dragCard} onDrop={onDropInColumn} />
        ))}

        <div style={{ width: 280, flexShrink: 0 }}>
          {addingCol ? (
            <div style={{ background: C.surface, borderRadius: 12, padding: 10, border: `1px solid ${C.border}` }}>
              <input autoFocus value={newCol} onChange={e => setNewCol(e.target.value)} onKeyDown={e => e.key === 'Enter' && addColumn()}
                placeholder="List title…" style={inp} />
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button onClick={addColumn} style={btnPrimary}>Add list</button>
                <button onClick={() => { setAddingCol(false); setNewCol(''); }} style={btnGhost}>Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAddingCol(true)} style={{ ...btnGhost, width: '100%', padding: '10px', background: 'rgba(255,255,255,0.6)', border: `1px dashed ${C.border}` }}>+ Add another list</button>
          )}
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
function Column({ col, cards, onAddCard, onRename, onDelete, onOpenCard, dragCard, onDrop }) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(col.title);
  const [over, setOver] = useState(false);
  return (
    <div style={{ width: 280, flexShrink: 0, background: '#ebecf0', borderRadius: 12, padding: 8, maxHeight: 'calc(100vh - 97px)', display: 'flex', flexDirection: 'column' }}
      onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); onDrop(col.id, null); }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px 8px' }}>
        {editing ? (
          <input autoFocus value={name} onChange={e => setName(e.target.value)} onBlur={() => { setEditing(false); onRename(col, name); }} onKeyDown={e => e.key === 'Enter' && (setEditing(false), onRename(col, name))} style={{ ...inp, fontWeight: 700 }} />
        ) : (
          <div onClick={() => setEditing(true)} style={{ fontWeight: 700, fontSize: 14, flex: 1, cursor: 'text' }}>{col.title} <span style={{ color: C.sub, fontWeight: 500 }}>{cards.length}</span></div>
        )}
        <button onClick={() => onDelete(col)} title="Delete list" style={{ background: 'none', border: 'none', color: C.sub, cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
      </div>

      <div style={{ overflowY: 'auto', flex: 1, minHeight: 4, outline: over ? `2px dashed ${C.primary}` : 'none', borderRadius: 8 }}>
        {cards.map(card => (
          <div key={card.id} draggable onDragStart={() => { dragCard.current = { id: card.id }; }}
            onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={e => { e.preventDefault(); e.stopPropagation(); onDrop(col.id, card.id); }}
            onClick={() => onOpenCard(card.id)}
            style={{ background: C.surface, borderRadius: 8, padding: '8px 10px', marginBottom: 6, boxShadow: '0 1px 2px rgba(0,0,0,0.08)', cursor: 'pointer', border: `1px solid ${C.border}` }}>
            {!!(card.tags || []).length && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 5 }}>
                {card.tags.map(t => <span key={t} style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 6, background: tagColor(t) + '22', color: tagColor(t) }}>{t}</span>)}
              </div>
            )}
            <div style={{ fontSize: 13.5, lineHeight: 1.35, whiteSpace: 'pre-wrap' }}>{card.title}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 11, color: C.sub }}>
              {card.attachment_count > 0 && <span title="images">🖼 {card.attachment_count}</span>}
              {card.description && <span title="has description">≡</span>}
              {card.created_by_name && <span style={{ marginLeft: 'auto' }}>{card.created_by_name}</span>}
            </div>
          </div>
        ))}
      </div>

      {adding ? (
        <div style={{ marginTop: 6 }}>
          <textarea autoFocus value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onAddCard(col.id, title); setTitle(''); } }}
            placeholder="Task title… (Enter to add)" rows={2} style={{ ...inp, resize: 'vertical' }} />
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button onClick={() => { onAddCard(col.id, title); setTitle(''); }} style={btnPrimary}>Add card</button>
            <button onClick={() => { setAdding(false); setTitle(''); }} style={btnGhost}>Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} style={{ ...btnGhost, marginTop: 6, textAlign: 'left', color: C.sub }}>+ Add a card</button>
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
  const [annotating, setAnnotating] = useState(null);   // attachment being annotated
  const fileRef = useRef(null);

  useEffect(() => { modalOpen.current = true; return () => { modalOpen.current = false; }; }, [modalOpen]);
  useEffect(() => { api.get(`kanban/b/${token}/cards/${card.id}/attachments`).then(r => setAtts(r.data.attachments || [])).catch(() => setAtts([])); }, [token, card.id]);

  const saveField = async (patch) => { onChange(patch); try { await api.patch(`kanban/b/${token}/cards/${card.id}`, patch); } catch {} };
  const addTag = () => { const t = tagInput.trim().slice(0, 40); if (!t || tags.includes(t)) { setTagInput(''); return; } const next = [...tags, t]; setTags(next); setTagInput(''); saveField({ tags: next }); };
  const removeTag = (t) => { const next = tags.filter(x => x !== t); setTags(next); saveField({ tags: next }); };

  const onFiles = async (files) => {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      const dataUrl = await fileToDataUrl(f);
      try { const r = await api.post(`kanban/b/${token}/cards/${card.id}/attachments`, { data_url: dataUrl, name: f.name, author_name: name }); setAtts(a => [...(a || []), r.data.attachment]); onChange({ attachment_count: (card.attachment_count || 0) + 1 }); }
      catch (e) { alert(e.response?.data?.error || 'Upload failed'); }
    }
  };
  const onPaste = (e) => { const imgs = [...(e.clipboardData?.items || [])].filter(i => i.type.startsWith('image/')).map(i => i.getAsFile()).filter(Boolean); if (imgs.length) { e.preventDefault(); onFiles(imgs); } };
  const delAtt = async (a) => { if (!window.confirm('Delete this image?')) return; setAtts(list => list.filter(x => x.id !== a.id)); onChange({ attachment_count: Math.max(0, (card.attachment_count || 1) - 1) }); try { await api.delete(`kanban/b/${token}/attachments/${a.id}`); } catch {} };
  const saveAnnotation = async (dataUrl) => {
    try { await api.put(`kanban/b/${token}/attachments/${annotating.id}`, { data_url: dataUrl }); setAtts(list => list.map(x => x.id === annotating.id ? { ...x, data_url: dataUrl } : x)); }
    catch (e) { alert(e.response?.data?.error || 'Save failed'); }
    setAnnotating(null);
  };
  const del = async () => { if (!window.confirm('Delete this card?')) return; try { await api.delete(`kanban/b/${token}/cards/${card.id}`); } catch {} onDelete(); };

  return (
    <div onClick={onClose} onPaste={onPaste} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 50, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 16px', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.surface, borderRadius: 14, width: 'min(680px, 96vw)', padding: 18, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <textarea value={title} onChange={e => setTitle(e.target.value)} onBlur={() => title.trim() && title !== card.title && saveField({ title })} rows={1}
            style={{ ...inp, fontSize: 17, fontWeight: 700, resize: 'none', flex: 1 }} />
          <button onClick={onClose} style={{ ...btnGhost, fontSize: 20 }}>×</button>
        </div>
        <div style={{ fontSize: 12, color: C.sub, margin: '2px 2px 12px' }}>Added by {card.created_by_name || 'someone'}</div>

        {/* tags */}
        <Section label="Tags">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {tags.map(t => <span key={t} style={{ fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: tagColor(t) + '22', color: tagColor(t), display: 'inline-flex', gap: 6 }}>{t}<span onClick={() => removeTag(t)} style={{ cursor: 'pointer', opacity: 0.7 }}>×</span></span>)}
            <input value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTag()} placeholder="+ tag" style={{ ...inp, width: 100, padding: '3px 8px' }} />
          </div>
        </Section>

        {/* description */}
        <Section label="Description — what to do / changes needed">
          <textarea value={desc} onChange={e => setDesc(e.target.value)} onBlur={() => desc !== (card.description || '') && saveField({ description: desc })}
            placeholder="Explain the task, the change, steps…" rows={5} style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }} />
        </Section>

        {/* images */}
        <Section label="Images & screenshots (paste, or add — then annotate)">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {(atts || []).map(a => (
              <div key={a.id} style={{ position: 'relative', width: 140 }}>
                <img src={a.data_url} alt={a.name || ''} style={{ width: 140, height: 100, objectFit: 'cover', borderRadius: 8, border: `1px solid ${C.border}`, cursor: 'zoom-in' }} onClick={() => window.open()?.document.write(`<img src="${a.data_url}" style="max-width:100%"/>`)} />
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <button onClick={() => setAnnotating(a)} style={{ ...btnGhost, flex: 1, fontSize: 11, padding: '3px 6px' }}>✏ Annotate</button>
                  <button onClick={() => delAtt(a)} style={{ ...btnGhost, fontSize: 11, padding: '3px 6px', color: C.danger }}>Delete</button>
                </div>
              </div>
            ))}
            <button onClick={() => fileRef.current?.click()} style={{ width: 140, height: 100, borderRadius: 8, border: `1px dashed ${C.border}`, background: C.bg, color: C.sub, cursor: 'pointer', fontSize: 13 }}>+ Add / paste image</button>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => { onFiles([...e.target.files]); e.target.value = ''; }} />
          </div>
        </Section>

        <div style={{ display: 'flex', marginTop: 14 }}>
          <button onClick={del} style={{ ...btnGhost, color: C.danger }}>Delete card</button>
          <button onClick={onClose} style={{ ...btnPrimary, marginLeft: 'auto' }}>Done</button>
        </div>
      </div>

      {annotating && <Annotator src={annotating.data_url} onCancel={() => setAnnotating(null)} onSave={saveAnnotation} />}
    </div>
  );
}

// ── image annotator (draw + text over a screenshot, flatten to PNG) ──────────
function Annotator({ src, onSave, onCancel }) {
  const canvasRef = useRef(null);
  const [color, setColor] = useState('#dc2626');
  const [tool, setTool] = useState('pen');       // pen | rect | arrow | text
  const [size, setSize] = useState(4);
  const draw = useRef({ active: false, x0: 0, y0: 0, snapshot: null });
  const undoStack = useRef([]);

  useEffect(() => {
    const canvas = canvasRef.current; const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
      const maxW = Math.min(900, window.innerWidth - 80);
      const scale = Math.min(1, maxW / img.width);
      canvas.width = img.width * scale; canvas.height = img.height * scale;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = src;
  }, [src]);

  const pos = (e) => { const r = canvasRef.current.getBoundingClientRect(); const t = e.touches?.[0] || e; return { x: (t.clientX - r.left) * (canvasRef.current.width / r.width), y: (t.clientY - r.top) * (canvasRef.current.height / r.height) }; };
  const start = (e) => {
    if (tool === 'text') {
      const p = pos(e); const txt = window.prompt('Text:'); if (!txt) return;
      const ctx = canvasRef.current.getContext('2d'); pushUndo(); ctx.fillStyle = color; ctx.font = `bold ${size * 6}px system-ui`; ctx.fillText(txt, p.x, p.y); return;
    }
    const p = pos(e); pushUndo();
    draw.current = { active: true, x0: p.x, y0: p.y, snapshot: canvasRef.current.getContext('2d').getImageData(0, 0, canvasRef.current.width, canvasRef.current.height) };
    const ctx = canvasRef.current.getContext('2d'); ctx.beginPath(); ctx.moveTo(p.x, p.y);
  };
  const move = (e) => {
    if (!draw.current.active) return; e.preventDefault();
    const p = pos(e); const ctx = canvasRef.current.getContext('2d');
    ctx.strokeStyle = color; ctx.lineWidth = size; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (tool === 'pen') { ctx.lineTo(p.x, p.y); ctx.stroke(); }
    else { ctx.putImageData(draw.current.snapshot, 0, 0); const { x0, y0 } = draw.current; if (tool === 'rect') { ctx.strokeRect(x0, y0, p.x - x0, p.y - y0); } else if (tool === 'arrow') { arrow(ctx, x0, y0, p.x, p.y); } }
  };
  const end = () => { draw.current.active = false; };
  const arrow = (ctx, x0, y0, x1, y1) => { const a = Math.atan2(y1 - y0, x1 - x0), h = 12 + size * 2; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - h * Math.cos(a - 0.4), y1 - h * Math.sin(a - 0.4)); ctx.lineTo(x1 - h * Math.cos(a + 0.4), y1 - h * Math.sin(a + 0.4)); ctx.closePath(); ctx.fillStyle = color; ctx.fill(); };
  const pushUndo = () => { const c = canvasRef.current; undoStack.current.push(c.getContext('2d').getImageData(0, 0, c.width, c.height)); if (undoStack.current.length > 30) undoStack.current.shift(); };
  const undo = () => { const s = undoStack.current.pop(); if (s) canvasRef.current.getContext('2d').putImageData(s, 0, 0); };

  const TOOLS = [['pen', '✏'], ['rect', '▭'], ['arrow', '↗'], ['text', 'T']];
  return (
    <div onClick={e => e.stopPropagation()} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 16 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: C.surface, padding: '8px 12px', borderRadius: 10, flexWrap: 'wrap' }}>
        {TOOLS.map(([k, ic]) => <button key={k} onClick={() => setTool(k)} style={{ ...btnGhost, background: tool === k ? C.primary : '#eee', color: tool === k ? '#fff' : C.text, fontWeight: 700, minWidth: 34 }}>{ic}</button>)}
        {['#dc2626', '#2563eb', '#059669', '#d97706', '#000000', '#ffffff'].map(c => <button key={c} onClick={() => setColor(c)} style={{ width: 24, height: 24, borderRadius: 6, background: c, border: color === c ? '3px solid #111' : `1px solid ${C.border}`, cursor: 'pointer' }} />)}
        <input type="range" min={2} max={16} value={size} onChange={e => setSize(+e.target.value)} title="brush size" />
        <button onClick={undo} style={btnGhost}>Undo</button>
      </div>
      <canvas ref={canvasRef}
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end}
        style={{ maxWidth: '100%', maxHeight: '72vh', background: '#fff', borderRadius: 8, cursor: 'crosshair', touchAction: 'none' }} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onCancel} style={{ ...btnGhost, background: '#fff' }}>Cancel</button>
        <button onClick={() => onSave(canvasRef.current.toDataURL('image/png'))} style={btnPrimary}>Save annotation</button>
      </div>
    </div>
  );
}

// ── small pieces ─────────────────────────────────────────────────────────────
const Center = ({ children }) => <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui' }}>{children}</div>;
const Section = ({ label, children }) => <div style={{ marginTop: 14 }}><div style={{ fontSize: 12, fontWeight: 700, color: C.sub, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>{children}</div>;

function NameGate({ value, onChange, onSave }) {
  return (
    <Center>
      <div style={{ background: C.surface, borderRadius: 16, padding: 28, width: 'min(400px, 92vw)', boxShadow: '0 10px 40px rgba(0,0,0,0.15)', textAlign: 'center' }}>
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>Welcome 👋</div>
        <div style={{ color: C.sub, fontSize: 14, marginBottom: 18 }}>Enter your name so others know who added what. No account needed.</div>
        <input autoFocus value={value} onChange={e => onChange(e.target.value)} onKeyDown={e => e.key === 'Enter' && onSave()} placeholder="Your name" style={{ ...inp, fontSize: 16, textAlign: 'center' }} />
        <button onClick={onSave} disabled={!value.trim()} style={{ ...btnPrimary, width: '100%', marginTop: 12, padding: 10, opacity: value.trim() ? 1 : 0.5 }}>Open board</button>
      </div>
    </Center>
  );
}

async function fileToDataUrl(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); }); }

const inp = { width: '100%', border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 10px', fontSize: 14, color: C.text, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', background: '#fff' };
const btnPrimary = { background: C.primary, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer' };
const btnGhost = { background: 'transparent', color: C.text, border: 'none', borderRadius: 8, padding: '6px 10px', fontSize: 13, cursor: 'pointer' };
