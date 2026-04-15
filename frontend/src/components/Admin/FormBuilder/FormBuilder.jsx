/**
 * FormBuilder — SuperAdmin drag-drop 3-column form layout editor.
 *
 * Left panel:  palette of available fields (base + custom)
 * Right panel: 3-column grid canvas; drag to reorder, resize column span, toggle required
 *
 * On save → POST /forms/fields/bulk-save (replaces entire global form layout).
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  GripVertical, Trash2, Plus, Save, Eye, EyeOff,
  ChevronLeft, ChevronRight, Settings, CheckSquare,
  Type, Hash, Mail, Phone, Calendar, AlignLeft, List,
  ToggleLeft, X, Zap,
} from 'lucide-react';
import client from '../../../api/client';

// ── Base fields for Extended Warranty ────────────────────────────────────────
const BASE_FIELDS = [
  { name: 'FirstName',   label: 'First Name',  field_type: 'text',   is_required: true  },
  { name: 'LastName',    label: 'Last Name',   field_type: 'text',   is_required: true  },
  { name: 'Phone',       label: 'Phone',       field_type: 'tel',    is_required: true  },
  { name: 'Email',       label: 'Email',       field_type: 'email',  is_required: false },
  { name: 'Address',     label: 'Address',     field_type: 'text',   is_required: false },
  { name: 'City',        label: 'City',        field_type: 'text',   is_required: false },
  { name: 'State',       label: 'State',       field_type: 'text',   is_required: false },
  { name: 'Zip',         label: 'Zip Code',    field_type: 'zip',    is_required: false },
  { name: 'BirthDate',   label: 'Birth Date',  field_type: 'date',   is_required: false },
  { name: 'Gender',      label: 'Gender',      field_type: 'select', is_required: false, options: ['Male', 'Female', 'Other'] },
  { name: 'CarYear',     label: 'Car Year',    field_type: 'number', is_required: false },
  { name: 'CarMake',     label: 'Car Make',    field_type: 'text',   is_required: false },
  { name: 'CarModel',    label: 'Car Model',   field_type: 'text',   is_required: false },
];

const TYPE_ICONS = {
  text:     Type,
  email:    Mail,
  number:   Hash,
  tel:      Phone,
  phone:    Phone,
  zip:      Hash,
  date:     Calendar,
  textarea: AlignLeft,
  select:   List,
  checkbox: CheckSquare,
};

const TYPE_LABELS = {
  text: 'Text', email: 'Email', number: 'Number', tel: 'Phone',
  phone: 'Phone', zip: 'Zip', date: 'Date', textarea: 'Textarea',
  select: 'Select', checkbox: 'Checkbox',
};

const SPAN_LABEL = { 1: '1/3', 2: '2/3', 3: 'Full' };
const SPAN_CLASS = { 1: 'col-span-1', 2: 'col-span-2', 3: 'col-span-3' };

// ── Small helper: field type icon ─────────────────────────────────────────────
const FieldIcon = ({ type, size = 14 }) => {
  const Icon = TYPE_ICONS[type] || Type;
  return <Icon size={size} />;
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
              {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
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
const FieldCard = ({ field, index, isDragging, isDragOver, onDragStart, onDragOver, onDrop, onDragEnd, onRemove, onToggleRequired, onChangeSpan, onEditLabel }) => {
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelVal, setLabelVal]         = useState(field.label);
  const inputRef = useRef(null);

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
        borderColor:       isDragOver ? 'var(--color-primary-500)' : isDragging ? 'transparent' : 'var(--color-border)',
        backgroundColor:   isDragOver ? 'var(--color-primary-50)'  : 'var(--color-surface)',
        opacity:           isDragging ? 0.35 : 1,
        cursor:            'grab',
        boxShadow:         isDragOver ? '0 0 0 3px var(--color-primary-200)' : 'none',
      }}
    >
      {/* Top bar */}
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
        <GripVertical size={14} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
        <FieldIcon type={field.field_type} />
        {editingLabel ? (
          <input
            ref={inputRef}
            value={labelVal}
            onChange={e => setLabelVal(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={e => { if (e.key === 'Enter') commitLabel(); if (e.key === 'Escape') setEditingLabel(false); }}
            className="flex-1 text-sm font-semibold bg-transparent border-b border-primary-400 outline-none text-text"
          />
        ) : (
          <span
            onDoubleClick={() => { setLabelVal(field.label); setEditingLabel(true); }}
            className="flex-1 text-sm font-semibold text-text truncate cursor-text"
            title="Double-click to rename">
            {field.label}
          </span>
        )}
        <button
          onClick={() => onRemove(index)}
          className="p-0.5 rounded transition-colors hover:bg-error-100 flex-shrink-0"
          title="Remove from form">
          <X size={13} style={{ color: 'var(--color-error-500)' }} />
        </button>
      </div>

      {/* Footer controls */}
      <div className="flex items-center gap-2 px-3 pb-2.5 pt-1"
        style={{ borderTop: '1px solid var(--color-border)' }}>
        {/* Required toggle */}
        <button
          onClick={() => onToggleRequired(index)}
          className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold transition-all ${
            field.is_required ? 'text-error-600' : 'text-text-tertiary'
          }`}
          style={{
            backgroundColor: field.is_required ? 'var(--color-error-50)' : 'var(--color-bg-secondary)',
          }}
          title="Toggle required">
          {field.is_required ? '* Required' : 'Optional'}
        </button>

        {/* Column span */}
        <div className="flex items-center gap-0.5 ml-auto">
          {[1, 2, 3].map(n => (
            <button
              key={n}
              onClick={() => onChangeSpan(index, n)}
              className="px-1.5 py-0.5 rounded text-xs font-bold transition-all"
              style={{
                backgroundColor: (field.column_span || 1) === n ? 'var(--color-primary-600)' : 'var(--color-bg-secondary)',
                color:            (field.column_span || 1) === n ? 'white' : 'var(--color-text-secondary)',
              }}
              title={`Span ${n} column${n > 1 ? 's' : ''}`}>
              {SPAN_LABEL[n]}
            </button>
          ))}
        </div>

        {/* Type badge */}
        <span className="text-xs font-mono px-1.5 py-0.5 rounded"
          style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}>
          {TYPE_LABELS[field.field_type] || field.field_type}
        </span>
      </div>
    </div>
  );
};

// ── Palette field pill ────────────────────────────────────────────────────────
const PaletteField = ({ field, onAdd }) => (
  <button
    onClick={() => onAdd(field)}
    draggable={false}
    className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition-all hover:shadow-md hover:scale-[1.02]"
    style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
    title={`Add ${field.label}`}>
    <FieldIcon type={field.field_type} />
    <span className="text-sm font-semibold text-text flex-1 truncate">{field.label}</span>
    <Plus size={13} style={{ color: 'var(--color-primary-500)' }} />
  </button>
);

// ── Main FormBuilder ──────────────────────────────────────────────────────────
const FormBuilder = () => {
  const [canvasFields, setCanvasFields] = useState([]);  // fields placed on grid
  const [palette, setPalette]           = useState([]);  // available to add
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [savedMsg, setSavedMsg]         = useState('');
  const [showPreview, setShowPreview]   = useState(false);
  const [showCustom, setShowCustom]     = useState(false);

  // Drag state
  const dragIndex = useRef(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  // Load current fields from DB
  const loadFields = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.get('forms/fields');
      const dbFields = (res.data.fields || []).sort((a, b) => a.order - b.order);

      // Build canvas from DB
      const canvasNames = new Set(dbFields.map(f => f.name));
      const canvas = dbFields.map(f => ({
        id:           f.id,
        name:         f.name,
        label:        f.label,
        field_type:   f.field_type,
        is_required:  f.is_required,
        column_span:  f.column_span || 1,
        placeholder:  f.placeholder || '',
        options:      f.options,
        section:      f.section || 'default',
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

  // Add field from palette → canvas
  const handleAddFromPalette = (field) => {
    setCanvasFields(prev => [...prev, { ...field, column_span: field.column_span || 1 }]);
    setPalette(prev => prev.filter(f => f.name !== field.name));
  };

  // Add custom field
  const handleAddCustom = (field) => {
    setCanvasFields(prev => [...prev, { ...field, column_span: 1 }]);
  };

  // Remove field from canvas → back to palette (if it's a base field)
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

  const handleChangeSpan = (index, span) => {
    setCanvasFields(prev => prev.map((f, i) => i === index ? { ...f, column_span: span } : f));
  };

  const handleEditLabel = (index, newLabel) => {
    setCanvasFields(prev => prev.map((f, i) => i === index ? { ...f, label: newLabel } : f));
  };

  // ── Drag handlers ────────────────────────────────────────────────────────
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

  // ── Save to DB ───────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (canvasFields.length === 0) return;
    setSaving(true);
    try {
      const res = await client.post('forms/fields/bulk-save', { fields: canvasFields });
      setSavedMsg(`Saved — ${res.data.saved} field${res.data.saved !== 1 ? 's' : ''} applied globally.`);
      // Reload to get real IDs from DB
      await loadFields();
      setTimeout(() => setSavedMsg(''), 5000);
    } catch (err) {
      setSavedMsg(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

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
          style={{ backgroundColor: savedMsg.includes('failed') || savedMsg.includes('error') ? 'var(--color-error-50)' : 'var(--color-success-50)',
            color: savedMsg.includes('failed') || savedMsg.includes('error') ? 'var(--color-error-700)' : 'var(--color-success-700)',
            border: '1px solid currentColor' }}>
          {savedMsg}
        </div>
      )}

      {/* Main area */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">

        {/* ── Palette ─────────────────────────────────── */}
        <div className="lg:col-span-1 space-y-3">
          <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <p className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-3">Available Fields</p>
            {palette.length === 0 ? (
              <p className="text-xs text-text-tertiary text-center py-3">All base fields placed</p>
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
            <p className="text-text-tertiary">· * Required fields are starred</p>
            <p className="text-text-tertiary">· Save applies globally to all users</p>
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
                // Drop on empty canvas area → append
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
                  onChangeSpan={handleChangeSpan}
                  onEditLabel={(label) => handleEditLabel(idx, label)}
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
                  {field.label} {field.is_required && <span className="text-error-500">*</span>}
                </label>
                {field.field_type === 'textarea' ? (
                  <textarea disabled rows={3} placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`}
                    className="input opacity-70" />
                ) : field.field_type === 'select' ? (
                  <select disabled className="input opacity-70">
                    <option>Select {field.label}</option>
                    {(field.options || []).map(o => <option key={o}>{o}</option>)}
                  </select>
                ) : (
                  <input
                    disabled
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

      {showCustom && <AddCustomModal onAdd={handleAddCustom} onClose={() => setShowCustom(false)} />}
    </div>
  );
};

export default FormBuilder;
