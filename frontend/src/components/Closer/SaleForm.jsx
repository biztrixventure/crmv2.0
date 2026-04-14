import React, { useState, useEffect } from 'react';
import { User, Phone, Mail, MapPin, Car, DollarSign, FileText, Users, Calendar, Hash, Tag } from 'lucide-react';
import client from '../../api/client';
import { useSaleConfigs } from '../../hooks/useSaleConfigs';

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

// ─── Input with optional icon ─────────────────────────────────────────────────
const Input = ({ icon: Icon, prefix, ...props }) => (
  <div className="relative">
    {Icon && (
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        <Icon size={16} style={{ color: 'var(--color-text-tertiary)' }} />
      </div>
    )}
    {prefix && (
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        <span className="text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{prefix}</span>
      </div>
    )}
    <input
      {...props}
      className={`input ${Icon || prefix ? 'pl-9' : ''} ${props.className || ''}`}
    />
  </div>
);

const STATUSES = [
  { value: 'sold',      label: 'SOLD',      color: '#22c55e' },
  { value: 'open',      label: 'PENDING',   color: '#f59e0b' },
  { value: 'cancelled', label: 'CANCELLED', color: '#ef4444' },
  { value: 'follow_up', label: 'FOLLOW UP', color: '#3b82f6' },
];

/**
 * SaleForm — Full sale entry form for closers.
 * @param {object} user        — logged-in user (closer auto-filled)
 * @param {object} transfer    — optional pre-filled transfer data
 * @param {function} onSubmit  — called with form data object
 * @param {boolean} isLoading
 */
const SaleForm = ({ user, transfer = null, onSubmit, isLoading = false }) => {
  const [fronters, setFronters] = useState([]);
  const [errors, setErrors] = useState({});
  const { plans, clients, fetchConfigs } = useSaleConfigs(user?.company_id);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  // Pull customer info from the linked transfer if available
  const tfd = transfer?.form_data || {};

  const [form, setForm] = useState({
    // Customer
    customer_name:    tfd.customer_name    || '',
    customer_phone:   tfd.customer_phone   || '',
    customer_phone_2: '',
    customer_email:   tfd.customer_email   || '',
    customer_address: '',
    // Vehicle
    car_year:  '',
    car_make:  '',
    car_model: '',
    car_miles: '',
    car_vin:   '',
    // Deal
    plan:              '',
    down_payment:      '',
    monthly_payment:   '',
    payment_due_note:  '',
    reference_no:      '',
    client_name:       '',
    // People
    fronter_id: '',
    // Meta
    sale_date: new Date().toISOString().split('T')[0],
    status:    'sold',
  });

  // Fetch fronters in the same company
  useEffect(() => {
    client.get('users', { params: { company_id: user?.company_id } })
      .then(res => {
        const fronterList = (res.data.users || []).filter(
          u => u.role_level === 'fronter' || u.role_level === 'operations'
        );
        setFronters(fronterList);

        // Pre-select fronter from transfer's creator if available
        if (transfer?.created_by) {
          const match = (res.data.users || []).find(u => u.user_id === transfer.created_by);
          if (match) {
            setForm(prev => ({ ...prev, fronter_id: match.user_id }));
          }
        }
      })
      .catch(() => {});
  }, [user?.company_id, transfer?.created_by]);

  const set = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: '' }));
  };

  const onChange = e => set(e.target.name, e.target.value);

  const validate = () => {
    const e = {};
    if (!form.customer_name.trim()) e.customer_name = 'Required';
    if (!form.customer_phone.trim()) e.customer_phone = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = e => {
    e.preventDefault();
    if (!validate()) return;
    onSubmit({
      ...form,
      transfer_id: transfer?.id || undefined,
      company_id: user?.company_id,
      car_year: form.car_year ? parseInt(form.car_year) : null,
      car_miles: form.car_miles ? parseInt(form.car_miles) : null,
      down_payment: form.down_payment ? parseFloat(form.down_payment) : null,
      monthly_payment: form.monthly_payment ? parseFloat(form.monthly_payment) : null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-1">

      {/* ── CUSTOMER INFORMATION ─────────────────────────────────────── */}
      <Section icon={User} title="Customer Information">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Full Name" required error={errors.customer_name}>
            <Input
              icon={User} name="customer_name" value={form.customer_name}
              onChange={onChange} placeholder="FRANK JENKINS" className="uppercase"
            />
          </Field>
          <Field label="Email" error={errors.customer_email}>
            <Input
              icon={Mail} name="customer_email" type="email" value={form.customer_email}
              onChange={onChange} placeholder="frank@example.com"
            />
          </Field>
          <Field label="Primary Phone" required error={errors.customer_phone}>
            <Input
              icon={Phone} name="customer_phone" value={form.customer_phone}
              onChange={onChange} placeholder="(904) 765-0112"
            />
          </Field>
          <Field label="Secondary Phone" hint="Optional second number">
            <Input
              icon={Phone} name="customer_phone_2" value={form.customer_phone_2}
              onChange={onChange} placeholder="(904) 600-2119"
            />
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <div className="relative">
              <div className="absolute top-3 left-3 pointer-events-none">
                <MapPin size={16} style={{ color: 'var(--color-text-tertiary)' }} />
              </div>
              <textarea
                name="customer_address" value={form.customer_address} onChange={onChange}
                rows={2} placeholder="230 E 1st St #813 Jacksonville, FL 32206"
                className="input pl-9 resize-none"
              />
            </div>
          </Field>
        </div>
      </Section>

      {/* ── VEHICLE INFORMATION ──────────────────────────────────────── */}
      <Section icon={Car} title="Vehicle Information">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Field label="Year">
            <input
              name="car_year" value={form.car_year} onChange={onChange}
              type="number" min="1900" max="2100" placeholder="2018"
              className="input"
            />
          </Field>
          <Field label="Make">
            <input
              name="car_make" value={form.car_make} onChange={onChange}
              placeholder="TOYOTA" className="input uppercase"
            />
          </Field>
          <Field label="Model">
            <input
              name="car_model" value={form.car_model} onChange={onChange}
              placeholder="CAMRY" className="input uppercase"
            />
          </Field>
          <Field label="Mileage">
            <input
              name="car_miles" value={form.car_miles} onChange={onChange}
              type="number" min="0" placeholder="152,225"
              className="input"
            />
          </Field>
          <Field label="VIN Number" className="sm:col-span-4"
            hint="17-character vehicle identification number">
            <input
              name="car_vin" value={form.car_vin} onChange={e => set('car_vin', e.target.value.toUpperCase())}
              placeholder="4T1B11HK5JU153898" maxLength={17}
              className="input uppercase tracking-widest font-mono"
            />
          </Field>
        </div>
      </Section>

      {/* ── DEAL DETAILS ─────────────────────────────────────────────── */}
      <Section icon={DollarSign} title="Deal Details">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Plan">
            <select name="plan" value={form.plan} onChange={onChange} className="input">
              <option value="">Select plan…</option>
              {plans.map(p => <option key={p.id} value={p.value}>{p.value}</option>)}
            </select>
          </Field>
          <Field label="Reference No" hint="Auto-generated if left blank">
            <Input
              icon={Hash} name="reference_no" value={form.reference_no}
              onChange={onChange} placeholder="MBH4220SBN"
              className="uppercase font-mono tracking-wider"
            />
          </Field>
          <Field label="Down Payment">
            <Input
              prefix="$" name="down_payment" type="number" step="0.01" min="0"
              value={form.down_payment} onChange={onChange} placeholder="108.00"
              className="pl-7"
            />
          </Field>
          <Field label="Monthly Payment">
            <Input
              prefix="$" name="monthly_payment" type="number" step="0.01" min="0"
              value={form.monthly_payment} onChange={onChange} placeholder="108.00"
              className="pl-7"
            />
          </Field>
          <Field label="Payment Due Note" className="sm:col-span-2"
            hint='e.g. "Monthly payments will be on 3rd of each month"'>
            <input
              name="payment_due_note" value={form.payment_due_note} onChange={onChange}
              placeholder="Monthly payments will be on 3rd of May."
              className="input"
            />
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
              <select name="fronter_id" value={form.fronter_id} onChange={onChange} className="input pl-9">
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
              style={{ backgroundColor: 'var(--color-bg-secondary, var(--color-bg))', cursor: 'not-allowed', opacity: 0.85 }}
            >
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

          {/* Client dropdown (or free-text if no options) */}
          <Field label="Client" hint='Internal client reference'>
            {clients.length > 0 ? (
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Tag size={16} style={{ color: 'var(--color-text-tertiary)' }} />
                </div>
                <select name="client_name" value={form.client_name} onChange={onChange} className="input pl-9">
                  <option value="">Select client…</option>
                  {clients.map(c => <option key={c.id} value={c.value}>{c.value}</option>)}
                </select>
              </div>
            ) : (
              <Input icon={Tag} name="client_name" value={form.client_name}
                onChange={onChange} placeholder="Jim" />
            )}
          </Field>

          {/* Sale date */}
          <Field label="Sale Date">
            <Input
              icon={Calendar} name="sale_date" type="date"
              value={form.sale_date} onChange={onChange}
            />
          </Field>

          {/* Status */}
          <Field label="Status" className="sm:col-span-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {STATUSES.map(s => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => set('status', s.value)}
                  className="relative py-3 px-4 rounded-xl border-2 font-bold text-sm transition-all duration-150"
                  style={{
                    borderColor: form.status === s.value ? s.color : 'var(--color-border)',
                    backgroundColor: form.status === s.value
                      ? s.color + '18'
                      : 'var(--color-surface)',
                    color: form.status === s.value ? s.color : 'var(--color-text-secondary)',
                    transform: form.status === s.value ? 'scale(1.03)' : 'scale(1)',
                  }}
                >
                  {form.status === s.value && (
                    <span
                      className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full"
                      style={{ backgroundColor: s.color }}
                    />
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
        <button
          type="submit"
          disabled={isLoading}
          className="flex items-center gap-2 py-3 px-8 rounded-xl font-bold text-white transition-all duration-200"
          style={{
            background: isLoading ? 'var(--color-disabled-bg)' : 'var(--gradient-sidebar)',
            boxShadow: isLoading ? 'none' : 'var(--shadow-md)',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            minWidth: 160,
            justifyContent: 'center',
          }}
        >
          {isLoading ? (
            <>
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
              Saving sale…
            </>
          ) : (
            <>
              <DollarSign size={18} />
              Save Sale
            </>
          )}
        </button>
      </div>
    </form>
  );
};

export default SaleForm;
