/**
 * NumberUploadManager — for Fronter Managers and Operations Managers.
 *
 * Flow:
 *  1. Upload CSV or XLSX file  → parsed client-side → preview table
 *  2. Map columns (phone, name) + set row range
 *  3. Choose fronter + list name
 *  4. Confirm → POST /api/number-lists/bulk
 *  5. View existing lists + delete batches
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Upload, Users, ListChecks, Trash2, ChevronDown, ChevronUp,
  Phone, X, CheckCircle, Plus, RefreshCw, FileText,
} from 'lucide-react';
import client from '../../api/client';

const STATUS_COLORS = {
  new:       { label: 'New',       bg: '#eff6ff', color: '#2563eb' },
  called:    { label: 'Called',    bg: '#fef3c7', color: '#d97706' },
  callback:  { label: 'Callback',  bg: '#f3e8ff', color: '#7c3aed' },
  completed: { label: 'Completed', bg: '#d1fae5', color: '#059669' },
  skip:      { label: 'Skip',      bg: '#f3f4f6', color: '#6b7280' },
};

// ── Pure-JS CSV parser (handles quoted fields, commas inside quotes) ──────────
const parseCSV = (text) => {
  const lines  = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  const result = [];
  for (const line of lines) {
    const row = [];
    let field = '';
    let inQ   = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { field += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === ',' && !inQ) {
        row.push(field.trim());
        field = '';
      } else {
        field += ch;
      }
    }
    row.push(field.trim());
    result.push(row);
  }
  return result;
};

// ── Parse XLSX using SheetJS (xlsx package must be installed) ─────────────────
const parseXLSX = async (file) => {
  try {
    const XLSX = await import('xlsx');
    const buf  = await file.arrayBuffer();
    const wb   = XLSX.read(buf, { type: 'array' });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    return rows.map(r => r.map(c => String(c ?? '').trim()));
  } catch {
    return null; // xlsx package not installed
  }
};

// ── NumberUploadManager ───────────────────────────────────────────────────────
const NumberUploadManager = ({ user, companyId: companyIdProp }) => {
  const fileInputRef  = useRef(null);
  const companyId     = companyIdProp || user?.company_id;

  // ── Upload / preview state ──
  const [step,        setStep]        = useState('idle'); // idle | preview | assigning | done
  const [rawRows,     setRawRows]     = useState([]);     // all parsed rows (including header)
  const [headers,     setHeaders]     = useState([]);     // column names
  const [phoneCol,    setPhoneCol]    = useState(0);
  const [nameCol,     setNameCol]     = useState(-1);     // -1 = none
  const [rangeFrom,   setRangeFrom]   = useState(1);      // data row start (0-based after header)
  const [rangeTo,     setRangeTo]     = useState(50);
  const [listName,    setListName]    = useState('');
  const [fronters,    setFronters]    = useState([]);
  const [selectedF,   setSelectedF]  = useState('');
  const [assigning,   setAssigning]  = useState(false);
  const [assignErr,   setAssignErr]  = useState('');
  const [parseErr,    setParseErr]   = useState('');

  // ── Existing lists state ──
  const [lists,       setLists]      = useState([]);
  const [listsLoad,   setListsLoad]  = useState(false);
  const [deleting,    setDeleting]   = useState(null);
  const [expandedList,setExpandedList] = useState(null);
  const [listNumbers, setListNumbers] = useState({});
  const [listSearch,  setListSearch]  = useState('');

  // ── Load fronters + existing lists ──
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
      const res = await client.get('number-lists/lists', { params: { company_id: companyId } });
      setLists(res.data.lists || []);
    } catch { /* non-critical */ } finally { setListsLoad(false); }
  }, [companyId]);

  useEffect(() => { loadFronters(); loadLists(); }, [loadFronters, loadLists]);

  // ── File handler ──
  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseErr('');
    setStep('idle');

    const ext = file.name.split('.').pop().toLowerCase();
    let rows = null;

    if (ext === 'csv' || ext === 'txt') {
      const text = await file.text();
      rows = parseCSV(text);
    } else if (ext === 'xlsx' || ext === 'xls') {
      rows = await parseXLSX(file);
      if (!rows) {
        setParseErr('XLSX parsing requires the xlsx package. Run: npm install xlsx   OR  save your file as CSV and upload again.');
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
    } else {
      setParseErr('Unsupported file type. Please upload a .csv or .xlsx file.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    if (!rows || rows.length < 2) {
      setParseErr('File appears empty or has only one row.');
      return;
    }

    const hdrs = rows[0];
    setHeaders(hdrs);
    setRawRows(rows);
    setRangeTo(Math.min(rows.length - 1, 100));
    setRangeFrom(1);

    // Auto-detect phone column
    const phoneIdx = hdrs.findIndex(h => /phone|mobile|tel|cell|number/i.test(h));
    setPhoneCol(phoneIdx >= 0 ? phoneIdx : 0);

    // Auto-detect name column
    const nameIdx = hdrs.findIndex(h => /name|customer|client|first/i.test(h));
    setNameCol(nameIdx >= 0 ? nameIdx : -1);

    setStep('preview');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── Selected data rows ──
  const dataRows = rawRows.slice(1); // without header row
  const selectedRows = dataRows.slice(rangeFrom - 1, rangeTo);

  // ── Assign ──
  const handleAssign = async () => {
    setAssignErr('');
    if (!selectedF)        return setAssignErr('Select a fronter.');
    if (!listName.trim())  return setAssignErr('Enter a list name.');
    if (!selectedRows.length) return setAssignErr('No rows in selected range.');

    const numbers = selectedRows
      .map(row => ({
        phone_number:  row[phoneCol]?.toString().trim(),
        customer_name: nameCol >= 0 ? row[nameCol]?.toString().trim() || null : null,
      }))
      .filter(n => n.phone_number);

    if (!numbers.length) return setAssignErr('No valid phone numbers found in selected range.');

    setAssigning(true);
    try {
      await client.post('number-lists/bulk', {
        company_id: companyId,
        fronter_id: selectedF,
        list_name:  listName.trim(),
        numbers,
      });
      setStep('done');
      loadLists();
    } catch (err) {
      setAssignErr(err.response?.data?.error || err.message);
    } finally { setAssigning(false); }
  };

  const handleReset = () => {
    setStep('idle');
    setRawRows([]);
    setHeaders([]);
    setListName('');
    setSelectedF('');
    setAssignErr('');
    setParseErr('');
  };

  // ── Expand list → load individual numbers ──
  const toggleList = async (name) => {
    if (expandedList === name) { setExpandedList(null); setListSearch(''); return; }
    setExpandedList(name);
    setListSearch('');
    if (listNumbers[name]) return;
    try {
      const res = await client.get('number-lists', { params: { company_id: companyId, list_name: name } });
      setListNumbers(prev => ({ ...prev, [name]: res.data.numbers || [] }));
    } catch { /* non-critical */ }
  };

  const handleDeleteList = async (name) => {
    if (!window.confirm(`Delete entire list "${name}"? This cannot be undone.`)) return;
    setDeleting(name);
    try {
      await client.delete('number-lists/batch', { data: { company_id: companyId, list_name: name } });
      setLists(prev => prev.filter(l => l.list_name !== name));
      setListNumbers(prev => { const n = {...prev}; delete n[name]; return n; });
    } catch { /* non-critical */ } finally { setDeleting(null); }
  };

  // ── Preview: visible rows for table ──
  const previewRows = selectedRows.slice(0, 8);

  return (
    <div className="animate-fade-in space-y-6">

      {/* ── Header ── */}
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
          <Phone size={22} style={{ color: 'var(--color-primary-600)' }} />
          Number Lists
        </h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          Upload a CSV or XLSX file, select a range, and assign phone numbers to your fronters.
        </p>
      </div>

      {/* ── Upload card ── */}
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
              Supports <strong>.csv</strong> and <strong>.xlsx</strong> files. First row should be column headers.
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
                File Preview
                <span className="ml-2 text-sm font-normal" style={{ color: 'var(--color-text-secondary)' }}>
                  {dataRows.length} data rows found
                </span>
              </h3>
              <button onClick={handleReset} className="p-2 rounded-lg hover:bg-bg-secondary transition-colors">
                <X size={16} style={{ color: 'var(--color-text-tertiary)' }} />
              </button>
            </div>

            {/* Column mapping */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-xl"
              style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
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
                  Customer Name Column (optional)
                </label>
                <select value={nameCol} onChange={e => setNameCol(+e.target.value)} className="input text-sm">
                  <option value={-1}>— None —</option>
                  {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </select>
              </div>
            </div>

            {/* Row range */}
            <div className="grid grid-cols-2 gap-3 p-4 rounded-xl"
              style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
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
                  To row <span className="font-normal" style={{ color: 'var(--color-text-secondary)' }}>
                    ({selectedRows.length} rows selected)
                  </span>
                </label>
                <input type="number" min={rangeFrom} max={dataRows.length}
                  value={rangeTo} onChange={e => setRangeTo(Math.min(dataRows.length, +e.target.value))}
                  className="input text-sm" />
              </div>
            </div>

            {/* Preview table */}
            <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--color-border)' }}>
              <div className="px-4 py-2 text-xs font-bold uppercase tracking-wide"
                style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>
                Preview (first 8 of {selectedRows.length} selected rows)
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ backgroundColor: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)' }}>
                      <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                        Phone Number
                      </th>
                      {nameCol >= 0 && (
                        <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                          Customer Name
                        </th>
                      )}
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Assign settings */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--color-text)' }}>
                  Assign to Fronter <span className="text-red-500">*</span>
                </label>
                <select value={selectedF} onChange={e => setSelectedF(e.target.value)} className="input text-sm">
                  <option value="">— Select fronter —</option>
                  {fronters.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                {fronters.length === 0 && (
                  <p className="text-xs text-warning-600 mt-1">No fronters found in your company.</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--color-text)' }}>
                  List Name <span className="text-red-500">*</span>
                </label>
                <input type="text" value={listName} onChange={e => setListName(e.target.value)}
                  className="input text-sm" placeholder="e.g. Cold List April Week 1" />
              </div>
            </div>

            {assignErr && (
              <p className="text-sm text-red-600">{assignErr}</p>
            )}

            <div className="flex gap-3 pt-2">
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
              The selected numbers have been assigned to the fronter.
            </p>
            <button onClick={handleReset}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white mx-auto"
              style={{ background: 'var(--gradient-sidebar)' }}>
              <Plus size={15} /> Upload Another List
            </button>
          </div>
        )}
      </div>

      {/* ── Existing Lists ── */}
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
            {lists.map(list => (
              <div key={list.list_name}>
                {/* List row */}
                <div
                  className="flex items-center justify-between px-5 py-3 hover:bg-bg-secondary transition-colors cursor-pointer group"
                  onClick={() => toggleList(list.list_name)}>
                  <div className="flex items-center gap-3 min-w-0">
                    {expandedList === list.list_name
                      ? <ChevronUp size={14} style={{ color: 'var(--color-text-tertiary)' }} />
                      : <ChevronDown size={14} style={{ color: 'var(--color-text-tertiary)' }} />
                    }
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-text)' }}>
                        {list.list_name}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Users size={11} style={{ color: 'var(--color-text-tertiary)' }} />
                        <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                          {list.fronter_name}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {/* Mini status breakdown */}
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
                      onClick={e => { e.stopPropagation(); handleDeleteList(list.list_name); }}
                      disabled={deleting === list.list_name}
                      className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-all hover:bg-red-100"
                      title="Delete list">
                      {deleting === list.list_name
                        ? <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-red-500" />
                        : <Trash2 size={13} style={{ color: '#ef4444' }} />
                      }
                    </button>
                  </div>
                </div>

                {/* Expanded: numbers with search */}
                {expandedList === list.list_name && (
                  <div className="px-4 pb-3 pt-1"
                    style={{ backgroundColor: 'var(--color-bg)' }}>
                    {listNumbers[list.list_name] ? (() => {
                      const q = listSearch.trim().toLowerCase();
                      const filtered = q
                        ? listNumbers[list.list_name].filter(n =>
                            n.phone_number?.toLowerCase().includes(q) ||
                            n.customer_name?.toLowerCase().includes(q)
                          )
                        : listNumbers[list.list_name];
                      const visible = filtered.slice(0, 20);
                      return (
                        <div className="space-y-2">
                          <input
                            type="text"
                            value={listSearch}
                            onChange={e => setListSearch(e.target.value)}
                            placeholder="Search phone or name…"
                            className="input text-xs w-full"
                            style={{ maxWidth: 280 }}
                          />
                          <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--color-border)' }}>
                            <table className="w-full text-xs">
                              <thead>
                                <tr style={{ backgroundColor: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)' }}>
                                  <th className="px-3 py-2 text-left font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Phone</th>
                                  <th className="px-3 py-2 text-left font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Name</th>
                                  <th className="px-3 py-2 text-left font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {visible.map(n => (
                                  <tr key={n.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                    <td className="px-3 py-2 font-mono" style={{ color: 'var(--color-text)' }}>{n.phone_number}</td>
                                    <td className="px-3 py-2" style={{ color: 'var(--color-text-secondary)' }}>{n.customer_name || '—'}</td>
                                    <td className="px-3 py-2">
                                      <span className="px-2 py-0.5 rounded-full text-xs font-bold"
                                        style={{
                                          backgroundColor: STATUS_COLORS[n.status]?.bg || '#f3f4f6',
                                          color: STATUS_COLORS[n.status]?.color || '#6b7280',
                                        }}>
                                        {STATUS_COLORS[n.status]?.label || n.status}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                                {visible.length === 0 && (
                                  <tr>
                                    <td colSpan={3} className="px-3 py-4 text-center" style={{ color: 'var(--color-text-secondary)' }}>
                                      No numbers match.
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                            {filtered.length > 20 && (
                              <p className="text-center py-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                                + {filtered.length - 20} more numbers
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
    </div>
  );
};

export default NumberUploadManager;
