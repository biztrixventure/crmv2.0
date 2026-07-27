import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react';
import { Shield, Download, Sliders, Columns, Search, RefreshCw, Loader2, Plus, Trash2, ChevronDown, ChevronRight, Check, User, Building2, X, AlertTriangle, Headphones } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../../api/client';
import ThemedSelect from '../../UI/Select';
import { DATASETS, CONFIGURABLE_DATASETS, columnLabel, defaultColumnsForRole, FORM_FIELD_PREFIX, FORM_DATA_DATASETS } from '../../../utils/exportSpec';
import ColumnArranger from './ColumnArranger';
import ThemedDate from '../../UI/ThemedDate';
import { SectionHeader, PillTabs, Loading, KpiTile, Field } from '../../UI/kit';
import { TableScroll } from "../../UI/kit";

// Searchable "pick a user" control (name → id) backed by the recipients
// directory — replaces raw UUID entry. Single-select; onPick({id,name,...}).
function UserSearchPicker({ onPick }) {
  const [q, setQ] = useState('');
  const [users, setUsers] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const t = setTimeout(() => {
      client.get('distribution-batches/recipients', { params: { q } })
        .then(r => setUsers(r.data.users || [])).catch(() => setUsers([])).finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q, open]);
  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc); return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  return (
    <div ref={boxRef} className="relative flex-1 min-w-[220px]">
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
        <input value={q} onChange={e => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
          placeholder="Search a person by name…"
          style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)', borderRadius: 8, padding: '6px 10px 6px 30px', fontSize: 13, width: '100%' }} />
      </div>
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded-xl overflow-hidden max-h-56 overflow-y-auto"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.15))' }}>
          {loading ? <div className="text-center py-4"><Loader2 size={15} className="animate-spin inline" /></div>
            : users.length === 0 ? <div className="px-3 py-3 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>No matching users</div>
            : users.map(u => (
              <button key={u.id} onMouseDown={e => { e.preventDefault(); onPick(u); setQ(''); setOpen(false); }}
                className="w-full text-left px-3 py-2 hover:bg-bg-secondary transition-colors">
                <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{u.name}</div>
                <div className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>{(u.role || '—').replace(/_/g, ' ')}{u.company_name ? ` · ${u.company_name}` : ''}</div>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

// ── Data-egress governance (superadmin) ──────────────────────────────────────
// Three tabs: Audit (export/recording log), Limits (numeric caps per
// role/company/user), Fields & Display (export.columns + list.layout config).
// Backend: /api/egress (migration 167).

const ROLES = ['closer', 'fronter', 'closer_manager', 'fronter_manager', 'operations_manager', 'company_admin', 'compliance_manager', 'portal_client'];
const ACTIONS = ['csv_export', 'recording_listen'];
// Export datasets + their field catalogs are DERIVED from utils/exportSpec —
// the same array the exporters read their values through, so a checkbox here
// cannot offer a column no export can write.
//
// The literal that used to live here had drifted badly: it offered nine sale
// fields (policy_number, plan, monthly_payment, car_*) that no export has ever
// written, and omitted three (Cancellation Date, Paid Days, Paid Tenure) that
// every compliance sale export writes — so those were unconfigurable. Deriving
// the list makes that class of drift impossible rather than merely fixed.
//
// data_analyzer is appended by hand because its columns are genuinely dynamic
// (label-based, chosen on the analyzer itself), so it gets no checkbox list.
export const EXPORT_DATASETS = {
  ...Object.fromEntries(CONFIGURABLE_DATASETS.map(k => [k, {
    label: DATASETS[k].label,
    fields: DATASETS[k].columns.map(c => c.key),
  }])),
  data_analyzer: { label: 'Data Analyzer', fields: [] },
};
const SHELLS = ['staff', 'manager', 'compliance'];

// Labels come from the column definition, so a checkbox and the CSV header can
// never disagree. Dataset-scoped because the same key means different things in
// different files (`status`, `created_at`, `company_name`).
export const labelFor = (dataset, key) => columnLabel(dataset, key);
const SAMPLE_VALUES = {
  customer_name: 'John Smith', customer_phone: '(555) 201-4477', customer_email: 'john.smith@example.com',
  customer_uuid: 'e3b0c442-98fc-1c14-9afb-4c8996fb9242', reference_no: 'REF-100482', policy_number: 'POL-77310',
  closer_name: 'Ava Reed', fronter_name: 'Mia Cole', company_name: 'WaveTech', client_name: 'Silver Plan',
  sale_date: '2026-07-18', monthly_payment: '149.00', down_payment: '399.00',
  car_year: '2019', car_make: 'Toyota', car_model: 'Camry', car_vin: '4T1BF1FK5CU512345',
  created_by_name: 'Mia Cole', assigned_closer_name: 'Ava Reed', latest_disposition: 'Sold',
  created_at: '2026-07-18 14:32', callback_at: '2026-07-20 10:00', reviewer_name: 'Sam Diaz', rating: '4.5',
  status: 'closed_won', priority: 'high', notes: 'Called back, confirmed card.', plan: 'Gold',
  cancellation_date: '2026-09-02', paid_days: '46', paid_tenure: '1 month 16d',
  compliance_note: 'Verified on recording.', agent_name: 'Ava Reed', is_duplicate: 'No',
  duplicate_reason: '', sale_reference_no: 'REF-100482', old_status: 'pending', new_status: 'completed',
  actor_name: 'Sam Diaz', callback_deleted: 'No', name: 'Ava Reed', email: 'ava.reed@example.com',
  role: 'closer', is_active: 'Active', level: 'closer manager',
  phone_number: '(555) 201-4477', list_name: 'Warm Q3', assignment_day: '2026-07-18',
  transferred_at: '2026-07-18 14:32', rank: '1', total: '128', completed: '96', converted: '41',
  rejected: '12', conv_pct: '32%', won: '37', win_rate: '29%', revenue: '$14,700',
};
const sampleFor = (k) => SAMPLE_VALUES[k] != null ? SAMPLE_VALUES[k] : '—';

const box = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12 };
const inp = { background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)', borderRadius: 8, padding: '6px 10px', fontSize: 13 };
const numOrBlank = (v) => (v == null ? '' : String(v));

// ── Audit tab ─────────────────────────────────────────────────────────────────
function AuditTab() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState({ actions: [], datasets: [] });
  const [f, setF] = useState({ action_type: '', dataset: '', status: '', date_from: '', date_to: '', user_id: '' });
  const [open, setOpen] = useState(null);
  const [stats, setStats] = useState(null);
  const PAGE = 50;

  useEffect(() => { client.get('egress/audit/meta').then(r => setMeta(r.data)).catch(() => {}); }, []);
  useEffect(() => { client.get('egress/audit/stats').then(r => setStats(r.data.today)).catch(() => {}); }, []);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: PAGE };
      Object.entries(f).forEach(([k, v]) => { if (v) params[k] = v; });
      const r = await client.get('egress/audit', { params });
      setRows(r.data.logs || []);
      setTotal(t => (r.data.total == null ? t : r.data.total));
    } catch { setRows([]); } finally { setLoading(false); }
  }, [page, f]);
  useEffect(() => { load(); }, [load]);
  const setFilter = (k, v) => { setPage(1); setF(p => ({ ...p, [k]: v })); };

  const tiles = [
    { label: 'Exports today', value: stats?.exports, Icon: Download, tone: 'primary' },
    { label: 'Denied today', value: stats?.denied, Icon: AlertTriangle, tone: 'danger' },
    { label: 'Recordings today', value: stats?.recordings, Icon: Headphones, tone: 'info' },
    { label: 'Active users', value: stats?.users, Icon: User, tone: 'success' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {tiles.map(t => (
          <KpiTile key={t.label} icon={t.Icon} tone={t.tone} label={t.label}
            value={t.value == null ? '—' : t.value.toLocaleString()} />
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3 p-3" style={box}>
        <Field label="Action" className="w-[150px]">
          <ThemedSelect value={f.action_type} onChange={e => setFilter('action_type', e.target.value)} className="w-full">
            <option value="">All actions</option>{(meta.actions.length ? meta.actions : ACTIONS).map(a => <option key={a} value={a}>{a}</option>)}
          </ThemedSelect>
        </Field>
        <Field label="Dataset" className="w-[150px]">
          <ThemedSelect value={f.dataset} onChange={e => setFilter('dataset', e.target.value)} className="w-full">
            <option value="">All datasets</option>{meta.datasets.map(d => <option key={d} value={d}>{d}</option>)}
          </ThemedSelect>
        </Field>
        <Field label="Status" className="w-[150px]">
          <ThemedSelect value={f.status} onChange={e => setFilter('status', e.target.value)} className="w-full">
            <option value="">All statuses</option><option value="allowed">Allowed</option><option value="denied">Denied</option>
          </ThemedSelect>
        </Field>
        <Field label="From" className="w-[150px]">
          <ThemedDate value={f.date_from} onChange={e => setFilter('date_from', e.target.value)} style={{ width: '100%' }} />
        </Field>
        <Field label="To" className="w-[150px]">
          <ThemedDate value={f.date_to} onChange={e => setFilter('date_to', e.target.value)} style={{ width: '100%' }} />
        </Field>
        <button onClick={load} className="p-2 rounded-lg flex-shrink-0" style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }} title="Refresh"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
        <span className="text-xs ml-auto tabular-nums" style={{ color: 'var(--color-text-tertiary)' }}>{total.toLocaleString()} events</span>
      </div>

      <TableScroll stickyFirst label="Egress records" className="rounded-xl" style={box}>
        <table className="w-full text-sm">
          <thead><tr style={{ color: 'var(--color-text-secondary)', background: 'var(--color-bg-secondary)' }}>
            {['When', 'User', 'Action', 'Dataset', 'Rows / Dur', 'Status', ''].map((h, i) => <th key={i} className="text-left px-3 py-2 text-xs font-semibold whitespace-nowrap">{h}</th>)}
          </tr></thead>
          <tbody>
            {loading && !rows.length ? <tr><td colSpan={7} className="text-center py-10"><Loader2 className="animate-spin inline" /></td></tr>
              : rows.length === 0 ? <tr><td colSpan={7} className="text-center py-10 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No egress events for these filters.</td></tr>
              : rows.map(r => (
                <Fragment key={r.id}>
                  <tr className="border-t cursor-pointer hover:bg-black/[0.02]" style={{ borderColor: 'var(--color-border)' }} onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <td className="px-3 py-2 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="px-3 py-2">{r.actor_name}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.action_type}</td>
                    <td className="px-3 py-2">{r.dataset || '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{r.action_type === 'recording_listen' ? `${Math.round((r.duration_seconds || 0) / 60)}m` : (r.row_count != null ? r.row_count.toLocaleString() : '—')}</td>
                    <td className="px-3 py-2">
                      <span className="text-[11px] font-bold px-1.5 py-0.5 rounded" style={r.status === 'denied' ? { background: 'var(--color-error-50,#fef2f2)', color: 'var(--color-error-700,#b91c1c)' } : { background: 'var(--color-success-50,#f0fdf4)', color: 'var(--color-success-700,#15803d)' }}>{r.status}</span>
                    </td>
                    <td className="px-3 py-2">{(r.filters_applied || r.deny_reason) ? (open === r.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}</td>
                  </tr>
                  {open === r.id && (
                    <tr style={{ background: 'var(--color-bg-secondary)' }}>
                      <td colSpan={7} className="px-4 py-2 text-xs">
                        {r.deny_reason && <div className="mb-1" style={{ color: 'var(--color-error-700,#b91c1c)' }}><b>Denied:</b> {r.deny_reason}</div>}
                        {r.surface && <div style={{ color: 'var(--color-text-tertiary)' }}>surface: {r.surface}</div>}
                        <pre className="mt-1 overflow-x-auto" style={{ color: 'var(--color-text-secondary)' }}>{JSON.stringify(r.filters_applied || {}, null, 2)}</pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
          </tbody>
        </table>
      </TableScroll>

      {total > PAGE && (
        <div className="flex items-center justify-between text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          <span>{(page - 1) * PAGE + 1}–{Math.min(page * PAGE, total)} of {total.toLocaleString()}</span>
          <div className="flex gap-2">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-2.5 py-1 rounded-lg disabled:opacity-40" style={{ border: '1px solid var(--color-border)' }}>Prev</button>
            <button disabled={page * PAGE >= total} onClick={() => setPage(p => p + 1)} className="px-2.5 py-1 rounded-lg disabled:opacity-40" style={{ border: '1px solid var(--color-border)' }}>Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Limits tab ────────────────────────────────────────────────────────────────
// Full flexibility: numeric export/recording caps per ROLE, per USER, per
// COMPANY — and per DATA AREA. Every value is a "max" cap; blank = unlimited (∞).
const LIMIT_ROLES = ['closer', 'fronter', 'closer_manager', 'fronter_manager', 'operations_manager', 'company_admin', 'compliance_manager', 'qa_manager', 'qa_agent', 'readonly_admin'];
const LIMIT_AREA_OPTS = [
  ['__all', 'All areas (global)'], ['sales', 'Sales'], ['transfers', 'Transfers'], ['callbacks', 'Callbacks'],
  ['reviews', 'Reviews'], ['numbers', 'Numbers'], ['customer_profile', 'Customer Profiles'],
  ['data_analyzer', 'Data Analyzer'], ['company_data', 'Company Data'], ['reports', 'Reports'], ['qa', 'QA'],
];
const areaName = (a) => (LIMIT_AREA_OPTS.find(o => o[0] === a) || [, a])[1];
function LimitsTab() {
  const [limits, setLimits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [companies, setCompanies] = useState([]);
  const [area, setArea] = useState('__all');          // dataset scope of the caps being edited
  const [picked, setPicked] = useState(null);          // { id, name } chosen override target
  const [scopeMode, setScopeMode] = useState('user');  // user | company for the override builder
  const [draft, setDraft] = useState({ action_type: 'csv_export', max_rows_per_export: '', max_exports_per_day: '', max_recording_minutes_per_day: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await client.get('egress/limits'); setLimits(r.data.limits || []); } catch { setLimits([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { client.get('compliance/companies').then(r => setCompanies(r.data.companies || [])).catch(() => {}); }, []);

  const areaDs = area === '__all' ? null : area;
  const recDisabled = area !== '__all';   // recording caps are global — only at "All areas"
  const rowFor = (st, sid, action) => limits.find(l => l.scope_type === st && String(l.scope_id) === String(sid) && l.action_type === action && (l.dataset || null) === areaDs);

  const save = async (row) => {
    try { await client.put('egress/limits', row); toast.success('Limit saved'); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'Save failed'); }
  };
  const del = async (id) => { try { await client.delete(`egress/limits/${id}`); load(); } catch { /* ignore */ } };

  // Edit one cap; preserves the sibling caps of that (scope, action, area) row and
  // materializes the row on first edit (PUT upserts by scope+action+dataset).
  const saveCap = (st, sid, action, field, nv) => {
    const cur = rowFor(st, sid, action) || {};
    save({ scope_type: st, scope_id: sid, action_type: action, dataset: action === 'recording_listen' ? null : areaDs,
      max_rows_per_export: cur.max_rows_per_export ?? null,
      max_exports_per_day: cur.max_exports_per_day ?? null,
      max_recording_minutes_per_day: cur.max_recording_minutes_per_day ?? null,
      [field]: nv });
  };
  const capInput = (st, sid, action, field, disabled) => {
    if (disabled) return <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>;
    const cur = rowFor(st, sid, action);
    const val = cur ? cur[field] : null;
    return (
      <div className="relative" style={{ width: 96 }} key={`${st}:${sid}:${action}:${field}:${val ?? 'x'}`}>
        <input type="number" min="0" defaultValue={numOrBlank(val)} placeholder="∞"
          onBlur={e => { const v = e.target.value; const nv = v === '' ? null : Math.max(0, Math.floor(+v)); if (nv !== (val ?? null)) saveCap(st, sid, action, field, nv); }}
          title={val == null ? 'Unlimited' : String(val)} style={{ ...inp, width: 96, textAlign: 'right' }} />
        {val == null && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>∞</span>}
      </div>
    );
  };

  const overrideRows = limits.filter(l => l.scope_type !== 'role' && (l.dataset || null) === areaDs);

  const addOverride = () => {
    if (!picked?.id) return toast.error(`Pick a ${scopeMode} first`);
    save({ scope_type: scopeMode, scope_id: picked.id, action_type: draft.action_type,
      dataset: draft.action_type === 'recording_listen' ? null : areaDs,
      max_rows_per_export: draft.max_rows_per_export || null,
      max_exports_per_day: draft.max_exports_per_day || null,
      max_recording_minutes_per_day: draft.max_recording_minutes_per_day || null });
    setPicked(null); setDraft({ action_type: 'csv_export', max_rows_per_export: '', max_exports_per_day: '', max_recording_minutes_per_day: '' });
  };

  return (
    <div className="space-y-5">
      {/* which data area these caps apply to */}
      <div className="flex items-center gap-2 flex-wrap p-3 rounded-xl" style={box}>
        <span className="text-xs font-bold whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>Data area</span>
        <ThemedSelect value={area} onChange={e => setArea(e.target.value)} style={{ ...inp, minWidth: 200 }}>
          {LIMIT_AREA_OPTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </ThemedSelect>
        <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{area === '__all' ? 'Caps below apply to every export area, unless a per-area cap overrides them.' : `Editing caps that apply ONLY to ${areaName(area)} exports — these beat the “All areas” cap.`}</span>
      </div>

      <div>
        <p className="text-sm font-bold mb-1" style={{ color: 'var(--color-text)' }}>Role defaults <span className="text-xs font-normal" style={{ color: 'var(--color-text-tertiary)' }}>· {areaName(area)}</span></p>
        <p className="text-xs mb-2" style={{ color: 'var(--color-text-secondary)' }}>Max caps per role. Blank = <b>unlimited (∞)</b>; set to <b>0</b> to block entirely. Applies to every user of that role unless a company/user override exists. Edits save on blur.</p>
        <TableScroll stickyFirst label="Egress records" className="rounded-xl" style={box}>
          <table className="w-full text-sm">
            <thead><tr style={{ color: 'var(--color-text-secondary)', background: 'var(--color-bg-secondary)' }}>
              {['Role', 'Max rows / export', 'Max exports / day', 'Max rec. min / day'].map(h => <th key={h} className="text-left px-3 py-2 text-xs font-semibold whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={4} className="text-center py-8"><Loader2 className="animate-spin inline" /></td></tr>
                : LIMIT_ROLES.map(role => (
                  <tr key={role} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                    <td className="px-3 py-2 font-semibold capitalize whitespace-nowrap">{role.replace(/_/g, ' ')}</td>
                    <td className="px-3 py-2">{capInput('role', role, 'csv_export', 'max_rows_per_export')}</td>
                    <td className="px-3 py-2">{capInput('role', role, 'csv_export', 'max_exports_per_day')}</td>
                    <td className="px-3 py-2">{capInput('role', role, 'recording_listen', 'max_recording_minutes_per_day', recDisabled)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </TableScroll>
        {recDisabled && <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>Recording-minute caps aren’t area-specific — switch to “All areas” to set them.</p>}
      </div>

      <div>
        <p className="text-sm font-bold mb-1" style={{ color: 'var(--color-text)' }}>Per-user / per-company overrides <span className="text-xs font-normal" style={{ color: 'var(--color-text-tertiary)' }}>· beats the role default for {areaName(area)}</span></p>
        <div className="p-3 mb-2 space-y-3" style={box}>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              {[['user', 'User', User], ['company', 'Company', Building2]].map(([t, label, Icon]) => (
                <button key={t} onClick={() => { setScopeMode(t); setPicked(null); }} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold"
                  style={{ background: scopeMode === t ? 'var(--gradient-sidebar)' : 'transparent', color: scopeMode === t ? '#fff' : 'var(--color-text-secondary)' }}>
                  <Icon size={13} /> {label}
                </button>
              ))}
            </div>
            {picked ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold px-2.5 py-1.5 rounded-lg" style={{ background: 'var(--color-primary-100,#e0e7ff)', color: 'var(--color-primary-700,#4338ca)' }}>
                {scopeMode === 'user' ? <User size={13} /> : <Building2 size={13} />} {picked.name}
                <button onClick={() => setPicked(null)} className="hover:opacity-70"><X size={13} /></button>
              </span>
            ) : scopeMode === 'user' ? (
              <UserSearchPicker onPick={u => setPicked({ id: u.id, name: u.name })} />
            ) : (
              <ThemedSelect value="" onChange={e => { const c = companies.find(x => x.id === e.target.value); if (c) setPicked({ id: c.id, name: c.name }); }}
                style={{ ...inp, flex: 1, minWidth: 220 }}>
                <option value="">Choose a company…</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </ThemedSelect>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs">Action
              <ThemedSelect value={draft.action_type} onChange={e => setDraft(d => ({ ...d, action_type: e.target.value }))} style={{ ...inp, display: 'block', marginTop: 4 }}>
                {ACTIONS.map(a => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
              </ThemedSelect>
            </label>
            {draft.action_type === 'csv_export' && <>
              <label className="text-xs">Max rows / export<input type="number" min="0" value={draft.max_rows_per_export} onChange={e => setDraft(d => ({ ...d, max_rows_per_export: e.target.value }))} placeholder="∞ unlimited" style={{ ...inp, display: 'block', marginTop: 4, width: 120 }} /></label>
              <label className="text-xs">Max exports / day<input type="number" min="0" value={draft.max_exports_per_day} onChange={e => setDraft(d => ({ ...d, max_exports_per_day: e.target.value }))} placeholder="∞ unlimited" style={{ ...inp, display: 'block', marginTop: 4, width: 120 }} /></label>
            </>}
            {draft.action_type === 'recording_listen' && (
              <label className="text-xs">Max rec. min / day<input type="number" min="0" value={draft.max_recording_minutes_per_day} onChange={e => setDraft(d => ({ ...d, max_recording_minutes_per_day: e.target.value }))} placeholder="∞ unlimited" style={{ ...inp, display: 'block', marginTop: 4, width: 120 }} /></label>
            )}
            <button onClick={addOverride} disabled={!picked}
              className="text-sm font-bold px-3 py-2 rounded-lg flex items-center gap-1.5 text-white disabled:opacity-50" style={{ background: 'var(--gradient-sidebar)' }}><Plus size={14} /> Add override</button>
          </div>
          <p className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>Blank = unlimited, 0 = blocked. A user/company override beats the role default for that action{area === '__all' ? '' : ` in ${areaName(area)}`}. (recording caps are always global.)</p>
        </div>
        <TableScroll stickyFirst label="Egress records" className="rounded-xl" style={box}>
          <table className="w-full text-sm">
            <thead><tr style={{ color: 'var(--color-text-secondary)', background: 'var(--color-bg-secondary)' }}>
              {['Scope', 'Name', 'Action', 'Rows', 'Exports/day', 'Rec min/day', ''].map(h => <th key={h} className="text-left px-3 py-2 text-xs font-semibold">{h}</th>)}
            </tr></thead>
            <tbody>
              {overrideRows.length === 0 ? <tr><td colSpan={7} className="text-center py-6 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No overrides for {areaName(area)}. Role defaults apply.</td></tr>
                : overrideRows.map(r => (
                  <tr key={r.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                    <td className="px-3 py-2"><span className="inline-flex items-center gap-1.5 capitalize">{r.scope_type === 'user' ? <User size={13} style={{ color: 'var(--color-text-tertiary)' }} /> : <Building2 size={13} style={{ color: 'var(--color-text-tertiary)' }} />}{r.scope_type}</span></td>
                    <td className="px-3 py-2 text-xs font-semibold">{r.scope_name || r.scope_id}</td>
                    <td className="px-3 py-2">{r.action_type}</td>
                    <td className="px-3 py-2">{r.action_type === 'csv_export' ? capInput(r.scope_type, r.scope_id, 'csv_export', 'max_rows_per_export') : <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>}</td>
                    <td className="px-3 py-2">{r.action_type === 'csv_export' ? capInput(r.scope_type, r.scope_id, 'csv_export', 'max_exports_per_day') : <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>}</td>
                    <td className="px-3 py-2">{r.action_type === 'recording_listen' ? capInput(r.scope_type, r.scope_id, 'recording_listen', 'max_recording_minutes_per_day') : <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>}</td>
                    <td className="px-3 py-2"><button onClick={() => del(r.id)} style={{ color: '#ef4444' }}><Trash2 size={14} /></button></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </TableScroll>
      </div>
    </div>
  );
}

// ── Fields & Display tab ──────────────────────────────────────────────────────
function FieldsTab() {
  const [dataset, setDataset] = useState('sales');
  const [role, setRole] = useState('closer');
  const [scopeType, setScopeType] = useState('role');   // export-columns scope: role | user
  const [colUser, setColUser] = useState(null);          // { id, name, role } when scopeType==='user'
  // ORDERED list of column keys. null = unconfigured. Order matters: it is the
  // left-to-right column order of the exported file (resolveColumns maps the
  // saved array in order), which is what the drag-and-drop arranger edits.
  const [cols, setCols] = useState(null);
  const [formFields, setFormFields] = useState([]);
  const [shell, setShell] = useState('compliance');
  const [layout, setLayout] = useState({ page_size: '', default_view: '' });
  const cat = EXPORT_DATASETS[dataset];

  useEffect(() => {
    if (scopeType === 'user' && !colUser) { setCols(null); return; }
    const params = scopeType === 'user' ? { dataset, userId: colUser.id } : { dataset, role };
    client.get('egress/columns', { params })
      .then(r => setCols(Array.isArray(r.data.columns) ? r.data.columns : null)).catch(() => setCols(null));
  }, [dataset, role, scopeType, colUser]);
  // The live form-field catalog widens the pool beyond the fixed columns: any
  // form field can be added as `fd:<name>`, and the exporter synthesizes it, so
  // these are real controls rather than decoration.
  useEffect(() => {
    client.get('forms/fields').then(r => setFormFields(r.data.fields || [])).catch(() => setFormFields([]));
  }, []);
  useEffect(() => {
    client.get('egress/list-layout', { params: { shell, role } })
      .then(r => setLayout(r.data.layout || { page_size: '', default_view: '' })).catch(() => setLayout({}));
  }, [shell, role]);

  // Unconfigured does NOT mean "every catalog column" — it means "whatever that
  // role's export button writes today". Seeding the first edit from the real
  // default is what keeps a save from silently WIDENING someone's export.
  // For a USER scope this must be that person's OWN role, not the generic
  // fallback: a compliance manager's sale export is 12 columns, the fallback is
  // 9, and saving from the wrong baseline would silently narrow their file.
  const defaultCols = useMemo(
    () => defaultColumnsForRole(dataset, scopeType === 'role' ? role : colUser?.role),
    [dataset, role, scopeType, colUser],
  );
  // What the file contains right now: the saved order, or this role's default.
  const effectiveCols = cols == null ? defaultCols : cols;

  // The pool the arranger offers = the dataset's fixed columns PLUS every live
  // form field (as fd:<name>) for datasets whose rows carry form_data. A form
  // field is only offered where the exporter can actually read it.
  const poolColumns = useMemo(() => {
    const base = (cat.fields || []).map(k => ({ key: k, label: labelFor(dataset, k), group: 'standard' }));
    if (!FORM_DATA_DATASETS.includes(dataset)) return base;
    const seen = new Set(base.map(c => c.key));
    const extra = (formFields || [])
      .map(f => ({ key: `${FORM_FIELD_PREFIX}${f.name}`, label: f.label || f.name, group: 'form field' }))
      .filter(c => !seen.has(c.key));
    return [...base, ...extra];
  }, [cat, dataset, formFields]);

  const saveCols = async () => {
    if (scopeType === 'user' && !colUser) { toast.error('Pick a user first'); return; }
    const arr = cols == null ? null : cols;
    const body = scopeType === 'user' ? { dataset, userId: colUser.id, columns: arr } : { dataset, role, columns: arr };
    try { await client.put('egress/columns', body); toast.success(`Export columns saved${scopeType === 'user' ? ` for ${colUser.name}` : ''}`); }
    catch (e) { toast.error(e.response?.data?.error || 'Save failed'); }
  };
  const saveLayout = async () => {
    try { await client.put('egress/list-layout', { shell, role, layout: { page_size: layout.page_size ? +layout.page_size : undefined, default_view: layout.default_view || undefined } }); toast.success('List display saved'); }
    catch (e) { toast.error(e.response?.data?.error || 'Save failed'); }
  };

  // The preview IS the arranged order, not the catalog order — otherwise the
  // "exactly how the file looks" claim would be false the moment you reorder.
  const previewFields = cat.fields.length ? effectiveCols : [];
  const previewLabel = (k) => poolColumns.find(c => c.key === k)?.label || k;
  const uuidField = cat.fields.includes('customer_uuid');
  const uuidShown = previewFields.includes('customer_uuid');

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
      {/* export columns */}
      <div className="p-4" style={box}>
        <div className="flex items-center gap-2 mb-3"><Columns size={16} style={{ color: 'var(--color-primary-600)' }} /><span className="text-sm font-bold">Export columns</span></div>
        <div className="flex gap-2 mb-2 flex-wrap items-center">
          <ThemedSelect value={dataset} onChange={e => setDataset(e.target.value)} style={inp}>{Object.entries(EXPORT_DATASETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</ThemedSelect>
          <div className="inline-flex rounded-lg overflow-hidden flex-shrink-0" style={{ border: '1px solid var(--color-border)' }}>
            {['role', 'user'].map(s => (
              <button key={s} type="button" onClick={() => setScopeType(s)} className="text-xs font-semibold px-3 py-1.5"
                style={{ background: scopeType === s ? 'var(--color-primary-600)' : 'transparent', color: scopeType === s ? '#fff' : 'var(--color-text-secondary)' }}>{s === 'role' ? 'By role' : 'By user'}</button>
            ))}
          </div>
          {scopeType === 'role'
            ? <ThemedSelect value={role} onChange={e => setRole(e.target.value)} style={inp}>{ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}</ThemedSelect>
            : <UserSearchPicker onPick={(u) => setColUser({ id: u.id, name: u.name, role: u.role })} />}
        </div>
        {scopeType === 'user' && (
          <p className="text-xs mb-2" style={{ color: colUser ? 'var(--color-primary-600)' : 'var(--color-text-tertiary)' }}>
            {colUser ? `Editing export columns for ${colUser.name} — this overrides their role's export.` : 'Pick a person above to set their personal export columns (one column, or as many as you want).'}
          </p>
        )}
        {cat.fields.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>The Data Analyzer has dynamic columns — its export field-selection is label-based and configured directly on the analyzer’s output (not a fixed catalog).</p>
        ) : (
          <>
            <p className="text-xs mb-2 m-0" style={{ color: 'var(--color-text-secondary)' }}>
              Drag to set the order of the exported file for {scopeType === 'user' ? (colUser?.name || 'the user') : 'this role'} — the top row is the first column.
              {' '}{cols == null && <b>Unconfigured — showing the columns this export writes today.</b>}
            </p>
            <div className="mb-3">
              <ColumnArranger
                columns={poolColumns}
                value={effectiveCols}
                onChange={setCols}
                sensitive={(k) => /uuid|phone|email|vin|payment/i.test(k) || k === 'customer_name'}
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              <button onClick={saveCols} className="text-sm font-bold px-3 py-1.5 rounded-lg text-white flex items-center gap-1.5" style={{ background: 'var(--gradient-sidebar)' }}><Check size={13} /> Save columns</button>
              {cols != null && <button onClick={() => setCols(null)} className="text-xs px-3 py-1.5 rounded-lg" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>Revert to the default set</button>}
            </div>
          </>
        )}
      </div>

      {/* list display */}
      <div className="p-4" style={box}>
        <div className="flex items-center gap-2 mb-3"><Sliders size={16} style={{ color: 'var(--color-primary-600)' }} /><span className="text-sm font-bold">List display</span></div>
        <div className="flex gap-2 mb-3">
          <ThemedSelect value={shell} onChange={e => setShell(e.target.value)} style={inp}>{SHELLS.map(s => <option key={s} value={s}>{s} shell</option>)}</ThemedSelect>
          <ThemedSelect value={role} onChange={e => setRole(e.target.value)} style={inp}>{ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}</ThemedSelect>
        </div>
        <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary)' }}>Blank page size = the shell’s built-in default. Applies to the list tables in that shell for that role.</p>
        <label className="block text-xs font-semibold mb-1">Rows per page</label>
        <input type="number" min="5" max="500" value={layout.page_size || ''} onChange={e => setLayout(l => ({ ...l, page_size: e.target.value }))} placeholder="default" style={{ ...inp, width: 120, marginBottom: 12 }} />
        <label className="block text-xs font-semibold mb-1">Default row view</label>
        <ThemedSelect value={layout.default_view || ''} onChange={e => setLayout(l => ({ ...l, default_view: e.target.value }))} style={{ ...inp, marginBottom: 12 }}>
          <option value="">Default (collapsed)</option><option value="collapsed">Collapsed</option><option value="expanded">Expanded</option>
        </ThemedSelect>
        <div><button onClick={saveLayout} className="text-sm font-bold px-3 py-1.5 rounded-lg text-white flex items-center gap-1.5" style={{ background: 'var(--gradient-sidebar)' }}><Check size={13} /> Save display</button></div>
        <p className="text-[11px] mt-3" style={{ color: 'var(--color-text-tertiary)' }}>Note: column-visibility here (display) is separate from export columns (left) — “what’s on screen” vs “what’s in the file”.</p>
      </div>
      </div>

      {/* FILE PREVIEW — exactly how the downloaded .csv header + a sample row look */}
      <div className="p-4" style={box}>
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <Download size={16} style={{ color: 'var(--color-primary-600)' }} />
          <span className="text-sm font-bold">File preview — {cat.label} export</span>
          <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>· {scopeType === 'user' ? (colUser?.name || 'pick a user') : role.replace(/_/g, ' ')}</span>
        </div>
        <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary)' }}>Exactly the header row (and a sample data row) of the downloaded <code>.csv</code> for the selections on the left — updates live as you check/uncheck columns.</p>
        {cat.fields.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Data Analyzer exports use dynamic, label-based columns chosen on the analyzer itself — there is no fixed header to preview here.</p>
        ) : previewFields.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--color-error-600,#dc2626)' }}>No columns selected — the exported file would have no data columns. Check at least one field on the left.</p>
        ) : (
          <>
            <TableScroll stickyFirst label="Egress records" className="rounded-lg" style={{ border: '1px solid var(--color-border)' }}>
              <table className="text-xs" style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
                <thead>
                  <tr style={{ background: 'var(--color-bg-secondary)' }}>
                    {previewFields.map(f => (
                      <th key={f} className="px-3 py-2 text-left whitespace-nowrap font-bold" style={{ borderRight: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                        {previewLabel(f)}{(/uuid|phone|email|vin|payment/i.test(f) || f === 'customer_name') && <span title="Sensitive / PII" style={{ color: '#d97706' }}> •</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>{previewFields.map(f => <td key={f} className="px-3 py-2 whitespace-nowrap" style={{ borderRight: '1px solid var(--color-border)', borderTop: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>{sampleFor(f)}</td>)}</tr>
                </tbody>
              </table>
            </TableScroll>
            <div className="mt-2 rounded-lg p-2 overflow-x-auto" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
              <div className="text-[11px] sm:text-[10px] font-bold mb-1" style={{ color: 'var(--color-text-tertiary)' }}>RAW CSV HEADER (column keys as written to the file)</div>
              {/* The header actually written. A form-field column stores as
                  fd:<name> but writes the bare field name, so strip the prefix
                  here rather than showing a header the file never contains. */}
              <code className="text-[11px] whitespace-nowrap" style={{ color: 'var(--color-text)' }}>
                {previewFields.map(f => (f.startsWith(FORM_FIELD_PREFIX) ? f.slice(FORM_FIELD_PREFIX.length) : f)).join(',')}
              </code>
            </div>
            {uuidField && (
              <p className="text-xs mt-2 flex items-start gap-1.5" style={{ color: uuidShown ? 'var(--color-warning-700,#b45309)' : 'var(--color-text-secondary)' }}>
                <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" /> Customer UUID column is <strong>{uuidShown ? ' INCLUDED' : ' hidden'}</strong> in this export{uuidShown ? ' — a stable per-customer identifier. Uncheck “Customer UUID” on the left to keep it out of the file.' : '.'}
              </p>
            )}
            <p className="text-[11px] mt-2" style={{ color: 'var(--color-text-tertiary)' }}>{cols == null ? `Unconfigured — this export writes these ${previewFields.length} columns today. Saving pins them, after which the file follows this list everywhere that role exports this data.` : `${previewFields.length} column${previewFields.length === 1 ? '' : 's'} will be written for this role.`}</p>
          </>
        )}
      </div>
    </div>
  );
}

// ── Export Access tab — per-role / per-user export-BUTTON on/off (mig 210) ─────
const EXPORT_ROLES = ['closer', 'fronter', 'closer_manager', 'fronter_manager', 'operations_manager', 'company_admin', 'compliance_manager', 'qa_manager', 'qa_agent'];
const AREA_LABEL = {
  __global: 'All exports', sales: 'Sales', transfers: 'Transfers', callbacks: 'Callbacks',
  reviews: 'Reviews', numbers: 'Numbers', customer_profile: 'Cust. Profiles',
  data_analyzer: 'Data Analyzer', company_data: 'Company Data', reports: 'Reports', qa: 'QA',
};
function ExportAccessTab() {
  const [access, setAccess] = useState([]);
  const [areas, setAreas] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    client.get('egress/export-access')
      .then(r => { setAccess(r.data.access || []); setAreas(r.data.areas || []); })
      .catch(() => toast.error('Failed to load export access'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const cols = ['__global', ...areas];
  const entry = (st, sid) => access.find(x => x.scope_type === st && String(x.scope_id) === String(sid));
  const isBlocked = (st, sid, area) => entry(st, sid)?.blocked?.[area] === true;
  const setBlocked = async (st, sid, area, blocked) => {
    const key = `${st}:${sid}:${area}`;
    setSaving(key);
    try {
      await client.put('egress/export-access', { scope_type: st, scope_id: sid, dataset: area === '__global' ? null : area, blocked });
      load();
    } catch { toast.error('Save failed'); } finally { setSaving(''); }
  };

  const userRows = access.filter(e => e.scope_type === 'user');
  const addUser = (u) => { if (!userRows.find(r => String(r.scope_id) === String(u.id))) setAccess(a => [...a, { scope_type: 'user', scope_id: u.id, scope_name: u.name, blocked: {} }]); };

  const Cell = ({ st, sid, area }) => {
    const blocked = isBlocked(st, sid, area);
    const key = `${st}:${sid}:${area}`;
    return (
      <td className="px-2 py-1.5 text-center">
        <input type="checkbox" checked={!blocked} disabled={saving === key}
          title={blocked ? 'Blocked — click to allow' : 'Allowed — click to block'}
          onChange={(e) => setBlocked(st, sid, area, !e.target.checked)} />
      </td>
    );
  };
  const Matrix = ({ scopeType, rows }) => (
    <TableScroll stickyFirst label="Egress records" className="rounded-xl" style={box}>
      <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
            <th className="px-3 py-2 text-left" style={{ color: 'var(--color-text-secondary)', position: 'sticky', left: 0, background: 'var(--color-surface)' }}>{scopeType === 'role' ? 'Role' : 'User'}</th>
            {cols.map(c => <th key={c} className="px-2 py-2 font-semibold whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>{AREA_LABEL[c] || c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
              <td className="px-3 py-1.5 font-semibold whitespace-nowrap" style={{ color: 'var(--color-text)', position: 'sticky', left: 0, background: 'var(--color-surface)' }}>{row.label}</td>
              {cols.map(c => <Cell key={c} st={scopeType} sid={row.id} area={c} />)}
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );

  return (
    <div className="space-y-5">
      <div className="rounded-xl p-3 text-xs flex items-start gap-2" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
        <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
        <span>Checked = the export button is <strong>visible + allowed</strong>. Uncheck to hide/disable it for that role or user. <strong>All exports</strong> is the master switch; the others refine it per area. A per-<strong>user</strong> setting overrides their <strong>role</strong>. Enforced server-side (egress guard) and hides the button on the user's next load.</span>
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>By role</h3>
        <button onClick={load} className="p-1.5 rounded-lg" style={{ border: '1px solid var(--color-border)' }} title="Refresh"><RefreshCw size={14} /></button>
      </div>
      {loading ? <div className="text-center py-6"><Loader2 size={18} className="animate-spin inline" /></div>
        : <Matrix scopeType="role" rows={EXPORT_ROLES.map(r => ({ id: r, label: r.replace(/_/g, ' ') }))} />}

      <div>
        <h3 className="text-sm font-bold mb-2" style={{ color: 'var(--color-text)' }}>By individual user (overrides their role)</h3>
        <div className="mb-2 max-w-md"><UserSearchPicker onPick={addUser} /></div>
        {userRows.length === 0
          ? <p className="text-xs italic" style={{ color: 'var(--color-text-tertiary)' }}>No per-user overrides yet. Search a person above to add one.</p>
          : <Matrix scopeType="user" rows={userRows.map(u => ({ id: u.scope_id, label: u.scope_name || u.scope_id }))} />}
      </div>
    </div>
  );
}

export default function EgressGovernance() {
  const [tab, setTab] = useState('audit');
  const TABS = [
    { k: 'audit', label: 'Export & Recording Audit', Icon: Download },
    { k: 'export-access', label: 'Export Access', Icon: Check },
    { k: 'limits', label: 'Egress Limits', Icon: Sliders },
    { k: 'fields', label: 'Fields & Display', Icon: Columns },
  ];
  return (
    <div className="space-y-5">
      <SectionHeader
        level="page"
        icon={Shield}
        title="Data Egress Governance"
        subtitle="Who may export what, how much per day, and which columns leave the system."
      />
      <PillTabs value={tab} onChange={setTab}
        items={TABS.map(({ k, label, Icon }) => ({ key: k, label, icon: Icon }))} />
      {tab === 'audit' && <AuditTab />}
      {tab === 'export-access' && <ExportAccessTab />}
      {tab === 'limits' && <LimitsTab />}
      {tab === 'fields' && <FieldsTab />}
    </div>
  );
}
