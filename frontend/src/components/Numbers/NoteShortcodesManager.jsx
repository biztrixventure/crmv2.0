import { useState, useEffect, useCallback } from 'react';
import { Slash, Plus, Pencil, Trash2, Check, Loader2, StickyNote, Globe } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';

const inp = { background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)', borderRadius: 8, padding: '6px 10px', fontSize: 13, width: '100%' };

// Curate the company's "/code → note" shortcuts (server-side, company-scoped).
// Superadmin edits create GLOBAL rows; managers edit their company's set.
export default function NoteShortcodesManager() {
  const { user } = useAuth();
  const isSuper = user?.role === 'superadmin';
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [code, setCode] = useState(''); const [text, setText] = useState(''); const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState(null); const [eCode, setECode] = useState(''); const [eText, setEText] = useState('');

  // Only company/global rows here — personal (owner_user_id) shortcuts are
  // managed by each user from the PIP widget, not this curation screen.
  const load = useCallback(() => { setLoading(true); client.get('note-shortcodes').then(r => setRows((r.data.shortcodes || []).filter(s => !s.owner_user_id))).catch(() => {}).finally(() => setLoading(false)); }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!code.trim() || !text.trim()) return toast.error('Code and text are required');
    setSaving(true);
    try { await client.post('note-shortcodes', { code: code.trim(), text: text.trim() }); setCode(''); setText(''); load(); toast.success('Shortcut added'); }
    catch (e) { toast.error(e.response?.data?.error || 'Could not add'); } finally { setSaving(false); }
  };
  const save = async () => {
    if (!eText.trim()) return;
    try { await client.put(`note-shortcodes/${editId}`, { code: eCode.trim(), text: eText.trim() }); setEditId(null); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'Could not save'); }
  };
  const del = async (id) => { if (!window.confirm('Delete this shortcut?')) return; try { await client.delete(`note-shortcodes/${id}`); load(); } catch (e) { toast.error(e.response?.data?.error || 'Could not delete'); } };
  const editable = (r) => isSuper || !!r.company_id;   // managers can't touch global rows

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center gap-2">
        <StickyNote size={18} style={{ color: 'var(--color-primary-600)' }} />
        <h2 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>Note Shortcuts</h2>
      </div>
      <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        Fronters type <span className="font-mono font-bold" style={{ color: 'var(--color-primary-600)' }}>/code</span> in a number's note to insert the full text.
        {isSuper ? ' New shortcuts you add are GLOBAL (all companies).' : ' New shortcuts apply to your company.'}
      </p>

      <div className="p-3 rounded-xl flex flex-col gap-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-2">
          <Slash size={14} style={{ color: 'var(--color-text-tertiary)' }} />
          <input value={code} onChange={e => setCode(e.target.value)} placeholder="code (e.g. nc)" style={inp} />
        </div>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={2} placeholder="Full note text…" style={{ ...inp, resize: 'vertical' }} />
        <button onClick={add} disabled={saving || !code.trim() || !text.trim()} className="self-end text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 disabled:opacity-50" style={{ background: 'var(--gradient-sidebar)', color: 'var(--color-text-inverse)' }}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add
        </button>
      </div>

      {loading ? <div className="text-center py-8"><Loader2 className="animate-spin inline" style={{ color: 'var(--color-text-tertiary)' }} /></div>
        : rows.length === 0 ? <div className="text-center py-8 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No shortcuts yet.</div>
          : <div className="space-y-1.5">
            {rows.map(r => (
              <div key={r.id} className="p-2.5 rounded-xl flex items-start gap-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                {editId === r.id ? (
                  <div className="flex-1 space-y-2">
                    <input value={eCode} onChange={e => setECode(e.target.value)} style={inp} />
                    <textarea value={eText} onChange={e => setEText(e.target.value)} rows={2} style={{ ...inp, resize: 'vertical' }} />
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setEditId(null)} className="text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ color: 'var(--color-text-secondary)' }}>Cancel</button>
                      <button onClick={save} className="text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1" style={{ background: 'var(--gradient-sidebar)', color: 'var(--color-text-inverse)' }}><Check size={13} /> Save</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-bold px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-primary-600)' }}>/{r.code}</span>
                        {!r.company_id && <span className="text-[10px] font-bold flex items-center gap-0.5" style={{ color: 'var(--color-text-tertiary)' }}><Globe size={10} /> global</span>}
                      </div>
                      <p className="text-sm mt-1 whitespace-pre-wrap break-words" style={{ color: 'var(--color-text)' }}>{r.text}</p>
                    </div>
                    {editable(r) && (
                      <div className="flex gap-1 flex-shrink-0">
                        <button onClick={() => { setEditId(r.id); setECode(r.code); setEText(r.text); }} className="p-1.5 rounded-lg" title="Edit" style={{ color: 'var(--color-text-secondary)' }}><Pencil size={14} /></button>
                        <button onClick={() => del(r.id)} className="p-1.5 rounded-lg" title="Delete" style={{ color: 'var(--color-error-600)' }}><Trash2 size={14} /></button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>}
    </div>
  );
}
