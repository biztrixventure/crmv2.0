import { useEffect, useState } from 'react';
import { Megaphone, Plus, Edit2, Trash2, X, Eye, EyeOff } from 'lucide-react';
import { Button, Alert, Badge } from '../../UI';
import RichTextEditor from '../../UI/RichTextEditor';
import { stripHtml } from '../../../utils/sanitizeHtml';
import client from '../../../api/client';
import AudienceTargetPicker from './AudienceTargetPicker';
import ThemedSelect from '../../UI/Select';

const PRIORITY = { normal: { label: 'Normal', variant: 'secondary' }, high: { label: 'High', variant: 'warning' }, urgent: { label: 'Urgent', variant: 'error' } };
const blank = { title: '', body: '', priority: 'normal', reshow_hours: '', target_type: 'global', target_roles: [], target_user_ids: [], target_company_ids: [], expires_at: '', is_active: true };

const targetLabel = (a) => a.target_type === 'global' ? 'Everyone'
  : a.target_type === 'role' ? `Roles: ${(a.target_roles || []).map(r => r.replace(/_/g, ' ')).join(', ') || '—'}`
  : a.target_type === 'users' ? `${(a.target_user_ids || []).length} user(s)`
  : `${(a.target_company_ids || []).length} company(s)`;

const Modal = ({ row, reference, onClose, onSave }) => {
  const [form, setForm] = useState(row ? { ...blank, ...row, expires_at: row.expires_at ? row.expires_at.slice(0, 16) : '' } : blank);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.body.trim()) { setErr('Title and body are required.'); return; }
    setSaving(true); setErr('');
    try { await onSave({ ...form, expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null }); onClose(); }
    catch (er) { setErr(er.response?.data?.error || 'Failed to save'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto" style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="relative w-full max-w-xl my-6 rounded-2xl animate-scale-in" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}>
        <div className="flex items-center justify-between px-6 py-4 rounded-t-2xl" style={{ background: 'var(--gradient-sidebar)' }}>
          <div className="flex items-center gap-2.5"><Megaphone size={20} className="text-white" /><h3 className="text-lg font-bold text-white">{row ? 'Edit Announcement' : 'New Announcement'}</h3></div>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30"><X size={18} className="text-white" /></button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {err && <Alert type="error" message={err} />}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Title <span style={{ color: '#ef4444' }}>*</span></label>
            <input value={form.title} onChange={e => set('title', e.target.value)} className="input" placeholder="System maintenance tonight" />
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Body <span style={{ color: '#ef4444' }}>*</span></label>
            <RichTextEditor value={form.body} onChange={v => set('body', v)} placeholder="Write your announcement — bold, italic, underline, lists, links, images…" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Priority</label>
              <ThemedSelect value={form.priority} onChange={e => set('priority', e.target.value)} className="input">
                <option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
              </ThemedSelect>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Re-show (hrs)</label>
              <input type="number" min="1" value={form.reshow_hours} onChange={e => set('reshow_hours', e.target.value)} className="input" placeholder="once" />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Expires at</label>
              <input type="datetime-local" value={form.expires_at} onChange={e => set('expires_at', e.target.value)} className="input" />
            </div>
          </div>
          <p className="text-[11px] -mt-2" style={{ color: 'var(--color-text-tertiary)' }}>Re-show: pops up again every N hours after an agent dismisses it. Leave blank to show once.</p>
          <AudienceTargetPicker withType value={form} onChange={v => setForm(f => ({ ...f, ...v }))} reference={reference} />
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} />
            <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Active</span>
          </label>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
            <Button type="submit" variant="primary" disabled={saving} className="flex-1">{saving ? 'Saving…' : row ? 'Save' : 'Create'}</Button>
          </div>
        </form>
      </div>
    </div>
  );
};

const AnnouncementsManager = () => {
  const [rows, setRows] = useState([]);
  const [reference, setReference] = useState({ roles: [], companies: [], users: [] });
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try { const r = await client.get('announcements/manage'); setRows(r.data.announcements || []); }
    catch (e) { setError(e.response?.data?.error || 'Failed to load'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); client.get('announcements/reference').then(r => setReference(r.data)).catch(() => {}); }, []);

  const save = async (payload) => {
    if (modal?.row) await client.put(`announcements/${modal.row.id}`, payload);
    else await client.post('announcements', payload);
    load();
  };
  const toggle = async (a) => { await client.put(`announcements/${a.id}`, { is_active: !a.is_active }); load(); };
  const del = async (a) => { try { await client.delete(`announcements/${a.id}`); } catch {} setConfirm(null); load(); };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="rounded-2xl p-6 relative overflow-hidden flex items-center justify-between flex-wrap gap-3" style={{ background: 'var(--gradient-sidebar)' }}>
        <div className="flex items-center gap-2.5"><Megaphone size={22} className="text-white" /><div>
          <h2 className="text-2xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>Announcements</h2>
          <p className="text-sm text-white/80">Broadcast messages to everyone, roles, companies, or specific users.</p>
        </div></div>
        <Button variant="primary" onClick={() => setModal({ row: null })} className="flex items-center gap-1.5"><Plus size={16} /> New Announcement</Button>
      </div>

      {error && <Alert type="error" message={error} />}

      {loading ? <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>
      : rows.length === 0 ? <div className="rounded-2xl p-12 text-center" style={{ backgroundColor: 'var(--color-surface)', border: '1px dashed var(--color-border)' }}><Megaphone size={40} className="mx-auto mb-3" style={{ color: 'var(--color-text-tertiary)', opacity: 0.5 }} /><p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>No announcements yet.</p></div>
      : (
        <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <table className="w-full text-sm">
            <thead><tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
              {['Title', 'Audience', 'Priority', 'Reads', 'Status', ''].map(h => <th key={h} className="px-4 py-2.5 text-left text-xs font-bold uppercase" style={{ color: 'var(--color-text-secondary)' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map(a => (
                <tr key={a.id} className={a.is_active ? '' : 'opacity-60'} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td className="px-4 py-3"><p className="font-semibold" style={{ color: 'var(--color-text)' }}>{a.title}{a.reshow_hours ? <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>↻ {a.reshow_hours}h</span> : null}</p><p className="text-xs line-clamp-1" style={{ color: 'var(--color-text-secondary)' }}>{stripHtml(a.body)}</p></td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{targetLabel(a)}</td>
                  <td className="px-4 py-3"><Badge variant={PRIORITY[a.priority]?.variant || 'secondary'} size="sm">{PRIORITY[a.priority]?.label}</Badge></td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{a.read_count}</td>
                  <td className="px-4 py-3"><Badge variant={a.is_active ? 'success' : 'secondary'} size="sm">{a.is_active ? 'Active' : 'Off'}</Badge></td>
                  <td className="px-4 py-3"><div className="flex items-center gap-1">
                    <button onClick={() => toggle(a)} title={a.is_active ? 'Deactivate' : 'Activate'} className="p-1.5 rounded hover:bg-bg-secondary">{a.is_active ? <Eye size={15} style={{ color: 'var(--color-success-600)' }} /> : <EyeOff size={15} style={{ color: 'var(--color-text-tertiary)' }} />}</button>
                    <button onClick={() => setModal({ row: a })} title="Edit" className="p-1.5 rounded hover:bg-bg-secondary"><Edit2 size={15} style={{ color: 'var(--color-primary-500)' }} /></button>
                    <button onClick={() => setConfirm(a)} title="Delete" className="p-1.5 rounded hover:bg-error-50"><Trash2 size={15} style={{ color: 'var(--color-error-500)' }} /></button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && <Modal row={modal.row} reference={reference} onClose={() => setModal(null)} onSave={save} />}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-md p-6 rounded-2xl" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <h3 className="text-lg font-bold mb-1" style={{ color: 'var(--color-text)' }}>Delete announcement</h3>
            <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>Delete “{confirm.title}”? This cannot be undone.</p>
            <div className="flex gap-3"><Button variant="secondary" onClick={() => setConfirm(null)} className="flex-1">Cancel</Button><Button variant="danger" onClick={() => del(confirm)} className="flex-1">Delete</Button></div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AnnouncementsManager;
