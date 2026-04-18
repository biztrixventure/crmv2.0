import { useState } from 'react';
import { Send, FileText } from 'lucide-react';
import { Button } from '../UI';

const TransferFormModal = ({
  isOpen, onClose,
  user, fields = [], fieldsLoading = false,
  closers = [], closersLoading = false,
  saleClients = [], salePlans = [],
  onSubmit, isLoading = false,
}) => {
  const [formData, setFormData]         = useState({});
  const [selectedCloser, setSelectedCloser] = useState('');
  const [error, setError]               = useState('');

  if (!isOpen) return null;

  const setField = (name, val) => setFormData(p => ({ ...p, [name]: val }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!selectedCloser) { setError('Please select a closer.'); return; }
    try {
      await onSubmit({ ...formData, assigned_closer_id: selectedCloser });
      setFormData({});
      setSelectedCloser('');
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
                        if (field.field_type === 'textarea') {
                          input = <textarea value={val} onChange={onChange} rows={3} required={field.is_required}
                            placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`} className="input resize-none" />;
                        } else if (field.field_type === 'select') {
                          input = (
                            <select value={val} onChange={onChange} required={field.is_required} className="input">
                              <option value="">Select {field.label}</option>
                              {(field.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
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
                        } else {
                          const type = field.field_type === 'phone' || field.field_type === 'tel' ? 'tel'
                            : field.field_type === 'zip' ? 'text' : field.field_type;
                          input = <input type={type} value={val} onChange={onChange} required={field.is_required}
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

              {/* Closer selection */}
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                  Transfer to Closer <span className="text-error-500">*</span>
                </label>
                <select value={selectedCloser} onChange={e => setSelectedCloser(e.target.value)} className="input" required>
                  <option value="">— Select a closer —</option>
                  {closers.map(c => (
                    <option key={c.id} value={c.id}>
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
