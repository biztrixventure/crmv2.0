import { useState, useEffect, useRef } from 'react';
import { Search, Users, Lock, MessageSquarePlus, Loader2 } from 'lucide-react';
import client from '../../api/client';
import Avatar from './Avatar';
import PresenceDot from './PresenceDot';

const timeAgo = (s) => {
  if (!s) return '';
  const m = Math.floor((Date.now() - new Date(s).getTime()) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d` : new Date(s).toLocaleDateString();
};

const SectionLabel = ({ children }) => (
  <p className="px-3 pt-3 pb-1 text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-tertiary)' }}>{children}</p>
);

// One conversation row.
const ConvRow = ({ c, onlineIds, meId, activeId, onSelect }) => {
  const online = c.other && onlineIds?.has(c.other.id);
  const isActive = c.id === activeId;
  const preview = c.last_message
    ? (c.last_message.deleted ? 'Message deleted'
      : `${c.last_message.sender_id === meId ? 'You: ' : ''}${c.last_message.body || '📎 Attachment'}`)
    : 'No messages yet';
  return (
    <button onClick={() => onSelect(c)}
      className="w-full flex items-center gap-3 px-3 py-3 transition-colors text-left"
      style={{ backgroundColor: isActive ? 'var(--color-primary-50, #f5f3ff)' : 'transparent', borderBottom: '1px solid var(--color-border)' }}
      onMouseEnter={e => { if (!isActive) e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)'; }}
      onMouseLeave={e => { if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'; }}>
      <div className="relative flex-shrink-0">
        <Avatar name={c.title} group={c.type !== 'dm'} src={c.type === 'group' ? c.image_url : null} size={44} />
        {c.type === 'dm' && <span className="absolute -bottom-0.5 -right-0.5"><PresenceDot online={online} size={12} /></span>}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-bold truncate flex-1" style={{ color: 'var(--color-text)' }}>{c.title}</p>
          {c.is_locked && <Lock size={12} style={{ color: 'var(--color-text-tertiary)' }} />}
          <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>{timeAgo(c.last_message_at)}</span>
        </div>
        <div className="flex items-center gap-2">
          <p className="text-xs truncate flex-1" style={{ color: c.unread ? 'var(--color-text)' : 'var(--color-text-tertiary)', fontWeight: c.unread ? 600 : 400 }}>{preview}</p>
          {c.unread > 0 && (
            <span className="text-xs font-bold text-white rounded-full px-1.5 min-w-5 text-center flex-shrink-0" style={{ backgroundColor: '#ef4444', fontSize: 11 }}>
              {c.unread > 99 ? '99+' : c.unread}
            </span>
          )}
        </div>
      </div>
    </button>
  );
};

// One "start a new chat" person row (from the global directory).
const PersonRow = ({ u, onStartDM }) => (
  <button onClick={() => onStartDM(u)}
    className="w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left hover:bg-bg-secondary"
    style={{ borderBottom: '1px solid var(--color-border)' }}>
    <Avatar name={u.name} size={40} />
    <div className="flex-1 min-w-0">
      <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{u.name}</p>
      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
        {u.role && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>{u.role}</span>}
        {u.company && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>{u.company}</span>}
      </div>
    </div>
  </button>
);

// Search-driven list: one field finds your existing chats AND new people to
// message — no separate "New" screen. Results are categorized into Chats vs
// "Start a new chat".
const ConversationList = ({ conversations = [], onlineIds, meId, activeId, onSelect, onStartDM, onNewGroup, loading }) => {
  const [q, setQ] = useState('');
  const [people, setPeople] = useState([]);
  const [searching, setSearching] = useState(false);
  const debRef = useRef(null);

  const query = q.trim();

  // Directory search (debounced) only while the field has text.
  useEffect(() => {
    clearTimeout(debRef.current);
    if (!query) { setPeople([]); setSearching(false); return; }
    setSearching(true);
    debRef.current = setTimeout(async () => {
      try { const r = await client.get('chat/users', { params: { q: query } }); setPeople(r.data.users || []); }
      catch { setPeople([]); }
      finally { setSearching(false); }
    }, 250);
    return () => clearTimeout(debRef.current);
  }, [query]);

  const filteredConvos = query
    ? conversations.filter(c => (c.title || '').toLowerCase().includes(query.toLowerCase()))
    : conversations;

  // Don't offer "start new" for someone you already have a DM with — the chat row covers them.
  const dmOtherIds = new Set(conversations.filter(c => c.type === 'dm' && c.other).map(c => c.other.id));
  const newPeople = people.filter(u => !dmOtherIds.has(u.id));

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <h3 className="font-bold text-base" style={{ color: 'var(--color-text)', fontFamily: 'var(--font-display)' }}>Messages</h3>
        <button onClick={onNewGroup} title="New group"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white" style={{ background: 'var(--gradient-sidebar)' }}>
          <Users size={14} /> Group
        </button>
      </div>

      {/* One search field — finds chats and people to message */}
      <div className="px-3 py-2.5 flex-shrink-0">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search chats or people to message…" className="input" style={{ paddingLeft: 34, height: 38 }} />
          {searching && <Loader2 size={14} className="animate-spin absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading && !conversations.length && !query ? (
          <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-7 w-7 border-b-2 border-primary-600" /></div>
        ) : !query ? (
          conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 px-6 text-center gap-3">
              <MessageSquarePlus size={36} style={{ color: 'var(--color-text-tertiary)', opacity: 0.4 }} />
              <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No conversations yet. Search a name above to message anyone in the company.</p>
            </div>
          ) : conversations.map(c => <ConvRow key={c.id} c={c} onlineIds={onlineIds} meId={meId} activeId={activeId} onSelect={onSelect} />)
        ) : (
          /* Searching → categorized results */
          <>
            {filteredConvos.length > 0 && <SectionLabel>Chats</SectionLabel>}
            {filteredConvos.map(c => <ConvRow key={c.id} c={c} onlineIds={onlineIds} meId={meId} activeId={activeId} onSelect={onSelect} />)}

            {newPeople.length > 0 && <SectionLabel>Start a new chat</SectionLabel>}
            {newPeople.map(u => <PersonRow key={u.id} u={u} onStartDM={onStartDM} />)}

            {!searching && filteredConvos.length === 0 && newPeople.length === 0 && (
              <div className="flex flex-col items-center justify-center py-14 px-6 text-center gap-3">
                <MessageSquarePlus size={36} style={{ color: 'var(--color-text-tertiary)', opacity: 0.4 }} />
                <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No chats or people match “{query}”.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ConversationList;
