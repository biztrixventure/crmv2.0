import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, AlertTriangle, MessagesSquare } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';
import { usePresence } from '../../hooks/usePresence';
import ConversationList from './ConversationList';
import MessageThread from './MessageThread';
import NewChatPicker from './NewChatPicker';
import InvitesBanner from './InvitesBanner';
import GroupSettingsModal from './GroupSettingsModal';

// Full chat window: dim backdrop + opaque docked panel. On large screens it's a
// two-pane layout (conversation list always visible alongside the open thread,
// so going back is one click); on mobile it's single-pane with a back button.
const ChatPanel = ({ open, onClose, meId, banned }) => {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState('list');   // 'list' | 'new'
  const [active, setActive] = useState(null);
  const [invites, setInvites] = useState([]);
  const [inviteBusy, setInviteBusy] = useState(null);
  const [settingsConv, setSettingsConv] = useState(null);   // group settings modal
  const pollRef = useRef(null);
  const onlineIds = usePresence(open);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await client.get('chat/conversations'); const list = r.data.conversations || []; setConversations(list); return list; }
    catch { return null; }
    finally { setLoading(false); }
  }, []);

  const loadInvites = useCallback(async () => {
    try { const r = await client.get('chat/invites'); setInvites(r.data.invites || []); }
    catch { /* non-critical */ }
  }, []);

  const acceptInvite = useCallback(async (inv) => {
    setInviteBusy(inv.id);
    try {
      const r = await client.post(`chat/invites/${inv.id}/accept`);
      setInvites(prev => prev.filter(i => i.id !== inv.id));
      const list = await load();
      const conv = list?.find(c => c.id === inv.conversation_id);
      setActive(conv || (r.data.conversation ? { ...r.data.conversation, my_role: 'member' } : null));
      setView('list');
    } catch (e) { toast.error(e.response?.data?.error || 'Could not accept invite'); }
    finally { setInviteBusy(null); }
  }, [load]);

  const declineInvite = useCallback(async (inv) => {
    setInviteBusy(inv.id);
    try { await client.post(`chat/invites/${inv.id}/decline`); setInvites(prev => prev.filter(i => i.id !== inv.id)); }
    catch (e) { toast.error(e.response?.data?.error || 'Could not decline invite'); }
    finally { setInviteBusy(null); }
  }, []);

  // Refresh the LIST on a slow cadence while open. Intentionally does NOT touch
  // the open `active` conversation — that kept re-rendering the thread and made
  // messages flicker. Lock/mute changes apply on next open.
  useEffect(() => {
    if (!open) { clearInterval(pollRef.current); return; }
    load();
    loadInvites();
    pollRef.current = setInterval(() => { load(); loadInvites(); }, 20_000);
    return () => clearInterval(pollRef.current);
  }, [open, load, loadInvites]);

  const openConversation = (c) => {
    setConversations(prev => prev.map(x => x.id === c.id ? { ...x, unread: 0 } : x));
    setView('list');
    setActive(c);
  };
  const onNewGroup = () => { setActive(null); setView('new'); };

  // Open the conversation straight from the picker's response. A new DM has no
  // messages yet, so it's intentionally absent from the list (it appears once a
  // message is sent) — we build the active thread from the picker selection so it
  // still opens with the right title/members. The background load() refreshes the
  // list for existing/group conversations.
  const onCreated = (conv, otherUser, groupMembers) => {
    const meCard = { id: meId, name: 'You' };
    const active = conv.type === 'group'
      ? {
          id: conv.id, type: 'group', title: conv.title || 'Group', is_locked: conv.is_locked, my_role: 'admin',
          description: conv.description || null, image_url: conv.image_url || null, only_admins_post: !!conv.only_admins_post,
          members: [meCard, ...(groupMembers || []).map(s => ({ id: s.id, name: s.name }))], other: null,
        }
      : {
          id: conv.id, type: 'dm', title: otherUser?.name || 'Direct message', is_locked: conv.is_locked,
          members: otherUser ? [meCard, { id: otherUser.id, name: otherUser.name }] : [meCard],
          other: otherUser ? { id: otherUser.id, name: otherUser.name } : null,
        };
    setActive(active);
    setView('list');
    load();
  };

  // Start (or reopen) a DM straight from the conversation-list search — no
  // separate "New" screen. The DM appears in the list once a message is sent.
  const startDM = async (user) => {
    try {
      const r = await client.post('chat/conversations', { type: 'dm', member_ids: [user.id] });
      onCreated(r.data.conversation, user);
    } catch (e) { toast.error(e.response?.data?.error || 'Could not start chat'); }
  };

  if (!open) return null;

  // Portal to <body> so the panel escapes the header's stacking context
  // (AdminHeader's backdrop-filter would otherwise trap it behind the page).
  return createPortal(
    <>
      {/* Dim backdrop on all sizes (fixes the see-through look) */}
      <div className="fixed inset-0 z-[2147483646]" style={{ backgroundColor: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(2px)' }} onClick={onClose} />

      <aside className="fixed top-0 right-0 z-[2147483647] h-full flex flex-col w-full lg:w-[920px] animate-slide-in-right"
        style={{ backgroundColor: 'var(--color-surface)', borderLeft: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}>
        {/* Title bar */}
        <div className="flex items-center justify-between px-4 h-14 flex-shrink-0" style={{ background: 'var(--gradient-sidebar)' }}>
          <span className="flex items-center gap-2 font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}><MessagesSquare size={18} /> Chat</span>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30"><X size={18} className="text-white" /></button>
        </div>

        {banned && (
          <div className="flex items-center gap-2 px-4 py-2.5 flex-shrink-0" style={{ backgroundColor: '#fef2f2', borderBottom: '1px solid var(--color-border)' }}>
            <AlertTriangle size={15} style={{ color: '#b91c1c' }} />
            <span className="text-xs" style={{ color: '#b91c1c' }}>You are banned from chat. You can read but not send messages.</span>
          </div>
        )}

        <div className="flex flex-1 min-h-0">
          {/* LEFT — list / new chat (hidden on mobile once a thread is open) */}
          <div className={`flex-col w-full lg:w-[330px] lg:flex-shrink-0 ${active ? 'hidden lg:flex' : 'flex'}`}
            style={{ borderRight: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            {view === 'new'
              ? <NewChatPicker onClose={() => setView('list')} onCreated={onCreated} groupOnly />
              : <>
                  <InvitesBanner invites={invites} onAccept={acceptInvite} onDecline={declineInvite} busyId={inviteBusy} />
                  <ConversationList conversations={conversations} onlineIds={onlineIds} meId={meId}
                    activeId={active?.id} onSelect={openConversation} onStartDM={startDM} onNewGroup={onNewGroup} loading={loading} />
                </>}
          </div>

          {/* RIGHT — open thread (or empty state on large screens) */}
          <div className={`flex-1 min-w-0 flex-col ${active ? 'flex' : 'hidden lg:flex'}`} style={{ backgroundColor: 'var(--color-bg)' }}>
            {active
              ? <MessageThread conversation={active} meId={meId} onlineIds={onlineIds} banned={banned} onBack={() => setActive(null)} onSent={load} onOpenSettings={setSettingsConv} />
              : (
                <div className="flex flex-col items-center justify-center h-full gap-3 px-8 text-center">
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'var(--gradient-sidebar)', opacity: 0.9 }}>
                    <MessagesSquare size={28} className="text-white" />
                  </div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Select a conversation</p>
                  <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Pick a chat on the left, or start a new one to message anyone across the company.</p>
                </div>
              )}
          </div>
        </div>
      </aside>

      {settingsConv && (
        <GroupSettingsModal
          conversation={settingsConv}
          meId={meId}
          onClose={() => setSettingsConv(null)}
          onUpdated={(fields) => {
            setActive(a => (a && a.id === settingsConv.id ? { ...a, ...fields } : a));
            setSettingsConv(s => (s ? { ...s, ...fields } : s));
            load();
          }}
          onLeft={() => { const id = settingsConv.id; setSettingsConv(null); setActive(a => (a?.id === id ? null : a)); load(); }}
          onDeleted={() => { const id = settingsConv.id; setSettingsConv(null); setActive(a => (a?.id === id ? null : a)); load(); }}
        />
      )}
    </>,
    document.body,
  );
};

export default ChatPanel;
