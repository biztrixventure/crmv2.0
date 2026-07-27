// GuestLinksPanel — external guest chat links, surfaced inside the Clients &
// Plans command center (alongside portal accounts, since both are "external
// access"). Self-contained: hits the same chat/admin/guests endpoints as the
// Chat Control → Guest Links tab, which stays in place. Nothing removed.
//
// UI from components/UI/kit (docs/ui-design-system.md).
import { useState, useEffect, useCallback } from 'react';
import { Link2, UserPlus, Copy, Check, Power, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Alert } from '../../../components/UI';
import client from '../../../api/client';
import { useAuth } from '../../../contexts/AuthContext';
import ThemedSelect from '../../UI/Select';
import { Panel, SectionHeader, Loading, EmptyState, Field, accent } from '../../UI/kit';

const convName = (g) => g?.name || g?.title || g?.subject || 'Group';

function GuestRow({ g, group, onToggle, onDelete, canManage }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/guest/${g.token}`;
  const copy = () => { navigator.clipboard?.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const ok = accent('success');
  const bad = accent('danger');
  const iconBtn = 'p-2 rounded-lg';
  return (
    <Panel radius="xl" pad="sm" className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
          {g.name}
          <span className="text-[11px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded"
            style={{ background: g.is_active ? ok.soft : bad.soft, color: g.is_active ? ok.fg : bad.fg }}>
            {g.is_active ? 'Active' : 'Disabled'}
          </span>
        </p>
        <p className="text-[11px] truncate" style={{ color: 'var(--color-text-tertiary)' }}>→ {group || 'group'} · <span className="font-mono">{url}</span></p>
      </div>
      <button onClick={copy} title="Copy link" className={iconBtn} style={{ background: 'var(--color-bg-secondary)' }}>
        {copied ? <Check size={14} style={{ color: ok.fg }} /> : <Copy size={14} style={{ color: 'var(--color-text-secondary)' }} />}
      </button>
      <button onClick={() => onToggle(g)} title={g.is_active ? 'Disable link' : 'Enable link'} className={iconBtn} style={{ background: 'var(--color-bg-secondary)' }}>
        <Power size={14} style={{ color: g.is_active ? bad.fg : ok.fg }} />
      </button>
      {canManage && (
        <button onClick={() => onDelete(g)} title="Delete" className={iconBtn} style={{ background: 'var(--color-bg-secondary)' }}>
          <Trash2 size={14} style={{ color: bad.fg }} />
        </button>
      )}
    </Panel>
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
      <SectionHeader icon={Link2} title="Guest links" />
      {!canManage && <Alert type="info">You can view guest links but not change them.</Alert>}

      <Panel tone="inset" radius="2xl">
        <SectionHeader level="sub" icon={UserPlus} title="Create a guest link" />
        <div className="space-y-2.5">
          <Field label="Guest name">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. John — Vendor" className="input w-full" />
          </Field>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <Field label="Group they'll see" className="flex-1 min-w-0">
              <ThemedSelect value={groupId} onChange={e => setGroupId(e.target.value)} className="input w-full">
                <option value="">Pick a group…</option>
                {groups.map(g => <option key={g.id} value={g.id}>{convName(g)}</option>)}
              </ThemedSelect>
            </Field>
            {canManage && <Button onClick={create} disabled={creating} className="whitespace-nowrap sm:w-auto">{creating ? 'Creating…' : 'Create link'}</Button>}
          </div>
        </div>
        <p className="text-[11px] mt-2" style={{ color: 'var(--color-text-tertiary)' }}>
          The guest opens the link and only sees this one group's chat — no search, no other groups. Disable any time to kill the link; re-enable to restore it (same URL).
        </p>
      </Panel>

      <div className="space-y-2">
        {loading ? <Loading variant="rows" rows={3} label="Loading guest links…" />
          : guests.length === 0 ? <EmptyState icon={Link2} title="No guest links yet" hint="Create one above to give an outsider access to a single group chat." />
            : guests.map(g => <GuestRow key={g.id} g={g} group={groupNameOf(g.conversation_id)} onToggle={toggle} onDelete={del} canManage={canManage} />)}
      </div>
    </div>
  );
}
