/**
 * FormBuilder — SuperAdmin form management hub.
 *
 * Has its own internal vertical sidebar with three sections:
 *   Form Layout  — drag-drop 3-column canvas
 *   Clients      — manage client options (from sale_configs)
 *   Plans        — manage plan options (from sale_configs)
 *
 * Client → Plan cascade mapping is configured on the Form Layout canvas
 * via the "Map Plans" button on the Plan field card.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  GripVertical, Plus, Save, Eye, EyeOff,
  Settings, CheckSquare,
  Type, Hash, Mail, Phone, Calendar, AlignLeft, List, DollarSign,
  X, Zap, Users, UserX, Tag, Briefcase, Link2, Car,
  ChevronRight, Layers, ListChecks, LayoutGrid, ArrowRight, MessageSquare,
  Bookmark, BookOpen, Trash2, Pencil, Check, Info,
} from 'lucide-react';
import DispositionManager from './DispositionManager';
import VehicleManager from '../Vehicles/VehicleManager';
import ClientPlanManager from '../ClientPlans/ClientPlanManager';
import client from '../../../api/client';
import { toast, toastError } from '../../../utils/toast';
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

const SALE_FIELDS = [
  { name: 'SaleClient', label: 'Client', field_type: 'sale_client', is_required: false },
  { name: 'SalePlan',   label: 'Plan',   field_type: 'sale_plan',   is_required: false },
];

const CLOSER_DEAL_FIELDS = [
  { name: 'SaleDownPayment',    label: 'Down Payment',     field_type: 'sale_down_payment',    is_required: false },
  { name: 'SaleMonthlyPayment', label: 'Monthly Payment',  field_type: 'sale_monthly_payment', is_required: false },
  { name: 'SalePaymentDue',     label: 'Payment Due Note', field_type: 'sale_payment_due_note', is_required: false },
  { name: 'SaleReferenceNo',    label: 'Reference No',     field_type: 'sale_reference_no',    is_required: false },
  { name: 'SaleFronter',        label: 'Fronter',          field_type: 'sale_fronter',         is_required: false },
  { name: 'SaleDate',           label: 'Sale Date',        field_type: 'sale_date',            is_required: false },
  { name: 'SaleDisposition', label: 'Closer Disposition', field_type: 'sale_disposition', is_required: false, options: ['Sale', 'No Sale', 'Callback', 'Not Interested', 'Voicemail', 'Other'] },
  { name: 'SaleCallReview', label: 'Rate Call', field_type: 'sale_call_review', is_required: false, options: ['Excellent', 'Good', 'Average', 'Poor', 'Bad'] },
];

const TYPE_ICONS = {
  text: Type, email: Mail, number: Hash, tel: Phone, phone: Phone,
  zip: Hash, date: Calendar, textarea: AlignLeft, select: List,
  checkbox: CheckSquare, sale_client: Tag, sale_plan: Briefcase,
  sale_down_payment: DollarSign, sale_monthly_payment: DollarSign,
  sale_payment_due_note: AlignLeft, sale_reference_no: Hash,
  sale_fronter: Users, sale_date: Calendar, sale_disposition: List, sale_status: List,
  sale_call_review: ListChecks,
};
const TYPE_LABELS = {
  text: 'Text', email: 'Email', number: 'Number', tel: 'Phone',
  phone: 'Phone', zip: 'Zip', date: 'Date', textarea: 'Textarea',
  select: 'Select', checkbox: 'Checkbox', sale_client: 'Client', sale_plan: 'Plan',
  sale_down_payment: 'Down Payment', sale_monthly_payment: 'Monthly Payment',
  sale_payment_due_note: 'Payment Due Note', sale_reference_no: 'Reference No',
  sale_fronter: 'Fronter', sale_date: 'Sale Date', sale_disposition: 'Closer Disposition', sale_status: 'Closer Disposition',
  sale_call_review: 'Rate Call',
};
const SPAN_LABEL = { 1: '1/5', 2: '2/5', 3: '3/5', 4: '4/5', 5: 'Full' };
const SPAN_CLASS  = { 1: 'col-span-1', 2: 'col-span-2', 3: 'col-span-3', 4: 'col-span-4', 5: 'col-span-5' };

const FieldIcon = ({ type, size = 14 }) => {
  const Icon = TYPE_ICONS[type] || Type;
  return <Icon size={size} />;
};

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar
// ─────────────────────────────────────────────────────────────────────────────
// Legacy entries hidden (clients / plans / mapping) — superseded by the new
// 'clients-plans' manager which combines all three into one parent→child UI
// that mirrors the Vehicles layout. Components stay imported and the legacy
// activeSection branches still render in case a deep link / saved state lands
// on one — data lives in sale_configs regardless of UI surface.
const FB_SIDEBAR = [
  {
    section: 'FORM',
    items: [
      { id: 'layout',  label: 'Form Layout',      icon: LayoutGrid  },
    ],
  },
  {
    section: 'REGISTRY',
    items: [
      { id: 'vehicles',      label: 'Vehicles',         icon: Car  },
      { id: 'clients-plans', label: 'Clients & Plans',  icon: Tag  },
    ],
  },
  {
    section: 'SALE CONFIG',
    items: [
      { id: 'dispositions', label: 'Dispositions',      icon: MessageSquare  },
    ],
  },
];

const FormBuilderSidebar = ({ active, onChange }) => (
  <aside
    className="flex-shrink-0 flex flex-col"
    style={{
      width: 208,
      backgroundColor: 'var(--color-surface)',
      borderRight: '1px solid var(--color-border)',
      height: '100%',
    }}
  >
    {/* Header */}
    <div className="px-4 py-4 flex items-center gap-2.5"
      style={{ borderBottom: '1px solid var(--color-border)' }}>
      <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: 'var(--gradient-sidebar)' }}>
        <Settings size={15} className="text-white" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-bold truncate" style={{ color: 'var(--color-text)' }}>Form Builder</p>
        <p className="text-xs truncate" style={{ color: 'var(--color-text-tertiary)' }}>Layout & Sale Config</p>
      </div>
    </div>

    {/* Nav */}
    <nav className="flex-1 overflow-y-auto p-3 space-y-4">
      {FB_SIDEBAR.map(group => (
        <div key={group.section}>
          <p className="text-xs font-bold uppercase tracking-widest px-3 mb-2"
            style={{ color: 'var(--color-text-tertiary)' }}>
            {group.section}
          </p>
          <div className="space-y-0.5">
            {group.items.map(item => {
              const isActive = active === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onChange(item.id)}
                  className="w-full text-left px-3 py-2.5 rounded-xl transition-all duration-150 flex items-center gap-3"
                  style={{
                    background:  isActive ? 'var(--gradient-sidebar)' : 'transparent',
                    color:       isActive ? 'white' : 'var(--color-text-secondary)',
                    fontWeight:  isActive ? '600' : '500',
                    fontSize:    14,
                  }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)'; }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: isActive ? 'rgba(255,255,255,0.2)' : 'var(--color-bg-secondary)' }}>
                    <item.icon size={15} style={{ color: isActive ? 'white' : 'var(--color-text-secondary)' }} />
                  </div>
                  <span className="flex-1 truncate">{item.label}</span>
                  {isActive && <ChevronRight size={13} style={{ color: 'rgba(255,255,255,0.7)', flexShrink: 0 }} />}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>

    {/* Footer */}
    <div className="p-4 flex-shrink-0" style={{ borderTop: '1px solid var(--color-border)' }}>
      <p className="text-xs text-center" style={{ color: 'var(--color-text-tertiary)' }}>
        Changes saved globally
      </p>
    </div>
  </aside>
);

// ─────────────────────────────────────────────────────────────────────────────
// Sale Config Panel (Clients or Plans)
// ─────────────────────────────────────────────────────────────────────────────
const ConfigPanel = ({ type, items, loading, onAdd, onDelete, saving, deleting }) => {
  const [newVal, setNewVal] = useState('');
  const isClient = type === 'client';
  const label    = isClient ? 'Client' : 'Plan';
  const Icon     = isClient ? Tag : ListChecks;
  const accent   = isClient ? '#6366f1' : '#f59e0b';

  const handleAdd = async () => {
    if (!newVal.trim()) return;
    await onAdd(type, newVal.trim());
    setNewVal('');
  };

  return (
    <div className="max-w-2xl animate-fade-in">
      {/* Page header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: `${accent}18` }}>
            <Icon size={20} style={{ color: accent }} />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-text">{label}s</h2>
            <p className="text-sm text-text-secondary">
              {isClient
                ? 'Clients shown in the sale form. After adding clients, go to "Client → Plans" to assign which plans each client shows.'
                : 'Plans available in the sale form. After adding plans, go to "Client → Plans" to map them to clients.'}
            </p>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="rounded-2xl overflow-hidden"
        style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>

        {/* List header */}
        <div className="flex items-center justify-between px-5 py-3.5"
          style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
          <div className="flex items-center gap-2">
            <Icon size={16} style={{ color: accent }} />
            <span className="font-bold text-sm text-text">{label}s</span>
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
              style={{ backgroundColor: `${accent}18`, color: accent }}>
              {items.length}
            </span>
          </div>
        </div>

        {/* Items */}
        <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
          {loading ? (
            <div className="flex justify-center py-10">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2" style={{ borderColor: accent }} />
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-10">
              <Icon size={32} className="mx-auto mb-2 opacity-20" style={{ color: accent }} />
              <p className="text-sm text-text-secondary">No {label.toLowerCase()}s yet.</p>
              <p className="text-xs text-text-tertiary mt-0.5">Add one below to get started.</p>
            </div>
          ) : items.map(item => (
            <div key={item.id}
              className="flex items-center justify-between px-5 py-3.5 group hover:bg-bg-secondary transition-colors">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: `${accent}15` }}>
                  <Icon size={13} style={{ color: accent }} />
                </div>
                <span className="text-sm font-medium text-text truncate">{item.value}</span>
                {item.company_id === null && (
                  <span className="text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0"
                    style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}>
                    global
                  </span>
                )}
              </div>
              <button
                onClick={() => onDelete(item.id, type)}
                disabled={deleting === item.id}
                className="w-7 h-7 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:bg-red-100 flex-shrink-0"
                title={`Delete ${label.toLowerCase()}`}>
                {deleting === item.id
                  ? <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-red-500" />
                  : <X size={13} style={{ color: '#ef4444' }} />}
              </button>
            </div>
          ))}
        </div>

        {/* Add new */}
        <div className="flex gap-2 px-4 py-3.5"
          style={{ borderTop: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
          <input
            type="text"
            value={newVal}
            onChange={e => setNewVal(e.target.value)}
            placeholder={`Add ${label.toLowerCase()} name…`}
            className="input flex-1 text-sm h-9"
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
          />
          <button
            onClick={handleAdd}
            disabled={saving || !newVal.trim()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold text-white transition-all hover:scale-[1.02] disabled:opacity-50"
            style={{ background: 'var(--gradient-sidebar)' }}>
            <Plus size={14} /> Add
          </button>
        </div>
      </div>

      {isClient && (
        <p className="text-xs text-text-tertiary mt-3 px-1">
          After adding clients and plans, go to <strong>Client → Plans</strong> in the sidebar to configure which plans appear for each client.
        </p>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Mapping Panel — client × plan matrix (full-page, replaces modal approach)
// ─────────────────────────────────────────────────────────────────────────────
const MappingPanel = ({ clients, plans, configLoading }) => {
  const [mapping,   setMapping]   = useState({});
  const [fieldId,   setFieldId]   = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);

  const loadMapping = useCallback(async () => {
    setLoading(true);
    try {
      const res     = await client.get('forms/fields');
      const pField  = (res.data.fields || []).find(f => f.field_type === 'sale_plan');
      if (pField) {
        setFieldId(pField.id);
        const m = {};
        (pField.options || []).forEach(o => { m[o.client] = new Set(o.plans || []); });
        setMapping(m);
      } else {
        setFieldId(null);
      }
    } catch { /* non-critical */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadMapping(); }, [loadMapping]);

  const toggle = (clientVal, planVal) =>
    setMapping(prev => {
      const s = new Set(prev[clientVal] || []);
      s.has(planVal) ? s.delete(planVal) : s.add(planVal);
      return { ...prev, [clientVal]: s };
    });

  const selectAll = (clientVal) =>
    setMapping(prev => ({ ...prev, [clientVal]: new Set(plans.map(p => p.value)) }));

  const clearAll = (clientVal) =>
    setMapping(prev => ({ ...prev, [clientVal]: new Set() }));

  const handleSave = async () => {
    if (!fieldId) return;
    setSaving(true);
    try {
      const options = clients
        .map(c => ({ client: c.value, plans: [...(mapping[c.value] || [])] }))
        .filter(m => m.plans.length > 0);
      await client.put(`forms/fields/${fieldId}`, { options });
      toast.success('Client → Plan mapping saved');
    } catch (err) {
      toastError(err, 'Failed to save mapping');
    } finally { setSaving(false); }
  };

  const isLoading = loading || configLoading;

  return (
    // bsx-allow-select overrides the shell-wide bsx-no-select so creators can
    // still copy/paste field names, options, and labels while configuring forms.
    <div className="max-w-3xl animate-fade-in bsx-allow-select">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: 'rgba(99,102,241,0.1)' }}>
            <ArrowRight size={20} style={{ color: '#6366f1' }} />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-text">Client → Plan Mapping</h2>
            <p className="text-sm text-text-secondary mt-0.5">
              Choose which plans are available when each client is selected in the form.
            </p>
          </div>
        </div>
        {fieldId && (
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold text-white transition-all hover:scale-105 disabled:opacity-50"
            style={{ background: 'var(--gradient-sidebar)' }}>
            <Save size={15} /> {saving ? 'Saving…' : 'Save Mapping'}
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      ) : !fieldId ? (
        <div className="rounded-2xl p-10 text-center"
          style={{ backgroundColor: 'var(--color-surface)', border: '2px dashed var(--color-border)' }}>
          <Briefcase size={36} className="mx-auto mb-3" style={{ color: 'var(--color-text-tertiary)' }} />
          <p className="font-semibold text-text mb-1">No Plan field on the form yet</p>
          <p className="text-sm text-text-secondary">
            Go to <strong>Form Layout</strong> → drag the <strong>Plan</strong> field onto the canvas → Save Layout.
            Then come back here to configure the mapping.
          </p>
        </div>
      ) : clients.length === 0 ? (
        <div className="rounded-2xl p-10 text-center"
          style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <Tag size={36} className="mx-auto mb-3" style={{ color: 'var(--color-text-tertiary)' }} />
          <p className="font-semibold text-text mb-1">No clients yet</p>
          <p className="text-sm text-text-secondary">Add clients in the <strong>Clients</strong> section first.</p>
        </div>
      ) : plans.length === 0 ? (
        <div className="rounded-2xl p-10 text-center"
          style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <ListChecks size={36} className="mx-auto mb-3" style={{ color: 'var(--color-text-tertiary)' }} />
          <p className="font-semibold text-text mb-1">No plans yet</p>
          <p className="text-sm text-text-secondary">Add plans in the <strong>Plans</strong> section first.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {clients.map(c => {
            const selectedSet = mapping[c.value] || new Set();
            const selectedCount = selectedSet.size;
            return (
              <div key={c.id} className="rounded-2xl overflow-hidden"
                style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>

                {/* Client header */}
                <div className="flex items-center justify-between px-5 py-3.5"
                  style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                      style={{ background: 'var(--gradient-sidebar)' }}>
                      <Tag size={14} className="text-white" />
                    </div>
                    <div>
                      <p className="font-bold text-text">{c.value}</p>
                      <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                        {selectedCount} of {plans.length} plan{plans.length !== 1 ? 's' : ''} selected
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => selectAll(c.value)}
                      className="text-xs px-2.5 py-1 rounded-lg font-semibold transition-colors hover:bg-primary-100"
                      style={{ color: 'var(--color-primary-600)' }}>
                      All
                    </button>
                    <button onClick={() => clearAll(c.value)}
                      className="text-xs px-2.5 py-1 rounded-lg font-semibold transition-colors hover:bg-error-100"
                      style={{ color: 'var(--color-error-600)' }}>
                      None
                    </button>
                  </div>
                </div>

                {/* Plan checkboxes */}
                <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {plans.map(p => {
                    const on = selectedSet.has(p.value);
                    return (
                      <label key={p.id}
                        className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer transition-all select-none"
                        style={{
                          backgroundColor: on ? 'var(--color-primary-50, #eef2ff)' : 'var(--color-bg-secondary)',
                          border: `1.5px solid ${on ? 'var(--color-primary-400, #818cf8)' : 'var(--color-border)'}`,
                          color: on ? 'var(--color-primary-700)' : 'var(--color-text)',
                        }}>
                        <div className="flex-shrink-0 w-4 h-4 rounded flex items-center justify-center transition-all"
                          style={{
                            backgroundColor: on ? 'var(--color-primary-600)' : 'transparent',
                            border: `1.5px solid ${on ? 'var(--color-primary-600)' : 'var(--color-text-tertiary)'}`,
                          }}>
                          {on && <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                            <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>}
                        </div>
                        <input type="checkbox" checked={on} onChange={() => toggle(c.value, p.value)} className="hidden" />
                        <span className="text-sm font-medium truncate">{p.value}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Save hint */}
          <p className="text-xs text-center pt-2" style={{ color: 'var(--color-text-tertiary)' }}>
            Changes only apply in the form when you click <strong>Save Mapping</strong>.
          </p>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Client→Plan mapping modal (used from Form Layout canvas)
// ─────────────────────────────────────────────────────────────────────────────
const ClientPlanMappingModal = ({ clients, plans, currentMapping, onSave, onClose }) => {
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
    <div className="fixed inset-0 z-50 overflow-y-auto" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}>
      <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl shadow-2xl flex flex-col max-h-[80vh]"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div>
            <h3 className="text-base font-bold text-text flex items-center gap-2"><Link2 size={16} /> Client → Plan Mapping</h3>
            <p className="text-xs text-text-secondary mt-0.5">Select which plans appear when each client is chosen</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-bg-secondary">
            <X size={18} style={{ color: 'var(--color-text-secondary)' }} />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">
          {clients.length === 0 && <p className="text-sm text-text-secondary text-center py-4">No clients yet — add them in the Clients section first.</p>}
          {plans.length === 0  && <p className="text-sm text-text-secondary text-center py-4">No plans yet — add them in the Plans section first.</p>}
          {clients.map(c => (
            <div key={c.id} className="rounded-xl p-4"
              style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
              <p className="text-sm font-bold text-text mb-2.5 flex items-center gap-1.5">
                <Tag size={13} style={{ color: 'var(--color-primary-500)' }} /> {c.value}
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {plans.map(p => {
                  const on = (checked[c.value] || new Set()).has(p.value);
                  return (
                    <label key={p.id} className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all text-sm"
                      style={{
                        backgroundColor: on ? 'var(--color-primary-50)' : 'var(--color-surface)',
                        border: `1px solid ${on ? 'var(--color-primary-300)' : 'var(--color-border)'}`,
                        color: on ? 'var(--color-primary-700)' : 'var(--color-text)',
                      }}>
                      <input type="checkbox" checked={on} onChange={() => toggle(c.value, p.value)}
                        className="w-3.5 h-3.5 accent-primary-600" />
                      <span className="font-medium truncate">{p.value}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
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
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Add Custom Field modal
// ─────────────────────────────────────────────────────────────────────────────
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
    <div className="fixed inset-0 z-50 overflow-y-auto" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}>
      <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl p-6 shadow-2xl"
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
            <p className="text-xs text-text-tertiary mt-0.5">Internal identifier. No spaces.</p>
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
                placeholder="Option A, Option B" className="input text-sm" />
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
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// OptionsEditor — chip-based add/rename/remove with confirm-on-delete +
// duplicate-check. Lives inside the FieldCard footer and persists every change
// to the server immediately via onSave. Never deletes silently; pending-remove
// state mirrors the "click twice" pattern the field-remove control uses, so
// SuperAdmin can't lose data with one click.
//
// Data-safety: historical form_data values keep the raw option string; this
// editor only changes what shows in NEW dropdowns. Caption explains that.
// ─────────────────────────────────────────────────────────────────────────────
const OptionsEditor = ({ field, onSave, onClose }) => {
  const initial = Array.isArray(field.options) ? field.options : [];
  const [opts, setOpts]               = useState(initial);
  const [newOpt, setNewOpt]           = useState('');
  const [editingIdx, setEditingIdx]   = useState(null);
  const [draft, setDraft]             = useState('');
  const [pendingRemove, setPendingRemove] = useState(null);
  const removeTimer = useRef(null);
  const editRef = useRef(null);

  useEffect(() => { if (editingIdx !== null) editRef.current?.focus(); }, [editingIdx]);
  useEffect(() => () => clearTimeout(removeTimer.current), []);

  const commit = (next) => {
    setOpts(next);
    onSave(next);
  };

  const addOption = () => {
    const v = newOpt.trim();
    if (!v) return;
    if (opts.some(o => o.toLowerCase() === v.toLowerCase())) {
      // Duplicate — flash by clearing the input but keep the existing entry.
      setNewOpt('');
      return;
    }
    commit([...opts, v]);
    setNewOpt('');
  };

  const startRename = (i) => {
    setEditingIdx(i);
    setDraft(opts[i]);
  };
  const commitRename = () => {
    const v = draft.trim();
    if (v && v !== opts[editingIdx]
        && !opts.some((o, i) => i !== editingIdx && o.toLowerCase() === v.toLowerCase())) {
      const next = opts.map((o, i) => i === editingIdx ? v : o);
      commit(next);
    }
    setEditingIdx(null);
  };

  const requestRemove = (i) => {
    if (pendingRemove === i) {
      clearTimeout(removeTimer.current);
      setPendingRemove(null);
      commit(opts.filter((_, j) => j !== i));
    } else {
      setPendingRemove(i);
      removeTimer.current = setTimeout(() => setPendingRemove(null), 3000);
    }
  };

  return (
    <div className="px-3 pb-3 pt-2"
      style={{ borderTop: '1px dashed var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-text-secondary inline-flex items-center gap-1.5">
          <List size={11} /> Options · {opts.length}
        </p>
        <button onClick={onClose} title="Close editor"
          className="p-1 rounded hover:bg-bg text-text-tertiary"
          style={{ minWidth: 26, minHeight: 26 }}>
          <X size={11} />
        </button>
      </div>

      <p className="text-[10px] leading-relaxed mb-2" style={{ color: 'var(--color-text-tertiary)' }}>
        Click a chip to rename. ✕ asks once before removing. Historical records keep the old text, so removing or renaming an option here never rewrites past sales.
      </p>

      {/* Chip list */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {opts.length === 0 && (
          <span className="text-[11px] italic" style={{ color: 'var(--color-text-tertiary)' }}>
            No options yet — add the first one below.
          </span>
        )}
        {opts.map((o, i) => editingIdx === i ? (
          <input
            key={`edit-${i}`}
            ref={editRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') setEditingIdx(null);
            }}
            className="text-xs px-2 py-1 rounded-full bg-white border outline-none"
            style={{ borderColor: 'var(--color-primary-400)', minWidth: 100 }} />
        ) : (
          <span key={`${o}-${i}`}
            className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 rounded-full text-xs font-semibold transition-all"
            style={{
              backgroundColor: pendingRemove === i ? 'var(--color-error-100, #fee2e2)' : 'var(--color-surface)',
              border: `1px solid ${pendingRemove === i ? 'var(--color-error-300, #fca5a5)' : 'var(--color-border)'}`,
              color:  pendingRemove === i ? 'var(--color-error-700, #b91c1c)' : 'var(--color-text)',
            }}>
            <button onClick={() => startRename(i)} className="cursor-text"
              title="Click to rename">
              {o}
            </button>
            <button onClick={() => requestRemove(i)}
              className="ml-0.5 rounded-full p-0.5 hover:bg-error-50"
              title={pendingRemove === i ? 'Click again to confirm' : 'Remove'}
              aria-label={pendingRemove === i ? `Confirm remove ${o}` : `Remove ${o}`}>
              {pendingRemove === i
                ? <span className="text-[10px] font-bold px-1">Remove?</span>
                : <X size={10} style={{ color: 'var(--color-error-500)' }} />}
            </button>
          </span>
        ))}
      </div>

      {/* Add new */}
      <div className="flex items-center gap-1.5">
        <input value={newOpt}
          onChange={(e) => setNewOpt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addOption(); }}
          placeholder="Add an option…"
          className="input text-xs py-1 h-auto flex-1" />
        <button onClick={addOption}
          disabled={!newOpt.trim() || opts.some(o => o.toLowerCase() === newOpt.trim().toLowerCase())}
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: 'var(--color-success-600, #16a34a)' }}>
          <Plus size={11} /> Add
        </button>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// FullEditPanel — one-stop edit surface that opens when the Pencil icon is
// clicked on a field card. Surfaces every editable property in a tight grid
// so the SuperAdmin doesn't have to hunt through footer toggles. Locked rows:
//   * `name` (form_data property name): renaming would orphan all historical
//     form_data rows that key on it. Shown read-only with a tooltip.
//   * `field_type` for sale_* fields: changing the type breaks the sale
//     pipeline (sale_plan → live mapping, sale_status → enum etc.). Locked.
// Every change writes via onPatch immediately; canvas changes are batched
// and persist on the next Save click — same as every other field edit.
// ─────────────────────────────────────────────────────────────────────────────
const TYPE_OPTIONS_FOR_EDIT = [
  { v: 'text',     label: 'Text'      },
  { v: 'textarea', label: 'Long text' },
  { v: 'number',   label: 'Number'    },
  { v: 'email',    label: 'Email'     },
  { v: 'tel',      label: 'Phone'     },
  { v: 'zip',      label: 'ZIP code'  },
  { v: 'date',     label: 'Date'      },
  { v: 'select',   label: 'Dropdown'  },
];

// Per-type config notes shown inside the modal so the SuperAdmin knows what
// each special field type does + what's editable. Helps onboard non-engineers
// who land on a field they didn't create.
const FIELD_TYPE_INFO = {
  text:       'Plain free-form text. Normalizes capitals on blur.',
  textarea:   'Multi-line text. Best for notes or addresses.',
  number:     'Numeric only. Mobile shows the number keypad.',
  email:      'Email format. Blank values default to no@email.com on save.',
  tel:        'Phone number. Strips parens/dashes and clips to 10 digits.',
  phone:      'Phone number. Strips parens/dashes and clips to 10 digits.',
  zip:        'US ZIP. Auto-fills the matching City + State fields via the ZIP API on 5-digit input.',
  date:       'Date picker.',
  select:     'Dropdown. Edit options below — closer/fronter pick from this list.',
  sale_plan:        'Live from Sale Config. Use "Map Plans" to link client → plan.',
  sale_client:      'Live from Sale Config (client list). Edit clients in Sale Config, not here.',
  sale_fronter:     'Closer-only. Auto-populated from the assigned transfer.',
  sale_date:        'Closer-only. Defaults to today.',
  sale_status:      'Closer-only outcome selector (Sold / No Sale / Callback). Edit the options below.',
  sale_disposition: 'Closer-only disposition selector. Edit the options below.',
  sale_call_review: 'Closer-only call review label. Edit the options below.',
  sale_down_payment: 'Closer-only money field. Currency formatted.',
  sale_monthly_payment: 'Closer-only money field. Currency formatted.',
  sale_payment_due_note: 'Closer-only note about the next due date.',
  sale_reference_no:  'Closer-only. Auto-generated unique reference.',
};

// Which types own a free-form options[] list editable on the form_fields row.
const HAS_OPTIONS_LIST = new Set(['select', 'sale_disposition', 'sale_status', 'sale_call_review']);

const FullEditPanel = ({ field, isSale, isCloserDeal, onPatch, onConfigureMapping, onClose }) => {
  const [label,       setLabel]       = useState(field.label || '');
  const [placeholder, setPlaceholder] = useState(field.placeholder || '');
  const typeLocked = isSale || isCloserDeal;

  const commit = (key, value) => onPatch({ [key]: value });

  // Esc closes the modal. body scroll-lock while open keeps the canvas in
  // place behind the backdrop so the SuperAdmin doesn't lose context.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="field-edit-title"
      className="fixed inset-0 z-50 overflow-y-auto"
      style={{ backgroundColor: 'rgba(15,23,42,0.6)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="w-full max-w-xl rounded-2xl shadow-2xl flex flex-col"
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            maxHeight: 'calc(100vh - 32px)',
          }}
          onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
            style={{
              background: 'var(--gradient-sidebar)',
              borderTopLeftRadius: '1rem', borderTopRightRadius: '1rem',
            }}>
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 rounded-xl bg-white/20 flex-shrink-0">
                <Pencil size={16} className="text-white" />
              </div>
              <div className="min-w-0">
                <h2 id="field-edit-title" className="text-base font-bold text-white truncate">
                  Edit field
                </h2>
                <p className="text-xs text-white/75 truncate font-mono">{field.name}</p>
              </div>
            </div>
            <button onClick={onClose} aria-label="Close"
              className="p-2 rounded-xl bg-white/20 hover:bg-white/30 transition-colors flex-shrink-0"
              style={{ minWidth: 36, minHeight: 36 }}>
              <X size={16} className="text-white" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Display label */}
              <div className="sm:col-span-2">
                <label className="text-[11px] font-bold uppercase tracking-wide text-text-secondary mb-1 block">
                  Display label
                </label>
                <input value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  onBlur={() => label.trim() && label !== field.label && commit('label', label.trim())}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                  placeholder="What the closer/fronter sees"
                  autoFocus
                  className="input text-sm py-2 w-full" />
                <p className="text-[11px] text-text-tertiary mt-1">Safe to rename anytime. Past records keep the old label as a snapshot.</p>
              </div>

              {/* Form-data key (locked) */}
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wide text-text-secondary mb-1 block">
                  Form-data key <span className="text-[10px] font-normal italic">(locked)</span>
                </label>
                <input value={field.name || ''} readOnly
                  className="input text-sm py-2 w-full font-mono"
                  style={{ backgroundColor: 'var(--color-bg-secondary)', cursor: 'not-allowed' }}
                  title="Renaming would orphan every existing form_data row that keys on this name." />
              </div>

              {/* Type */}
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wide text-text-secondary mb-1 block">
                  Type {typeLocked && <span className="text-[10px] font-normal italic">(locked)</span>}
                </label>
                {typeLocked ? (
                  <input value={field.field_type} readOnly
                    className="input text-sm py-2 w-full font-mono"
                    style={{ backgroundColor: 'var(--color-bg-secondary)', cursor: 'not-allowed' }}
                    title="Sale + closer-deal field types are locked because changing them breaks downstream sale logic." />
                ) : (
                  <select value={field.field_type}
                    onChange={(e) => commit('field_type', e.target.value)}
                    className="input text-sm py-2 w-full">
                    {TYPE_OPTIONS_FOR_EDIT.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                  </select>
                )}
              </div>

              {/* Placeholder */}
              <div className="sm:col-span-2">
                <label className="text-[11px] font-bold uppercase tracking-wide text-text-secondary mb-1 block">
                  Placeholder
                </label>
                <input value={placeholder}
                  onChange={(e) => setPlaceholder(e.target.value)}
                  onBlur={() => placeholder !== (field.placeholder || '') && commit('placeholder', placeholder)}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                  placeholder="Hint text inside the input"
                  className="input text-sm py-2 w-full" />
              </div>

              {/* Behavior toggles */}
              <div className="sm:col-span-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-text-secondary mb-2">
                  Behavior
                </p>
                <div className="flex flex-wrap gap-2">
                  <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer transition-colors"
                    style={{
                      border: '1px solid', minHeight: 40,
                      borderColor: field.is_required ? 'var(--color-error-300, #fca5a5)' : 'var(--color-border)',
                      backgroundColor: field.is_required ? 'var(--color-error-50, #fef2f2)' : 'transparent',
                    }}>
                    <input type="checkbox" checked={!!field.is_required}
                      onChange={(e) => commit('is_required', e.target.checked)} />
                    <span className="text-sm font-semibold"
                      style={{ color: field.is_required ? 'var(--color-error-700)' : 'var(--color-text)' }}>
                      Required
                    </span>
                  </label>

                  {!isCloserDeal && (
                    <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer transition-colors"
                      style={{
                        border: '1px solid', minHeight: 40,
                        borderColor: field.show_to_fronter !== false ? 'var(--color-info-300)' : 'var(--color-border)',
                        backgroundColor: field.show_to_fronter !== false ? 'var(--color-info-50)' : 'transparent',
                      }}>
                      <input type="checkbox" checked={field.show_to_fronter !== false}
                        onChange={(e) => commit('show_to_fronter', e.target.checked)} />
                      <span className="text-sm font-semibold"
                        style={{ color: field.show_to_fronter !== false ? 'var(--color-info-700)' : 'var(--color-text)' }}>
                        Visible to fronter
                      </span>
                    </label>
                  )}

                  <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer transition-colors"
                    style={{
                      border: '1px solid', minHeight: 40,
                      borderColor: field.repeats_per_car ? 'rgba(16,185,129,0.4)' : 'var(--color-border)',
                      backgroundColor: field.repeats_per_car ? 'rgba(16,185,129,0.08)' : 'transparent',
                    }}>
                    <input type="checkbox" checked={!!field.repeats_per_car}
                      onChange={(e) => commit('repeats_per_car', e.target.checked)} />
                    <span className="text-sm font-semibold"
                      style={{ color: field.repeats_per_car ? '#047857' : 'var(--color-text)' }}>
                      Repeats per car
                    </span>
                  </label>
                </div>
              </div>
            </div>

            {/* Type-specific help line — explains what this field type does
                so the SuperAdmin knows what to expect for each. */}
            {FIELD_TYPE_INFO[field.field_type] && (
              <p className="text-[11px] mt-3 italic" style={{ color: 'var(--color-text-tertiary)' }}>
                {FIELD_TYPE_INFO[field.field_type]}
              </p>
            )}

            {/* Type-specific config sections — surface inside the modal so the
                SuperAdmin doesn't have to close it to find another button. */}

            {/* Options list — chip editor for any select-style field. Lives
                inside the modal so add/rename/remove happens in context. */}
            {HAS_OPTIONS_LIST.has(field.field_type) && (
              <div className="mt-5 rounded-xl"
                style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                <OptionsEditor
                  field={field}
                  onSave={(opts) => onPatch({ options: opts })}
                  onClose={() => {}}
                />
              </div>
            )}

            {/* Sale Plan → mapping flow (live data from Sale Config). */}
            {field.field_type === 'sale_plan' && (
              <div className="mt-5 rounded-xl p-3 flex items-center justify-between gap-3 flex-wrap"
                style={{ backgroundColor: 'var(--color-primary-50, #faf5ff)', border: '1px solid var(--color-primary-200, #c7d2fe)' }}>
                <div className="text-xs leading-relaxed" style={{ color: 'var(--color-primary-700, #4338ca)' }}>
                  <p className="font-bold mb-0.5 inline-flex items-center gap-1.5"><Link2 size={11} /> Client → Plan mapping</p>
                  <p>Plans cascade off the selected Client. Configure which plans appear for each client.</p>
                </div>
                <button type="button" onClick={() => { onConfigureMapping?.(); onClose(); }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-white"
                  style={{ background: 'var(--gradient-sidebar)', minHeight: 36 }}>
                  <Link2 size={12} /> Open mapping
                </button>
              </div>
            )}

            {/* Sale Client / sale_fronter / sale_reference — read-only data
                sources. Let the SuperAdmin know what controls each. */}
            {(field.field_type === 'sale_client' || field.field_type === 'sale_fronter' || field.field_type === 'sale_reference_no' || field.field_type === 'sale_date') && (
              <div className="mt-5 rounded-xl p-3 flex items-start gap-2"
                style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                <Info size={13} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-text-secondary)' }} />
                <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                  {field.field_type === 'sale_client'   && <>Sourced from <strong>Sale Config → Clients</strong>. Add or edit the list there to change what closers see.</>}
                  {field.field_type === 'sale_fronter'  && <>Closer-only. Auto-populated from the transfer's <code>created_by</code> when the closer opens the sale modal.</>}
                  {field.field_type === 'sale_reference_no' && <>Auto-generated on sale submit. Format is configurable in Sale Config.</>}
                  {field.field_type === 'sale_date'     && <>Defaults to today on the sale modal. Closer can override per sale.</>}
                </p>
              </div>
            )}

            {/* Money formatting hint for currency fields. */}
            {(field.field_type === 'sale_down_payment' || field.field_type === 'sale_monthly_payment') && (
              <div className="mt-5 rounded-xl p-3 flex items-start gap-2"
                style={{ backgroundColor: 'var(--color-success-50, #f0fdf4)', border: '1px solid var(--color-success-200, #bbf7d0)' }}>
                <DollarSign size={13} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-success-700)' }} />
                <p className="text-xs leading-relaxed" style={{ color: 'var(--color-success-700)' }}>
                  Currency-formatted at display + stored as a number. No extra options needed.
                </p>
              </div>
            )}

            {/* Generic safety note — repeated every time so the data-loss
                contract is crystal clear regardless of which type is open. */}
            <div className="rounded-xl p-3 mt-5 flex items-start gap-2"
              style={{ backgroundColor: 'var(--color-primary-50, #eef2ff)', border: '1px solid var(--color-primary-200, #c7d2fe)' }}>
              <Info size={13} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-primary-700, #4338ca)' }} />
              <p className="text-xs leading-relaxed" style={{ color: 'var(--color-primary-700, #4338ca)' }}>
                Edits land on the canvas immediately. They commit to the database when you click <strong>Save</strong> at the top of the page. Renaming labels, changing the type, or editing options never deletes any past record — historical form_data values keep their original string.
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center gap-2 px-5 py-3 flex-shrink-0"
            style={{ borderTop: '1px solid var(--color-border)' }}>
            <p className="text-[11px] text-text-tertiary flex-1">Press Esc or click outside to close.</p>
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-bold text-white"
              style={{ background: 'var(--gradient-sidebar)', minHeight: 36 }}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Field card on the canvas
// ─────────────────────────────────────────────────────────────────────────────
const FieldCard = ({
  field, index, isDragging, isDragOver,
  onDragStart, onDragOver, onDrop, onDragEnd,
  onRemove, onToggleRequired, onToggleFronter, onChangeSpan, onEditLabel, onConfigureMapping, onSaveOptions,
  onToggleRepeatsPerCar, onPatch,
}) => {
  const [editingLabel,   setEditingLabel]   = useState(false);
  const [labelVal,       setLabelVal]       = useState(field.label);
  const [editingOptions, setEditingOptions] = useState(false);
  const [editingFull,    setEditingFull]    = useState(false);
  const [optionsVal,     setOptionsVal]     = useState((field.options || []).join(', '));
  const [pendingRemove,  setPendingRemove]  = useState(false);
  const removeTimer = useRef(null);
  const inputRef = useRef(null);

  const handleRemoveClick = (e) => {
    e.stopPropagation();
    if (pendingRemove) {
      clearTimeout(removeTimer.current);
      setPendingRemove(false);
      onRemove(index);
    } else {
      setPendingRemove(true);
      removeTimer.current = setTimeout(() => setPendingRemove(false), 3000);
    }
  };

  useEffect(() => () => clearTimeout(removeTimer.current), []);
  const isSale   = field.field_type === 'sale_client' || field.field_type === 'sale_plan';
  const isCloserDeal = ['sale_down_payment','sale_monthly_payment','sale_payment_due_note','sale_reference_no','sale_fronter','sale_date','sale_disposition','sale_status','sale_call_review'].includes(field.field_type);
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
        borderColor:     isDragOver ? 'var(--color-primary-500)' : isDragging ? 'transparent' : isCloserDeal ? 'rgba(245,158,11,0.35)' : isSale ? 'var(--color-primary-200)' : 'var(--color-border)',
        backgroundColor: isDragOver ? 'var(--color-primary-50)' : isCloserDeal ? 'rgba(245,158,11,0.06)' : isSale ? 'var(--color-primary-50, #faf5ff)' : 'var(--color-surface)',
        opacity:         isDragging ? 0.35 : 1,
        cursor:          'grab',
        boxShadow:       isDragOver ? '0 0 0 3px var(--color-primary-200)' : 'none',
      }}
    >
      {/* Top bar */}
      <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1 min-w-0 overflow-hidden">
        <GripVertical size={14} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
        <span style={{ flexShrink: 0, color: isCloserDeal ? '#d97706' : isSale ? 'var(--color-primary-500)' : 'var(--color-text-secondary)' }}>
          <FieldIcon type={field.field_type} />
        </span>
        {editingLabel ? (
          <input ref={inputRef} value={labelVal}
            onChange={e => setLabelVal(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={e => { if (e.key === 'Enter') commitLabel(); if (e.key === 'Escape') setEditingLabel(false); }}
            className="flex-1 min-w-0 text-sm font-semibold bg-transparent border-b border-primary-400 outline-none text-text"
          />
        ) : (
          <span onDoubleClick={() => { setLabelVal(field.label); setEditingLabel(true); }}
            className="flex-1 min-w-0 text-sm font-semibold text-text truncate cursor-text"
            title="Double-click to rename">
            {field.label}
          </span>
        )}
        {/* Edit pencil — opens the full edit panel below. Lets the SuperAdmin
            tweak any property of the field in one place without hunting through
            footer toggles. Disabled while the inline label is being typed so
            the two editors don't fight. */}
        <button
          onClick={(e) => { e.stopPropagation(); setEditingFull(v => !v); setEditingOptions(false); }}
          className="p-0.5 rounded flex-shrink-0 transition-colors"
          style={{
            backgroundColor: editingFull ? 'var(--color-primary-100)' : 'transparent',
            color: editingFull ? 'var(--color-primary-700)' : 'var(--color-primary-600)',
          }}
          title={editingFull ? 'Close edit panel' : 'Edit this field'}
          aria-label={editingFull ? 'Close edit panel' : 'Edit field'}
          aria-expanded={editingFull}>
          <Pencil size={13} />
        </button>
        {pendingRemove ? (
          <button
            onClick={handleRemoveClick}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-bold flex-shrink-0 animate-pulse"
            style={{ backgroundColor: 'var(--color-error-600)', color: '#fff' }}
            title="Click again to confirm remove">
            <X size={11} /> Remove?
          </button>
        ) : (
          <button
            onClick={handleRemoveClick}
            className="p-0.5 rounded hover:bg-error-100 flex-shrink-0 transition-colors"
            title="Remove field">
            <X size={13} style={{ color: 'var(--color-error-500)' }} />
          </button>
        )}
      </div>

      {/* Closer deal field badge */}
      {isCloserDeal && (
        <div className="px-3 pb-1">
          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold"
            style={{ backgroundColor: 'rgba(245,158,11,0.12)', color: '#b45309' }}>
            <UserX size={9} /> Closer Only · Deal Field
          </span>
        </div>
      )}

      {/* Sale field badges */}
      {isSale && (
        <div className="px-3 pb-1 flex items-center flex-wrap gap-1.5">
          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold"
            style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>
            <Zap size={9} /> Live from Sale Config
          </span>
          {field.field_type === 'sale_plan' && (
            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold"
              style={{
                backgroundColor: mappingCount > 0 ? 'var(--color-success-50)' : 'var(--color-warning-50)',
                color: mappingCount > 0 ? 'var(--color-success-700)' : 'var(--color-warning-700)',
              }}>
              <Link2 size={9} />
              {mappingCount > 0 ? `${mappingCount} client${mappingCount > 1 ? 's' : ''} mapped` : 'No mapping'}
            </span>
          )}
        </div>
      )}

      {/* Footer controls */}
      <div className="flex items-center flex-wrap gap-1.5 px-3 pb-2.5 pt-1.5"
        style={{ borderTop: '1px solid var(--color-border)' }}>
        {/* Required */}
        <button onClick={() => onToggleRequired(index)}
          className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold transition-all flex-shrink-0"
          style={{
            backgroundColor: field.is_required ? 'var(--color-error-50)' : 'var(--color-bg-secondary)',
            color: field.is_required ? 'var(--color-error-600)' : 'var(--color-text-tertiary)',
          }}>
          {field.is_required ? '* Req' : 'Opt'}
        </button>

        {/* Visibility — locked for closer deal fields */}
        {isCloserDeal ? (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold flex-shrink-0"
            style={{ backgroundColor: 'rgba(245,158,11,0.1)', color: '#b45309' }}>
            <UserX size={9} /> Closer Only
          </span>
        ) : (
          <button onClick={() => onToggleFronter(index)}
            className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold transition-all flex-shrink-0"
            style={{
              backgroundColor: field.show_to_fronter !== false ? 'var(--color-info-50, #e0f2fe)' : 'var(--color-bg-secondary)',
              color: field.show_to_fronter !== false ? 'var(--color-info-600, #0284c7)' : 'var(--color-text-tertiary)',
            }}>
            {field.show_to_fronter !== false ? <><Users size={9} /> All</> : <><UserX size={9} /> Closer</>}
          </button>
        )}

        {/* Per-car: field duplicates for each vehicle on the sale form */}
        <button onClick={() => onToggleRepeatsPerCar(index)}
          title="Duplicate this field for each vehicle when a closer adds another car"
          className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold transition-all flex-shrink-0"
          style={{
            backgroundColor: field.repeats_per_car ? 'rgba(16,185,129,0.12)' : 'var(--color-bg-secondary)',
            color: field.repeats_per_car ? '#047857' : 'var(--color-text-tertiary)',
          }}>
          <Car size={9} /> {field.repeats_per_car ? 'Per Car' : 'Single'}
        </button>

        {/* Map Plans button */}
        {field.field_type === 'sale_plan' && (
          <button onClick={() => onConfigureMapping(index)}
            className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold transition-all flex-shrink-0 hover:opacity-80"
            style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>
            <Link2 size={9} /> Map Plans
          </button>
        )}

        {/* Edit options button — now also covers plain 'select' fields so
            the SuperAdmin can extend a dropdown like Condition or any
            custom select without touching the JSON config. Existing
            historical values stay valid even if an option is removed
            (records store the string snapshot, not an FK). */}
        {(field.field_type === 'select' || field.field_type === 'sale_disposition' || field.field_type === 'sale_status' || field.field_type === 'sale_call_review') && !editingOptions && (
          <button onClick={() => { setOptionsVal((field.options || []).join(', ')); setEditingOptions(true); }}
            className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold transition-all flex-shrink-0 hover:opacity-80"
            style={{ backgroundColor: 'rgba(245,158,11,0.12)', color: '#b45309' }}>
            <List size={9} /> Options ({(field.options || []).length})
          </button>
        )}

        {/* Span */}
        <div className="flex items-center gap-0.5 ml-auto flex-shrink-0">
          {[1, 2, 3, 4, 5].map(n => (
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

        {/* Type */}
        <span className="text-xs font-mono px-1.5 py-0.5 rounded flex-shrink-0"
          style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}>
          {TYPE_LABELS[field.field_type] || field.field_type}
        </span>
      </div>

      {/* Chip-based options editor — opens for any field that owns an
          options list. Each option is a chip. Click a chip to rename it
          inline. Click ✕ on a chip to remove it (with a confirmation step
          inline). "+ Add option" input commits on Enter or the green Add
          button. Saves are debounced — every chip op writes the next
          options array to the server immediately, so a refresh never
          loses what the user typed.

          Data-safety note shown above the editor: form_data entries from
          past sales/transfers store the raw string, NOT a reference, so
          removing an option here doesn't break or rewrite any historical
          records. They keep the old value as-is. */}
      {editingOptions && (
        <OptionsEditor
          field={field}
          onSave={(opts) => onSaveOptions(index, opts)}
          onClose={() => setEditingOptions(false)}
        />
      )}

      {/* Full edit panel — every property in one place. Locked rows: row id,
          internal `name` (form_data key). Locked types: sale_* fields keep
          their field_type to avoid breaking downstream sale logic. */}
      {editingFull && onPatch && (
        <FullEditPanel
          field={field}
          isSale={isSale}
          isCloserDeal={isCloserDeal}
          onPatch={onPatch}
          onConfigureMapping={() => onConfigureMapping(index)}
          onClose={() => setEditingFull(false)}
        />
      )}
    </div>
  );
};

// Palette pill
const PaletteField = ({ field, onAdd, isSale = false }) => (
  <button
    onClick={() => onAdd(field)}
    className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition-all hover:shadow-md hover:scale-[1.02]"
    style={{
      borderColor:     isSale ? 'var(--color-primary-200)' : 'var(--color-border)',
      backgroundColor: isSale ? 'var(--color-primary-50, #faf5ff)' : 'var(--color-surface)',
    }}>
    <span style={{ color: isSale ? 'var(--color-primary-500)' : 'var(--color-text-secondary)', flexShrink: 0 }}>
      <FieldIcon type={field.field_type} />
    </span>
    <div className="flex-1 min-w-0">
      <p className="text-sm font-semibold text-text truncate">{field.label}</p>
      {isSale && (
        <p className="text-xs truncate" style={{ color: 'var(--color-text-tertiary)' }}>
          {field.field_type === 'sale_client' ? 'Live clients dropdown' : 'Live plans (cascades by client)'}
        </p>
      )}
    </div>
    <Plus size={13} style={{ color: 'var(--color-primary-500)', flexShrink: 0 }} />
  </button>
);

// ─────────────────────────────────────────────────────────────────────────────
// Form Layout Panel
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_CANVAS = BASE_FIELDS.map((f, i) => ({
  ...f, column_span: 1, show_to_fronter: true, order: i,
}));

const FormLayoutPanel = ({ saleClients, salePlans }) => {
  const [canvasFields, setCanvasFields] = useState([]);
  const [palette, setPalette]           = useState([]);
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [showPreview, setShowPreview]   = useState(false);
  const [showCustom, setShowCustom]     = useState(false);
  const [mappingField, setMappingField] = useState(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templates, setTemplates]         = useState([]);
  const [tplLoading, setTplLoading]       = useState(false);
  const [tplName, setTplName]             = useState('');
  const [tplDesc, setTplDesc]             = useState('');
  const [editingTpl, setEditingTpl]       = useState(null); // { id, name, description }

  const dragIndex   = useRef(null);
  const dbSnapshot  = useRef([]);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  const loadFields = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.get('forms/fields');
      const dbFields = (res.data.fields || []).sort((a, b) => a.order - b.order);

      if (dbFields.length === 0) {
        // DB empty — seed canvas with defaults so user never sees a blank form
        dbSnapshot.current = [];
        setCanvasFields(DEFAULT_CANVAS);
        setPalette([]);
      } else {
        const mapped = dbFields.map(f => ({
          id: f.id, name: f.name, label: f.label, field_type: f.field_type,
          is_required: f.is_required, column_span: f.column_span || 1,
          placeholder: f.placeholder || '', options: f.options,
          section: f.section || 'default', show_to_fronter: f.show_to_fronter !== false,
          repeats_per_car: f.repeats_per_car === true,
        }));
        dbSnapshot.current = mapped;
        const canvasNames = new Set(dbFields.map(f => f.name));
        setCanvasFields(mapped);
        setPalette(BASE_FIELDS.filter(f => !canvasNames.has(f.name)).map(f => ({ ...f, column_span: 1 })));
      }
    } catch { /* non-critical */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadFields(); }, [loadFields]);

  const addFromPalette = (field) => {
    setCanvasFields(prev => [...prev, { ...field, column_span: 1, show_to_fronter: true }]);
    setPalette(prev => prev.filter(f => f.name !== field.name));
  };

  const addSaleField = (field) => {
    if (canvasFields.some(f => f.field_type === field.field_type)) return;
    setCanvasFields(prev => [...prev, { ...field, column_span: 1, show_to_fronter: true, options: null }]);
  };

  const addCloserDealField = (field) => {
    if (canvasFields.some(f => f.field_type === field.field_type)) return;
    setCanvasFields(prev => [...prev, { ...field, column_span: 1, show_to_fronter: false }]);
  };

  const addCustom = (field) => {
    setCanvasFields(prev => [...prev, { ...field, column_span: 1, show_to_fronter: true }]);
  };

  const remove = (index) => {
    const removed = canvasFields[index];
    setCanvasFields(prev => prev.filter((_, i) => i !== index));
    if (BASE_FIELDS.some(f => f.name === removed.name)) {
      setPalette(prev => [...prev, { ...removed }]);
    }
  };

  const toggleRequired = (i) => setCanvasFields(prev => prev.map((f, idx) => idx === i ? { ...f, is_required: !f.is_required } : f));
  const toggleFronter  = (i) => setCanvasFields(prev => prev.map((f, idx) => idx === i ? { ...f, show_to_fronter: f.show_to_fronter === false } : f));
  const toggleRepeatsPerCar = (i) => setCanvasFields(prev => prev.map((f, idx) => idx === i ? { ...f, repeats_per_car: !f.repeats_per_car } : f));
  const changeSpan     = (i, span) => setCanvasFields(prev => prev.map((f, idx) => idx === i ? { ...f, column_span: span } : f));
  const editLabel      = (i, label) => setCanvasFields(prev => prev.map((f, idx) => idx === i ? { ...f, label } : f));
  const saveMapping    = (i, mapping) => setCanvasFields(prev => prev.map((f, idx) => idx === i ? { ...f, options: mapping } : f));
  const saveOptions    = (i, opts)    => setCanvasFields(prev => prev.map((f, idx) => idx === i ? { ...f, options: opts } : f));
  // Generic patch — used by the Edit panel to update any subset of editable
  // properties at once. Never touches `name` (form_data key) or row id.
  const patchField     = (i, patch)   => setCanvasFields(prev => prev.map((f, idx) => idx === i ? { ...f, ...patch } : f));

  const onDragStart = (e, i) => { dragIndex.current = i; e.dataTransfer.effectAllowed = 'move'; };
  const onDragOver  = (e, i) => { e.preventDefault(); setDragOverIdx(i); };
  const onDrop      = (e, dropIdx) => {
    e.preventDefault();
    const from = dragIndex.current;
    if (from === null || from === dropIdx) return;
    setCanvasFields(prev => {
      const arr = [...prev];
      const [m] = arr.splice(from, 1);
      arr.splice(dropIdx, 0, m);
      return arr;
    });
    dragIndex.current = null;
    setDragOverIdx(null);
  };
  const onDragEnd = () => { dragIndex.current = null; setDragOverIdx(null); };

  const fetchTemplates = useCallback(async () => {
    setTplLoading(true);
    try {
      const res = await client.get('forms/templates');
      setTemplates(res.data.templates || []);
    } catch { /* non-critical */ } finally { setTplLoading(false); }
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const saveTemplate = async () => {
    const name = tplName.trim();
    if (!name || !canvasFields.length) return;
    setTplLoading(true);
    try {
      const res = await client.post('forms/templates', {
        name,
        description: tplDesc.trim() || null,
        fields: canvasFields,
      });
      setTemplates(prev => [res.data.template, ...prev]);
      setTplName('');
      setTplDesc('');
      toast.success(`Template "${name}" saved`);
    } catch (err) {
      toastError(err, 'Failed to save template');
    } finally { setTplLoading(false); }
  };

  const updateTemplate = async (id, patch) => {
    try {
      const res = await client.put(`forms/templates/${id}`, patch);
      setTemplates(prev => prev.map(t => t.id === id ? res.data.template : t));
      setEditingTpl(null);
      toast.success('Template updated');
    } catch (err) {
      toastError(err, 'Failed to update template');
    }
  };

  const overwriteTemplate = async (tpl) => {
    if (!canvasFields.length) return;
    setTplLoading(true);
    try {
      const res = await client.put(`forms/templates/${tpl.id}`, { fields: canvasFields });
      setTemplates(prev => prev.map(t => t.id === tpl.id ? res.data.template : t));
      toast.success(`Template "${tpl.name}" updated with current layout`);
    } catch (err) {
      toastError(err, 'Failed to update template');
    } finally { setTplLoading(false); }
  };

  const loadTemplate = (tpl) => {
    const names = new Set((tpl.fields || []).map(f => f.name));
    setCanvasFields(tpl.fields || []);
    setPalette(BASE_FIELDS.filter(f => !names.has(f.name)).map(f => ({ ...f, column_span: 1 })));
    setShowTemplates(false);
    toast.info(`Template "${tpl.name}" loaded — click Save Layout to apply globally.`, { duration: 6000 });
  };

  const deleteTemplate = async (id, name) => {
    if (!window.confirm(`Delete template "${name}"?`)) return;
    try {
      await client.delete(`forms/templates/${id}`);
      setTemplates(prev => prev.filter(t => t.id !== id));
    } catch (err) {
      toastError(err, 'Failed to delete template');
    }
  };

  const handleSave = async () => {
    if (!canvasFields.length) return;
    // Snapshot what user sees BEFORE touching the network — always restores to this on error
    const preCallCanvas = canvasFields;
    setSaving(true);
    try {
      const res = await client.post('forms/fields/bulk-save', { fields: canvasFields });
      toast.success(`Saved — ${res.data.saved} field${res.data.saved !== 1 ? 's' : ''} applied globally`);
      await loadFields();
    } catch (err) {
      toastError(err, 'Save failed — your layout has been restored.');
      // Always restore canvas to exactly what user had before clicking Save
      const names = new Set(preCallCanvas.map(f => f.name));
      setCanvasFields(preCallCanvas);
      setPalette(BASE_FIELDS.filter(f => !names.has(f.name)).map(f => ({ ...f, column_span: 1 })));
    } finally { setSaving(false); }
  };

  const clientOnCanvas = canvasFields.some(f => f.field_type === 'sale_client');
  const planOnCanvas   = canvasFields.some(f => f.field_type === 'sale_plan');
  const closerDealOnCanvas = (type) => canvasFields.some(f => f.field_type === type);

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
    </div>
  );

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-text">Form Layout</h2>
          <p className="text-sm text-text-secondary mt-0.5">
            Drag fields to reorder · Resize with 1/3 2/3 Full · Double-click label to rename
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setShowPreview(v => !v)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-semibold transition-all"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-surface)' }}>
            {showPreview ? <EyeOff size={15} /> : <Eye size={15} />}
            {showPreview ? 'Hide Preview' : 'Preview'}
          </button>
          <button onClick={() => setShowTemplates(v => !v)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-semibold transition-all"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-surface)' }}>
            <BookOpen size={15} /> Templates {templates.length > 0 && `(${templates.length})`}
          </button>
          <button onClick={handleSave} disabled={saving || !canvasFields.length}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all hover:scale-105 disabled:opacity-50"
            style={{ background: 'var(--gradient-sidebar)' }}>
            <Save size={15} /> {saving ? 'Saving…' : 'Save Layout'}
          </button>
        </div>
      </div>

      {/* Templates Panel */}
      {showTemplates && (
        <div className="rounded-2xl p-4 space-y-4" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center justify-between">
            <p className="font-bold text-text flex items-center gap-2"><BookOpen size={16} /> Form Templates</p>
            <button onClick={() => setShowTemplates(false)} style={{ color: 'var(--color-text-tertiary)' }}><X size={16} /></button>
          </div>

          {/* Save current canvas as new template */}
          <div className="rounded-xl p-3 space-y-2" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            <p className="text-xs font-bold text-text-secondary uppercase tracking-wider">Save Current Layout as Template</p>
            <div className="flex gap-2">
              <input
                value={tplName}
                onChange={e => setTplName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveTemplate()}
                placeholder="Template name…"
                className="input flex-1 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <input
                value={tplDesc}
                onChange={e => setTplDesc(e.target.value)}
                placeholder="Description (optional)…"
                className="input flex-1 text-sm"
              />
              <button
                onClick={saveTemplate}
                disabled={!tplName.trim() || !canvasFields.length || tplLoading}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-40 shrink-0"
                style={{ background: 'var(--gradient-sidebar)' }}>
                <Bookmark size={14} /> Save
              </button>
            </div>
          </div>

          {/* Template list */}
          {tplLoading && !templates.length ? (
            <div className="flex justify-center py-4">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-600" />
            </div>
          ) : templates.length === 0 ? (
            <p className="text-sm text-text-tertiary text-center py-3">No templates saved yet.</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {templates.map(tpl => (
                <div key={tpl.id} className="rounded-xl px-3 py-3 space-y-2"
                  style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>

                  {/* Name row — inline edit */}
                  {editingTpl?.id === tpl.id ? (
                    <div className="flex gap-2">
                      <input
                        className="input flex-1 text-sm"
                        value={editingTpl.name}
                        onChange={e => setEditingTpl(prev => ({ ...prev, name: e.target.value }))}
                        autoFocus
                      />
                      <input
                        className="input flex-1 text-sm"
                        value={editingTpl.description || ''}
                        onChange={e => setEditingTpl(prev => ({ ...prev, description: e.target.value }))}
                        placeholder="Description…"
                      />
                      <button
                        onClick={() => updateTemplate(tpl.id, { name: editingTpl.name, description: editingTpl.description })}
                        disabled={!editingTpl.name.trim()}
                        className="p-1.5 rounded-lg text-white disabled:opacity-40"
                        style={{ background: 'var(--gradient-sidebar)' }}>
                        <Check size={14} />
                      </button>
                      <button onClick={() => setEditingTpl(null)} className="p-1.5 rounded-lg" style={{ color: 'var(--color-text-tertiary)' }}>
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-text truncate">{tpl.name}</p>
                        {tpl.description && <p className="text-xs text-text-secondary truncate">{tpl.description}</p>}
                        <p className="text-xs text-text-tertiary mt-0.5">
                          {(tpl.fields || []).length} fields · {new Date(tpl.created_at).toLocaleDateString()}
                          {tpl.updated_at !== tpl.created_at && ` · updated ${new Date(tpl.updated_at).toLocaleDateString()}`}
                        </p>
                      </div>
                      <button
                        onClick={() => setEditingTpl({ id: tpl.id, name: tpl.name, description: tpl.description || '' })}
                        className="p-1.5 rounded-lg shrink-0 hover:bg-primary-50 transition-colors"
                        style={{ color: 'var(--color-text-tertiary)' }}
                        title="Rename">
                        <Pencil size={13} />
                      </button>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-1.5 flex-wrap">
                    <button
                      onClick={() => loadTemplate(tpl)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-white"
                      style={{ background: 'var(--gradient-sidebar)' }}
                      title="Load this template onto canvas">
                      <BookOpen size={12} /> Load
                    </button>
                    <button
                      onClick={() => overwriteTemplate(tpl)}
                      disabled={!canvasFields.length || tplLoading}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40"
                      style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
                      title="Overwrite template with current canvas">
                      <Save size={12} /> Update with Current
                    </button>
                    <button
                      onClick={() => deleteTemplate(tpl.id, tpl.name)}
                      className="ml-auto p-1.5 rounded-lg transition-colors hover:bg-red-50"
                      style={{ color: 'var(--color-error-500)' }}
                      title="Delete template">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Palette */}
        <div className="lg:col-span-1 space-y-3">
          <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>

            {/* Sales Fields */}
            <p className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Briefcase size={11} /> Sales Fields
            </p>
            <div className="space-y-1.5 mb-4">
              {SALE_FIELDS.map(f => {
                const onCanvas = f.field_type === 'sale_client' ? clientOnCanvas : planOnCanvas;
                return (
                  <div key={f.name} className={onCanvas ? 'opacity-40 pointer-events-none' : ''}>
                    <PaletteField field={f} onAdd={addSaleField} isSale />
                  </div>
                );
              })}
              {(clientOnCanvas || planOnCanvas) && (
                <p className="text-xs text-text-tertiary px-1">
                  {clientOnCanvas && planOnCanvas ? 'Both added' : clientOnCanvas ? 'Client added' : 'Plan added'}
                </p>
              )}
            </div>

            {/* Closer Deal Fields */}
            <p className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-2 pt-3 flex items-center gap-1.5"
              style={{ borderTop: '1px solid var(--color-border)' }}>
              <DollarSign size={11} /> Closer Deal Fields
            </p>
            <div className="space-y-1.5 mb-4">
              {CLOSER_DEAL_FIELDS.map(f => {
                const onCanvas = closerDealOnCanvas(f.field_type);
                return (
                  <div key={f.name} className={onCanvas ? 'opacity-40 pointer-events-none' : ''}>
                    <button
                      onClick={() => addCloserDealField(f)}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition-all hover:shadow-md hover:scale-[1.02]"
                      style={{
                        borderColor:     'rgba(245,158,11,0.3)',
                        backgroundColor: 'rgba(245,158,11,0.04)',
                      }}>
                      <span style={{ color: '#d97706', flexShrink: 0 }}><FieldIcon type={f.field_type} /></span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-text truncate">{f.label}</p>
                        <p className="text-xs truncate" style={{ color: 'var(--color-text-tertiary)' }}>Closer only</p>
                      </div>
                      <Plus size={13} style={{ color: '#d97706', flexShrink: 0 }} />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Base Fields */}
            <p className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-2 pt-3"
              style={{ borderTop: '1px solid var(--color-border)' }}>
              Contact Fields
            </p>
            {palette.length === 0
              ? <p className="text-xs text-text-tertiary text-center py-2">All fields placed</p>
              : <div className="space-y-1.5">{palette.map(f => <PaletteField key={f.name} field={f} onAdd={addFromPalette} />)}</div>
            }

            <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
              <button onClick={() => setShowCustom(true)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl border-2 border-dashed text-sm font-semibold transition-all hover:border-primary-500"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary-600)' }}>
                <Plus size={14} /> Custom Field
              </button>
            </div>
          </div>

          {/* Tips */}
          <div className="rounded-xl p-3 text-xs space-y-1"
            style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            <p className="font-bold text-text-secondary mb-1.5">Tips</p>
            {[
              'Drag cards to reorder',
              '1/3 · 2/3 · Full = width',
              'Double-click label to rename',
              'Client field cascades Plan',
              'Click "Map Plans" to configure',
              'Save applies to all users',
            ].map(t => <p key={t} className="text-text-tertiary">· {t}</p>)}
          </div>
        </div>

        {/* Canvas */}
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
              className="rounded-2xl p-4 grid grid-cols-5 gap-3 content-start min-h-48"
              style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { if (dragOverIdx === null && dragIndex.current !== null) onDrop(e, canvasFields.length - 1); }}>
              {canvasFields.map((field, idx) => (
                <FieldCard
                  key={`${field.name}-${idx}`}
                  field={field} index={idx}
                  isDragging={dragIndex.current === idx}
                  isDragOver={dragOverIdx === idx}
                  onDragStart={onDragStart} onDragOver={onDragOver}
                  onDrop={onDrop} onDragEnd={onDragEnd}
                  onRemove={remove} onToggleRequired={toggleRequired}
                  onToggleFronter={toggleFronter} onChangeSpan={changeSpan}
                  onEditLabel={(label) => editLabel(idx, label)}
                  onConfigureMapping={(i) => setMappingField(i)}
                  onSaveOptions={(i, opts) => saveOptions(i, opts)}
                  onPatch={(patch) => patchField(idx, patch)}
                  onToggleRepeatsPerCar={toggleRepeatsPerCar}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Preview */}
      {showPreview && canvasFields.length > 0 && (
        <div className="rounded-2xl p-6" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <h4 className="text-lg font-bold text-text mb-4 flex items-center gap-2"><Eye size={18} /> Form Preview</h4>
          <div className="grid grid-cols-5 gap-4">
            {canvasFields.map((field, idx) => (
              <div key={idx} className={SPAN_CLASS[field.column_span || 1]}>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  {field.label} {field.is_required && <span className="text-error-500">*</span>}
                  {field.show_to_fronter === false && (
                    <span className="ml-2 text-xs px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}>
                      Closer Only
                    </span>
                  )}
                </label>
                {field.field_type === 'sale_client' ? (
                  <select disabled className="input opacity-70">
                    <option>Select client… ({saleClients.length} options)</option>
                    {saleClients.map(c => <option key={c.id}>{c.value}</option>)}
                  </select>
                ) : field.field_type === 'sale_plan' ? (
                  <select disabled className="input opacity-70">
                    <option>Select plan… ({salePlans.length} options)</option>
                    {salePlans.map(p => <option key={p.id}>{p.value}</option>)}
                  </select>
                ) : field.field_type === 'textarea' ? (
                  <textarea disabled rows={3} placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`} className="input opacity-70" />
                ) : field.field_type === 'select' ? (
                  <select disabled className="input opacity-70">
                    <option>Select {field.label}</option>
                    {(field.options || []).map(o => <option key={o}>{o}</option>)}
                  </select>
                ) : field.field_type === 'sale_down_payment' || field.field_type === 'sale_monthly_payment' ? (
                  <input disabled type="number" placeholder="0.00" className="input opacity-70" />
                ) : field.field_type === 'sale_reference_no' ? (
                  <input disabled type="text" placeholder="MBH4220SBN" className="input opacity-70 font-mono uppercase" />
                ) : field.field_type === 'sale_fronter' ? (
                  <select disabled className="input opacity-70"><option>Select fronter…</option></select>
                ) : (field.field_type === 'sale_disposition' || field.field_type === 'sale_status' || field.field_type === 'sale_call_review') ? (
                  <select disabled className="input opacity-70">
                    <option>Select disposition…</option>
                    {(field.options && field.options.length > 0
                      ? field.options
                      : ['sale','no_sale','callback','not_interested','hung_up','voicemail','other']
                    ).map(o => <option key={o}>{o.replace(/_/g,' ')}</option>)}
                  </select>
                ) : (
                  <input disabled
                    type={field.field_type === 'tel' || field.field_type === 'phone' ? 'tel' : field.field_type === 'zip' || field.field_type === 'sale_payment_due_note' ? 'text' : field.field_type === 'sale_date' ? 'date' : field.field_type}
                    placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`}
                    className="input opacity-70"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {showCustom && <AddCustomModal onAdd={addCustom} onClose={() => setShowCustom(false)} />}
      {mappingField !== null && canvasFields[mappingField] && (
        <ClientPlanMappingModal
          clients={saleClients} plans={salePlans}
          currentMapping={canvasFields[mappingField].options}
          onSave={(m) => saveMapping(mappingField, m)}
          onClose={() => setMappingField(null)}
        />
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Root component
// ─────────────────────────────────────────────────────────────────────────────
const FormBuilder = () => {
  const [activeSection, setActiveSection] = useState('layout');
  const {
    clients, plans, loading: configLoading,
    fetchConfigs, addConfig, deleteConfig,
  } = useSaleConfigs();

  const [saving,   setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(null);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  const handleAdd = async (type, value) => {
    setSaving(true);
    try { await addConfig(type, value); toast.success('Added successfully'); }
    catch (err) { toastError(err, 'Failed to add'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id, type) => {
    setDeleting(id);
    try { await deleteConfig(id, type); toast.success('Deleted'); }
    catch (err) { toastError(err, 'Failed to delete'); }
    finally { setDeleting(null); }
  };

  return (
    <div className="flex" style={{ height: '100%' }}>
      <FormBuilderSidebar active={activeSection} onChange={setActiveSection} />

      <div className="flex-1 overflow-auto" style={{ backgroundColor: 'var(--color-bg)' }}>
        <div className="p-6 lg:p-8 max-w-7xl">
          {activeSection === 'layout' && (
            <FormLayoutPanel saleClients={clients} salePlans={plans} />
          )}
          {activeSection === 'clients' && (
            <ConfigPanel
              type="client" items={clients} loading={configLoading}
              onAdd={handleAdd} onDelete={handleDelete}
              saving={saving} deleting={deleting}
            />
          )}
          {activeSection === 'plans' && (
            <ConfigPanel
              type="plan" items={plans} loading={configLoading}
              onAdd={handleAdd} onDelete={handleDelete}
              saving={saving} deleting={deleting}
            />
          )}
          {activeSection === 'mapping' && (
            <MappingPanel
              clients={clients} plans={plans}
              configLoading={configLoading}
            />
          )}
          {activeSection === 'vehicles'      && <VehicleManager />}
          {activeSection === 'clients-plans' && <ClientPlanManager />}
          {activeSection === 'dispositions' && <DispositionManager />}
        </div>
      </div>
    </div>
  );
};

export default FormBuilder;
