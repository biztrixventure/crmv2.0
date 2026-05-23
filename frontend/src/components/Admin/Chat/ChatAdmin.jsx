import { useEffect, useState, useCallback } from 'react';
import {
  MessageSquare, Activity, Users, Lock, Unlock, Trash2, Send, Shield,
  Search, X, Megaphone, ScrollText, Building2, Ban, RotateCcw, Clock,
} from 'lucide-react';
import { Button, Alert, Badge } from '../../UI';
import client from '../../../api/client';

// ── shared bits ───────────────────────────────────────────────────────────────
const fmt = (s) => s ? new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
const Spinner = () => <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-7 w-7 border-b-2 border-primary-600" /></div>;

const TABS = [
  { id: 'overview',     label: 'Overview',      icon: Activity },
  { id: 'conversations', label: 'Conversations', icon: MessageSquare },
  { id: 'users',        label: 'Users',         icon: Users },
  { id: 'broadcast',    label: 'Broadcast',     icon: Megaphone },
  { id: 'log',          label: 'Moderation Log', icon: ScrollText },
  { id: 'companies',    label: 'Rollout',       icon: Building2 },
];

// ── Overview ────────────────────────────────────────────────────────────────
const StatCard = ({ label, value, icon: Icon }) => (
  <div className="rounded-2xl p-5 flex items-center gap-4" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
    <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white flex-shrink-0" style={{ background: 'var(--gradient-sidebar)' }}><Icon size={20} /></div>
    <div>
      <p className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>{value}</p>
      <p className="text-xs uppercase tracking-wide font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>{label}</p>
    </div>
  </div>
);

const OverviewTab = () => {
  const [stats, setStats] = useState(null);
  useEffect(() => { client.get('chat/admin/overview').then(r => setStats(r.data)).catch(() => setStats({})); }, []);
  if (!stats) return <Spinner />;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <StatCard label="Conversations" value={stats.total_conversations ?? 0} icon={MessageSquare} />
      <StatCard label="Messages today" value={stats.messages_today ?? 0} icon={Send} />
      <StatCard label="Active users today" value={stats.active_users_today ?? 0} icon={Users} />
      <StatCard label="Banned users" value={stats.banned_users ?? 0} icon={Ban} />
      <StatCard label="Locked rooms" value={stats.locked_rooms ?? 0} icon={Lock} />
    </div>
  );
};

// ── Conversation viewer (read any thread + moderate) ─────────────────────────
const ConversationViewer = ({ conv, onClose, onChanged }) => {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(conv.is_locked);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await client.get(`chat/admin/conversations/${conv.id}/messages`, { params: { limit: 100 } }); setMessages(r.data.messages || []); }
    catch { /* ignore */ }
    finally { setLoading(false); }
  }, [conv.id]);
  useEffect(() => { load(); }, [load]);

  const delMsg = async (id) => { if (!window.confirm('Delete this message for everyone?')) return; await client.delete(`chat/admin/messages/${id}`); load(); };
  const toggleLock = async () => { const r = await client.patch(`chat/admin/conversations/${conv.id}/lock`, { is_locked: !locked }); setLocked(r.data.conversation.is_locked); onChanged?.(); };
  const delRoom = async () => { if (!window.confirm('Delete this entire room and all its messages?')) return; await client.delete(`chat/admin/conversations/${conv.id}`); onChanged?.(); onClose(); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl max-h-[85vh] rounded-2xl flex flex-col animate-scale-in" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}>
        <div className="flex items-center justify-between px-5 py-4 rounded-t-2xl" style={{ background: 'var(--gradient-sidebar)' }}>
          <div className="min-w-0">
            <h3 className="font-bold text-white truncate">{conv.title || (conv.type === 'dm' ? conv.members?.map(m => m.name).join(' ↔ ') : 'Group')}</h3>
            <p className="text-xs text-white/80">{conv.type} · {conv.members?.length || 0} members</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30"><X size={18} className="text-white" /></button>
        </div>

        <div className="flex items-center gap-2 px-5 py-2.5 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <Button size="sm" variant="secondary" onClick={toggleLock} className="flex items-center gap-1.5">{locked ? <Unlock size={14} /> : <Lock size={14} />}{locked ? 'Unlock' : 'Lock'}</Button>
          <Button size="sm" variant="danger" onClick={delRoom} className="flex items-center gap-1.5"><Trash2 size={14} /> Delete room</Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2" style={{ backgroundColor: 'var(--color-bg)' }}>
          {loading ? <Spinner /> : messages.length === 0 ? <p className="text-center text-sm py-8" style={{ color: 'var(--color-text-tertiary)' }}>No messages</p> : messages.map(m => (
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
      </div>
    </div>
  );
};

const ConversationsTab = () => {
  const [convs, setConvs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [viewer, setViewer] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await client.get('chat/admin/conversations', { params: { q } }); setConvs(r.data.conversations || []); }
    catch { /* ignore */ }
    finally { setLoading(false); }
  }, [q]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  return (
    <div>
      <div className="relative mb-4 max-w-md">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by participant, company, or title…" className="input" style={{ paddingLeft: 34 }} />
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
                  <td className="px-4 py-3"><div className="flex items-center gap-1.5"><span className="font-semibold truncate max-w-[200px] inline-block" style={{ color: 'var(--color-text)' }}>{c.title || c.members?.map(m => m.name).slice(0, 2).join(' ↔ ') || '—'}</span>{c.is_locked && <Lock size={12} style={{ color: 'var(--color-text-tertiary)' }} />}</div></td>
                  <td className="px-4 py-3"><Badge variant={c.type === 'dm' ? 'info' : c.type === 'broadcast' ? 'warning' : 'primary'} size="sm">{c.type}</Badge></td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{c.members?.length || 0}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{c.message_count}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{fmt(c.last_message_at)}</td>
                  <td className="px-4 py-3"><Button size="sm" variant="secondary" onClick={() => setViewer(c)}>Open</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {viewer && <ConversationViewer conv={viewer} onClose={() => setViewer(null)} onChanged={load} />}
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
    catch { /* ignore */ }
    finally { setLoading(false); }
  }, [q]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const ban = async (u) => { const reason = window.prompt(`Ban ${u.name} from chat? Optional reason:`, ''); if (reason === null) return; await client.post(`chat/admin/users/${u.id}/ban`, { reason }); load(); };
  const unban = async (u) => { await client.post(`chat/admin/users/${u.id}/unban`); load(); };

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
        <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Broadcasts are one-way — recipients can read but cannot reply, so the thread stays clean.</p>
        <Button variant="primary" onClick={send} disabled={sending} className="flex items-center gap-1.5"><Send size={15} />{sending ? 'Sending…' : 'Send broadcast'}</Button>
      </div>
    </div>
  );
};

// ── Moderation log ────────────────────────────────────────────────────────────
const ACTION_LABEL = {
  delete_message: 'Deleted a message', ban_user: 'Banned a user', unban_user: 'Unbanned a user',
  lock_room: 'Locked a room', unlock_room: 'Unlocked a room', delete_room: 'Deleted a room',
  broadcast: 'Sent a broadcast', feature_toggle: 'Toggled chat for a company',
};
const ModerationTab = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { client.get('chat/admin/moderation-log').then(r => setRows(r.data.log || [])).catch(() => {}).finally(() => setLoading(false)); }, []);
  if (loading) return <Spinner />;
  if (!rows.length) return <p className="text-sm py-8 text-center" style={{ color: 'var(--color-text-tertiary)' }}>No moderation actions yet.</p>;
  return (
    <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <table className="w-full text-sm">
        <thead><tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
          {['When', 'Moderator', 'Action', 'Target'].map(h => <th key={h} className="px-4 py-2.5 text-left text-xs font-bold uppercase" style={{ color: 'var(--color-text-secondary)' }}>{h}</th>)}
        </tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
              <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: 'var(--color-text-tertiary)' }}><Clock size={11} className="inline mr-1" />{fmt(r.created_at)}</td>
              <td className="px-4 py-3 text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{r.actor_name}</td>
              <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{ACTION_LABEL[r.action] || r.action}</td>
              <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{r.target_name || (r.detail ? JSON.stringify(r.detail) : '—')}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
  };

  if (loading) return <Spinner />;
  return (
    <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <table className="w-full text-sm">
        <thead><tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
          {['Company', 'Type', 'Chat enabled', ''].map(h => <th key={h} className="px-4 py-2.5 text-left text-xs font-bold uppercase" style={{ color: 'var(--color-text-secondary)' }}>{h}</th>)}
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
  );
};

// ── Shell ───────────────────────────────────────────────────────────────────
const ChatAdmin = () => {
  const [tab, setTab] = useState('overview');
  return (
    <div className="space-y-5 animate-fade-in">
      <div className="rounded-2xl p-6 flex items-center gap-2.5" style={{ background: 'var(--gradient-sidebar)' }}>
        <Shield size={22} className="text-white" />
        <div>
          <h2 className="text-2xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>Chat Control</h2>
          <p className="text-sm text-white/80">Monitor every conversation, moderate messages, ban users, broadcast, and roll chat out per company.</p>
        </div>
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

      {tab === 'overview' && <OverviewTab />}
      {tab === 'conversations' && <ConversationsTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'broadcast' && <BroadcastTab />}
      {tab === 'log' && <ModerationTab />}
      {tab === 'companies' && <CompaniesTab />}
    </div>
  );
};

export default ChatAdmin;
