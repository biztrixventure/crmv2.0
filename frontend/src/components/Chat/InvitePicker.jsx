import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, Check, UserPlus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';
import Avatar from './Avatar';

// Admin-only modal: search the global directory and send group invites. Users
// join only after accepting — this never adds members directly.
const InvitePicker = ({ conversation, onClose, onInvited }) => {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState([]);
  const [sending, setSending] = useState(false);
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
  const toggle = (u) => setSelected(prev => isSel(u.id) ? prev.filter(s => s.id !== u.id) : [...prev, u]);

  const send = async () => {
    if (!selected.length) return;
    setSending(true);
    try {
      const r = await client.post(`chat/conversations/${conversation.id}/invites`, { invitee_ids: selected.map(s => s.id) });
      toast.success(`Invited ${r.data.invited} ${r.data.invited === 1 ? 'person' : 'people'}`);
      onInvited?.();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not send invites');
      setSending(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[2147483647] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(2px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl overflow-hidden flex flex-col max-h-[85vh]"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}>
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0" style={{ background: 'var(--gradient-sidebar)' }}>
          <span className="flex items-center gap-2 font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>
            <UserPlus size={18} /> Invite to {conversation.title}
          </span>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30"><X size={18} className="text-white" /></button>
        </div>

        <div className="px-4 py-3 flex-shrink-0">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search people…" className="input" style={{ paddingLeft: 34 }} autoFocus />
          </div>
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

        <div className="flex-1 overflow-y-auto px-2">
          {loading ? <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>
            : results.length === 0 ? <p className="text-center text-sm py-8" style={{ color: 'var(--color-text-tertiary)' }}>No people found</p>
              : results.map(u => (
                <button key={u.id} onClick={() => toggle(u)}
                  className="w-full flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-bg-secondary transition-colors text-left"
                  style={{ backgroundColor: isSel(u.id) ? 'var(--color-primary-50, #f5f3ff)' : 'transparent' }}>
                  <Avatar name={u.name} size={38} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{u.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      {u.role && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>{u.role}</span>}
                      {u.company && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>{u.company}</span>}
                    </div>
                  </div>
                  {isSel(u.id) && <Check size={16} style={{ color: 'var(--color-primary-600)', flexShrink: 0 }} />}
                </button>
              ))}
        </div>

        <div className="p-3 flex-shrink-0" style={{ borderTop: '1px solid var(--color-border)' }}>
          <button onClick={send} disabled={sending || !selected.length}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-sm text-white disabled:opacity-50" style={{ background: 'var(--gradient-sidebar)' }}>
            {sending ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />}
            Send {selected.length ? `${selected.length} ` : ''}invite{selected.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default InvitePicker;
