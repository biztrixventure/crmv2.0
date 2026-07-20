import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { Shield, Download, Sliders, Columns, Search, RefreshCw, Loader2, Plus, Trash2, ChevronDown, ChevronRight, Check, User, Building2, X, AlertTriangle, Headphones } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../../api/client';
import ThemedSelect from '../../UI/Select';
import ThemedDate from '../../UI/ThemedDate';

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
// Export datasets + their configurable field catalogs (field key → label). Typed
// columns per surface; the admin toggles which appear in the exported file.
const EXPORT_DATASETS = {
  sales:        { label: 'Sales', fields: ['customer_name', 'customer_phone', 'customer_email', 'reference_no', 'status', 'closer_name', 'fronter_name', 'company_name', 'sale_date', 'plan', 'client_name', 'monthly_payment', 'down_payment', 'car_year', 'car_make', 'car_model', 'car_vin'] },
  transfers:    { label: 'Transfers', fields: ['customer_name', 'customer_phone', 'created_by_name', 'assigned_closer_name', 'latest_disposition', 'company_name', 'status', 'created_at'] },
  callbacks:    { label: 'Callbacks', fields: ['customer_name', 'customer_phone', 'status', 'priority', 'callback_at', 'notes', 'fronter_name', 'closer_name', 'company_name'] },
  reviews:      { label: 'Call Reviews', fields: ['customer_name', 'rating', 'reviewer_name', 'created_at', 'notes'] },
  data_analyzer:{ label: 'Data Analyzer', fields: [] },   // dynamic (label-based) — configured on the analyzer's own columns
};
const SHELLS = ['staff', 'manager', 'compliance'];

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
    { label: 'Exports today', value: stats?.exports, Icon: Download, tint: 'var(--color-primary-600)' },
    { label: 'Denied today', value: stats?.denied, Icon: AlertTriangle, tint: '#dc2626' },
    { label: 'Recordings today', value: stats?.recordings, Icon: Headphones, tint: '#7c3aed' },
    { label: 'Active users', value: stats?.users, Icon: User, tint: '#059669' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {tiles.map(t => (
          <div key={t.label} className="p-3 flex items-center gap-3" style={box}>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--color-bg-secondary)' }}>
              <t.Icon size={16} style={{ color: t.tint }} />
            </div>
            <div className="min-w-0">
              <div className="text-lg font-bold tabular-nums" style={{ color: 'var(--color-text)' }}>{t.value == null ? '—' : t.value.toLocaleString()}</div>
              <div className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>{t.label}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2 p-3" style={box}>
        <label className="text-xs">Action
          <ThemedSelect value={f.action_type} onChange={e => setFilter('action_type', e.target.value)} style={{ ...inp, display: 'block', marginTop: 4 }}>
            <option value="">All</option>{(meta.actions.length ? meta.actions : ACTIONS).map(a => <option key={a} value={a}>{a}</option>)}
          </ThemedSelect>
        </label>
        <label className="text-xs">Dataset
          <ThemedSelect value={f.dataset} onChange={e => setFilter('dataset', e.target.value)} style={{ ...inp, display: 'block', marginTop: 4 }}>
            <option value="">All</option>{meta.datasets.map(d => <option key={d} value={d}>{d}</option>)}
          </ThemedSelect>
        </label>
        <label className="text-xs">Status
          <ThemedSelect value={f.status} onChange={e => setFilter('status', e.target.value)} style={{ ...inp, display: 'block', marginTop: 4 }}>
            <option value="">All</option><option value="allowed">Allowed</option><option value="denied">Denied</option>
          </ThemedSelect>
        </label>
        <label className="text-xs">From<ThemedDate value={f.date_from} onChange={e => setFilter('date_from', e.target.value)} style={{ ...inp, display: 'block', marginTop: 4 }} /></label>
        <label className="text-xs">To<ThemedDate value={f.date_to} onChange={e => setFilter('date_to', e.target.value)} style={{ ...inp, display: 'block', marginTop: 4 }} /></label>
        <button onClick={load} className="p-2 rounded-lg" style={{ border: '1px solid var(--color-border)' }} title="Refresh"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
        <span className="text-xs ml-auto" style={{ color: 'var(--color-text-tertiary)' }}>{total.toLocaleString()} events</span>
      </div>

      <div className="rounded-xl overflow-x-auto" style={box}>
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
      </div>

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
function LimitsTab() {
  const [limits, setLimits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [companies, setCompanies] = useState([]);
  const [picked, setPicked] = useState(null);   // { id, name } chosen scope target
  const [draft, setDraft] = useState({ scope_type: 'user', scope_id: '', action_type: 'csv_export', max_rows_per_export: '', max_exports_per_day: '', max_recording_minutes_per_day: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await client.get('egress/limits'); setLimits(r.data.limits || []); } catch { setLimits([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { client.get('compliance/companies').then(r => setCompanies(r.data.companies || [])).catch(() => {}); }, []);
  // reset the picked target when switching User↔Company mode
  const setScopeType = (t) => { setPicked(null); setDraft(d => ({ ...d, scope_type: t, scope_id: '' })); };

  const save = async (row) => {
    try {
      await client.put('egress/limits', row);
      toast.success('Limit saved'); load();
    } catch (e) { toast.error(e.response?.data?.error || 'Save failed'); }
  };
  const del = async (id) => { try { await client.delete(`egress/limits/${id}`); load(); } catch { /* ignore */ } };

  const roleRows = limits.filter(l => l.scope_type === 'role');
  const overrideRows = limits.filter(l => l.scope_type !== 'role');

  const cell = (row, field) => (
    <div className="relative" style={{ width: 96 }}>
      <input type="number" min="0" defaultValue={numOrBlank(row[field])} placeholder="∞"
        onBlur={e => { const v = e.target.value; if (v !== numOrBlank(row[field])) save({ ...row, [field]: v === '' ? null : +v }); }}
        title={row[field] == null ? 'Unlimited' : `${row[field].toLocaleString()}`}
        style={{ ...inp, width: 96, textAlign: 'right' }} />
      {row[field] == null && <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>∞ unlimited</span>}
    </div>
  );

  const addOverride = () => {
    if (!picked?.id) return toast.error(`Pick a ${draft.scope_type} first`);
    save({ ...draft, scope_id: picked.id,
      max_rows_per_export: draft.max_rows_per_export || null,
      max_exports_per_day: draft.max_exports_per_day || null,
      max_recording_minutes_per_day: draft.max_recording_minutes_per_day || null });
    setPicked(null); setDraft(d => ({ ...d, scope_id: '', max_rows_per_export: '', max_exports_per_day: '', max_recording_minutes_per_day: '' }));
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-bold mb-1" style={{ color: 'var(--color-text)' }}>Role defaults</p>
        <p className="text-xs mb-2" style={{ color: 'var(--color-text-secondary)' }}>Blank = unlimited. Applies to every user of that role unless a company/user override exists. Edits save on blur.</p>
        <div className="rounded-xl overflow-x-auto" style={box}>
          <table className="w-full text-sm">
            <thead><tr style={{ color: 'var(--color-text-secondary)', background: 'var(--color-bg-secondary)' }}>
              {['Role', 'Action', 'Max rows / export', 'Max exports / day', 'Max rec. min / day'].map(h => <th key={h} className="text-left px-3 py-2 text-xs font-semibold">{h}</th>)}
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={5} className="text-center py-8"><Loader2 className="animate-spin inline" /></td></tr>
                : roleRows.map(r => (
                  <tr key={r.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                    <td className="px-3 py-2 font-semibold capitalize">{r.scope_id.replace(/_/g, ' ')}</td>
                    <td className="px-3 py-2">{r.action_type}</td>
                    <td className="px-3 py-2">{cell(r, 'max_rows_per_export')}</td>
                    <td className="px-3 py-2">{cell(r, 'max_exports_per_day')}</td>
                    <td className="px-3 py-2">{r.action_type === 'recording_listen' ? cell(r, 'max_recording_minutes_per_day') : <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <p className="text-sm font-bold mb-1" style={{ color: 'var(--color-text)' }}>Per-user / per-company overrides <span className="text-xs font-normal" style={{ color: 'var(--color-text-tertiary)' }}>(rare — beats the role default wholesale)</span></p>
        <div className="p-3 mb-2 space-y-3" style={box}>
          {/* who: user↔company toggle + a real picker (no raw UUIDs) */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              {[['user', 'User', User], ['company', 'Company', Building2]].map(([t, label, Icon]) => (
                <button key={t} onClick={() => setScopeType(t)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold"
                  style={{ background: draft.scope_type === t ? 'var(--gradient-sidebar)' : 'transparent', color: draft.scope_type === t ? '#fff' : 'var(--color-text-secondary)' }}>
                  <Icon size={13} /> {label}
                </button>
              ))}
            </div>
            {picked ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold px-2.5 py-1.5 rounded-lg" style={{ background: 'var(--color-primary-100,#e0e7ff)', color: 'var(--color-primary-700,#4338ca)' }}>
                {draft.scope_type === 'user' ? <User size={13} /> : <Building2 size={13} />} {picked.name}
                <button onClick={() => setPicked(null)} className="hover:opacity-70"><X size={13} /></button>
              </span>
            ) : draft.scope_type === 'user' ? (
              <UserSearchPicker onPick={u => setPicked({ id: u.id, name: u.name })} />
            ) : (
              <ThemedSelect value="" onChange={e => { const c = companies.find(x => x.id === e.target.value); if (c) setPicked({ id: c.id, name: c.name }); }}
                style={{ ...inp, flex: 1, minWidth: 220 }}>
                <option value="">Choose a company…</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </ThemedSelect>
            )}
          </div>
          {/* what + how much */}
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs">Action
              <ThemedSelect value={draft.action_type} onChange={e => setDraft(d => ({ ...d, action_type: e.target.value }))} style={{ ...inp, display: 'block', marginTop: 4 }}>
                {ACTIONS.map(a => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
              </ThemedSelect>
            </label>
            <label className="text-xs">Max rows / export<input type="number" min="0" value={draft.max_rows_per_export} onChange={e => setDraft(d => ({ ...d, max_rows_per_export: e.target.value }))} placeholder="∞ unlimited" style={{ ...inp, display: 'block', marginTop: 4, width: 120 }} /></label>
            <label className="text-xs">Max exports / day<input type="number" min="0" value={draft.max_exports_per_day} onChange={e => setDraft(d => ({ ...d, max_exports_per_day: e.target.value }))} placeholder="∞ unlimited" style={{ ...inp, display: 'block', marginTop: 4, width: 120 }} /></label>
            {draft.action_type === 'recording_listen' && (
              <label className="text-xs">Max rec. min / day<input type="number" min="0" value={draft.max_recording_minutes_per_day} onChange={e => setDraft(d => ({ ...d, max_recording_minutes_per_day: e.target.value }))} placeholder="∞ unlimited" style={{ ...inp, display: 'block', marginTop: 4, width: 120 }} /></label>
            )}
            <button onClick={addOverride} disabled={!picked}
              className="text-sm font-bold px-3 py-2 rounded-lg flex items-center gap-1.5 text-white disabled:opacity-50" style={{ background: 'var(--gradient-sidebar)' }}><Plus size={14} /> Add override</button>
          </div>
          <p className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>Blank = unlimited for that field. A user/company override beats the role default wholesale for that action.</p>
        </div>
        <div className="rounded-xl overflow-x-auto" style={box}>
          <table className="w-full text-sm">
            <thead><tr style={{ color: 'var(--color-text-secondary)', background: 'var(--color-bg-secondary)' }}>
              {['Scope', 'Name', 'Action', 'Rows', 'Exports/day', 'Rec min/day', ''].map(h => <th key={h} className="text-left px-3 py-2 text-xs font-semibold">{h}</th>)}
            </tr></thead>
            <tbody>
              {overrideRows.length === 0 ? <tr><td colSpan={7} className="text-center py-6 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No overrides. Role defaults apply to everyone.</td></tr>
                : overrideRows.map(r => (
                  <tr key={r.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5 capitalize">
                        {r.scope_type === 'user' ? <User size={13} style={{ color: 'var(--color-text-tertiary)' }} /> : <Building2 size={13} style={{ color: 'var(--color-text-tertiary)' }} />}
                        {r.scope_type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs font-semibold">{r.scope_name || r.scope_id}</td>
                    <td className="px-3 py-2">{r.action_type}</td>
                    <td className="px-3 py-2">{cell(r, 'max_rows_per_export')}</td>
                    <td className="px-3 py-2">{cell(r, 'max_exports_per_day')}</td>
                    <td className="px-3 py-2">{cell(r, 'max_recording_minutes_per_day')}</td>
                    <td className="px-3 py-2"><button onClick={() => del(r.id)} style={{ color: '#ef4444' }}><Trash2 size={14} /></button></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Fields & Display tab ──────────────────────────────────────────────────────
function FieldsTab() {
  const [dataset, setDataset] = useState('sales');
  const [role, setRole] = useState('closer');
  const [cols, setCols] = useState(null);        // null = all (unconfigured)
  const [shell, setShell] = useState('compliance');
  const [layout, setLayout] = useState({ page_size: '', default_view: '' });
  const cat = EXPORT_DATASETS[dataset];

  useEffect(() => {
    client.get('egress/columns', { params: { dataset, role } })
      .then(r => setCols(Array.isArray(r.data.columns) ? new Set(r.data.columns) : null)).catch(() => setCols(null));
  }, [dataset, role]);
  useEffect(() => {
    client.get('egress/list-layout', { params: { shell, role } })
      .then(r => setLayout(r.data.layout || { page_size: '', default_view: '' })).catch(() => setLayout({}));
  }, [shell, role]);

  const toggleCol = (field) => {
    setCols(prev => {
      const next = new Set(prev == null ? cat.fields : prev);   // first edit seeds from "all"
      next.has(field) ? next.delete(field) : next.add(field);
      return next;
    });
  };
  const saveCols = async () => {
    const arr = cols == null ? null : [...cols];
    try { await client.put('egress/columns', { dataset, role, columns: arr }); toast.success('Export columns saved'); }
    catch (e) { toast.error(e.response?.data?.error || 'Save failed'); }
  };
  const saveLayout = async () => {
    try { await client.put('egress/list-layout', { shell, role, layout: { page_size: layout.page_size ? +layout.page_size : undefined, default_view: layout.default_view || undefined } }); toast.success('List display saved'); }
    catch (e) { toast.error(e.response?.data?.error || 'Save failed'); }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {/* export columns */}
      <div className="p-4" style={box}>
        <div className="flex items-center gap-2 mb-3"><Columns size={16} style={{ color: 'var(--color-primary-600)' }} /><span className="text-sm font-bold">Export columns</span></div>
        <div className="flex gap-2 mb-3">
          <ThemedSelect value={dataset} onChange={e => setDataset(e.target.value)} style={inp}>{Object.entries(EXPORT_DATASETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</ThemedSelect>
          <ThemedSelect value={role} onChange={e => setRole(e.target.value)} style={inp}>{ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}</ThemedSelect>
        </div>
        {cat.fields.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>The Data Analyzer has dynamic columns — its export field-selection is label-based and configured directly on the analyzer’s output (not a fixed catalog).</p>
        ) : (
          <>
            <p className="text-xs mb-2" style={{ color: 'var(--color-text-secondary)' }}>Checked = included in the exported file for this role. {cols == null && <b>Currently all fields (unconfigured).</b>}</p>
            <div className="grid grid-cols-2 gap-1.5 max-h-64 overflow-y-auto mb-3">
              {cat.fields.map(field => {
                const on = cols == null ? true : cols.has(field);
                return (
                  <label key={field} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg cursor-pointer" style={{ background: on ? 'var(--color-primary-50,#eef2ff)' : 'transparent', border: '1px solid var(--color-border)' }}>
                    <input type="checkbox" checked={on} onChange={() => toggleCol(field)} />
                    {field}
                  </label>
                );
              })}
            </div>
            <div className="flex gap-2">
              <button onClick={saveCols} className="text-sm font-bold px-3 py-1.5 rounded-lg text-white flex items-center gap-1.5" style={{ background: 'var(--gradient-sidebar)' }}><Check size={13} /> Save columns</button>
              {cols != null && <button onClick={() => setCols(null)} className="text-xs px-3 py-1.5 rounded-lg" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>Reset to all</button>}
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
  );
}

export default function EgressGovernance() {
  const [tab, setTab] = useState('audit');
  const TABS = [
    { k: 'audit', label: 'Export & Recording Audit', Icon: Download },
    { k: 'limits', label: 'Egress Limits', Icon: Sliders },
    { k: 'fields', label: 'Fields & Display', Icon: Columns },
  ];
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Shield size={20} style={{ color: 'var(--color-primary-600)' }} />
        <h2 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>Data Egress Governance</h2>
      </div>
      <div className="flex gap-1 p-1 rounded-xl w-fit" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
        {TABS.map(({ k, label, Icon }) => (
          <button key={k} onClick={() => setTab(k)} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold"
            style={{ background: tab === k ? 'var(--gradient-sidebar)' : 'transparent', color: tab === k ? '#fff' : 'var(--color-text-secondary)' }}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>
      {tab === 'audit' && <AuditTab />}
      {tab === 'limits' && <LimitsTab />}
      {tab === 'fields' && <FieldsTab />}
    </div>
  );
}
