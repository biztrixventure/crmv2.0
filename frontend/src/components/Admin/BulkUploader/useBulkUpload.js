import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import client from '../../../api/client';
import { parseFile, isAcceptedFile, MAX_FILE_BYTES, headerWarnings } from './fileParser';
import { applyMapping, autoMap, buildFields, detectPhoneKey, normPhone, transferToRow } from './columnMapping';
import { toCsv, downloadCsv, exportFileName } from './csvExport';

// Turn an axios/network error into a short, actionable sentence.
const apiErr = (e, fallback) =>
  e?.response?.data?.error
  || (e?.code === 'ERR_NETWORK' ? 'Network error — check your connection and retry.'
    : e?.response?.status >= 500 ? 'The server had a problem. Wait a moment and retry.'
    : e?.message)
  || fallback;

const CHUNK = 100;
const MAX_ROWS = 2000;

const emptyResults = { clean: [], updates: [], trueDuplicates: [], conflicts: [], unmatched: [], invalid: [] };

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
  const [updateDecisions, setUpdateDecisions] = useState({}); // update index -> include bool (default true)
  const [allowUpdates, setAllowUpdates] = useState(true);     // master toggle: dup-match → UPDATE vs SKIP
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
    if (!isAcceptedFile(file)) { setError('Unsupported file type. Use a .csv or .xlsx file exported from your spreadsheet.'); return; }
    if (file.size > MAX_FILE_BYTES) { setError(`This file is ${(file.size / 1048576).toFixed(1)} MB — the limit is 10 MB. Split it into smaller files.`); return; }
    setBusy(true);
    setProgress({ phase: 'parse', indeterminate: true });   // immediate feedback while the file is read
    try {
      let parsed;
      try { parsed = await parseFile(file); }
      catch { setError('Could not read this file. It may be corrupt or not a real CSV/Excel file. Re-export it and try again.'); return; }
      const { headers: hdrs, rows } = parsed;
      if (!hdrs.length) { setError('No columns were found. Make sure the first row contains column headers.'); return; }
      if (rows.length === 0) { setError('The file has headers but no data rows.'); return; }
      if (rows.length > MAX_ROWS) { setError(`Too many rows (${rows.length}). The limit is ${MAX_ROWS} — split the file and upload in parts.`); return; }

      // Warn (don't block) on blank/duplicate headers — they confuse mapping.
      const { blank, dups } = headerWarnings(hdrs);
      if (blank.length) toast.warning(`${blank.length} column(s) have no header (shown as "__EMPTY"). Map the right columns, or leave them unmapped.`);
      if (dups.length) toast.warning(`Duplicate column name(s): ${dups.slice(0, 3).join(', ')}. Only one will be used per field.`);

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
    } finally { setBusy(false); setProgress(null); }
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
    const agg = { clean: [], updates: [], trueDuplicates: [...skipExact], conflicts: [...inFileConflicts], unmatched: [] };
    const total = toSend.length;
    let failed = 0;
    setProgress({ phase: 'validate', done: 0, total });
    for (let i = 0; i < total; i += CHUNK) {
      const chunk = toSend.slice(i, i + CHUNK);
      try {
        const { data } = await client.post('uploads/validate-chunk', { rows: chunk });
        agg.clean.push(...(data.clean || []));
        agg.updates.push(...(data.updates || []));
        agg.trueDuplicates.push(...(data.trueDuplicates || []));
        agg.conflicts.push(...(data.conflicts || []));
        agg.unmatched.push(...(data.unmatched || []));
      } catch (e) {
        // One failed chunk must not lose the rest — list its rows as needing a
        // re-check rather than silently dropping them.
        failed += chunk.length;
        agg.unmatched.push(...chunk.map(r => ({ ...r, reason: apiErr(e, 'Could not be validated (server/network error). Re-run to re-check this row.') })));
      }
      setProgress({ phase: 'validate', done: Math.min(i + CHUNK, total), total });
    }
    agg.invalid = invalid;
    setProgress(null);
    setResults(agg);
    // Conflicts default to excluded (safer): user opts in.
    setDecisions({});
    // Updates default to INCLUDED (user explicitly asked for dup-update). Only
    // rows with a non-empty diff get a checkbox; unchanged rows aren't actionable.
    const uDec = {};
    (agg.updates || []).forEach((u, i) => { if (Array.isArray(u.changes) && u.changes.length) uDec[i] = true; });
    setUpdateDecisions(uDec);
    setStep('review');
    if (failed) toast.error(`${failed} row(s) couldn't be validated and are listed under unmatched — re-run to re-check them.`);
    else if (invalid.length) toast.warning(`${invalid.length} row(s) are missing required fields — see the review screen.`);
  }, [phoneKey, fields]);

  // Step 2 → 3: save the mapping globally, then validate all rows.
  const confirmMapping = useCallback(async () => {
    setError('');
    // Every required field must be mapped to a column present in the file.
    const unmapped = fields.filter(f => f.required && !mapping[f.key]);
    if (unmapped.length) { setError(`Map the required field(s): ${unmapped.map(f => f.label).join(', ')}`); return; }
    setBusy(true);
    // Indeterminate feedback for the prep gap (save mapping + transform rows)
    // before the determinate per-chunk validation bar takes over — otherwise the
    // UI looks frozen on big files while rows are mapped in memory.
    setProgress({ phase: 'prepare', indeterminate: true });
    try {
      await client.post('uploads/mapping', { mapping });
      await runValidation(applyMapping(rawRows, mapping, formFields, phoneKey));
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Validation failed.');
    } finally { setBusy(false); setProgress(null); }
  }, [mapping, rawRows, runValidation, formFields, phoneKey, fields]);

  const toggleConflict = useCallback((i) => setDecisions(d => ({ ...d, [i]: !d[i] })), []);
  const setAllConflicts = useCallback((val) => {
    setDecisions(() => { const d = {}; results.conflicts.forEach((_, i) => { d[i] = val; }); return d; });
  }, [results.conflicts]);
  const toggleUpdate = useCallback((i) => setUpdateDecisions(d => ({ ...d, [i]: !d[i] })), []);
  const setAllUpdates = useCallback((val) => {
    setUpdateDecisions(() => {
      const d = {};
      results.updates.forEach((u, i) => { if (Array.isArray(u.changes) && u.changes.length) d[i] = val; });
      return d;
    });
  }, [results.updates]);

  // Final insert: clean rows + user-included conflicts. Updates run alongside.
  // Updates only contain rows where the diff is non-empty AND the user opted in
  // (default ON — matches the user's request to update instead of skip).
  const confirmInsert = useCallback(async () => {
    setError('');
    const included = results.conflicts.filter((_, i) => decisions[i]).map(c => c.incoming).filter(r => r.company_id || r.fronter_name);
    const rows = [...results.clean, ...included];
    // Updates ship only when (a) master allowUpdates toggle is ON AND (b) the
    // per-row checkbox is checked AND (c) the row actually has changes. Skipped
    // rows roll into the "unchanged" count so the user sees they were detected
    // but intentionally left alone.
    const updateRows = !allowUpdates ? [] :
      results.updates.filter((u, i) =>
        updateDecisions[i] && Array.isArray(u.changes) && u.changes.length > 0
      );
    const unchangedCount = results.updates.length - updateRows.length;
    if (!rows.length && !updateRows.length) { setError('No records selected to insert or update.'); return; }

    setBusy(true);
    let inserted = 0, updated = 0, unchanged = unchangedCount, errMsg = '', stopped = false;
    const failedRows = [];   // rows the DB rejected (per-row reason from server)

    // Inserts batched in CHUNK; updates ship together in one POST so the diff
    // arrays travel with the row context. Sending the empty rows array w/ updates
    // is fine — the route handles either side missing.
    const insertChunks = Math.max(1, Math.ceil(rows.length / CHUNK));
    const total = rows.length + updateRows.length;
    // Updates-only batches ship in one request (no per-chunk ticks), so show an
    // indeterminate bar instead of a frozen 0% while the server applies them.
    setProgress({ phase: 'confirm', done: 0, total, indeterminate: rows.length === 0 });

    for (let i = 0; i < Math.max(1, rows.length); i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      // Attach the full updates payload only on the LAST call so it's applied once.
      const isLast = (i + CHUNK) >= rows.length;
      try {
        const { data } = await client.post('uploads/confirm', {
          rows: chunk,
          updates: isLast ? updateRows : [],
          batch: {
            file_name: fileName,
            total_rows: total,
            skipped_count: results.trueDuplicates.length,
            conflict_count: included.length,
          },
        });
        inserted  += data.inserted  || 0;
        updated   += data.updated   || 0;
        unchanged += data.unchanged || 0;
        if (Array.isArray(data.failed) && data.failed.length) failedRows.push(...data.failed);
        setProgress({ phase: 'confirm', done: Math.min(i + CHUNK, rows.length) + (isLast ? updateRows.length : 0), total });
      } catch (e) {
        errMsg = apiErr(e, 'Insert/update failed.');
        stopped = true;
        break;
      }
      if (rows.length === 0) break; // updates-only path: ran once above
    }
    setProgress(null);
    setBusy(false);
    if (stopped) {
      setError(`Inserted ${inserted}, updated ${updated} of ${total} before stopping: ${errMsg} You can safely re-run — already-inserted records will be detected and updated again only if their values still differ.`);
      toast.error('Upload stopped partway — see the message above.');
      if (inserted || updated) loadBatches();
      return;
    }
    setSummary({ inserted, updated, unchanged, failed: failedRows });
    setStep('done');
    loadBatches();
    const parts = [`${inserted} inserted`];
    if (updated)   parts.push(`${updated} updated`);
    if (unchanged) parts.push(`${unchanged} unchanged`);
    if (failedRows.length) parts.push(`${failedRows.length} rejected`);
    if (failedRows.length) {
      // Good rows still landed; surface the DB reason for the rejected ones so
      // the cause is visible (the server otherwise masks it as a generic 500).
      toast.error(`${failedRows.length} row(s) rejected: ${failedRows[0].reason}`);
    } else {
      toast.success(`Upload complete — ${parts.join(', ')}.`);
    }
  }, [results, decisions, updateDecisions, allowUpdates, fileName, loadBatches]);

  const reset = useCallback(() => {
    setStep('guide'); setFileName(''); setHeaders([]); setRawRows([]); setMapping({});
    setError(''); setProgress(null); setResults(emptyResults); setDecisions({});
    setUpdateDecisions({}); setAllowUpdates(true); setSummary(null);
  }, []);

  const [duplicates, setDuplicates] = useState([]);
  const loadDuplicates = useCallback(async () => {
    try { const r = await client.get('uploads/duplicate-transfers'); setDuplicates(r.data.groups || []); }
    catch (e) { toast.error(apiErr(e, 'Could not load duplicate transfers.')); }
  }, []);
  const mergeDuplicates = useCallback(async (merges) => {
    const { data } = await client.post('uploads/merge-duplicates', { merges });
    await loadDuplicates();
    loadBatches();
    return data;
  }, [loadDuplicates, loadBatches]);

  // Export a batch back to a re-uploadable CSV in the original column shape.
  // Columns: control fields first, then EVERY form_data key present across the
  // batch (so nothing the file carried is lost — incl. unmapped extras). The
  // derived cli_number is dropped and transfer_date is emitted as a control col.
  const downloadBatch = useCallback(async (batch) => {
    try {
      const { data } = await client.get(`uploads/batches/${batch.id}/export`);
      const transfers = data.transfers || [];
      if (!transfers.length) { toast.warning('This batch has no transfers to export.'); return; }

      const SKIP = new Set(['cli_number', 'transfer_date']);
      const fdKeys = [], seen = new Set();
      transfers.forEach(t => Object.keys(t.form_data || {}).forEach(k => {
        if (!SKIP.has(k) && !seen.has(k)) { seen.add(k); fdKeys.push(k); }
      }));
      const cols = [
        { key: 'fronter_name', control: true }, { key: 'company_name', control: true },
        { key: 'transfer_date', control: true }, { key: 'status', control: true }, { key: 'created_at', control: true },
        ...fdKeys.map(k => ({ key: k, control: false })),
      ];
      const headers = cols.map(c => c.key);
      const rows    = transfers.map(t => transferToRow(t, cols));
      downloadCsv(toCsv(headers, rows), exportFileName(batch.file_name || data.file_name));
      toast.success(`Exported ${rows.length} transfer${rows.length !== 1 ? 's' : ''}.`);
    } catch (e) { toast.error(apiErr(e, 'Could not export this batch.')); }
  }, []);

  const deleteBatch = useCallback(async (id) => {
    await client.delete(`uploads/batches/${id}`); loadBatches();
  }, [loadBatches]);
  const deleteAllBatches = useCallback(async () => {
    await client.delete('uploads/bulk'); loadBatches();
  }, [loadBatches]);

  return {
    step, fileName, headers, mapping, error, busy, progress, results, decisions, summary, reference, batches,
    formFields, fields, phoneKey, duplicates,
    updateDecisions, allowUpdates, setAllowUpdates, toggleUpdate, setAllUpdates,
    loadReference, loadBatches, onFile, setMap, confirmMapping, toggleConflict, setAllConflicts,
    confirmInsert, reset, deleteBatch, deleteAllBatches, downloadBatch, setStep, loadDuplicates, mergeDuplicates,
  };
}
