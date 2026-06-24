import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Eye, EyeOff, ArrowUp, ArrowDown, ClipboardCheck, Check, X, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../UI';
import client from '../../api/client';

// Compliance CRUD for the closers' call-checklist questions. Add / edit / hide /
// delete / reorder. Closers see the active ones in their floating panel.
export default function CallQuestionsManager() {
  const [items, setItems]     = useState([]);
  const [text, setText]       = useState('');
  const [editing, setEditing] = useState(null);   // { id, text }
  const [busy, setBusy]       = useState(false);

  const load = useCallback(() => {
    client.get('call-checklist', { params: { all: 1 } })
      .then(r => setItems(r.data.questions || [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try { await client.post('call-checklist', { text: text.trim(), sort_order: items.length }); setText(''); toast.success('Question added'); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed to add'); }
    finally { setBusy(false); }
  };
  const saveEdit = async () => {
    if (!editing?.text.trim()) return;
    try { await client.put(`call-checklist/${editing.id}`, { text: editing.text.trim() }); setEditing(null); load(); }
    catch { toast.error('Failed'); }
  };
  const toggle = async (q) => { try { await client.put(`call-checklist/${q.id}`, { is_active: !q.is_active }); load(); } catch { toast.error('Failed'); } };
  const del = async (q) => { if (!window.confirm('Delete this question?')) return; try { await client.delete(`call-checklist/${q.id}`); load(); } catch { toast.error('Failed'); } };
  const move = async (q, dir) => {
    const idx = items.findIndex(x => x.id === q.id);
    const swap = items[idx + dir];
    if (!swap) return;
    try {
      await Promise.all([
        client.put(`call-checklist/${q.id}`,    { sort_order: swap.sort_order }),
        client.put(`call-checklist/${swap.id}`, { sort_order: q.sort_order }),
      ]);
      load();
    } catch { toast.error('Failed'); }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl p-6 flex items-center gap-3" style={{ background: 'var(--gradient-sidebar)' }}>
        <ClipboardCheck size={22} className="text-white flex-shrink-0" />
        <div>
          <h2 className="text-xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>Call Checklist Questions</h2>
          <p className="text-sm text-white/80">Questions closers tick off during a call in a floating panel. They see the active ones; nothing is logged.</p>
        </div>
      </div>

      <div className="rounded-2xl p-4 flex gap-2" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="Add a question…" className="input flex-1" />
        <Button onClick={add} disabled={busy}><Plus size={16} /> Add</Button>
      </div>

      <div className="space-y-2">
        {items.length === 0 ? (
          <p className="text-sm text-center py-8" style={{ color: 'var(--color-text-tertiary)' }}>No questions yet. Add the first one above.</p>
        ) : items.map((q, i) => (
          <div key={q.id} className="rounded-xl p-3 flex items-center gap-2"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', opacity: q.is_active ? 1 : 0.6 }}>
            <div className="flex flex-col" style={{ color: 'var(--color-text-tertiary)' }}>
              <button onClick={() => move(q, -1)} disabled={i === 0} title="Move up" className="disabled:opacity-25 hover:text-primary-600"><ArrowUp size={14} /></button>
              <button onClick={() => move(q, 1)} disabled={i === items.length - 1} title="Move down" className="disabled:opacity-25 hover:text-primary-600"><ArrowDown size={14} /></button>
            </div>

            {editing?.id === q.id ? (
              <input value={editing.text} onChange={e => setEditing({ ...editing, text: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(null); }}
                className="input flex-1" autoFocus />
            ) : (
              <span className="text-sm flex-1" style={{ color: 'var(--color-text)' }}>
                {q.text}
                {!q.is_active && <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}>hidden</span>}
              </span>
            )}

            {editing?.id === q.id ? (
              <>
                <button onClick={saveEdit} title="Save" className="p-1.5 rounded-lg" style={{ color: '#059669' }}><Check size={16} /></button>
                <button onClick={() => setEditing(null)} title="Cancel" className="p-1.5 rounded-lg" style={{ color: 'var(--color-text-tertiary)' }}><X size={16} /></button>
              </>
            ) : (
              <>
                <button onClick={() => setEditing({ id: q.id, text: q.text })} title="Edit" className="p-1.5 rounded-lg" style={{ color: 'var(--color-text-secondary)' }}><Pencil size={15} /></button>
                <button onClick={() => toggle(q)} title={q.is_active ? 'Hide from closers' : 'Show to closers'} className="p-1.5 rounded-lg" style={{ color: 'var(--color-text-secondary)' }}>{q.is_active ? <Eye size={15} /> : <EyeOff size={15} />}</button>
                <button onClick={() => del(q)} title="Delete" className="p-1.5 rounded-lg" style={{ color: '#b91c1c' }}><Trash2 size={15} /></button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
