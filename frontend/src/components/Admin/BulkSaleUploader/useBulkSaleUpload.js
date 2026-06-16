import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import client from '../../../api/client';
import { parseFile, isAcceptedFile, MAX_FILE_BYTES, headerWarnings } from '../BulkUploader/fileParser';
import { applyMapping, autoMap, buildFields, detectPhoneKey, saleExportColumns, saleToRow } from './saleColumnMapping';
import { toCsv, downloadCsv, exportFileName } from '../BulkUploader/csvExport';

// Turn an axios/network error into a short, actionable sentence.
const apiErr = (e, fallback) =>
  e?.response?.data?.error
  || (e?.code === 'ERR_NETWORK' ? 'Network error — check your connection and retry.'
    : e?.response?.status >= 500 ? 'The server had a problem. Wait a moment and retry.'
    : e?.message)
  || fallback;

const CHUNK = 100;
const MAX_ROWS = 2000;
const empty = { newSales: [], updates: [], skipped: [], unmatched: [], ambiguous: [], invalid: [] };

export function useBulkSaleUpload() {
  const [step, setStep]         = useState('guide');   // guide | mapping | review | done
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders]   = useState([]);
  const [rawRows, setRawRows]   = useState([]);
  const [mapping, setMapping]   = useState({});
  const [error, setError]       = useState('');
  const [busy, setBusy]         = useState(false);
  const [progress, setProgress] = useState(null);
  const [results, setResults]   = useState(empty);
  const [decisions, setDecisions] = useState({});      // update index -> include
  const [summary, setSummary]   = useState(null);
  const [reference, setReference] = useState({ companies: [], closers: [] });
  const [formFields, setFormFields] = useState([]);
  const [batches, setBatches]   = useState([]);

  const phoneKey = detectPhoneKey(formFields);
  const fields   = buildFields(formFields, phoneKey);

  const loadReference = useCallback(async () => {
    try {
      const [ref, ff] = await Promise.all([client.get('sale-uploads/reference'), client.get('forms/fields')]);
      setReference({ companies: ref.data.companies || [], closers: ref.data.closers || [] });
      setFormFields(ff.data.fields || []);
    } catch { /* ignore */ }
  }, []);

  const loadBatches = useCallback(async () => {
    try { const r = await client.get('sale-uploads/batches'); setBatches(r.data.batches || []); } catch { /* ignore */ }
  }, []);

  const onFile = useCallback(async (file) => {
    setError('');
    if (!file) return;
    if (!isAcceptedFile(file)) { setError('Unsupported file type. Use a .csv or .xlsx file exported from your spreadsheet.'); return; }
    if (file.size > MAX_FILE_BYTES) { setError(`This file is ${(file.size / 1048576).toFixed(1)} MB — the limit is 10 MB. Split it into smaller files.`); return; }
    setBusy(true);
    try {
      let parsed;
      try { parsed = await parseFile(file); }
      catch { setError('Could not read this file. It may be corrupt or not a real CSV/Excel file. Re-export it and try again.'); return; }
      const { headers: hdrs, rows } = parsed;
      if (!hdrs.length) { setError('No columns were found. Make sure the first row contains column headers.'); return; }
      if (rows.length === 0) { setError('The file has headers but no data rows.'); return; }
      if (rows.length > MAX_ROWS) { setError(`Too many rows (${rows.length}). The limit is ${MAX_ROWS} — split the file and upload in parts.`); return; }
      const { blank, dups } = headerWarnings(hdrs);
      if (blank.length) toast.warning(`${blank.length} column(s) have no header (shown as "__EMPTY"). Map the right columns, or leave them unmapped.`);
      if (dups.length) toast.warning(`Duplicate column name(s): ${dups.slice(0, 3).join(', ')}. Only one will be used per field.`);
      setFileName(file.name); setHeaders(hdrs); setRawRows(rows);

      let saved = null;
      try { saved = (await client.get('sale-uploads/mapping')).data.mapping; } catch { /* ignore */ }
      const usable = saved && Object.values(saved).some(h => hdrs.includes(h)) ? saved : autoMap(hdrs, fields);
      const cleaned = {};
      Object.entries(usable || {}).forEach(([k, h]) => { if (hdrs.includes(h)) cleaned[k] = h; });
      setMapping(cleaned);
      setStep('mapping');
    } catch (e) { setError(e.message || 'Failed to parse file.'); }
    finally { setBusy(false); }
  }, [fields]);

  const setMap = useCallback((field, header) => setMapping(prev => ({ ...prev, [field]: header || undefined })), []);

  const runValidation = useCallback(async (mapped) => {
    const reqFields = fields.filter(f => f.required);
    const invalid = [], toSend = [];
    for (const row of mapped) {
      const missing = reqFields.filter(f => {
        if (f.isPhone) return !String(row.cli_number || '').trim();
        if (f.control) return !String(row[f.key] || '').trim();
        return !String(row.form_data?.[f.key] || '').trim();
      }).map(f => f.label);
      if (missing.length) invalid.push({ ...row, reason: `Missing ${missing.join(', ')}` });
      else toSend.push(row);
    }

    const agg = { newSales: [], updates: [], skipped: [], unmatched: [], ambiguous: [], invalid };
    const total = toSend.length;
    let failed = 0;
    setProgress({ phase: 'validate', done: 0, total });
    for (let i = 0; i < total; i += CHUNK) {
      const chunk = toSend.slice(i, i + CHUNK);
      // Retry a chunk once on a transient failure before giving up — the backend
      // also retries its DB reads, so a chunk reaching this catch is rare.
      let data = null, lastErr = null;
      for (let attempt = 0; attempt < 2 && !data; attempt++) {
        try { data = (await client.post('sale-uploads/validate-chunk', { rows: chunk })).data; }
        catch (e) { lastErr = e; if (attempt === 0) await new Promise(r => setTimeout(r, 600)); }
      }
      if (data) {
        agg.newSales.push(...(data.newSales || []));
        agg.updates.push(...(data.updates || []));
        agg.skipped.push(...(data.skipped || []));
        agg.unmatched.push(...(data.unmatched || []));
        agg.ambiguous.push(...(data.ambiguous || []));
      } else {
        // Don't lose a chunk on a transient failure — list it as unmatched so
        // the user can re-run instead of silently skipping those sales.
        failed += chunk.length;
        agg.unmatched.push(...chunk.map(r => ({ ...r, reason: apiErr(lastErr, 'Could not be validated (server/network error). Re-run to re-check this row.') })));
      }
      setProgress({ phase: 'validate', done: Math.min(i + CHUNK, total), total });
    }
    setProgress(null);
    setResults(agg);
    setDecisions({}); // updates default to excluded — superadmin opts in
    setStep('review');
    if (failed) toast.error(`${failed} row(s) couldn't be validated and are listed under unmatched — re-run to re-check them.`);
    else if (invalid.length) toast.warning(`${invalid.length} row(s) are missing required fields — see the review screen.`);
  }, [fields]);

  const confirmMapping = useCallback(async () => {
    setError('');
    const unmapped = fields.filter(f => f.required && !mapping[f.key]);
    if (unmapped.length) { setError(`Map the required field(s): ${unmapped.map(f => f.label).join(', ')}`); return; }
    setBusy(true);
    try {
      await client.post('sale-uploads/mapping', { mapping });
      await runValidation(applyMapping(rawRows, mapping, formFields, phoneKey));
    } catch (e) { setError(e.response?.data?.error || e.message || 'Validation failed.'); }
    finally { setBusy(false); }
  }, [mapping, rawRows, runValidation, formFields, phoneKey, fields]);

  const toggleUpdate  = useCallback((i) => setDecisions(d => ({ ...d, [i]: !d[i] })), []);
  const setAllUpdates = useCallback((val) => setDecisions(() => { const d = {}; results.updates.forEach((_, i) => { d[i] = val; }); return d; }), [results.updates]);

  // Change which transfer an auto-matched NEW sale attaches to (from candidates).
  const setNewSaleTransfer = useCallback((idx, transferId) => {
    setResults(prev => {
      const newSales = [...prev.newSales];
      const row = { ...newSales[idx], transfer_id: transferId, chosen_transfer_id: transferId };
      const cand = (row.candidate_transfers || []).find(c => c.id === transferId);
      if (cand) row.matched_transfer = cand;
      newSales[idx] = row;
      return { ...prev, newSales };
    });
  }, []);

  // Create the missing transfer for an unmatched row, then re-validate just that
  // row and move it into the right bucket — all without leaving the page.
  const createTransferForRow = useCallback(async (idx) => {
    const row = results.unmatched[idx];
    if (!row) return;
    try {
      await client.post('sale-uploads/create-transfer', { row });
      const { data } = await client.post('sale-uploads/validate-chunk', { rows: [row] });
      setResults(prev => {
        const next = { ...prev, unmatched: prev.unmatched.filter((_, i) => i !== idx) };
        ['newSales', 'updates', 'skipped', 'ambiguous'].forEach(k => { next[k] = [...prev[k], ...(data[k] || [])]; });
        next.unmatched = [...next.unmatched, ...(data.unmatched || [])];
        return next;
      });
      const moved = (data.newSales?.length || 0) + (data.updates?.length || 0);
      if (moved) toast.success('Transfer created — sale now matches.');
      else toast.warning('Transfer created, but the sale still did not match. Check the phone/fronter.');
    } catch (e) {
      toast.error(apiErr(e, 'Could not create the transfer.'));
    }
  }, [results.unmatched]);

  const confirmInsert = useCallback(async () => {
    setError('');
    const newRows = results.newSales;
    const updateRows = results.updates.filter((_, i) => decisions[i]);
    if (!newRows.length && !updateRows.length) { setError('Nothing selected to insert or update.'); return; }
    setBusy(true);
    const total = newRows.length + updateRows.length;
    setProgress({ phase: 'confirm', done: 0, total });
    // Inserts in chunks; updates sent together (already individually reviewed).
    let inserted = 0, updated = 0, done = 0, errMsg = '', stopped = false;
    for (let i = 0; i < newRows.length; i += CHUNK) {
      const slice = newRows.slice(i, i + CHUNK);
      try {
        const { data } = await client.post('sale-uploads/confirm', { newRows: slice, updateRows: [], batch: { file_name: fileName } });
        inserted += data.inserted || 0; done += slice.length;
        setProgress({ phase: 'confirm', done, total });
      } catch (e) { errMsg = apiErr(e, 'Insert failed.'); stopped = true; break; }
    }
    if (!stopped && updateRows.length) {
      try {
        const { data } = await client.post('sale-uploads/confirm', { newRows: [], updateRows, batch: { file_name: fileName } });
        updated += data.updated || 0; done += updateRows.length;
        setProgress({ phase: 'confirm', done, total });
      } catch (e) { errMsg = apiErr(e, 'Update failed.'); stopped = true; }
    }
    setProgress(null);
    setBusy(false);
    if (stopped) {
      setError(`Saved ${inserted} new sale(s)${updated ? ` and ${updated} update(s)` : ''} of ${total} before stopping: ${errMsg} You can safely re-run — existing sales are detected and won't be duplicated.`);
      toast.error('Upload stopped partway — see the message above.');
      if (inserted || updated) loadBatches();
      return;
    }
    setSummary({ inserted, updated });
    setStep('done');
    loadBatches();
    toast.success(`Done — ${inserted} sale(s) created${updated ? `, ${updated} updated` : ''}.`);
  }, [results, decisions, fileName, loadBatches]);

  const reset = useCallback(() => {
    setStep('guide'); setFileName(''); setHeaders([]); setRawRows([]); setMapping({});
    setError(''); setProgress(null); setResults(empty); setDecisions({}); setSummary(null);
  }, []);

  const deleteBatch = useCallback(async (id) => { await client.delete(`sale-uploads/batches/${id}`); loadBatches(); }, [loadBatches]);

  // Export a sale batch back to a re-uploadable CSV in the canonical sale shape.
  const downloadBatch = useCallback(async (batch) => {
    try {
      const { data } = await client.get(`sale-uploads/batches/${batch.id}/export`);
      const cols    = saleExportColumns(formFields);
      const headers = cols.map(c => c.key);
      const rows    = (data.sales || []).map(s => saleToRow(s, cols));
      if (!rows.length) { toast.warning('This batch has no sales to export.'); return; }
      downloadCsv(toCsv(headers, rows), exportFileName(batch.file_name || data.file_name));
      toast.success(`Exported ${rows.length} sale${rows.length !== 1 ? 's' : ''}.`);
    } catch (e) { toast.error(apiErr(e, 'Could not export this batch.')); }
  }, [formFields]);

  return {
    step, fileName, headers, mapping, error, busy, progress, results, decisions, summary, reference, formFields, fields, phoneKey, batches,
    loadReference, loadBatches, onFile, setMap, confirmMapping, toggleUpdate, setAllUpdates, confirmInsert, reset, deleteBatch, downloadBatch, setStep,
    setNewSaleTransfer, createTransferForRow,
  };
}
