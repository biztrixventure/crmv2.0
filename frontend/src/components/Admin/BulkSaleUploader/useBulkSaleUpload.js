import { useState, useCallback } from 'react';
import client from '../../../api/client';
import { parseFile, isAcceptedFile } from '../BulkUploader/fileParser';
import { applyMapping, autoMap, buildFields, detectPhoneKey } from './saleColumnMapping';

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
    if (!isAcceptedFile(file)) { setError('Unsupported file. Use CSV or Excel (.xlsx).'); return; }
    setBusy(true);
    try {
      const { headers: hdrs, rows } = await parseFile(file);
      if (!hdrs.length) { setError('Could not read any columns.'); return; }
      if (rows.length === 0) { setError('The file has no data rows.'); return; }
      if (rows.length > MAX_ROWS) { setError(`Too many rows (${rows.length}). Max ${MAX_ROWS}.`); return; }
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
    setProgress({ phase: 'validate', done: 0, total });
    for (let i = 0; i < total; i += CHUNK) {
      const { data } = await client.post('sale-uploads/validate-chunk', { rows: toSend.slice(i, i + CHUNK) });
      agg.newSales.push(...(data.newSales || []));
      agg.updates.push(...(data.updates || []));
      agg.skipped.push(...(data.skipped || []));
      agg.unmatched.push(...(data.unmatched || []));
      agg.ambiguous.push(...(data.ambiguous || []));
      setProgress({ phase: 'validate', done: Math.min(i + CHUNK, total), total });
    }
    setProgress(null);
    setResults(agg);
    setDecisions({}); // updates default to excluded — superadmin opts in
    setStep('review');
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

  const confirmInsert = useCallback(async () => {
    setError('');
    const newRows = results.newSales;
    const updateRows = results.updates.filter((_, i) => decisions[i]);
    if (!newRows.length && !updateRows.length) { setError('Nothing selected to insert or update.'); return; }
    setBusy(true);
    setProgress({ phase: 'confirm', done: 0, total: newRows.length + updateRows.length });
    try {
      // Inserts in chunks; updates sent together (already individually reviewed).
      let inserted = 0, updated = 0, done = 0;
      for (let i = 0; i < newRows.length; i += CHUNK) {
        const slice = newRows.slice(i, i + CHUNK);
        const { data } = await client.post('sale-uploads/confirm', { newRows: slice, updateRows: [], batch: { file_name: fileName } });
        inserted += data.inserted || 0; done += slice.length;
        setProgress({ phase: 'confirm', done, total: newRows.length + updateRows.length });
      }
      if (updateRows.length) {
        const { data } = await client.post('sale-uploads/confirm', { newRows: [], updateRows, batch: { file_name: fileName } });
        updated += data.updated || 0; done += updateRows.length;
        setProgress({ phase: 'confirm', done, total: newRows.length + updateRows.length });
      }
      setSummary({ inserted, updated });
      setStep('done');
      loadBatches();
    } catch (e) { setError(e.response?.data?.error || e.message || 'Insert/update failed.'); }
    finally { setProgress(null); setBusy(false); }
  }, [results, decisions, fileName, loadBatches]);

  const reset = useCallback(() => {
    setStep('guide'); setFileName(''); setHeaders([]); setRawRows([]); setMapping({});
    setError(''); setProgress(null); setResults(empty); setDecisions({}); setSummary(null);
  }, []);

  const deleteBatch = useCallback(async (id) => { await client.delete(`sale-uploads/batches/${id}`); loadBatches(); }, [loadBatches]);

  return {
    step, fileName, headers, mapping, error, busy, progress, results, decisions, summary, reference, formFields, fields, phoneKey, batches,
    loadReference, loadBatches, onFile, setMap, confirmMapping, toggleUpdate, setAllUpdates, confirmInsert, reset, deleteBatch, setStep,
  };
}
