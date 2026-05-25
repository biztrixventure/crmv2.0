import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Pencil, Trash2, Check, Command, Slash } from 'lucide-react';

// Manage message shortcuts (stored locally per user via useMessageTemplates).
// Portaled to <body> so it stacks above the chat panel.
const TemplatesModal = ({ open, onClose, templates, onAdd, onUpdate, onDelete }) => {
  const [shortcut, setShortcut] = useState('');
  const [text, setText] = useState('');
  const [editId, setEditId] = useState(null);
  const [editShortcut, setEditShortcut] = useState('');
  const [editText, setEditText] = useState('');

  if (!open) return null;

  const submitAdd = () => {
    if (!text.trim()) return;
    onAdd(shortcut, text);
    setShortcut(''); setText('');
  };

  const startEdit = (t) => { setEditId(t.id); setEditShortcut(t.shortcut || ''); setEditText(t.text); };
  const saveEdit = () => {
    if (!editText.trim()) return;
    onUpdate(editId, { shortcut: editShortcut, text: editText });
    setEditId(null);
  };

  return createPortal(
    <div className="fixed inset-0 z-[2147483647] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(2px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl overflow-hidden flex flex-col max-h-[85vh]"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0" style={{ background: 'var(--gradient-sidebar)' }}>
          <span className="flex items-center gap-2 font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>
            <Command size={18} /> Message Shortcuts
          </span>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30"><X size={18} className="text-white" /></button>
        </div>

        <div className="px-5 py-3 flex-shrink-0 text-xs" style={{ color: 'var(--color-text-tertiary)', borderBottom: '1px solid var(--color-border)' }}>
          Type <span className="font-mono font-bold" style={{ color: 'var(--color-primary-600)' }}>/shortcut</span> in the message box to insert a template. Saved on this device only.
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          {templates.length === 0 ? (
            <p className="text-center text-sm py-8" style={{ color: 'var(--color-text-tertiary)' }}>No shortcuts yet. Add one below.</p>
          ) : templates.map(t => (
            <div key={t.id} className="rounded-xl p-3" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
              {editId === t.id ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Slash size={13} style={{ color: 'var(--color-text-tertiary)' }} />
                    <input value={editShortcut} onChange={e => setEditShortcut(e.target.value)} placeholder="shortcut"
                      className="input" style={{ height: 34 }} />
                  </div>
                  <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={2}
                    className="input resize-none" placeholder="Message text…" />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setEditId(null)} className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                      style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>Cancel</button>
                    <button onClick={saveEdit} disabled={!editText.trim()}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-50"
                      style={{ background: 'var(--gradient-sidebar)' }}><Check size={13} /> Save</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    {t.shortcut && (
                      <span className="inline-block text-xs font-mono font-bold px-1.5 py-0.5 rounded mb-1"
                        style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>/{t.shortcut}</span>
                    )}
                    <p className="text-sm whitespace-pre-wrap break-words" style={{ color: 'var(--color-text)' }}>{t.text}</p>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={() => startEdit(t)} className="p-1.5 rounded-lg hover:bg-bg-secondary" title="Edit" style={{ color: 'var(--color-text-secondary)' }}><Pencil size={14} /></button>
                    <button onClick={() => onDelete(t.id)} className="p-1.5 rounded-lg" title="Delete" style={{ color: '#ef4444' }}><Trash2 size={14} /></button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Add form */}
        <div className="px-4 py-3 flex-shrink-0 space-y-2" style={{ borderTop: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
          <div className="flex items-center gap-1.5">
            <Slash size={14} style={{ color: 'var(--color-text-tertiary)' }} />
            <input value={shortcut} onChange={e => setShortcut(e.target.value)} placeholder="shortcut (e.g. hi)"
              className="input" style={{ height: 36 }} />
          </div>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={2}
            className="input resize-none" placeholder="Message text…" />
          <button onClick={submitAdd} disabled={!text.trim()}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-bold text-sm text-white disabled:opacity-50"
            style={{ background: 'var(--gradient-sidebar)' }}>
            <Plus size={15} /> Add shortcut
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default TemplatesModal;
