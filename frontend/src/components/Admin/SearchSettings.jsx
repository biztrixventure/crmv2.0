import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, Check, X, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';

// Superadmin search tooling: manage synonym groups (query expansion) that make
// FAQ/Script search match related terms.
const SearchSettings = ({ embedded = false }) => (
  <div className={`space-y-5 ${embedded ? '' : 'animate-fade-in max-w-5xl'}`}>
    {!embedded && (
      <div className="rounded-2xl p-6 relative overflow-hidden" style={{ background: 'var(--gradient-sidebar)' }}>
        <div className="relative z-10 flex items-center gap-2.5">
          <Search size={22} className="text-white" />
          <div>
            <h2 className="text-2xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>Search Settings</h2>
            <p className="text-sm text-white/80">Tune FAQ &amp; Script search relevance with synonyms.</p>
          </div>
        </div>
      </div>
    )}
    <SynonymsManager />
  </div>
);

// ── Synonyms ────────────────────────────────────────────────────────────────
const SynonymsManager = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [term, setTerm] = useState('');
  const [syns, setSyns] = useState('');
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await client.get('search/synonyms'); setRows(r.data.synonyms || []); }
    catch { /* table maybe not migrated */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!term.trim()) return;
    setBusy(true);
    try { await client.post('search/synonyms', { term: term.trim(), synonyms: syns.trim() }); setTerm(''); setSyns(''); toast.success('Synonym group added'); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'Could not add'); } finally { setBusy(false); }
  };
  const saveEdit = async (id, t, s) => {
    try { await client.put(`search/synonyms/${id}`, { term: t, synonyms: s }); setEditing(null); toast.success('Saved'); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'Could not save'); }
  };
  const del = async (id) => { if (!window.confirm('Delete this synonym group?')) return; try { await client.delete(`search/synonyms/${id}`); load(); } catch { toast.error('Could not delete'); } };

  return (
    <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <p className="text-sm mb-3" style={{ color: 'var(--color-text-secondary)' }}>
        Group interchangeable terms so a search for one matches the others. Example: term <code>cancel</code> with synonyms <code>refund, terminate, stop</code>. Matching is two-way.
      </p>

      {/* Add */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <input value={term} onChange={e => setTerm(e.target.value)} placeholder="Term (e.g. cancel)" className="input" style={{ maxWidth: 200 }} />
        <input value={syns} onChange={e => setSyns(e.target.value)} placeholder="Synonyms, comma-separated (refund, terminate)" className="input flex-1" />
        <button onClick={add} disabled={busy || !term.trim()}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-50" style={{ background: 'var(--gradient-sidebar)' }}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Add
        </button>
      </div>

      {loading ? <div className="flex justify-center py-8"><Loader2 className="animate-spin" style={{ color: 'var(--color-primary-600)' }} /></div>
        : rows.length === 0 ? <p className="text-sm text-center py-8" style={{ color: 'var(--color-text-tertiary)' }}>No synonym groups yet. Add one above. (If this never loads, run migration 055.)</p>
        : (
          <div className="space-y-1.5">
            {rows.map(r => (
              <SynRow key={r.id} row={r} editing={editing === r.id}
                onEdit={() => setEditing(r.id)} onCancel={() => setEditing(null)}
                onSave={saveEdit} onDelete={() => del(r.id)} />
            ))}
          </div>
        )}
    </div>
  );
};

const SynRow = ({ row, editing, onEdit, onCancel, onSave, onDelete }) => {
  const [t, setT] = useState(row.term);
  const [s, setS] = useState(row.synonyms || '');
  useEffect(() => { setT(row.term); setS(row.synonyms || ''); }, [row, editing]);
  if (editing) {
    return (
      <div className="flex flex-col sm:flex-row gap-2 p-2 rounded-lg" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
        <input value={t} onChange={e => setT(e.target.value)} className="input" style={{ maxWidth: 200 }} />
        <input value={s} onChange={e => setS(e.target.value)} className="input flex-1" />
        <button onClick={() => onSave(row.id, t, s)} className="px-3 py-1.5 rounded-lg text-xs font-bold text-white" style={{ background: 'var(--gradient-sidebar)' }}><Check size={14} /></button>
        <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}><X size={14} /></button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 p-2.5 rounded-lg" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
      <span className="text-sm font-bold px-2 py-0.5 rounded" style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>{row.term}</span>
      <span className="text-xs flex-1" style={{ color: 'var(--color-text-secondary)' }}>{row.synonyms || <em>no synonyms</em>}</span>
      <button onClick={onEdit} className="p-1.5 rounded" style={{ color: 'var(--color-text-secondary)' }}><Pencil size={14} /></button>
      <button onClick={onDelete} className="p-1.5 rounded" style={{ color: '#ef4444' }}><Trash2 size={14} /></button>
    </div>
  );
};

export default SearchSettings;
