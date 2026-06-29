import { useState, useEffect, useCallback } from 'react';
import { LayoutTemplate, Save, Users, Trash2, Check, X } from 'lucide-react';
import client from '../../../api/client';
import { clearDrawerLayoutCache } from '../../../hooks/useDrawerLayout';

const RV_TYPES = ['sale', 'transfer', 'callback'];

// Record-view templates: save a user's drawer layouts as a named set and apply
// it to this user or many others at once. Self-contained — reuses the global
// business_config 'record_view_templates' store (superadmin endpoints).
export default function RecordViewTemplates({ uid, userRole, userName, companyId, config, onApplied }) {
  const [templates, setTemplates] = useState([]);
  const [sel, setSel]       = useState('');      // selected template id
  const [name, setName]     = useState('');
  const [busy, setBusy]     = useState(false);
  const [note, setNote]     = useState(null);    // { type, text }
  const [applyOpen, setApplyOpen] = useState(false);
  const [peers, setPeers]   = useState([]);
  const [picked, setPicked] = useState(() => new Set());

  const flash = (type, text) => { setNote({ type, text }); setTimeout(() => setNote(null), 2200); };

  const loadTemplates = useCallback(() => {
    client.get('users/record-view-templates').then(r => setTemplates(r.data.templates || [])).catch(() => {});
  }, []);
  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  // Capture the user's CURRENT effective layouts (their override, else role seed).
  const captureLayouts = () => {
    const out = {};
    for (const t of RV_TYPES) {
      const l = config[`drawer.layout.${t}.user.${uid}`] || (userRole ? config[`drawer.layout.${t}.${userRole}`] : null);
      if (Array.isArray(l) && l.length) out[t] = l;
    }
    return out;
  };

  const saveTemplate = async () => {
    const nm = name.trim();
    if (!nm) return flash('err', 'Name the template first.');
    const layouts = captureLayouts();
    if (!Object.keys(layouts).length) return flash('err', 'Set at least one drawer layout before saving.');
    setBusy(true);
    try {
      const { data } = await client.post('users/record-view-templates', { name: nm, layouts });
      setTemplates(prev => [...prev, data.template]);
      setName('');
      flash('ok', `Saved “${nm}” (${Object.keys(layouts).join(', ')}).`);
    } catch (e) { flash('err', e.response?.data?.error || 'Save failed'); }
    finally { setBusy(false); }
  };

  const applyToThisUser = async () => {
    const tpl = templates.find(t => t.id === sel);
    if (!tpl) return flash('err', 'Pick a template.');
    setBusy(true);
    try {
      await client.post('users/apply-record-views', { target_user_ids: [uid], layouts: tpl.layouts });
      clearDrawerLayoutCache();
      flash('ok', `Applied “${tpl.name}” to ${userName}.`);
      onApplied?.();
    } catch (e) { flash('err', e.response?.data?.error || 'Apply failed'); }
    finally { setBusy(false); }
  };

  const openApplyOthers = () => {
    const tpl = templates.find(t => t.id === sel);
    if (!tpl) return flash('err', 'Pick a template to apply.');
    setPicked(new Set());
    setApplyOpen(true);
    if (companyId && !peers.length) {
      client.get('users', { params: { company_id: companyId } })
        .then(r => setPeers((r.data.users || []).filter(u => u.user_id && u.user_id !== uid)))
        .catch(() => {});
    }
  };

  const applyToOthers = async () => {
    const tpl = templates.find(t => t.id === sel);
    const ids = [...picked];
    if (!tpl || !ids.length) return;
    setBusy(true);
    try {
      const { data } = await client.post('users/apply-record-views', { target_user_ids: ids, layouts: tpl.layouts });
      flash('ok', `Applied “${tpl.name}” to ${data.applied} user${data.applied === 1 ? '' : 's'}.`);
      setApplyOpen(false);
    } catch (e) { flash('err', e.response?.data?.error || 'Apply failed'); }
    finally { setBusy(false); }
  };

  const deleteTemplate = async (id, nm) => {
    if (!window.confirm(`Delete record-view template “${nm}”?`)) return;
    try {
      await client.delete(`users/record-view-templates/${id}`);
      setTemplates(prev => prev.filter(t => t.id !== id));
      if (sel === id) setSel('');
    } catch { flash('err', 'Delete failed'); }
  };

  const togglePick = (id) => setPicked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const btn = 'text-xs font-semibold px-2.5 py-1.5 rounded-lg border inline-flex items-center gap-1.5 disabled:opacity-50';

  return (
    <div className="rounded-xl p-3 mb-3" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <div className="flex items-center gap-2 mb-2.5">
        <LayoutTemplate size={14} style={{ color: 'var(--color-primary-600)' }} />
        <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">Record-view templates</p>
      </div>

      {/* Apply row */}
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <select value={sel} onChange={e => setSel(e.target.value)} className="input text-sm py-1.5" style={{ minWidth: 180 }}>
          <option value="">{templates.length ? 'Select a template…' : 'No templates yet'}</option>
          {templates.map(t => (
            <option key={t.id} value={t.id}>{t.name} ({Object.keys(t.layouts || {}).join('/') || '—'})</option>
          ))}
        </select>
        <button type="button" onClick={applyToThisUser} disabled={busy || !sel} className={btn}
          style={{ borderColor: 'var(--color-primary-300)', color: 'var(--color-primary-700)' }}>
          <Check size={12} /> Apply to {userName}
        </button>
        <button type="button" onClick={openApplyOthers} disabled={busy || !sel} className={btn}
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
          <Users size={12} /> Apply to others…
        </button>
        {sel && (
          <button type="button" onClick={() => { const t = templates.find(x => x.id === sel); if (t) deleteTemplate(t.id, t.name); }}
            disabled={busy} className={btn} style={{ borderColor: 'var(--color-border)', color: 'var(--color-error-600, #dc2626)' }}>
            <Trash2 size={12} /> Delete
          </button>
        )}
      </div>

      {/* Save row */}
      <div className="flex items-center gap-2 flex-wrap">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="New template name…"
          className="input text-sm py-1.5" style={{ minWidth: 180 }} />
        <button type="button" onClick={saveTemplate} disabled={busy} className={btn}
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
          <Save size={12} /> Save {userName}’s current layout
        </button>
      </div>

      {note && <p className="text-xs mt-2 font-semibold" style={{ color: note.type === 'ok' ? '#16a34a' : '#dc2626' }}>{note.text}</p>}

      {/* Apply-to-others modal */}
      {applyOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }}
          onClick={() => setApplyOpen(false)}>
          <div className="rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <p className="text-sm font-bold text-text">Apply “{templates.find(t => t.id === sel)?.name}” to users</p>
              <button type="button" onClick={() => setApplyOpen(false)} className="p-1 rounded hover:bg-bg-secondary"><X size={16} /></button>
            </div>
            <div className="p-3 overflow-y-auto flex-1">
              {peers.length === 0 ? (
                <p className="text-sm text-text-tertiary p-3">No other users in this company.</p>
              ) : peers.map(p => {
                const nm = [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email;
                const on = picked.has(p.user_id);
                return (
                  <button key={p.user_id} type="button" onClick={() => togglePick(p.user_id)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left hover:bg-bg-secondary">
                    <span className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                      style={{ border: '1px solid', borderColor: on ? 'var(--color-primary-600)' : 'var(--color-border)', background: on ? 'var(--color-primary-600)' : 'transparent' }}>
                      {on && <Check size={11} color="#fff" />}
                    </span>
                    <span className="text-text">{nm}</span>
                    <span className="text-text-tertiary text-xs">· {p.role || p.custom_roles?.level || ''}</span>
                  </button>
                );
              })}
            </div>
            <div className="p-3 flex items-center justify-between gap-2" style={{ borderTop: '1px solid var(--color-border)' }}>
              <span className="text-xs text-text-tertiary">{picked.size} selected</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setApplyOpen(false)} className={btn} style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Cancel</button>
                <button type="button" onClick={applyToOthers} disabled={busy || !picked.size} className={btn}
                  style={{ borderColor: 'var(--color-primary-600)', background: 'var(--color-primary-600)', color: '#fff' }}>
                  <Check size={12} /> Apply to {picked.size}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
