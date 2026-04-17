/**
 * FormBuilder — SuperAdmin drag-drop 3-column form layout editor.
 *
 * Left panel:  palette (base fields + sales fields)
 * Right panel: 3-column grid canvas; drag to reorder, resize span, toggle required
 *
 * Special field types:
 *   sale_client — live dropdown from Sale Configs → Clients
 *   sale_plan   — live dropdown from Sale Configs → Plans, cascades by Client
 *                 admin configures Client→Plan mapping here (stored in field.options)
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  GripVertical, Plus, Save, Eye, EyeOff,
  Settings, CheckSquare,
  Type, Hash, Mail, Phone, Calendar, AlignLeft, List,
  X, Zap, Users, UserX, Tag, Briefcase, Link2, ChevronDown,
} from 'lucide-react';
import client from '../../../api/client';
import { useSaleConfigs } from '../../../hooks/useSaleConfigs';

// ── Base fields ───────────────────────────────────────────────────────────────
const BASE_FIELDS = [
  { name: 'FirstName', label: 'First Name',  field_type: 'text',   is_required: true  },
  { name: 'LastName',  label: 'Last Name',   field_type: 'text',   is_required: true  },
  { name: 'Phone',     label: 'Phone',       field_type: 'tel',    is_required: true  },
  { name: 'Email',     label: 'Email',       field_type: 'email',  is_required: false },
  { name: 'Address',   label: 'Address',     field_type: 'text',   is_required: false },
  { name: 'City',      label: 'City',        field_type: 'text',   is_required: false },
  { name: 'State',     label: 'State',       field_type: 'text',   is_required: false },
  { name: 'Zip',       label: 'Zip Code',    field_type: 'zip',    is_required: false },
  { name: 'BirthDate', label: 'Birth Date',  field_type: 'date',   is_required: false },
  { name: 'Gender',    label: 'Gender',      field_type: 'select', is_required: false, options: ['Male', 'Female', 'Other'] },
  { name: 'CarYear',   label: 'Car Year',    field_type: 'number', is_required: false },
  { name: 'CarMake',   label: 'Car Make',    field_type: 'text',   is_required: false },
  { name: 'CarModel',  label: 'Car Model',   field_type: 'text',   is_required: false },
];

// ── Special sale-config fields (always re-addable, live data) ─────────────────
const SALE_FIELDS = [
  { name: 'SaleClient', label: 'Client',  field_type: 'sale_client', is_required: false },
  { name: 'SalePlan',   label: 'Plan',    field_type: 'sale_plan',   is_required: false },
];

const TYPE_ICONS = {
  text: Type, email: Mail, number: Hash, tel: Phone, phone: Phone,
  zip: Hash, date: Calendar, textarea: AlignLeft, select: List,
  checkbox: CheckSquare, sale_client: Tag, sale_plan: Briefcase,
};

const TYPE_LABELS = {
  text: 'Text', email: 'Email', number: 'Number', tel: 'Phone',
  phone: 'Phone', zip: 'Zip', date: 'Date', textarea: 'Textarea',
  select: 'Select', checkbox: 'Checkbox',
  sale_client: 'Client', sale_plan: 'Plan',
};

const SPAN_LABEL = { 1: '1/3', 2: '2/3', 3: 'Full' };
const SPAN_CLASS  = { 1: 'col-span-1', 2: 'col-span-2', 3: 'col-span-3' };

const FieldIcon = ({ type, size = 14 }) => {
  const Icon = TYPE_ICONS[type] || Type;
  return <Icon size={size} />;
};

// ── Client→Plan mapping modal ─────────────────────────────────────────────────
const ClientPlanMappingModal = ({ clients, plans, currentMapping, onSave, onClose }) => {
  // currentMapping: [{ client: "Name", plans: ["Plan A", ...] }, ...]
  const init = () => {
    const map = {};
    (currentMapping || []).forEach(m => { map[m.client] = new Set(m.plans); });
    return map;
  };
  const [checked, setChecked] = useState(init);

  const toggle = (clientVal, planVal) => {
    setChecked(prev => {
      const set = new Set(prev[clientVal] || []);
      set.has(planVal) ? set.delete(planVal) : set.add(planVal);
      return { ...prev, [clientVal]: set };
    });
  };

  const handleSave = () => {
    const mapping = clients
      .map(c => ({ client: c.value, plans: [...(checked[c.value] || [])] }))
      .filter(m => m.plans.length > 0);
    onSave(mapping);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}>
      <div className="w-full max-w-lg mx-4 rounded-2xl shadow-2xl flex flex-col max-h-[80vh]"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div>
            <h3 className="text-base font-bold text-text flex items-center gap-2"><Link2 size={16} /> Client → Plan Mapping</h3>
            <p className="text-xs text-text-secondary mt-0.5">Select which plans are available for each client</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-bg-secondary"><X size={18} style={{ color: 'var(--color-text-secondary)' }} /></button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          {clients.length === 0 && (
            <p className="text-sm text-text-secondary text-center py-4">No clients configured yet. Add clients in Sale Config first.</p>
          )}
          {plans.length === 0 && (
            <p className="text-sm text-text-secondary text-center py-4">No plans configured yet. Add plans in Sale Config first.</p>
          )}
          {clients.map(c => (
            <div key={c.id} className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
              <p className="text-sm font-bold text-text mb-2 flex items-center gap-1.5">
                <Tag size={13} style={{ color: 'var(--color-primary-500)' }} />
                {c.value}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {plans.map(p => {
                  const isChecked = (checked[c.value] || new Set()).has(p.value);
                  return (
                    <label key={p.id}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all text-sm"
                      style={{
                        backgroundColor: isChecked ? 'var(--color-primary-50)' : 'var(--color-surface)',
                        border: `1px solid ${isChecked ? 'var(--color-primary-300)' : 'var(--color-border)'}`,
                        color: isChecked ? 'var(--color-primary-700)' : 'var(--color-text)',
                      }}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggle(c.value, p.value)}
                        className="w-3.5 h-3.5 accent-primary-600"
                      />
                      <span className="font-medium truncate">{p.value}</span>
                    </label>
                  );
                })}
              </div>
              {plans.length === 0 && (
                <p className="text-xs text-text-tertiary">No plans to assign.</p>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4" style={{ borderTop: '1px solid var(--color-border)' }}>
          <button onClick={onClose}
            className="flex-1 py-2 rounded-xl border text-sm font-semibold"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
            Cancel
          </button>
          <button onClick={handleSave}
            className="flex-1 py-2 rounded-xl text-sm font-bold text-white"
            style={{ background: 'var(--gradient-sidebar)' }}>
            Save Mapping
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Custom field creation modal ───────────────────────────────────────────────
const AddCustomModal = ({ onAdd, onClose }) => {
  const [form, setForm] = useState({ name: '', label: '', field_type: 'text', placeholder: '', options: '' });
  const [err, setErr]   = useState('');

  const handle = () => {
    if (!form.name.trim() || !form.label.trim()) { setErr('Name and label required'); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(form.name)) { setErr('Name: letters, numbers, underscores only'); return; }
    const opts = form.field_type === 'select'
      ? form.options.split(',').map(s => s.trim()).filter(Boolean)
      : null;
    onAdd({ ...form, name: form.name.trim(), label: form.label.trim(), options: opts, is_required: false, column_span: 1 });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}>
      <div className="w-full max-w-md mx-4 rounded-2xl p-6 shadow-2xl"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-text">Add Custom Field</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-bg-secondary"><X size={18} style={{ color: 'var(--color-text-secondary)' }} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">Field Name (key)</label>
            <input value={form.name} onChange={e => setForm({...form, name: e.target.value})}
              placeholder="e.g. ContractNumber" className="input text-sm" />
            <p className="text-xs text-text-tertiary mt-0.5">Used internally. No spaces.</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">Display Label</label>
            <input value={form.label} onChange={e => setForm({...form, label: e.target.value})}
              placeholder="e.g. Contract Number" className="input text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">Field Type</label>
            <select value={form.field_type} onChange={e => setForm({...form, field_type: e.target.value})} className="input text-sm">
              {Object.entries(TYPE_LABELS)
                .filter(([v]) => !v.startsWith('sale_'))
                .map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">Placeholder (optional)</label>
            <input value={form.placeholder} onChange={e => setForm({...form, placeholder: e.target.value})}
              placeholder="e.g. Enter contract number" className="input text-sm" />
          </div>
          {form.field_type === 'select' && (
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1">Options (comma-separated)</label>
              <input value={form.options} onChange={e => setForm({...form, options: e.target.value})}
                placeholder="Option A, Option B, Option C" className="input text-sm" />
            </div>
          )}
          {err && <p className="text-xs text-error-600">{err}</p>}
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={onClose}
            className="flex-1 py-2 rounded-lg border text-sm font-semibold"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Cancel</button>
          <button onClick={handle}
            className="flex-1 py-2 rounded-lg text-sm font-bold text-white"
            style={{ background: 'var(--gradient-sidebar)' }}>Add Field</button>
        </div>
      </div>
    </div>
  );
};

// ── Field card on the canvas ──────────────────────────────────────────────────
const FieldCard = ({ field, index, isDragging, isDragOver, onDragStart, onDragOver, onDrop, onDragEnd, onRemove, onToggleRequired, onToggleFronter, onChangeSpan, onEditLabel, onConfigureMapping, saleClientsCount, salePlansCount }) => {
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelVal, setLabelVal]         = useState(field.label);
  const inputRef = useRef(null);

  const isSaleField = field.field_type === 'sale_client' || field.field_type === 'sale_plan';
  const mappingCount = field.field_type === 'sale_plan' && Array.isArray(field.options) ? field.options.length : 0;

  const commitLabel = () => {
    setEditingLabel(false);
    if (labelVal.trim()) onEditLabel(labelVal.trim());
  };

  useEffect(() => { if (editingLabel) inputRef.current?.focus(); }, [editingLabel]);

  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, index)}
      onDragOver={e => onDragOver(e, index)}
      onDrop={e => onDrop(e, index)}
      onDragEnd={onDragEnd}
      className={`rounded-xl border-2 transition-all duration-150 select-none ${SPAN_CLASS[field.column_span || 1]}`}
      style={{
        borderColor:     isDragOver ? 'var(--color-primary-500)' : isDragging ? 'transparent' : isSaleField ? 'var(--color-primary-200)' : 'var(--color-border)',
        backgroundColor: isDragOver ? 'var(--color-primary-50)'  : isSaleField ? 'var(--color-primary-50, #faf5ff)' : 'var(--color-surface)',
        opacity:         isDragging ? 0.35 : 1,
        cursor:          'grab',
        boxShadow:       isDragOver ? '0 0 0 3px var(--color-primary-200)' : 'none',
      }}
    >
      {/* Top bar */}
      <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1 min-w-0 overflow-hidden">
        <GripVertical size={14} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
        <span style={{ flexShrink: 0, color: isSaleField ? 'var(--color-primary-500)' : 'var(--color-text-secondary)' }}>
          <FieldIcon type={field.field_type} />
        </span>
        {editingLabel ? (
          <input
            ref={inputRef}
            value={labelVal}
            onChange={e => setLabelVal(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={e => { if (e.key === 'Enter') commitLabel(); if (e.key === 'Escape') setEditingLabel(false); }}
            className="flex-1 min-w-0 text-sm font-semibold bg-transparent border-b border-primary-400 outline-none text-text"
          />
        ) : (
          <span
            onDoubleClick={() => { setLabelVal(field.label); setEditingLabel(true); }}
            className="flex-1 min-w-0 text-sm font-semibold text-text truncate cursor-text"
            title="Double-click to rename">
            {field.label}
          </span>
        )}
        <button
          onClick={() => onRemove(index)}
          className="p-0.5 rounded transition-colors hover:bg-error-100 flex-shrink-0"
          title="Remove">
          <X size={13} style={{ color: 'var(--color-error-500)' }} />
        </button>
      </div>

      {/* Sale field badge */}
      {isSaleField && (
        <div className="px-3 pb-1">
          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold"
            style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>
            <Zap size={9} />
            Live from Sale Config
          </span>
          {field.field_type === 'sale_plan' && (
            <span className="ml-1.5 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold"
              style={{ backgroundColor: mappingCount > 0 ? 'var(--color-success-50)' : 'var(--color-warning-50)', color: mappingCount > 0 ? 'var(--color-success-700)' : 'var(--color-warning-700)' }}>
              <Link2 size={9} />
              {mappingCount > 0 ? `${mappingCount} client${mappingCount > 1 ? 's' : ''} mapped` : 'No mapping (shows all)'}
            </span>
          )}
        </div>
      )}

      {/* Footer controls */}
      <div className="flex items-center flex-wrap gap-1.5 px-3 pb-2.5 pt-1.5"
        style={{ borderTop: '1px solid var(--color-border)' }}>

        {/* Required toggle */}
        <button
          onClick={() => onToggleRequired(index)}
          className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold transition-all flex-shrink-0"
          style={{
            backgroundColor: field.is_required ? 'var(--color-error-50)' : 'var(--color-bg-secondary)',
            color: field.is_required ? 'var(--color-error-600)' : 'var(--color-text-tertiary)',
          }}>
          {field.is_required ? '* Req' : 'Opt'}
        </button>

        {/* Fronter visibility */}
        <button
          onClick={() => onToggleFronter(index)}
          className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold transition-all flex-shrink-0"
          style={{
            backgroundColor: field.show_to_fronter !== false ? 'var(--color-info-50, #e0f2fe)' : 'var(--color-bg-secondary)',
            color: field.show_to_fronter !== false ? 'var(--color-info-600, #0284c7)' : 'var(--color-text-tertiary)',
          }}>
          {field.show_to_fronter !== false
            ? <><Users size={9} /> Fronters</>
            : <><UserX size={9} /> Closer</>}
        </button>

        {/* Configure mapping (sale_plan only) */}
        {field.field_type === 'sale_plan' && (
          <button
            onClick={() => onConfigureMapping(index)}
            className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold transition-all flex-shrink-0 hover:opacity-80"
            style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>
            <Link2 size={9} /> Map Plans
          </button>
        )}

        {/* Span buttons — pushed right */}
        <div className="flex items-center gap-0.5 ml-auto flex-shrink-0">
          {[1, 2, 3].map(n => (
            <button key={n} onClick={() => onChangeSpan(index, n)}
              className="px-1.5 py-0.5 rounded text-xs font-bold transition-all"
              style={{
                backgroundColor: (field.column_span || 1) === n ? 'var(--color-primary-600)' : 'var(--color-bg-secondary)',
                color:            (field.column_span || 1) === n ? 'white' : 'var(--color-text-secondary)',
              }}>
              {SPAN_LABEL[n]}
            </button>
          ))}
        </div>

        {/* Type badge */}
        <span className="text-xs font-mono px-1.5 py-0.5 rounded flex-shrink-0"
          style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}>
          {TYPE_LABELS[field.field_type] || field.field_type}
        </span>
      </div>
    </div>
  );
};

// ── Palette field pill ────────────────────────────────────────────────────────
const PaletteField = ({ field, onAdd, isSale = false }) => (
  <button
    onClick={() => onAdd(field)}
    className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition-all hover:shadow-md hover:scale-[1.02]"
    style={{
      borderColor: isSale ? 'var(--color-primary-200)' : 'var(--color-border)',
      backgroundColor: isSale ? 'var(--color-primary-50, #faf5ff)' : 'var(--color-surface)',
    }}>
    <span style={{ color: isSale ? 'var(--color-primary-500)' : 'var(--color-text-secondary)', flexShrink: 0 }}>
      <FieldIcon type={field.field_type} />
    </span>
    <div className="flex-1 min-w-0">
      <p className="text-sm font-semibold text-text truncate">{field.label}</p>
      {isSale && <p className="text-xs truncate" style={{ color: 'var(--color-text-tertiary)' }}>
        {field.field_type === 'sale_client' ? 'From Sale Config clients' : 'From Sale Config plans'}
      </p>}
    </div>
    <Plus size={13} style={{ color: 'var(--color-primary-500)', flexShrink: 0 }} />
  </button>
);

// ── Main FormBuilder ──────────────────────────────────────────────────────────
const FormBuilder = () => {
  const [canvasFields, setCanvasFields] = useState([]);
  const [palette, setPalette]           = useState([]);
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [savedMsg, setSavedMsg]         = useState('');
  const [showPreview, setShowPreview]   = useState(false);
  const [showCustom, setShowCustom]     = useState(false);
  const [mappingField, setMappingField] = useState(null); // index of sale_plan field being configured

  const { clients: saleClients, plans: salePlans, fetchConfigs, loading: configsLoading } = useSaleConfigs();

  const dragIndex = useRef(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  const loadFields = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.get('forms/fields');
      const dbFields = (res.data.fields || []).sort((a, b) => a.order - b.order);

      const canvasNames = new Set(dbFields.map(f => f.name));
      const canvas = dbFields.map(f => ({
        id:              f.id,
        name:            f.name,
        label:           f.label,
        field_type:      f.field_type,
        is_required:     f.is_required,
        column_span:     f.column_span || 1,
        placeholder:     f.placeholder || '',
        options:         f.options,
        section:         f.section || 'default',
        show_to_fronter: f.show_to_fronter !== false,
      }));
      setCanvasFields(canvas);

      // Palette = base fields not yet on canvas
      const pal = BASE_FIELDS.filter(f => !canvasNames.has(f.name)).map(f => ({ ...f, column_span: 1 }));
      setPalette(pal);
    } catch { /* non-critical */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadFields(); }, [loadFields]);

  const handleAddFromPalette = (field) => {
    setCanvasFields(prev => [...prev, { ...field, column_span: field.column_span || 1, show_to_fronter: true }]);
    setPalette(prev => prev.filter(f => f.name !== field.name));
  };

  // Sale fields are always re-addable (multiple clients/plans allowed? No — prevent dupes)
  const handleAddSaleField = (field) => {
    const alreadyOnCanvas = canvasFields.some(f => f.field_type === field.field_type);
    if (alreadyOnCanvas) return; // already added
    setCanvasFields(prev => [...prev, { ...field, column_span: 1, show_to_fronter: true, options: null }]);
  };

  const handleAddCustom = (field) => {
    setCanvasFields(prev => [...prev, { ...field, column_span: 1, show_to_fronter: true }]);
  };

  const handleRemove = (index) => {
    const removed = canvasFields[index];
    setCanvasFields(prev => prev.filter((_, i) => i !== index));
    if (BASE_FIELDS.some(f => f.name === removed.name)) {
      setPalette(prev => [...prev, { ...removed }]);
    }
  };

  const handleToggleRequired = (index) => {
    setCanvasFields(prev => prev.map((f, i) => i === index ? { ...f, is_required: !f.is_required } : f));
  };

  const handleToggleFronter = (index) => {
    setCanvasFields(prev => prev.map((f, i) =>
      i === index ? { ...f, show_to_fronter: f.show_to_fronter === false } : f
    ));
  };

  const handleChangeSpan = (index, span) => {
    setCanvasFields(prev => prev.map((f, i) => i === index ? { ...f, column_span: span } : f));
  };

  const handleEditLabel = (index, newLabel) => {
    setCanvasFields(prev => prev.map((f, i) => i === index ? { ...f, label: newLabel } : f));
  };

  // Save client→plan mapping into the sale_plan field's options
  const handleSaveMapping = (index, mapping) => {
    setCanvasFields(prev => prev.map((f, i) => i === index ? { ...f, options: mapping } : f));
  };

  // ── Drag handlers ─────────────────────────────────────────────────────────
  const handleDragStart = (e, index) => {
    dragIndex.current = index;
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIdx(index);
  };

  const handleDrop = (e, dropIndex) => {
    e.preventDefault();
    const fromIndex = dragIndex.current;
    if (fromIndex === null || fromIndex === dropIndex) return;
    setCanvasFields(prev => {
      const arr = [...prev];
      const [moved] = arr.splice(fromIndex, 1);
      arr.splice(dropIndex, 0, moved);
      return arr;
    });
    dragIndex.current = null;
    setDragOverIdx(null);
  };

  const handleDragEnd = () => {
    dragIndex.current = null;
    setDragOverIdx(null);
  };

  // ── Save to DB ────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (canvasFields.length === 0) return;
    setSaving(true);
    try {
      const res = await client.post('forms/fields/bulk-save', { fields: canvasFields });
      setSavedMsg(`Saved — ${res.data.saved} field${res.data.saved !== 1 ? 's' : ''} applied globally.`);
      await loadFields();
      setTimeout(() => setSavedMsg(''), 5000);
    } catch (err) {
      setSavedMsg(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // ── Sale fields already on canvas (to gray them out in palette) ───────────
  const saleClientOnCanvas = canvasFields.some(f => f.field_type === 'sale_client');
  const salePlanOnCanvas   = canvasFields.some(f => f.field_type === 'sale_plan');

  if (loading) {
    return <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-xl font-bold text-text flex items-center gap-2"><Settings size={20} /> Form Builder</h3>
          <p className="text-sm text-text-secondary mt-0.5">Drag fields to reorder · Click span buttons to resize · Double-click label to rename</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowPreview(v => !v)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-semibold transition-all"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-surface)' }}>
            {showPreview ? <EyeOff size={15} /> : <Eye size={15} />}
            {showPreview ? 'Hide Preview' : 'Preview Form'}
          </button>
          <button onClick={handleSave} disabled={saving || canvasFields.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all hover:scale-105 disabled:opacity-50"
            style={{ background: 'var(--gradient-sidebar)' }}>
            <Save size={15} />
            {saving ? 'Saving…' : 'Save Layout'}
          </button>
        </div>
      </div>

      {savedMsg && (
        <div className="p-3 rounded-xl text-sm font-medium"
          style={{
            backgroundColor: savedMsg.includes('failed') || savedMsg.includes('error') ? 'var(--color-error-50)' : 'var(--color-success-50)',
            color: savedMsg.includes('failed') || savedMsg.includes('error') ? 'var(--color-error-700)' : 'var(--color-success-700)',
            border: '1px solid currentColor',
          }}>
          {savedMsg}
        </div>
      )}

      {/* Main area */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">

        {/* ── Palette ─────────────────────────────────── */}
        <div className="lg:col-span-1 space-y-3">
          <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>

            {/* Sales Fields section */}
            <div className="mb-4">
              <p className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Briefcase size={11} /> Sales Fields
              </p>
              <div className="space-y-1.5">
                {SALE_FIELDS.map(f => {
                  const onCanvas = f.field_type === 'sale_client' ? saleClientOnCanvas : salePlanOnCanvas;
                  return (
                    <div key={f.name} className={onCanvas ? 'opacity-40 pointer-events-none' : ''}>
                      <PaletteField field={f} onAdd={handleAddSaleField} isSale />
                    </div>
                  );
                })}
              </div>
              {(saleClientOnCanvas || salePlanOnCanvas) && (
                <p className="text-xs text-text-tertiary mt-1.5 px-1">
                  {saleClientOnCanvas && salePlanOnCanvas ? 'Both' : saleClientOnCanvas ? 'Client' : 'Plan'} already on form
                </p>
              )}
            </div>

            <div className="mb-3" style={{ borderTop: '1px solid var(--color-border)', paddingTop: '12px' }}>
              <p className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-2">Contact / Lead Fields</p>
            </div>

            {/* Base fields */}
            {palette.length === 0 ? (
              <p className="text-xs text-text-tertiary text-center py-2">All fields placed</p>
            ) : (
              <div className="space-y-1.5">
                {palette.map(f => (
                  <PaletteField key={f.name} field={f} onAdd={handleAddFromPalette} />
                ))}
              </div>
            )}

            <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
              <button onClick={() => setShowCustom(true)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl border-2 border-dashed text-sm font-semibold transition-all hover:border-primary-500"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary-600)' }}>
                <Plus size={14} /> Custom Field
              </button>
            </div>
          </div>

          {/* Tips */}
          <div className="rounded-xl p-3 text-xs space-y-1.5"
            style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            <p className="font-bold text-text-secondary">Tips</p>
            <p className="text-text-tertiary">· Drag cards to reorder</p>
            <p className="text-text-tertiary">· 1/3, 2/3, Full = column width</p>
            <p className="text-text-tertiary">· Double-click label to rename</p>
            <p className="text-text-tertiary">· Client field cascades Plan dropdown</p>
            <p className="text-text-tertiary">· Click "Map Plans" to configure</p>
            <p className="text-text-tertiary">· Fronters = visible to fronters</p>
            <p className="text-text-tertiary">· Save applies globally</p>
          </div>
        </div>

        {/* ── Canvas ──────────────────────────────────── */}
        <div className="lg:col-span-3">
          {canvasFields.length === 0 ? (
            <div className="rounded-2xl p-12 flex flex-col items-center justify-center"
              style={{ backgroundColor: 'var(--color-bg-secondary)', border: '2px dashed var(--color-border)' }}>
              <Zap size={40} className="mb-3" style={{ color: 'var(--color-text-tertiary)' }} />
              <p className="text-text-secondary font-semibold">No fields on canvas</p>
              <p className="text-text-tertiary text-sm mt-1">Click fields from the palette to add them</p>
            </div>
          ) : (
            <div
              className="rounded-2xl p-4 grid grid-cols-3 gap-3 content-start min-h-48"
              style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                if (dragOverIdx === null && dragIndex.current !== null) {
                  handleDrop(e, canvasFields.length - 1);
                }
              }}>
              {canvasFields.map((field, idx) => (
                <FieldCard
                  key={`${field.name}-${idx}`}
                  field={field}
                  index={idx}
                  isDragging={dragIndex.current === idx}
                  isDragOver={dragOverIdx === idx}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onDragEnd={handleDragEnd}
                  onRemove={handleRemove}
                  onToggleRequired={handleToggleRequired}
                  onToggleFronter={handleToggleFronter}
                  onChangeSpan={handleChangeSpan}
                  onEditLabel={(label) => handleEditLabel(idx, label)}
                  onConfigureMapping={(i) => setMappingField(i)}
                  saleClientsCount={saleClients.length}
                  salePlansCount={salePlans.length}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Live Preview ─────────────────────────────── */}
      {showPreview && canvasFields.length > 0 && (
        <div className="rounded-2xl p-6" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <h4 className="text-lg font-bold text-text mb-4 flex items-center gap-2"><Eye size={18} /> Form Preview</h4>
          <div className="grid grid-cols-3 gap-4">
            {canvasFields.map((field, idx) => (
              <div key={idx} className={SPAN_CLASS[field.column_span || 1]}>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  <span>{field.label} {field.is_required && <span className="text-error-500">*</span>}</span>
                  {field.show_to_fronter === false && (
                    <span className="ml-2 text-xs px-1.5 py-0.5 rounded font-semibold"
                      style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}>
                      Closer Only
                    </span>
                  )}
                </label>
                {field.field_type === 'textarea' ? (
                  <textarea disabled rows={3} placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`} className="input opacity-70" />
                ) : field.field_type === 'sale_client' ? (
                  <select disabled className="input opacity-70">
                    <option>Select client… ({saleClients.length} configured)</option>
                    {saleClients.map(c => <option key={c.id}>{c.value}</option>)}
                  </select>
                ) : field.field_type === 'sale_plan' ? (
                  <select disabled className="input opacity-70">
                    <option>Select plan… ({salePlans.length} configured)</option>
                    {salePlans.map(p => <option key={p.id}>{p.value}</option>)}
                  </select>
                ) : field.field_type === 'select' ? (
                  <select disabled className="input opacity-70">
                    <option>Select {field.label}</option>
                    {(field.options || []).map(o => <option key={o}>{o}</option>)}
                  </select>
                ) : (
                  <input disabled
                    type={field.field_type === 'tel' || field.field_type === 'phone' ? 'tel' : field.field_type === 'zip' ? 'text' : field.field_type}
                    placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`}
                    className="input opacity-70"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modals */}
      {showCustom && <AddCustomModal onAdd={handleAddCustom} onClose={() => setShowCustom(false)} />}

      {mappingField !== null && canvasFields[mappingField] && (
        <ClientPlanMappingModal
          clients={saleClients}
          plans={salePlans}
          currentMapping={canvasFields[mappingField].options}
          onSave={(mapping) => handleSaveMapping(mappingField, mapping)}
          onClose={() => setMappingField(null)}
        />
      )}
    </div>
  );
};

export default FormBuilder;
