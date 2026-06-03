import { useState, useEffect, useCallback } from 'react';
import { toast, toastError } from '../../../utils/toast';
import { Plus, X, Save, Edit3, Bell, BellOff, MessageSquare, GripVertical, Globe, Building2, RotateCcw, Trash2, EyeOff, Info } from 'lucide-react';
import client from '../../../api/client';

const NOTIFIABLE_ROLES = [
  { value: 'closer_manager',     label: 'Closer Manager'     },
  { value: 'operations_manager', label: 'Operations Manager' },
  { value: 'company_admin',      label: 'Company Admin'      },
  { value: 'fronter_manager',    label: 'Fronter Manager'    },
  { value: 'compliance_manager', label: 'Compliance Manager' },
];

const PRESET_COLORS = [
  '#dc2626','#ea580c','#d97706','#16a34a','#0891b2',
  '#2563eb','#7c3aed','#db2777','#6b7280','#1f2937',
];

// ── Disposition config form (used for both create and edit) ───────────────────
const DispositionForm = ({ initial, onSave, onCancel, saving }) => {
  const [form, setForm] = useState({
    name:                  initial?.name                  || '',
    color:                 initial?.color                 || '#6b7280',
    description:           initial?.description           || '',
    notify_roles:          initial?.notify_roles          || [],
    notify_fronter:        initial?.notify_fronter        ?? false,
    notify_fronter_manager:initial?.notify_fronter_manager?? false,
    requires_note:         initial?.requires_note         ?? false,
    sort_order:            initial?.sort_order            ?? 0,
  });
  const [err, setErr] = useState('');

  const toggleRole = (role) =>
    setForm(prev => ({
      ...prev,
      notify_roles: prev.notify_roles.includes(role)
        ? prev.notify_roles.filter(r => r !== role)
        : [...prev.notify_roles, role],
    }));

  const handleSave = () => {
    if (!form.name.trim()) { setErr('Name is required'); return; }
    setErr('');
    onSave(form);
  };

  return (
    <div className="space-y-4">
      {/* Name + Color row */}
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>
            Disposition Name *
          </label>
          <input
            value={form.name}
            onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
            placeholder="e.g. Not Interested"
            className="input text-sm w-full"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>
            Color
          </label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={form.color}
              onChange={e => setForm(p => ({ ...p, color: e.target.value }))}
              className="w-10 h-9 rounded cursor-pointer border"
              style={{ borderColor: 'var(--color-border)', padding: 2 }}
            />
            <div className="flex gap-1 flex-wrap" style={{ maxWidth: 120 }}>
              {PRESET_COLORS.map(c => (
                <button
                  key={c} type="button"
                  onClick={() => setForm(p => ({ ...p, color: c }))}
                  className="w-5 h-5 rounded-full transition-transform hover:scale-125"
                  style={{ backgroundColor: c, outline: form.color === c ? `2px solid ${c}` : 'none', outlineOffset: 2 }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Description */}
      <div>
        <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>
          Description (optional)
        </label>
        <input
          value={form.description}
          onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
          placeholder="Brief description for admins"
          className="input text-sm w-full"
        />
      </div>

      {/* Notify roles */}
      <div>
        <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>
          Notify Roles (within closer's company)
        </label>
        <div className="flex flex-wrap gap-2">
          {NOTIFIABLE_ROLES.map(r => {
            const on = form.notify_roles.includes(r.value);
            return (
              <button
                key={r.value} type="button"
                onClick={() => toggleRole(r.value)}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
                style={{
                  backgroundColor: on ? 'var(--color-primary-100)' : 'var(--color-bg-secondary)',
                  color:           on ? 'var(--color-primary-700)' : 'var(--color-text-secondary)',
                  border:          `1.5px solid ${on ? 'var(--color-primary-400)' : 'var(--color-border)'}`,
                }}>
                {r.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Cross-company notifications */}
      <div>
        <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>
          Cross-Company Notifications (fronter side)
        </label>
        <div className="flex flex-wrap gap-3">
          {[
            { key: 'notify_fronter',         label: 'Notify Fronter',         desc: 'The agent who created the transfer' },
            { key: 'notify_fronter_manager', label: 'Notify Fronter Manager', desc: 'Managers in the fronter company'    },
          ].map(({ key, label, desc }) => {
            const on = form[key];
            return (
              <button
                key={key} type="button"
                onClick={() => setForm(p => ({ ...p, [key]: !p[key] }))}
                className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all"
                style={{
                  backgroundColor: on ? 'var(--color-success-50, #f0fdf4)' : 'var(--color-bg-secondary)',
                  border:          `1.5px solid ${on ? 'var(--color-success-400, #4ade80)' : 'var(--color-border)'}`,
                  minWidth: 160,
                }}>
                <div className="mt-0.5 flex-shrink-0">
                  {on
                    ? <Bell size={13} style={{ color: 'var(--color-success-600, #16a34a)' }} />
                    : <BellOff size={13} style={{ color: 'var(--color-text-tertiary)' }} />}
                </div>
                <div>
                  <p className="text-xs font-bold" style={{ color: on ? 'var(--color-success-700, #15803d)' : 'var(--color-text-secondary)' }}>{label}</p>
                  <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{desc}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Requires note */}
      <div>
        <button
          type="button"
          onClick={() => setForm(p => ({ ...p, requires_note: !p.requires_note }))}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all w-full"
          style={{
            backgroundColor: form.requires_note ? 'rgba(245,158,11,0.08)' : 'var(--color-bg-secondary)',
            border:          `1.5px solid ${form.requires_note ? 'rgba(245,158,11,0.4)' : 'var(--color-border)'}`,
          }}>
          <MessageSquare size={14} style={{ color: form.requires_note ? '#d97706' : 'var(--color-text-tertiary)', flexShrink: 0 }} />
          <div>
            <p className="text-xs font-bold" style={{ color: form.requires_note ? '#92400e' : 'var(--color-text-secondary)' }}>
              Requires a Note
            </p>
            <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              Closer must enter a note before submitting this disposition
            </p>
          </div>
          <div className="ml-auto flex-shrink-0 w-9 h-5 rounded-full relative transition-colors"
            style={{ backgroundColor: form.requires_note ? '#d97706' : 'var(--color-border)' }}>
            <div className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all"
              style={{ left: form.requires_note ? '18px' : '2px' }} />
          </div>
        </button>
      </div>

      {err && <p className="text-xs font-semibold" style={{ color: 'var(--color-error-600)' }}>{err}</p>}

      <div className="flex gap-3 pt-1">
        <button type="button" onClick={onCancel}
          className="flex-1 py-2 rounded-xl border text-sm font-semibold"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
          Cancel
        </button>
        <button type="button" onClick={handleSave} disabled={saving}
          className="flex-1 py-2 rounded-xl text-sm font-bold text-white transition-all hover:scale-[1.02] disabled:opacity-50"
          style={{ background: 'var(--gradient-sidebar)' }}>
          {saving ? 'Saving…' : <><Save size={13} className="inline mr-1.5" />Save</>}
        </button>
      </div>
    </div>
  );
};

// ── Disposition card ──────────────────────────────────────────────────────────
const DispoCard = ({ config, onEdit, onDeactivate, onActivate, onHardDelete, busyId }) => {
  const notifSummary = [
    ...(config.notify_roles || []).map(r => NOTIFIABLE_ROLES.find(x => x.value === r)?.label || r),
    config.notify_fronter         ? 'Fronter'         : null,
    config.notify_fronter_manager ? 'Fronter Mgr'     : null,
  ].filter(Boolean);
  const inactive = config.is_active === false;
  const busy = busyId === config.id;

  return (
    <div className="flex items-start gap-3 px-4 py-3.5 group transition-colors hover:bg-bg-secondary"
      style={{
        borderBottom: '1px solid var(--color-border)',
        opacity: inactive ? 0.55 : 1,
        backgroundColor: inactive ? 'var(--color-bg-secondary)' : undefined,
      }}>
      {/* Color strip — desaturated when inactive */}
      <div className="flex-shrink-0 w-1 h-14 rounded-full self-stretch"
        style={{ backgroundColor: inactive ? 'var(--color-border)' : config.color }} />

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-sm"
            style={{
              color: inactive ? 'var(--color-text-tertiary)' : 'var(--color-text)',
              textDecoration: inactive ? 'line-through' : 'none',
            }}>
            {config.name}
          </span>
          {inactive && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-tertiary)', border: '1px solid var(--color-border)' }}>
              <EyeOff size={9} /> Disabled
            </span>
          )}
          {config.requires_note && (
            <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full font-semibold"
              style={{ backgroundColor: 'rgba(245,158,11,0.1)', color: '#b45309' }}>
              <MessageSquare size={9} /> Note req.
            </span>
          )}
          {config.company_id === null && (
            <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full font-semibold"
              style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}>
              <Globe size={9} /> global
            </span>
          )}
          {config.company_id !== null && (
            <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full font-semibold"
              style={{ backgroundColor: 'var(--color-primary-50)', color: 'var(--color-primary-700)' }}>
              <Building2 size={9} /> company
            </span>
          )}
        </div>
        {config.description && (
          <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-text-tertiary)' }}>{config.description}</p>
        )}
        {notifSummary.length > 0 && (
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            <Bell size={10} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
            <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              {notifSummary.join(' · ')}
            </span>
          </div>
        )}
      </div>

      {/* Actions — active row: edit + deactivate. inactive row: activate + permanent delete. */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {inactive ? (
          <>
            <button onClick={() => onActivate(config)} disabled={busy}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold disabled:opacity-40"
              style={{ backgroundColor: 'var(--color-success-50, #f0fdf4)', color: 'var(--color-success-700, #15803d)', border: '1px solid var(--color-success-300, #86efac)', minHeight: 28 }}
              title="Bring this disposition back so closers can use it again">
              <RotateCcw size={11} /> Activate
            </button>
            <button onClick={() => onHardDelete(config)} disabled={busy}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold disabled:opacity-40"
              style={{ backgroundColor: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', minHeight: 28 }}
              title="Permanently remove this row (history is kept — closers stored the name as a snapshot)">
              <Trash2 size={11} /> Delete permanently
            </button>
          </>
        ) : (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => onEdit(config)}
              className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-primary-100"
              title="Edit">
              <Edit3 size={13} style={{ color: 'var(--color-primary-600)' }} />
            </button>
            <button onClick={() => onDeactivate(config)} disabled={busy}
              className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-error-100 disabled:opacity-40"
              title="Disable — closer dropdowns drop it. Reversible.">
              {busy
                ? <div className="animate-spin w-3 h-3 border-b-2 border-error-500 rounded-full" />
                : <EyeOff size={13} style={{ color: '#ef4444' }} />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Root component ─────────────────────────────────────────────────────────────
const DispositionManager = () => {
  const [configs,  setConfigs]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editing,  setEditing]  = useState(null); // config object being edited

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.get('disposition-configs/all');
      setConfigs(res.data.configs || []);
    } catch { /* non-critical */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (form) => {
    setSaving(true);
    try {
      await client.post('disposition-configs', form);
      await load();
      setShowForm(false);
    } catch (err) {
      toastError(err, 'Failed to create disposition');
    } finally { setSaving(false); }
  };

  const handleUpdate = async (form) => {
    setSaving(true);
    try {
      await client.put(`disposition-configs/${editing.id}`, form);
      await load();
      setEditing(null);
      toast.success('Disposition updated');
    } catch (err) {
      toastError(err, 'Failed to update disposition');
    } finally { setSaving(false); }
  };

  const handleDeactivate = async (cfg) => {
    if (!window.confirm(`Disable "${cfg.name}"?\n\nClosers will no longer see it in their dispositions dropdown. Existing records keep the label in their audit log. You can re-enable any time.`)) return;
    setDeleting(cfg.id);
    try {
      await client.delete(`disposition-configs/${cfg.id}`);
      await load();
      toast.success(`"${cfg.name}" disabled`);
    } catch (err) {
      toastError(err, 'Failed to disable disposition');
    } finally { setDeleting(null); }
  };

  const handleActivate = async (cfg) => {
    setDeleting(cfg.id);
    try {
      await client.put(`disposition-configs/${cfg.id}`, { is_active: true });
      await load();
      toast.success(`"${cfg.name}" re-enabled`);
    } catch (err) {
      toastError(err, 'Failed to re-enable disposition');
    } finally { setDeleting(null); }
  };

  const handleHardDelete = async (cfg) => {
    if (!window.confirm(`Permanently delete "${cfg.name}"?\n\nThe config row is removed. Existing call records keep their text snapshot — the audit log is not affected. This action cannot be undone.`)) return;
    setDeleting(cfg.id);
    try {
      await client.delete(`disposition-configs/${cfg.id}?hard=true`);
      await load();
      toast.success(`"${cfg.name}" permanently deleted`);
    } catch (err) {
      toastError(err, 'Failed to delete disposition');
    } finally { setDeleting(null); }
  };

  return (
    <div className="max-w-2xl animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: 'rgba(220,38,38,0.1)' }}>
            <MessageSquare size={20} style={{ color: '#dc2626' }} />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-text">Dispositions</h2>
            <p className="text-sm text-text-secondary mt-0.5">
              Call outcome options shown to closers in phone search alongside the Sale button.
            </p>
          </div>
        </div>
        {!showForm && !editing && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all hover:scale-105"
            style={{ background: 'var(--gradient-sidebar)' }}>
            <Plus size={15} /> Add Disposition
          </button>
        )}
      </div>

      {/* Create form */}
      {showForm && (
        <div className="rounded-2xl p-5 mb-6"
          style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <p className="text-sm font-bold text-text mb-4 flex items-center gap-2">
            <Plus size={15} style={{ color: 'var(--color-primary-500)' }} /> New Disposition
          </p>
          <DispositionForm
            onSave={handleCreate}
            onCancel={() => setShowForm(false)}
            saving={saving}
          />
        </div>
      )}

      {/* List */}
      <div className="rounded-2xl overflow-hidden"
        style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>

        <div className="flex items-center justify-between px-5 py-3.5"
          style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
          <div className="flex items-center gap-2">
            <MessageSquare size={16} style={{ color: '#dc2626' }} />
            <span className="font-bold text-sm text-text">Disposition Options</span>
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
              style={{ backgroundColor: 'rgba(220,38,38,0.1)', color: '#dc2626' }}>
              {configs.length}
            </span>
          </div>
          <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            Shown to closers in phone search
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-red-500" />
          </div>
        ) : configs.length === 0 ? (
          <div className="text-center py-10">
            <MessageSquare size={32} className="mx-auto mb-2 opacity-20 text-text" />
            <p className="text-sm text-text-secondary">No disposition options yet.</p>
            <p className="text-xs text-text-tertiary mt-0.5">Add one to get started.</p>
          </div>
        ) : configs.map(cfg => (
          editing?.id === cfg.id ? (
            <div key={cfg.id} className="px-4 py-4" style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
              <p className="text-xs font-bold text-text-secondary mb-3 flex items-center gap-1.5">
                <Edit3 size={12} /> Editing: {cfg.name}
              </p>
              <DispositionForm
                initial={editing}
                onSave={handleUpdate}
                onCancel={() => setEditing(null)}
                saving={saving}
              />
            </div>
          ) : (
            <DispoCard
              key={cfg.id}
              config={cfg}
              onEdit={setEditing}
              onDeactivate={handleDeactivate}
              onActivate={handleActivate}
              onHardDelete={handleHardDelete}
              busyId={deleting}
            />
          )
        ))}
      </div>

      <div className="mt-4 rounded-xl p-3 flex items-start gap-2"
        style={{ backgroundColor: 'var(--color-primary-50, #eef2ff)', border: '1px solid var(--color-primary-200, #c7d2fe)' }}>
        <Info size={13} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-primary-700, #4338ca)' }} />
        <div className="text-xs leading-relaxed" style={{ color: 'var(--color-primary-700, #4338ca)' }}>
          <p className="font-bold mb-1">How edits + deletes work</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li><strong>Renaming</strong> a disposition: closers see the new label immediately. Past call records keep the OLD name in their audit log (the name is stored as a text snapshot, not a reference).</li>
            <li><strong>Disable</strong> (eye-off icon): hidden from the closer dropdown. Reversible — hit Activate to bring it back.</li>
            <li><strong>Delete permanently</strong>: only available on already-disabled rows. Removes the config row; old call records still show the original text label.</li>
            <li>Global rows (Globe icon) apply to all companies; company rows override for the selected company.</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default DispositionManager;
