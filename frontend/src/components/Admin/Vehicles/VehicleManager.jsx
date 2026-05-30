import { useState, useEffect, useCallback, useRef } from 'react';
import { Car, Plus, Trash2, Loader2, Search, ChevronRight, Pencil, Check, X } from 'lucide-react';
import { Button, Alert } from '../../UI';
import client from '../../../api/client';

// Tiny inline-edit pill — click pencil, edit, Enter/click-check to save,
// Escape/click-X to cancel. Keeps the row layout the same width so the
// list doesn't reflow while editing.
const EditableName = ({ name, onSave, busy = false }) => {
  const [editing, setEditing] = useState(false);
  const [val, setVal]         = useState(name);
  const inputRef = useRef(null);

  useEffect(() => { if (editing) { setVal(name); setTimeout(() => inputRef.current?.select(), 0); } }, [editing, name]);

  const save = async () => {
    const trimmed = String(val || '').replace(/\s+/g, ' ').trim();
    if (!trimmed || trimmed === name) { setEditing(false); return; }
    try { await onSave(trimmed); setEditing(false); } catch { /* parent surfaces the error */ }
  };

  if (!editing) {
    return (
      <span className="flex-1 flex items-center gap-1.5 min-w-0">
        <span className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{name}</span>
        <button type="button" onClick={(e) => { e.stopPropagation(); setEditing(true); }}
          title="Rename" className="p-0.5 rounded hover:bg-bg-secondary opacity-0 group-hover:opacity-60 hover:opacity-100 transition-opacity">
          <Pencil size={11} style={{ color: 'var(--color-text-tertiary)' }} />
        </button>
      </span>
    );
  }

  return (
    <span className="flex-1 flex items-center gap-1 min-w-0" onClick={(e) => e.stopPropagation()}>
      <input ref={inputRef} value={val} onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save(); else if (e.key === 'Escape') setEditing(false); }}
        disabled={busy} className="input text-sm py-1 px-1.5 flex-1 min-w-0" />
      <button type="button" onClick={save} disabled={busy} title="Save" className="p-1 rounded hover:bg-success-50">
        {busy ? <Loader2 size={11} className="animate-spin" style={{ color: 'var(--color-text-tertiary)' }} />
              : <Check size={11} style={{ color: 'var(--color-success-600)' }} />}
      </button>
      <button type="button" onClick={() => setEditing(false)} disabled={busy} title="Cancel" className="p-1 rounded hover:bg-error-50">
        <X size={11} style={{ color: 'var(--color-error-500)' }} />
      </button>
    </span>
  );
};

// VehicleManager — Admin → Form Config → Vehicles. Two-column layout: the
// left column is a CSV-paste box for makes + the list of makes (click to
// activate); the right column is a CSV-paste box for the active make's
// models + its model list. Pastes accept comma, newline, tab, pipe, or
// semicolon as separators so spreadsheets paste cleanly without massaging.
const VehicleManager = () => {
  const [makes, setMakes]       = useState([]);
  const [active, setActive]     = useState(null);
  const [loading, setLoading]   = useState(false);
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState('');
  const [makeCsv, setMakeCsv]   = useState('');
  const [modelCsv, setModelCsv] = useState('');
  const [makeSearch, setMakeSearch]   = useState('');
  const [modelSearch, setModelSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const r = await client.get('vehicles');
      setMakes(r.data.makes || []);
      // Re-resolve `active` from the freshly-loaded list so its `models` array
      // reflects whatever just got added/deleted.
      setActive(prev => prev ? (r.data.makes || []).find(m => m.id === prev.id) || null : null);
    } catch (e) { setErr(e.response?.data?.error || 'Failed to load vehicles'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const addMakes = async () => {
    if (!makeCsv.trim()) return;
    setBusy(true); setErr('');
    try { await client.post('vehicles/makes/bulk', { csv: makeCsv }); setMakeCsv(''); await load(); }
    catch (e) { setErr(e.response?.data?.error || 'Failed to add makes'); }
    finally { setBusy(false); }
  };

  const addModels = async () => {
    if (!active || !modelCsv.trim()) return;
    setBusy(true); setErr('');
    try { await client.post('vehicles/models/bulk', { make_id: active.id, csv: modelCsv }); setModelCsv(''); await load(); }
    catch (e) { setErr(e.response?.data?.error || 'Failed to add models'); }
    finally { setBusy(false); }
  };

  const deleteMake = async (m) => {
    if (!window.confirm(`Delete "${m.name}" and all its models?`)) return;
    setBusy(true); setErr('');
    try { await client.delete(`vehicles/makes/${m.id}`); if (active?.id === m.id) setActive(null); await load(); }
    catch (e) { setErr(e.response?.data?.error || 'Failed to delete make'); }
    finally { setBusy(false); }
  };

  const deleteModel = async (m) => {
    setBusy(true); setErr('');
    try { await client.delete(`vehicles/models/${m.id}`); await load(); }
    catch (e) { setErr(e.response?.data?.error || 'Failed to delete model'); }
    finally { setBusy(false); }
  };

  // Rename a make / model in the registry. Existing form rows that reference
  // the OLD name don't update (the value is denormalized into form_data /
  // sales.car_make), but the Data Analyzer's case-insensitive match on
  // make/model fields keeps the breakdown coherent across the rename.
  const renameMake = async (m, name) => {
    setErr('');
    try { await client.put(`vehicles/makes/${m.id}`, { name }); await load(); }
    catch (e) { setErr(e.response?.data?.error || 'Failed to rename make'); throw e; }
  };
  const renameModel = async (m, name) => {
    setErr('');
    try { await client.put(`vehicles/models/${m.id}`, { name }); await load(); }
    catch (e) { setErr(e.response?.data?.error || 'Failed to rename model'); throw e; }
  };

  const filteredMakes = makes.filter(m => m.name.toLowerCase().includes(makeSearch.trim().toLowerCase()));
  const activeModels  = (active?.models || []).filter(m => m.name.toLowerCase().includes(modelSearch.trim().toLowerCase()));

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="rounded-2xl p-6 flex items-center justify-between flex-wrap gap-3" style={{ background: 'var(--gradient-sidebar)' }}>
        <div className="flex items-center gap-2.5">
          <Car size={22} className="text-white" />
          <div>
            <h2 className="text-2xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>Vehicles</h2>
            <p className="text-sm text-white/80">Paste a CSV of makes; click a make to paste its models. Forms will use these for typeaheads.</p>
          </div>
        </div>
        <span className="text-xs text-white/70">
          {makes.length} makes · {makes.reduce((n, m) => n + (m.models?.length || 0), 0)} models
        </span>
      </div>

      {err && <Alert type="error" message={err} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ── Makes column ────────────────────────────────────────────── */}
        <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <h3 className="text-sm font-bold flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
            <Car size={14} /> Makes
          </h3>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-text-secondary)' }}>
              Paste CSV (Toyota, Ford, Honda…)
            </label>
            <textarea value={makeCsv} onChange={e => setMakeCsv(e.target.value)} rows={3}
              className="input text-sm" placeholder="Toyota, Ford, Honda, Chevrolet, BMW" />
            <Button onClick={addMakes} disabled={busy || !makeCsv.trim()} variant="primary" className="mt-2 w-full text-sm">
              {busy ? <Loader2 size={14} className="animate-spin inline mr-1" /> : <Plus size={14} className="inline mr-1" />}
              Add makes
            </Button>
          </div>

          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
            <input value={makeSearch} onChange={e => setMakeSearch(e.target.value)} placeholder="Filter makes…" className="input text-sm pl-8" />
          </div>

          <div className="max-h-96 overflow-y-auto space-y-1 pr-1">
            {loading
              ? <p className="text-xs italic py-2" style={{ color: 'var(--color-text-tertiary)' }}>Loading…</p>
              : filteredMakes.length === 0
                ? <p className="text-xs italic py-2" style={{ color: 'var(--color-text-tertiary)' }}>No makes yet. Paste a CSV above.</p>
                : filteredMakes.map(m => {
                  const on = active?.id === m.id;
                  return (
                    <div key={m.id}
                      className="group flex items-center gap-2 px-2.5 py-1.5 rounded-md transition-colors"
                      style={{ backgroundColor: on ? 'var(--color-primary-100)' : 'transparent', border: '1px solid', borderColor: on ? 'var(--color-primary-300)' : 'transparent' }}>
                      <EditableName name={m.name} onSave={(n) => renameMake(m, n)} busy={busy} />
                      <button onClick={() => setActive(m)} className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                        {m.models?.length || 0} models
                        <ChevronRight size={12} />
                      </button>
                      <button onClick={() => deleteMake(m)} title="Delete make" className="p-1 rounded hover:bg-error-50">
                        <Trash2 size={12} style={{ color: 'var(--color-error-500)' }} />
                      </button>
                    </div>
                  );
                })}
          </div>
        </div>

        {/* ── Models column ───────────────────────────────────────────── */}
        <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <h3 className="text-sm font-bold flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
            <Car size={14} /> Models {active && <span className="text-xs font-normal" style={{ color: 'var(--color-text-tertiary)' }}>· for <strong style={{ color: 'var(--color-primary-700)' }}>{active.name}</strong></span>}
          </h3>

          {!active ? (
            <p className="text-xs italic py-4" style={{ color: 'var(--color-text-tertiary)' }}>Pick a make on the left to manage its models.</p>
          ) : (
            <>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                  Paste CSV (Camry, Corolla, RAV4…)
                </label>
                <textarea value={modelCsv} onChange={e => setModelCsv(e.target.value)} rows={3}
                  className="input text-sm" placeholder="Camry, Corolla, RAV4, Highlander" />
                <Button onClick={addModels} disabled={busy || !modelCsv.trim()} variant="primary" className="mt-2 w-full text-sm">
                  {busy ? <Loader2 size={14} className="animate-spin inline mr-1" /> : <Plus size={14} className="inline mr-1" />}
                  Add models to {active.name}
                </Button>
              </div>

              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
                <input value={modelSearch} onChange={e => setModelSearch(e.target.value)} placeholder="Filter models…" className="input text-sm pl-8" />
              </div>

              <div className="max-h-96 overflow-y-auto space-y-1 pr-1">
                {activeModels.length === 0
                  ? <p className="text-xs italic py-2" style={{ color: 'var(--color-text-tertiary)' }}>No models yet.</p>
                  : activeModels.map(m => (
                    <div key={m.id} className="group flex items-center gap-2 justify-between px-2.5 py-1.5 rounded-md"
                      style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                      <EditableName name={m.name} onSave={(n) => renameModel(m, n)} busy={busy} />
                      <button onClick={() => deleteModel(m)} title="Delete model" className="p-1 rounded hover:bg-error-50">
                        <Trash2 size={12} style={{ color: 'var(--color-error-500)' }} />
                      </button>
                    </div>
                  ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default VehicleManager;
