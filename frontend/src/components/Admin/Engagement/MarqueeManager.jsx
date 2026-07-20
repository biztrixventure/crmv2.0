import { useEffect, useState } from 'react';
import { Radio, Plus, Edit2, Trash2, X, Eye, EyeOff } from 'lucide-react';
import { Button, Alert, Badge } from '../../UI';
import client from '../../../api/client';
import AudienceTargetPicker from './AudienceTargetPicker';
import MarqueeStrip from '../../Engagement/MarqueeStrip';
import ThemedSelect from '../../UI/Select';
import ThemedDate from '../../UI/ThemedDate';

const blank = { byline: '📢 NEWS:', content: '', speed: 'normal', bg_color: '#1e40af', text_color: '#ffffff', target_company_ids: [], target_roles: [], target_user_ids: [], starts_at: '', ends_at: '', is_active: true };

const Modal = ({ row, reference, onClose, onSave }) => {
  const [form, setForm] = useState(row ? { ...blank, ...row, starts_at: row.starts_at ? row.starts_at.slice(0, 16) : '', ends_at: row.ends_at ? row.ends_at.slice(0, 16) : '' } : blank);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.byline.trim() || !form.content.trim()) { setErr('Byline and content are required.'); return; }
    setSaving(true); setErr('');
    try {
      await onSave({ ...form, starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : new Date().toISOString(), ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null });
      onClose();
    } catch (er) { setErr(er.response?.data?.error || 'Failed to save'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto" style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="relative w-full max-w-xl my-6 rounded-2xl animate-scale-in" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}>
        <div className="flex items-center justify-between px-6 py-4 rounded-t-2xl" style={{ background: 'var(--gradient-sidebar)' }}>
          <div className="flex items-center gap-2.5"><Radio size={20} className="text-white" /><h3 className="text-lg font-bold text-white">{row ? 'Edit Marquee' : 'New Marquee'}</h3></div>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30"><X size={18} className="text-white" /></button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {err && <Alert type="error" message={err} />}
          {/* Live preview */}
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            <MarqueeStrip item={form} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Byline <span style={{ color: '#ef4444' }}>*</span></label>
              <input value={form.byline} onChange={e => set('byline', e.target.value)} className="input" placeholder="🔥 BREAKING:" /></div>
            <div><label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Speed</label>
              <ThemedSelect value={form.speed} onChange={e => set('speed', e.target.value)} className="input"><option value="slow">Slow</option><option value="normal">Normal</option><option value="fast">Fast</option></ThemedSelect></div>
          </div>
          <div><label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Content <span style={{ color: '#ef4444' }}>*</span></label>
            <input value={form.content} onChange={e => set('content', e.target.value)} className="input" placeholder="The scrolling message…" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Background</label>
              <input type="color" value={form.bg_color} onChange={e => set('bg_color', e.target.value)} className="input h-10 p-1" /></div>
            <div><label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Text color</label>
              <input type="color" value={form.text_color} onChange={e => set('text_color', e.target.value)} className="input h-10 p-1" /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Starts</label>
              <ThemedDate withTime value={form.starts_at} onChange={e => set('starts_at', e.target.value)} className="input" /></div>
            <div><label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Ends</label>
              <ThemedDate withTime value={form.ends_at} onChange={e => set('ends_at', e.target.value)} className="input" /></div>
          </div>
          <AudienceTargetPicker value={form} onChange={v => setForm(f => ({ ...f, ...v }))} reference={reference} />
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} /><span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Active</span>
          </label>
          <div className="flex gap-3 pt-2"><Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancel</Button><Button type="submit" variant="primary" disabled={saving} className="flex-1">{saving ? 'Saving…' : row ? 'Save' : 'Create'}</Button></div>
        </form>
      </div>
    </div>
  );
};

const MarqueeManager = () => {
  const [rows, setRows] = useState([]);
  const [reference, setReference] = useState({ roles: [], companies: [], users: [] });
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [error, setError] = useState('');

  const load = async () => { setLoading(true); try { const r = await client.get('marquee/manage'); setRows(r.data.items || []); } catch (e) { setError(e.response?.data?.error || 'Failed to load'); } finally { setLoading(false); } };
  useEffect(() => { load(); client.get('marquee/reference').then(r => setReference(r.data)).catch(() => {}); }, []);

  const save = async (payload) => { if (modal?.row) await client.put(`marquee/${modal.row.id}`, payload); else await client.post('marquee', payload); load(); };
  const toggle = async (m) => { await client.put(`marquee/${m.id}`, { is_active: !m.is_active }); load(); };
  const del = async (m) => { try { await client.delete(`marquee/${m.id}`); } catch {} setConfirm(null); load(); };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="rounded-2xl p-6 relative overflow-hidden flex items-center justify-between flex-wrap gap-3" style={{ background: 'var(--gradient-sidebar)' }}>
        <div className="flex items-center gap-2.5"><Radio size={22} className="text-white" /><div>
          <h2 className="text-2xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>Marquee</h2>
          <p className="text-sm text-white/80">Scrolling banners shown at the top of the app.</p>
        </div></div>
        <Button variant="primary" onClick={() => setModal({ row: null })} className="flex items-center gap-1.5"><Plus size={16} /> New Marquee</Button>
      </div>

      {error && <Alert type="error" message={error} />}

      {loading ? <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>
      : rows.length === 0 ? <div className="rounded-2xl p-12 text-center" style={{ backgroundColor: 'var(--color-surface)', border: '1px dashed var(--color-border)' }}><Radio size={40} className="mx-auto mb-3" style={{ color: 'var(--color-text-tertiary)', opacity: 0.5 }} /><p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>No marquee items yet.</p></div>
      : (
        <div className="space-y-2.5">
          {rows.map(m => (
            <div key={m.id} className={`rounded-xl overflow-hidden ${m.is_active ? '' : 'opacity-60'}`} style={{ border: '1px solid var(--color-border)' }}>
              <MarqueeStrip item={m} />
              <div className="flex items-center justify-between gap-3 px-4 py-2" style={{ backgroundColor: 'var(--color-surface)' }}>
                <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  <Badge variant={m.is_active ? 'success' : 'secondary'} size="sm">{m.is_active ? 'Active' : 'Off'}</Badge>
                  <span className="ml-2 capitalize">{m.speed}</span>
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={() => toggle(m)} className="p-1.5 rounded hover:bg-bg-secondary">{m.is_active ? <Eye size={15} style={{ color: 'var(--color-success-600)' }} /> : <EyeOff size={15} style={{ color: 'var(--color-text-tertiary)' }} />}</button>
                  <button onClick={() => setModal({ row: m })} className="p-1.5 rounded hover:bg-bg-secondary"><Edit2 size={15} style={{ color: 'var(--color-primary-500)' }} /></button>
                  <button onClick={() => setConfirm(m)} className="p-1.5 rounded hover:bg-error-50"><Trash2 size={15} style={{ color: 'var(--color-error-500)' }} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && <Modal row={modal.row} reference={reference} onClose={() => setModal(null)} onSave={save} />}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-md p-6 rounded-2xl" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <h3 className="text-lg font-bold mb-1" style={{ color: 'var(--color-text)' }}>Delete marquee</h3>
            <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>Delete this marquee item? This cannot be undone.</p>
            <div className="flex gap-3"><Button variant="secondary" onClick={() => setConfirm(null)} className="flex-1">Cancel</Button><Button variant="danger" onClick={() => del(confirm)} className="flex-1">Delete</Button></div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MarqueeManager;
