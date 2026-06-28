/**
 * NumberUploadManager — Fronter Managers and Operations Managers.
 *
 * Flow:
 *  1. Upload CSV/XLSX → parse → preview
 *  2. Map columns: phone + customer name (required) + any transfer form fields
 *  3. Set row range + choose fronter + list name + assignment day
 *  4. Confirm → POST /api/number-lists/bulk (mapped_data stored per row)
 *  5. View / delete existing lists
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Upload, Users, ListChecks, Trash2, ChevronDown, ChevronUp,
  Phone, X, CheckCircle, Plus, RefreshCw, Calendar, Map,
  ArrowRight, Link2, Search, UserCog,
} from 'lucide-react';
import client from '../../api/client';

const STATUS_COLORS = {
  new:       { label: 'New',       bg: '#eff6ff', color: '#2563eb' },
  called:    { label: 'Called',    bg: '#fef3c7', color: '#d97706' },
  callback:  { label: 'Callback',  bg: '#f3e8ff', color: '#7c3aed' },
  completed: { label: 'Completed', bg: '#d1fae5', color: '#059669' },
  skip:      { label: 'Skip',      bg: '#f3f4f6', color: '#6b7280' },
};

const parseCSV = (text) => {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  return lines.map(line => {
    const row = []; let field = ''; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (inQ && line[i+1] === '"') { field += '"'; i++; } else inQ = !inQ; }
      else if (ch === ',' && !inQ) { row.push(field.trim()); field = ''; }
      else field += ch;
    }
    row.push(field.trim());
    return row;
  });
};

const parseXLSX = async (file) => {
  try {
    const XLSX = await import('xlsx');
    const buf  = await file.arrayBuffer();
    const wb   = XLSX.read(buf, { type: 'array' });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }).map(r => r.map(c => String(c ?? '').trim()));
  } catch { return null; }
};

const todayISO = () => new Date().toISOString().slice(0, 10);

// ── Reassign Modal — move a whole list to another fronter / day ───────────────
const ReassignModal = ({ list, fronters, companyId, onClose, onDone }) => {
  const [newF,   setNewF]   = useState(list.fronter_id || '');
  const [newDay, setNewDay] = useState(list.assignment_day || '');
  const [busy,   setBusy]   = useState(false);
  const [err,    setErr]    = useState('');
  const submit = async () => {
    const fChanged = newF !== (list.fronter_id || '');
    const dChanged = newDay !== (list.assignment_day || '');
    if (!fChanged && !dChanged) { setErr('Pick a different fronter or day.'); return; }
    setBusy(true); setErr('');
    try {
      const r = await client.put('number-lists/reassign', {
        company_id: companyId, list_name: list.list_name,
        fronter_id: list.fronter_id || undefined, assignment_day: list.assignment_day || undefined,
        new_fronter_id: fChanged ? newF : undefined,
        new_assignment_day: dChanged ? newDay : undefined,
      });
      onDone(r.data?.moved || 0);
    } catch (e) { setErr(e.response?.data?.error || 'Failed to reassign'); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border p-5" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }} onClick={e => e.stopPropagation()}>
        <h3 className="font-bold text-base mb-1" style={{ color: 'var(--color-text)' }}>Reassign “{list.list_name}”</h3>
        <p className="text-xs mb-4" style={{ color: 'var(--color-text-secondary)' }}>
          {list.total} numbers · currently {list.fronter_name || '—'}{list.assignment_day ? ` · ${list.assignment_day}` : ''}
        </p>
        <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>Move to fronter</label>
        <select value={newF} onChange={e => setNewF(e.target.value)} className="input text-sm w-full mb-3">
          {fronters.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>Change day (optional)</label>
        <input type="date" value={newDay} onChange={e => setNewDay(e.target.value)} className="input text-sm w-full mb-4" />
        {err && <p className="text-xs text-red-600 mb-2">{err}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-xl text-sm font-semibold" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text)' }}>Cancel</button>
          <button onClick={submit} disabled={busy} className="flex-1 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-50" style={{ background: 'var(--gradient-sidebar)' }}>{busy ? 'Moving…' : 'Reassign'}</button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
const NumberUploadManager = ({ user, companyId: companyIdProp }) => {
  const fileInputRef = useRef(null);
  const companyId    = companyIdProp || user?.company_id;

  // file state
  const [step,        setStep]        = useState('idle');
  const [rawRows,     setRawRows]     = useState([]);
  const [headers,     setHeaders]     = useState([]);
  const [phoneCol,    setPhoneCol]    = useState(0);
  const [nameCol,     setNameCol]     = useState(-1);
  // fieldMapping: { [field.name]: colIdx } for extra transfer fields
  const [fieldMapping,setFieldMapping] = useState({});
  const [showMapping, setShowMapping]  = useState(false);

  // assignment state
  const [rangeFrom,   setRangeFrom]   = useState(1);
  const [rangeTo,     setRangeTo]     = useState(50);
  const [listName,    setListName]    = useState('');
  const [assignDay,   setAssignDay]   = useState(todayISO());
  const [fronters,    setFronters]    = useState([]);
  const [selectedF,   setSelectedF]  = useState('');
  const [assigning,   setAssigning]  = useState(false);
  const [assignErr,   setAssignErr]  = useState('');
  const [parseErr,    setParseErr]   = useState('');

  // form fields (for mapping)
  const [formFields,  setFormFields]  = useState([]);

  // existing lists
  const [lists,        setLists]       = useState([]);
  const [listsLoad,    setListsLoad]   = useState(false);
  const [deleting,     setDeleting]    = useState(null);
  const [expandedList, setExpandedList] = useState(null);
  const [listNumbers,  setListNumbers]  = useState({});
  const [listSearch,   setListSearch]   = useState('');
  // List filters (managers couldn't sift big sets) — fronter/day/status server-
  // side, list-name search client-side.
  const [fFronter,   setFFronter]   = useState('');
  const [fDay,       setFDay]       = useState('');
  const [fStatus,    setFStatus]    = useState('');
  const [nameSearch, setNameSearch] = useState('');
  const [reassign,   setReassign]   = useState(null);   // the list being moved

  const loadFronters = useCallback(async () => {
    if (!companyId) return;
    try {
      const res = await client.get('number-lists/fronters', { params: { company_id: companyId } });
      setFronters(res.data.fronters || []);
    } catch { /* non-critical */ }
  }, [companyId]);

  const loadLists = useCallback(async () => {
    if (!companyId) return;
    setListsLoad(true);
    try {
      const params = { company_id: companyId };
      if (fFronter) params.fronter_id     = fFronter;
      if (fDay)     params.assignment_day = fDay;
      if (fStatus)  params.status         = fStatus;
      const res = await client.get('number-lists/lists', { params });
      setLists(res.data.lists || []);
    } catch { /* non-critical */ } finally { setListsLoad(false); }
  }, [companyId, fFronter, fDay, fStatus]);

  const loadFormFields = useCallback(async () => {
    try {
      const res = await client.get('forms/fields');
      const extras = (res.data.fields || []).filter(f =>
        !['phone', 'tel', 'mobile', 'name', 'customer_name', 'first_name', 'last_name'].some(k =>
          f.name?.toLowerCase().includes(k) || f.field_type === 'phone'
        )
      );
      setFormFields(extras);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => { loadFronters(); loadLists(); loadFormFields(); }, [loadFronters, loadLists, loadFormFields]);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseErr(''); setStep('idle');

    const ext = file.name.split('.').pop().toLowerCase();
    let rows = null;

    if (ext === 'csv' || ext === 'txt') {
      rows = parseCSV(await file.text());
    } else if (ext === 'xlsx' || ext === 'xls') {
      rows = await parseXLSX(file);
      if (!rows) {
        setParseErr('XLSX parsing requires the xlsx package. Run: npm install xlsx   OR  save as CSV.');
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
    } else {
      setParseErr('Unsupported file type. Please upload .csv or .xlsx.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    if (!rows || rows.length < 2) { setParseErr('File appears empty or has only one row.'); return; }

    const hdrs = rows[0];
    setHeaders(hdrs);
    setRawRows(rows);
    setRangeTo(Math.min(rows.length - 1, 100));
    setRangeFrom(1);
    setFieldMapping({});

    const phoneIdx = hdrs.findIndex(h => /phone|mobile|tel|cell|number/i.test(h));
    setPhoneCol(phoneIdx >= 0 ? phoneIdx : 0);
    const nameIdx  = hdrs.findIndex(h => /name|customer|client|first/i.test(h));
    setNameCol(nameIdx >= 0 ? nameIdx : -1);

    setStep('preview');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const dataRows     = rawRows.slice(1);
  const selectedRows = dataRows.slice(rangeFrom - 1, rangeTo);
  const previewRows  = selectedRows.slice(0, 6);

  const handleAssign = async () => {
    setAssignErr('');
    if (!selectedF)           return setAssignErr('Select a fronter.');
    if (!listName.trim())     return setAssignErr('Enter a list name.');
    if (!selectedRows.length) return setAssignErr('No rows in selected range.');

    const numbers = selectedRows
      .map(row => {
        const phone = row[phoneCol]?.toString().trim();
        if (!phone) return null;
        // Compute mapped_data for this row: all extra field mappings resolved to actual values
        const mapped_data = {};
        Object.entries(fieldMapping).forEach(([fieldName, colIdx]) => {
          if (colIdx >= 0 && colIdx < row.length) {
            const val = row[colIdx]?.toString().trim();
            if (val) mapped_data[fieldName] = val;
          }
        });
        // Also include customer_name from nameCol if mapped separately
        const customer_name = nameCol >= 0 ? row[nameCol]?.toString().trim() || null : null;
        if (customer_name) mapped_data['customer_name'] = customer_name;
        mapped_data['phone_number'] = phone;
        return { phone_number: phone, customer_name, mapped_data };
      })
      .filter(Boolean);

    if (!numbers.length) return setAssignErr('No valid phone numbers found in selected range.');

    setAssigning(true);
    try {
      await client.post('number-lists/bulk', {
        company_id:     companyId,
        fronter_id:     selectedF,
        list_name:      listName.trim(),
        assignment_day: assignDay || null,
        numbers,
      });
      setStep('done');
      loadLists();
    } catch (err) {
      setAssignErr(err.response?.data?.error || err.message);
    } finally { setAssigning(false); }
  };

  const handleReset = () => {
    setStep('idle'); setRawRows([]); setHeaders([]); setListName('');
    setSelectedF(''); setAssignErr(''); setParseErr(''); setFieldMapping({});
  };

  // A "list" is a UNIQUE assignment: list_name + fronter + day. Key every action
  // on that composite (list.key) so same-named lists for different fronters/days
  // stay separate — expanding/deleting one never touches another.
  const toggleList = async (list) => {
    const k = list.key;
    if (expandedList === k) { setExpandedList(null); setListSearch(''); return; }
    setExpandedList(k); setListSearch('');
    if (listNumbers[k]) return;
    try {
      const res = await client.get('number-lists', { params: {
        company_id: companyId, list_name: list.list_name,
        fronter_id: list.fronter_id || undefined, assignment_day: list.assignment_day || undefined,
      } });
      setListNumbers(prev => ({ ...prev, [k]: res.data.numbers || [] }));
    } catch { /* non-critical */ }
  };

  const handleDeleteList = async (list) => {
    const who = list.fronter_name ? ` (${list.fronter_name}${list.assignment_day ? ', ' + list.assignment_day : ''})` : '';
    if (!window.confirm(`Delete the list "${list.list_name}"${who}? This cannot be undone.`)) return;
    setDeleting(list.key);
    try {
      await client.delete('number-lists/batch', { data: {
        company_id: companyId, list_name: list.list_name,
        fronter_id: list.fronter_id || undefined, assignment_day: list.assignment_day || undefined,
      } });
      setLists(prev => prev.filter(l => l.key !== list.key));
      setListNumbers(prev => { const n = { ...prev }; delete n[list.key]; return n; });
    } catch { /* non-critical */ } finally { setDeleting(null); }
  };

  return (
    <div className="animate-fade-in space-y-6">

      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
          <Phone size={22} style={{ color: 'var(--color-primary-600)' }} />
          Number Lists
        </h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          Upload CSV / XLSX, map columns to transfer fields, and assign numbers to fronters by day.
        </p>
      </div>

      {/* Upload card */}
      <div className="rounded-2xl border p-6"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>

        {step === 'idle' && (
          <div className="text-center py-6">
            <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
              style={{ background: 'var(--gradient-sidebar)' }}>
              <Upload size={28} className="text-white" />
            </div>
            <h3 className="font-bold text-lg mb-1" style={{ color: 'var(--color-text)' }}>Upload Number List</h3>
            <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>
              Supports <strong>.csv</strong> and <strong>.xlsx</strong>. First row = column headers.
            </p>
            {parseErr && (
              <div className="mb-4 p-3 rounded-xl text-sm text-left"
                style={{ backgroundColor: '#fee2e2', color: '#dc2626', border: '1px solid #fca5a5' }}>
                {parseErr}
              </div>
            )}
            <label className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-white cursor-pointer transition-all hover:-translate-y-0.5"
              style={{ background: 'var(--gradient-sidebar)', boxShadow: 'var(--shadow-md)' }}>
              <Upload size={16} />
              Choose File
              <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.txt"
                onChange={handleFile} className="hidden" />
            </label>
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg" style={{ color: 'var(--color-text)' }}>
                Configure Assignment
                <span className="ml-2 text-sm font-normal" style={{ color: 'var(--color-text-secondary)' }}>
                  {dataRows.length} rows found
                </span>
              </h3>
              <button onClick={handleReset} className="p-2 rounded-lg hover:bg-bg-secondary transition-colors">
                <X size={16} style={{ color: 'var(--color-text-tertiary)' }} />
              </button>
            </div>

            {/* Section 1: Core column mapping */}
            <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--color-border)' }}>
              <div className="px-4 py-2.5 flex items-center gap-2"
                style={{ backgroundColor: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)' }}>
                <Phone size={14} style={{ color: 'var(--color-primary-600)' }} />
                <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>
                  Core Columns
                </span>
              </div>
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--color-text)' }}>
                    Phone Number Column <span className="text-red-500">*</span>
                  </label>
                  <select value={phoneCol} onChange={e => setPhoneCol(+e.target.value)} className="input text-sm">
                    {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--color-text)' }}>
                    Customer Name Column
                  </label>
                  <select value={nameCol} onChange={e => setNameCol(+e.target.value)} className="input text-sm">
                    <option value={-1}>— None —</option>
                    {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Section 2: Transfer field mapping (collapsible) */}
            {formFields.length > 0 && (
              <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--color-border)' }}>
                <button
                  onClick={() => setShowMapping(v => !v)}
                  className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-bg-secondary transition-colors"
                  style={{ backgroundColor: 'var(--color-bg-secondary)', borderBottom: showMapping ? '1px solid var(--color-border)' : 'none' }}>
                  <div className="flex items-center gap-2">
                    <Map size={14} style={{ color: '#7c3aed' }} />
                    <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>
                      Transfer Field Mapping
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                      style={{ backgroundColor: '#ede9fe', color: '#7c3aed' }}>
                      {Object.values(fieldMapping).filter(v => v >= 0).length} mapped
                    </span>
                  </div>
                  {showMapping ? <ChevronUp size={14} style={{ color: 'var(--color-text-tertiary)' }} />
                               : <ChevronDown size={14} style={{ color: 'var(--color-text-tertiary)' }} />}
                </button>
                {showMapping && (
                  <div className="p-4">
                    <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary)' }}>
                      Map CSV columns to transfer form fields. When a fronter creates a transfer from a number, these fields will be pre-filled automatically.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {formFields.map(field => (
                        <div key={field.id || field.name}>
                          <label className="block text-xs font-bold mb-1" style={{ color: 'var(--color-text)' }}>
                            {field.label}
                            <span className="ml-1 font-normal" style={{ color: 'var(--color-text-tertiary)' }}>
                              → CSV column
                            </span>
                          </label>
                          <select
                            value={fieldMapping[field.name] ?? -1}
                            onChange={e => setFieldMapping(prev => ({ ...prev, [field.name]: +e.target.value }))}
                            className="input text-sm">
                            <option value={-1}>— None (manual entry) —</option>
                            {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Section 3: Row range */}
            <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--color-border)' }}>
              <div className="px-4 py-2.5"
                style={{ backgroundColor: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)' }}>
                <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>
                  Row Range
                </span>
              </div>
              <div className="p-4 grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--color-text)' }}>
                    From row
                  </label>
                  <input type="number" min={1} max={dataRows.length}
                    value={rangeFrom} onChange={e => setRangeFrom(Math.max(1, +e.target.value))}
                    className="input text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--color-text)' }}>
                    To row
                    <span className="ml-1 font-normal" style={{ color: 'var(--color-text-secondary)' }}>
                      ({selectedRows.length} selected)
                    </span>
                  </label>
                  <input type="number" min={rangeFrom} max={dataRows.length}
                    value={rangeTo} onChange={e => setRangeTo(Math.min(dataRows.length, +e.target.value))}
                    className="input text-sm" />
                </div>
              </div>
            </div>

            {/* Preview table */}
            <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--color-border)' }}>
              <div className="px-4 py-2 text-xs font-bold uppercase tracking-wide"
                style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>
                Preview — first {Math.min(6, selectedRows.length)} of {selectedRows.length} selected rows
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ backgroundColor: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)' }}>
                      <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Phone</th>
                      {nameCol >= 0 && <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Name</th>}
                      {Object.entries(fieldMapping).filter(([, v]) => v >= 0).map(([fname]) => {
                        const f = formFields.find(ff => ff.name === fname);
                        return <th key={fname} className="px-3 py-2 text-left text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{f?.label || fname}</th>;
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td className="px-3 py-2 font-mono text-xs" style={{ color: 'var(--color-text)' }}>
                          {row[phoneCol] || <span className="text-red-400">—</span>}
                        </td>
                        {nameCol >= 0 && (
                          <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-text)' }}>
                            {row[nameCol] || '—'}
                          </td>
                        )}
                        {Object.entries(fieldMapping).filter(([, v]) => v >= 0).map(([fname, colIdx]) => (
                          <td key={fname} className="px-3 py-2 text-xs" style={{ color: 'var(--color-text)' }}>
                            {row[colIdx] || '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Assignment settings */}
            <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--color-border)' }}>
              <div className="px-4 py-2.5"
                style={{ backgroundColor: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)' }}>
                <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>
                  Assignment Details
                </span>
              </div>
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--color-text)' }}>
                    Assign to Fronter <span className="text-red-500">*</span>
                  </label>
                  <select value={selectedF} onChange={e => setSelectedF(e.target.value)} className="input text-sm">
                    <option value="">— Select fronter —</option>
                    {fronters.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                  {fronters.length === 0 && (
                    <p className="text-xs mt-1" style={{ color: '#d97706' }}>No fronters found in your company.</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--color-text)' }}>
                    List Name <span className="text-red-500">*</span>
                  </label>
                  <input type="text" value={listName} onChange={e => setListName(e.target.value)}
                    className="input text-sm" placeholder="e.g. Cold List April Week 1" />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
                    <Calendar size={12} />
                    Assignment Day
                  </label>
                  <input type="date" value={assignDay} onChange={e => setAssignDay(e.target.value)}
                    className="input text-sm" />
                </div>
              </div>
            </div>

            {assignErr && <p className="text-sm text-red-600">{assignErr}</p>}

            <div className="flex gap-3 pt-1">
              <button onClick={handleReset}
                className="px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
                style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text)' }}>
                Cancel
              </button>
              <button onClick={handleAssign} disabled={assigning}
                className="flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5 disabled:opacity-50"
                style={{ background: 'var(--gradient-sidebar)', boxShadow: 'var(--shadow-md)' }}>
                {assigning
                  ? <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> Assigning…</>
                  : <><Users size={15} /> Assign {selectedRows.length} Numbers</>
                }
              </button>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="text-center py-8">
            <div className="w-14 h-14 rounded-full mx-auto mb-3 flex items-center justify-center"
              style={{ backgroundColor: '#d1fae5' }}>
              <CheckCircle size={28} style={{ color: '#059669' }} />
            </div>
            <h3 className="font-bold text-lg mb-1" style={{ color: 'var(--color-text)' }}>Numbers Assigned!</h3>
            <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>
              Numbers assigned with transfer data pre-mapped.
            </p>
            <button onClick={handleReset}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white mx-auto"
              style={{ background: 'var(--gradient-sidebar)' }}>
              <Plus size={15} /> Upload Another List
            </button>
          </div>
        )}
      </div>

      {/* Existing Lists */}
      <div className="rounded-2xl border overflow-hidden"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <div className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
          <div className="flex items-center gap-2">
            <ListChecks size={17} style={{ color: 'var(--color-primary-600)' }} />
            <h3 className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>Assigned Lists</h3>
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
              style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>
              {lists.length}
            </span>
          </div>
          <button onClick={loadLists} disabled={listsLoad}
            className="p-1.5 rounded-lg hover:bg-bg transition-colors">
            <RefreshCw size={14} className={listsLoad ? 'animate-spin' : ''}
              style={{ color: 'var(--color-text-tertiary)' }} />
          </button>
        </div>

        {/* Filters — fronter/day/status (server) + list-name search (client) */}
        <div className="flex flex-wrap items-center gap-2 px-5 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <select value={fFronter} onChange={e => setFFronter(e.target.value)} className="input text-xs py-1.5" style={{ minWidth: 150 }}>
            <option value="">All fronters</option>
            {fronters.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <input type="date" value={fDay} onChange={e => setFDay(e.target.value)} className="input text-xs py-1.5" style={{ width: 150 }} />
          <select value={fStatus} onChange={e => setFStatus(e.target.value)} className="input text-xs py-1.5" style={{ minWidth: 120 }}>
            <option value="">Any status</option>
            <option value="new">New</option><option value="called">Called</option>
            <option value="callback">Callback</option><option value="completed">Done</option><option value="skip">Skip</option>
          </select>
          <div className="relative flex-1 min-w-[160px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
            <input value={nameSearch} onChange={e => setNameSearch(e.target.value)} placeholder="Search list name…" className="input text-xs py-1.5 pl-7 w-full" />
          </div>
          {(fFronter || fDay || fStatus || nameSearch) && (
            <button onClick={() => { setFFronter(''); setFDay(''); setFStatus(''); setNameSearch(''); }}
              className="text-xs font-semibold px-2 py-1.5 rounded-lg hover:bg-bg-secondary" style={{ color: 'var(--color-text-secondary)' }}>Clear</button>
          )}
        </div>

        {listsLoad ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-600" />
          </div>
        ) : lists.length === 0 ? (
          <p className="text-center py-8 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            No lists assigned yet. Upload a file to get started.
          </p>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
            {lists
              .filter(list => !nameSearch.trim() || (list.list_name || '').toLowerCase().includes(nameSearch.trim().toLowerCase()))
              .map(list => (
              <div key={list.key}>
                <div
                  className="flex items-center justify-between px-5 py-3 hover:bg-bg-secondary transition-colors cursor-pointer group"
                  onClick={() => toggleList(list)}>
                  <div className="flex items-center gap-3 min-w-0">
                    {expandedList === list.key
                      ? <ChevronUp size={14} style={{ color: 'var(--color-text-tertiary)' }} />
                      : <ChevronDown size={14} style={{ color: 'var(--color-text-tertiary)' }} />
                    }
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-text)' }}>
                        {list.list_name}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                          {list.fronter_name}
                        </span>
                        {list.assignment_day && (
                          <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                            <Calendar size={10} />
                            {new Date(list.assignment_day + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="hidden sm:flex items-center gap-2">
                      <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                        style={{ backgroundColor: '#eff6ff', color: '#2563eb' }}>
                        {list.total} total
                      </span>
                      {list.new > 0 && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                          style={{ backgroundColor: '#eff6ff', color: '#2563eb' }}>
                          {list.new} new
                        </span>
                      )}
                      {list.completed > 0 && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                          style={{ backgroundColor: '#d1fae5', color: '#059669' }}>
                          {list.completed} done
                        </span>
                      )}
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); setReassign(list); }}
                      className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-all hover:bg-bg-secondary"
                      title="Reassign to another fronter / day">
                      <UserCog size={13} style={{ color: 'var(--color-primary-600)' }} />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); handleDeleteList(list); }}
                      disabled={deleting === list.key}
                      className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-all hover:bg-red-100"
                      title="Delete list">
                      {deleting === list.key
                        ? <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-red-500" />
                        : <Trash2 size={13} style={{ color: '#ef4444' }} />
                      }
                    </button>
                  </div>
                </div>

                {expandedList === list.key && (
                  <div className="px-4 pb-3 pt-1" style={{ backgroundColor: 'var(--color-bg)' }}>
                    {listNumbers[list.key] ? (() => {
                      const q = listSearch.trim().toLowerCase();
                      const filtered = q
                        ? listNumbers[list.key].filter(n =>
                            n.phone_number?.toLowerCase().includes(q) ||
                            n.customer_name?.toLowerCase().includes(q))
                        : listNumbers[list.key];
                      const visible = filtered.slice(0, 25);
                      return (
                        <div className="space-y-2">
                          <input type="text" value={listSearch} onChange={e => setListSearch(e.target.value)}
                            placeholder="Search phone or name…" className="input text-xs w-full"
                            style={{ maxWidth: 280 }} />
                          <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--color-border)' }}>
                            <table className="w-full text-xs">
                              <thead>
                                <tr style={{ backgroundColor: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)' }}>
                                  <th className="px-3 py-2 text-left font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Phone</th>
                                  <th className="px-3 py-2 text-left font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Name</th>
                                  <th className="px-3 py-2 text-left font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Status</th>
                                  <th className="px-3 py-2 text-left font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Transfer</th>
                                </tr>
                              </thead>
                              <tbody>
                                {visible.map(n => (
                                  <tr key={n.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                    <td className="px-3 py-2 font-mono" style={{ color: 'var(--color-text)' }}>{n.phone_number}</td>
                                    <td className="px-3 py-2" style={{ color: 'var(--color-text-secondary)' }}>{n.customer_name || '—'}</td>
                                    <td className="px-3 py-2">
                                      <span className="px-2 py-0.5 rounded-full text-xs font-bold"
                                        style={{ backgroundColor: STATUS_COLORS[n.status]?.bg || '#f3f4f6', color: STATUS_COLORS[n.status]?.color || '#6b7280' }}>
                                        {STATUS_COLORS[n.status]?.label || n.status}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2">
                                      {n.transfer_id
                                        ? <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: '#059669' }}><Link2 size={10} /> Transferred</span>
                                        : <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>—</span>}
                                    </td>
                                  </tr>
                                ))}
                                {visible.length === 0 && (
                                  <tr><td colSpan={4} className="px-3 py-4 text-center" style={{ color: 'var(--color-text-secondary)' }}>No numbers match.</td></tr>
                                )}
                              </tbody>
                            </table>
                            {filtered.length > 25 && (
                              <p className="text-center py-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                                + {filtered.length - 25} more numbers
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })() : (
                      <div className="flex justify-center py-4">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-600" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {reassign && (
        <ReassignModal
          list={reassign}
          fronters={fronters}
          companyId={companyId}
          onClose={() => setReassign(null)}
          onDone={() => { setReassign(null); loadLists(); }}
        />
      )}
    </div>
  );
};

export default NumberUploadManager;
