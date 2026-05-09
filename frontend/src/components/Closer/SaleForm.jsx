import React, { useState, useEffect, useRef } from 'react';
import { DollarSign, Users, Calendar, Hash, FileText, Building2 } from 'lucide-react';
import client from '../../api/client';
import { useSaleConfigs } from '../../hooks/useSaleConfigs';
import { useFormFields } from '../../hooks/useFormFields';

// ─── Section header ──────────────────────────────────────────────────────────
const Section = ({ icon: Icon, title, children }) => (
  <div className="mb-5">
    <div className="flex items-center gap-2.5 mb-4">
      <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: 'var(--gradient-sidebar)' }}>
        <Icon size={12} className="text-white" />
      </div>
      <span className="text-[11px] font-bold uppercase tracking-widest"
        style={{ color: 'var(--color-text-secondary)' }}>
        {title}
      </span>
      <div className="flex-1 h-px" style={{ backgroundColor: 'var(--color-border)' }} />
    </div>
    {children}
  </div>
);

// ─── Field wrapper ────────────────────────────────────────────────────────────
const Field = ({ label, required, error, hint, children, className = '' }) => (
  <div className={className}>
    <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5"
      style={{ color: error ? '#dc2626' : 'var(--color-text-secondary)' }}>
      {label}{required && <span className="ml-0.5" style={{ color: '#ef4444' }}>*</span>}
    </label>
    {children}
    {hint && !error && (
      <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>{hint}</p>
    )}
    {error && (
      <p className="text-[11px] mt-1 font-semibold flex items-center gap-1" style={{ color: '#dc2626' }}>
        <span>⚠</span> {error}
      </p>
    )}
  </div>
);


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

  const [zipLoading, setZipLoading] = useState(false);
  const [zipInfo,    setZipInfo]    = useState(null);
  const zipTimer = useRef(null);

  const setDynField = (name, value) => {
    setFormData(prev => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: '' }));
  };

  const handleZipChange = (fieldName, val) => {
    setDynField(fieldName, val);
    clearTimeout(zipTimer.current);
    if (val.replace(/\D/g, '').length < 5) { setZipInfo(null); return; }
    zipTimer.current = setTimeout(async () => {
      setZipLoading(true);
      try {
        const res = await client.get(`zipcode/${val.trim()}`);
        setZipInfo(res.data);
        setFormData(prev => {
          const next = { ...prev };
          const cityF  = fields.find(f => ['City','city','customer_city'].includes(f.name));
          const stateF = fields.find(f => ['State','state','customer_state'].includes(f.name));
          if (cityF)  next[cityF.name]  = res.data.city;
          if (stateF) next[stateF.name] = res.data.state;
          return next;
        });
      } catch { setZipInfo(null); }
      finally { setZipLoading(false); }
    }, 500);
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
      fronter_id:          dynVal('sale_fronter')     || null,
      sale_date:           dynVal('sale_date')         || new Date().toISOString().split('T')[0],
      status:              'open',
      closer_disposition:  dynVal('sale_disposition') || dynVal('sale_status') || null,
    });
  };

  // Render a single dynamic field input
  const renderInput = (field) => {
    const val = formData[field.name] || '';
    const onChange = e => setDynField(field.name, e.target.value);
    const ph = field.placeholder || `Enter ${field.label.toLowerCase()}`;
    const errClass = errors[field.name] ? 'ring-2 ring-red-400/60 border-red-400' : '';

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
    if (field.field_type === 'sale_disposition' || field.field_type === 'sale_status') {
      const DEFAULT_DISPOS = ['sale', 'no_sale', 'callback', 'not_interested', 'hung_up', 'voicemail', 'other'];
      const opts = (field.options && field.options.length > 0) ? field.options : DEFAULT_DISPOS;
      return (
        <select value={val} onChange={onChange} required={field.is_required}
          className={`input ${errClass}`}>
          <option value="">Select disposition…</option>
          {opts.map(o => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
        </select>
      );
    }
    if (field.field_type === 'zip') {
      return (
        <div className="relative">
          <input type="text" value={val}
            onChange={e => handleZipChange(field.name, e.target.value)}
            required={field.is_required} placeholder={ph || 'e.g. 90210'}
            className={`input pr-8 ${errClass}`} maxLength={10} />
          {zipLoading && (
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2"
                style={{ borderColor: 'var(--color-primary-600)' }} />
            </div>
          )}
          {zipLoading === false && zipInfo && val.replace(/\D/g, '').length >= 5 && (
            <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
              {zipInfo.city}, {zipInfo.state}
            </p>
          )}
        </div>
      );
    }
    const inputType =
      field.field_type === 'phone' || field.field_type === 'tel' ? 'tel'
      : field.field_type;
    return (
      <input type={inputType} value={val} onChange={onChange}
        required={field.is_required} placeholder={ph}
        className={`input ${errClass}`} />
    );
  };

  const sortedFields = [...fields].sort((a, b) => (a.order || 0) - (b.order || 0));

  return (
    <form onSubmit={handleSubmit} className="space-y-0">

      {/* Lead source banner */}
      {transfer && (transfer.fronter_name || transfer.company_slug || transfer.company_name) && (
        <div className="mb-5 flex items-center gap-3 px-4 py-3 rounded-xl"
          style={{
            backgroundColor: 'var(--color-primary-50)',
            borderLeft: '3px solid var(--color-primary-500)',
            border: '1px solid var(--color-primary-200)',
          }}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--gradient-sidebar)' }}>
            <Building2 size={14} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-0.5"
              style={{ color: 'var(--color-primary-600)' }}>Lead Source</p>
            <div className="flex items-center gap-2 flex-wrap">
              {transfer.fronter_name && (
                <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  {transfer.fronter_name}
                </span>
              )}
              {(transfer.company_slug || transfer.company_name) && (
                <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-md"
                  style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>
                  {transfer.company_slug || transfer.company_name}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {fieldsLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 py-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={`${i % 3 === 0 ? 'sm:col-span-2' : 'sm:col-span-1'} space-y-1.5 animate-pulse`}>
              <div className="h-3 w-20 rounded" style={{ backgroundColor: 'var(--color-border)' }} />
              <div className="h-9 rounded-xl" style={{ backgroundColor: 'var(--color-border)' }} />
            </div>
          ))}
        </div>
      ) : sortedFields.length > 0 ? (
        <Section icon={FileText} title="Customer Information">
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-x-4 gap-y-5">
            {sortedFields.map(field => {
              const spanClass = {
                1: 'sm:col-span-1',
                2: 'sm:col-span-2',
                3: 'sm:col-span-3',
                4: 'sm:col-span-4',
                5: 'sm:col-span-5',
              }[field.column_span] || 'sm:col-span-1';
              return (
                <Field
                  key={field.id}
                  label={
                    <span className="flex items-center gap-1.5">
                      {field.label}
                      {field.show_to_fronter === false && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-bold normal-case tracking-normal"
                          style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-600)' }}>
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

      {/* ── SUBMIT ── */}
      <div className="flex items-center justify-between pt-5 mt-2"
        style={{ borderTop: '1px solid var(--color-border)' }}>
        <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          {Object.values(errors).filter(Boolean).length > 0
            ? <span style={{ color: '#dc2626' }}>⚠ Fix {Object.values(errors).filter(Boolean).length} error(s) above</span>
            : <span>All fields marked <span style={{ color: '#ef4444' }}>*</span> are required</span>
          }
        </p>
        <button type="submit" disabled={isLoading}
          className="flex items-center gap-2 py-2.5 px-7 rounded-xl font-bold text-sm text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed disabled:scale-100"
          style={{
            background:  isLoading ? 'var(--color-bg-secondary)' : 'var(--gradient-sidebar)',
            boxShadow:   isLoading ? 'none' : 'var(--shadow-md)',
            color:       isLoading ? 'var(--color-text-secondary)' : 'white',
            minWidth:    148,
            justifyContent: 'center',
          }}>
          {isLoading ? (
            <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" /> {existingSale ? 'Updating…' : 'Submitting…'}</>
          ) : (
            <><DollarSign size={15} /> {existingSale ? 'Update Sale' : 'Send to Compliance'}</>
          )}
        </button>
      </div>
    </form>
  );
};

export default SaleForm;
