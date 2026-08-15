import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Upload, Loader2, X, FileSpreadsheet, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';
import ThemedSelect from '../UI/Select';
import UserPicker from './UserPicker';

// Turn a CSV/XLSX into a batch, from any level (superadmin, compliance, fronter
// manager, company admin). Parsing happens HERE, in the browser — the backend
// takes plain JSON rows, so no multipart/upload stack is needed server-side.
// Every column the file carried is posted verbatim in `data`, so the fronter who
// eventually works the number sees the same record the uploader saw.

// RFC4180-ish CSV: quoted fields, doubled quotes, embedded commas + newlines.
const parseCSV = (text) => {
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.map(r => r.map(c => String(c ?? '').trim()));
};
const parseXLSX = async (file) => {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }).map(r => r.map(c => String(c ?? '').trim()));
};

const digitsOf = (s) => String(s || '').replace(/\D/g, '');
// A column is the phone column when most of its values look like US numbers.
const guessPhoneCol = (headers, rows) => {
  const byName = headers.findIndex(h => /phone|number|cell|mobile/i.test(h));
  if (byName >= 0) return byName;
  let best = -1, bestScore = 0;
  headers.forEach((_, i) => {
    const hits = rows.slice(0, 50).filter(r => { const d = digitsOf(r[i]); return d.length === 10 || d.length === 11; }).length;
    if (hits > bestScore) { bestScore = hits; best = i; }
  });
  return bestScore >= 3 ? best : 0;
};
const guessCol = (headers, re) => headers.findIndex(h => re.test(h));

export default function BatchUpload({ onDone, onClose }) {
  const [file, setFile] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [phoneCol, setPhoneCol] = useState(0);
  const [nameCol, setNameCol] = useState(-1);
  const [leadCol, setLeadCol] = useState(-1);
  const [batchName, setBatchName] = useState('');
  const [recipient, setRecipient] = useState(null);   // null = keep it, assign later
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);   // { done, total } while chunks upload
  const [err, setErr] = useState('');
  const inputRef = useRef(null);

  const pick = async (f) => {
    if (!f) return;
    setErr(''); setFile(f);
    const ext = f.name.split('.').pop().toLowerCase();
    let grid = [];
    try {
      if (ext === 'csv' || ext === 'txt') grid = parseCSV(await f.text());
      else if (ext === 'xlsx' || ext === 'xls') grid = await parseXLSX(f);
      else { setErr('Unsupported file type — upload .csv or .xlsx.'); return; }
    } catch (e) { setErr(`Could not read the file: ${e.message}`); return; }

    const nonEmpty = grid.filter(r => r.some(c => c !== ''));
    if (nonEmpty.length < 2) { setErr('The file needs a header row and at least one data row.'); return; }
    const hdr = nonEmpty[0].map((h, i) => h || `Column ${i + 1}`);
    const body = nonEmpty.slice(1);
    setHeaders(hdr); setRows(body);
    setPhoneCol(guessPhoneCol(hdr, body));
    setNameCol(guessCol(hdr, /name|customer|contact/i));
    setLeadCol(guessCol(hdr, /lead[\s_-]?id|vendor/i));
    setBatchName(f.name.replace(/\.[^.]+$/, ''));
  };

  // valid = a 10/11-digit phone, deduped on the normalized number
  const seen = new Set();
  const valid = rows.filter(r => {
    const d = digitsOf(r[phoneCol]);
    const p = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
    if (p.length !== 10 || seen.has(p)) return false;
    seen.add(p); return true;
  });

  // A wide 1000-row file is megabytes of JSON — one request dies at the reverse
  // proxy's body cap (413) before Express ever sees it. So: create the batch with
  // the first chunk, then append the rest. Each chunk is its own small request,
  // and a re-sent chunk can't duplicate a number (the server skips phones the
  // batch already has).
  const CHUNK = 250;
  const send = async () => {
    if (!valid.length) return toast.error('No valid phone numbers in that column');
    setBusy(true);
    try {
      const payload = valid.map(r => ({
        phone: r[phoneCol],
        customer_name: nameCol >= 0 ? r[nameCol] : null,
        lead_id: leadCol >= 0 ? r[leadCol] : null,
        // every OTHER column, keyed by its header — this is what the fronter sees
        data: Object.fromEntries(headers.map((h, i) => [h, r[i] ?? '']).filter(([, v]) => v !== '')),
      }));

      setProgress({ done: 0, total: payload.length });
      const first = await client.post('distribution-batches/upload', {
        name: batchName.trim() || file?.name || 'Uploaded batch',
        file_name: file?.name || null,
        columns: headers,
        recipient_id: recipient?.id || undefined,
        rows: payload.slice(0, CHUNK),
      });
      const batch = first.data.batch;
      let imported = first.data.imported;
      setProgress({ done: Math.min(CHUNK, payload.length), total: payload.length });

      for (let i = CHUNK; i < payload.length; i += CHUNK) {
        const r = await client.post(`distribution-batches/${batch.id}/append`, { rows: payload.slice(i, i + CHUNK) });
        imported += r.data.imported;
        setProgress({ done: Math.min(i + CHUNK, payload.length), total: payload.length });
      }
      toast.success(`Batch created — ${imported} numbers${payload.length - imported ? `, ${payload.length - imported} duplicates skipped` : ''}`);
      onDone?.({ ...batch, item_count: imported });
    } catch (e) {
      toast.error(e.response?.status === 413
        ? 'The server rejected the upload as too large — tell your admin to raise the proxy body limit.'
        : (e.response?.data?.error || 'Upload failed'));
    }
    finally { setBusy(false); setProgress(null); }
  };

  const Field = ({ label, value, onChange, allowNone }) => (
    <label className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
      {label}
      <ThemedSelect value={value} onChange={e => onChange(parseInt(e.target.value, 10))} className="input text-sm py-1.5 mt-1 w-full">
        {allowNone && <option value={-1}>— none —</option>}
        {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
      </ThemedSelect>
    </label>
  );

  // Portalled above the shell chrome — the sticky app header and sidebar both
  // sit at z-50 and were covering the dialog's own header and footer buttons.
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[92vh] flex flex-col rounded-2xl overflow-hidden" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 p-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <Upload size={18} style={{ color: 'var(--color-primary-600)' }} />
          <div className="font-bold flex-1" style={{ color: 'var(--color-text)' }}>Upload numbers as a batch</div>
          <button onClick={onClose} style={{ color: 'var(--color-text-secondary)' }}><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!headers.length ? (
            <div className="rounded-xl p-8 text-center" style={{ border: '1px dashed var(--color-border)' }}
              onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); pick(e.dataTransfer.files?.[0]); }}>
              <FileSpreadsheet size={30} className="mx-auto mb-2" style={{ color: 'var(--color-text-tertiary)' }} />
              <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Drop a .csv or .xlsx here</div>
              <div className="text-xs mb-3" style={{ color: 'var(--color-text-secondary)' }}>First row = column headers. Every column is kept and shown to whoever works the number.</div>
              <button onClick={() => inputRef.current?.click()} className="text-sm font-bold px-4 py-2 rounded-lg" style={{ background: 'var(--gradient-sidebar)', color: 'var(--color-text-inverse)' }}>Choose file</button>
              <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls,.txt" className="hidden" onChange={e => pick(e.target.files?.[0])} />
              {err && <div className="text-xs mt-3" style={{ color: 'var(--color-error-600)' }}>{err}</div>}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-sm flex-wrap">
                <CheckCircle2 size={15} style={{ color: 'var(--color-success-600)' }} />
                <span style={{ color: 'var(--color-text)' }}>{file?.name}</span>
                <span style={{ color: 'var(--color-text-tertiary)' }}>· {rows.length} rows · {headers.length} columns · <strong style={{ color: 'var(--color-text-secondary)' }}>{valid.length} valid numbers</strong></span>
                <button onClick={() => { setHeaders([]); setRows([]); setFile(null); }} className="ml-auto text-xs font-semibold" style={{ color: 'var(--color-primary-600)' }}>Change file</button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Phone column" value={phoneCol} onChange={setPhoneCol} />
                <Field label="Customer name (optional)" value={nameCol} onChange={setNameCol} allowNone />
                <Field label="Dialer lead ID (optional)" value={leadCol} onChange={setLeadCol} allowNone />
              </div>

              <div className="text-[11px] -mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                Only the phone column is required — numbers are matched and assigned on the phone.
                Map the lead ID only for VICIdial exports, so a number can be traced back to the dialer record
                (a lead id is unique per box, not across boxes). Every other column is kept and shown anyway.
              </div>

              <label className="block text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                Batch name
                <input value={batchName} onChange={e => setBatchName(e.target.value)} className="w-full text-sm rounded-lg px-3 py-2 mt-1"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
              </label>

              <div>
                <div className="text-xs mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                  Send straight to someone (optional) — leave empty to keep the batch and assign from it.
                </div>
                <UserPicker value={recipient} onChange={setRecipient} />
              </div>

              <div>
                <div className="text-xs font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>Preview — first 5 rows, all columns</div>
                <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--color-border)' }}>
                  <table className="text-xs">
                    <thead><tr style={{ background: 'var(--color-surface)' }}>
                      {headers.map((h, i) => <th key={i} className="text-left font-semibold px-2 py-1.5 whitespace-nowrap" style={{ color: i === phoneCol ? 'var(--color-primary-600)' : 'var(--color-text-secondary)' }}>{h}{i === phoneCol ? ' (phone)' : ''}</th>)}
                    </tr></thead>
                    <tbody>
                      {valid.slice(0, 5).map((r, ri) => (
                        <tr key={ri} style={{ borderTop: '1px solid var(--color-border)' }}>
                          {headers.map((_, ci) => <td key={ci} className="px-2 py-1 whitespace-nowrap" style={{ color: 'var(--color-text)' }}>{r[ci]}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        {headers.length > 0 && (
          <div className="p-4 flex items-center justify-end gap-2" style={{ borderTop: '1px solid var(--color-border)' }}>
            {progress && (
              <div className="flex-1 mr-2">
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-bg-secondary)' }}>
                  <div className="h-full transition-all" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%`, background: 'var(--gradient-sidebar)' }} />
                </div>
                <div className="text-[11px] mt-1" style={{ color: 'var(--color-text-secondary)' }}>Uploading {progress.done} of {progress.total}…</div>
              </div>
            )}
            <button onClick={onClose} className="text-sm font-semibold px-3 py-2 rounded-lg" style={{ color: 'var(--color-text-secondary)' }}>Cancel</button>
            <button onClick={send} disabled={busy || !valid.length} className="text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 disabled:opacity-50" style={{ background: 'var(--gradient-sidebar)', color: 'var(--color-text-inverse)' }}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Create batch ({valid.length})
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
