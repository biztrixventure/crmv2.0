import { useState, useEffect, useCallback } from 'react';
import { Tag, Plus, X, Pencil, Trash2, Check, FolderTree } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../../api/client';

// Shared category system for Scripts + FAQs. `base` is 'faqs' or 'scripts'.
export function useCategories(base) {
  const [categories, setCategories] = useState([]);
  const reload = useCallback(() => {
    client.get(`${base}/categories`).then(r => setCategories(r.data.categories || [])).catch(() => {});
  }, [base]);
  useEffect(() => { reload(); }, [reload]);
  const create = async (name) => { const r = await client.post(`${base}/categories`, { name }); reload(); return r.data.category; };
  const rename = async (id, name) => { await client.put(`${base}/categories/${id}`, { name }); reload(); };
  const remove = async (id) => { await client.delete(`${base}/categories/${id}`); reload(); };
  return { categories, reload, create, rename, remove };
}

// Inline chips that show which categories an item is assigned to.
export function CategoryChips({ ids = [], categories, size = 'sm' }) {
  const byId = Object.fromEntries(categories.map(c => [c.id, c.name]));
  const names = ids.map(id => byId[id]).filter(Boolean);
  if (!names.length) return null;
  const pad = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5';
  return (
    <div className="flex flex-wrap gap-1">
      {names.map(n => (
        <span key={n} className={`${pad} rounded-md font-medium inline-flex items-center gap-0.5`}
          style={{ backgroundColor: 'var(--color-primary-50, #eef2ff)', color: 'var(--color-primary-700)' }}>
          <FolderTree size={9} /> {n}
        </span>
      ))}
    </div>
  );
}

// Multi-select for assigning categories on a create/edit form.
export function CategoryPicker({ categories, selected = [], onChange }) {
  const toggle = (id) => onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  if (!categories.length) return <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>No categories yet — add some from the “Manage” button on the list.</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {categories.map(c => {
        const on = selected.includes(c.id);
        return (
          <button type="button" key={c.id} onClick={() => toggle(c.id)}
            className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full transition-colors"
            style={{ backgroundColor: on ? 'var(--color-primary-100)' : 'var(--color-bg-secondary)', color: on ? 'var(--color-primary-700)' : 'var(--color-text-secondary)', border: `1px solid ${on ? 'var(--color-primary-300)' : 'var(--color-border)'}` }}>
            {on && <Check size={11} />} {c.name}
          </button>
        );
      })}
    </div>
  );
}

// Filter chips: All + each category + a Manage button.
export function CategoryFilterBar({ categories, value, onChange, onManage }) {
  const Chip = ({ id, label }) => (
    <button onClick={() => onChange(id)} className="text-xs font-semibold px-2.5 py-1 rounded-full transition-colors"
      style={{ backgroundColor: value === id ? 'var(--color-primary-600)' : 'var(--color-bg-secondary)', color: value === id ? 'white' : 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>{label}</button>
  );
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Chip id="" label="All categories" />
      {categories.map(c => <Chip key={c.id} id={c.id} label={c.name} />)}
      {onManage && (
        <button onClick={onManage} className="text-xs font-semibold px-2.5 py-1 rounded-full inline-flex items-center gap-1"
          style={{ border: '1px dashed var(--color-border)', color: 'var(--color-text-secondary)' }}>
          <FolderTree size={12} /> Manage categories
        </button>
      )}
    </div>
  );
}

// Create / rename / delete categories.
export function CategoryManagerModal({ title, hook, onClose }) {
  const { categories, create, rename, remove } = hook;
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(null);   // { id, name }
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try { await create(name.trim()); setName(''); }
    catch (e) { toast.error(e.response?.data?.error || 'Could not add category'); }
    finally { setBusy(false); }
  };
  const saveEdit = async () => {
    if (!editing.name.trim()) return;
    setBusy(true);
    try { await rename(editing.id, editing.name.trim()); setEditing(null); }
    catch { toast.error('Could not rename'); }
    finally { setBusy(false); }
  };
  const del = async (id) => {
    if (!window.confirm('Delete this category? Items keep their other categories.')) return;
    try { await remove(id); } catch { toast.error('Could not delete'); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}>
        <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <h3 className="font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}><FolderTree size={17} style={{ color: 'var(--color-primary-600)' }} /> {title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-bg-secondary"><X size={17} style={{ color: 'var(--color-text-secondary)' }} /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex gap-2">
            <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }} placeholder="New category name…" className="input flex-1" />
            <button onClick={add} disabled={busy || !name.trim()} className="px-3 rounded-lg text-white font-bold inline-flex items-center disabled:opacity-50" style={{ background: 'var(--gradient-sidebar)' }}><Plus size={16} /></button>
          </div>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {categories.length === 0 ? (
              <p className="text-sm text-center py-4" style={{ color: 'var(--color-text-tertiary)' }}>No categories yet.</p>
            ) : categories.map(c => (
              <div key={c.id} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                {editing?.id === c.id ? (
                  <>
                    <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') saveEdit(); }} className="input flex-1 py-1" autoFocus />
                    <button onClick={saveEdit} className="p-1 rounded" style={{ color: 'var(--color-success-600)' }}><Check size={16} /></button>
                    <button onClick={() => setEditing(null)} className="p-1 rounded" style={{ color: 'var(--color-text-tertiary)' }}><X size={16} /></button>
                  </>
                ) : (
                  <>
                    <Tag size={13} style={{ color: 'var(--color-primary-600)' }} />
                    <span className="text-sm flex-1" style={{ color: 'var(--color-text)' }}>{c.name}</span>
                    <button onClick={() => setEditing({ id: c.id, name: c.name })} className="p-1 rounded" style={{ color: 'var(--color-primary-500)' }}><Pencil size={14} /></button>
                    <button onClick={() => del(c.id)} className="p-1 rounded" style={{ color: 'var(--color-error-500)' }}><Trash2 size={14} /></button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
