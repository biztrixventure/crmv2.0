import { useState, useEffect, useRef, useCallback } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import client from '../../api/client';
import { usePresence } from '../../hooks/usePresence';
import ConversationList from './ConversationList';
import MessageThread from './MessageThread';
import NewChatPicker from './NewChatPicker';

// Right-side slide-over chat drawer (full-screen on mobile). Owns the
// conversation list + selection; the open thread streams via useChat.
const ChatPanel = ({ open, onClose, meId, banned }) => {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState('list');     // 'list' | 'thread' | 'new'
  const [active, setActive] = useState(null);
  const pollRef = useRef(null);
  const onlineIds = usePresence(open);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await client.get('chat/conversations'); const list = r.data.conversations || []; setConversations(list); return list; }
    catch { return null; }
    finally { setLoading(false); }
  }, []);

  // Refresh the list while the panel is open; pause when closed.
  useEffect(() => {
    if (!open) { clearInterval(pollRef.current); return; }
    load();
    pollRef.current = setInterval(load, 18_000);
    return () => clearInterval(pollRef.current);
  }, [open, load]);

  // Keep the open thread's metadata (lock/mute/members) fresh from the list.
  useEffect(() => {
    if (active) { const next = conversations.find(c => c.id === active.id); if (next) setActive(next); }
  }, [conversations]); // eslint-disable-line react-hooks/exhaustive-deps

  const openConversation = (c) => {
    setConversations(prev => prev.map(x => x.id === c.id ? { ...x, unread: 0 } : x));
    setActive(c); setView('thread');
  };
  const onCreated = async (conversationId) => {
    const list = await load();
    const full = list?.find(c => c.id === conversationId);
    setActive(full || { id: conversationId, type: 'dm', title: '', members: [] });
    setView('thread');
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop (mobile) */}
      <div className="fixed inset-0 z-[65] lg:hidden" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }} onClick={onClose} />

      <aside className="fixed top-0 right-0 z-[70] h-full flex flex-col w-full sm:w-[400px] animate-slide-in-right"
        style={{ backgroundColor: 'var(--color-surface)', borderLeft: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}>
        {/* Title bar */}
        <div className="flex items-center justify-between px-4 h-14 flex-shrink-0" style={{ background: 'var(--gradient-sidebar)' }}>
          <span className="font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>Chat</span>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30"><X size={18} className="text-white" /></button>
        </div>

        {banned && (
          <div className="flex items-center gap-2 px-4 py-2.5 flex-shrink-0" style={{ backgroundColor: '#fef2f2', borderBottom: '1px solid var(--color-border)' }}>
            <AlertTriangle size={15} style={{ color: '#b91c1c' }} />
            <span className="text-xs" style={{ color: '#b91c1c' }}>You are banned from chat. You can read but not send messages.</span>
          </div>
        )}

        <div className="flex-1 min-h-0">
          {view === 'new' ? (
            <NewChatPicker onClose={() => setView('list')} onCreated={onCreated} />
          ) : view === 'thread' && active ? (
            <MessageThread conversation={active} meId={meId} onlineIds={onlineIds} banned={banned} onBack={() => { setView('list'); load(); }} />
          ) : (
            <ConversationList conversations={conversations} onlineIds={onlineIds} meId={meId}
              activeId={active?.id} onSelect={openConversation} onNewChat={() => setView('new')} loading={loading} />
          )}
        </div>
      </aside>
    </>
  );
};

export default ChatPanel;
