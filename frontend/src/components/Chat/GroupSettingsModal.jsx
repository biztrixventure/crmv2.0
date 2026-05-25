import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Settings, Camera, Loader2, UserPlus, Shield, UserMinus, LogOut, Trash2, Check, Crown,
} from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';
import { uploadChatFile } from '../../utils/chatHtml';
import Avatar from './Avatar';
import InvitePicker from './InvitePicker';

// Group settings: admins edit name/description/logo, toggle the "only admins can
// post" policy, manage members (promote / remove), invite, and delete the group.
// Every member can leave; an admin leaving hands the group to a successor.
const GroupSettingsModal = ({ conversation, meId, onClose, onUpdated, onLeft, onDeleted }) => {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState(null);
  const [onlyAdmins, setOnlyAdmins] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [invite, setInvite] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [successor, setSuccessor] = useState('');
  const logoRef = useRef(null);

  const load = async () => {
    try {
      const r = await client.get(`chat/conversations/${conversation.id}`);
      const c = r.data.conversation;
      setDetail(c); setName(c.title || ''); setDescription(c.description || '');
      setImageUrl(c.image_url || null); setOnlyAdmins(!!c.only_admins_post);
    } catch (e) { toast.error(e.response?.data?.error || 'Could not load group'); onClose(); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [conversation.id]);

  const isAdmin = detail?.my_role === 'admin';
  const members = detail?.members || [];
  const others = members.filter(m => m.id !== meId);

  const dirty = detail && (
    name.trim() !== (detail.title || '') ||
    description !== (detail.description || '') ||
    (imageUrl || null) !== (detail.image_url || null) ||
    onlyAdmins !== !!detail.only_admins_post
  );

  const pickLogo = async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) { toast.error('Choose an image file'); return; }
    setUploading(true);
    try { const att = await uploadChatFile(f); setImageUrl(att.url); }
    catch (err) { toast.error(err.response?.data?.error || err.message || 'Upload failed'); }
    finally { setUploading(false); }
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await client.patch(`chat/conversations/${conversation.id}`, {
        title: name, description, image_url: imageUrl, only_admins_post: onlyAdmins,
      });
      const c = r.data.conversation;
      setDetail(d => ({ ...d, title: c.title, description: c.description, image_url: c.image_url, only_admins_post: c.only_admins_post }));
      onUpdated?.({ title: c.title, description: c.description, image_url: c.image_url, only_admins_post: c.only_admins_post });
      toast.success('Group updated');
    } catch (e) { toast.error(e.response?.data?.error || 'Could not save'); }
    finally { setSaving(false); }
  };

  const promote = async (m) => {
    setBusyId(m.id);
    try {
      await client.post(`chat/conversations/${conversation.id}/members/${m.id}/promote`);
      setDetail(d => ({ ...d, members: d.members.map(x => x.id === m.id ? { ...x, member_role: 'admin' } : x) }));
      toast.success(`${m.name} is now an admin`);
    } catch (e) { toast.error(e.response?.data?.error || 'Could not promote'); }
    finally { setBusyId(null); }
  };

  const remove = async (m) => {
    if (!window.confirm(`Remove ${m.name} from the group?`)) return;
    setBusyId(m.id);
    try {
      await client.delete(`chat/conversations/${conversation.id}/members/${m.id}`);
      setDetail(d => ({ ...d, members: d.members.filter(x => x.id !== m.id) }));
      toast.success(`${m.name} removed`);
    } catch (e) { toast.error(e.response?.data?.error || 'Could not remove'); }
    finally { setBusyId(null); }
  };

  const leave = async () => {
    setSaving(true);
    try {
      const r = await client.post(`chat/conversations/${conversation.id}/leave`, successor ? { new_admin_id: successor } : {});
      toast.success(r.data.deleted ? 'You left — the empty group was removed' : 'You left the group');
      onLeft?.();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not leave'); setSaving(false); }
  };

  const del = async () => {
    if (!window.confirm('Delete this group for everyone? This cannot be undone.')) return;
    setSaving(true);
    try { await client.delete(`chat/conversations/${conversation.id}`); toast.success('Group deleted'); onDeleted?.(); }
    catch (e) { toast.error(e.response?.data?.error || 'Could not delete'); setSaving(false); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[2147483647] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(2px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl overflow-hidden flex flex-col max-h-[88vh]"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}>

        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0" style={{ background: 'var(--gradient-sidebar)' }}>
          <span className="flex items-center gap-2 font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>
            <Settings size={18} /> Group settings
          </span>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30"><X size={18} className="text-white" /></button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 size={26} className="animate-spin" style={{ color: 'var(--color-primary-600)' }} /></div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Logo + name */}
            <div className="flex flex-col items-center gap-3">
              <div className="relative">
                <Avatar name={name} group src={imageUrl} size={76} />
                {isAdmin && (
                  <button onClick={() => logoRef.current?.click()} title="Change logo"
                    className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full flex items-center justify-center text-white border-2"
                    style={{ background: 'var(--gradient-sidebar)', borderColor: 'var(--color-surface)' }}>
                    {uploading ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                  </button>
                )}
                <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={pickLogo} />
              </div>
              {isAdmin ? (
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Group name"
                  className="input text-center font-bold" style={{ maxWidth: 260 }} />
              ) : (
                <p className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>{name}</p>
              )}
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-tertiary)' }}>Description</label>
              {isAdmin ? (
                <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
                  className="input resize-none" placeholder="What's this group about?" />
              ) : (
                <p className="text-sm" style={{ color: description ? 'var(--color-text-secondary)' : 'var(--color-text-tertiary)' }}>{description || 'No description'}</p>
              )}
            </div>

            {/* Policy */}
            {isAdmin && (
              <label className="flex items-center justify-between gap-3 p-3 rounded-xl cursor-pointer" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                <span>
                  <span className="text-sm font-semibold block" style={{ color: 'var(--color-text)' }}>Only admins can post</span>
                  <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Members can read but not send messages</span>
                </span>
                <input type="checkbox" checked={onlyAdmins} onChange={e => setOnlyAdmins(e.target.checked)} className="w-5 h-5 accent-[var(--color-primary-600,#a8885c)]" />
              </label>
            )}
            {!isAdmin && onlyAdmins && (
              <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--color-text-tertiary)' }}><Shield size={13} /> Only admins can post in this group.</p>
            )}

            {isAdmin && dirty && (
              <button onClick={save} disabled={saving || uploading}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-sm text-white disabled:opacity-50" style={{ background: 'var(--gradient-sidebar)' }}>
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Save changes
              </button>
            )}

            {/* Members */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>Members · {members.length}</label>
                {isAdmin && (
                  <button onClick={() => setInvite(true)} className="flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-lg text-white" style={{ background: 'var(--gradient-sidebar)' }}>
                    <UserPlus size={13} /> Invite
                  </button>
                )}
              </div>
              <div className="space-y-1">
                {members.map(m => (
                  <div key={m.id} className="flex items-center gap-2.5 px-2 py-2 rounded-xl" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                    <Avatar name={m.name} size={34} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
                        {m.name}{m.id === meId && ' (You)'}
                        {m.member_role === 'admin' && <Crown size={12} style={{ color: 'var(--color-primary-600)' }} title="Admin" />}
                      </p>
                      {m.role && <p className="text-[10px] truncate" style={{ color: 'var(--color-text-tertiary)' }}>{m.role}</p>}
                    </div>
                    {isAdmin && m.id !== meId && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {m.member_role !== 'admin' && (
                          <button onClick={() => promote(m)} disabled={busyId === m.id} title="Make admin" className="p-1.5 rounded-lg" style={{ color: 'var(--color-primary-600)' }}>
                            {busyId === m.id ? <Loader2 size={14} className="animate-spin" /> : <Shield size={15} />}
                          </button>
                        )}
                        <button onClick={() => remove(m)} disabled={busyId === m.id} title="Remove" className="p-1.5 rounded-lg" style={{ color: '#ef4444' }}>
                          <UserMinus size={15} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Danger zone */}
            <div className="pt-2 space-y-2" style={{ borderTop: '1px solid var(--color-border)' }}>
              {!leaveOpen ? (
                <button onClick={() => setLeaveOpen(true)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm" style={{ backgroundColor: 'rgba(217,119,6,0.10)', color: '#b45309' }}>
                  <LogOut size={15} /> Leave group
                </button>
              ) : (
                <div className="p-3 rounded-xl space-y-2" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                  {isAdmin && others.length > 0 && (
                    <>
                      <p className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>You're an admin. Hand the group to:</p>
                      <select value={successor} onChange={e => setSuccessor(e.target.value)} className="input">
                        <option value="">Longest-standing member (auto)</option>
                        {others.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    </>
                  )}
                  {isAdmin && others.length === 0 && (
                    <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>You're the only member — leaving will delete the group.</p>
                  )}
                  <div className="flex gap-2">
                    <button onClick={() => { setLeaveOpen(false); setSuccessor(''); }} className="flex-1 py-2 rounded-lg text-sm font-semibold" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>Cancel</button>
                    <button onClick={leave} disabled={saving} className="flex-1 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-50" style={{ backgroundColor: '#d97706' }}>
                      {saving ? 'Leaving…' : 'Confirm leave'}
                    </button>
                  </div>
                </div>
              )}

              {isAdmin && (
                <button onClick={del} disabled={saving}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm disabled:opacity-50" style={{ color: '#dc2626', backgroundColor: 'rgba(220,38,38,0.08)' }}>
                  <Trash2 size={15} /> Delete group for everyone
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {invite && <InvitePicker conversation={{ id: conversation.id, title: name }} onClose={() => setInvite(false)} onInvited={load} />}
    </div>,
    document.body,
  );
};

export default GroupSettingsModal;
