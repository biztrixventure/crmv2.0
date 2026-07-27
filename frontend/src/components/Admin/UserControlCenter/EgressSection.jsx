// EgressSection — per-user data-egress governance, mirroring Admin/EgressGovernance
// for one user, and RESOLVING inheritance so the individual reflects their ROLE.
//
// Egress precedence (backend egressGuard): user > company > role, most-specific
// scope wins, and a GLOBAL block dominates (an area is blocked if the global
// scope OR the area scope blocks it). So if the fronter_manager ROLE has CSV
// export disabled, every fronter_manager USER shows it disabled here too — with
// a source badge (Role / Company / User / Default). Toggling a checkbox writes a
// USER override; "inherit" clears it so the role/company value takes over again.
//   • Export access — checkbox CHECKED = ALLOWED (same polarity as the real screen)
//   • Daily limits — recording minutes (global) + CSV caps per area (blank shows
//     the inherited role/company cap as a hint)
//   • Export columns — per-dataset field allow-list (null = all)
// All writes use the existing PUT/DELETE /egress/* endpoints; dataset null = the
// global scope (never the strings '__all'/'__global').
//
// UI from components/UI/kit (docs/ui-design-system.md).
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Download, Save, Trash2, Columns3, RotateCcw, Sliders } from 'lucide-react';
import client from '../../../api/client';
import { Alert } from '../../../components/UI';
import ThemedSelect from '../../UI/Select';
import { Panel, SectionHeader, Loading, CheckRow, Field, useFlash, accent } from '../../UI/kit';
// Single source of truth for the export field catalog — shared with the canonical
// Data Egress screen so the two never drift (no duplicated hardcoded list).
import { EXPORT_DATASETS, labelFor } from '../EgressGovernance/EgressGovernance';
import ColumnArranger from '../EgressGovernance/ColumnArranger';
import { defaultColumnsForRole, FORM_FIELD_PREFIX, FORM_DATA_DATASETS } from '../../../utils/exportSpec';

const AREA_LABEL = {
  __global: 'All exports', sales: 'Sales', transfers: 'Transfers', callbacks: 'Callbacks',
  reviews: 'Reviews', numbers: 'Numbers', customer_profile: 'Customer Profile',
  data_analyzer: 'Data Analyzer', company_data: 'Company Data', reports: 'Reports', qa: 'QA',
};
const areaLabel = (a) => AREA_LABEL[a] || String(a || '').replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());
const numOrNull = (v) => (v === '' || v == null ? null : v);
const prettyRole = (r) => String(r || '').replace(/_/g, ' ');

// Source badge for a resolved value. Tinted fill + same-tone text (the kit's
// accent pattern) rather than a solid fill with white text: dark mode INVERTS the
// semantic scales, so white on --color-warning-600 (#FCD34D in dark) was
// unreadable. soft/fg from tokens stay legible on either theme.
const SOURCE_TONE = {
  user:    { tone: 'primary', label: 'User' },
  company: { tone: 'info',    label: 'Company' },
  role:    { tone: 'warn',    label: 'Role' },
  default: { tone: 'muted',   label: 'Default' },
};
function SourceBadge({ source, roleLevel }) {
  const s = SOURCE_TONE[source] || SOURCE_TONE.default;
  const a = accent(s.tone);
  const label = source === 'role' && roleLevel ? `Role · ${prettyRole(roleLevel)}` : s.label;
  return (
    <span className="text-[11px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded"
      style={{ background: a.soft, color: a.fg, border: `1px solid ${a.soft}` }}>
      {label}
    </span>
  );
}

export default function EgressSection({ account, assignment }) {
  const userId    = account.user_id;
  const companyId = assignment?.company_id || null;
  const roleLevel = assignment?.role_level || null;

  const [limits, setLimits]   = useState([]);          // ALL egress_limits rows (every scope)
  const [access, setAccess]   = useState([]);          // export-access entries per scope {scope_type,scope_id,blocked{}}
  const [areas, setAreas]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(null);
  const { msg, flash, clear } = useFlash();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [limRes, accRes] = await Promise.all([
        client.get('egress/limits'),
        client.get('egress/export-access'),
      ]);
      setLimits(limRes.data.limits || []);
      setAccess(accRes.data.access || []);
      setAreas(accRes.data.areas || []);
    } catch (e) { flash('error', e.response?.data?.error || 'Failed to load egress config.'); }
    finally { setLoading(false); }
  }, [flash]);

  useEffect(() => { load(); }, [load]);

  // ── resolve export-access inheritance (user > company > role) ─────────────
  const entryFor = (type, id) => access.find(a => a.scope_type === type && String(a.scope_id) === String(id));
  const userEntry = entryFor('user', userId);
  const compEntry = companyId ? entryFor('company', companyId) : null;
  const roleEntry = roleLevel ? entryFor('role', roleLevel) : null;

  // highest-rank scope that explicitly set blocked for `key` ('__global' or area)
  const pick = (key) => {
    const c = [];
    if (userEntry && userEntry.blocked?.[key] !== undefined) c.push({ rank: 3, value: userEntry.blocked[key], scope: 'user' });
    if (compEntry && compEntry.blocked?.[key] !== undefined) c.push({ rank: 2, value: compEntry.blocked[key], scope: 'company' });
    if (roleEntry && roleEntry.blocked?.[key] !== undefined) c.push({ rank: 1, value: roleEntry.blocked[key], scope: 'role' });
    c.sort((a, b) => b.rank - a.rank);
    return c[0] || { value: undefined, scope: undefined };
  };

  // effective { blocked, source } for the global master or a specific area.
  const effective = (key) => {
    const gb = pick('__global');
    const ab = key === '__global' ? { value: undefined, scope: undefined } : pick(key);
    const globalBlocked = gb.value === true;   // a global block dominates
    const areaBlocked   = ab.value === true;
    const blocked = globalBlocked || areaBlocked;
    let source;
    if (globalBlocked) source = gb.scope;
    else if (areaBlocked) source = ab.scope;
    else { const d = key === '__global' ? gb : (ab.value !== undefined ? ab : gb); source = d.value !== undefined ? d.scope : 'default'; }
    return { blocked, source };
  };
  const hasUserOverride = (key) => userEntry?.blocked?.[key] !== undefined;

  const setAllowed = async (key, isAllowed) => {
    const dataset = key === '__global' ? null : key;
    setBusy('access:' + key);
    try { await client.put('egress/export-access', { scope_type: 'user', scope_id: userId, dataset, blocked: !isAllowed }); await load(); }
    catch (e) { flash('error', e.response?.data?.error || 'Save failed.'); }
    finally { setBusy(null); }
  };
  // Clear the user override → fall back to role/company. Deletes the user's
  // csv_export row for that dataset (which also drops any per-user cap on it).
  const clearOverride = async (key) => {
    const ds = key === '__global' ? null : key;
    const row = limits.find(r => r.scope_type === 'user' && String(r.scope_id) === String(userId) && r.action_type === 'csv_export' && (ds == null ? r.dataset == null : r.dataset === ds));
    if (!row) return;
    setBusy('access:' + key);
    try { await client.delete(`egress/limits/${row.id}`); flash('success', 'Reverted to inherited value.'); await load(); }
    catch (e) { flash('error', e.response?.data?.error || 'Failed.'); }
    finally { setBusy(null); }
  };

  // ── numeric caps (user scope; show inherited role/company as placeholder) ──
  const userRow = (action, area) => limits.find(r => r.scope_type === 'user' && String(r.scope_id) === String(userId) && r.action_type === action && (area === '__all' ? r.dataset == null : r.dataset === area));
  const recRow  = userRow('recording_listen', '__all');
  const capRowFor = (area) => userRow('csv_export', area);
  // inherited numeric (company > role, area-specific > global) for placeholder hints
  const inheritNum = (action, area, field) => {
    const scan = [];
    const push = (type, id, rank) => { if (id == null) return;
      const areaRow = limits.find(r => r.scope_type === type && String(r.scope_id) === String(id) && r.action_type === action && r.dataset === (area === '__all' ? ' ' : area));
      const globRow = limits.find(r => r.scope_type === type && String(r.scope_id) === String(id) && r.action_type === action && r.dataset == null);
      if (areaRow && areaRow[field] != null) scan.push({ rank: rank + 0.5, v: areaRow[field] });
      if (globRow && globRow[field] != null) scan.push({ rank, v: globRow[field] });
    };
    push('company', companyId, 2); push('role', roleLevel, 1);
    scan.sort((a, b) => b.rank - a.rank);
    return scan[0]?.v;
  };

  const saveRecording = async (minutes) => {
    setBusy('rec');
    try { await client.put('egress/limits', { scope_type: 'user', scope_id: userId, action_type: 'recording_listen', dataset: null, max_recording_minutes_per_day: numOrNull(minutes) }); flash('success', 'Recording cap saved.'); await load(); }
    catch (e) { flash('error', e.response?.data?.error || 'Save failed.'); } finally { setBusy(null); }
  };
  const saveCsvCap = async (area, maxRows, maxExports) => {
    const dataset = area === '__all' ? null : area;
    const existing = capRowFor(area);
    if (maxRows === '' && maxExports === '' && existing) {
      setBusy('cap:' + area);
      try { await client.delete(`egress/limits/${existing.id}`); flash('success', 'Override removed.'); await load(); }
      catch (e) { flash('error', e.response?.data?.error || 'Delete failed.'); } finally { setBusy(null); }
      return;
    }
    setBusy('cap:' + area);
    try { await client.put('egress/limits', { scope_type: 'user', scope_id: userId, action_type: 'csv_export', dataset, max_rows_per_export: numOrNull(maxRows), max_exports_per_day: numOrNull(maxExports) }); flash('success', 'Cap saved.'); await load(); }
    catch (e) { flash('error', e.response?.data?.error || 'Save failed.'); } finally { setBusy(null); }
  };

  if (loading) return <Loading variant="rows" rows={6} label="Loading egress config…" />;

  const accessRows = ['__global', ...areas];
  const capAreas   = ['__all', ...areas];
  const globalEff  = effective('__global');

  return (
    <div className="space-y-5 max-w-3xl">
      <SectionHeader
        icon={Download}
        title="Data egress"
        subtitle={`Values inherit from this user’s role${roleLevel ? ` (${prettyRole(roleLevel)})` : ''} and company; the badge shows where each effective value comes from. Toggle to set a per-user override; use ↺ to revert to the inherited value.`}
      />
      {msg && <Alert type={msg.type} onDismiss={clear}>{msg.text}</Alert>}

      {/* 1 — Export access (effective, with source + inheritance) */}
      <Panel tone="inset" radius="xl">
        <SectionHeader level="sub" title="Export access — checked = allowed" />
        <p className="text-[11px] text-text-secondary mb-3">A blocked “All exports” (global) disables every area regardless of the per-area boxes.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {accessRows.map(key => {
            const eff = effective(key);
            const allowed = !eff.blocked;
            const overridden = hasUserOverride(key);
            const dominatedByGlobal = key !== '__global' && globalEff.blocked;
            return (
              <CheckRow
                key={key}
                checked={allowed}
                onChange={(next) => setAllowed(key, next)}
                label={areaLabel(key)}
                strong={key === '__global'}
                busy={busy === 'access:' + key}
                trailing={
                  <>
                    <SourceBadge source={eff.source} roleLevel={roleLevel} />
                    {dominatedByGlobal && !overridden && <span className="text-[11px] sm:text-[10px] text-text-tertiary">· blocked by global</span>}
                    {overridden && busy !== 'access:' + key && (
                      // Inside a <label>, so stop the click from also toggling the box.
                      <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); clearOverride(key); }}
                        title="Revert to inherited (role/company)" className="ml-auto" style={{ color: 'var(--color-text-tertiary)' }}>
                        <RotateCcw size={13} />
                      </button>
                    )}
                  </>
                }
              />
            );
          })}
        </div>
      </Panel>

      {/* 2 — Daily limits */}
      <Panel tone="inset" radius="xl">
        <SectionHeader level="sub" icon={Sliders} title="Daily limits" />
        <p className="text-[11px] text-text-secondary mb-3">Blank = inherit the role/company cap (shown as a hint) or unlimited. 0 = blocked. Clearing both CSV caps removes the per-user override.</p>

        <RecordingCap key={recRow?.id || 'rec'} initial={recRow?.max_recording_minutes_per_day} inherited={inheritNum('recording_listen', '__all', 'max_recording_minutes_per_day')} busy={busy === 'rec'} onSave={saveRecording} />

        <div className="mt-4 space-y-2">
          <div className="grid grid-cols-[1fr_100px_100px_auto] gap-2 text-[11px] sm:text-[10px] font-bold uppercase tracking-wider text-text-secondary px-1">
            <span>CSV export — area</span><span>Rows/exp</span><span>Exp/day</span><span></span>
          </div>
          {capAreas.map(area => (
            <CsvCapRow key={area + (capRowFor(area)?.id || '')} label={areaLabel(area)} row={capRowFor(area)} busy={busy === 'cap:' + area}
              inhRows={inheritNum('csv_export', area, 'max_rows_per_export')} inhExp={inheritNum('csv_export', area, 'max_exports_per_day')}
              onSave={(r, x) => saveCsvCap(area, r, x)} />
          ))}
        </div>
      </Panel>

      {/* 3 — Export columns per dataset */}
      <ColumnsCard userId={userId} role={roleLevel} onErr={m => flash('error', m)} onOk={m => flash('success', m)} />
    </div>
  );
}

function RecordingCap({ initial, inherited, busy, onSave }) {
  const [v, setV] = useState(initial == null ? '' : String(initial));
  useEffect(() => { setV(initial == null ? '' : String(initial)); }, [initial]);
  return (
    <div className="flex items-end gap-2">
      <Field label="Recording minutes / day (global)">
        <input type="number" min="0" value={v} onChange={e => setV(e.target.value)} placeholder={inherited != null ? `inherit ${inherited}` : '∞'} className="input w-44" />
      </Field>
      <button onClick={() => onSave(v)} disabled={busy} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold" style={{ background: 'var(--color-primary-600)', color: '#fff' }}>
        {busy ? <Loading variant="inline" size={14} /> : <Save size={14} />} Save
      </button>
    </div>
  );
}

function CsvCapRow({ label, row, busy, inhRows, inhExp, onSave }) {
  const initR = row?.max_rows_per_export == null ? '' : String(row.max_rows_per_export);
  const initX = row?.max_exports_per_day == null ? '' : String(row.max_exports_per_day);
  const [r, setR] = useState(initR);
  const [x, setX] = useState(initX);
  useEffect(() => { setR(initR); setX(initX); }, [initR, initX]);
  const dirty = r !== initR || x !== initX;
  return (
    <div className="grid grid-cols-[1fr_100px_100px_auto] gap-2 items-center">
      <span className="text-sm text-text truncate">{label}{row ? '' : <span className="text-text-tertiary text-[11px]"> · inherited</span>}</span>
      <input type="number" min="0" value={r} onChange={e => setR(e.target.value)} placeholder={inhRows != null ? `↳${inhRows}` : '∞'} className="input" />
      <input type="number" min="0" value={x} onChange={e => setX(e.target.value)} placeholder={inhExp != null ? `↳${inhExp}` : '∞'} className="input" />
      <button onClick={() => onSave(r, x)} disabled={busy || !dirty}
        className="px-2.5 py-2 rounded-lg text-xs font-semibold disabled:opacity-40 flex items-center gap-1"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-primary-600)' }}>
        {busy ? <Loading variant="inline" size={13} /> : (r === '' && x === '' && row ? <Trash2 size={13} /> : <Save size={13} />)}
      </button>
    </div>
  );
}

function ColumnsCard({ userId, role, onErr, onOk }) {
  // Only datasets that have a fixed field catalog (data_analyzer is dynamic → skip).
  const datasets = Object.keys(EXPORT_DATASETS).filter(k => (EXPORT_DATASETS[k].fields || []).length);
  const [ds, setDs] = useState(datasets[0]);
  const [selected, setSelected] = useState(null);   // null = unconfigured; else ORDERED keys
  const [formFields, setFormFields] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    client.get('forms/fields').then(r => setFormFields(r.data.fields || [])).catch(() => setFormFields([]));
  }, []);

  const load = useCallback(async (dataset) => {
    setLoading(true);
    try { const { data } = await client.get('egress/columns', { params: { dataset, userId } }); setSelected(Array.isArray(data.columns) ? data.columns : null); }
    catch { setSelected(null); } finally { setLoading(false); }
  }, [userId]);

  useEffect(() => { load(ds); }, [ds, load]);

  const fields = EXPORT_DATASETS[ds]?.fields || [];
  // Unconfigured means "whatever this export writes today", NOT every catalog
  // column. THIS user's role, not the generic fallback — a compliance manager's
  // sale export is 12 columns where the fallback is 9, and seeding an edit from
  // the wrong baseline would mis-set their file on the first save.
  const defaults = defaultColumnsForRole(ds, role);
  const effective = selected == null ? defaults : selected;

  // The pool also offers every live form field as fd:<name> for datasets whose
  // rows carry form_data — the exporter synthesizes those columns, so they are
  // real controls and not decoration.
  const pool = useMemo(() => {
    const base = fields.map(k => ({ key: k, label: labelFor(ds, k), group: 'standard' }));
    if (!FORM_DATA_DATASETS.includes(ds)) return base;
    const seen = new Set(base.map(c => c.key));
    return [...base, ...(formFields || [])
      .map(f => ({ key: `${FORM_FIELD_PREFIX}${f.name}`, label: f.label || f.name, group: 'form field' }))
      .filter(c => !seen.has(c.key))];
  }, [fields, ds, formFields]);
  const save = async (cols) => {
    setSaving(true);
    try { await client.put('egress/columns', { dataset: ds, userId, columns: cols }); setSelected(cols); onOk('Columns saved.'); }
    catch (e) { onErr(e.response?.data?.error || 'Save failed.'); } finally { setSaving(false); }
  };

  return (
    <Panel tone="inset" radius="xl">
      <SectionHeader
        level="sub"
        icon={Columns3}
        title="Export columns (per dataset)"
        actions={
          <ThemedSelect value={ds} onChange={e => setDs(e.target.value)} className="input w-40">
            {datasets.map(d => <option key={d} value={d}>{EXPORT_DATASETS[d].label}</option>)}
          </ThemedSelect>
        }
      />
      <p className="text-[11px] text-text-secondary mb-2 m-0">{selected == null ? `Unconfigured — this user gets their role's export (${defaults.length} columns). Drag to reorder; the top row is the first column.` : `${selected.length} columns, in this order.`}</p>
      {loading ? <Loading variant="rows" rows={3} label="Loading columns…" /> : (
        <>
          <ColumnArranger
            columns={pool}
            value={effective}
            onChange={setSelected}
            sensitive={(k) => /uuid|phone|email|vin|payment/i.test(k) || k === 'customer_name'}
          />
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            {/* save(effective), NOT save(fields): with nothing configured this
                used to write the ENTIRE catalog, so one click on an untouched
                card silently widened the person's export to every column. */}
            <button onClick={() => save(effective)} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: 'var(--color-primary-600)', color: '#fff' }}>
              {saving ? <Loading variant="inline" size={14} /> : <Save size={14} />} Save columns
            </button>
            <button onClick={() => save(null)} disabled={saving}
              className="px-3 py-2 rounded-lg text-sm font-semibold" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
              Reset to all
            </button>
          </div>
        </>
      )}
    </Panel>
  );
}
