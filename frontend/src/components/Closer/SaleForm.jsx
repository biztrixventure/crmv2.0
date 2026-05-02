import React, { useState, useEffect } from 'react';
import { DollarSign, Users, Calendar, Hash, FileText, Building2 } from 'lucide-react';
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
  { value: 'open',      label: 'OPEN',      color: '#f59e0b' },
  { value: 'follow_up', label: 'CALLBACK',  color: '#3b82f6' },
  { value: 'cancelled', label: 'CANCELLED', color: '#ef4444' },
];

// Maps known form field names to sales table columns for search indexing
function mapToSaleColumns(formData) {
  const firstName = (formData.FirstName || formData.first_name || '').trim();
  const lastName  = (formData.LastName  || formData.last_name  || '').trim();
  const fullName  = [firstName, lastName].filter(Boolean).join(' ')
    || formData.customer_name || formData.Name || formData.name || formData.FullName || formData.fullname || '';

  const phone = formData.Phone || formData.phone || formData.customer_phone
    || formData.PhoneNumber || formData.phone_number || formData.Mobile || formData.CellPhone || '';

  const phone2 = formData.Phone2 || formData.phone2 || formData.customer_phone_2 || '';

  const email  = formData.Email || formData.email || formData.customer_email || formData.EmailAddress || '';

  const carYear  = formData.CarYear  || formData.car_year  || formData.Year  || null;
  const carMake  = formData.CarMake  || formData.car_make  || formData.Make  || null;
  const carModel = formData.CarModel || formData.car_model || formData.Model || null;
  const carMiles = formData.CarMiles || formData.car_miles || formData.Mileage || null;
  const carVin   = formData.CarVin   || formData.car_vin   || formData.VIN   || null;

  return {
    customer_name:    fullName,
    customer_phone:   phone,
    customer_phone_2: phone2,
    customer_email:   email,
    customer_address: [formData.Address, formData.City, formData.State, formData.Zip].filter(Boolean).join(', ')
      || formData.customer_address || '',
    car_year:   carYear  ? parseInt(carYear)  || null : null,
    car_make:   carMake  || null,
    car_model:  carModel || null,
    car_miles:  carMiles ? parseInt(carMiles) || null : null,
    car_vin:    carVin   ? String(carVin).toUpperCase() : null,
  };
}

const SaleForm = ({ user, transfer = null, existingSale = null, onSubmit, isLoading = false }) => {
  const [fronters, setFronters]       = useState([]);
  const [errors, setErrors]           = useState({});
  const { plans, clients, fetchConfigs } = useSaleConfigs(user?.company_id);
  const { fields, loading: fieldsLoading, fetchFields } = useFormFields();

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);
  useEffect(() => { fetchFields(); }, [fetchFields]);

  const [formData, setFormData] = useState(existingSale?.form_data || transfer?.form_data || {});

  // Fetch fronters in the same company
  useEffect(() => {
    client.get('users', { params: { company_id: user?.company_id } })
      .then(res => {
        setFronters((res.data.users || []).filter(
          u => u.role_level === 'fronter' || u.role_level === 'operations'
        ));
      })
      .catch(() => {});
  }, [user?.company_id]);

  // Auto-fill fronter field from transfer once fields + fronters are ready
  useEffect(() => {
    if (!transfer?.created_by || !fronters.length || !fields.length) return;
    const fronterField = fields.find(f => f.field_type === 'sale_fronter');
    if (!fronterField || formData[fronterField.name]) return;
    setFormData(prev => ({ ...prev, [fronterField.name]: transfer.created_by }));
  }, [transfer?.created_by, fronters, fields]);

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
    const dynField = (type) => fields.find(f => f.field_type === type);
    const dynVal   = (type) => { const f = dynField(type); return f ? (formData[f.name] || '') : ''; };

    onSubmit({
      ...mapped,
      form_data:        formData,
      transfer_id:      transfer?.id || undefined,
      company_id:       user?.company_id,
      plan:             dynVal('sale_plan')             || null,
      down_payment:     parseFloat(dynVal('sale_down_payment'))    || null,
      monthly_payment:  parseFloat(dynVal('sale_monthly_payment')) || null,
      payment_due_note: dynVal('sale_payment_due_note') || null,
      reference_no:     dynVal('sale_reference_no')     || null,
      client_name:      dynVal('sale_client')           || null,
      fronter_id:       dynVal('sale_fronter')          || null,
      sale_date:        dynVal('sale_date')             || new Date().toISOString().split('T')[0],
      status:           dynVal('sale_status')           || 'open',
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
    if (field.field_type === 'sale_down_payment' || field.field_type === 'sale_monthly_payment') {
      return (
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <span className="text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>$</span>
          </div>
          <input type="number" step="0.01" min="0" value={val}
            onChange={onChange} placeholder="0.00"
            className={`input pl-7 ${errClass}`} />
        </div>
      );
    }
    if (field.field_type === 'sale_payment_due_note') {
      return (
        <input type="text" value={val} onChange={onChange}
          placeholder="Monthly payments will be on 3rd of each month"
          className={`input ${errClass}`} />
      );
    }
    if (field.field_type === 'sale_reference_no') {
      return (
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Hash size={16} style={{ color: 'var(--color-text-tertiary)' }} />
          </div>
          <input type="text" value={val} onChange={onChange}
            placeholder="MBH4220SBN"
            className={`input pl-9 uppercase font-mono tracking-wider ${errClass}`} />
        </div>
      );
    }
    if (field.field_type === 'sale_fronter') {
      return (
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Users size={16} style={{ color: 'var(--color-text-tertiary)' }} />
          </div>
          <select value={val} onChange={onChange} className={`input pl-9 ${errClass}`}>
            <option value="">Select fronter…</option>
            {fronters.map(f => (
              <option key={f.user_id} value={f.user_id}>{f.first_name} {f.last_name}</option>
            ))}
          </select>
        </div>
      );
    }
    if (field.field_type === 'sale_date') {
      return (
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Calendar size={16} style={{ color: 'var(--color-text-tertiary)' }} />
          </div>
          <input type="date"
            value={val || new Date().toISOString().split('T')[0]}
            onChange={onChange} className={`input pl-9 ${errClass}`} />
        </div>
      );
    }
    if (field.field_type === 'sale_status') {
      const activeStatus = val || 'open';
      return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {STATUSES.map(s => (
            <button key={s.value} type="button"
              onClick={() => setDynField(field.name, s.value)}
              className="relative py-3 px-4 rounded-xl border-2 font-bold text-sm transition-all duration-150"
              style={{
                borderColor:     activeStatus === s.value ? s.color : 'var(--color-border)',
                backgroundColor: activeStatus === s.value ? s.color + '18' : 'var(--color-surface)',
                color:           activeStatus === s.value ? s.color : 'var(--color-text-secondary)',
                transform:       activeStatus === s.value ? 'scale(1.03)' : 'scale(1)',
              }}>
              {activeStatus === s.value && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full"
                  style={{ backgroundColor: s.color }} />
              )}
              {s.label}
            </button>
          ))}
        </div>
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

  const sortedFields = [...fields].sort((a, b) => (a.order || 0) - (b.order || 0));

  return (
    <form onSubmit={handleSubmit} className="space-y-1">

      {/* Lead source banner — shown only when creating from a transfer */}
      {transfer && (transfer.fronter_name || transfer.company_slug || transfer.company_name) && (
        <div className="mb-4 px-4 py-3 rounded-xl flex items-center gap-3"
          style={{ backgroundColor: 'var(--color-primary-50)', border: '1px solid var(--color-primary-200)' }}>
          <Building2 size={16} style={{ color: 'var(--color-primary-600)', flexShrink: 0 }} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide mb-0.5" style={{ color: 'var(--color-primary-600)' }}>
              Lead Source
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              {transfer.fronter_name && (
                <span className="text-sm text-text">
                  <span className="text-text-secondary">Fronter: </span>
                  <span className="font-semibold">{transfer.fronter_name}</span>
                </span>
              )}
              {(transfer.company_slug || transfer.company_name) && (
                <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-lg"
                  style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>
                  {transfer.company_slug || transfer.company_name}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

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
            <><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" /> {existingSale ? 'Updating…' : 'Submitting…'}</>
          ) : (
            <><DollarSign size={18} /> {existingSale ? 'Update Sale' : 'Send to Compliance'}</>
          )}
        </button>
      </div>
    </form>
  );
};

export default SaleForm;
