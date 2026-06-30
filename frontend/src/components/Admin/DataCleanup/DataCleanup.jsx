import { useState, useEffect, useMemo, useCallback } from 'react';
import { Eraser, Search, AlertTriangle, CheckCircle2, Loader2, Database, History, Undo2, Plus, X, ListChecks, MapPin, Hash, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../UI';
import client from '../../../api/client';
import { useFormFields } from '../../../hooks/useFormFields';

const fmt = (s) => { try { return new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return '—'; } };

const STATUS_COLOR = {
  updated: '#16a34a', would_update: '#2563eb', filled: '#16a34a', would_fill: '#2563eb',
  not_found: '#dc2626', error: '#dc2626', zip_not_found: '#d97706', no_change: '#6b7280',
};

// ── Bulk update by record id ─────────────────────────────────────────────────
// Paste lines of "id, value1, value2…" aligned to the selected fields. Each id
// targets exactly ONE row in the chosen table. Dry-run first; mismatched ids are
// surfaced as not_found. Optional geo-fill sets City/State from the ZIP.
const BulkByIdPanel = ({ fields, onDone }) => {
  const [table, setTable]   = useState('sales');
  const [cols, setCols]     = useState([]);     // [{name, field_type, label}] in paste order
  const [addPick, setAddPick] = useState('');
  const [fillGeo, setFillGeo] = useState(false);
  const [text, setText]     = useState('');
  const [busy, setBusy]     = useState(false);
  const [res, setRes]       = useState(null);

  const available = useMemo(() => (fields || []).filter(f => !cols.some(c => c.name === f.name)), [fields, cols]);
  const addCol = (name) => { const f = (fields || []).find(x => x.name === name); if (f) setCols(c => [...c, { name: f.name, field_type: f.field_type, label: f.label || f.name }]); setAddPick(''); setRes(null); };
  const rmCol  = (name) => { setCols(c => c.filter(x => x.name !== name)); setRes(null); };

  // Parse pasted lines → [{id, values:[]}]. Tab-delimited if any tab present,
  // else comma. First token is the id; the rest map to the selected fields.
  const parseRows = () => text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => {
    const parts = (line.includes('\t') ? line.split('\t') : line.split(',')).map(s => s.trim());
    return { id: parts[0], values: parts.slice(1) };
  });

  const run = async (dryRun) => {
    const rows = parseRows();
    if (!rows.length) return toast.error('Paste at least one "id, value…" line.');
    if (!cols.length && !fillGeo) return toast.error('Pick the field(s) your columns map to.');
    setBusy(true);
    try {
      const r = await client.post('data-cleanup/bulk-by-id', {
        table, fields: cols.map(c => ({ name: c.name, field_type: c.field_type })),
        rows, fill_geo: fillGeo, dry_run: dryRun,
      });
      setRes({ ...r.data, dry_run: dryRun });
      if (!dryRun) { toast.success(`Updated ${r.data.summary.updated} record(s).`); onDone?.(); }
    } catch (e) { toast.error(e.response?.data?.error || 'Bulk update failed'); }
    finally { setBusy(false); }
  };

  const s = res?.summary;
  const problems = (res?.results || []).filter(r => ['not_found', 'error'].includes(r.status));

  return (
    <div className="rounded-2xl p-5 space-y-4" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        Update specific records by their id. Each id targets <strong>one</strong> row in the chosen table —
        transfer and sale ids are different. Paste <code>id, value1, value2…</code> per line, aligned to the fields you pick.
      </p>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
          {['sales', 'transfers'].map(t => (
            <button key={t} type="button" onClick={() => { setTable(t); setRes(null); }} className="px-3 py-1.5 text-xs font-bold capitalize transition-colors"
              style={{ backgroundColor: table === t ? 'var(--color-primary-600)' : 'var(--color-surface)', color: table === t ? '#fff' : 'var(--color-text-secondary)' }}>{t}</button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
          <input type="checkbox" checked={fillGeo} onChange={e => { setFillGeo(e.target.checked); setRes(null); }} />
          Also fill City/State from ZIP
        </label>
      </div>

      <div>
        <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Columns after the id (in order)</label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {cols.length === 0
            ? <span className="text-xs italic" style={{ color: 'var(--color-text-tertiary)' }}>Add fields in the same order as your pasted columns.</span>
            : cols.map((c, i) => (
              <span key={c.name} className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-md" style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>
                <span className="opacity-60">{i + 1}.</span> {c.label} <span className="opacity-60">({c.name})</span>
                <button type="button" onClick={() => rmCol(c.name)}><X size={12} /></button>
              </span>
            ))}
        </div>
        <select value={addPick} onChange={e => e.target.value && addCol(e.target.value)} className="input text-sm">
          <option value="">+ Add a column…</option>
          {available.map(f => <option key={f.id || f.name} value={f.name}>{f.label || f.name} ({f.name})</option>)}
        </select>
      </div>

      <div>
        <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Data (one record per line)</label>
        <textarea value={text} onChange={e => { setText(e.target.value); setRes(null); }} rows={6}
          placeholder={`e2b1…-id, 90210, Camry\n7c4a…-id, 33101, Civic`} className="input font-mono text-xs w-full resize-y" />
        <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>Comma or tab separated. Empty cell = leave that field unchanged. {parseRows().length} line(s).</p>
      </div>

      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => run(true)} disabled={busy} className="flex items-center gap-1.5">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Preview (dry-run)
        </Button>
        <Button variant="primary" onClick={() => run(false)} disabled={busy || !res || res.dry_run === false} className="flex items-center gap-1.5" title={!res ? 'Preview first' : ''}>
          <ListChecks size={15} /> Apply updates
        </Button>
      </div>

      {s && (
        <div className="rounded-xl p-3 space-y-2" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
          <p className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>
            {res.dry_run ? 'Preview' : 'Done'}: {s.updated} {res.dry_run ? 'would update' : 'updated'}
            {s.geo_filled ? ` · ${s.geo_filled} geo-filled` : ''} · {s.not_found} not found · {s.errored} error{s.errored === 1 ? '' : 's'}{s.no_change ? ` · ${s.no_change} no-change` : ''}
          </p>
          {problems.length > 0 && (
            <div className="max-h-40 overflow-y-auto space-y-1">
              {problems.map((p, i) => (
                <div key={i} className="text-[11px] font-mono flex items-center gap-2">
                  <span style={{ color: STATUS_COLOR[p.status] }}>● {p.status}</span>
                  <span style={{ color: 'var(--color-text-secondary)' }}>{p.id || '(no id)'}{p.message ? ` — ${p.message}` : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Fill City/State from ZIP ─────────────────────────────────────────────────
const GeoFillPanel = ({ onDone }) => {
  const [table, setTable] = useState('sales');
  const [busy, setBusy]   = useState(false);
  const [res, setRes]     = useState(null);

  const run = async (dryRun) => {
    setBusy(true);
    try {
      const r = await client.post('data-cleanup/fill-geo', { table, dry_run: dryRun, limit: 200 });
      setRes({ ...r.data, dry_run: dryRun });
      if (!dryRun) { toast.success(`Filled ${r.data.summary.filled} record(s).`); onDone?.(); }
    } catch (e) { toast.error(e.response?.data?.error || 'Geo-fill failed'); }
    finally { setBusy(false); }
  };

  const s = res?.summary;
  return (
    <div className="rounded-2xl p-5 space-y-4" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        Find records that have a <strong>ZIP</strong> but a blank <strong>City</strong> or <strong>State</strong>, and fill them from the ZIP lookup. Up to 200 per run.
      </p>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
          {['sales', 'transfers'].map(t => (
            <button key={t} type="button" onClick={() => { setTable(t); setRes(null); }} className="px-3 py-1.5 text-xs font-bold capitalize transition-colors"
              style={{ backgroundColor: table === t ? 'var(--color-primary-600)' : 'var(--color-surface)', color: table === t ? '#fff' : 'var(--color-text-secondary)' }}>{t}</button>
          ))}
        </div>
        <Button variant="secondary" onClick={() => run(true)} disabled={busy} className="flex items-center gap-1.5">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Scan
        </Button>
        <Button variant="primary" onClick={() => run(false)} disabled={busy} className="flex items-center gap-1.5">
          <MapPin size={15} /> Fill now
        </Button>
      </div>
      {s && (
        <div className="rounded-xl p-3 space-y-2" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
          <p className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>
            {res.dry_run ? 'Scan' : 'Done'}: {s.filled} {res.dry_run ? 'to fill' : 'filled'} · {s.failed} failed · {s.candidates} candidate(s) of {s.scanned} scanned
          </p>
          <div className="max-h-44 overflow-y-auto space-y-1">
            {(res.results || []).slice(0, 60).map((r, i) => (
              <div key={i} className="text-[11px] font-mono flex items-center gap-2">
                <span style={{ color: STATUS_COLOR[r.status] || 'var(--color-text-tertiary)' }}>● {r.status}</span>
                <span style={{ color: 'var(--color-text-secondary)' }}>{r.zip}{r.city ? ` → ${r.city}, ${r.state}` : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Set disposition on transfers by id ───────────────────────────────────────
// Paste "transfer_id, disposition, closer name". The disposition must match a
// real configured disposition; the closer must match exactly one real closer's
// full name. Dry-run first; every mismatch is reported, never guessed.
const DispositionPanel = ({ onDone }) => {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes]   = useState(null);
  const [names, setNames] = useState([]);
  const [codes, setCodes] = useState({});
  useEffect(() => { client.get('data-cleanup/dispo-names').then(r => { setNames(r.data.names || []); setCodes(r.data.codes || {}); }).catch(() => {}); }, []);

  const parseRows = () => text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => {
    const p = (line.includes('\t') ? line.split('\t') : line.split(',')).map(s => s.trim());
    return { id: p[0], disposition: p[1] || '', closer: p.slice(2).join(' ').trim() };
  });

  const run = async (dryRun) => {
    const rows = parseRows();
    if (!rows.length) return toast.error('Paste at least one "id, disposition, closer" line.');
    setBusy(true);
    try {
      const r = await client.post('data-cleanup/bulk-disposition', { rows, dry_run: dryRun });
      setRes({ ...r.data, dry_run: dryRun });
      if (!dryRun) { toast.success(`Applied ${r.data.summary.applied} disposition(s).`); onDone?.(); }
    } catch (e) { toast.error(e.response?.data?.error || 'Disposition update failed'); }
    finally { setBusy(false); }
  };

  const s = res?.summary;
  const problems = (res?.results || []).filter(r => ['not_found', 'error'].includes(r.status));

  return (
    <div className="rounded-2xl p-5 space-y-4" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        Set the real disposition (and closer) on transfers that came from manual entry or bulk upload and never got a dialer dispo.
        One line per record: <code>transfer_id, disposition, closer name</code>. The disposition can be the <strong>full name</strong> or
        the dialer <strong>short code</strong> (e.g. <code>CALLBK</code>) — both resolve to the real disposition + its colour. Comma or tab separated; closer is optional.
      </p>

      {names.length > 0 && (
        <div className="rounded-lg p-2.5 text-[11px] space-y-1" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          <div><span className="font-bold" style={{ color: 'var(--color-text-secondary)' }}>Valid dispositions: </span>
            <span style={{ color: 'var(--color-text)' }}>{names.join(' · ')}</span></div>
          {Object.keys(codes).length > 0 && (
            <div><span className="font-bold" style={{ color: 'var(--color-text-secondary)' }}>Short codes: </span>
              <span style={{ color: 'var(--color-text)' }}>{Object.entries(codes).map(([c, n]) => `${c} → ${n}`).join(' · ')}</span></div>
          )}
        </div>
      )}

      <div>
        <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Data</label>
        <textarea value={text} onChange={e => { setText(e.target.value); setRes(null); }} rows={6}
          placeholder={`e2b1…-id, Sale, John Smith\n7c4a…-id, No Sale, Jane Doe`} className="input font-mono text-xs w-full resize-y" />
        <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
          Closer name must exactly match a real closer's full name (first + last). {parseRows().length} line(s).
        </p>
      </div>

      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => run(true)} disabled={busy} className="flex items-center gap-1.5">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Preview (dry-run)
        </Button>
        <Button variant="primary" onClick={() => run(false)} disabled={busy || !res || res.dry_run === false} className="flex items-center gap-1.5" title={!res ? 'Preview first' : ''}>
          <Tag size={15} /> Apply dispositions
        </Button>
      </div>

      {s && (
        <div className="rounded-xl p-3 space-y-2" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
          <p className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>
            {res.dry_run ? 'Preview' : 'Done'}: {s.applied} {res.dry_run ? 'would apply' : 'applied'} · {s.not_found} not found · {s.errored} error{s.errored === 1 ? '' : 's'}
          </p>
          {problems.length > 0 && (
            <div className="max-h-44 overflow-y-auto space-y-1">
              {problems.map((p, i) => (
                <div key={i} className="text-[11px] font-mono flex items-center gap-2">
                  <span style={{ color: STATUS_COLOR[p.status] }}>● {p.status}</span>
                  <span style={{ color: 'var(--color-text-secondary)' }}>{p.id || '(no id)'}{p.message ? ` — ${p.message}` : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Superadmin batch find/replace. Search ONE or MANY form fields at once (great
// for the same dirty value scattered across fields), see the distinct values per
// field, then click one to replace it precisely. Replace is always single
// field + exact value so every change is logged and one-click revertible.
const DataCleanup = () => {
  const { fields, fetchFields } = useFormFields();
  useEffect(() => { fetchFields(); }, [fetchFields]);

  // ── search (multi-field) ──
  const [searchFields, setSearchFields] = useState([]);   // [{ name, field_type, label }]
  const [matchBlank, setMatchBlank]     = useState(false);
  const [mode, setMode]                 = useState('exact'); // 'exact' | 'contains'
  const [searchValue, setSearchValue]   = useState('');
  const [preview, setPreview]           = useState(null);

  // ── replace (single target) ──
  const [target, setTarget]   = useState(null);   // { field, field_type, label, value, matchBlank }
  const [newValue, setNewValue] = useState('');

  const [busy, setBusy]       = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [ack, setAck]         = useState(false);
  const [result, setResult]   = useState(null);
  const [history, setHistory] = useState([]);
  const [revertId, setRevertId] = useState(null);
  const [addPick, setAddPick] = useState('');
  const [tab, setTab] = useState('replace');   // 'replace' | 'bulk' | 'geo'

  const labelOf = useCallback((name) => (fields || []).find(f => f.name === name)?.label || name, [fields]);
  const available = useMemo(
    () => (fields || []).filter(f => !searchFields.some(s => s.name === f.name)),
    [fields, searchFields],
  );

  const loadHistory = useCallback(() => {
    client.get('data-cleanup/history').then(r => setHistory(r.data.operations || [])).catch(() => {});
  }, []);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const resetSearch = () => { setPreview(null); setTarget(null); setResult(null); };

  const addField = (name) => {
    const f = (fields || []).find(x => x.name === name);
    if (!f) return;
    setSearchFields(s => s.some(x => x.name === name) ? s : [...s, { name: f.name, field_type: f.field_type, label: f.label || f.name }]);
    setAddPick(''); resetSearch();
  };
  const removeField = (name) => { setSearchFields(s => s.filter(x => x.name !== name)); resetSearch(); };

  const canSearch = searchFields.length > 0 && (matchBlank || searchValue.trim() !== '');

  const runSearch = async () => {
    if (!canSearch) return;
    setBusy(true); setResult(null); setTarget(null);
    try {
      const r = await client.post('data-cleanup/preview', {
        fields: searchFields.map(f => ({ name: f.name, field_type: f.field_type })),
        old_value: searchValue, match_blank: matchBlank, mode,
      });
      setPreview(r.data);
      if (!r.data.grand_total) toast.info(matchBlank ? 'No blank records in those fields.' : (mode === 'contains' ? 'No values contain that text.' : 'No records have exactly that value.'));
    } catch (e) { toast.error(e.response?.data?.error || 'Search failed'); setPreview(null); }
    finally { setBusy(false); }
  };

  // Click a distinct value → load it as the single replace target.
  const pickTarget = (res, value) => {
    setTarget({ field: res.field, field_type: res.field_type, label: labelOf(res.field), value, matchBlank });
    setNewValue(''); setResult(null);
  };

  const canRun = target && newValue.trim() !== '' && (target.matchBlank || target.value !== newValue);

  // Type the value → Enter opens the confirm with the ack already checked → Enter
  // again runs it. Keyboard-only, no mouse needed.
  const openConfirm = () => { if (!canRun) return; setAck(true); setConfirm(true); };

  const execute = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const r = await client.post('data-cleanup/execute', {
        field: target.field, field_type: target.field_type,
        old_value: target.value, new_value: newValue, match_blank: target.matchBlank,
      });
      setResult(r.data);
      setConfirm(false); setAck(false); setTarget(null); setNewValue('');
      toast.success(`Updated ${r.data.updated} record${r.data.updated === 1 ? '' : 's'}.`);
      loadHistory();
      runSearch();   // refresh the search so the fixed value drops out
    } catch (e) { toast.error(e.response?.data?.error || 'Update failed'); }
    finally { setBusy(false); }
  };

  // While the confirm modal is open: Enter runs it (ack pre-checked), Esc cancels.
  useEffect(() => {
    if (!confirm) return;
    const onKey = (e) => {
      if (e.key === 'Enter')  { e.preventDefault(); if (ack && !busy) execute(); }
      if (e.key === 'Escape') { e.preventDefault(); setConfirm(false); setAck(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // re-bind each render so `execute` + `ack` + `busy` stay fresh

  const revert = async (op) => {
    const isBulk = op.field_type === 'bulk_by_id' || op.field_type === 'fill_geo';
    const msg = isBulk
      ? `Revert "${op.field}"? Previous values will be restored on the ${op.counts?.total ?? 0} record(s) it changed.`
      : `Revert this change? "${op.new_value}" will be set back to ${op.match_blank ? 'blank' : `"${op.old_value}"`} on the ${op.counts?.total} record(s) it changed.`;
    if (!window.confirm(msg)) return;
    setRevertId(op.id);
    try {
      const r = await client.post(`data-cleanup/revert/${op.id}`);
      toast.success(`Reverted ${r.data.reverted} record${r.data.reverted === 1 ? '' : 's'}.`);
      loadHistory();
    } catch (e) { toast.error(e.response?.data?.error || 'Revert failed'); }
    finally { setRevertId(null); }
  };

  const FieldResult = ({ res }) => {
    const vals = res.values || [];
    return (
      <div className="rounded-xl p-3 space-y-2" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold truncate" style={{ color: res.total ? 'var(--color-primary-700)' : 'var(--color-text-tertiary)' }}>
            {labelOf(res.field)} <span className="font-medium opacity-60">({res.field})</span>
          </p>
          <span className="text-xs font-bold px-2 py-0.5 rounded flex-shrink-0" style={{ backgroundColor: res.total ? 'var(--color-primary-100)' : 'var(--color-bg-secondary)', color: res.total ? 'var(--color-primary-700)' : 'var(--color-text-tertiary)' }}>
            {res.total} match{res.total === 1 ? '' : 'es'}
          </span>
        </div>
        {res.total === 0 ? (
          <p className="text-xs italic" style={{ color: 'var(--color-text-tertiary)' }}>Nothing here.</p>
        ) : (
          <>
            <p className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
              {res.counts.transfers_form_data} transfers · {res.counts.sales_form_data} sales{res.column ? ` · +${res.counts.sales_column} ${res.column}` : ''}
            </p>
            <div className="flex flex-wrap gap-1.5 max-h-44 overflow-y-auto">
              {vals.map((v, i) => {
                const isSel = target && target.field === res.field && target.value === v.value;
                return (
                  <button key={i} type="button" onClick={() => pickTarget(res, v.value)} title="Load as the value to replace"
                    className="text-xs font-semibold px-2 py-1 rounded-md transition-colors flex items-center gap-1"
                    style={{ backgroundColor: isSel ? 'var(--color-primary-600)' : 'var(--color-surface)', color: isSel ? 'white' : 'var(--color-text)', border: `1px solid ${isSel ? 'var(--color-primary-600)' : 'var(--color-border)'}` }}>
                    <span className="font-mono">{v.value === '' ? '(blank)' : v.value}</span>
                    <span className="text-[10px] font-bold px-1 rounded" style={{ backgroundColor: isSel ? 'rgba(255,255,255,0.25)' : 'var(--color-primary-100)', color: isSel ? 'white' : 'var(--color-primary-700)' }}>{v.count}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  };

  const fromLabel = target ? (target.matchBlank ? '(blank)' : `“${target.value === '' ? '(blank)' : target.value}”`) : '';

  const TABS = [
    { key: 'replace', label: 'Find & Replace', icon: Search },
    { key: 'bulk',    label: 'Bulk update by ID', icon: ListChecks },
    { key: 'dispo',   label: 'Set Disposition', icon: Tag },
    { key: 'geo',     label: 'Fill City/State', icon: MapPin },
  ];

  return (
    <div className="max-w-3xl space-y-5">
      {/* Header */}
      <div className="rounded-2xl p-6 relative overflow-hidden" style={{ background: 'var(--gradient-sidebar)' }}>
        <div className="relative z-10 flex items-center gap-2.5">
          <Eraser size={22} className="text-white" />
          <div>
            <h2 className="text-2xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>Data Cleanup</h2>
            <p className="text-sm text-white/80">Search & fix dirty values, bulk-update by record id, or fill City/State from ZIP — every change is logged and revertible.</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {TABS.map(t => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className="flex items-center gap-1.5 text-sm font-bold px-3 py-2 rounded-xl transition-colors"
            style={{ background: tab === t.key ? 'var(--gradient-sidebar)' : 'var(--color-surface)', color: tab === t.key ? '#fff' : 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'bulk'  && <BulkByIdPanel fields={fields} onDone={loadHistory} />}
      {tab === 'dispo' && <DispositionPanel onDone={loadHistory} />}
      {tab === 'geo'   && <GeoFillPanel onDone={loadHistory} />}

      {tab === 'replace' && (
      <div className="rounded-2xl p-5 space-y-4" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        {/* Field picker (multi) */}
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Fields to search</label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {searchFields.length === 0
              ? <span className="text-xs italic" style={{ color: 'var(--color-text-tertiary)' }}>Add one or more fields below.</span>
              : searchFields.map(f => (
                <span key={f.name} className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-md" style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>
                  {f.label} <span className="opacity-60">({f.name})</span>
                  <button type="button" onClick={() => removeField(f.name)} className="hover:opacity-70"><X size={12} /></button>
                </span>
              ))}
          </div>
          <div className="flex items-center gap-2">
            <select value={addPick} onChange={e => { if (e.target.value) addField(e.target.value); }} className="input text-sm flex-1">
              <option value="">+ Add a field…</option>
              {available.map(f => <option key={f.id || f.name} value={f.name}>{f.label || f.name} ({f.name})</option>)}
            </select>
            {available.length > 0 && (
              <button type="button" onClick={() => { setSearchFields((fields || []).map(f => ({ name: f.name, field_type: f.field_type, label: f.label || f.name }))); resetSearch(); }}
                className="text-xs font-bold px-2.5 py-2 rounded-lg flex items-center gap-1 flex-shrink-0" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }} title="Add all fields">
                <Plus size={13} /> All
              </button>
            )}
          </div>
        </div>

        {/* Blank toggle */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={matchBlank} onChange={e => { setMatchBlank(e.target.checked); resetSearch(); }} />
          <span className="text-sm" style={{ color: 'var(--color-text)' }}>Find <strong>empty / blank</strong> records and fill them</span>
        </label>

        {/* Match mode + search value */}
        {!matchBlank && (
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Match</label>
              <div className="flex rounded-lg overflow-hidden w-fit" style={{ border: '1px solid var(--color-border)' }}>
                {[['exact', 'Exact'], ['contains', 'Contains (search)']].map(([m, l]) => (
                  <button key={m} type="button" onClick={() => { setMode(m); resetSearch(); }} className="px-3 py-1.5 text-xs font-bold transition-colors"
                    style={{ backgroundColor: mode === m ? 'var(--color-primary-600)' : 'var(--color-surface)', color: mode === m ? 'white' : 'var(--color-text-secondary)' }}>{l}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>{mode === 'contains' ? 'Search text (contains)' : 'Exact value'}</label>
              <input value={searchValue} onChange={e => { setSearchValue(e.target.value); resetSearch(); }} className="input"
                placeholder={mode === 'contains' ? 'e.g. k  (finds 60k, 150K, “60k mi”…)' : 'Hodna'} />
            </div>
          </div>
        )}

        <p className="text-xs flex items-start gap-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
          <Database size={13} className="mt-0.5 flex-shrink-0" />
          {matchBlank ? 'Blank = missing or empty value across the selected fields.'
            : mode === 'contains' ? 'Contains = case-insensitive search across every selected field.'
            : 'Exact match (case-sensitive) across every selected field.'}
          {' '}Click a value in the results to replace it precisely. Every change is revertible below.
        </p>

        <Button variant="secondary" onClick={runSearch} disabled={!canSearch || busy} className="flex items-center gap-1.5">
          {busy && !confirm ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} {matchBlank ? 'Find blanks' : (mode === 'contains' ? 'Search' : 'Preview')}
        </Button>

        {/* Per-field results */}
        {preview && (
          <div className="space-y-2">
            <p className="text-sm font-bold" style={{ color: preview.grand_total ? 'var(--color-primary-700)' : 'var(--color-text-tertiary)' }}>
              {preview.grand_total} total match{preview.grand_total === 1 ? '' : 'es'} across {preview.results.length} field{preview.results.length === 1 ? '' : 's'}
            </p>
            {preview.results.map(res => <FieldResult key={res.field} res={res} />)}
          </div>
        )}

        {/* Replace target */}
        {target && (
          <div className="rounded-xl p-3 space-y-3" style={{ border: '2px solid var(--color-primary-300)', backgroundColor: 'var(--color-primary-50)' }}>
            <p className="text-sm font-bold" style={{ color: 'var(--color-primary-700)' }}>
              {target.matchBlank ? <>Fill blanks in <strong>{target.label}</strong></> : <>Replace {fromLabel} in <strong>{target.label}</strong></>}
            </p>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>{target.matchBlank ? 'Fill with' : 'Correct value'}</label>
              <input value={newValue} onChange={e => { setNewValue(e.target.value); setResult(null); }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); openConfirm(); } }}
                className="input" placeholder="Honda  (Enter to apply)" autoFocus />
            </div>
            <div className="flex gap-2">
              <Button variant="primary" onClick={openConfirm} disabled={!canRun || busy} className="flex items-center gap-1.5">
                <Eraser size={15} /> {target.matchBlank ? 'Fill all' : 'Replace all'}
              </Button>
              <Button variant="secondary" onClick={() => { setTarget(null); setNewValue(''); }} disabled={busy}>Cancel</Button>
            </div>
          </div>
        )}

        {result && (
          <div className="rounded-xl p-3 flex items-start gap-2" style={{ backgroundColor: 'var(--color-success-50, #f0fdf4)', border: '1px solid var(--color-success-200, #bbf7d0)' }}>
            <CheckCircle2 size={16} style={{ color: 'var(--color-success-600)' }} className="mt-0.5 flex-shrink-0" />
            <p className="text-sm font-bold" style={{ color: 'var(--color-success-700, #15803d)' }}>Updated {result.updated} record{result.updated === 1 ? '' : 's'}. Revert it from the history below if needed.</p>
          </div>
        )}
      </div>
      )}

      {/* History */}
      <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <h3 className="text-base font-bold flex items-center gap-2 mb-3" style={{ color: 'var(--color-text)' }}>
          <History size={17} style={{ color: 'var(--color-primary-600)' }} /> Change history
        </h3>
        {history.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No cleanups yet.</p>
        ) : (
          <div className="space-y-1.5">
            {history.map(op => (
              <div key={op.id} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>
                    {(op.field_type === 'bulk_by_id' || op.field_type === 'fill_geo')
                      ? <>{op.field} — {op.new_value}</>
                      : <>{op.field}: {op.match_blank ? <em>blank</em> : `“${op.old_value}”`} → “{op.new_value}”</>}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    {op.counts?.total ?? 0} record(s) · {fmt(op.performed_at)} · {op.performed_by_name}
                    {op.reverted_at && <span style={{ color: 'var(--color-text-tertiary)' }}> · reverted {fmt(op.reverted_at)}</span>}
                  </p>
                </div>
                {op.reverted_at ? (
                  <span className="text-xs font-semibold px-2 py-1 rounded-lg flex-shrink-0" style={{ color: 'var(--color-text-tertiary)', border: '1px solid var(--color-border)' }}>Reverted</span>
                ) : (
                  <button onClick={() => revert(op)} disabled={revertId === op.id}
                    className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded-lg transition-colors flex-shrink-0 disabled:opacity-50"
                    style={{ color: 'var(--color-error-600)', border: '1px solid var(--color-error-300)' }}>
                    {revertId === op.id ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />} Revert
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Double-confirm modal */}
      {confirm && target && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-md p-6 rounded-2xl animate-scale-in" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}>
            <h3 className="text-lg font-bold mb-1 flex items-center gap-2" style={{ color: 'var(--color-error-600)' }}>
              <AlertTriangle size={18} /> Are you sure?
            </h3>
            <p className="text-sm mb-3" style={{ color: 'var(--color-text-secondary)' }}>
              {target.matchBlank ? <>Fill blank record(s)</> : <>Replace <strong>{fromLabel}</strong> with <strong>“{newValue}”</strong></>}
              {' '}in <strong>{target.label}</strong>. You can revert this from the history.
            </p>
            <label className="flex items-center gap-2 mb-1.5 cursor-pointer select-none">
              <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
              <span className="text-sm" style={{ color: 'var(--color-text)' }}>I understand this changes the data.</span>
            </label>
            <p className="text-[11px] mb-4" style={{ color: 'var(--color-text-tertiary)' }}>Press <strong>Enter</strong> to confirm · <strong>Esc</strong> to cancel.</p>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => { setConfirm(false); setAck(false); }} className="flex-1" disabled={busy}>Cancel</Button>
              <Button variant="danger" onClick={execute} disabled={!ack || busy} className="flex-1 flex items-center justify-center gap-1.5">
                {busy ? <><Loader2 size={15} className="animate-spin" /> Working…</> : <>{target.matchBlank ? 'Fill' : 'Replace'}</>}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DataCleanup;
