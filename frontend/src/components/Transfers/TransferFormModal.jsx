import { useState, useEffect, useRef } from 'react';
import { Send, FileText } from 'lucide-react';
import { Button } from '../UI';
import ComboInput from '../UI/ComboInput';
import { canonicalizeFormData } from '../../utils/canonicalizeOption';
import client from '../../api/client';
import { normalize as normalizeField, maxLengthFor, inputModeFor, classify as classifyField, isCarMake, isCarModel, isCarYear, isDateField } from '../../utils/formFieldNorm';
import VehicleSelect from '../Form/VehicleSelect';
import CalendarDateInput from '../Form/CalendarDateInput';
import { useVehicleYearRange } from '../../hooks/useVehicleYearRange';
import { useUserColors } from '../../hooks/useUserColors';

const TransferFormModal = ({
  isOpen, onClose,
  user, fields = [], fieldsLoading = false,
  closers = [], closersLoading = false,
  saleClients = [], salePlans = [],
  onSubmit, isLoading = false,
  // Edit mode — when set, the modal prefills from this row and the caller's
  // onSubmit is expected to dispatch a PUT instead of a POST. The closer
  // dropdown is hidden in edit mode since reassignment happens through
  // separate workflow steps (manager reassign / compliance reject).
  existingTransfer = null,
  reasonRequired = false,
}) => {
  const [formData, setFormData]         = useState({});
  const [selectedCloser, setSelectedCloser] = useState('');
  const [editReason, setEditReason]     = useState('');
  const [transferDate, setTransferDate] = useState('');   // edit mode: the real created_at (Transfer Date)
  const [error, setError]               = useState('');
  const isEdit = !!existingTransfer;
  const origDate = existingTransfer?.created_at ? existingTransfer.created_at.slice(0, 10) : '';
  const { years: vehicleYears } = useVehicleYearRange();
  const { colorFor } = useUserColors();

  // Hydrate from existing row whenever the modal opens or a different row is
  // loaded. Resetting on close happens via the modal teardown in handleSubmit.
  useEffect(() => {
    if (isOpen && existingTransfer) {
      setFormData(existingTransfer.form_data || {});
      if (existingTransfer.assigned_closer_id) setSelectedCloser(existingTransfer.assigned_closer_id);
      setEditReason('');
      setTransferDate(existingTransfer.created_at ? existingTransfer.created_at.slice(0, 10) : '');
    }
  }, [isOpen, existingTransfer]);

  // Zip → city/state autofill (same UX as SaleForm).
  const [zipLoading, setZipLoading] = useState(false);
  const [zipInfo,    setZipInfo]    = useState(null);
  const zipTimer = useRef(null);

  // Vehicle registry for make/model typeaheads.
  const [vehicleTree, setVehicleTree] = useState([]);
  useEffect(() => {
    if (!isOpen) return;
    client.get('vehicles').then(r => setVehicleTree(r.data.makes || [])).catch(() => {});
  }, [isOpen]);
  const makesList = vehicleTree.map(m => m.name);
  const modelsForMake = (makeName) => {
    const mk = vehicleTree.find(m => m.name.toLowerCase() === String(makeName || '').toLowerCase());
    return (mk?.models || []).map(m => m.name);
  };

  if (!isOpen) return null;

  const setField = (name, val) => setFormData(p => ({ ...p, [name]: val }));

  const handleZipChange = (fieldName, raw) => {
    const val = String(raw || '').replace(/\D/g, '').slice(0, 5);
    setField(fieldName, val);
    clearTimeout(zipTimer.current);
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    // Closer requirement only applies on create. Edit mode keeps the existing
    // assignment; reassignment is a separate manager workflow.
    if (!isEdit && !selectedCloser) { setError('Please select a closer.'); return; }
    if (reasonRequired && !editReason.trim()) { setError('A reason is required for this edit.'); return; }
    // Snap option values to their canonical spelling (covers Enter-to-submit).
    const clean = canonicalizeFormData(formData, fields);
    try {
      const payload = isEdit
        ? {
            form_data: clean,
            ...(editReason.trim() ? { reason: editReason.trim() } : {}),
            // Only send when the date actually changed — moves the real created_at.
            ...(transferDate && transferDate !== origDate ? { transfer_date: transferDate } : {}),
          }
        : { ...clean, assigned_closer_id: selectedCloser };
      await onSubmit(payload);
      setFormData({});
      setSelectedCloser('');
      setEditReason('');
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Failed to submit');
    }
  };

  const onBackdrop = e => { if (e.target === e.currentTarget) onClose(); };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={onBackdrop}
    >
      <div
        className="relative w-full max-w-2xl my-6 rounded-2xl animate-scale-in"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 rounded-t-2xl" style={{ background: 'var(--gradient-sidebar)' }}>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl"><Send size={20} className="text-white" /></div>
            <h2 className="text-xl font-bold text-white">New Transfer / Lead</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl bg-white/20 hover:bg-white/30 transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          {fieldsLoading || closersLoading ? (
            <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Dynamic fields */}
              {fields.filter(f => f.show_to_fronter !== false).length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--color-text-secondary)' }}>
                    Customer Information
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {fields
                      .filter(f => f.show_to_fronter !== false)
                      .sort((a, b) => (a.order || 0) - (b.order || 0))
                      .map(field => {
                        const spanClass = { 1: 'sm:col-span-1', 2: 'sm:col-span-2', 3: 'sm:col-span-3' }[field.column_span] || 'sm:col-span-1';
                        const val = formData[field.name] || '';
                        const onChange = e => setField(field.name, e.target.value);

                        let input;
                        // Car make/model first — otherwise an admin who set
                        // CarMake's field_type to "select" (perfectly natural
                        // for a dropdown) would hit the generic select branch
                        // below and get an empty native <select> instead of
                        // the VehicleSelect typeahead.
                        if (isCarYear(field)) {
                          input = (
                            <select value={val} onChange={onChange} required={field.is_required} className="input">
                              <option value="">Select year…</option>
                              {vehicleYears.map(y => <option key={y} value={y}>{y}</option>)}
                            </select>
                          );
                        } else if (isDateField(field)) {
                          input = (
                            <CalendarDateInput value={val}
                              onChange={(iso) => setField(field.name, iso)}
                              required={field.is_required} />
                          );
                        } else if (isCarMake(field)) {
                          input = <VehicleSelect mode="make" value={val} makes={makesList} strict
                            onChange={v => {
                              setField(field.name, v);
                              const modelF = fields.find(f => isCarModel(f));
                              if (modelF && v !== val) setField(modelF.name, '');
                            }}
                            placeholder={field.placeholder || 'Type make…'} />;
                        } else if (isCarModel(field)) {
                          const makeF = fields.find(f => isCarMake(f));
                          const activeMake = makeF ? (formData[makeF.name] || '') : '';
                          input = <VehicleSelect mode="model" value={val} models={modelsForMake(activeMake)} requireMake strict
                            onChange={v => setField(field.name, v)} placeholder={field.placeholder || 'Type model…'} />;
                        } else if (field.field_type === 'textarea') {
                          input = <textarea value={val} onChange={onChange} rows={3} required={field.is_required}
                            placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`} className="input resize-none" />;
                        } else if (field.field_type === 'select') {
                          input = (
                            <ComboInput value={val} options={field.options} required={field.is_required}
                              onChange={v => setField(field.name, v)} placeholder={field.placeholder || `Select or type ${field.label}`} />
                          );
                        } else if (field.field_type === 'sale_client') {
                          input = (
                            <select value={val} onChange={onChange} required={field.is_required} className="input">
                              <option value="">Select client…</option>
                              {saleClients.map(c => <option key={c.id} value={c.value}>{c.value}</option>)}
                            </select>
                          );
                        } else if (field.field_type === 'sale_plan') {
                          const clientField = fields.find(f => f.field_type === 'sale_client');
                          const selClient = clientField ? (formData[clientField.name] || '') : '';
                          let opts = salePlans;
                          if (selClient && Array.isArray(field.options) && field.options.length > 0) {
                            const m = field.options.find(x => x.client === selClient);
                            if (m) opts = salePlans.filter(p => m.plans.includes(p.value));
                          }
                          input = (
                            <select value={val} onChange={onChange} required={field.is_required} className="input">
                              <option value="">Select plan…</option>
                              {opts.map(p => <option key={p.id} value={p.value}>{p.value}</option>)}
                            </select>
                          );
                        } else if (classifyField(field) === 'zip') {
                          input = (
                            <div className="relative">
                              {/* No HTML maxLength — would clip a "(845) …" paste before
                                  handleZipChange could strip non-digits, leaving the wrong
                                  five chars. The JS slice(0,5) on stripped value is the cap. */}
                              <input type="text" inputMode="numeric" value={val}
                                onChange={e => handleZipChange(field.name, e.target.value)}
                                required={field.is_required}
                                placeholder={field.placeholder || 'e.g. 90210'} className="input pr-8" />
                              {zipLoading && (
                                <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                                  <div className="animate-spin rounded-full h-4 w-4 border-b-2"
                                    style={{ borderColor: 'var(--color-primary-600)' }} />
                                </div>
                              )}
                              {!zipLoading && zipInfo && val.length === 5 && (
                                <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                                  {zipInfo.city}, {zipInfo.state}
                                </p>
                              )}
                            </div>
                          );
                        } else {
                          // Normalize on change so phone strips brackets/dashes, VIN
                          // uppercases + clips at 17, name strips digits, etc.
                          const type = field.field_type === 'phone' || field.field_type === 'tel' ? 'tel'
                            : field.field_type === 'zip' ? 'text' : field.field_type;
                          const ml = maxLengthFor(field);
                          const im = inputModeFor(field);
                          const normalizedOnChange = e => setField(field.name, normalizeField(field, e.target.value));
                          input = <input type={type} value={val} onChange={normalizedOnChange} required={field.is_required}
                            maxLength={ml} inputMode={im}
                            placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`} className="input" />;
                        }

                        return (
                          <div key={field.id} className={spanClass}>
                            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                              {field.label} {field.is_required && <span className="text-error-500">*</span>}
                            </label>
                            {input}
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* Closer selection — hidden in edit mode; reassignment goes
                  through the separate manager flow. */}
              {!isEdit && (
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                    Transfer to Closer <span className="text-error-500">*</span>
                  </label>
                  <select value={selectedCloser} onChange={e => setSelectedCloser(e.target.value)} className="input" required
                    style={{ color: colorFor(selectedCloser, 'var(--color-text)'), fontWeight: colorFor(selectedCloser) ? 600 : undefined }}>
                    <option value="" style={{ color: 'var(--color-text)', fontWeight: 400 }}>— Select a closer —</option>
                    {closers.map(c => (
                      <option key={c.id} value={c.id}
                        style={{ color: colorFor(c.id, 'var(--color-text)'), fontWeight: colorFor(c.id) ? 600 : 400 }}>
                        {c.first_name} {c.last_name}{c.company_name ? ` · ${c.company_name}` : ''}
                      </option>
                    ))}
                  </select>
                  {closers.length === 0 && (
                    <p className="text-xs mt-1" style={{ color: 'var(--color-warning-600)' }}>
                      No closers linked to this company yet.
                    </p>
                  )}
                </div>
              )}

              {/* Transfer Date — edit mode only. Writes the real created_at, so
                  the record actually moves to that day in every list/filter. */}
              {isEdit && (
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                    Transfer Date
                  </label>
                  <input type="date" value={transferDate} onChange={e => setTransferDate(e.target.value)}
                    className="input" />
                  {transferDate && transferDate !== origDate && (
                    <p className="text-xs mt-1" style={{ color: 'var(--color-warning-600)' }}>
                      Moves this transfer to {transferDate} everywhere (was {origDate || 'unknown'}).
                    </p>
                  )}
                </div>
              )}

              {/* Edit reason — appears only in edit mode; the backend audit
                  log records it as the reason on the transfer.edit_history entry. */}
              {isEdit && (
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                    Reason for edit {reasonRequired && <span className="text-error-500">*</span>}
                  </label>
                  <textarea value={editReason} onChange={e => setEditReason(e.target.value)} rows={2}
                    placeholder="What did you change and why? (visible in audit log)"
                    className="input resize-none" />
                </div>
              )}

              {error && <p className="text-sm text-error-600">{error}</p>}

              <div className="flex gap-3 pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
                <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
                <Button type="submit" variant="primary" loading={isLoading} disabled={isLoading}>
                  {isLoading ? 'Submitting…' : 'Transfer Lead'}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default TransferFormModal;
