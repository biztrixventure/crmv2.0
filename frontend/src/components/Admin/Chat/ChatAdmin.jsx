import { useEffect, useState, useCallback } from 'react';
import {
  MessageSquare, Activity, Users, Lock, Unlock, Trash2, Send, Shield, Search, X,
  Megaphone, ScrollText, Building2, Ban, RotateCcw, Clock, Download, VolumeX, Volume2,
  UserMinus, Crown, TrendingUp, Hash, MessagesSquare, Mail, RefreshCw, Palette,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button, Alert, Badge } from '../../UI';
import client from '../../../api/client';

// ── shared bits ───────────────────────────────────────────────────────────────
const fmt = (s) => s ? new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
const fmtDay = (s) => s ? new Date(s).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const Spinner = () => <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-7 w-7 border-b-2 border-primary-600" /></div>;
const typeColor = (t) => t === 'dm' ? 'info' : t === 'broadcast' ? 'warning' : 'primary';
const convName = (c) => c.title || (c.members ? c.members.map(m => m.name).slice(0, 2).join(' ↔ ') : 'Conversation');

const downloadText = (name, text) => {
  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
};

const TABS = [
  { id: 'overview',      label: 'Overview',       icon: Activity },
  { id: 'conversations', label: 'Conversations',  icon: MessageSquare },
  { id: 'search',        label: 'Message Search', icon: Search },
  { id: 'users',         label: 'Users',          icon: Users },
  { id: 'broadcast',     label: 'Broadcast',      icon: Megaphone },
  { id: 'colors',        label: 'Font Colors',    icon: Palette },
  { id: 'log',           label: 'Moderation Log', icon: ScrollText },
  { id: 'companies',     label: 'Rollout',        icon: Building2 },
];

// ── Overview ────────────────────────────────────────────────────────────────
const StatCard = ({ label, value, icon: Icon, accent }) => (
  <div className="rounded-2xl p-4 relative overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white flex-shrink-0" style={{ background: accent || 'var(--gradient-sidebar)' }}><Icon size={18} /></div>
      <div className="min-w-0">
        <p className="text-2xl font-bold leading-none" style={{ color: 'var(--color-text)' }}>{value}</p>
        <p className="text-xs uppercase tracking-wide font-semibold mt-1 truncate" style={{ color: 'var(--color-text-tertiary)' }}>{label}</p>
      </div>
    </div>
  </div>
);

const OverviewTab = ({ onOpenConversation }) => {
  const [s, setS] = useState(null);
  const load = useCallback(() => client.get('chat/admin/overview').then(r => setS(r.data)).catch(() => setS({})), []);
  useEffect(() => { load(); }, [load]);
  if (!s) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <StatCard label="Conversations" value={s.total_conversations ?? 0} icon={MessageSquare} />
        <StatCard label="Total messages" value={s.total_messages ?? 0} icon={MessagesSquare} accent="linear-gradient(135deg,#6366f1,#8b5cf6)" />
        <StatCard label="Messages today" value={s.messages_today ?? 0} icon={Send} accent="linear-gradient(135deg,#0ea5e9,#2563eb)" />
        <StatCard label="Messages · 7d" value={s.messages_7d ?? 0} icon={TrendingUp} accent="linear-gradient(135deg,#10b981,#059669)" />
        <StatCard label="Active today" value={s.active_users_today ?? 0} icon={Users} accent="linear-gradient(135deg,#f59e0b,#d97706)" />
        <StatCard label="Banned users" value={s.banned_users ?? 0} icon={Ban} accent="linear-gradient(135deg,#ef4444,#b91c1c)" />
        <StatCard label="Locked rooms" value={s.locked_rooms ?? 0} icon={Lock} accent="linear-gradient(135deg,#64748b,#475569)" />
        <StatCard label="DM / Group / Bcast" value={`${s.dm_count || 0}/${s.group_count || 0}/${s.broadcast_count || 0}`} icon={Hash} accent="linear-gradient(135deg,#ec4899,#db2777)" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <h4 className="text-sm font-bold mb-3 flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}><TrendingUp size={15} style={{ color: 'var(--color-primary-600)' }} /> Busiest rooms · 7 days</h4>
          {(s.top_rooms || []).length === 0 ? <p className="text-xs py-3 text-center" style={{ color: 'var(--color-text-tertiary)' }}>No activity</p> :
            (s.top_rooms).map((r, i) => (
              <button key={r.id} onClick={() => onOpenConversation(r.id)} className="w-full flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-bg-secondary text-left">
                <span className="text-xs font-bold w-5" style={{ color: 'var(--color-text-tertiary)' }}>#{i + 1}</span>
                <span className="flex-1 text-sm truncate" style={{ color: 'var(--color-text)' }}>{r.title}</span>
                <Badge variant="primary" size="sm">{r.count} msgs</Badge>
              </button>
            ))}
        </div>
        <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <h4 className="text-sm font-bold mb-3 flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}><Crown size={15} style={{ color: '#d97706' }} /> Most active people · 7 days</h4>
          {(s.top_senders || []).length === 0 ? <p className="text-xs py-3 text-center" style={{ color: 'var(--color-text-tertiary)' }}>No activity</p> :
            (s.top_senders).map((u, i) => (
              <div key={u.id} className="flex items-center gap-3 py-2 px-2">
                <span className="text-xs font-bold w-5" style={{ color: 'var(--color-text-tertiary)' }}>#{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate" style={{ color: 'var(--color-text)' }}>{u.name}</p>
                  <p className="text-xs truncate" style={{ color: 'var(--color-text-tertiary)' }}>{[u.role, u.company].filter(Boolean).join(' · ')}</p>
                </div>
                <Badge variant="success" size="sm">{u.count} msgs</Badge>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
};

// ── Conversation viewer (read + moderate, with Members panel) ─────────────────
const ConversationViewer = ({ conversationId, onClose, onChanged }) => {
  const [tab, setTab] = useState('messages');
  const [detail, setDetail] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadDetail = useCallback(async () => {
    try { const r = await client.get(`chat/admin/conversations/${conversationId}`); setDetail(r.data); } catch { /* ignore */ }
  }, [conversationId]);
  const loadMessages = useCallback(async () => {
    setLoading(true);
    try { const r = await client.get(`chat/admin/conversations/${conversationId}/messages`, { params: { limit: 100 } }); setMessages(r.data.messages || []); }
    catch { /* ignore */ } finally { setLoading(false); }
  }, [conversationId]);
  useEffect(() => { loadDetail(); loadMessages(); }, [loadDetail, loadMessages]);

  const conv = detail?.conversation;
  const members = detail?.members || [];
  const title = conv ? (conv.title || members.map(m => m.name).slice(0, 2).join(' ↔ ') || 'Conversation') : 'Loading…';

  const delMsg = async (id) => { if (!window.confirm('Delete this message for everyone?')) return; await client.delete(`chat/admin/messages/${id}`); toast.success('Message deleted'); loadMessages(); };
  const toggleLock = async () => { const r = await client.patch(`chat/admin/conversations/${conversationId}/lock`, { is_locked: !conv.is_locked }); setDetail(d => ({ ...d, conversation: { ...d.conversation, is_locked: r.data.conversation.is_locked } })); toast.success(r.data.conversation.is_locked ? 'Room locked' : 'Room unlocked'); onChanged?.(); };
  const delRoom = async () => { if (!window.confirm('Delete this entire room and all its messages?')) return; await client.delete(`chat/admin/conversations/${conversationId}`); toast.success('Room deleted'); onChanged?.(); onClose(); };
  const muteMember = async (m) => { const r = await client.patch(`chat/admin/conversations/${conversationId}/members/${m.id}/mute`, { is_muted: !m.is_muted }); setDetail(d => ({ ...d, members: d.members.map(x => x.id === m.id ? { ...x, is_muted: r.data.is_muted } : x) })); toast.success(r.data.is_muted ? `Muted ${m.name}` : `Unmuted ${m.name}`); };
  const removeMember = async (m) => { if (!window.confirm(`Remove ${m.name} from this conversation?`)) return; await client.delete(`chat/admin/conversations/${conversationId}/members/${m.id}`); setDetail(d => ({ ...d, members: d.members.filter(x => x.id !== m.id) })); toast.success(`Removed ${m.name}`); };
  const exportTranscript = () => {
    const head = `${title} — exported ${new Date().toLocaleString()}\n${'='.repeat(48)}\n\n`;
    const body = messages.map(m => `[${fmt(m.created_at)}] ${m.sender_name}${m.deleted ? ' (deleted)' : ''}: ${m.body || ''}`).join('\n');
    downloadText(`chat-${conversationId.slice(0, 8)}.txt`, head + body);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl max-h-[88vh] rounded-2xl flex flex-col animate-scale-in" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}>
        <div className="flex items-center justify-between px-5 py-4 rounded-t-2xl" style={{ background: 'var(--gradient-sidebar)' }}>
          <div className="min-w-0">
            <h3 className="font-bold text-white truncate flex items-center gap-1.5">{conv?.is_locked && <Lock size={14} />}{title}</h3>
            <p className="text-xs text-white/80">{conv ? `${conv.type} · ${members.length} members · ${conv.message_count} messages` : ''}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30"><X size={18} className="text-white" /></button>
        </div>

        {/* toolbar */}
        <div className="flex items-center gap-2 px-5 py-2.5 flex-wrap flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex gap-1 mr-auto">
            {['messages', 'members'].map(t => (
              <button key={t} onClick={() => setTab(t)} className="text-xs font-semibold px-3 py-1.5 rounded-lg capitalize"
                style={{ background: tab === t ? 'var(--gradient-sidebar)' : 'var(--color-bg-secondary)', color: tab === t ? 'white' : 'var(--color-text-secondary)' }}>
                {t}{t === 'members' ? ` (${members.length})` : ''}
              </button>
            ))}
          </div>
          {conv && <>
            <Button size="sm" variant="secondary" onClick={exportTranscript} className="flex items-center gap-1.5"><Download size={13} /> Export</Button>
            <Button size="sm" variant="secondary" onClick={toggleLock} className="flex items-center gap-1.5">{conv.is_locked ? <Unlock size={13} /> : <Lock size={13} />}{conv.is_locked ? 'Unlock' : 'Lock'}</Button>
            <Button size="sm" variant="danger" onClick={delRoom} className="flex items-center gap-1.5"><Trash2 size={13} /> Delete</Button>
          </>}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4" style={{ backgroundColor: 'var(--color-bg)' }}>
          {tab === 'messages' ? (
            loading ? <Spinner /> : messages.length === 0 ? <p className="text-center text-sm py-8" style={{ color: 'var(--color-text-tertiary)' }}>No messages</p> : (
              <div className="space-y-2">
                {messages.map(m => (
                  <div key={m.id} className="flex items-start gap-2 group">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold" style={{ color: 'var(--color-primary-600)' }}>{m.sender_name} <span className="font-normal" style={{ color: 'var(--color-text-tertiary)' }}>· {fmt(m.created_at)}</span></p>
                      <p className="text-sm" style={{ color: m.deleted ? 'var(--color-text-tertiary)' : 'var(--color-text)', fontStyle: m.deleted ? 'italic' : 'normal' }}>
                        {m.body}{m.deleted && <span className="ml-1 text-xs">(deleted{m.deleted_by_name ? ` by ${m.deleted_by_name}` : ''})</span>}
                      </p>
                    </div>
                    {!m.deleted && <button onClick={() => delMsg(m.id)} title="Delete message" className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-error-50"><Trash2 size={13} style={{ color: '#ef4444' }} /></button>}
                  </div>
                ))}
              </div>
            )
          ) : (
            <div className="space-y-1.5">
              {members.map(m => (
                <div key={m.id} className="flex items-center gap-3 rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
                      {m.name}
                      {m.member_role === 'admin' && <Crown size={12} style={{ color: '#d97706' }} />}
                      {m.is_muted && <VolumeX size={12} style={{ color: '#ef4444' }} />}
                    </p>
                    <p className="text-xs truncate" style={{ color: 'var(--color-text-tertiary)' }}>{[m.role, m.company].filter(Boolean).join(' · ') || '—'} · last read {m.last_read_at ? fmt(m.last_read_at) : 'never'}</p>
                  </div>
                  <button onClick={() => muteMember(m)} title={m.is_muted ? 'Unmute' : 'Mute'} className="p-1.5 rounded-lg hover:bg-bg-secondary">{m.is_muted ? <Volume2 size={15} style={{ color: 'var(--color-success-600)' }} /> : <VolumeX size={15} style={{ color: 'var(--color-text-tertiary)' }} />}</button>
                  <button onClick={() => removeMember(m)} title="Remove from room" className="p-1.5 rounded-lg hover:bg-error-50"><UserMinus size={15} style={{ color: '#ef4444' }} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Conversations tab (filters + search) ──────────────────────────────────────
const FILTERS = [{ k: '', label: 'All' }, { k: 'dm', label: 'Direct' }, { k: 'group', label: 'Groups' }, { k: 'broadcast', label: 'Broadcasts' }];

const ConversationsTab = ({ openId, setOpenId }) => {
  const [convs, setConvs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [locked, setLocked] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await client.get('chat/admin/conversations', { params: { q, type, locked: locked ? 'true' : undefined } }); setConvs(r.data.conversations || []); }
    catch { /* ignore */ } finally { setLoading(false); }
  }, [q, type, locked]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by participant, company, or title…" className="input" style={{ paddingLeft: 34 }} />
        </div>
        {FILTERS.map(f => (
          <button key={f.k} onClick={() => setType(f.k)} className="text-xs font-semibold px-3 py-2 rounded-lg"
            style={{ background: type === f.k ? 'var(--gradient-sidebar)' : 'var(--color-surface)', color: type === f.k ? 'white' : 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>{f.label}</button>
        ))}
        <button onClick={() => setLocked(l => !l)} className="text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5"
          style={{ background: locked ? 'var(--gradient-sidebar)' : 'var(--color-surface)', color: locked ? 'white' : 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}><Lock size={12} /> Locked</button>
        <button onClick={load} className="p-2 rounded-lg" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }} title="Refresh"><RefreshCw size={14} /></button>
      </div>

      {loading ? <Spinner /> : convs.length === 0 ? <p className="text-sm py-8 text-center" style={{ color: 'var(--color-text-tertiary)' }}>No conversations</p> : (
        <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <table className="w-full text-sm">
            <thead><tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
              {['Conversation', 'Type', 'Members', 'Messages', 'Last activity', ''].map(h => <th key={h} className="px-4 py-2.5 text-left text-xs font-bold uppercase" style={{ color: 'var(--color-text-secondary)' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {convs.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td className="px-4 py-3"><div className="flex items-center gap-1.5"><span className="font-semibold truncate max-w-[200px] inline-block" style={{ color: 'var(--color-text)' }}>{convName(c)}</span>{c.is_locked && <Lock size={12} style={{ color: 'var(--color-text-tertiary)' }} />}</div></td>
                  <td className="px-4 py-3"><Badge variant={typeColor(c.type)} size="sm">{c.type}</Badge></td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{c.members?.length || 0}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{c.message_count}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{fmt(c.last_message_at)}</td>
                  <td className="px-4 py-3"><Button size="sm" variant="secondary" onClick={() => setOpenId(c.id)}>Open</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {openId && <ConversationViewer conversationId={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
};

// ── Message search tab ────────────────────────────────────────────────────────
const SearchTab = ({ setOpenId }) => {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try { const r = await client.get('chat/admin/messages/search', { params: { q } }); setResults(r.data.results || []); }
      catch { /* ignore */ } finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div>
      <div className="relative mb-4 max-w-xl">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search message text across every conversation…" className="input" style={{ paddingLeft: 34 }} autoFocus />
      </div>
      {loading ? <Spinner /> : q.trim().length < 2 ? <p className="text-sm py-8 text-center" style={{ color: 'var(--color-text-tertiary)' }}>Type at least 2 characters.</p>
        : results.length === 0 ? <p className="text-sm py-8 text-center" style={{ color: 'var(--color-text-tertiary)' }}>No messages found.</p> : (
          <div className="space-y-1.5">
            {results.map(m => (
              <button key={m.id} onClick={() => setOpenId(m.conversation_id)} className="w-full text-left rounded-xl px-3 py-2.5 hover:bg-bg-secondary transition-colors" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <div className="flex items-center gap-2 mb-0.5">
                  <Badge variant={typeColor(m.conversation_type)} size="sm">{m.conversation_type || 'chat'}</Badge>
                  <span className="text-xs font-semibold truncate" style={{ color: 'var(--color-text)' }}>{m.conversation_title}</span>
                  <span className="text-xs ml-auto flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>{fmt(m.created_at)}</span>
                </div>
                <p className="text-sm truncate" style={{ color: 'var(--color-text-secondary)' }}><span style={{ color: 'var(--color-primary-600)', fontWeight: 600 }}>{m.sender_name}:</span> {m.body}</p>
              </button>
            ))}
          </div>
        )}
    </div>
  );
};

// ── Users (ban/unban) ─────────────────────────────────────────────────────────
const UsersTab = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await client.get('chat/admin/users', { params: { q } }); setUsers(r.data.users || []); }
    catch { /* ignore */ } finally { setLoading(false); }
  }, [q]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const ban = async (u) => { const reason = window.prompt(`Ban ${u.name} from chat? Optional reason:`, ''); if (reason === null) return; await client.post(`chat/admin/users/${u.id}/ban`, { reason }); toast.success(`${u.name} banned`); load(); };
  const unban = async (u) => { await client.post(`chat/admin/users/${u.id}/unban`); toast.success(`${u.name} unbanned`); load(); };

  return (
    <div>
      <div className="relative mb-4 max-w-md">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search people…" className="input" style={{ paddingLeft: 34 }} />
      </div>
      {loading ? <Spinner /> : (
        <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <table className="w-full text-sm">
            <thead><tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
              {['Name', 'Role', 'Company', 'Status', ''].map(h => <th key={h} className="px-4 py-2.5 text-left text-xs font-bold uppercase" style={{ color: 'var(--color-text-secondary)' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td className="px-4 py-3 font-semibold" style={{ color: 'var(--color-text)' }}>{u.name}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{u.role || '—'}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{u.company || '—'}</td>
                  <td className="px-4 py-3">{u.is_chat_banned ? <Badge variant="error" size="sm">Banned</Badge> : <Badge variant="success" size="sm">Active</Badge>}</td>
                  <td className="px-4 py-3">{u.is_chat_banned
                    ? <Button size="sm" variant="secondary" onClick={() => unban(u)} className="flex items-center gap-1.5"><RotateCcw size={13} /> Unban</Button>
                    : <Button size="sm" variant="danger" onClick={() => ban(u)} className="flex items-center gap-1.5"><Ban size={13} /> Ban</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ── Broadcast ───────────────────────────────────────────────────────────────
const BroadcastTab = () => {
  const [reference, setReference] = useState({ roles: [], companies: [] });
  const [form, setForm] = useState({ title: '', message: '', target_type: 'all', target_company_ids: [], target_roles: [] });
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => { client.get('announcements/reference').then(r => setReference(r.data)).catch(() => {}); }, []);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const toggleArr = (k, id) => setForm(f => ({ ...f, [k]: f[k].includes(id) ? f[k].filter(x => x !== id) : [...f[k], id] }));

  const send = async () => {
    if (!form.message.trim()) { setMsg({ type: 'error', text: 'Message is required' }); return; }
    setSending(true); setMsg(null);
    try {
      const r = await client.post('chat/admin/broadcast', form);
      setMsg({ type: 'success', text: `Broadcast sent to ${r.data.recipients} user(s).` });
      toast.success(`Broadcast sent to ${r.data.recipients} user(s)`);
      setForm(f => ({ ...f, title: '', message: '' }));
    } catch (e) { setMsg({ type: 'error', text: e.response?.data?.error || 'Failed to send' }); }
    finally { setSending(false); }
  };

  return (
    <div className="max-w-2xl space-y-4">
      {msg && <Alert type={msg.type} message={msg.text} />}
      <div className="rounded-2xl p-5 space-y-4" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Title</label>
          <input value={form.title} onChange={e => set('title', e.target.value)} placeholder="Announcement" className="input" />
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Message *</label>
          <textarea value={form.message} onChange={e => set('message', e.target.value)} rows={4} className="input" placeholder="Type your announcement…" style={{ resize: 'vertical' }} />
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Audience</label>
          <select value={form.target_type} onChange={e => set('target_type', e.target.value)} className="input">
            <option value="all">Everyone</option>
            <option value="company">Specific companies</option>
            <option value="role">Specific roles</option>
          </select>
        </div>
        {form.target_type === 'company' && (
          <div className="flex flex-wrap gap-2">
            {(reference.companies || []).map(c => (
              <button key={c.id} onClick={() => toggleArr('target_company_ids', c.id)} className="text-xs px-2.5 py-1.5 rounded-lg font-semibold"
                style={{ backgroundColor: form.target_company_ids.includes(c.id) ? 'var(--color-primary-100)' : 'var(--color-bg-secondary)', color: form.target_company_ids.includes(c.id) ? 'var(--color-primary-700)' : 'var(--color-text-secondary)' }}>{c.name}</button>
            ))}
          </div>
        )}
        {form.target_type === 'role' && (
          <div className="flex flex-wrap gap-2">
            {(reference.roles || []).map(r => (
              <button key={r.level || r} onClick={() => toggleArr('target_roles', r.level || r)} className="text-xs px-2.5 py-1.5 rounded-lg font-semibold capitalize"
                style={{ backgroundColor: form.target_roles.includes(r.level || r) ? 'var(--color-primary-100)' : 'var(--color-bg-secondary)', color: form.target_roles.includes(r.level || r) ? 'var(--color-primary-700)' : 'var(--color-text-secondary)' }}>{(r.label || r.level || r).replace(/_/g, ' ')}</button>
            ))}
          </div>
        )}
        <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--color-text-tertiary)' }}><Mail size={13} /> One-way — recipients can read but cannot reply, so the thread stays clean. Also fires Web Push.</p>
        <Button variant="primary" onClick={send} disabled={sending} className="flex items-center gap-1.5"><Send size={15} />{sending ? 'Sending…' : 'Send broadcast'}</Button>
      </div>
    </div>
  );
};

// ── Moderation log (with action filter) ───────────────────────────────────────
const ACTION_LABEL = {
  delete_message: 'Deleted a message', ban_user: 'Banned a user', unban_user: 'Unbanned a user',
  lock_room: 'Locked a room', unlock_room: 'Unlocked a room', delete_room: 'Deleted a room',
  broadcast: 'Sent a broadcast', feature_toggle: 'Toggled chat for a company',
  mute_member: 'Muted a member', unmute_member: 'Unmuted a member', remove_member: 'Removed a member',
};
const ACTION_VARIANT = (a) => /delete|ban|remove|lock/.test(a) && !/unlock|unban/.test(a) ? 'error' : /unban|unlock|unmute/.test(a) ? 'success' : 'info';

const ModerationTab = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  useEffect(() => { client.get('chat/admin/moderation-log').then(r => setRows(r.data.log || [])).catch(() => {}).finally(() => setLoading(false)); }, []);
  if (loading) return <Spinner />;
  const shown = filter ? rows.filter(r => r.action === filter) : rows;
  const actions = [...new Set(rows.map(r => r.action))];

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button onClick={() => setFilter('')} className="text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ background: !filter ? 'var(--gradient-sidebar)' : 'var(--color-surface)', color: !filter ? 'white' : 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>All ({rows.length})</button>
        {actions.map(a => (
          <button key={a} onClick={() => setFilter(a)} className="text-xs font-semibold px-3 py-1.5 rounded-lg" style={{ background: filter === a ? 'var(--gradient-sidebar)' : 'var(--color-surface)', color: filter === a ? 'white' : 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>{ACTION_LABEL[a] || a}</button>
        ))}
      </div>
      {shown.length === 0 ? <p className="text-sm py-8 text-center" style={{ color: 'var(--color-text-tertiary)' }}>No moderation actions.</p> : (
        <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <table className="w-full text-sm">
            <thead><tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
              {['When', 'Moderator', 'Action', 'Target'].map(h => <th key={h} className="px-4 py-2.5 text-left text-xs font-bold uppercase" style={{ color: 'var(--color-text-secondary)' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: 'var(--color-text-tertiary)' }}><Clock size={11} className="inline mr-1" />{fmt(r.created_at)}</td>
                  <td className="px-4 py-3 text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{r.actor_name}</td>
                  <td className="px-4 py-3"><Badge variant={ACTION_VARIANT(r.action)} size="sm">{ACTION_LABEL[r.action] || r.action}</Badge></td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{r.target_name || (r.detail ? JSON.stringify(r.detail) : '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ── Per-company rollout ───────────────────────────────────────────────────────
const CompaniesTab = () => {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    client.get('feature-flags/companies').then(r => setCompanies(r.data.companies || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = async (c) => {
    const next = !c.flags?.chat?.is_enabled;
    await client.patch('chat/admin/feature', { company_id: c.id, is_enabled: next });
    setCompanies(prev => prev.map(x => x.id === c.id ? { ...x, flags: { ...x.flags, chat: { ...x.flags.chat, is_enabled: next } } } : x));
    toast.success(`Chat ${next ? 'enabled' : 'disabled'} for ${c.name}`);
  };

  if (loading) return <Spinner />;
  const onCount = companies.filter(c => c.flags?.chat?.is_enabled).length;
  return (
    <div className="space-y-3">
      <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Chat is enabled for <strong>{onCount}</strong> of <strong>{companies.length}</strong> companies.</p>
      <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <table className="w-full text-sm">
          <thead><tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
            {['Company', 'Type', 'Chat', ''].map(h => <th key={h} className="px-4 py-2.5 text-left text-xs font-bold uppercase" style={{ color: 'var(--color-text-secondary)' }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {companies.map(c => {
              const on = c.flags?.chat?.is_enabled;
              return (
                <tr key={c.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td className="px-4 py-3 font-semibold" style={{ color: 'var(--color-text)' }}>{c.name}</td>
                  <td className="px-4 py-3 text-xs capitalize" style={{ color: 'var(--color-text-secondary)' }}>{c.company_type || '—'}</td>
                  <td className="px-4 py-3">{on ? <Badge variant="success" size="sm">On</Badge> : <Badge variant="info" size="sm">Off</Badge>}</td>
                  <td className="px-4 py-3"><Button size="sm" variant={on ? 'secondary' : 'primary'} onClick={() => toggle(c)}>{on ? 'Disable' : 'Enable'}</Button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── Shell ───────────────────────────────────────────────────────────────────
const ChatAdmin = () => {
  const [tab, setTab] = useState('overview');
  const [openId, setOpenId] = useState(null);   // conversation viewer (shared across tabs)

  const openConversation = (id) => { setTab('conversations'); setOpenId(id); };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="rounded-2xl p-6 relative overflow-hidden flex items-center gap-3" style={{ background: 'var(--gradient-sidebar)' }}>
        <Shield size={24} className="text-white flex-shrink-0" />
        <div className="relative z-10">
          <h2 className="text-2xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>Chat Control</h2>
          <p className="text-sm text-white/80">Full oversight: monitor every conversation, search messages, moderate members & rooms, broadcast, and roll out per company.</p>
        </div>
        <div className="absolute -right-10 -top-10 w-44 h-44 rounded-full opacity-20" style={{ background: 'radial-gradient(circle, white, transparent 70%)' }} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TABS.map(t => {
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold transition-colors"
              style={{ background: active ? 'var(--gradient-sidebar)' : 'var(--color-surface)', color: active ? 'white' : 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
              <t.icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'overview' && <OverviewTab onOpenConversation={openConversation} />}
      {tab === 'conversations' && <ConversationsTab openId={openId} setOpenId={setOpenId} />}
      {tab === 'search' && <SearchTab setOpenId={openConversation} />}
      {tab === 'users' && <UsersTab />}
      {tab === 'broadcast' && <BroadcastTab />}
      {tab === 'colors' && <ColorsTab />}
      {tab === 'log' && <ModerationTab />}
      {tab === 'companies' && <CompaniesTab />}
    </div>
  );
};

// ── Font Colors ──────────────────────────────────────────────────────────────
const ColorsTab = () => {
  const [styles, setStyles] = useState([]);
  const [users, setUsers]   = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [color, setColor] = useState('#1d4ed8');
  const [selUsers, setSelUsers] = useState([]);
  const [companyId, setCompanyId] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [userQ, setUserQ] = useState('');
  const [msg, setMsg] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [s, u, c] = await Promise.all([
        client.get('chat/admin/styles'),
        client.get('chat/admin/users', { params: { limit: 500 } }),
        client.get('companies').catch(() => ({ data: { companies: [] } })),
      ]);
      setStyles(s.data?.styles || []);
      setUsers(u.data?.users || []);
      setCompanies(c.data?.companies || c.data || []);
    } catch { /* silent */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const colorMap = Object.fromEntries(styles.map(s => [s.user_id, s.font_color]));

  const shownUsers = userQ.trim()
    ? users.filter(u => `${u.name || ''} ${u.email || ''} ${u.company || ''} ${u.role || ''}`.toLowerCase().includes(userQ.trim().toLowerCase()))
    : users;

  const toggleUser = (id) => setSelUsers(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const selectAllShown = () => setSelUsers(shownUsers.map(u => u.id));
  const clearSel = () => setSelUsers([]);

  const applyToSelected = async () => {
    if (!selUsers.length) return;
    setMsg('');
    try {
      const { data } = await client.post('chat/admin/styles/bulk', { user_ids: selUsers, font_color: color });
      setMsg(`Applied to ${data.updated} user(s).`);
      await load();
    } catch (e) { setMsg(e.response?.data?.error || 'Failed'); }
  };
  const resetSelected = async () => {
    if (!selUsers.length) return;
    setMsg('');
    try {
      await Promise.all(selUsers.map(id => client.delete(`chat/admin/styles/${id}`)));
      setMsg(`Reset ${selUsers.length} user(s) to default.`);
      await load();
    } catch (e) { setMsg(e.response?.data?.error || 'Reset failed'); }
  };
  const applyCompany = async () => {
    if (!companyId) return;
    setMsg('');
    try {
      const { data } = await client.post('chat/admin/styles/by-company', { company_id: companyId, font_color: color, role: roleFilter || undefined });
      setMsg(`Applied to ${data.updated} user(s) in company.`);
      await load();
    } catch (e) { setMsg(e.response?.data?.error || 'Failed'); }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl p-5 space-y-4" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            <Palette size={14} /> Color
            <input type="color" value={color} onChange={e => setColor(e.target.value)}
              className="w-10 h-8 rounded border-0 cursor-pointer" />
            <input type="text" value={color} onChange={e => setColor(e.target.value)}
              className="input text-sm py-1 w-28 font-mono" />
          </label>
          <span className="px-3 py-1 rounded-lg font-bold" style={{ backgroundColor: color, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.4)' }}>
            preview
          </span>
        </div>

        {/* Company-wide */}
        <div className="rounded-xl p-3" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--color-text-tertiary)' }}>Apply to entire company</p>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="input text-sm py-1">
              <option value="">— pick a company —</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="input text-sm py-1">
              <option value="">All roles</option>
              {['fronter', 'closer', 'fronter_manager', 'closer_manager', 'operations_manager', 'company_admin', 'compliance_manager'].map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <button onClick={applyCompany} disabled={!companyId}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-40"
              style={{ background: 'var(--gradient-sidebar)' }}>
              Apply
            </button>
          </div>
        </div>

        {msg && <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{msg}</p>}
      </div>

      {/* User list */}
      <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="p-3 border-b flex items-center gap-2 flex-wrap" style={{ borderColor: 'var(--color-border)' }}>
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-secondary)' }}>
            Users · {shownUsers.length}/{users.length} · {selUsers.length} selected
          </p>
          <div className="relative flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
            <input value={userQ} onChange={e => setUserQ(e.target.value)} placeholder="Filter by name, email, company, role…"
              className="input text-sm py-1 w-full" style={{ paddingLeft: 30 }} />
          </div>
          <button onClick={selectAllShown} className="text-[11px] underline" style={{ color: 'var(--color-text-secondary)' }}>Select all</button>
          <button onClick={clearSel} className="text-[11px] underline" style={{ color: 'var(--color-text-secondary)' }}>Clear</button>
          <button onClick={applyToSelected} disabled={!selUsers.length}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold text-white disabled:opacity-40"
            style={{ background: 'var(--gradient-sidebar)' }}>
            Apply color
          </button>
          <button onClick={resetSelected} disabled={!selUsers.length}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold border disabled:opacity-40"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
            Reset
          </button>
        </div>
        {loading ? <Spinner /> : (
          <div className="max-h-96 overflow-y-auto">
            {shownUsers.length === 0 && (
              <p className="text-sm py-6 text-center" style={{ color: 'var(--color-text-tertiary)' }}>No users match.</p>
            )}
            {shownUsers.map(u => {
              const c = colorMap[u.id];
              const checked = selUsers.includes(u.id);
              return (
                <label key={u.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-bg-secondary border-b"
                  style={{ borderColor: 'var(--color-border)' }}>
                  <input type="checkbox" checked={checked} onChange={() => toggleUser(u.id)} />
                  <span className="text-sm flex-1" style={{ color: c || 'var(--color-text)', fontWeight: c ? 700 : 500 }}>
                    {u.name || u.email}
                  </span>
                  {c && (
                    <code className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                      style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}>{c}</code>
                  )}
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatAdmin;
