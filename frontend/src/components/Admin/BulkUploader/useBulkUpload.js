import { useState, useCallback } from 'react';
import client from '../../../api/client';
import { parseFile, isAcceptedFile } from './fileParser';
import { applyMapping, autoMap, buildFields, detectPhoneKey, normPhone } from './columnMapping';

const CHUNK = 100;
const MAX_ROWS = 2000;

const emptyResults = { clean: [], trueDuplicates: [], conflicts: [], unmatched: [], invalid: [] };

export function useBulkUpload() {
  const [step, setStep]         = useState('guide');   // guide | mapping | review | done
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders]   = useState([]);
  const [rawRows, setRawRows]   = useState([]);
  const [mapping, setMapping]   = useState({});
  const [error, setError]       = useState('');
  const [busy, setBusy]         = useState(false);
  const [progress, setProgress] = useState(null);      // { phase, done, total }
  const [results, setResults]   = useState(emptyResults);
  const [decisions, setDecisions] = useState({});      // conflict index -> include bool
  const [summary, setSummary]   = useState(null);      // { inserted, skipped }
  const [reference, setReference] = useState([]);
  const [batches, setBatches]   = useState([]);
  const [formFields, setFormFields] = useState([]);

  // The phone/CLI field + full mappable field list are derived from the live
  // form config, so new form-builder fields are picked up with no code change.
  const phoneKey = detectPhoneKey(formFields);
  const fields   = buildFields(formFields, phoneKey);

  const loadReference = useCallback(async () => {
    try {
      const [ref, ff] = await Promise.all([
        client.get('uploads/reference'),
        client.get('forms/fields'),
      ]);
      setReference(ref.data.companies || []);
      setFormFields(ff.data.fields || []);
    } catch { /* ignore */ }
  }, []);

  const loadBatches = useCallback(async () => {
    try { const r = await client.get('uploads/batches'); setBatches(r.data.batches || []); } catch { /* ignore */ }
  }, []);

  // Step 1 → 2: parse the file, then show the (pre-filled) mapping screen.
  const onFile = useCallback(async (file) => {
    setError('');
    if (!file) return;
    if (!isAcceptedFile(file)) { setError('Unsupported file. Use CSV or Excel (.xlsx).'); return; }
    setBusy(true);
    try {
      const { headers: hdrs, rows } = await parseFile(file);
      if (!hdrs.length) { setError('Could not read any columns from this file.'); return; }
      if (rows.length === 0) { setError('The file has no data rows.'); return; }
      if (rows.length > MAX_ROWS) { setError(`Too many rows (${rows.length}). Max is ${MAX_ROWS}.`); return; }

      setFileName(file.name);
      setHeaders(hdrs);
      setRawRows(rows);

      // Pre-fill from the saved global mapping, falling back to a best-guess.
      let saved = null;
      try { saved = (await client.get('uploads/mapping')).data.mapping; } catch { /* ignore */ }
      const usable = saved && Object.values(saved).some(h => hdrs.includes(h)) ? saved : autoMap(hdrs, fields);
      // Drop any mapped header that isn't actually in this file.
      const cleaned = {};
      Object.entries(usable || {}).forEach(([k, h]) => { if (hdrs.includes(h)) cleaned[k] = h; });
      setMapping(cleaned);
      setStep('mapping');
    } catch (e) {
      setError(e.message || 'Failed to parse file.');
    } finally { setBusy(false); }
  }, [fields]);

  const setMap = useCallback((field, header) => {
    setMapping(prev => ({ ...prev, [field]: header || undefined }));
  }, []);

  // In-file dedup (rows vs other rows in the same file), then DB validation.
  const runValidation = useCallback(async (mapped) => {
    const invalid = [], skipExact = [], inFileConflicts = [], toSend = [];
    const seen = new Map();   // key(phone|fronter|company) -> true  (exact)
    const byPhone = new Map(); // normPhone -> { fronter, company } first owner seen

    // Every required field (control fields + the phone/CLI + any form field
    // marked required in the form config) must have a value on every row.
    const reqFields = fields.filter(f => f.required);
    for (const row of mapped) {
      const missing = reqFields.filter(f => {
        if (f.isPhone)  return !String(row.cli_number || '').trim();
        if (f.control)  return !String(row[f.key] || '').trim();
        return !String(row.form_data?.[f.key] || '').trim();
      }).map(f => f.label);
      if (missing.length) { invalid.push({ ...row, reason: `Missing ${missing.join(', ')}` }); continue; }

      const ph = normPhone(row.cli_number);
      const fr = String(row.fronter_name).trim().toLowerCase();
      const co = String(row.company_name).trim().toLowerCase();
      const exactKey = `${ph}|${fr}|${co}`;

      if (seen.has(exactKey)) { skipExact.push({ ...row, reason: 'Duplicate row within file' }); continue; }
      seen.set(exactKey, true);

      const owner = byPhone.get(ph);
      if (ph && owner && (owner.fr !== fr || owner.co !== co)) {
        // Same phone, different fronter/company than an earlier file row → conflict.
        inFileConflicts.push({ incoming: row, existing: { source: 'file', fronter_name: owner.frName, company_name: owner.coName, cli_number: ph } });
        continue;
      }
      if (ph && !owner) byPhone.set(ph, { fr, co, frName: row.fronter_name, coName: row.company_name });
      toSend.push(row);
    }

    // DB validation in chunks of 100.
    const agg = { clean: [], trueDuplicates: [...skipExact], conflicts: [...inFileConflicts], unmatched: [] };
    const total = toSend.length;
    setProgress({ phase: 'validate', done: 0, total });
    for (let i = 0; i < total; i += CHUNK) {
      const chunk = toSend.slice(i, i + CHUNK);
      const { data } = await client.post('uploads/validate-chunk', { rows: chunk });
      agg.clean.push(...(data.clean || []));
      agg.trueDuplicates.push(...(data.trueDuplicates || []));
      agg.conflicts.push(...(data.conflicts || []));
      agg.unmatched.push(...(data.unmatched || []));
      setProgress({ phase: 'validate', done: Math.min(i + CHUNK, total), total });
    }
    agg.invalid = invalid;
    setProgress(null);
    setResults(agg);
    // Conflicts default to excluded (safer): user opts in.
    setDecisions({});
    setStep('review');
  }, [phoneKey, fields]);

  // Step 2 → 3: save the mapping globally, then validate all rows.
  const confirmMapping = useCallback(async () => {
    setError('');
    // Every required field must be mapped to a column present in the file.
    const unmapped = fields.filter(f => f.required && !mapping[f.key]);
    if (unmapped.length) { setError(`Map the required field(s): ${unmapped.map(f => f.label).join(', ')}`); return; }
    setBusy(true);
    try {
      await client.post('uploads/mapping', { mapping });
      await runValidation(applyMapping(rawRows, mapping, formFields, phoneKey));
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Validation failed.');
    } finally { setBusy(false); }
  }, [mapping, rawRows, runValidation, formFields, phoneKey, fields]);

  const toggleConflict = useCallback((i) => setDecisions(d => ({ ...d, [i]: !d[i] })), []);
  const setAllConflicts = useCallback((val) => {
    setDecisions(() => { const d = {}; results.conflicts.forEach((_, i) => { d[i] = val; }); return d; });
  }, [results.conflicts]);

  // Final insert: clean rows + user-included conflicts.
  const confirmInsert = useCallback(async () => {
    setError('');
    const included = results.conflicts.filter((_, i) => decisions[i]).map(c => c.incoming).filter(r => r.company_id || r.fronter_name);
    const rows = [...results.clean, ...included];
    if (!rows.length) { setError('No records selected to insert.'); return; }

    setBusy(true);
    let inserted = 0, skipped = 0;
    const total = rows.length;
    setProgress({ phase: 'confirm', done: 0, total });
    try {
      for (let i = 0; i < total; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const { data } = await client.post('uploads/confirm', {
          rows: chunk,
          batch: {
            file_name: fileName,
            total_rows: total,
            skipped_count: results.trueDuplicates.length,
            conflict_count: included.length,
          },
        });
        inserted += data.inserted || 0;
        skipped  += data.skipped  || 0;
        setProgress({ phase: 'confirm', done: Math.min(i + CHUNK, total), total });
      }
      setSummary({ inserted, skipped });
      setStep('done');
      loadBatches();
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Insert failed.');
    } finally { setProgress(null); setBusy(false); }
  }, [results, decisions, fileName, loadBatches]);

  const reset = useCallback(() => {
    setStep('guide'); setFileName(''); setHeaders([]); setRawRows([]); setMapping({});
    setError(''); setProgress(null); setResults(emptyResults); setDecisions({}); setSummary(null);
  }, []);

  const deleteBatch = useCallback(async (id) => {
    await client.delete(`uploads/batches/${id}`); loadBatches();
  }, [loadBatches]);
  const deleteAllBatches = useCallback(async () => {
    await client.delete('uploads/bulk'); loadBatches();
  }, [loadBatches]);

  return {
    step, fileName, headers, mapping, error, busy, progress, results, decisions, summary, reference, batches,
    formFields, fields, phoneKey,
    loadReference, loadBatches, onFile, setMap, confirmMapping, toggleConflict, setAllConflicts,
    confirmInsert, reset, deleteBatch, deleteAllBatches, setStep,
  };
}
