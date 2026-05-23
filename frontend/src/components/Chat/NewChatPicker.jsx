import { useState, useEffect, useRef } from 'react';
import { Search, X, Check, ArrowLeft, Users } from 'lucide-react';
import client from '../../api/client';
import Avatar from './Avatar';

// Searchable global directory → start a DM (1 user) or a group (many + title).
const NewChatPicker = ({ onClose, onCreated }) => {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState([]);   // [{id,name,role,company}]
  const [groupMode, setGroupMode] = useState(false);
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState('');
  const debRef = useRef(null);

  useEffect(() => {
    clearTimeout(debRef.current);
    debRef.current = setTimeout(async () => {
      setLoading(true);
      try { const r = await client.get('chat/users', { params: { q } }); setResults(r.data.users || []); }
      catch { setResults([]); }
      finally { setLoading(false); }
    }, 250);
    return () => clearTimeout(debRef.current);
  }, [q]);

  const isSel = (id) => selected.some(s => s.id === id);
  const toggle = (u) => {
    if (groupMode) setSelected(prev => isSel(u.id) ? prev.filter(s => s.id !== u.id) : [...prev, u]);
    else startDM(u);
  };

  const startDM = async (u) => {
    setCreating(true); setErr('');
    try {
      const r = await client.post('chat/conversations', { type: 'dm', member_ids: [u.id] });
      onCreated(r.data.conversation.id);
    } catch (e) { setErr(e.response?.data?.error || 'Could not start chat'); setCreating(false); }
  };

  const createGroup = async () => {
    if (!selected.length) { setErr('Pick at least one member'); return; }
    setCreating(true); setErr('');
    try {
      const r = await client.post('chat/conversations', {
        type: 'group', title: title.trim() || 'Group', member_ids: selected.map(s => s.id),
      });
      onCreated(r.data.conversation.id);
    } catch (e) { setErr(e.response?.data?.error || 'Could not create group'); setCreating(false); }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-bg-secondary" style={{ color: 'var(--color-text-secondary)' }}><ArrowLeft size={18} /></button>
        <h3 className="font-bold text-sm flex-1" style={{ color: 'var(--color-text)' }}>{groupMode ? 'New group' : 'New chat'}</h3>
        <button
          onClick={() => { setGroupMode(g => !g); setSelected([]); setErr(''); }}
          className="text-xs font-semibold px-2.5 py-1.5 rounded-lg flex items-center gap-1.5"
          style={{ backgroundColor: groupMode ? 'var(--color-primary-100)' : 'var(--color-bg-secondary)', color: groupMode ? 'var(--color-primary-700)' : 'var(--color-text-secondary)' }}
        >
          <Users size={13} /> {groupMode ? 'Group on' : 'Group'}
        </button>
      </div>

      {groupMode && (
        <div className="px-4 pt-3 flex-shrink-0">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Group name (optional)" className="input" />
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {selected.map(s => (
                <span key={s.id} className="flex items-center gap-1 text-xs px-2 py-1 rounded-full" style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>
                  {s.name}<button onClick={() => toggle(s)}><X size={12} /></button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Search */}
      <div className="px-4 py-3 flex-shrink-0">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search people…" className="input" style={{ paddingLeft: 34 }} autoFocus />
        </div>
      </div>

      {err && <p className="px-4 pb-2 text-xs flex-shrink-0" style={{ color: '#ef4444' }}>{err}</p>}

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-2">
        {loading ? <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
          : results.length === 0 ? <p className="text-center text-sm py-8" style={{ color: 'var(--color-text-tertiary)' }}>No people found</p>
            : results.map(u => (
              <button key={u.id} onClick={() => toggle(u)} disabled={creating}
                className="w-full flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-bg-secondary transition-colors text-left disabled:opacity-50"
                style={{ backgroundColor: isSel(u.id) ? 'var(--color-primary-50, #f5f3ff)' : 'transparent' }}>
                <Avatar name={u.name} size={40} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{u.name}</p>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    {u.role && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>{u.role}</span>}
                    {u.company && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>{u.company}</span>}
                    <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>#{String(u.id).slice(0, 6)}</span>
                  </div>
                </div>
                {groupMode && isSel(u.id) && <Check size={16} style={{ color: 'var(--color-primary-600)', flexShrink: 0 }} />}
              </button>
            ))}
      </div>

      {groupMode && (
        <div className="p-3 flex-shrink-0" style={{ borderTop: '1px solid var(--color-border)' }}>
          <button onClick={createGroup} disabled={creating || !selected.length}
            className="w-full py-2.5 rounded-xl font-bold text-sm text-white disabled:opacity-50" style={{ background: 'var(--gradient-sidebar)' }}>
            {creating ? 'Creating…' : `Create group${selected.length ? ` (${selected.length})` : ''}`}
          </button>
        </div>
      )}
    </div>
  );
};

export default NewChatPicker;
