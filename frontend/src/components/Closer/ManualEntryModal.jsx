import { useEffect, useState } from 'react';
import { UserPlus, X, AlertTriangle, Info, Phone, Building2, User } from 'lucide-react';
import { Button } from '../UI';
import client from '../../api/client';
import { useFormFields } from '../../hooks/useFormFields';
import { useAuth } from '../../contexts/AuthContext';
import { isCarMake, isCarModel } from '../../utils/formFieldNorm';
import VehicleSelect from '../Form/VehicleSelect';

// ── Field renderer — mirrors the fronter form's field-type switch so a
// dropdown stays a dropdown, vehicle fields get typeahead, etc.
// ctx provides:
//   vehicleMakes, vehicleModelsFor — populated from /api/vehicles
//   formData, setField              — for cross-field chaining (make→model wipe)
//   onZipFill                       — called when a ZIP resolves so City/State auto-fill
function renderManualField(field, value, setValue, ctx = {}) {
  const v = value ?? '';
  const required = !!field.is_required;
  const ph = field.placeholder || field.label || field.name;

  // CarMake — typeahead from the live vehicle registry. Picking a make
  // wipes the sibling Model so a Honda Camry can't slip through.
  if (isCarMake(field)) {
    return (
      <VehicleSelect mode="make"
        value={v} makes={ctx.vehicleMakes || []} strict
        onChange={(next) => {
          setValue(next);
          // Wipe the model when the make changes (parent owns the formData).
          if (ctx.setField && ctx.formData) {
            const modelField = (ctx.fields || []).find(f => isCarModel(f));
            if (modelField && next !== v) ctx.setField(modelField.name, '');
          }
        }}
        placeholder={ph} />
    );
  }
  if (isCarModel(field)) {
    // Model dropdown scoped to whatever make is currently picked.
    const activeMake = (() => {
      const mk = (ctx.fields || []).find(f => isCarMake(f));
      return mk ? (ctx.formData?.[mk.name] || '') : '';
    })();
    return (
      <VehicleSelect mode="model"
        value={v}
        models={ctx.vehicleModelsFor ? ctx.vehicleModelsFor(activeMake) : []}
        requireMake strict
        onChange={setValue} placeholder={ph} />
    );
  }

  // Plain select.
  if (field.field_type === 'select') {
    return (
      <select value={v} onChange={(e) => setValue(e.target.value)}
        required={required} className="input text-xs py-1.5 w-full">
        <option value="">Select {field.label || field.name}…</option>
        {(field.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    );
  }

  if (field.field_type === 'textarea') {
    return (
      <textarea value={v} onChange={(e) => setValue(e.target.value)}
        rows={2} required={required} placeholder={ph}
        className="input text-xs py-1.5 w-full resize-none" />
    );
  }

  // ZIP — fires onZipFill when value becomes 5 digits so the parent can
  // auto-populate City/State fields from /api/zipcode.
  if (field.field_type === 'zip') {
    return (
      <input type="text" inputMode="numeric"
        value={v}
        onChange={(e) => {
          const next = e.target.value.replace(/[^0-9]/g, '').slice(0, 5);
          setValue(next);
          if (ctx.onZipFill && /^\d{5}$/.test(next)) ctx.onZipFill(next);
        }}
        required={required} placeholder={ph}
        className="input text-xs py-1.5 w-full" />
    );
  }

  if (['number','tel','email','phone','date'].includes(field.field_type)) {
    const t = field.field_type === 'phone' ? 'tel' : field.field_type;
    return (
      <input type={t} value={v} onChange={(e) => setValue(e.target.value)}
        required={required} placeholder={ph}
        inputMode={field.field_type === 'number' ? 'numeric' : undefined}
        className="input text-xs py-1.5 w-full" />
    );
  }

  // Default text input.
  return (
    <input type="text" value={v} onChange={(e) => setValue(e.target.value)}
      required={required} placeholder={ph}
      className="input text-xs py-1.5 w-full" />
  );
}

/* ManualEntryModal — closer creates a transfer on behalf of a fronter who
   forgot to log it. Form flow:
     1. Pick the fronter company (from the live company list)
     2. Pick the fronter user (filtered to that company's active fronters)
     3. Fill the dynamic form fields (re-uses the same form_fields config
        the fronter would see) + an initial phone number
   Submits to POST /transfers/manual-entry — backend attributes credit to the
   chosen fronter and self-assigns the closer.
*/
export default function ManualEntryModal({ isOpen, prefillPhone, onClose, onCreated }) {
  const { user } = useAuth();
  const { fields, fetchFields } = useFormFields();

  const [companies,      setCompanies]      = useState([]);
  const [fronters,       setFronters]       = useState([]);
  const [companyId,      setCompanyId]      = useState('');
  const [fronterId,      setFronterId]      = useState('');
  const [formData,       setFormData]       = useState({});
  const [busy,           setBusy]           = useState(false);
  const [err,            setErr]            = useState('');
  const [companyLoading, setCompanyLoading] = useState(false);
  const [fronterLoading, setFronterLoading] = useState(false);
  const [vehicleTree,    setVehicleTree]    = useState([]);
  const [zipInfo,        setZipInfo]        = useState(null);   // last resolved {city,state}
  const [zipLoading,     setZipLoading]     = useState(false);

  // Load fronter companies + form-field config + vehicle registry on open.
  useEffect(() => {
    if (!isOpen) return;
    setErr(''); setBusy(false); setCompanyId(''); setFronterId('');
    setFormData(prefillPhone ? { customer_phone: prefillPhone, Phone: prefillPhone } : {});
    setZipInfo(null);
    fetchFields();
    setCompanyLoading(true);
    Promise.allSettled([
      client.get('transfers/manual-entry-options'),
      client.get('vehicles'),
    ]).then(([coRes, vehRes]) => {
      if (coRes.status === 'fulfilled') setCompanies(coRes.value.data?.companies || []);
      else setCompanies([]);
      if (vehRes.status === 'fulfilled') setVehicleTree(vehRes.value.data?.makes || []);
      else setVehicleTree([]);
    }).finally(() => setCompanyLoading(false));
  }, [isOpen, prefillPhone, fetchFields]);

  // Vehicle helpers built from the registry tree.
  const vehicleMakes      = vehicleTree.map(m => m.name);
  const vehicleModelsFor  = (makeName) => {
    const mk = vehicleTree.find(m => m.name.toLowerCase() === String(makeName || '').toLowerCase());
    return (mk?.models || []).map(m => m.name);
  };

  // ZIP → city/state autofill via the shared zipcode service. Populates every
  // matching field name (City/State/customer_city/customer_state) in formData
  // so whichever variant the SuperAdmin configured gets filled.
  const onZipFill = (zip) => {
    setZipLoading(true);
    client.get(`zipcode/${zip}`)
      .then(r => {
        const info = r.data || null;
        setZipInfo(info);
        if (info) {
          const set = (k, v) => { if (!v) return; setFormData(p => ({ ...p, [k]: v })); };
          set('City', info.city);              set('city', info.city);
          set('customer_city', info.city);
          set('State', info.state_abbr || info.state);
          set('state', info.state_abbr || info.state);
          set('customer_state', info.state_abbr || info.state);
        }
      })
      .catch(() => setZipInfo(null))
      .finally(() => setZipLoading(false));
  };

  // When company changes, narrow the fronter list. Reference payload already
  // contains the active fronters per company so this is a local filter.
  useEffect(() => {
    if (!companyId) { setFronters([]); setFronterId(''); return; }
    setFronterLoading(true);
    const co = companies.find(c => c.id === companyId);
    setFronters(co?.fronters || []);
    setFronterId('');
    setFronterLoading(false);
  }, [companyId, companies]);

  if (!isOpen) return null;

  // form_fields stores the form_data key under `name` (not `key`). Mirror the
  // fronter's own form by ordering + filtering to fronter-visible fields, and
  // skip the phone-style fields because we already render a dedicated phone
  // input above.
  const PHONE_KEYS = new Set(['customer_phone', 'Phone', 'phone', 'PhoneNumber', 'phone_number']);
  const formFieldsSorted = (fields || [])
    .filter(f => f.show_to_fronter !== false)
    .filter(f => !PHONE_KEYS.has(f.name))
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  const setField = (key, value) => setFormData(prev => ({ ...prev, [key]: value }));

  const canSubmit = !!(companyId && fronterId && (formData.customer_phone || formData.Phone)) && !busy;

  const submit = async () => {
    if (!canSubmit) {
      setErr('Pick a company, fronter, and enter a phone number.');
      return;
    }
    setBusy(true); setErr('');
    try {
      const { data } = await client.post('transfers/manual-entry', {
        fronter_company_id: companyId,
        fronter_user_id:    fronterId,
        form_data:          formData,
      });
      onCreated?.(data.transfer);
      onClose();
    } catch (e) {
      setErr(e.response?.data?.error || e.response?.data?.errors?.[0]?.msg || 'Failed to create transfer.');
    } finally { setBusy(false); }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-entry-title"
      className="fixed inset-0 z-50 overflow-y-auto"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="w-full max-w-lg rounded-2xl shadow-2xl flex flex-col"
          style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', maxHeight: 'calc(100vh - 32px)' }}>

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
            style={{ background: 'var(--gradient-sidebar)', borderTopLeftRadius: '1rem', borderTopRightRadius: '1rem' }}>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-white/20">
                <UserPlus size={16} className="text-white" />
              </div>
              <div>
                <h2 id="manual-entry-title" className="text-base font-bold text-white">Manual entry</h2>
                <p className="text-xs text-white/75">Log a transfer for a fronter who forgot to add it</p>
              </div>
            </div>
            <button onClick={onClose} aria-label="Close"
              className="p-2 rounded-xl bg-white/20 hover:bg-white/30 transition-colors"
              style={{ minWidth: 36, minHeight: 36 }}>
              <X size={16} className="text-white" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

            {/* Step 1 — company */}
            <div>
              <label htmlFor="me-company" className="text-xs font-bold uppercase tracking-wide text-text-secondary mb-1.5 flex items-center gap-1.5">
                <Building2 size={12} /> 1. Fronter company
              </label>
              <select
                id="me-company"
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                disabled={companyLoading}
                className="input text-sm py-2 w-full"
                style={{ minHeight: 40 }}
              >
                <option value="">{companyLoading ? 'Loading…' : 'Select company…'}</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            {/* Step 2 — fronter */}
            <div>
              <label htmlFor="me-fronter" className="text-xs font-bold uppercase tracking-wide text-text-secondary mb-1.5 flex items-center gap-1.5">
                <User size={12} /> 2. Fronter user
              </label>
              <select
                id="me-fronter"
                value={fronterId}
                onChange={(e) => setFronterId(e.target.value)}
                disabled={!companyId || fronterLoading}
                className="input text-sm py-2 w-full"
                style={{ minHeight: 40 }}
              >
                <option value="">
                  {!companyId ? 'Pick a company first…'
                   : fronters.length === 0 ? 'No fronters in this company'
                   : 'Select fronter…'}
                </option>
                {fronters.map(f => <option key={f.user_id} value={f.user_id}>{f.name}</option>)}
              </select>
              {fronterId && (
                <p className="text-[11px] text-text-tertiary mt-1.5">
                  Transfer will be attributed to <strong>{fronters.find(f => f.user_id === fronterId)?.name}</strong>. Self-assigned to you ({user?.email}).
                </p>
              )}
            </div>

            {/* Step 3 — phone + dynamic form fields */}
            <div>
              <label htmlFor="me-phone" className="text-xs font-bold uppercase tracking-wide text-text-secondary mb-1.5 flex items-center gap-1.5">
                <Phone size={12} /> 3. Customer info
              </label>
              <input
                id="me-phone"
                type="tel"
                value={formData.customer_phone || formData.Phone || ''}
                onChange={(e) => { setField('customer_phone', e.target.value); setField('Phone', e.target.value); }}
                placeholder="Phone number"
                className="input text-sm py-2 w-full mb-2"
                style={{ minHeight: 40 }}
              />

              {/* Dynamic fields from form_fields config — same shape + types
                  the fronter's own form posts. Honors field_type so a State
                  dropdown stays a dropdown, vehicle fields use VehicleSelect,
                  etc. Per-field state slot keyed on f.name. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {formFieldsSorted.map(f => (
                  <div key={f.id || f.name}>
                    <label className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary block mb-0.5">
                      {f.label || f.name}
                      {f.is_required && <span className="text-error-600 ml-0.5">*</span>}
                    </label>
                    {renderManualField(f, formData[f.name], (v) => setField(f.name, v), {
                      vehicleMakes, vehicleModelsFor,
                      formData, setField,
                      fields: formFieldsSorted,
                      onZipFill,
                    })}
                    {/* ZIP resolution hint — small note under any field
                        whose type is 'zip' once City/State have come back. */}
                    {f.field_type === 'zip' && zipLoading && (
                      <p className="text-[10px] text-text-tertiary mt-1">Looking up ZIP…</p>
                    )}
                    {f.field_type === 'zip' && !zipLoading && zipInfo
                       && (formData[f.name] || '').length === 5 && (
                      <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                        {zipInfo.city}, {zipInfo.state}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl p-3 flex items-start gap-2"
              style={{ backgroundColor: 'var(--color-primary-50, #eef2ff)', border: '1px solid var(--color-primary-200, #c7d2fe)' }}>
              <Info size={14} style={{ color: 'var(--color-primary-700, #4338ca)' }} className="flex-shrink-0 mt-0.5" />
              <p className="text-xs leading-relaxed" style={{ color: 'var(--color-primary-700, #4338ca)' }}>
                The transfer will appear on the fronter's dashboard (credit preserved) and on your assigned-transfers list. Audit trail records this as <strong>"Manual entry by closer · {user?.first_name || user?.email}"</strong>.
              </p>
            </div>

            {err && (
              <div role="alert"
                className="p-2.5 rounded-lg flex items-start gap-2 text-sm font-semibold"
                style={{ backgroundColor: 'var(--color-error-50)', color: 'var(--color-error-700)', border: '1px solid var(--color-error-200)' }}>
                <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                <span>{err}</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center gap-2 px-5 py-3 flex-shrink-0"
            style={{ borderTop: '1px solid var(--color-border)' }}>
            <div className="flex-1" />
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={submit} disabled={!canSubmit}>
              {busy ? 'Creating…' : 'Create transfer'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
