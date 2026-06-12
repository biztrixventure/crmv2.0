import React, { useState, useEffect, useRef } from 'react';
import { DollarSign, Users, Hash, FileText, Building2, Car, Plus, X } from 'lucide-react';
import client from '../../api/client';
import { useSaleConfigs } from '../../hooks/useSaleConfigs';
import { useFormFields } from '../../hooks/useFormFields';
import { vehicleFieldIssues } from '../../utils/vehicleValidation';
import { smartFormat, isSuggestable, suggestionsFor, rememberValues } from '../../utils/formAssist';
import { normalize as normalizeField, maxLengthFor, inputModeFor, isCarMake, isCarModel, isCarYear, isDateField, classify as classifyField } from '../../utils/formFieldNorm';
import VehicleSelect from '../Form/VehicleSelect';
import CalendarDateInput from '../Form/CalendarDateInput';
import { useVehicleYearRange } from '../../hooks/useVehicleYearRange';
import { useUserColors } from '../../hooks/useUserColors';
import { isPostDateDispo } from '../../utils/dispositions';

// ISO timestamp → <input type="datetime-local"> value (local wall-clock).
const isoToLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

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
  <div className={`self-start ${className}`}>
    <label className="flex items-center gap-1 flex-wrap text-[11px] font-bold uppercase tracking-wide mb-1.5"
      style={{ color: error ? '#dc2626' : 'var(--color-text-secondary)' }}>
      {label}{required && <span style={{ color: '#ef4444' }}>*</span>}
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


// Guarantees a <select> always shows its stored value as a selected option,
// even when the option source (per-company plans / clients / fronters) doesn't
// contain it — e.g. a compliance manager editing another company's sale, where
// that company's configs aren't in the editing user's lists. Without this the
// field renders blank and looks like it "lost" the saved value. Renders nothing
// when the value is empty or already present in the list.
const StaleOption = ({ value, present, label }) =>
  (value && !present)
    ? <option value={value}>{label || value}</option>
    : null;

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
  // Plans + clients are per-company and live under the CLOSER company. When
  // editing (esp. from the Compliance shell, where the editing user's company
  // differs from the sale's), load the SALE's own company so the stored
  // client/plan values have matching options and render as selected instead of
  // blank. For a new sale the editing closer's company is correct. We never use
  // the transfer's company here — that's the fronter side, which has no plans.
  const configCompanyId = existingSale?.company_id || user?.company_id;
  const { plans, clients, fetchConfigs } = useSaleConfigs(configCompanyId);
  const { fields, loading: fieldsLoading, fetchFields } = useFormFields();
  const { years: vehicleYears } = useVehicleYearRange();
  const { colorFor } = useUserColors();
  // Closer-side preview of /sales/eligibility-check so the closer sees an
  // ineligibility warning while they're filling the form instead of
  // bouncing off a 400 after Submit.
  const [eligPreview, setEligPreview] = useState(null);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);
  useEffect(() => { fetchFields(); }, [fetchFields]);

  const [formData, setFormData] = useState(existingSale?.form_data || transfer?.form_data || {});
  // Charging date/time for a post-dated sale. Shown only when the closer
  // disposition resolves to a "post date" option (see showChargeDate below).
  const [chargeAt, setChargeAt] = useState(isoToLocalInput(existingSale?.charge_at));

  // Fetch fronters for the sale's company (configCompanyId) rather than the
  // editing user's — so a compliance manager editing another company's sale
  // still gets that company's fronters in the dropdown. StaleOption below keeps
  // the stored fronter selectable even if the list still doesn't include them.
  useEffect(() => {
    client.get('users', { params: { company_id: configCompanyId } })
      .then(res => {
        setFronters((res.data.users || []).filter(
          u => u.role_level === 'fronter' || u.role_level === 'operations'
        ));
      })
      .catch(() => {});
  }, [configCompanyId]);

  // Eligibility preview — debounced check on the plan + vehicle fields
  // currently in formData. Runs only when the closer has at least a plan
  // AND a year-or-make-or-miles. Cancels prior requests so the latest
  // result wins. Never blocks Submit; the real enforcement happens on the
  // backend POST/PUT.
  useEffect(() => {
    const plan = formData.SalePlan || formData.sale_plan || formData.plan;
    const year = formData.CarYear || formData.car_year || formData.Year;
    const make = formData.CarMake || formData.car_make || formData.Make;
    const miles = formData.CarMiles || formData.car_miles || formData.Miles;
    if (!plan || (!year && !make && !miles)) { setEligPreview(null); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      client.post('sales/eligibility-check', {
        plan, car_year: year, car_make: make, car_miles: miles,
        company_id: transfer?.company_id || user?.company_id || null,
      }).then(r => { if (!cancelled) setEligPreview(r.data || null); })
        .catch(() => { /* silent — preview is optional */ });
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [
    formData.SalePlan, formData.sale_plan, formData.plan,
    formData.CarYear, formData.car_year, formData.Year,
    formData.CarMake, formData.car_make, formData.Make,
    formData.CarMiles, formData.car_miles, formData.Miles,
    transfer?.company_id, user?.company_id,
  ]);

  // Auto-fill fronter field from transfer once fields + fronters are ready
  useEffect(() => {
    if (!transfer?.created_by || !fronters.length || !fields.length) return;
    const fronterField = fields.find(f => f.field_type === 'sale_fronter');
    if (!fronterField || formData[fronterField.name]) return;
    setFormData(prev => ({ ...prev, [fronterField.name]: transfer.created_by }));
  }, [transfer?.created_by, fronters, fields]);

  // Additional vehicles for the same customer/transfer. Each entry holds only
  // the values for fields the superadmin marked repeats_per_car. The first car
  // always lives in `formData` (unchanged single-car behavior).
  const [extraCars, setExtraCars] = useState([]);

  const [zipLoading, setZipLoading] = useState(false);
  const [zipInfo,    setZipInfo]    = useState(null);
  const zipTimer = useRef(null);

  // Vehicle registry — fed by the superadmin's /vehicles config. Used by the
  // Make/Model fields below to render a typeahead with the curated options.
  // Falls back to free text when the registry is empty (no API call cost
  // beyond mount; cached for the form's lifetime).
  const [vehicleTree, setVehicleTree] = useState([]);   // [{id,name,models:[{id,name}]}]
  useEffect(() => {
    client.get('vehicles').then(r => setVehicleTree(r.data.makes || [])).catch(() => {});
  }, []);
  const makesList = vehicleTree.map(m => m.name);
  const modelsForMake = (makeName) => {
    const mk = vehicleTree.find(m => m.name.toLowerCase() === String(makeName || '').toLowerCase());
    return (mk?.models || []).map(m => m.name);
  };

  const setDynField = (name, value) => {
    setFormData(prev => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: '' }));
  };

  // Set a value on one of the additional cars
  const setCarField = (carIdx, name, value) => {
    setExtraCars(prev => prev.map((c, i) => i === carIdx ? { ...c, [name]: value } : c));
    const ek = `x${carIdx}:${name}`;
    if (errors[ek]) setErrors(prev => ({ ...prev, [ek]: '' }));
  };

  const addCar    = () => setExtraCars(prev => [...prev, {}]);
  const removeCar = (idx) => setExtraCars(prev => prev.filter((_, i) => i !== idx));

  const handleZipChange = (fieldName, raw) => {
    // Force-strip to digits + 5-cap up front — paste of "90210-1234" trims to
    // "90210" cleanly, and a wholly non-numeric paste lands on "" rather than
    // poisoning the field with garbage.
    const val = String(raw || '').replace(/\D/g, '').slice(0, 5);
    setDynField(fieldName, val);
    clearTimeout(zipTimer.current);

    // Backspace below 5 → clear both the local zipInfo hint AND any city/state
    // values we previously autofilled, so the form never shows stale geo data.
    if (val.length < 5) {
      setZipInfo(null);
      setFormData(prev => {
        const next = { ...prev };
        const cityF  = fields.find(f => ['City','city','customer_city'].includes(f.name));
        const stateF = fields.find(f => ['State','state','customer_state'].includes(f.name));
        if (cityF)  next[cityF.name]  = '';
        if (stateF) next[stateF.name] = '';
        return next;
      });
      return;
    }
    zipTimer.current = setTimeout(async () => {
      setZipLoading(true);
      try {
        const res = await client.get(`zipcode/${val}`);
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
    }, 400);
  };

  // Fields that duplicate per car (superadmin-controlled). Everything else is
  // shared/personal and entered once.
  const carFields = fields.filter(f => f.repeats_per_car === true);

  // formData holds car #1's values too; strip the car-field keys to get the
  // shared/personal base reused by each additional car.
  const personalData = (() => {
    const carNames = new Set(carFields.map(f => f.name));
    return Object.fromEntries(Object.entries(formData).filter(([k]) => !carNames.has(k)));
  })();

  const validate = () => {
    const e = {};
    // First car + personal fields live in formData
    fields.filter(f => f.is_required).forEach(f => {
      if (!formData[f.name]?.toString().trim()) e[f.name] = 'Required';
    });
    // Required car fields must be filled on every additional car
    extraCars.forEach((car, i) => {
      carFields.filter(f => f.is_required).forEach(f => {
        if (!car[f.name]?.toString().trim()) e[`x${i}:${f.name}`] = 'Required';
      });
    });
    // Vehicle sanity guard (catches shifted columns: bad year / numeric make).
    Object.assign(e, vehicleFieldIssues(fields, formData));
    extraCars.forEach((car, i) => Object.assign(e, vehicleFieldIssues(carFields, car, `x${i}:`)));
    // Post-date disposition requires a charging date/time so the reminder fires.
    const df = fields.find(f => f.field_type === 'sale_disposition' || f.field_type === 'sale_status');
    const dv = df ? (formData[df.name] || '') : '';
    if (isPostDateDispo(dv) && !chargeAt) e.__charge_at = 'Pick a charging date & time';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // Extract the per-car portion (vehicle + deal fields) from a merged value set
  const buildCarPayload = (values) => {
    const mapped = mapToSaleColumns(values);
    const dynVal = (type) => { const f = fields.find(x => x.field_type === type); return f ? (values[f.name] || '') : ''; };
    return {
      car_year:  mapped.car_year,
      car_make:  mapped.car_make,
      car_model: mapped.car_model,
      car_miles: mapped.car_miles,
      car_vin:   mapped.car_vin,
      plan:             dynVal('sale_plan')                       || null,
      down_payment:     parseFloat(dynVal('sale_down_payment'))    || null,
      monthly_payment:  parseFloat(dynVal('sale_monthly_payment')) || null,
      payment_due_note: dynVal('sale_payment_due_note')           || null,
      reference_no:     dynVal('sale_reference_no')               || null,
      closer_disposition: dynVal('sale_disposition') || dynVal('sale_status') || null,
      form_data:        values,
    };
  };

  const handleSubmit = e => {
    e.preventDefault();
    if (!validate()) return;

    const mapped = mapToSaleColumns(formData);
    const dynVal = (type) => { const f = fields.find(x => x.field_type === type); return f ? (formData[f.name] || '') : ''; };

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
      // Only stamp 'open' when CREATING. On an edit (e.g. a closer fixing a
      // needs_revision sale) we must not force the status — the caller resubmits
      // it for review separately, and forcing 'open' can 400 when a company's
      // allowed_statuses list doesn't include the internal draft status.
      ...(existingSale ? {} : { status: 'open' }),
      closer_disposition:  dynVal('sale_disposition') || dynVal('sale_status') || null,
      // Charge date only travels when the post-date disposition is selected;
      // otherwise null so flipping a sale back to "sale" clears the schedule.
      charge_at: isPostDateDispo(dynVal('sale_disposition') || dynVal('sale_status'))
        ? (chargeAt ? new Date(chargeAt).toISOString() : null)
        : null,
      // One extra sale per additional car. Strip car-field values from the shared
      // base so a blank field on car #2 doesn't inherit car #1's vehicle data.
      additional_cars: extraCars.map(car => buildCarPayload({ ...personalData, ...car })),
    });
    // Remember repeatable values (city/make/model/plan…) for future autocomplete.
    rememberValues(fields, formData);
    extraCars.forEach(car => rememberValues(carFields, car));
  };

  // Render a single dynamic field input.
  // values/setValue/errKey let the same renderer drive both the first car
  // (formData) and additional cars (extraCars[i]).
  const renderInput = (field, values = formData, setValue = setDynField, errKey = field.name) => {
    const val = values[field.name] || '';
    const onChange = e => setValue(field.name, e.target.value);
    const ph = field.placeholder || `Enter ${field.label.toLowerCase()}`;
    const errClass = errors[errKey] ? 'ring-2 ring-red-400/60 border-red-400' : '';
    // Auto-capitalize on blur; offer past values for repeatable fields (datalist).
    const onBlur = () => { const f = smartFormat(field, values[field.name]); if (f !== (values[field.name] || '')) setValue(field.name, f); };
    const sug = isSuggestable(field) ? suggestionsFor(field.name) : [];
    const listId = sug.length ? `ff-${errKey}` : undefined;
    const Dl = listId ? <datalist id={listId}>{sug.map(s => <option key={s} value={s} />)}</datalist> : null;

    // Vehicle year — bounded dropdown (newest first). Range is admin-set via
    // business_config vehicle.year_min / vehicle.year_max.
    if (isCarYear(field)) {
      return (
        <select value={val} onChange={onChange} required={field.is_required}
          className={`input ${errClass}`}>
          <option value="">Select year…</option>
          {vehicleYears.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      );
    }
    // Car make/model MUST come before the generic select / textarea branches
    // — admins frequently set CarMake to field_type=select (it IS a dropdown)
    // and that would otherwise render a plain empty <select> instead of the
    // VehicleSelect typeahead. Same logic as TransferFormModal, kept in sync.
    if (isCarMake(field)) {
      return (
        <VehicleSelect
          mode="make"
          value={val}
          makes={makesList}
          strict
          onChange={(v) => {
            setValue(field.name, v);
            const modelF = (fields || []).find(f => isCarModel(f));
            if (modelF && v !== val) setValue(modelF.name, '');
          }}
          placeholder={ph || 'Type make…'}
        />
      );
    }
    if (isCarModel(field)) {
      const makeF = (fields || []).find(f => isCarMake(f));
      const activeMake = makeF ? (values[makeF.name] || '') : '';
      return (
        <VehicleSelect
          mode="model"
          value={val}
          models={modelsForMake(activeMake)}
          requireMake
          strict
          onChange={(v) => setValue(field.name, v)}
          placeholder={ph || 'Type model…'}
        />
      );
    }
    if (field.field_type === 'textarea') {
      return (
        <textarea value={val} onChange={onChange} onBlur={onBlur} rows={3}
          required={field.is_required} placeholder={ph}
          className={`input resize-none ${errClass}`} />
      );
    }
    if (field.field_type === 'select') {
      return (
        <select value={val} onChange={onChange} required={field.is_required}
          className={`input ${errClass}`}>
          <option value="">Select {field.label}</option>
          <StaleOption value={val} present={(field.options || []).includes(val)} />
          {(field.options || []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    if (field.field_type === 'sale_client') {
      return (
        <select value={val} onChange={onChange} required={field.is_required}
          className={`input ${errClass}`}>
          <option value="">Select client…</option>
          <StaleOption value={val} present={clients.some(c => c.value === val)} />
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
          <StaleOption value={val} present={planOptions.some(p => p.value === val)} />
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
          <select value={val} onChange={onChange} className={`input pl-9 ${errClass}`}
            style={{ color: colorFor(val, 'var(--color-text)'), fontWeight: colorFor(val) ? 600 : undefined }}>
            <option value="" style={{ color: 'var(--color-text)', fontWeight: 400 }}>Select fronter…</option>
            <StaleOption value={val} present={fronters.some(f => f.user_id === val)}
              label={existingSale?.fronter_name || transfer?.fronter_name || 'Current fronter'} />
            {fronters.map(f => (
              <option key={f.user_id} value={f.user_id}
                style={{ color: colorFor(f.user_id, 'var(--color-text)'), fontWeight: colorFor(f.user_id) ? 600 : 400 }}>
                {f.first_name} {f.last_name}
              </option>
            ))}
          </select>
        </div>
      );
    }
    // Date fields (Sale Date / Monthly Date / any field_type=date) — calendar
    // only, defaulted to today, MM/DD/YYYY. Manual typing disabled so a
    // MM/DD vs DD/MM slip can't reach Compliance.
    if (field.field_type === 'sale_date' || isDateField(field)) {
      return (
        <CalendarDateInput
          value={val}
          onChange={(iso) => setValue(field.name, iso)}
          required={field.is_required}
          className={errClass}
        />
      );
    }
    if (field.field_type === 'sale_disposition' || field.field_type === 'sale_status') {
      const DEFAULT_DISPOS = ['sale', 'no_sale', 'callback', 'not_interested', 'hung_up', 'voicemail', 'other'];
      const opts = (field.options && field.options.length > 0) ? field.options : DEFAULT_DISPOS;
      return (
        <select value={val} onChange={onChange} required={field.is_required}
          className={`input ${errClass}`}>
          <option value="">Select disposition…</option>
          <StaleOption value={val} present={opts.includes(val)} label={String(val).replace(/_/g, ' ')} />
          {opts.map(o => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
        </select>
      );
    }
    // Rate Call — admin-configurable dropdown (comma-separated options in Form Builder)
    if (field.field_type === 'sale_call_review') {
      const opts = (field.options && field.options.length > 0) ? field.options : ['Excellent', 'Good', 'Average', 'Poor', 'Bad'];
      return (
        <select value={val} onChange={onChange} required={field.is_required}
          className={`input ${errClass}`}>
          <option value="">Rate the call…</option>
          <StaleOption value={val} present={opts.includes(val)} label={String(val).replace(/_/g, ' ')} />
          {opts.map(o => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
        </select>
      );
    }
    if (field.field_type === 'zip' || classifyField(field) === 'zip') {
      return (
        <div className="relative">
          <input type="text" inputMode="numeric" value={val}
            onChange={e => handleZipChange(field.name, e.target.value)}
            required={field.is_required} placeholder={ph || 'e.g. 90210'}
            /* No HTML maxLength — pre-strip clip would break "(845)…" paste; JS slice caps. */
            className={`input pr-8 ${errClass}`} />
          {zipLoading && (
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2"
                style={{ borderColor: 'var(--color-primary-600)' }} />
            </div>
          )}
          {zipLoading === false && zipInfo && val.length === 5 && (
            <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
              {zipInfo.city}, {zipInfo.state}
            </p>
          )}
        </div>
      );
    }
    // Generic text/number/email/phone/etc. — pipe through the normalizer so
    // phone strips parens/dashes, vin uppercases and clips at 17, name strips
    // digits, etc. The classify helper picks the rule once per field.
    const inputType =
      field.field_type === 'phone' || field.field_type === 'tel' ? 'tel'
      : field.field_type;
    const ml = maxLengthFor(field);
    const im = inputModeFor(field);
    const normalizedOnChange = (e) => {
      const next = normalizeField(field, e.target.value);
      onChange({ target: { value: next } });
    };
    return (
      <>
        <input type={inputType} value={val} onChange={normalizedOnChange} onBlur={onBlur}
          required={field.is_required} placeholder={ph} list={listId}
          maxLength={ml} inputMode={im}
          className={`input ${errClass}`} />
        {Dl}
      </>
    );
  };

  // City/State are auto-filled by ZIP lookup, but the SuperAdmin can mark
  // them required on the form config — in that case render them so the closer
  // can edit/confirm. They still receive ZIP autofill, just visibly.
  const ZIP_AUTO_FILL = ['City','city','customer_city','State','state','customer_state'];
  const showAutofillField = (f) => !ZIP_AUTO_FILL.includes(f.name) || f.is_required || f.show_to_closer === true;

  const sortedFields = [...fields]
    .filter(showAutofillField)
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  // Vehicle/deal fields that duplicate on each additional car
  const carFieldsSorted = carFields
    .filter(showAutofillField)
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  const SPAN_CLASS = { 1: 'col-span-1', 2: 'col-span-2', 3: 'col-span-3', 4: 'col-span-4', 5: 'col-span-5' };

  // Multi-car only applies when creating (not editing one existing sale) and
  // the superadmin has marked at least one field as repeats_per_car.
  const allowMultiCar = !existingSale && carFieldsSorted.length > 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-0">

      {/* Vehicle eligibility preview — surfaces the same verdict the
          backend POST/PUT will run. Red when blocked, amber when warn-
          mode, hidden when ok or skipped. Doesn't block Submit; the
          server still enforces. */}
      {eligPreview && !eligPreview.ok && eligPreview.reason && (
        <div className="mb-5 rounded-xl p-3 flex items-start gap-2"
          style={{
            backgroundColor: 'var(--color-error-50, #fef2f2)',
            border: '1px solid var(--color-error-300, #fca5a5)',
          }}>
          <span className="text-lg leading-none">🚫</span>
          <div className="flex-1 text-xs">
            <p className="font-bold" style={{ color: 'var(--color-error-700, #b91c1c)' }}>
              Vehicle ineligible for this plan
            </p>
            <p className="mt-0.5" style={{ color: 'var(--color-error-700, #b91c1c)' }}>
              {eligPreview.reason}
            </p>
            <p className="mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
              Adjust the vehicle or pick a different plan. Submitting now will be rejected by compliance.
            </p>
          </div>
        </div>
      )}

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
        <div className="grid grid-cols-5 gap-4 py-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="col-span-1 space-y-1.5 animate-pulse">
              <div className="h-3 w-20 rounded" style={{ backgroundColor: 'var(--color-border)' }} />
              <div className="h-9 rounded-xl" style={{ backgroundColor: 'var(--color-border)' }} />
            </div>
          ))}
        </div>
      ) : sortedFields.length > 0 ? (
        <Section icon={FileText} title="Customer Information">
          <div className="grid grid-cols-5 items-start gap-x-4 gap-y-5">
            {sortedFields.map(field => {
              const spanClass = {
                1: 'col-span-1',
                2: 'col-span-2',
                3: 'col-span-3',
                4: 'col-span-4',
                5: 'col-span-5',
              }[field.column_span] || 'col-span-1';
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

      {/* ── Charging date — appears when the closer picks the post-date
            disposition. Date + time; the closer is reminded at this moment. ── */}
      {(() => {
        const df = fields.find(f => f.field_type === 'sale_disposition' || f.field_type === 'sale_status');
        const dv = df ? (formData[df.name] || '') : '';
        if (!isPostDateDispo(dv)) return null;
        return (
          <div className="mb-5 rounded-xl p-4"
            style={{ border: '1px solid var(--color-warning-300, #fcd34d)', backgroundColor: 'var(--color-warning-50, #fffbeb)' }}>
            <label className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide mb-1.5"
              style={{ color: 'var(--color-warning-800, #92400e)' }}>
              Charging Date &amp; Time <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input type="datetime-local" value={chargeAt}
              onChange={e => { setChargeAt(e.target.value); if (errors.__charge_at) setErrors(p => ({ ...p, __charge_at: '' })); }}
              className={`input text-sm ${errors.__charge_at ? 'ring-2 ring-red-400/60 border-red-400' : ''}`} style={{ maxWidth: 280 }} />
            {errors.__charge_at
              ? <p className="text-[11px] mt-1 font-semibold flex items-center gap-1" style={{ color: '#dc2626' }}><span>⚠</span> {errors.__charge_at}</p>
              : <p className="text-[11px] mt-1.5" style={{ color: 'var(--color-warning-700, #b45309)' }}>
                  The card will be charged at this time. You’ll get a reminder, and once charged you can move it to “Sale”.
                </p>}
          </div>
        );
      })()}

      {/* ── Additional vehicles ── */}
      {allowMultiCar && extraCars.map((car, idx) => (
        <div key={idx} className="mb-5 rounded-xl p-4"
          style={{ border: '1px dashed var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--gradient-sidebar)' }}>
                <Car size={12} className="text-white" />
              </div>
              <span className="text-[11px] font-bold uppercase tracking-widest"
                style={{ color: 'var(--color-text-secondary)' }}>
                Vehicle #{idx + 2}
              </span>
            </div>
            <button type="button" onClick={() => removeCar(idx)}
              className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg transition-colors"
              style={{ color: 'var(--color-error-600)' }}>
              <X size={12} /> Remove
            </button>
          </div>
          <div className="grid grid-cols-5 items-start gap-x-4 gap-y-5">
            {carFieldsSorted.map(field => (
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
                error={errors[`x${idx}:${field.name}`]}
                className={SPAN_CLASS[field.column_span] || 'col-span-1'}>
                {renderInput(field, car, (n, v) => setCarField(idx, n, v), `x${idx}:${field.name}`)}
              </Field>
            ))}
          </div>
        </div>
      ))}

      {allowMultiCar && (
        <button type="button" onClick={addCar}
          className="mb-5 flex items-center gap-2 py-2.5 px-5 rounded-xl font-bold text-sm transition-all hover:scale-[1.01]"
          style={{ border: '1.5px dashed var(--color-primary-400)', color: 'var(--color-primary-600)', backgroundColor: 'var(--color-primary-50)' }}>
          <Plus size={16} /> Add Another Car
        </button>
      )}

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
