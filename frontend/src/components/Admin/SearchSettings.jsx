import { useState, useEffect, useCallback } from 'react';
import { Network, BarChart3, Plus, Pencil, Trash2, Check, X, Loader2, Search, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';

// Superadmin search tooling: manage synonym groups (query expansion) + view
// search analytics (top queries, zero-result gaps) for FAQs and Scripts.
const SearchSettings = () => {
  const [tab, setTab] = useState('synonyms');
  return (
    <div className="space-y-5 animate-fade-in max-w-5xl">
      <div className="rounded-2xl p-6 relative overflow-hidden" style={{ background: 'var(--gradient-sidebar)' }}>
        <div className="relative z-10 flex items-center gap-2.5">
          <Search size={22} className="text-white" />
          <div>
            <h2 className="text-2xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>Search Settings</h2>
            <p className="text-sm text-white/80">Tune FAQ &amp; Script search relevance and see what agents look for.</p>
          </div>
        </div>
      </div>

      <div className="flex gap-1 p-1 rounded-xl w-fit" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
        {[{ k: 'synonyms', l: 'Synonyms', icon: Network }, { k: 'analytics', l: 'Analytics', icon: BarChart3 }].map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
            style={{ background: tab === t.k ? 'var(--gradient-sidebar)' : 'transparent', color: tab === t.k ? '#fff' : 'var(--color-text-secondary)' }}>
            <t.icon size={15} /> {t.l}
          </button>
        ))}
      </div>

      {tab === 'synonyms' ? <SynonymsManager /> : <AnalyticsView />}
    </div>
  );
};

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

// ── Analytics ────────────────────────────────────────────────────────────────
const AnalyticsView = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    client.get('search/analytics', { params: { days: 30 } })
      .then(r => setData(r.data)).catch(() => setData({ total: 0, top: [], zeroResult: [], bySection: {} }))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-10"><Loader2 className="animate-spin" style={{ color: 'var(--color-primary-600)' }} /></div>;

  const List = ({ title, items, kind }) => (
    <div className="rounded-2xl p-4 flex-1" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <p className="text-sm font-bold mb-3" style={{ color: 'var(--color-text)' }}>{title}</p>
      {(!items || items.length === 0) ? <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>No data yet.</p>
        : items.map((q, i) => (
          <div key={i} className="flex items-center gap-2 py-1.5" style={{ borderTop: i ? '1px solid var(--color-border)' : 'none' }}>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}>{q.section}</span>
            <span className="text-sm flex-1 truncate" style={{ color: 'var(--color-text)' }}>{q.query}</span>
            {kind === 'zero'
              ? <span className="text-xs font-bold flex items-center gap-1" style={{ color: '#d97706' }}><AlertTriangle size={11} /> {q.zero}× no results</span>
              : <span className="text-xs font-bold" style={{ color: 'var(--color-primary-600)' }}>{q.count}×</span>}
          </div>
        ))}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        <Stat label="Searches (30d)" value={data.total || 0} />
        <Stat label="FAQ searches" value={data.bySection?.faq || 0} />
        <Stat label="Script searches" value={data.bySection?.script || 0} />
      </div>
      <div className="flex flex-col lg:flex-row gap-4">
        <List title="Top queries" items={data.top} kind="top" />
        <List title="Zero-result queries (content gaps)" items={data.zeroResult} kind="zero" />
      </div>
    </div>
  );
};

const Stat = ({ label, value }) => (
  <div className="rounded-xl px-4 py-3 flex-1 min-w-[130px]" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
    <p className="text-xl font-bold" style={{ color: 'var(--color-text)' }}>{value}</p>
    <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{label}</p>
  </div>
);

export default SearchSettings;
