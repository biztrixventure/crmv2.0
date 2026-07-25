// EgressSection — per-user data-egress governance, mirroring the canonical
// Admin/EgressGovernance screen for a single user:
//   1. Export access matrix — checkbox CHECKED = ALLOWED (same polarity as the
//      real screen), global master + per data area.
//   2. Daily limits — recording minutes (global) + CSV row/export caps per area
//      (blank = unlimited, 0 = blocked). Clearing both caps deletes the override.
//   3. Export columns — per-dataset field allow-list (null = all columns).
// All writes use the existing PUT/DELETE /egress/* endpoints. dataset is sent as
// null for the "all/global" scope (NOT the strings '__all'/'__global').
import { useState, useEffect, useCallback } from 'react';
import { Download, Loader2, Save, Trash2, Columns3 } from 'lucide-react';
import client from '../../../api/client';
import { Alert } from '../../../components/UI';
import ThemedSelect from '../../UI/Select';
// Single source of truth for the export field catalog — shared with the canonical
// Data Egress screen so the two never drift (no duplicated hardcoded list).
import { EXPORT_DATASETS, labelFor } from '../EgressGovernance/EgressGovernance';

const AREA_LABEL = {
  __global: 'All exports', sales: 'Sales', transfers: 'Transfers', callbacks: 'Callbacks',
  reviews: 'Reviews', numbers: 'Numbers', customer_profile: 'Customer Profile',
  data_analyzer: 'Data Analyzer', company_data: 'Company Data', reports: 'Reports', qa: 'QA',
};
const areaLabel = (a) => AREA_LABEL[a] || String(a || '').replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());

const numOrNull = (v) => (v === '' || v == null ? null : v);

export default function EgressSection({ account }) {
  const userId = account.user_id;
  const [areas, setAreas]     = useState([]);          // export-access areas from backend
  const [blocked, setBlocked] = useState({});          // { __global:bool, area:bool } (true = blocked)
  const [rows, setRows]       = useState([]);          // this user's egress_limits rows
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(null);
  const [msg, setMsg]         = useState(null);

  const flash = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 4000); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [limRes, accRes] = await Promise.all([
        client.get('egress/limits'),
        client.get('egress/export-access'),
      ]);
      setRows((limRes.data.limits || []).filter(r => r.scope_type === 'user' && r.scope_id === userId));
      const acc = (accRes.data.access || []).find(a => a.scope_type === 'user' && a.scope_id === userId);
      setBlocked(acc?.blocked || {});
      setAreas(accRes.data.areas || []);
    } catch (e) { flash('error', e.response?.data?.error || 'Failed to load egress config.'); }
    finally { setLoading(false); }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  // ── export access (checked = allowed) ─────────────────────────────────────
  const setAllowed = async (area, isAllowed) => {
    const dataset = area === '__global' ? null : area;
    setBusy('access:' + area);
    try {
      await client.put('egress/export-access', { scope_type: 'user', scope_id: userId, dataset, blocked: !isAllowed });
      setBlocked(b => ({ ...b, [area]: !isAllowed }));
    } catch (e) { flash('error', e.response?.data?.error || 'Save failed.'); }
    finally { setBusy(null); }
  };

  // ── numeric caps (dataset null = global "all") ────────────────────────────
  const recRow  = rows.find(r => r.action_type === 'recording_listen' && r.dataset == null);
  const capRowFor = (area) => rows.find(r => r.action_type === 'csv_export' && (area === '__all' ? r.dataset == null : r.dataset === area));

  const saveRecording = async (minutes) => {
    setBusy('rec');
    try {
      await client.put('egress/limits', { scope_type: 'user', scope_id: userId, action_type: 'recording_listen', dataset: null, max_recording_minutes_per_day: numOrNull(minutes) });
      flash('success', 'Recording cap saved.'); await load();
    } catch (e) { flash('error', e.response?.data?.error || 'Save failed.'); } finally { setBusy(null); }
  };

  const saveCsvCap = async (area, maxRows, maxExports) => {
    const dataset = area === '__all' ? null : area;
    // Both blank + an existing row → delete the override (revert to role/company default).
    const existing = capRowFor(area);
    if (maxRows === '' && maxExports === '' && existing) {
      setBusy('cap:' + area);
      try { await client.delete(`egress/limits/${existing.id}`); flash('success', 'Override removed.'); await load(); }
      catch (e) { flash('error', e.response?.data?.error || 'Delete failed.'); } finally { setBusy(null); }
      return;
    }
    setBusy('cap:' + area);
    try {
      await client.put('egress/limits', { scope_type: 'user', scope_id: userId, action_type: 'csv_export', dataset, max_rows_per_export: numOrNull(maxRows), max_exports_per_day: numOrNull(maxExports) });
      flash('success', 'Cap saved.'); await load();
    } catch (e) { flash('error', e.response?.data?.error || 'Save failed.'); } finally { setBusy(null); }
  };

  if (loading) return <div className="flex justify-center py-10"><Loader2 size={22} className="animate-spin" style={{ color: 'var(--color-primary-600)' }} /></div>;

  const accessRows = ['__global', ...areas];
  const capAreas   = ['__all', ...areas];

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-2"><Download size={16} style={{ color: 'var(--color-primary-600)' }} /><h3 className="text-sm font-bold text-text">Data egress</h3></div>
      {msg && <Alert type={msg.type}>{msg.text}</Alert>}

      {/* 1 — Export access (checked = allowed, matches the Data Egress screen) */}
      <div className="rounded-xl p-4" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
        <h4 className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-1">Export access — checked = allowed</h4>
        <p className="text-[11px] text-text-secondary mb-3">Uncheck to hide the Export button for this user. “All exports” is the master switch; the rest refine per area.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {accessRows.map(area => (
            <label key={area} className={`flex items-center gap-2 cursor-pointer text-sm py-1 ${area === '__global' ? 'font-semibold' : ''}`}>
              <input type="checkbox" checked={!blocked[area]} onChange={e => setAllowed(area, e.target.checked)} className="accent-[var(--color-primary-600)]" />
              <span className="text-text">{areaLabel(area)}</span>
              {busy === 'access:' + area && <Loader2 size={12} className="animate-spin" style={{ color: 'var(--color-primary-600)' }} />}
            </label>
          ))}
        </div>
      </div>

      {/* 2 — Daily limits */}
      <div className="rounded-xl p-4" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
        <h4 className="text-xs font-bold uppercase tracking-wider text-text-secondary mb-1">Daily limits</h4>
        <p className="text-[11px] text-text-secondary mb-3">Blank = unlimited · 0 = blocked. Clearing both CSV caps for an area removes that override.</p>

        {/* Recording minutes (global only) */}
        <RecordingCap key={recRow?.id || 'rec'} initial={recRow?.max_recording_minutes_per_day} busy={busy === 'rec'} onSave={saveRecording} />

        {/* CSV caps per area */}
        <div className="mt-4 space-y-2">
          <div className="grid grid-cols-[1fr_90px_90px_auto] gap-2 text-[10px] font-bold uppercase tracking-wider text-text-secondary px-1">
            <span>CSV export — area</span><span>Rows/exp</span><span>Exp/day</span><span></span>
          </div>
          {capAreas.map(area => (
            <CsvCapRow key={area + (capRowFor(area)?.id || '')} area={area} label={areaLabel(area)} row={capRowFor(area)} busy={busy === 'cap:' + area} onSave={saveCsvCap} />
          ))}
        </div>
      </div>

      {/* 3 — Export columns per dataset */}
      <ColumnsCard userId={userId} onErr={m => flash('error', m)} onOk={m => flash('success', m)} />
    </div>
  );
}

function RecordingCap({ initial, busy, onSave }) {
  const [v, setV] = useState(initial == null ? '' : String(initial));
  useEffect(() => { setV(initial == null ? '' : String(initial)); }, [initial]);
  return (
    <div className="flex items-end gap-2">
      <label className="block">
        <span className="text-[11px] font-bold uppercase tracking-wider text-text-secondary block mb-1">Recording minutes / day (global)</span>
        <input type="number" min="0" value={v} onChange={e => setV(e.target.value)} placeholder="—" className="input w-40" />
      </label>
      <button onClick={() => onSave(v)} disabled={busy} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold" style={{ background: 'var(--color-primary-600)', color: '#fff' }}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
      </button>
    </div>
  );
}

function CsvCapRow({ area, label, row, busy, onSave }) {
  const [r, setR] = useState(row?.max_rows_per_export == null ? '' : String(row.max_rows_per_export));
  const [x, setX] = useState(row?.max_exports_per_day == null ? '' : String(row.max_exports_per_day));
  useEffect(() => {
    setR(row?.max_rows_per_export == null ? '' : String(row.max_rows_per_export));
    setX(row?.max_exports_per_day == null ? '' : String(row.max_exports_per_day));
  }, [row]);
  const dirty = (r !== (row?.max_rows_per_export == null ? '' : String(row.max_rows_per_export))) || (x !== (row?.max_exports_per_day == null ? '' : String(row.max_exports_per_day)));
  return (
    <div className="grid grid-cols-[1fr_90px_90px_auto] gap-2 items-center">
      <span className="text-sm text-text truncate">{label}{row ? '' : <span className="text-text-tertiary text-[11px]"> · default</span>}</span>
      <input type="number" min="0" value={r} onChange={e => setR(e.target.value)} placeholder="∞" className="input" />
      <input type="number" min="0" value={x} onChange={e => setX(e.target.value)} placeholder="∞" className="input" />
      <button onClick={() => onSave(area, r, x)} disabled={busy || !dirty}
        className="px-2.5 py-2 rounded-lg text-xs font-semibold disabled:opacity-40 flex items-center gap-1"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-primary-600)' }}>
        {busy ? <Loader2 size={13} className="animate-spin" /> : (r === '' && x === '' && row ? <Trash2 size={13} /> : <Save size={13} />)}
      </button>
    </div>
  );
}

function ColumnsCard({ userId, onErr, onOk }) {
  // Only datasets that have a fixed field catalog (data_analyzer is dynamic → skip).
  const datasets = Object.keys(EXPORT_DATASETS).filter(k => (EXPORT_DATASETS[k].fields || []).length);
  const [ds, setDs] = useState(datasets[0]);
  const [selected, setSelected] = useState(null);   // null = all columns
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (dataset) => {
    setLoading(true);
    try { const { data } = await client.get('egress/columns', { params: { dataset, userId } }); setSelected(Array.isArray(data.columns) ? data.columns : null); }
    catch { setSelected(null); } finally { setLoading(false); }
  }, [userId]);

  useEffect(() => { load(ds); }, [ds, load]);

  const fields = EXPORT_DATASETS[ds]?.fields || [];
  const isOn = (f) => selected == null ? true : selected.includes(f);
  const toggle = (f) => {
    const base = selected == null ? [...fields] : selected;
    setSelected(base.includes(f) ? base.filter(x => x !== f) : [...base, f]);
  };
  const save = async (cols) => {
    setSaving(true);
    try {
      await client.put('egress/columns', { dataset: ds, userId, columns: cols });
      setSelected(cols); onOk('Columns saved.');
    } catch (e) { onErr(e.response?.data?.error || 'Save failed.'); } finally { setSaving(false); }
  };

  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <h4 className="text-xs font-bold uppercase tracking-wider text-text-secondary flex items-center gap-1.5"><Columns3 size={13} /> Export columns (per dataset)</h4>
        <ThemedSelect value={ds} onChange={e => setDs(e.target.value)} className="input w-40">
          {datasets.map(d => <option key={d} value={d}>{EXPORT_DATASETS[d].label}</option>)}
        </ThemedSelect>
      </div>
      <p className="text-[11px] text-text-secondary mb-2">{selected == null ? 'All columns (unconfigured — user exports the full set).' : `${selected.length} of ${fields.length} columns.`}</p>
      {loading ? <Loader2 size={16} className="animate-spin" style={{ color: 'var(--color-primary-600)' }} /> : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-56 overflow-y-auto">
            {fields.map(f => (
              <label key={f} className="flex items-center gap-2 cursor-pointer text-sm py-0.5">
                <input type="checkbox" checked={isOn(f)} onChange={() => toggle(f)} className="accent-[var(--color-primary-600)]" />
                <span className="text-text truncate">{labelFor(f)}</span>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-3">
            <button onClick={() => save(selected == null ? fields : selected)} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: 'var(--color-primary-600)', color: '#fff' }}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save columns
            </button>
            <button onClick={() => save(null)} disabled={saving}
              className="px-3 py-2 rounded-lg text-sm font-semibold" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
              Reset to all
            </button>
          </div>
        </>
      )}
    </div>
  );
}
