import React, { useState, useEffect } from 'react';
import { User, DollarSign, Users, Calendar, Hash, Tag, FileText } from 'lucide-react';
import client from '../../api/client';
import { useSaleConfigs } from '../../hooks/useSaleConfigs';
import { useFormFields } from '../../hooks/useFormFields';

// ─── Section header ──────────────────────────────────────────────────────────
const Section = ({ icon: Icon, title, children }) => (
  <div className="mb-6">
    <div className="flex items-center gap-2 mb-4 pb-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
      <div className="p-1.5 rounded-lg" style={{ backgroundColor: 'var(--color-primary-100, #ede9fe)' }}>
        <Icon size={16} style={{ color: 'var(--color-primary-600)' }} />
      </div>
      <h3 className="font-bold text-sm uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>
        {title}
      </h3>
    </div>
    {children}
  </div>
);

// ─── Field wrapper ────────────────────────────────────────────────────────────
const Field = ({ label, required, error, hint, children, className = '' }) => (
  <div className={className}>
    <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>
      {label}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    {children}
    {hint && !error && <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>{hint}</p>}
    {error && <p className="text-xs mt-1 text-red-500">{error}</p>}
  </div>
);

const STATUSES = [
  { value: 'sold',      label: 'SOLD',      color: '#22c55e' },
  { value: 'open',      label: 'PENDING',   color: '#f59e0b' },
  { value: 'cancelled', label: 'CANCELLED', color: '#ef4444' },
  { value: 'follow_up', label: 'FOLLOW UP', color: '#3b82f6' },
];

// Maps known form field names to sales table columns for search indexing
function mapToSaleColumns(formData) {
  const firstName = (formData.FirstName || '').trim();
  const lastName  = (formData.LastName  || '').trim();
  return {
    customer_name:    [firstName, lastName].filter(Boolean).join(' ') || formData.customer_name || '',
    customer_phone:   formData.Phone    || formData.customer_phone   || '',
    customer_phone_2: formData.Phone2   || formData.customer_phone_2 || '',
    customer_email:   formData.Email    || formData.customer_email   || '',
    customer_address: [formData.Address, formData.City, formData.State, formData.Zip].filter(Boolean).join(', ') || formData.customer_address || '',
    car_year:   formData.CarYear  ? parseInt(formData.CarYear)  : null,
    car_make:   formData.CarMake  || null,
    car_model:  formData.CarModel || null,
    car_miles:  formData.CarMiles ? parseInt(formData.CarMiles) : null,
    car_vin:    formData.CarVin   ? formData.CarVin.toUpperCase() : null,
  };
}

/**
 * SaleForm — Full sale entry form for closers.
 * Customer/vehicle fields come from form_fields (same form as fronter, all fields).
 * Deal + people sections are hardcoded CRM fields.
 */
const SaleForm = ({ user, transfer = null, onSubmit, isLoading = false }) => {
  const [fronters, setFronters]       = useState([]);
  const [errors, setErrors]           = useState({});
  const { plans, clients, fetchConfigs } = useSaleConfigs(user?.company_id);
  const { fields, loading: fieldsLoading, fetchFields } = useFormFields();

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);
  useEffect(() => { fetchFields(); }, [fetchFields]);

  // Dynamic form data (customer / vehicle / custom fields) — pre-filled from transfer
  const [formData, setFormData] = useState(transfer?.form_data || {});

  // Deal + people fields (hardcoded CRM data)
  const [form, setForm] = useState({
    plan:             '',
    down_payment:     '',
    monthly_payment:  '',
    payment_due_note: '',
    reference_no:     '',
    client_name:      '',
    fronter_id:       '',
    sale_date:        new Date().toISOString().split('T')[0],
    status:           'sold',
  });

  // Fetch fronters in the same company
  useEffect(() => {
    client.get('users', { params: { company_id: user?.company_id } })
      .then(res => {
        const fronterList = (res.data.users || []).filter(
          u => u.role_level === 'fronter' || u.role_level === 'operations'
        );
        setFronters(fronterList);
        if (transfer?.created_by) {
          const match = (res.data.users || []).find(u => u.user_id === transfer.created_by);
          if (match) setForm(prev => ({ ...prev, fronter_id: match.user_id }));
        }
      })
      .catch(() => {});
  }, [user?.company_id, transfer?.created_by]);

  const setField = (name, value) => {
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const setDynField = (name, value) => {
    setFormData(prev => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: '' }));
  };

  const validate = () => {
    const e = {};
    fields.filter(f => f.is_required).forEach(f => {
      if (!formData[f.name]?.toString().trim()) e[f.name] = 'Required';
    });
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = e => {
    e.preventDefault();
    if (!validate()) return;

    const mapped = mapToSaleColumns(formData);

    onSubmit({
      ...mapped,
      form_data:       formData,
      transfer_id:     transfer?.id   || undefined,
      company_id:      user?.company_id,
      plan:            form.plan             || null,
      down_payment:    form.down_payment     ? parseFloat(form.down_payment)    : null,
      monthly_payment: form.monthly_payment  ? parseFloat(form.monthly_payment) : null,
      payment_due_note: form.payment_due_note || null,
      reference_no:    form.reference_no     || null,
      client_name:     form.client_name      || null,
      fronter_id:      form.fronter_id       || null,
      sale_date:       form.sale_date,
      status:          form.status,
    });
  };

  // Render a single dynamic field input
  const renderInput = (field) => {
    const val = formData[field.name] || '';
    const onChange = e => setDynField(field.name, e.target.value);
    const ph = field.placeholder || `Enter ${field.label.toLowerCase()}`;
    const errClass = errors[field.name] ? 'border-red-400' : '';

    if (field.field_type === 'textarea') {
      return (
        <textarea value={val} onChange={onChange} rows={3}
          required={field.is_required} placeholder={ph}
          className={`input resize-none ${errClass}`} />
      );
    }
    if (field.field_type === 'select') {
      return (
        <select value={val} onChange={onChange} required={field.is_required}
          className={`input ${errClass}`}>
          <option value="">Select {field.label}</option>
          {(field.options || []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    if (field.field_type === 'sale_client') {
      return (
        <select value={val} onChange={onChange} required={field.is_required}
          className={`input ${errClass}`}>
          <option value="">Select client…</option>
          {clients.map(c => <option key={c.id} value={c.value}>{c.value}</option>)}
        </select>
      );
    }
    if (field.field_type === 'sale_plan') {
      // Cascade: filter plans by selected client if mapping is configured
      const clientField = fields.find(f => f.field_type === 'sale_client');
      const selectedClient = clientField ? (formData[clientField.name] || '') : '';
      let planOptions = plans;
      if (selectedClient && Array.isArray(field.options) && field.options.length > 0) {
        const mapping = field.options.find(m => m.client === selectedClient);
        if (mapping) planOptions = plans.filter(p => mapping.plans.includes(p.value));
      }
      return (
        <select value={val} onChange={onChange} required={field.is_required}
          className={`input ${errClass}`}>
          <option value="">Select plan…</option>
          {planOptions.map(p => <option key={p.id} value={p.value}>{p.value}</option>)}
        </select>
      );
    }
    const inputType =
      field.field_type === 'phone' || field.field_type === 'tel' ? 'tel'
      : field.field_type === 'zip' ? 'text'
      : field.field_type;
    return (
      <input type={inputType} value={val} onChange={onChange}
        required={field.is_required} placeholder={ph}
        className={`input ${errClass}`} />
    );
  };

  // sale_plan and sale_client are rendered in their dedicated hardcoded sections below
  const SKIP_TYPES = new Set(['sale_plan', 'sale_client']);
  const sortedFields = [...fields]
    .filter(f => !SKIP_TYPES.has(f.field_type))
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  return (
    <form onSubmit={handleSubmit} className="space-y-1">

      {/* ── DYNAMIC FIELDS (same form as fronter, all fields shown to closer) ── */}
      {fieldsLoading ? (
        <div className="flex justify-center py-6">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
        </div>
      ) : sortedFields.length > 0 ? (
        <Section icon={FileText} title="Customer Information">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {sortedFields.map(field => {
              const spanClass = {
                1: 'sm:col-span-1',
                2: 'sm:col-span-2',
                3: 'sm:col-span-3',
              }[field.column_span] || 'sm:col-span-1';
              return (
                <Field
                  key={field.id}
                  label={
                    <span className="flex items-center gap-2">
                      {field.label}
                      {field.show_to_fronter === false && (
                        <span className="text-xs px-1.5 py-0.5 rounded font-semibold"
                          style={{ backgroundColor: 'var(--color-primary-50)', color: 'var(--color-primary-600)' }}>
                          Closer Only
                        </span>
                      )}
                    </span>
                  }
                  required={field.is_required}
                  error={errors[field.name]}
                  className={spanClass}>
                  {renderInput(field)}
                </Field>
              );
            })}
          </div>
        </Section>
      ) : null}

      {/* ── DEAL DETAILS ─────────────────────────────────────────────── */}
      <Section icon={DollarSign} title="Deal Details">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Plan">
            <select value={form.plan} onChange={e => setField('plan', e.target.value)} className="input">
              <option value="">Select plan…</option>
              {plans.map(p => <option key={p.id} value={p.value}>{p.value}</option>)}
            </select>
          </Field>
          <Field label="Reference No" hint="Auto-generated if left blank">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Hash size={16} style={{ color: 'var(--color-text-tertiary)' }} />
              </div>
              <input value={form.reference_no} onChange={e => setField('reference_no', e.target.value)}
                placeholder="MBH4220SBN" className="input pl-9 uppercase font-mono tracking-wider" />
            </div>
          </Field>
          <Field label="Down Payment">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <span className="text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>$</span>
              </div>
              <input type="number" step="0.01" min="0" value={form.down_payment}
                onChange={e => setField('down_payment', e.target.value)}
                placeholder="108.00" className="input pl-7" />
            </div>
          </Field>
          <Field label="Monthly Payment">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <span className="text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>$</span>
              </div>
              <input type="number" step="0.01" min="0" value={form.monthly_payment}
                onChange={e => setField('monthly_payment', e.target.value)}
                placeholder="108.00" className="input pl-7" />
            </div>
          </Field>
          <Field label="Payment Due Note" className="sm:col-span-2"
            hint='e.g. "Monthly payments will be on 3rd of each month"'>
            <input value={form.payment_due_note} onChange={e => setField('payment_due_note', e.target.value)}
              placeholder="Monthly payments will be on 3rd of May." className="input" />
          </Field>
        </div>
      </Section>

      {/* ── PEOPLE & ADMIN ───────────────────────────────────────────── */}
      <Section icon={Users} title="People & Administrative">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Fronter dropdown */}
          <Field label="Fronter" hint="Who handled this lead initially">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Users size={16} style={{ color: 'var(--color-text-tertiary)' }} />
              </div>
              <select value={form.fronter_id} onChange={e => setField('fronter_id', e.target.value)} className="input pl-9">
                <option value="">Select fronter…</option>
                {fronters.map(f => (
                  <option key={f.user_id} value={f.user_id}>
                    {f.first_name} {f.last_name}
                  </option>
                ))}
              </select>
            </div>
          </Field>

          {/* Closer — locked to logged-in user */}
          <Field label="Closer" hint="Auto-filled — you">
            <div
              className="input flex items-center gap-2"
              style={{ backgroundColor: 'var(--color-bg-secondary)', cursor: 'not-allowed', opacity: 0.85 }}>
              <User size={16} style={{ color: 'var(--color-primary-500)' }} />
              <span className="font-semibold" style={{ color: 'var(--color-text)' }}>
                {user?.first_name} {user?.last_name}
              </span>
              <span className="text-xs ml-auto px-2 py-0.5 rounded-full"
                style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-600)' }}>
                You
              </span>
            </div>
          </Field>

          {/* Client dropdown */}
          <Field label="Client" hint="Internal client reference">
            {clients.length > 0 ? (
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Tag size={16} style={{ color: 'var(--color-text-tertiary)' }} />
                </div>
                <select value={form.client_name} onChange={e => setField('client_name', e.target.value)} className="input pl-9">
                  <option value="">Select client…</option>
                  {clients.map(c => <option key={c.id} value={c.value}>{c.value}</option>)}
                </select>
              </div>
            ) : (
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Tag size={16} style={{ color: 'var(--color-text-tertiary)' }} />
                </div>
                <input value={form.client_name} onChange={e => setField('client_name', e.target.value)}
                  placeholder="Jim" className="input pl-9" />
              </div>
            )}
          </Field>

          {/* Sale date */}
          <Field label="Sale Date">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Calendar size={16} style={{ color: 'var(--color-text-tertiary)' }} />
              </div>
              <input type="date" value={form.sale_date} onChange={e => setField('sale_date', e.target.value)}
                className="input pl-9" />
            </div>
          </Field>

          {/* Status */}
          <Field label="Status" className="sm:col-span-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {STATUSES.map(s => (
                <button key={s.value} type="button" onClick={() => setField('status', s.value)}
                  className="relative py-3 px-4 rounded-xl border-2 font-bold text-sm transition-all duration-150"
                  style={{
                    borderColor:       form.status === s.value ? s.color : 'var(--color-border)',
                    backgroundColor:   form.status === s.value ? s.color + '18' : 'var(--color-surface)',
                    color:             form.status === s.value ? s.color : 'var(--color-text-secondary)',
                    transform:         form.status === s.value ? 'scale(1.03)' : 'scale(1)',
                  }}>
                  {form.status === s.value && (
                    <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full"
                      style={{ backgroundColor: s.color }} />
                  )}
                  {s.label}
                </button>
              ))}
            </div>
          </Field>
        </div>
      </Section>

      {/* ── SUBMIT ───────────────────────────────────────────────────── */}
      <div className="flex justify-end pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
        <button type="submit" disabled={isLoading}
          className="flex items-center gap-2 py-3 px-8 rounded-xl font-bold text-white transition-all duration-200"
          style={{
            background:  isLoading ? 'var(--color-disabled-bg)' : 'var(--gradient-sidebar)',
            boxShadow:   isLoading ? 'none' : 'var(--shadow-md)',
            cursor:      isLoading ? 'not-allowed' : 'pointer',
            minWidth:    160,
            justifyContent: 'center',
          }}>
          {isLoading ? (
            <><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" /> Saving sale…</>
          ) : (
            <><DollarSign size={18} /> Save Sale</>
          )}
        </button>
      </div>
    </form>
  );
};

export default SaleForm;
