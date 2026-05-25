import { useState } from 'react';
import { Plus, Search, MessageSquarePlus, Lock } from 'lucide-react';
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

const ConversationList = ({ conversations = [], onlineIds, meId, activeId, onSelect, onNewChat, loading }) => {
  const [q, setQ] = useState('');
  const filtered = q.trim()
    ? conversations.filter(c => (c.title || '').toLowerCase().includes(q.trim().toLowerCase()))
    : conversations;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <h3 className="font-bold text-base" style={{ color: 'var(--color-text)', fontFamily: 'var(--font-display)' }}>Messages</h3>
        <button onClick={onNewChat} title="New chat"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white" style={{ background: 'var(--gradient-sidebar)' }}>
          <Plus size={14} /> New
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2.5 flex-shrink-0">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search chats…" className="input" style={{ paddingLeft: 34, height: 38 }} />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading && !conversations.length ? (
          <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-7 w-7 border-b-2 border-primary-600" /></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 px-6 text-center gap-3">
            <MessageSquarePlus size={36} style={{ color: 'var(--color-text-tertiary)', opacity: 0.4 }} />
            <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
              {q ? 'No matches' : 'No conversations yet. Start a new chat to message anyone in the company.'}
            </p>
          </div>
        ) : filtered.map(c => {
          const online = c.other && onlineIds?.has(c.other.id);
          const isActive = c.id === activeId;
          const preview = c.last_message
            ? (c.last_message.deleted ? 'Message deleted'
              : `${c.last_message.sender_id === meId ? 'You: ' : ''}${c.last_message.body || '📎 Attachment'}`)
            : 'No messages yet';
          return (
            <button key={c.id} onClick={() => onSelect(c)}
              className="w-full flex items-center gap-3 px-3 py-3 transition-colors text-left"
              style={{ backgroundColor: isActive ? 'var(--color-primary-50, #f5f3ff)' : 'transparent', borderBottom: '1px solid var(--color-border)' }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)'; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'; }}>
              <div className="relative flex-shrink-0">
                <Avatar name={c.title} group={c.type !== 'dm'} src={c.type === 'group' ? c.image_url : null} size={44} />
                {c.type === 'dm' && (
                  <span className="absolute -bottom-0.5 -right-0.5"><PresenceDot online={online} size={12} /></span>
                )}
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
        })}
      </div>
    </div>
  );
};

export default ConversationList;
