import { useState, useRef, useEffect } from 'react';
import {
  Upload, FileText, CheckCircle2, XCircle, Download,
  AlertTriangle, Users, ChevronRight, ArrowLeft,
} from 'lucide-react';
import Modal from '../../UI/Modal';
import Button from '../../UI/Button';
import client from '../../../api/client';

// ── constants ─────────────────────────────────────────────────────────────────
const REQUIRED_COLS = ['first_name', 'last_name', 'email', 'password'];
const EMAIL_RE      = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ROWS      = 200;

const LEVEL_COLORS = {
  fronter:            { bg: '#10b981', light: 'rgba(16,185,129,0.1)',  label: 'Fronter'      },
  fronter_manager:    { bg: '#f59e0b', light: 'rgba(245,158,11,0.1)',  label: 'Fronter Mgr'  },
  closer:             { bg: '#6366f1', light: 'rgba(99,102,241,0.1)',  label: 'Closer'       },
  closer_manager:     { bg: '#8b5cf6', light: 'rgba(139,92,246,0.1)', label: 'Closer Mgr'   },
  operations_manager: { bg: '#3b82f6', light: 'rgba(59,130,246,0.1)', label: 'Ops Manager'  },
  compliance_manager: { bg: '#f97316', light: 'rgba(249,115,22,0.1)', label: 'Compliance'   },
  company_admin:      { bg: '#ef4444', light: 'rgba(239,68,68,0.1)',  label: 'Co. Admin'    },
};

// ── CSV helpers ───────────────────────────────────────────────────────────────
const parseCSVLine = (line) => {
  const result = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      result.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
};

const strip = (s) => (s || '').trim().replace(/^["']|["']$/g, '');

const validateRow = (row) => {
  const errors = [];
  if (!row.first_name) errors.push('first_name required');
  if (!row.last_name)  errors.push('last_name required');
  if (!row.email)            errors.push('email required');
  else if (!EMAIL_RE.test(row.email)) errors.push('invalid email format');
  if (!row.password)         errors.push('password required');
  else if (row.password.length < 8)  errors.push('password min 8 chars');
  return errors;
};

const parseCSV = (text) => {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return { error: 'CSV must have a header row and at least one data row' };

  const headers = parseCSVLine(lines[0]).map(h => strip(h).toLowerCase());
  const missing = REQUIRED_COLS.filter(r => !headers.includes(r));
  if (missing.length > 0) return { error: `Missing required columns: ${missing.join(', ')}` };

  if (lines.length - 1 > MAX_ROWS) return { error: `Maximum ${MAX_ROWS} rows per upload` };

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => { row[h] = strip(vals[idx]); });
    row._errors = validateRow(row);
    rows.push(row);
  }
  return { rows };
};

const downloadTemplate = () => {
  const csv = [
    'first_name,last_name,email,password',
    'John,Doe,john.doe@company.com,SecurePass1!',
    'Jane,Smith,jane.smith@company.com,SecurePass2!',
  ].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  Object.assign(document.createElement('a'), { href: url, download: 'bulk_upload_template.csv' }).click();
  URL.revokeObjectURL(url);
};

// ── sub-components ────────────────────────────────────────────────────────────
const StepDots = ({ step }) => {
  const steps = ['upload', 'role', 'done'];
  const idx   = steps.indexOf(step === 'uploading' ? 'role' : step);
  return (
    <div className="flex items-center justify-center gap-2 mb-5">
      {steps.map((s, i) => (
        <div key={s} className="w-2 h-2 rounded-full transition-all"
          style={{ backgroundColor: i <= idx ? 'var(--color-primary-500)' : 'var(--color-border)' }} />
      ))}
    </div>
  );
};

const RowTable = ({ rows }) => (
  <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--color-border)' }}>
    <div className="overflow-auto max-h-52">
      <table className="w-full text-xs">
        <thead>
          <tr style={{ background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)' }}>
            {['#', 'First', 'Last', 'Email', 'Password', 'Status'].map(h => (
              <th key={h} className="px-2.5 py-2 text-left font-bold uppercase"
                style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const ok = r._errors.length === 0;
            return (
              <tr key={i} style={{
                borderBottom: '1px solid var(--color-border)',
                backgroundColor: ok ? 'transparent' : 'rgba(239,68,68,0.04)',
              }}>
                <td className="px-2.5 py-1.5 font-mono" style={{ color: 'var(--color-text-tertiary)' }}>{i + 1}</td>
                <td className="px-2.5 py-1.5" style={{ color: 'var(--color-text)' }}>{r.first_name || <span className="opacity-40 italic">—</span>}</td>
                <td className="px-2.5 py-1.5" style={{ color: 'var(--color-text)' }}>{r.last_name  || <span className="opacity-40 italic">—</span>}</td>
                <td className="px-2.5 py-1.5 max-w-36 truncate" style={{ color: 'var(--color-text)' }}>{r.email || <span className="opacity-40 italic">—</span>}</td>
                <td className="px-2.5 py-1.5 font-mono" style={{ color: 'var(--color-text-tertiary)' }}>
                  {r.password ? '●'.repeat(Math.min(r.password.length, 10)) : <span className="opacity-40 italic">—</span>}
                </td>
                <td className="px-2.5 py-1.5">
                  {ok
                    ? <CheckCircle2 size={14} className="text-success-500" />
                    : (
                      <span className="flex items-start gap-1" style={{ color: '#dc2626' }}>
                        <XCircle size={13} className="flex-shrink-0 mt-px" />
                        <span>{r._errors[0]}{r._errors.length > 1 ? ` +${r._errors.length - 1}` : ''}</span>
                      </span>
                    )
                  }
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  </div>
);

// ── main modal ────────────────────────────────────────────────────────────────
const BulkUploadModal = ({ isOpen, onClose, companyId, onDone }) => {
  const [step,        setStep]        = useState('upload');
  const [rows,        setRows]        = useState([]);
  const [parseError,  setParseError]  = useState('');
  const [roles,       setRoles]       = useState([]);
  const [rolesLoading,setRolesLoading]= useState(false);
  const [roleId,      setRoleId]      = useState('');
  const [dragOver,    setDragOver]    = useState(false);
  const [results,     setResults]     = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!isOpen || !companyId) return;
    setRolesLoading(true);
    client.get('roles', { params: { company_id: companyId, for_assignment: true } })
      .then(r => setRoles(r.data.roles || []))
      .catch(() => setRoles([]))
      .finally(() => setRolesLoading(false));
  }, [isOpen, companyId]);

  const reset = () => {
    setStep('upload'); setRows([]); setParseError('');
    setRoleId(''); setResults(null); setDragOver(false);
    if (fileRef.current) fileRef.current.value = '';
  };
  const handleClose = () => { reset(); onClose(); };

  const processFile = (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setParseError('Please select a .csv file'); setRows([]); return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const { rows: parsed, error } = parseCSV(e.target.result);
      if (error) { setParseError(error); setRows([]); return; }
      setParseError('');
      setRows(parsed);
    };
    reader.readAsText(file);
  };

  const handleDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    processFile(e.dataTransfer.files?.[0]);
  };

  const handleSubmit = async () => {
    const valid = rows.filter(r => r._errors.length === 0);
    setStep('uploading');
    try {
      const res = await client.post('users/bulk', {
        users:      valid.map(({ _errors, ...u }) => u),
        role_id:    roleId,
        company_id: companyId,
      });
      setResults(res.data);
      if (res.data.succeeded > 0) onDone?.();
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Upload failed';
      setResults({ succeeded: 0, failed: valid.length, results: [{ email: '(all)', success: false, error: msg }] });
    }
    setStep('done');
  };

  const validRows   = rows.filter(r => r._errors.length === 0);
  const invalidRows = rows.filter(r => r._errors.length > 0);

  // ── Step 1: Upload & Preview ─────────────────────────────────────────────
  const renderUpload = () => (
    <div className="space-y-4">
      <StepDots step="upload" />

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        className="rounded-2xl border-2 border-dashed transition-all cursor-pointer flex flex-col items-center justify-center gap-3 py-8 px-4"
        style={{
          borderColor:     dragOver ? 'var(--color-primary-500)' : 'var(--color-border)',
          backgroundColor: dragOver ? 'var(--color-primary-50)'  : 'var(--color-bg-secondary)',
        }}
      >
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
          style={{ background: 'var(--gradient-sidebar)', opacity: dragOver ? 1 : 0.8 }}>
          <Upload size={22} className="text-white" />
        </div>
        <div className="text-center">
          <p className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>
            {dragOver ? 'Drop it here' : 'Drop CSV file here'}
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            or click to browse · max {MAX_ROWS} rows
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-1.5 mt-1">
          {REQUIRED_COLS.map(c => (
            <code key={c} className="px-2 py-0.5 rounded text-xs font-mono"
              style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-primary-600)' }}>
              {c}
            </code>
          ))}
        </div>
        <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => processFile(e.target.files?.[0])} />
      </div>

      {/* Template download */}
      <button type="button" onClick={(e) => { e.stopPropagation(); downloadTemplate(); }}
        className="flex items-center gap-1.5 text-xs font-semibold mx-auto transition-colors"
        style={{ color: 'var(--color-primary-600)' }}>
        <Download size={13} /> Download CSV template
      </button>

      {/* Parse error */}
      {parseError && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-sm"
          style={{ backgroundColor: 'rgba(239,68,68,0.08)', color: '#dc2626', border: '1px solid rgba(239,68,68,0.2)' }}>
          <AlertTriangle size={15} className="flex-shrink-0 mt-px" />
          {parseError}
        </div>
      )}

      {/* Preview table */}
      {rows.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                {rows.length} row{rows.length !== 1 ? 's' : ''}
              </span>
              {validRows.length > 0 && (
                <span className="flex items-center gap-1 text-xs font-semibold text-success-600">
                  <CheckCircle2 size={12} /> {validRows.length} valid
                </span>
              )}
              {invalidRows.length > 0 && (
                <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: '#dc2626' }}>
                  <XCircle size={12} /> {invalidRows.length} with errors
                </span>
              )}
            </div>
            {invalidRows.length > 0 && validRows.length > 0 && (
              <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                Errors will be skipped
              </span>
            )}
          </div>
          <RowTable rows={rows} />
        </div>
      )}

      <div className="flex gap-3 pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
        <Button type="button" variant="secondary" onClick={handleClose}>Cancel</Button>
        <Button
          type="button" variant="primary"
          disabled={validRows.length === 0}
          onClick={() => setStep('role')}
          className="flex-1 flex items-center justify-center gap-2"
        >
          Continue with {validRows.length} user{validRows.length !== 1 ? 's' : ''}
          <ChevronRight size={15} />
        </Button>
      </div>
    </div>
  );

  // ── Step 2: Role Selection ───────────────────────────────────────────────
  const renderRole = () => {
    const selectedRole = roles.find(r => r.id === roleId);
    return (
      <div className="space-y-4">
        <StepDots step="role" />

        {/* Summary pill */}
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
          style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--gradient-sidebar)' }}>
            <Users size={16} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>
              {validRows.length} user{validRows.length !== 1 ? 's' : ''} ready to import
            </p>
            {invalidRows.length > 0 && (
              <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                {invalidRows.length} row{invalidRows.length !== 1 ? 's' : ''} with errors will be skipped
              </p>
            )}
          </div>
        </div>

        {/* Role picker */}
        <div>
          <label className="block text-xs font-bold mb-2 uppercase tracking-wide"
            style={{ color: 'var(--color-text-secondary)' }}>
            Assign role to all users <span style={{ color: 'var(--color-error-500)' }}>*</span>
          </label>
          {rolesLoading ? (
            <div className="flex justify-center py-4">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-600" />
            </div>
          ) : roles.length === 0 ? (
            <div className="rounded-xl p-4 text-center text-sm"
              style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
              No roles found for this company. Create roles first.
            </div>
          ) : (
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-0.5">
              {roles.map(r => {
                const color   = LEVEL_COLORS[r.level] || { bg: '#6366f1', light: 'rgba(99,102,241,0.1)', label: r.level };
                const selected = roleId === r.id;
                return (
                  <button key={r.id} type="button" onClick={() => setRoleId(r.id)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all"
                    style={{
                      border: `2px solid ${selected ? color.bg : 'var(--color-border)'}`,
                      backgroundColor: selected ? color.light : 'var(--color-surface)',
                    }}>
                    <div className="w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 flex items-center justify-center"
                      style={{ borderColor: selected ? color.bg : 'var(--color-border)' }}>
                      {selected && <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color.bg }} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>{r.name}</span>
                      {r.description && (
                        <p className="text-xs truncate mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{r.description}</p>
                      )}
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold flex-shrink-0"
                      style={{ backgroundColor: color.light, color: color.bg }}>
                      {color.label}
                    </span>
                    <span className="text-xs flex-shrink-0" style={{ color: selected ? color.bg : 'var(--color-text-tertiary)' }}>
                      {r.permissions?.length ?? 0}p
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {selectedRole && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold"
            style={{
              backgroundColor: (LEVEL_COLORS[selectedRole.level]?.light || 'var(--color-primary-50)'),
              color:           (LEVEL_COLORS[selectedRole.level]?.bg    || 'var(--color-primary-600)'),
            }}>
            <CheckCircle2 size={13} />
            All {validRows.length} users will receive the "{selectedRole.name}" role
          </div>
        )}

        <div className="flex gap-3 pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
          <Button type="button" variant="secondary" onClick={() => setStep('upload')}
            className="flex items-center gap-1.5">
            <ArrowLeft size={14} /> Back
          </Button>
          <Button type="button" variant="primary" disabled={!roleId} onClick={handleSubmit}
            className="flex-1 flex items-center justify-center gap-2">
            Import {validRows.length} User{validRows.length !== 1 ? 's' : ''}
            <ChevronRight size={15} />
          </Button>
        </div>
      </div>
    );
  };

  // ── Uploading ──────────────────────────────────────────────────────────────
  const renderUploading = () => (
    <div className="flex flex-col items-center justify-center gap-4 py-10">
      <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
        style={{ background: 'var(--gradient-sidebar)' }}>
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white" />
      </div>
      <div className="text-center">
        <p className="font-bold text-base" style={{ color: 'var(--color-text)' }}>Creating users…</p>
        <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
          This may take a moment for large batches
        </p>
      </div>
    </div>
  );

  // ── Step 3: Done ────────────────────────────────────────────────────────
  const renderDone = () => {
    const failedRows = results?.results?.filter(r => !r.success) || [];
    const allOk      = results?.failed === 0;
    return (
      <div className="space-y-4">
        <StepDots step="done" />

        {/* Result banner */}
        <div className="flex items-center gap-4 px-5 py-4 rounded-2xl"
          style={{
            background:  allOk ? 'linear-gradient(135deg,#16a34a,#15803d)' : 'var(--color-bg-secondary)',
            border:      allOk ? 'none' : '1px solid var(--color-border)',
          }}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${allOk ? 'bg-white/20' : ''}`}
            style={allOk ? {} : { background: 'var(--gradient-sidebar)' }}>
            {allOk
              ? <CheckCircle2 size={22} className="text-white" />
              : <AlertTriangle size={20} className="text-white" />
            }
          </div>
          <div>
            {results?.succeeded > 0 && (
              <p className="font-bold text-sm" style={{ color: allOk ? 'white' : 'var(--color-text)' }}>
                {results.succeeded} user{results.succeeded !== 1 ? 's' : ''} created successfully
              </p>
            )}
            {results?.failed > 0 && (
              <p className="text-xs mt-0.5" style={{ color: allOk ? 'rgba(255,255,255,0.8)' : '#dc2626', fontWeight: 600 }}>
                {results.failed} failed
              </p>
            )}
          </div>
        </div>

        {/* Per-row errors */}
        {failedRows.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>
              Failed entries
            </p>
            <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--color-border)' }}>
              <div className="max-h-44 overflow-y-auto">
                {failedRows.map((r, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2 text-xs"
                    style={{ borderBottom: i < failedRows.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                    <XCircle size={13} style={{ color: '#dc2626', flexShrink: 0 }} />
                    <span className="font-mono font-semibold flex-shrink-0" style={{ color: 'var(--color-text)' }}>{r.email}</span>
                    <span className="truncate" style={{ color: 'var(--color-text-secondary)' }}>{r.error}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-3 pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
          {results?.failed > 0 && results?.succeeded === 0 && (
            <Button type="button" variant="secondary" onClick={() => { reset(); }}
              className="flex items-center gap-1.5">
              <ArrowLeft size={14} /> Try Again
            </Button>
          )}
          <Button type="button" variant="primary" onClick={handleClose} className="flex-1">
            Done
          </Button>
        </div>
      </div>
    );
  };

  const title = step === 'upload' ? 'Bulk Upload Members'
              : step === 'role'   ? 'Assign Role'
              : step === 'uploading' ? 'Uploading…'
              : 'Upload Complete';

  return (
    <Modal isOpen={isOpen} onClose={step === 'uploading' ? undefined : handleClose} title={title} size="md">
      {step === 'upload'    && renderUpload()}
      {step === 'role'      && renderRole()}
      {step === 'uploading' && renderUploading()}
      {step === 'done'      && renderDone()}
    </Modal>
  );
};

export default BulkUploadModal;
