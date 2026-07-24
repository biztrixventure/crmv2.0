import { useState, useEffect, useCallback, useMemo } from 'react';
import { Tag, Plus, Trash2, Loader2, Search, ChevronRight, Save, Briefcase, Link2 } from 'lucide-react';
import { Button, Alert } from '../../UI';
import HideDeleteMenu from '../../UI/HideDeleteMenu';
import client from '../../../api/client';

// ClientPlanManager — Admin → Clients. Two-column layout that mirrors the
// VehicleManager pattern: the left column holds clients (paste CSV to add,
// click a row to activate, trash to delete); the right column holds the
// global plan catalog plus per-client plan checkboxes for the active client.
//
// Data sources:
//   * sale_configs (type='client', type='plan')           — flat catalog
//   * form_fields rows where field_type='sale_plan'.options — the
//     [{client, plans: []}] mapping that drives the cascading dropdown in
//     SaleForm / TransferFormModal AND the cascading filter in DataAnalyzer
//
// Save semantics: client and plan adds POST to /sale-configs immediately
// (so they appear globally without an explicit "save"). The per-client plan
// mapping is staged client-side and committed via the "Save Mapping" button
// to keep partial selections from leaking into the live form mid-edit.
const ClientPlanManager = () => {
  const [clients, setClients]     = useState([]);
  const [plans,   setPlans]       = useState([]);
  const [planField, setPlanField] = useState(null);   // form_fields row for sale_plan
  const [active,  setActive]      = useState(null);   // currently selected client row
  const [mapping, setMapping]     = useState({});     // { clientValue: Set(planValue) }
  const [loading, setLoading]     = useState(false);
  const [busy,    setBusy]        = useState(false);
  const [saving,  setSaving]      = useState(false);
  const [err,     setErr]         = useState('');
  const [clientCsv, setClientCsv] = useState('');
  const [planCsv,   setPlanCsv]   = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [planSearch,   setPlanSearch]   = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const [c, p, f] = await Promise.all([
        client.get('sale-configs?type=client&includeHidden=1'),
        client.get('sale-configs?type=plan&includeHidden=1'),
        client.get('forms/fields'),
      ]);
      const cl = (c.data.configs || []).sort((a, b) => a.value.localeCompare(b.value));
      const pl = (p.data.configs || []).sort((a, b) => a.value.localeCompare(b.value));
      const planRow = (f.data.fields || []).find(x => x.field_type === 'sale_plan') || null;
      setClients(cl);
      setPlans(pl);
      setPlanField(planRow);

      // Hydrate the staged mapping from the live sale_plan options so opening
      // the screen always reflects what's actually saved.
      const next = {};
      const opts = Array.isArray(planRow?.options) ? planRow.options : [];
      opts.forEach(o => { next[o.client] = new Set(o.plans || []); });
      setMapping(next);

      // Re-resolve `active` so its plan checks reflect the freshest mapping.
      setActive(prev => prev ? cl.find(x => x.id === prev.id) || cl[0] || null : (cl[0] || null));
    } catch (e) { setErr(e.response?.data?.error || 'Failed to load clients / plans'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Split a CSV / newline / pipe / semicolon paste into trimmed values, dedupe
  // case-insensitively against what's already in `existing` so a second paste
  // of the same content doesn't double up the catalog.
  const parseCsv = (raw, existing) => {
    const have = new Set(existing.map(x => x.value.toLowerCase()));
    const out = [];
    const seen = new Set();
    raw.split(/[,\n\r\t|;]+/).map(s => s.trim()).filter(Boolean).forEach(v => {
      const k = v.toLowerCase();
      if (have.has(k) || seen.has(k)) return;
      seen.add(k);
      out.push(v);
    });
    return out;
  };

  const addClients = async () => {
    const names = parseCsv(clientCsv, clients);
    if (!names.length) { setClientCsv(''); return; }
    setBusy(true); setErr('');
    try {
      for (const value of names) {
        try { await client.post('sale-configs', { type: 'client', value }); }
        catch (e) { if (e.response?.status !== 409) throw e; }   // swallow dupes
      }
      setClientCsv('');
      await load();
    } catch (e) { setErr(e.response?.data?.error || 'Failed to add clients'); }
    finally { setBusy(false); }
  };

  const addPlans = async () => {
    const names = parseCsv(planCsv, plans);
    if (!names.length) { setPlanCsv(''); return; }
    setBusy(true); setErr('');
    try {
      for (const value of names) {
        try { await client.post('sale-configs', { type: 'plan', value }); }
        catch (e) { if (e.response?.status !== 409) throw e; }
      }
      setPlanCsv('');
      await load();
    } catch (e) { setErr(e.response?.data?.error || 'Failed to add plans'); }
    finally { setBusy(false); }
  };

  const deleteClient = async (c) => {
    if (!window.confirm(`Delete client "${c.value}"? This also clears its plan mapping.`)) return;
    setBusy(true); setErr('');
    try {
      await client.delete(`sale-configs/${c.id}`);
      setMapping(prev => { const n = { ...prev }; delete n[c.value]; return n; });
      if (active?.id === c.id) setActive(null);
      await load();
    } catch (e) { setErr(e.response?.data?.error || 'Failed to delete client'); }
    finally { setBusy(false); }
  };

  const deletePlan = async (p) => {
    if (!window.confirm(`Delete plan "${p.value}"? This removes it from every client mapping.`)) return;
    setBusy(true); setErr('');
    try {
      await client.delete(`sale-configs/${p.id}`);
      // Strip the plan out of every staged mapping so the next Save Mapping
      // doesn't try to map a deleted value.
      setMapping(prev => {
        const next = {};
        Object.entries(prev).forEach(([k, set]) => {
          const ns = new Set(set);
          ns.delete(p.value);
          next[k] = ns;
        });
        return next;
      });
      await load();
    } catch (e) { setErr(e.response?.data?.error || 'Failed to delete plan'); }
    finally { setBusy(false); }
  };

  // Eye-off toggle — hide/show a client or plan on the form without deleting it.
  const toggleHiddenConfig = async (cfg) => {
    setBusy(true); setErr('');
    try { await client.put(`sale-configs/${cfg.id}`, { hidden: !cfg.hidden }); await load(); }
    catch (e) { setErr(e.response?.data?.error || 'Failed to update visibility'); }
    finally { setBusy(false); }
  };

  const toggleMapping = (clientVal, planVal) => {
    setMapping(prev => {
      const set = new Set(prev[clientVal] || []);
      if (set.has(planVal)) set.delete(planVal); else set.add(planVal);
      return { ...prev, [clientVal]: set };
    });
  };

  const selectAll = () => {
    if (!active) return;
    setMapping(prev => ({ ...prev, [active.value]: new Set(plans.map(p => p.value)) }));
  };
  const clearAll = () => {
    if (!active) return;
    setMapping(prev => ({ ...prev, [active.value]: new Set() }));
  };

  const saveMapping = async () => {
    if (!planField) { setErr('Add the Plan field to the form layout first (Form Builder → Form Layout).'); return; }
    setSaving(true); setErr('');
    try {
      // Skip clients with no plans so the live form doesn't get an empty
      // bucket that would silently scope every dropdown to nothing.
      const options = clients
        .map(c => ({ client: c.value, plans: [...(mapping[c.value] || [])] }))
        .filter(o => o.plans.length > 0);
      await client.put(`forms/fields/${planField.id}`, { options });
      await load();
    } catch (e) { setErr(e.response?.data?.error || 'Failed to save mapping'); }
    finally { setSaving(false); }
  };

  const totalMappings = useMemo(() =>
    Object.values(mapping).reduce((n, set) => n + (set?.size || 0), 0),
    [mapping]);

  const filteredClients = clients.filter(c => c.value.toLowerCase().includes(clientSearch.trim().toLowerCase()));
  const filteredPlans   = plans  .filter(p => p.value.toLowerCase().includes(planSearch  .trim().toLowerCase()));
  const activeSet       = active ? (mapping[active.value] || new Set()) : new Set();

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="rounded-2xl p-6 flex items-center justify-between flex-wrap gap-3" style={{ background: 'var(--gradient-sidebar)' }}>
        <div className="flex items-center gap-2.5">
          <Tag size={22} className="text-white" />
          <div>
            <h2 className="text-2xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>Clients &amp; Plans</h2>
            <p className="text-sm text-white/80">Paste a CSV of clients; click a client to pick which plans appear when it's selected on the form.</p>
          </div>
        </div>
        <span className="text-xs text-white/70">
          {clients.length} clients · {plans.length} plans · {totalMappings} mappings
        </span>
      </div>

      {err && <Alert type="error" message={err} />}

      {!planField && !loading && (
        <Alert type="warning" message="No Plan field on the form yet. Add one in Form Builder → Form Layout to enable the per-client plan mapping. Catalog edits still save." />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ── Clients column ──────────────────────────────────────────── */}
        <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <h3 className="text-sm font-bold flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
            <Tag size={14} /> Clients
          </h3>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-text-secondary)' }}>
              Paste CSV (Acme, Globex, Initech…)
            </label>
            <textarea value={clientCsv} onChange={e => setClientCsv(e.target.value)} rows={3}
              className="input text-sm" placeholder="Acme Corp, Globex, Initech" />
            <Button onClick={addClients} disabled={busy || !clientCsv.trim()} variant="primary" className="mt-2 w-full text-sm">
              {busy ? <Loader2 size={14} className="animate-spin inline mr-1" /> : <Plus size={14} className="inline mr-1" />}
              Add clients
            </Button>
          </div>

          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
            <input value={clientSearch} onChange={e => setClientSearch(e.target.value)} placeholder="Filter clients…" className="input text-sm pl-8" />
          </div>

          <div className="max-h-96 overflow-y-auto space-y-1 pr-1">
            {loading
              ? <p className="text-xs italic py-2" style={{ color: 'var(--color-text-tertiary)' }}>Loading…</p>
              : filteredClients.length === 0
                ? <p className="text-xs italic py-2" style={{ color: 'var(--color-text-tertiary)' }}>No clients yet. Paste a CSV above.</p>
                : filteredClients.map(c => {
                  const on    = active?.id === c.id;
                  const count = mapping[c.value]?.size || 0;
                  return (
                    <div key={c.id}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-md transition-colors"
                      style={{ backgroundColor: on ? 'var(--color-primary-100)' : 'transparent', border: '1px solid', borderColor: on ? 'var(--color-primary-300)' : 'transparent', opacity: c.hidden ? 0.5 : 1 }}>
                      <button onClick={() => setActive(c)} className="flex-1 flex items-center justify-between text-left">
                        <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{c.value}{c.hidden && <span className="ml-1 text-[10px] font-bold uppercase" style={{ color: 'var(--color-text-tertiary)' }}>· hidden</span>}</span>
                        <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                          {count} / {plans.length} plans
                          <ChevronRight size={12} />
                        </span>
                      </button>
                      <HideDeleteMenu hidden={c.hidden} busy={busy}
                        onToggleHidden={() => toggleHiddenConfig(c)}
                        onDelete={() => deleteClient(c)} />
                    </div>
                  );
                })}
          </div>
        </div>

        {/* ── Plans + per-client mapping column ───────────────────────── */}
        <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <h3 className="text-sm font-bold flex items-center justify-between gap-1.5" style={{ color: 'var(--color-text)' }}>
            <span className="flex items-center gap-1.5">
              <Briefcase size={14} /> Plans
              {active && <span className="text-xs font-normal" style={{ color: 'var(--color-text-tertiary)' }}>· mapping for <strong style={{ color: 'var(--color-primary-700)' }}>{active.value}</strong></span>}
            </span>
            {active && (
              <span className="flex items-center gap-1">
                <button onClick={selectAll}
                  className="text-[11px] font-semibold px-2 py-0.5 rounded-md"
                  style={{ backgroundColor: 'var(--color-primary-50)', color: 'var(--color-primary-700)' }}>All</button>
                <button onClick={clearAll}
                  className="text-[11px] font-semibold px-2 py-0.5 rounded-md"
                  style={{ backgroundColor: 'var(--color-error-50)', color: 'var(--color-error-700)' }}>None</button>
              </span>
            )}
          </h3>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-text-secondary)' }}>
              Paste CSV (Signature, Basic, Premium…)
            </label>
            <textarea value={planCsv} onChange={e => setPlanCsv(e.target.value)} rows={3}
              className="input text-sm" placeholder="Signature, Basic, Premium, Elite" />
            <Button onClick={addPlans} disabled={busy || !planCsv.trim()} variant="primary" className="mt-2 w-full text-sm">
              {busy ? <Loader2 size={14} className="animate-spin inline mr-1" /> : <Plus size={14} className="inline mr-1" />}
              Add plans
            </Button>
          </div>

          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
            <input value={planSearch} onChange={e => setPlanSearch(e.target.value)} placeholder="Filter plans…" className="input text-sm pl-8" />
          </div>

          <div className="max-h-96 overflow-y-auto space-y-1 pr-1">
            {loading
              ? <p className="text-xs italic py-2" style={{ color: 'var(--color-text-tertiary)' }}>Loading…</p>
              : filteredPlans.length === 0
                ? <p className="text-xs italic py-2" style={{ color: 'var(--color-text-tertiary)' }}>No plans yet. Paste a CSV above.</p>
                : filteredPlans.map(p => {
                  const on = active ? activeSet.has(p.value) : false;
                  return (
                    <div key={p.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md"
                      style={{ backgroundColor: on ? 'var(--color-primary-50)' : 'var(--color-bg-secondary)', border: on ? '1px solid var(--color-primary-300)' : '1px solid transparent', opacity: p.hidden ? 0.5 : 1 }}>
                      <label className="flex-1 flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={on} disabled={!active}
                          onChange={() => toggleMapping(active.value, p.value)}
                          className="w-3.5 h-3.5 accent-primary-600" />
                        <span className="text-sm font-medium" style={{ color: on ? 'var(--color-primary-700)' : 'var(--color-text)' }}>{p.value}{p.hidden && <span className="ml-1 text-[10px] font-bold uppercase" style={{ color: 'var(--color-text-tertiary)' }}>· hidden</span>}</span>
                      </label>
                      <HideDeleteMenu hidden={p.hidden} busy={busy}
                        onToggleHidden={() => toggleHiddenConfig(p)}
                        onDelete={() => deletePlan(p)} />
                    </div>
                  );
                })}
          </div>

          {planField && (
            <Button onClick={saveMapping} disabled={saving} variant="primary" className="w-full text-sm">
              {saving ? <Loader2 size={14} className="animate-spin inline mr-1" /> : <Save size={14} className="inline mr-1" />}
              Save mapping
            </Button>
          )}
          {!active && plans.length > 0 && (
            <p className="text-[11px] italic flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}>
              <Link2 size={10} /> Pick a client on the left to map its plans.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default ClientPlanManager;
