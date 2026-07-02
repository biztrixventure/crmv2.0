/**
 * AssignedNumbersList — fronter view of assigned phone numbers.
 * Features: day filter, search, status quick-actions, Create Transfer button.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Phone, CheckCircle, RefreshCw, Clock, SkipForward, PhoneCall,
  RotateCcw, Filter, Search, X, Calendar, Send, ChevronDown,
  ChevronUp, Link2, ArrowRight, Copy, Check,
} from 'lucide-react';
import client from '../../api/client';

const STATUS_CONFIG = {
  new:       { label: 'New',       bg: '#eff6ff', color: '#2563eb', icon: Phone       },
  called:    { label: 'Called',    bg: '#fef3c7', color: '#d97706', icon: PhoneCall   },
  callback:  { label: 'Callback',  bg: '#f3e8ff', color: '#7c3aed', icon: Clock       },
  completed: { label: 'Done',      bg: '#d1fae5', color: '#059669', icon: CheckCircle },
  skip:      { label: 'Skip',      bg: '#f3f4f6', color: '#6b7280', icon: SkipForward },
  transferred: { label: 'Transferred', bg: '#ede9fe', color: '#7c3aed', icon: Link2 },
};

const StatusBadge = ({ status }) => {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.new;
  const Icon = cfg.icon;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold"
      style={{ backgroundColor: cfg.bg, color: cfg.color }}>
      <Icon size={10} />{cfg.label}
    </span>
  );
};

const todayISO = () => new Date().toISOString().slice(0, 10);

// ── Quick Transfer Modal ──────────────────────────────────────────────────────
const TransferModal = ({ number, onClose, onSuccess }) => {
  const [fields,     setFields]     = useState([]);
  const [closers,    setClosers]    = useState([]);
  const [formData,   setFormData]   = useState({});
  const [closerId,   setCloserId]   = useState('');
  const [loading,    setLoading]    = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [fieldsRes, closersRes] = await Promise.all([
          client.get('forms/fields').catch(() => ({ data: { fields: [] } })),
          client.get('transfers/closers', { params: { company_id: number.company_id } }).catch(() => ({ data: { closers: [] } })),
        ]);
        const allFields = fieldsRes.data.fields || fieldsRes.data || [];
        setFields(allFields.filter(f => f.show_to_fronter !== false).sort((a, b) => (a.order || 0) - (b.order || 0)));
        setClosers(closersRes.data.closers || []);

        // Pre-fill from mapped_data
        const pre = {};
        const md  = number.mapped_data || {};
        allFields.forEach(f => {
          if (md[f.name] !== undefined) pre[f.name] = md[f.name];
        });
        // Also try direct phone/name keys
        if (md.phone_number && !pre.phone_number) {
          const phoneField = allFields.find(f => f.field_type === 'phone' || /phone|tel|mobile/i.test(f.name));
          if (phoneField && !pre[phoneField.name]) pre[phoneField.name] = md.phone_number;
        }
        if (md.customer_name && !pre.customer_name) {
          const nameField = allFields.find(f => /name|customer|client/i.test(f.name));
          if (nameField && !pre[nameField.name]) pre[nameField.name] = md.customer_name;
        }
        setFormData(pre);
      } finally { setLoading(false); }
    };
    load();
  }, [number.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!closerId) { setError('Select a closer.'); return; }
    setSubmitting(true);
    try {
      const xferRes = await client.post('transfers', { form_data: formData, assigned_closer_id: closerId });
      const transferId = xferRes.data?.transfer?.id || xferRes.data?.id;
      // Link back to the source: number_lists get a transfer_id (→ 'completed');
      // batch items have no transfer link, so just mark them 'transferred'.
      if (number.source === 'batch') {
        await client.put(`distribution-batches/items/${number.id}`, { status: 'transferred' });
      } else if (transferId) {
        await client.put(`number-lists/${number.id}/transfer`, { transfer_id: transferId });
      }
      onSuccess(transferId, number.source);
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Failed to submit transfer');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="relative w-full max-w-xl my-8 rounded-2xl animate-scale-in"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 rounded-t-2xl"
          style={{ background: 'var(--gradient-sidebar)' }}>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl"><Send size={17} className="text-white" /></div>
            <div>
              <h3 className="text-sm font-bold text-white">Create Transfer</h3>
              <p className="text-xs text-white/70">{number.phone_number}{number.customer_name ? ` · ${number.customer_name}` : ''}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-xl bg-white/20 hover:bg-white/30 transition-colors">
            <X size={16} className="text-white" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5">
          {loading ? (
            <div className="flex justify-center py-10">
              <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-primary-600" />
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Fields */}
              {fields.length > 0 && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--color-text-secondary)' }}>
                    Customer Information
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {fields.map(field => {
                      const val = formData[field.name] || '';
                      const onChange = e => setFormData(p => ({ ...p, [field.name]: e.target.value }));
                      const isFilled = !!(formData[field.name]);
                      let input;
                      if (field.field_type === 'textarea') {
                        input = <textarea value={val} onChange={onChange} rows={2} required={field.is_required}
                          placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`} className="input resize-none text-sm" />;
                      } else if (field.field_type === 'select') {
                        input = (
                          <select value={val} onChange={onChange} required={field.is_required} className="input text-sm">
                            <option value="">Select {field.label}</option>
                            {(field.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        );
                      } else {
                        const type = field.field_type === 'phone' ? 'tel' : field.field_type === 'zip' ? 'text' : (field.field_type || 'text');
                        input = <input type={type} value={val} onChange={onChange} required={field.is_required}
                          placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`} className="input text-sm" />;
                      }
                      const spanClass = { 2: 'sm:col-span-2', 3: 'sm:col-span-2' }[field.column_span] || '';
                      return (
                        <div key={field.id} className={spanClass}>
                          <label className="block text-xs font-semibold mb-1 flex items-center gap-1.5"
                            style={{ color: 'var(--color-text-secondary)' }}>
                            {field.label}
                            {field.is_required && <span className="text-red-500">*</span>}
                            {isFilled && <span className="text-xs px-1.5 py-0.5 rounded font-bold" style={{ backgroundColor: '#d1fae5', color: '#059669' }}>Auto-filled</span>}
                          </label>
                          {input}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Closer select */}
              <div>
                <label className="block text-xs font-bold mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                  Transfer to Closer <span className="text-red-500">*</span>
                </label>
                <select value={closerId} onChange={e => setCloserId(e.target.value)} className="input" required>
                  <option value="">— Select a closer —</option>
                  {closers.map(c => (
                    <option key={c.id} value={c.id}>
                      {[c.first_name, c.last_name].filter(Boolean).join(' ') || c.role_name || 'Closer'}
                      {c.company_name ? ` — ${c.company_name}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={onClose}
                  className="px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
                  style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text)' }}>
                  Cancel
                </button>
                <button type="submit" disabled={submitting}
                  className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                  style={{ background: 'var(--gradient-sidebar)' }}>
                  {submitting ? <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> Submitting…</>
                             : <><Send size={14} /> Submit Transfer</>}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────
const AssignedNumbersList = ({ user }) => {
  const [numbers,      setNumbers]      = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [dayFilter,    setDayFilter]    = useState('');
  const [search,       setSearch]       = useState('');
  const [updatingId,   setUpdatingId]   = useState(null);
  const [transferNum,  setTransferNum]  = useState(null);
  const [expandedList, setExpandedList] = useState(null);
  const [copiedId,     setCopiedId]     = useState(null);
  const searchRef = useRef(null);

  const copyNumber = (e, num) => {
    e.stopPropagation();
    const digits = String(num || '').replace(/\D/g, '');
    navigator.clipboard?.writeText(digits).catch(() => {});
    setCopiedId(num);
    setTimeout(() => setCopiedId(c => (c === num ? null : c)), 1200);
  };

  // Same merged feed the PIP uses (number_lists + distribution_batch_items), so
  // #Numbers and the PIP show identical numbers and a status change on one
  // reflects on the other (they write to the same DB rows). Filtering is done
  // client-side below so both sources filter consistently.
  const fetchNumbers = useCallback(async () => {
    setLoading(true);
    try {
      const [listRows, batchRows] = await Promise.all([
        user?.company_id
          ? client.get('number-lists', { params: { company_id: user.company_id } }).then(r => (r.data.numbers || []).map(n => ({ ...n, source: 'list' }))).catch(() => [])
          : Promise.resolve([]),
        client.get('distribution-batches/my-numbers').then(r => (r.data.numbers || []).map(n => ({ ...n, source: 'batch' }))).catch(() => []),
      ]);
      setNumbers([...batchRows, ...listRows]);
    } catch { /* non-critical */ } finally { setLoading(false); }
  }, [user?.company_id]);

  useEffect(() => { fetchNumbers(); }, [fetchNumbers]);

  // Debounce search
  const searchTimeout = useRef(null);
  const handleSearch = (val) => {
    setSearch(val);
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {}, 0); // fetchNumbers via useEffect
  };

  // Route the status write to the item's own source (batch vs number_list) — the
  // exact same source-routing the PIP uses, so both stay in sync.
  const updateStatus = async (item, status) => {
    setUpdatingId(item.id);
    const url = item.source === 'batch' ? `distribution-batches/items/${item.id}` : `number-lists/${item.id}`;
    try {
      await client.put(url, { status });
      setNumbers(prev => prev.map(n => n.id === item.id ? { ...n, status } : n));
    } catch { /* non-critical */ } finally { setUpdatingId(null); }
  };

  const handleTransferSuccess = (transferId, source) => {
    if (transferNum) {
      setNumbers(prev => prev.map(n =>
        n.id === transferNum.id
          ? { ...n, status: source === 'batch' ? 'transferred' : 'completed', transfer_id: transferId, transferred_at: new Date().toISOString() }
          : n
      ));
      setTransferNum(null);
    }
  };

  // Client-side filters (applied uniformly to batch + list items). Day filter
  // only matches list items (batches have no assignment_day).
  const q = search.trim().toLowerCase();
  const visible = numbers.filter(n => {
    if (statusFilter !== 'all' && n.status !== statusFilter) return false;
    if (dayFilter && n.assignment_day !== dayFilter) return false;
    if (q && !(String(n.phone_number || '').includes(q) || String(n.customer_name || '').toLowerCase().includes(q))) return false;
    return true;
  });

  // Group by list_name (batch items carry their batch name as list_name).
  const grouped = {};
  visible.forEach(n => { const key = n.list_name || 'Unassigned'; if (!grouped[key]) grouped[key] = []; grouped[key].push(n); });

  const counts = {
    all:       numbers.length,
    new:       numbers.filter(n => n.status === 'new').length,
    called:    numbers.filter(n => n.status === 'called').length,
    callback:  numbers.filter(n => n.status === 'callback').length,
    completed: numbers.filter(n => n.status === 'completed').length,
    skip:      numbers.filter(n => n.status === 'skip').length,
    transferred: numbers.filter(n => n.status === 'transferred').length,
  };

  const transferredCount = numbers.filter(n => n.transfer_id).length;

  return (
    <div className="animate-fade-in">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-5">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <Phone size={22} style={{ color: 'var(--color-primary-600)' }} />
            My Numbers
            {counts.new > 0 && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: '#2563eb' }}>
                {counts.new} new
              </span>
            )}
          </h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            Phone numbers assigned to you. Create transfers directly from here.
          </p>
        </div>
        <button onClick={fetchNumbers} disabled={loading}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold transition-colors hover:bg-bg-secondary flex-shrink-0"
          style={{ color: 'var(--color-text-secondary)' }}>
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
          const Icon = cfg.icon;
          return (
            <div key={key}
              className="rounded-xl p-2.5 text-center cursor-pointer transition-all hover:scale-105"
              style={{
                backgroundColor: statusFilter === key ? cfg.bg : 'var(--color-surface)',
                border: `1px solid ${statusFilter === key ? cfg.color + '50' : 'var(--color-border)'}`,
              }}
              onClick={() => setStatusFilter(statusFilter === key ? 'all' : key)}>
              <Icon size={14} className="mx-auto mb-0.5" style={{ color: cfg.color }} />
              <p className="text-base font-bold leading-none" style={{ color: cfg.color }}>{counts[key]}</p>
              <p className="text-xs font-semibold mt-0.5" style={{ color: cfg.color }}>{cfg.label}</p>
            </div>
          );
        })}
      </div>

      {/* Transferred indicator */}
      {transferredCount > 0 && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-xl text-xs font-semibold"
          style={{ backgroundColor: '#d1fae5', color: '#059669', border: '1px solid #6ee7b7' }}>
          <Link2 size={12} />
          {transferredCount} number{transferredCount !== 1 ? 's' : ''} converted to transfers
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row gap-2 mb-5">
        {/* Status tabs */}
        <div className="flex gap-1 p-1 rounded-xl flex-wrap"
          style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          {[
            { key: 'all',       label: `All (${counts.all})`         },
            { key: 'new',       label: `New (${counts.new})`         },
            { key: 'called',    label: `Called (${counts.called})`   },
            { key: 'callback',  label: `Callback (${counts.callback})` },
            { key: 'completed', label: `Done (${counts.completed})`  },
          ].map(f => (
            <button key={f.key} onClick={() => setStatusFilter(f.key)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={{
                backgroundColor: statusFilter === f.key ? 'var(--color-surface)' : 'transparent',
                color:           statusFilter === f.key ? 'var(--color-primary-600)' : 'var(--color-text-secondary)',
                boxShadow:       statusFilter === f.key ? 'var(--shadow-sm)' : 'none',
              }}>
              {f.label}
            </button>
          ))}
        </div>

        {/* Day filter */}
        <div className="flex items-center gap-2">
          <Calendar size={14} style={{ color: 'var(--color-text-tertiary)' }} />
          <input type="date" value={dayFilter} onChange={e => setDayFilter(e.target.value)}
            className="input text-xs py-1.5" style={{ width: 155 }} />
          {dayFilter && (
            <button onClick={() => setDayFilter('')}
              className="p-1 rounded-lg hover:bg-bg-secondary transition-colors">
              <X size={12} style={{ color: 'var(--color-text-tertiary)' }} />
            </button>
          )}
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: 'var(--color-text-tertiary)' }} />
          <input ref={searchRef} type="text" value={search} onChange={e => handleSearch(e.target.value)}
            placeholder="Search phone or name…" className="input text-xs py-1.5 pl-8 pr-8 w-full" />
          {search && (
            <button onClick={() => handleSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-bg-secondary">
              <X size={12} style={{ color: 'var(--color-text-tertiary)' }} />
            </button>
          )}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16 rounded-2xl border border-dashed"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
          <Phone size={32} className="mx-auto mb-3" style={{ color: 'var(--color-text-tertiary)' }} />
          <p className="font-semibold" style={{ color: 'var(--color-text)' }}>No numbers found</p>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            {dayFilter || search || statusFilter !== 'all' ? 'Try adjusting your filters.' : 'Your manager will assign a phone number list to you.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([listName, items]) => {
            const isExpanded = expandedList === listName || Object.keys(grouped).length === 1;
            const doneCount  = items.filter(n => n.status === 'completed').length;
            const xferCount  = items.filter(n => n.transfer_id).length;

            return (
              <div key={listName} className="rounded-2xl border overflow-hidden"
                style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>

                {/* List header — clickable to collapse when multiple lists */}
                <div
                  className={`flex items-center justify-between px-5 py-3 ${Object.keys(grouped).length > 1 ? 'cursor-pointer hover:bg-bg-secondary' : ''} transition-colors`}
                  style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}
                  onClick={() => Object.keys(grouped).length > 1 && setExpandedList(isExpanded ? null : listName)}>
                  <div className="flex items-center gap-2 min-w-0">
                    {Object.keys(grouped).length > 1 && (
                      isExpanded ? <ChevronUp size={13} style={{ color: 'var(--color-text-tertiary)' }} />
                                 : <ChevronDown size={13} style={{ color: 'var(--color-text-tertiary)' }} />
                    )}
                    <Phone size={15} style={{ color: 'var(--color-primary-600)' }} />
                    <span className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>{listName}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                      style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>
                      {items.length}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-medium" style={{ color: '#2563eb' }}>
                        {items.filter(n => n.status === 'new').length} new
                      </span>
                      <span style={{ color: 'var(--color-text-tertiary)' }}>·</span>
                      <span className="font-medium" style={{ color: '#059669' }}>
                        {doneCount} done
                      </span>
                      {xferCount > 0 && (
                        <>
                          <span style={{ color: 'var(--color-text-tertiary)' }}>·</span>
                          <span className="flex items-center gap-1 font-medium" style={{ color: '#7c3aed' }}>
                            <Link2 size={10} /> {xferCount} transferred
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
                    {items.map(n => (
                      <div key={n.id} className="flex items-center justify-between px-4 py-3 group hover:bg-bg-secondary transition-colors gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {/* Tap the number to copy (paste into the dialer's manual-dial) */}
                            <button onClick={(e) => copyNumber(e, n.phone_number)} title="Click to copy"
                              className="font-mono font-semibold text-sm hover:underline" style={{ color: 'var(--color-text)' }}>
                              {n.phone_number}
                            </button>
                            {copiedId === n.phone_number
                              ? <span className="inline-flex items-center gap-0.5 text-[10px] font-bold" style={{ color: '#059669' }}><Check size={9} /> copied</span>
                              : <button onClick={(e) => copyNumber(e, n.phone_number)} title="Copy" className="p-1 rounded-lg hover:bg-bg-secondary transition-colors opacity-0 group-hover:opacity-100"><Copy size={11} style={{ color: 'var(--color-text-tertiary)' }} /></button>}
                            <StatusBadge status={n.status} />
                            {n.transfer_id && (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold px-1.5 py-0.5 rounded-full"
                                style={{ backgroundColor: '#d1fae5', color: '#059669' }}>
                                <Link2 size={9} /> Transferred
                              </span>
                            )}
                          </div>
                          {n.customer_name && (
                            <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                              {n.customer_name}
                            </p>
                          )}
                          {n.notes && (
                            <p className="text-xs italic mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                              {n.notes}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {updatingId === n.id ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-600" />
                          ) : (
                            <>
                              {/* Create Transfer button */}
                              {!n.transfer_id && n.status !== 'transferred' && (
                                <button
                                  onClick={() => setTransferNum(n)}
                                  title="Create Transfer"
                                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all hover:shadow-sm opacity-0 group-hover:opacity-100"
                                  style={{ backgroundColor: 'var(--color-primary-600)', color: '#fff' }}>
                                  <ArrowRight size={12} />
                                  Transfer
                                </button>
                              )}

                              {/* Status quick-actions */}
                              {n.status !== 'called' && n.status !== 'completed' && (
                                <button onClick={() => updateStatus(n,'called')} title="Mark as Called"
                                  className="p-1.5 rounded-lg transition-colors hover:bg-amber-100 opacity-0 group-hover:opacity-100">
                                  <PhoneCall size={13} style={{ color: '#d97706' }} />
                                </button>
                              )}
                              {n.status !== 'callback' && n.status !== 'completed' && (
                                <button onClick={() => updateStatus(n,'callback')} title="Mark as Callback"
                                  className="p-1.5 rounded-lg transition-colors hover:bg-purple-100 opacity-0 group-hover:opacity-100">
                                  <Clock size={13} style={{ color: '#7c3aed' }} />
                                </button>
                              )}
                              {n.status !== 'completed' && (
                                <button onClick={() => updateStatus(n,'completed')} title="Mark as Done"
                                  className="p-1.5 rounded-lg transition-colors hover:bg-emerald-100 opacity-0 group-hover:opacity-100">
                                  <CheckCircle size={13} style={{ color: '#059669' }} />
                                </button>
                              )}
                              {n.status !== 'skip' && n.status !== 'completed' && (
                                <button onClick={() => updateStatus(n,'skip')} title="Skip"
                                  className="p-1.5 rounded-lg transition-colors hover:bg-gray-100 opacity-0 group-hover:opacity-100">
                                  <SkipForward size={13} style={{ color: '#6b7280' }} />
                                </button>
                              )}
                              {n.status !== 'new' && n.status !== 'completed' && (
                                <button onClick={() => updateStatus(n,'new')} title="Reset to New"
                                  className="p-1.5 rounded-lg transition-colors hover:bg-blue-100 opacity-0 group-hover:opacity-100">
                                  <RotateCcw size={12} style={{ color: '#6b7280' }} />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Transfer Modal */}
      {transferNum && (
        <TransferModal
          number={transferNum}
          onClose={() => setTransferNum(null)}
          onSuccess={handleTransferSuccess}
        />
      )}
    </div>
  );
};

export default AssignedNumbersList;
