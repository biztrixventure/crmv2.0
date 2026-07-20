import { useEffect, useState } from 'react';
import { Copy, Check, SlidersHorizontal, Plus, Trash2, X, ChevronUp, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';
import ThemedSelect from '../UI/Select';
import {
  SALE_COPY_FIELDS, FIELD_BY_KEY, COPY_SEPARATORS, DEFAULT_PRESET,
  buildCopyString, readPresets,
} from '../../utils/saleCopyFields';

// ============================================================================
// SaleCopyBar — the row of configurable "copy" buttons in the sale drawer header.
// Each button = a saved PRESET (name + ordered field list + separator). Clicking
// copies the sale's values in that arrangement. Managers get a gear to build /
// edit / reorder presets (stored in business_config `copy_presets.sale`).
// ============================================================================

const ctrl = { background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)', borderRadius: 8, padding: '6px 10px', fontSize: 13 };

export default function SaleCopyBar({ sale, canFinancial, canManage }) {
  const [presets, setPresets] = useState(null);   // null = loading
  const [copiedId, setCopiedId] = useState(null);
  const [editing, setEditing] = useState(false);

  const load = () => client.get('business-config')
    .then(r => setPresets(readPresets(r.data?.config)))
    .catch(() => setPresets([DEFAULT_PRESET]));
  useEffect(() => { load(); }, []);

  const doCopy = (preset) => {
    const str = buildCopyString(preset, sale, sale.form_data || {}, canFinancial);
    navigator.clipboard?.writeText(str)
      .then(() => { setCopiedId(preset.id); setTimeout(() => setCopiedId(null), 1400); })
      .catch(() => toast.error('Clipboard blocked by the browser'));
  };

  const list = presets || [DEFAULT_PRESET];
  return (
    <div className="flex items-center gap-1.5">
      {list.map(p => (
        <button key={p.id} onClick={() => doCopy(p)}
          title={`Copy ${p.name} — ${p.fields.length} fields (${(COPY_SEPARATORS.find(s => s.key === p.sep) || {}).label || p.sep})`}
          className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl bg-white/20 hover:bg-white/30 transition-colors text-white text-xs font-bold">
          {copiedId === p.id ? <Check size={15} /> : <Copy size={15} />}
          <span className="max-w-[90px] truncate">{p.name}</span>
        </button>
      ))}
      {canManage && (
        <button onClick={() => setEditing(true)} title="Customize copy buttons"
          className="p-2 rounded-xl bg-white/20 hover:bg-white/30 transition-colors">
          <SlidersHorizontal size={16} className="text-white" />
        </button>
      )}
      {editing && (
        <CopyPresetManager
          initial={list}
          onClose={() => setEditing(false)}
          onSaved={(next) => { setPresets(next); setEditing(false); }}
        />
      )}
    </div>
  );
}

// ── the editor modal ─────────────────────────────────────────────────────────
function CopyPresetManager({ initial, onClose, onSaved }) {
  const [presets, setPresets] = useState(() => JSON.parse(JSON.stringify(initial.length ? initial : [DEFAULT_PRESET])));
  const [selId, setSelId] = useState(presets[0]?.id);
  const [busy, setBusy] = useState(false);
  const [addKey, setAddKey] = useState('');

  const sel = presets.find(p => p.id === selId) || presets[0];
  const patch = (fn) => setPresets(ps => ps.map(p => p.id === sel.id ? fn({ ...p }) : p));

  const addPreset = () => {
    const id = `preset_${Date.now().toString(36)}`;
    const np = { id, name: `Copy ${presets.length + 1}`, sep: 'tab', fields: [] };
    setPresets(ps => [...ps, np]); setSelId(id);
  };
  const removePreset = (id) => {
    setPresets(ps => { const next = ps.filter(p => p.id !== id); if (selId === id) setSelId(next[0]?.id); return next; });
  };
  const addField = (k) => { if (!k) return; patch(p => ({ ...p, fields: [...p.fields, k] })); setAddKey(''); };
  const removeField = (i) => patch(p => ({ ...p, fields: p.fields.filter((_, j) => j !== i) }));
  const moveField = (i, dir) => patch(p => {
    const f = [...p.fields]; const j = i + dir;
    if (j < 0 || j >= f.length) return p; [f[i], f[j]] = [f[j], f[i]]; return { ...p, fields: f };
  });

  const save = async () => {
    setBusy(true);
    try {
      const clean = presets
        .filter(p => (p.name || '').trim())
        .map(p => ({ id: p.id, name: p.name.trim(), sep: p.sep || 'tab', fields: (p.fields || []).filter(k => FIELD_BY_KEY[k]) }));
      await client.put('business-config', { scope: 'global', key: 'copy_presets.sale', value: clean });
      toast.success('Copy buttons saved');
      onSaved(clean.length ? clean : [DEFAULT_PRESET]);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not save (need permission)');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="rounded-2xl overflow-hidden flex flex-col" style={{ width: 'min(760px, 96vw)', maxHeight: '90vh', background: 'var(--color-bg)', border: '1px solid var(--color-border)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="text-base font-bold" style={{ color: 'var(--color-text)' }}>Customize copy buttons</div>
          <button onClick={onClose}><X size={20} style={{ color: 'var(--color-text-tertiary)' }} /></button>
        </div>

        <div className="flex-1 overflow-auto grid" style={{ gridTemplateColumns: '190px 1fr' }}>
          {/* preset list */}
          <div className="p-3 space-y-1.5" style={{ borderRight: '1px solid var(--color-border)' }}>
            {presets.map(p => (
              <div key={p.id} onClick={() => setSelId(p.id)}
                className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg cursor-pointer text-sm font-semibold"
                style={{ background: p.id === sel?.id ? 'var(--color-surface-hover)' : 'transparent', color: 'var(--color-text)' }}>
                <Copy size={13} style={{ color: 'var(--color-text-tertiary)' }} />
                <span className="flex-1 truncate">{p.name || 'Untitled'}</span>
                <button onClick={(e) => { e.stopPropagation(); removePreset(p.id); }} title="Delete"><Trash2 size={13} style={{ color: 'var(--color-error-600)' }} /></button>
              </div>
            ))}
            <button onClick={addPreset} className="w-full mt-1 inline-flex items-center justify-center gap-1 px-2 py-2 rounded-lg text-xs font-bold"
              style={{ background: 'var(--color-surface-hover)', color: 'var(--color-primary-600)' }}><Plus size={14} /> New button</button>
          </div>

          {/* editor for the selected preset */}
          <div className="p-4">
            {!sel ? <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Create a copy button to start.</div> : (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input value={sel.name} onChange={e => patch(p => ({ ...p, name: e.target.value }))} placeholder="Button name (e.g. Silverton)" style={{ ...ctrl, flex: 1 }} />
                  <ThemedSelect value={sel.sep} onChange={e => patch(p => ({ ...p, sep: e.target.value }))} style={ctrl} title="How values are joined">
                    {COPY_SEPARATORS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </ThemedSelect>
                </div>

                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-tertiary)' }}>Fields in order ({sel.fields.length})</div>
                  <div className="space-y-1 max-h-[42vh] overflow-auto rounded-xl p-2" style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                    {sel.fields.length === 0 && <div className="text-xs px-1 py-2" style={{ color: 'var(--color-text-tertiary)' }}>No fields yet — add from the dropdown below.</div>}
                    {sel.fields.map((k, i) => (
                      <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                        <span className="text-[10px] font-bold tabular-nums w-6" style={{ color: 'var(--color-text-tertiary)' }}>{i + 1}</span>
                        <span className="flex-1 text-sm" style={{ color: 'var(--color-text)' }}>{(FIELD_BY_KEY[k] || {}).label || k}</span>
                        <button onClick={() => moveField(i, -1)} disabled={i === 0} title="Up"><ChevronUp size={15} style={{ color: i === 0 ? 'var(--color-text-tertiary)' : 'var(--color-text-secondary)' }} /></button>
                        <button onClick={() => moveField(i, 1)} disabled={i === sel.fields.length - 1} title="Down"><ChevronDown size={15} style={{ color: i === sel.fields.length - 1 ? 'var(--color-text-tertiary)' : 'var(--color-text-secondary)' }} /></button>
                        <button onClick={() => removeField(i)} title="Remove"><X size={15} style={{ color: 'var(--color-error-600)' }} /></button>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 mt-2">
                    <ThemedSelect value={addKey} onChange={e => addField(e.target.value)} style={{ ...ctrl, flex: 1 }}>
                      <option value="">+ Add a field…</option>
                      {SALE_COPY_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </ThemedSelect>
                  </div>
                </div>

                {/* live preview */}
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-text-tertiary)' }}>Preview (labels)</div>
                  <div className="text-[11px] p-2 rounded-lg font-mono overflow-x-auto whitespace-nowrap" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                    {sel.fields.map(k => (FIELD_BY_KEY[k] || {}).label || k).join(sel.sep === 'newline' ? '  ↵  ' : '  •  ') || '—'}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}>Cancel</button>
          <button onClick={save} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-bold text-white" style={{ background: 'var(--gradient-sidebar, linear-gradient(135deg,#2563eb,#7c3aed))', opacity: busy ? 0.6 : 1 }}>Save buttons</button>
        </div>
      </div>
    </div>
  );
}
