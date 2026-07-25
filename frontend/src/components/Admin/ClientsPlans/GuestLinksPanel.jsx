// GuestLinksPanel — external guest chat links, surfaced inside the Clients &
// Plans command center (alongside portal accounts, since both are "external
// access"). Self-contained: hits the same chat/admin/guests endpoints as the
// Chat Control → Guest Links tab, which stays in place. Nothing removed.
import { useState, useEffect, useCallback } from 'react';
import { Link2, UserPlus, Copy, Check, Power, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Alert } from '../../../components/UI';
import client from '../../../api/client';
import { useAuth } from '../../../contexts/AuthContext';
import ThemedSelect from '../../UI/Select';

const convName = (g) => g?.name || g?.title || g?.subject || 'Group';

function GuestRow({ g, group, onToggle, onDelete, canManage }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/guest/${g.token}`;
  const copy = () => { navigator.clipboard?.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  return (
    <div className="rounded-xl p-3 flex items-center gap-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
          {g.name}
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
            style={{ background: g.is_active ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)', color: g.is_active ? '#047857' : '#b91c1c' }}>
            {g.is_active ? 'Active' : 'Disabled'}
          </span>
        </p>
        <p className="text-[11px] truncate" style={{ color: 'var(--color-text-tertiary)' }}>→ {group || 'group'} · <span className="font-mono">{url}</span></p>
      </div>
      <button onClick={copy} title="Copy link" className="p-2 rounded-lg" style={{ background: 'var(--color-bg-secondary)' }}>
        {copied ? <Check size={14} style={{ color: '#059669' }} /> : <Copy size={14} style={{ color: 'var(--color-text-secondary)' }} />}
      </button>
      <button onClick={() => onToggle(g)} title={g.is_active ? 'Disable link' : 'Enable link'} className="p-2 rounded-lg" style={{ background: 'var(--color-bg-secondary)' }}>
        <Power size={14} style={{ color: g.is_active ? '#b91c1c' : '#059669' }} />
      </button>
      {canManage && (
        <button onClick={() => onDelete(g)} title="Delete" className="p-2 rounded-lg" style={{ background: 'var(--color-bg-secondary)' }}>
          <Trash2 size={14} style={{ color: '#b91c1c' }} />
        </button>
      )}
    </div>
  );
}

export default function GuestLinksPanel() {
  const { roControlAllowed } = useAuth();
  const canManage = roControlAllowed('chat.guest_link');
  const [guests, setGuests] = useState([]);
  const [groups, setGroups] = useState([]);
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState('');
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    client.get('chat/admin/guests').then(r => setGuests(r.data.guests || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    client.get('chat/admin/conversations', { params: { type: 'group', limit: 200 } })
      .then(r => setGroups(r.data.conversations || [])).catch(() => {});
  }, []);

  const groupNameOf = (id) => { const g = groups.find(x => x.id === id); return g ? convName(g) : ''; };

  const create = async () => {
    if (!name.trim() || !groupId) { toast.error('Enter a name and pick a group'); return; }
    setCreating(true);
    try { await client.post('chat/admin/guests', { name: name.trim(), conversation_id: groupId }); setName(''); toast.success('Guest link created'); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed to create'); }
    finally { setCreating(false); }
  };
  const toggle = async (g) => {
    try { await client.patch(`chat/admin/guests/${g.id}`, { is_active: !g.is_active }); toast.success(g.is_active ? 'Link disabled' : 'Link enabled'); load(); }
    catch { toast.error('Failed'); }
  };
  const del = async (g) => {
    if (!window.confirm(`Delete guest "${g.name}"? The link stops working permanently.`)) return;
    try { await client.delete(`chat/admin/guests/${g.id}`); load(); } catch { toast.error('Failed'); }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center gap-2">
        <Link2 size={16} style={{ color: 'var(--color-primary-600)' }} />
        <h3 className="text-sm font-bold text-text">Guest links</h3>
      </div>
      {!canManage && <Alert type="info">You can view guest links but not change them.</Alert>}

      <div className="rounded-2xl p-4" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
        <h4 className="font-bold text-sm mb-3 flex items-center gap-2" style={{ color: 'var(--color-text)' }}><UserPlus size={16} /> Create a guest link</h4>
        <div className="space-y-2.5">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-text-secondary)' }}>Guest name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. John — Vendor" className="input w-full" />
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <div className="flex-1 min-w-0">
              <label className="block text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-text-secondary)' }}>Group they'll see</label>
              <ThemedSelect value={groupId} onChange={e => setGroupId(e.target.value)} className="input w-full">
                <option value="">Pick a group…</option>
                {groups.map(g => <option key={g.id} value={g.id}>{convName(g)}</option>)}
              </ThemedSelect>
            </div>
            {canManage && <Button onClick={create} disabled={creating} className="whitespace-nowrap sm:w-auto">{creating ? 'Creating…' : 'Create link'}</Button>}
          </div>
        </div>
        <p className="text-[11px] mt-2" style={{ color: 'var(--color-text-tertiary)' }}>
          The guest opens the link and only sees this one group's chat — no search, no other groups. Disable any time to kill the link; re-enable to restore it (same URL).
        </p>
      </div>

      <div className="space-y-2">
        {loading ? <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin" style={{ color: 'var(--color-primary-600)' }} /></div>
          : guests.length === 0 ? <p className="text-sm text-center py-8" style={{ color: 'var(--color-text-tertiary)' }}>No guest links yet.</p>
            : guests.map(g => <GuestRow key={g.id} g={g} group={groupNameOf(g.conversation_id)} onToggle={toggle} onDelete={del} canManage={canManage} />)}
      </div>
    </div>
  );
}
