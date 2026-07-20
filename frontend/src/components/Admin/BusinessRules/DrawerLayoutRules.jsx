import { useMemo, useState, useEffect } from 'react';
import ThemedSelect from '../../UI/Select';
import {
  LayoutTemplate, AlertTriangle, Eye, EyeOff, ChevronUp, ChevronDown,
  Info, Sparkles, ChevronRight, Layers, Pencil, RotateCcw, GripVertical, MoveRight,
} from 'lucide-react';
import { clearDrawerLayoutCache } from '../../../hooks/useDrawerLayout';
import { useFormFields } from '../../../hooks/useFormFields';

// Form-data keys that map to core (column-backed) drawer fields, so they must NOT
// be listed again as dynamic "additional" fields. Mirrors SaleDetailDrawer's
// SKIP_KEYS + the special sale_* field types that map to columns.
const SKIP_FORM_KEYS = new Set([
  'customer_name', 'customer_phone', 'customer_email', 'customer_address',
  'FirstName', 'LastName', 'Phone', 'Phone2', 'Email', 'Address', 'City', 'State', 'Zip',
  'CarYear', 'CarMake', 'CarModel', 'CarMiles', 'CarVin', 'SaleDisposition',
  'manual_entry_by', 'cli_number', 'transfer_date', 'last_redial_at', 'state_abbr',
]);
const SPECIAL_FIELD_TYPES = new Set([
  'sale_plan', 'sale_fronter', 'sale_date', 'sale_status', 'sale_disposition',
  'sale_down_payment', 'sale_monthly_payment', 'sale_payment_due_note',
  'sale_reference_no', 'sale_client',
]);
// The catch-all section per drawer where un-placed dynamic form fields live.
const DYNAMIC_SECTION = { sale: 'additional', transfer: 'lead_info' };

// ── Drawer types + roles the SuperAdmin can configure. ─────────────────────
const DRAWER_TYPES = [
  { key: 'sale',     label: 'Sale Drawer',     desc: 'Opens when a closer / manager / compliance clicks on a sale row.' },
  { key: 'transfer', label: 'Transfer Drawer', desc: 'Opens when a user clicks on a transfer row.' },
  { key: 'callback', label: 'Callback Drawer', desc: 'Opens when a user clicks on a callback row.' },
];

const ROLES = [
  { key: 'closer',             label: 'Closer',             accent: '#10b981' },
  { key: 'closer_manager',     label: 'Closer Manager',     accent: '#059669' },
  { key: 'fronter',            label: 'Fronter',            accent: '#3b82f6' },
  { key: 'fronter_manager',    label: 'Fronter Manager',    accent: '#2563eb' },
  { key: 'compliance_manager', label: 'Compliance',         accent: '#f59e0b' },
  { key: 'superadmin',         label: 'Superadmin',         accent: '#6366f1' },
  { key: 'company_admin',      label: 'Company Admin',      accent: '#8b5cf6' },
];

// ── Section + field catalog. Field catalog is per-section so the SuperAdmin
// gets descriptive labels + descriptions on every toggle. additional/audit
// have no field grid because their contents are dynamic (form_data extras +
// edit_history) — they remain section-level toggles.
const SECTION_CATALOG = {
  sale: [
    { id: 'customer',  label: 'Customer',  desc: 'Customer identity fields',
      fields: [
        { id: 'name',     label: 'Name',     desc: 'Customer full name' },
        { id: 'phone',    label: 'Phone',    desc: 'Primary phone number' },
        { id: 'phone_2',  label: 'Phone 2',  desc: 'Secondary phone' },
        { id: 'email',    label: 'Email',    desc: 'Customer email' },
        { id: 'address',  label: 'Address',  desc: 'Mailing address (city/state/zip)' },
      ],
    },
    { id: 'vehicle',   label: 'Vehicle',   desc: 'Car identity',
      fields: [
        { id: 'year',  label: 'Year',  desc: 'Model year' },
        { id: 'make',  label: 'Make',  desc: 'Manufacturer' },
        { id: 'model', label: 'Model', desc: 'Model name' },
        { id: 'miles', label: 'Miles', desc: 'Odometer reading' },
        { id: 'vin',   label: 'VIN',   desc: '17-char VIN code' },
      ],
    },
    { id: 'sale_info', label: 'Sale Info', desc: 'Policy and disposition',
      fields: [
        { id: 'client',             label: 'Client',             desc: 'Client/carrier brand' },
        { id: 'plan',               label: 'Plan',               desc: 'Plan name or tier' },
        { id: 'sale_date',          label: 'Sale Date',          desc: 'Business day the sale happened' },
        { id: 'status',             label: 'Status',             desc: 'Current lifecycle state' },
        { id: 'cancellation_date',  label: 'Cancellation Date',  desc: 'Date a cancel-like status took effect' },
        { id: 'closer_disposition', label: 'Closer Disposition', desc: 'Closer-set outcome label' },
      ],
    },
    { id: 'financial', label: 'Financial', desc: 'Money fields. Often hidden from fronters per policy.',
      fields: [
        { id: 'monthly_payment',  label: 'Monthly Payment',  desc: 'Recurring premium' },
        { id: 'down_payment',     label: 'Down Payment',     desc: 'Initial payment' },
        { id: 'payment_due_note', label: 'Due Note',         desc: 'Free-form note about due date' },
      ],
    },
    { id: 'compliance_actions', label: 'Compliance Actions', desc: 'Approve / return / cancel buttons (compliance only). Section-level toggle.' },
    { id: 'additional',         label: 'Additional Info',    desc: 'Any extra form_data fields not in the main sections. Dynamic — section-level toggle.' },
    { id: 'people',             label: 'People',             desc: 'Sale attribution',
      fields: [
        { id: 'closer',  label: 'Closer',  desc: 'Closer who handled the sale' },
        { id: 'fronter', label: 'Fronter', desc: 'Fronter who generated the lead' },
      ],
    },
    { id: 'timeline',           label: 'Timeline',           desc: 'Lifecycle timestamps',
      fields: [
        { id: 'created',                label: 'Created',                desc: 'Row insertion time' },
        { id: 'updated',                label: 'Updated',                desc: 'Last modification time' },
        { id: 'submitted_for_review',   label: 'Submitted for Review',   desc: 'When sale went to compliance' },
        { id: 'compliance_reviewed',    label: 'Compliance Reviewed',    desc: 'When compliance decided' },
      ],
    },
    { id: 'audit',              label: 'Audit Trail',        desc: 'Per-edit history block. Section-level toggle.' },
  ],
  transfer: [
    { id: 'customer',     label: 'Customer',     desc: 'Lead identity', fields: [
      { id: 'name', label: 'Name' }, { id: 'phone', label: 'Phone' },
      { id: 'email', label: 'Email' }, { id: 'address', label: 'Address' },
    ]},
    { id: 'vehicle',      label: 'Vehicle',      desc: 'Car details from lead', fields: [
      { id: 'year', label: 'Year' }, { id: 'make', label: 'Make' },
      { id: 'model', label: 'Model' }, { id: 'vin', label: 'VIN' },
    ]},
    { id: 'lead_info',    label: 'Lead Info',    desc: 'Other form_data fields' },
    { id: 'people',       label: 'People',       desc: 'Fronter + assigned closer', fields: [
      { id: 'fronter', label: 'Fronter' }, { id: 'closer', label: 'Assigned closer' },
    ]},
    { id: 'dispositions', label: 'Dispositions', desc: 'Disposition action history' },
    { id: 'timeline',     label: 'Timeline',     desc: 'Lifecycle timestamps', fields: [
      { id: 'created', label: 'Created' }, { id: 'updated', label: 'Updated' },
      { id: 'rejected', label: 'Rejected' },
    ]},
    { id: 'audit',        label: 'Audit Trail',  desc: 'Edit history + audit log' },
  ],
  callback: [
    { id: 'schedule', label: 'Schedule', desc: 'Callback time + customer timezone', fields: [
      { id: 'scheduled', label: 'Scheduled', desc: 'Scheduled callback time' },
      { id: 'timezone',  label: 'Timezone',  desc: 'Customer timezone' },
    ]},
    { id: 'customer', label: 'Customer', desc: 'Customer name + phone', fields: [
      { id: 'name',  label: 'Name',  desc: 'Customer name' },
      { id: 'phone', label: 'Phone', desc: 'Customer phone' },
    ]},
    { id: 'agent',    label: 'Agent',    desc: 'Assigned agent + company', fields: [
      { id: 'agent',   label: 'Agent',   desc: 'Agent who owns the callback' },
      { id: 'company', label: 'Company', desc: 'Agent company' },
    ]},
    { id: 'notes',    label: 'Notes',    desc: 'Closer notes. Section-level toggle.' },
    { id: 'meta',     label: 'Meta',     desc: 'Created / source / record id', fields: [
      { id: 'created',   label: 'Created',   desc: 'Row insertion time' },
      { id: 'source',    label: 'Source',    desc: 'Origin of the callback' },
      { id: 'record_id', label: 'Record ID', desc: 'Internal id' },
    ]},
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Field row — tiny inner toggle for a single field within a section.
// ─────────────────────────────────────────────────────────────────────────────
const FieldRow = ({ field, idx, total, onToggle, onMove, dnd }) => {
  const beingDragged = dnd?.enabled && dnd?.dragging?.fieldId === field.id && dnd?.dragging?.sectionId === dnd?.sectionId;
  return (
    <div
      draggable={!!dnd?.enabled}
      onDragStart={dnd?.enabled ? (e) => { e.stopPropagation(); dnd.onFieldDragStart(field.id, field.label || field.id); } : undefined}
      onDragEnd={dnd?.enabled ? () => dnd.onFieldDragEnd() : undefined}
      className="flex items-center gap-2 py-1.5 px-2 rounded-md ml-7 transition-all"
      style={{
        backgroundColor: field.visible ? 'var(--color-surface)' : 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border)',
        opacity: beingDragged ? 0.4 : (field.visible ? 1 : 0.55),
        cursor: dnd?.enabled ? 'grab' : 'default',
      }}
    >
      {dnd?.enabled && (
        <GripVertical size={12} className="flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}
          title="Drag to move this field to another section" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-text">{field.label || field.id}</p>
        {field._desc && <p className="text-[10px] text-text-tertiary leading-snug mt-0.5">{field._desc}</p>}
      </div>
      <div className="flex items-center gap-0.5 flex-shrink-0">
        <button type="button" onClick={() => onMove(idx, -1)} disabled={idx === 0}
          aria-label="Move field up" title="Move up"
          className="p-1 rounded hover:bg-bg-secondary disabled:opacity-30 disabled:cursor-not-allowed"
          style={{ minWidth: 26, minHeight: 26 }}>
          <ChevronUp size={11} />
        </button>
        <button type="button" onClick={() => onMove(idx, 1)} disabled={idx === total - 1}
          aria-label="Move field down" title="Move down"
          className="p-1 rounded hover:bg-bg-secondary disabled:opacity-30 disabled:cursor-not-allowed"
          style={{ minWidth: 26, minHeight: 26 }}>
          <ChevronDown size={11} />
        </button>
      </div>
      <button type="button" onClick={onToggle}
        aria-label={field.visible ? 'Hide field' : 'Show field'}
        title={field.visible ? 'Hide field' : 'Show field'}
        className="inline-flex items-center justify-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold flex-shrink-0"
        style={{
          backgroundColor: field.visible ? 'var(--color-success-100, #d1fae5)' : 'var(--color-bg-secondary)',
          color: field.visible ? 'var(--color-success-700, #047857)' : 'var(--color-text-tertiary)',
          minHeight: 24, minWidth: 56,
        }}>
        {field.visible ? <><Eye size={9} /> Show</> : <><EyeOff size={9} /> Hide</>}
      </button>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Section row — clickable header + expandable field list.
// ─────────────────────────────────────────────────────────────────────────────
const SectionRow = ({ section, catalogEntry, idx, total, expanded, onExpandToggle, onToggle, onMove, onFieldToggle, onFieldMove, accent, dnd }) => {
  const [over, setOver] = useState(false);
  // Field-capable if the catalog defines fields OR the section currently holds
  // dragged-in fields — so moved fields stay manageable (expandable) here.
  const hasFields = (Array.isArray(catalogEntry?.fields) && catalogEntry.fields.length > 0) || (section.fields?.length || 0) > 0;
  const fieldCount = section.fields?.length || 0;
  const visibleFieldCount = (section.fields || []).filter(f => f.visible).length;
  const dragActive  = dnd?.enabled && dnd?.dragging;
  const isSource    = dragActive && dnd.dragging.sectionId === section.id;
  const canDropHere = !!dnd?.canDrop && dragActive && !isSource;

  return (
    <div
      onDragOver={canDropHere ? (e) => { e.preventDefault(); setOver(true); } : undefined}
      onDragLeave={canDropHere ? () => setOver(false) : undefined}
      onDrop={canDropHere ? (e) => { e.preventDefault(); setOver(false); dnd.onDropHere(); } : undefined}
      className="rounded-xl transition-all overflow-hidden"
      style={{
        backgroundColor: over && canDropHere ? `${accent}12` : (section.visible ? 'var(--color-surface)' : 'var(--color-bg-secondary)'),
        border: '1px solid var(--color-border)',
        borderLeft: `3px solid ${section.visible ? accent : 'var(--color-border)'}`,
        outline: canDropHere ? `2px dashed ${over ? accent : 'var(--color-border)'}` : 'none',
        outlineOffset: -2,
        opacity: section.visible ? 1 : 0.65,
      }}
    >
      <div className="flex items-center gap-2 p-3">
        {/* Expand toggle — only when section has a fields catalog */}
        {hasFields ? (
          <button type="button" onClick={onExpandToggle}
            aria-label={expanded ? 'Collapse section' : 'Expand section to edit fields'}
            title={expanded ? 'Collapse fields' : 'Edit fields in this section'}
            className="p-1 rounded hover:bg-bg-secondary flex-shrink-0"
            style={{ minWidth: 28, minHeight: 28 }}>
            <ChevronRight size={14}
              style={{ transition: 'transform 0.15s', transform: expanded ? 'rotate(90deg)' : 'none' }} />
          </button>
        ) : <div style={{ width: 28 }} />}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-text">{section.label || catalogEntry?.label || section.id}</p>
            {hasFields && fieldCount > 0 && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}>
                {visibleFieldCount}/{fieldCount} fields
              </span>
            )}
            {canDropHere && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded"
                style={{ backgroundColor: `${accent}1a`, color: accent }}>
                <MoveRight size={10} /> drop field here
              </span>
            )}
          </div>
          {catalogEntry?.desc && (
            <p className="text-xs text-text-tertiary mt-0.5 leading-snug">{catalogEntry.desc}</p>
          )}
        </div>

        {/* Reorder */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button type="button" onClick={() => onMove(idx, -1)} disabled={idx === 0}
            aria-label="Move section up" title="Move up"
            className="p-1.5 rounded hover:bg-bg-secondary disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ minWidth: 32, minHeight: 32 }}>
            <ChevronUp size={14} />
          </button>
          <button type="button" onClick={() => onMove(idx, 1)} disabled={idx === total - 1}
            aria-label="Move section down" title="Move down"
            className="p-1.5 rounded hover:bg-bg-secondary disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ minWidth: 32, minHeight: 32 }}>
            <ChevronDown size={14} />
          </button>
        </div>

        {/* Visibility */}
        <button type="button" onClick={onToggle}
          aria-label={section.visible ? 'Hide section' : 'Show section'}
          title={section.visible ? 'Hide entire section' : 'Show section'}
          className="inline-flex items-center justify-center gap-1 px-2 py-1 rounded text-xs font-bold flex-shrink-0"
          style={{
            backgroundColor: section.visible ? 'var(--color-success-100, #d1fae5)' : 'var(--color-bg-secondary)',
            color: section.visible ? 'var(--color-success-700, #047857)' : 'var(--color-text-tertiary)',
            minHeight: 32, minWidth: 72,
          }}>
          {section.visible ? <><Eye size={11} /> Visible</> : <><EyeOff size={11} /> Hidden</>}
        </button>
      </div>

      {/* Expanded field list */}
      {hasFields && expanded && (
        <div className="px-3 pb-3 space-y-1"
          style={{ borderTop: '1px dashed var(--color-border)', paddingTop: 8 }}>
          {(section.fields || []).map((f, fi) => (
            <FieldRow key={f.id} field={f} idx={fi} total={section.fields.length}
              onToggle={() => onFieldToggle(fi)}
              onMove={onFieldMove}
              dnd={dnd}
            />
          ))}
          {(!section.fields || section.fields.length === 0) && (
            <p className="text-xs text-text-tertiary px-2 py-1">
              No fields registered yet — using catalog defaults (all visible).
            </p>
          )}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────
const DrawerLayoutRules = ({ config, scope, onSave, userId = null, userName = '', userRole = null }) => {
  const [drawerType, setDrawerType] = useState('sale');
  const [role,       setRole]       = useState('closer');
  const [expanded,   setExpanded]   = useState({});       // sectionId -> bool
  const [dragField,  setDragField]  = useState(null);     // { sectionId, fieldId, label }

  // Live form-builder fields → drive the dynamic section's catalog, so a field
  // removed in Form Builder disappears from the drawer setting too.
  const { fields: formFields, fetchFields } = useFormFields();
  useEffect(() => { fetchFields(); }, [fetchFields]);

  // Per-user mode: edit one user's layout (wins over their role); otherwise edit
  // a role's layout. The key is the only difference — all editing logic is shared.
  const key      = userId
    ? `drawer.layout.${drawerType}.user.${userId}`
    : `drawer.layout.${drawerType}.${role}`;
  // In user mode, before any user override exists, seed the editor from the
  // user's role layout (what they see today) instead of a blank catalog — so the
  // superadmin tweaks from reality. Display-only: nothing persists until a change.
  const roleSeedKey = userId && userRole ? `drawer.layout.${drawerType}.${userRole}` : null;
  const accent   = userId ? '#6366f1' : (ROLES.find(r => r.key === role)?.accent || '#6366f1');

  // Dynamic (form-builder) fields that aren't core/column-mapped — these belong
  // to the catch-all section by default and can be dragged into any section.
  const dynamicFieldDefs = useMemo(() => (formFields || [])
    .filter(f => f && f.name && !SKIP_FORM_KEYS.has(f.name) && !SPECIAL_FIELD_TYPES.has(f.field_type))
    .map(f => ({ id: f.name, label: f.label || f.name, desc: 'Form-builder field' })),
    [formFields]);

  // Catalog with the dynamic section's (additional / lead_info) fields filled
  // live from the form config.
  const catalog = useMemo(() => {
    const base  = SECTION_CATALOG[drawerType] || [];
    const dynId = DYNAMIC_SECTION[drawerType];
    if (!dynId) return base;
    return base.map(sec => sec.id === dynId ? { ...sec, fields: dynamicFieldDefs } : sec);
  }, [drawerType, dynamicFieldDefs]);

  // All valid field ids (core + current dynamic). Stored fields referencing a
  // now-deleted form field get pruned. Empty until form fields load — we guard
  // pruning on that so nothing is dropped prematurely.
  const allValidFieldIds = useMemo(() => {
    const s = new Set();
    (SECTION_CATALOG[drawerType] || []).forEach(sec => (sec.fields || []).forEach(f => s.add(f.id)));
    dynamicFieldDefs.forEach(d => s.add(d.id));
    return s;
  }, [drawerType, dynamicFieldDefs]);

  // Cross-section field drag is wired for every drawer — each renderer is fully
  // field-id driven (Sale / Transfer / Callback). Special blocks (audit, the
  // disposition timeline, the notes paragraph, compliance buttons) can't host
  // individual fields, so they're never drop targets.
  const dndEnabled = true;
  const DROP_DENY_BY_TYPE = {
    sale:     ['audit', 'compliance_actions'],
    transfer: ['audit', 'dispositions'],
    callback: ['notes'],
  };
  const DROP_DENY = DROP_DENY_BY_TYPE[drawerType] || [];

  // Resolve current sections, merging with the catalog so new sections appear
  // at the bottom hidden + new fields appear at the bottom hidden too.
  const sections = useMemo(() => {
    // User mode with no override yet → seed from the role layout if one exists.
    const stored = config?.[key] || (roleSeedKey ? config?.[roleSeedKey] : null);
    if (Array.isArray(stored) && stored.length) {
      const known = new Set(stored.map(s => s.id));
      const extraSections = catalog.filter(c => !known.has(c.id))
        .map((c, i) => ({
          id: c.id, label: c.label, visible: false, order: stored.length + i + 1,
          fields: (c.fields || []).map((f, j) => ({ id: f.id, label: f.label, visible: true, order: j + 1 })),
        }));
      const merged = [...stored, ...extraSections];
      // A field may have been dragged to a different section — so a catalog field
      // is auto-added to its default section ONLY when it isn't already placed in
      // ANY section. (Without this, moving a field re-adds a duplicate to its
      // original section on the next render.)
      const placedEverywhere = new Set(merged.flatMap(s => (s.fields || []).map(f => f.id)));
      const fieldsLoaded = !!(formFields && formFields.length);
      return merged.map(s => {
        const cat = catalog.find(c => c.id === s.id);
        const catFields = cat?.fields || [];
        // Prune fields whose form-builder source was deleted (only once form
        // fields have loaded, so nothing is dropped prematurely).
        let curFields = s.fields || [];
        if (fieldsLoaded) curFields = curFields.filter(f => allValidFieldIds.has(f.id));
        const extraFields = catFields.filter(c => !placedEverywhere.has(c.id))
          .map((c, i) => ({ id: c.id, label: c.label, visible: true, order: (curFields.length || 0) + i + 1 }));
        return { ...s, fields: [...curFields, ...extraFields].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) };
      }).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }
    // No config yet — build from catalog (all visible).
    return catalog.map((c, i) => ({
      id: c.id, label: c.label, visible: true, order: i + 1,
      fields: (c.fields || []).map((f, j) => ({ id: f.id, label: f.label, visible: true, order: j + 1 })),
    }));
  }, [config, key, roleSeedKey, catalog, formFields, allValidFieldIds]);

  const persist = (next) => {
    const renumbered = next.map((s, i) => ({
      ...s,
      order: i + 1,
      fields: (s.fields || []).map((f, j) => ({ ...f, order: j + 1 })),
    }));
    onSave(key, renumbered);
    clearDrawerLayoutCache();
  };

  const toggle = (idx) => {
    const next = [...sections];
    next[idx] = { ...next[idx], visible: !next[idx].visible };
    persist(next);
  };
  const move = (idx, delta) => {
    const ni = idx + delta;
    if (ni < 0 || ni >= sections.length) return;
    const next = [...sections];
    [next[idx], next[ni]] = [next[ni], next[idx]];
    persist(next);
  };

  // Field-level operations route through their section.
  const toggleField = (sectionIdx, fieldIdx) => {
    const next = [...sections];
    const s = { ...next[sectionIdx] };
    s.fields = [...(s.fields || [])];
    s.fields[fieldIdx] = { ...s.fields[fieldIdx], visible: !s.fields[fieldIdx].visible };
    next[sectionIdx] = s;
    persist(next);
  };
  const moveField = (sectionIdx) => (fieldIdx, delta) => {
    const next = [...sections];
    const s = { ...next[sectionIdx] };
    const arr = [...(s.fields || [])];
    const ni = fieldIdx + delta;
    if (ni < 0 || ni >= arr.length) return;
    [arr[fieldIdx], arr[ni]] = [arr[ni], arr[fieldIdx]];
    s.fields = arr;
    next[sectionIdx] = s;
    persist(next);
  };

  // Move a field from one section to another (drag-and-drop). Removes it from
  // the source section and appends it (visible) to the target.
  const dropFieldOnSection = (toSectionId) => {
    const drag = dragField;
    setDragField(null);
    if (!drag) return;
    const { sectionId: fromId, fieldId } = drag;
    if (fromId === toSectionId || DROP_DENY.includes(toSectionId)) return;
    const next = sections.map(s => ({ ...s, fields: [...(s.fields || [])] }));
    const from = next.find(s => s.id === fromId);
    const to   = next.find(s => s.id === toSectionId);
    if (!from || !to) return;
    const fi = from.fields.findIndex(f => f.id === fieldId);
    if (fi < 0) return;
    const [moved] = from.fields.splice(fi, 1);
    to.fields.push({ ...moved, visible: true });
    persist(next);
  };

  const resetToDefault = () => {
    if (!window.confirm('Reset this drawer to the default catalog (all sections + all fields visible)?')) return;
    persist(catalog.map((c, i) => ({
      id: c.id, label: c.label, visible: true, order: i + 1,
      fields: (c.fields || []).map((f, j) => ({ id: f.id, label: f.label, visible: true, order: j + 1 })),
    })));
  };

  // Quick actions
  const expandAll   = () => { const e = {}; sections.forEach(s => { e[s.id] = true; }); setExpanded(e); };
  const collapseAll = () => setExpanded({});
  const hideAll     = () => persist(sections.map(s => ({ ...s, visible: false })));
  const showAll     = () => persist(sections.map(s => ({ ...s, visible: true })));

  const visibleCount = sections.filter(s => s.visible).length;

  return (
    <div className="w-full pb-8">
      {/* Per-company override warning */}
      {scope !== 'global' && (
        <div className="rounded-2xl p-4 mb-4 flex items-start gap-3"
          style={{ backgroundColor: 'var(--color-warning-50, #fffbeb)', border: '1px solid var(--color-warning-300, #fcd34d)' }}>
          <AlertTriangle size={18} style={{ color: 'var(--color-warning-700, #b45309)' }} className="flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-bold mb-0.5" style={{ color: 'var(--color-warning-800, #92400e)' }}>Per-company override active</p>
            <p style={{ color: 'var(--color-warning-700, #b45309)' }}>Layout changes apply only to the selected company. Roles you don't customize here fall back to global defaults.</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-text mb-1 flex items-center gap-2.5"
          style={{ fontFamily: 'var(--font-display)' }}>
          <LayoutTemplate size={22} className="text-primary-600" /> Drawer Layout
          <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ml-1"
            style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>
            field-level
          </span>
        </h2>
        <p className="text-sm text-text-secondary max-w-2xl leading-relaxed">
          Tune what each role sees inside the Sale / Transfer / Callback drawers — at the section AND field level. Hiding a section here hides it everywhere; expanding a section lets you hide individual rows like Down Payment or VIN. On <strong>any</strong> drawer you can also <strong>drag a field by its ⠿ handle and drop it into another section</strong> to re-home it.
        </p>
      </div>

      {/* ── Drawer + role picker — high-contrast cards instead of plain dropdowns */}
      <section className="rounded-2xl mb-4 p-5"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderTop: `3px solid ${accent}` }}>
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={14} style={{ color: accent }} />
          <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">Editing</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="drawer-type" className="text-[11px] font-bold uppercase tracking-wide text-text-secondary mb-1.5 block">
              Drawer type
            </label>
            <ThemedSelect id="drawer-type" value={drawerType} onChange={(e) => { setDrawerType(e.target.value); setExpanded({}); }}
              className="input text-sm py-2 w-full">
              {DRAWER_TYPES.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
            </ThemedSelect>
            <p className="text-[11px] text-text-tertiary mt-1.5 leading-relaxed">
              {DRAWER_TYPES.find(d => d.key === drawerType)?.desc}
            </p>
          </div>
          {userId ? (
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wide text-text-secondary mb-1.5 block">Editing for</label>
              <div className="px-3 py-2 rounded-lg text-sm font-semibold" style={{ border: `1px solid ${accent}`, background: `${accent}15`, color: accent }}>
                {userName || 'this user'}
              </div>
              <p className="text-[11px] text-text-tertiary mt-1.5 leading-relaxed">Only this user is affected — overrides their role's layout. Leave a drawer untouched and they keep the role default.</p>
            </div>
          ) : (
            <div>
              <label htmlFor="drawer-role" className="text-[11px] font-bold uppercase tracking-wide text-text-secondary mb-1.5 block">
                Role
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {ROLES.map(r => (
                  <button key={r.key} type="button" onClick={() => setRole(r.key)}
                    className="text-xs font-semibold px-2 py-2 rounded-lg transition-all flex items-center gap-1.5"
                    style={{
                      border: '1px solid',
                      borderColor: role === r.key ? r.accent : 'var(--color-border)',
                      background: role === r.key ? `${r.accent}15` : 'transparent',
                      color: role === r.key ? r.accent : 'var(--color-text-secondary)',
                      minHeight: 32,
                    }}>
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: r.accent }} />
                    <span className="truncate">{r.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Quick actions + summary ────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs text-text-tertiary">
          <Layers size={12} />
          <span>{visibleCount} of {sections.length} sections visible · Editing {userId
            ? <>for <strong style={{ color: accent }}>{userName || 'this user'}</strong></>
            : <>as <strong style={{ color: accent }}>{ROLES.find(r => r.key === role)?.label}</strong></>}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button type="button" onClick={expandAll}
            className="text-[11px] font-semibold px-2 py-1.5 rounded border hover:bg-bg-secondary"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)', minHeight: 28 }}>
            Expand all
          </button>
          <button type="button" onClick={collapseAll}
            className="text-[11px] font-semibold px-2 py-1.5 rounded border hover:bg-bg-secondary"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)', minHeight: 28 }}>
            Collapse all
          </button>
          <span className="w-px h-4" style={{ backgroundColor: 'var(--color-border)' }} />
          <button type="button" onClick={showAll}
            className="text-[11px] font-semibold px-2 py-1.5 rounded border hover:bg-bg-secondary inline-flex items-center gap-1"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-success-700)', minHeight: 28 }}>
            <Eye size={11} /> Show all
          </button>
          <button type="button" onClick={hideAll}
            className="text-[11px] font-semibold px-2 py-1.5 rounded border hover:bg-bg-secondary inline-flex items-center gap-1"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-tertiary)', minHeight: 28 }}>
            <EyeOff size={11} /> Hide all
          </button>
          <button type="button" onClick={resetToDefault}
            className="text-[11px] font-semibold px-2 py-1.5 rounded inline-flex items-center gap-1 text-white"
            style={{ background: 'var(--gradient-sidebar)', minHeight: 28 }}>
            <RotateCcw size={11} /> Reset
          </button>
        </div>
      </div>

      {/* ── Section + field list ──────────────────────────────────────── */}
      <div className="space-y-2">
        {sections.map((s, i) => (
          <SectionRow
            key={s.id}
            section={{
              ...s,
              fields: (s.fields || []).map(f => {
                const cat = (catalog.find(c => c.id === s.id)?.fields || []).find(x => x.id === f.id);
                return { ...f, _desc: cat?.desc };
              }),
            }}
            catalogEntry={catalog.find(c => c.id === s.id)}
            idx={i}
            total={sections.length}
            expanded={!!expanded[s.id]}
            accent={accent}
            onExpandToggle={() => setExpanded(e => ({ ...e, [s.id]: !e[s.id] }))}
            onToggle={() => toggle(i)}
            onMove={move}
            onFieldToggle={(fi) => toggleField(i, fi)}
            onFieldMove={moveField(i)}
            dnd={dndEnabled ? {
              enabled: true,
              sectionId: s.id,
              dragging: dragField,
              canDrop: !DROP_DENY.includes(s.id),
              onDropHere: () => dropFieldOnSection(s.id),
              onFieldDragStart: (fieldId, label) => setDragField({ sectionId: s.id, fieldId, label }),
              onFieldDragEnd: () => setDragField(null),
            } : undefined}
          />
        ))}
      </div>

      <p className="text-xs text-text-tertiary mt-4 flex items-start gap-1.5 leading-relaxed">
        <Info size={12} className="flex-shrink-0 mt-0.5" />
        Section IDs are stable and known to the drawer code. Field IDs are also stable; if a future drawer adds a new field, it appears here automatically with visibility ON so nothing gets hidden by accident. Changes save instantly and bust the in-memory cache.
      </p>
    </div>
  );
};

export default DrawerLayoutRules;
