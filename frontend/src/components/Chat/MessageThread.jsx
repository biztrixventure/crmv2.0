import { useMemo, useRef, useEffect, useLayoutEffect, useState } from 'react';
import { ArrowLeft, Lock, MoreVertical, Pencil, Trash2, Check, AlertCircle } from 'lucide-react';
import { useChat } from '../../hooks/useChat';
import Avatar from './Avatar';
import PresenceDot from './PresenceDot';
import Composer from './Composer';

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const dayLabel = (s) => {
  const d = new Date(s); const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};
const clockTime = (s) => new Date(s).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const Bubble = ({ m, mine, showName, onEdit, onDelete }) => {
  const [menu, setMenu] = useState(false);
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'} group`}>
      <div className="max-w-[78%] min-w-0">
        {showName && !mine && <p className="text-xs font-semibold mb-0.5 px-1" style={{ color: 'var(--color-primary-600)' }}>{m.sender_name}</p>}
        <div className="relative flex items-end gap-1">
          {mine && !m.deleted && (
            <div className="relative">
              <button onClick={() => setMenu(v => !v)} className="opacity-0 group-hover:opacity-100 p-1 rounded transition-opacity" style={{ color: 'var(--color-text-tertiary)' }}><MoreVertical size={14} /></button>
              {menu && (
                <div className="absolute bottom-7 right-0 z-10 rounded-xl py-1 w-28" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-lg)' }}>
                  <button onClick={() => { setMenu(false); onEdit(m); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-bg-secondary" style={{ color: 'var(--color-text)' }}><Pencil size={12} /> Edit</button>
                  <button onClick={() => { setMenu(false); onDelete(m); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-error-50" style={{ color: '#ef4444' }}><Trash2 size={12} /> Delete</button>
                </div>
              )}
            </div>
          )}
          <div className="rounded-2xl px-3.5 py-2 break-words" style={{
            background: m.deleted ? 'transparent' : mine ? 'var(--gradient-sidebar)' : 'var(--color-bg-secondary)',
            color: m.deleted ? 'var(--color-text-tertiary)' : mine ? 'white' : 'var(--color-text)',
            border: m.deleted ? '1px dashed var(--color-border)' : 'none',
            opacity: m.pending ? 0.6 : 1,
          }}>
            {m.deleted
              ? <span className="text-sm italic">message deleted</span>
              : <span className="text-sm whitespace-pre-wrap">{m.body}</span>}
            <span className="block text-right mt-0.5" style={{ fontSize: 10, opacity: 0.75, color: mine && !m.deleted ? 'rgba(255,255,255,0.85)' : 'var(--color-text-tertiary)' }}>
              {clockTime(m.created_at)}{m.edited && !m.deleted ? ' · edited' : ''}
              {mine && m.error ? <AlertCircle size={11} className="inline ml-1" /> : mine && !m.pending && !m.deleted ? <Check size={11} className="inline ml-1" /> : null}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

const MessageThread = ({ conversation, meId, onlineIds, onBack, banned }) => {
  const nameMap = useMemo(() => {
    const m = {};
    (conversation.members || []).forEach(c => { m[c.id] = c.id === meId ? 'You' : c.name; });
    return m;
  }, [conversation.members, meId]);
  const resolveName = useMemo(() => (id) => nameMap[id] || (id === meId ? 'You' : 'User'), [nameMap, meId]);

  const { messages, loading, loadingOlder, hasMore, typingNames, sendMessage, editMessage, deleteMessage, loadOlder, markRead, sendTyping } =
    useChat(conversation.id, { meId, resolveName });

  const scrollRef = useRef(null);
  const nearBottomRef = useRef(true);
  const prevHeightRef = useRef(0);
  const prependingRef = useRef(false);

  useEffect(() => { markRead(); }, [conversation.id, markRead]);

  // Scroll management: keep pinned to bottom on new messages, but preserve the
  // visual position when an older page is prepended (explicit flag, not a guess).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prependingRef.current) {
      el.scrollTop = el.scrollHeight - prevHeightRef.current;
      prependingRef.current = false;
      prevHeightRef.current = 0;
    } else if (nearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 40 && hasMore && !loadingOlder) {
      prevHeightRef.current = el.scrollHeight;
      prependingRef.current = true;
      loadOlder();
    }
  };

  const onEdit = async (m) => {
    const next = window.prompt('Edit message', m.body);
    if (next != null && next.trim() && next.trim() !== m.body) {
      try { await editMessage(m.id, next); } catch { /* ignore */ }
    }
  };
  const onDelete = (m) => { if (window.confirm('Delete this message?')) deleteMessage(m.id); };

  const online = conversation.other && onlineIds?.has(conversation.other.id);
  const disabledReason = banned ? 'You are banned from chat'
    : conversation.is_locked ? 'This room is locked by an admin'
    : conversation.is_muted ? 'You are muted in this conversation' : null;

  const subtitle = typingNames.length
    ? `${typingNames.slice(0, 2).join(', ')} typing…`
    : conversation.type === 'dm' ? (online ? 'Online' : 'Offline')
    : `${(conversation.members || []).length} members`;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-bg-secondary lg:hidden" style={{ color: 'var(--color-text-secondary)' }}><ArrowLeft size={18} /></button>
        <div className="relative flex-shrink-0">
          <Avatar name={conversation.title} group={conversation.type !== 'dm'} size={40} />
          {conversation.type === 'dm' && <span className="absolute -bottom-0.5 -right-0.5"><PresenceDot online={online} size={11} /></span>}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
            {conversation.title}{conversation.is_locked && <Lock size={13} style={{ color: 'var(--color-text-tertiary)' }} />}
          </p>
          <p className="text-xs truncate" style={{ color: typingNames.length ? 'var(--color-primary-600)' : 'var(--color-text-tertiary)' }}>{subtitle}</p>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5" style={{ backgroundColor: 'var(--color-bg)' }}>
        {loadingOlder && <div className="flex justify-center py-2"><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-600" /></div>}
        {loading && !messages.length ? (
          <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-7 w-7 border-b-2 border-primary-600" /></div>
        ) : !messages.length ? (
          <div className="flex items-center justify-center h-full"><p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Say hello 👋</p></div>
        ) : messages.map((m, i) => {
          const prev = messages[i - 1];
          const showDay = !prev || !sameDay(prev.created_at, m.created_at);
          const showName = conversation.type !== 'dm' && (!prev || prev.sender_id !== m.sender_id);
          return (
            <div key={m.id}>
              {showDay && (
                <div className="flex justify-center my-3">
                  <span className="text-xs px-3 py-1 rounded-full" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}>{dayLabel(m.created_at)}</span>
                </div>
              )}
              <Bubble m={m} mine={m.sender_id === meId} showName={showName} onEdit={onEdit} onDelete={onDelete} />
            </div>
          );
        })}
      </div>

      <Composer onSend={sendMessage} onTyping={sendTyping} disabled={!!disabledReason} disabledReason={disabledReason} />
    </div>
  );
};

export default MessageThread;
