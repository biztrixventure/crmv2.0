import { useState, useEffect, useCallback } from 'react';
import { Search, Loader2, User, Check } from 'lucide-react';
import client from '../../api/client';

// Reusable "pick any CRM user" list, backed by GET /distribution-batches/recipients.
// value = the selected user object (or null); onChange(user).
export default function UserPicker({ value, onChange, placeholder = 'Search a person by name…' }) {
  const [q, setQ] = useState('');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async (term) => {
    setLoading(true);
    try { const r = await client.get('distribution-batches/recipients', { params: { q: term } }); setUsers(r.data.users || []); }
    catch { setUsers([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { const t = setTimeout(() => search(q), 250); return () => clearTimeout(t); }, [q, search]);

  return (
    <div>
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} autoFocus
          className="w-full text-sm rounded-lg pl-8 pr-3 py-2" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
      </div>
      <div className="mt-2 max-h-56 overflow-y-auto space-y-1">
        {loading ? <div className="text-center py-4"><Loader2 size={16} className="animate-spin inline" style={{ color: 'var(--color-text-tertiary)' }} /></div>
          : users.length === 0 ? <div className="text-center py-4 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>No matching users</div>
            : users.map(u => {
              const on = value?.id === u.id;
              return (
                <button key={u.id} onClick={() => onChange(u)} className="w-full text-left flex items-center gap-2 px-2.5 py-2 rounded-lg"
                  style={{ background: on ? 'var(--color-surface-hover)' : 'var(--color-surface)', border: `1px solid ${on ? 'var(--color-primary-600)' : 'var(--color-border)'}` }}>
                  <User size={14} style={{ color: 'var(--color-text-tertiary)' }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{u.name}</div>
                    <div className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>{u.role || '—'}{u.company_name ? ` · ${u.company_name}` : ''}</div>
                  </div>
                  {on && <Check size={16} style={{ color: 'var(--color-primary-600)' }} />}
                </button>
              );
            })}
      </div>
    </div>
  );
}
