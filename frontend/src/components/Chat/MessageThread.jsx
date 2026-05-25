import { memo, useMemo, useRef, useEffect, useLayoutEffect, useState, useCallback } from 'react';
import { ArrowLeft, Lock, MoreVertical, Pencil, Trash2, Check, AlertCircle, SmilePlus, Megaphone, FileText, Download, Settings } from 'lucide-react';
import { useChat } from '../../hooks/useChat';
import { sanitizeChatHtml } from '../../utils/chatHtml';
import Avatar from './Avatar';
import PresenceDot from './PresenceDot';
import Composer from './Composer';

const QUICK = ['👍', '❤️', '😂', '🔥', '✅', '🙏'];

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const dayLabel = (s) => {
  const d = new Date(s); const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};
const clockTime = (s) => new Date(s).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const TypingDots = ({ names }) => (
  <div className="flex items-center gap-1.5 px-1 h-5">
    <span className="flex gap-0.5">
      {[0, 1, 2].map(i => (
        <span key={i} className="w-1.5 h-1.5 rounded-full bsx-typing-dot" style={{ backgroundColor: 'var(--color-primary-500)', animationDelay: `${i * 0.16}s` }} />
      ))}
    </span>
    <span className="text-xs truncate" style={{ color: 'var(--color-primary-600)' }}>{names.slice(0, 2).join(', ')} typing…</span>
  </div>
);

const Attachment = ({ a, mine }) => {
  if (a.kind === 'image') {
    return (
      <a href={a.url} target="_blank" rel="noopener noreferrer" className="block">
        <img src={a.url} alt={a.name} className="rounded-lg" style={{ maxWidth: 260, maxHeight: 240, objectFit: 'cover' }} />
      </a>
    );
  }
  return (
    <a href={a.url} target="_blank" rel="noopener noreferrer" download
      className="flex items-center gap-2 px-2.5 py-2 rounded-lg transition-opacity hover:opacity-90"
      style={{ backgroundColor: mine ? 'rgba(255,255,255,0.18)' : 'var(--color-bg-secondary)', border: mine ? 'none' : '1px solid var(--color-border)' }}>
      <FileText size={16} style={{ color: mine ? 'white' : 'var(--color-primary-600)' }} />
      <span className="text-xs truncate" style={{ maxWidth: 170, color: mine ? 'white' : 'var(--color-text)' }}>{a.name}</span>
      <Download size={13} style={{ color: mine ? 'rgba(255,255,255,0.8)' : 'var(--color-text-tertiary)' }} />
    </a>
  );
};

const Bubble = memo(({ m, mine, meId, showName, onEdit, onDelete, onReact }) => {
  const [menu, setMenu] = useState(false);
  const [picker, setPicker] = useState(false);
  const mentioned = !mine && Array.isArray(m.mentions) && m.mentions.includes(meId);
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'} group`}>
      <div className={`max-w-[80%] min-w-0 flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
        {showName && !mine && <p className="text-xs font-semibold mb-0.5 px-1" style={{ color: 'var(--color-primary-600)' }}>{m.sender_name}</p>}
        <div className="relative flex items-end gap-1">
          {/* hover actions (own messages) */}
          {mine && !m.deleted && (
            <div className="relative self-center">
              <button onClick={() => setMenu(v => !v)} className="opacity-0 group-hover:opacity-100 p-1 rounded transition-opacity" style={{ color: 'var(--color-text-tertiary)' }}><MoreVertical size={14} /></button>
              {menu && (
                <div className="absolute bottom-7 right-0 z-20 rounded-xl py-1 w-28" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-lg)' }}>
                  <button onClick={() => { setMenu(false); onEdit(m); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-bg-secondary" style={{ color: 'var(--color-text)' }}><Pencil size={12} /> Edit</button>
                  <button onClick={() => { setMenu(false); onDelete(m); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-error-50" style={{ color: '#ef4444' }}><Trash2 size={12} /> Delete</button>
                </div>
              )}
            </div>
          )}

          <div className="relative">
            <div className="rounded-2xl px-3.5 py-2 break-words" style={{
              background: m.deleted ? 'transparent' : mine ? 'var(--gradient-sidebar)' : 'var(--color-surface)',
              color: m.deleted ? 'var(--color-text-tertiary)' : mine ? 'white' : 'var(--color-text)',
              border: m.deleted ? '1px dashed var(--color-border)' : mine ? 'none' : '1px solid var(--color-border)',
              borderBottomRightRadius: mine ? 4 : 16, borderBottomLeftRadius: mine ? 16 : 4,
              opacity: m.pending ? 0.6 : 1,
              boxShadow: m.deleted ? 'none' : mentioned ? '0 0 0 2px var(--color-primary-400)' : 'var(--shadow-xs, 0 1px 2px rgba(0,0,0,0.06))',
            }}>
              {m.deleted ? (
                <span className="text-sm italic">message deleted</span>
              ) : (
                <>
                  {m.body_html
                    ? <div className="bsx-msg text-sm" dangerouslySetInnerHTML={{ __html: sanitizeChatHtml(m.body_html) }} />
                    : m.body ? <span className="text-sm whitespace-pre-wrap">{m.body}</span> : null}
                  {m.attachments?.length > 0 && (
                    <div className="flex flex-col gap-1.5 mt-1.5">
                      {m.attachments.map((a, i) => <Attachment key={i} a={a} mine={mine} />)}
                    </div>
                  )}
                </>
              )}
              <span className="block text-right mt-0.5" style={{ fontSize: 10, opacity: 0.75, color: mine && !m.deleted ? 'rgba(255,255,255,0.85)' : 'var(--color-text-tertiary)' }}>
                {clockTime(m.created_at)}{m.edited && !m.deleted ? ' · edited' : ''}
                {mine && m.error ? <AlertCircle size={11} className="inline ml-1" /> : mine && !m.pending && !m.deleted ? <Check size={11} className="inline ml-1" /> : null}
              </span>
            </div>

            {/* react launcher */}
            {!m.deleted && !String(m.id).startsWith('temp-') && (
              <div className={`absolute ${mine ? 'left-0 -translate-x-full pl-0 pr-1' : 'right-0 translate-x-full pl-1'} top-1/2 -translate-y-1/2`}>
                <button onClick={() => setPicker(p => !p)} className="opacity-0 group-hover:opacity-100 p-1 rounded-full transition-opacity" style={{ color: 'var(--color-text-tertiary)' }} title="React"><SmilePlus size={15} /></button>
                {picker && (
                  <div className="absolute z-20 flex gap-0.5 p-1 rounded-full" style={{ bottom: '120%', backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-lg)' }}>
                    {QUICK.map(e => <button key={e} onClick={() => { setPicker(false); onReact(m.id, e); }} className="text-base hover:scale-125 transition-transform px-0.5">{e}</button>)}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* reaction chips */}
        {m.reactions?.length > 0 && (
          <div className={`flex flex-wrap gap-1 mt-1 ${mine ? 'justify-end' : ''}`}>
            {m.reactions.map(r => {
              const mineR = r.user_ids.includes(meId);
              return (
                <button key={r.emoji} onClick={() => onReact(m.id, r.emoji)}
                  className="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs transition-transform hover:scale-105"
                  style={{ backgroundColor: mineR ? 'var(--color-primary-100)' : 'var(--color-bg-secondary)', border: `1px solid ${mineR ? 'var(--color-primary-300)' : 'var(--color-border)'}` }}>
                  <span>{r.emoji}</span><span style={{ color: 'var(--color-text-secondary)', fontWeight: 600 }}>{r.user_ids.length}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});

const MessageThread = ({ conversation, meId, onlineIds, onBack, banned, onSent, onOpenSettings }) => {
  const nameMap = useMemo(() => {
    const m = {};
    (conversation.members || []).forEach(c => { m[c.id] = c.id === meId ? 'You' : c.name; });
    return m;
  }, [conversation.members, meId]);
  const resolveName = useMemo(() => (id) => nameMap[id] || (id === meId ? 'You' : 'User'), [nameMap, meId]);

  const { messages, loading, loadingOlder, hasMore, typingNames, sendMessage, editMessage, deleteMessage, addReaction, loadOlder, markRead, sendTyping } =
    useChat(conversation.id, { meId, resolveName });

  const scrollRef = useRef(null);
  const nearBottomRef = useRef(true);
  const prevHeightRef = useRef(0);
  const prependingRef = useRef(false);

  useEffect(() => { markRead(); }, [conversation.id, markRead]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prependingRef.current) { el.scrollTop = el.scrollHeight - prevHeightRef.current; prependingRef.current = false; prevHeightRef.current = 0; }
    else if (nearBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, typingNames]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 40 && hasMore && !loadingOlder) { prevHeightRef.current = el.scrollHeight; prependingRef.current = true; loadOlder(); }
  };

  const onEdit = useCallback(async (m) => {
    const next = window.prompt('Edit message', m.body);
    if (next != null && next.trim() && next.trim() !== m.body) { try { await editMessage(m.id, next); } catch { /* ignore */ } }
  }, [editMessage]);
  const onDelete = useCallback((m) => { if (window.confirm('Delete this message?')) deleteMessage(m.id); }, [deleteMessage]);

  // After a successful send, nudge the parent to refresh the conversation list so
  // a brand-new DM (hidden until it has a message) appears immediately.
  const handleSend = useCallback(async (text) => {
    await sendMessage(text);
    onSent?.();
  }, [sendMessage, onSent]);

  const isBroadcast = conversation.type === 'broadcast';
  const online = conversation.other && onlineIds?.has(conversation.other.id);
  const disabledReason = banned ? 'You are banned from chat'
    : isBroadcast ? 'Broadcast announcement — read only'
    : conversation.is_locked ? 'This room is locked by an admin'
    : conversation.is_muted ? 'You are muted in this conversation'
    : (conversation.type === 'group' && conversation.only_admins_post && conversation.my_role !== 'admin') ? 'Only admins can post in this group' : null;

  const subtitle = typingNames.length ? null
    : isBroadcast ? 'Announcement'
    : conversation.type === 'dm' ? (online ? 'Active now' : 'Offline')
    : `${(conversation.members || []).length} members`;

  return (
    <div className="flex flex-col h-full">
      <style>{`
        @keyframes bsxTyping{0%,80%,100%{transform:translateY(0);opacity:.4}40%{transform:translateY(-3px);opacity:1}}
        .bsx-typing-dot{animation:bsxTyping 1.1s infinite ease-in-out}
        .bsx-msg img{max-width:260px;max-height:240px;border-radius:8px;margin:3px 0}
        .bsx-msg a{color:inherit;text-decoration:underline}
        .bsx-msg ul{list-style:disc;padding-left:1.15rem;margin:2px 0}
        .bsx-msg ol{list-style:decimal;padding-left:1.15rem;margin:2px 0}
        .bsx-msg p{margin:2px 0}
        .bsx-msg .bsx-mention{background:var(--color-primary-100);color:var(--color-primary-700);border-radius:5px;padding:0 3px;font-weight:600}
      `}</style>

      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2.5 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <button onClick={onBack} className="p-1.5 rounded-lg transition-colors flex-shrink-0" style={{ color: 'var(--color-text-secondary)' }}
          onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'} title="Back to conversations">
          <ArrowLeft size={18} />
        </button>
        <div className="relative flex-shrink-0">
          <Avatar name={conversation.title} group={conversation.type !== 'dm'} src={conversation.type === 'group' ? conversation.image_url : null} size={38} />
          {conversation.type === 'dm' && <span className="absolute -bottom-0.5 -right-0.5"><PresenceDot online={online} size={11} /></span>}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
            {isBroadcast && <Megaphone size={13} style={{ color: 'var(--color-primary-600)' }} />}
            {conversation.title}{conversation.is_locked && <Lock size={13} style={{ color: 'var(--color-text-tertiary)' }} />}
          </p>
          {typingNames.length ? <TypingDots names={typingNames} /> : <p className="text-xs truncate" style={{ color: 'var(--color-text-tertiary)' }}>{subtitle}</p>}
        </div>
        {conversation.type === 'group' && (
          <button onClick={() => onOpenSettings?.(conversation)} title="Group settings"
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors"
            style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
            <Settings size={17} />
          </button>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-3 py-3 space-y-1" style={{ backgroundColor: 'var(--color-bg)' }}>
        {loadingOlder && <div className="flex justify-center py-2"><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-600" /></div>}
        {loading && !messages.length ? (
          <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-7 w-7 border-b-2 border-primary-600" /></div>
        ) : !messages.length ? (
          <div className="flex flex-col items-center justify-center h-full gap-2" style={{ color: 'var(--color-text-tertiary)' }}>
            <Avatar name={conversation.title} group={conversation.type !== 'dm'} size={56} />
            <p className="text-sm">{isBroadcast ? 'No announcement yet.' : 'Say hello 👋'}</p>
          </div>
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
              <Bubble m={m} mine={m.sender_id === meId} meId={meId} showName={showName} onEdit={onEdit} onDelete={onDelete} onReact={addReaction} />
            </div>
          );
        })}
      </div>

      <Composer onSend={handleSend} onTyping={sendTyping} disabled={!!disabledReason} disabledReason={disabledReason} meId={meId} members={conversation.members} />
    </div>
  );
};

export default MessageThread;
