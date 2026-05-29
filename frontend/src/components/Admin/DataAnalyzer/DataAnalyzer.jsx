import { useState, useEffect, useMemo, useCallback } from 'react';
import { Filter, Search, X, Loader2, Database, ChevronDown, ChevronUp } from 'lucide-react';
import client from '../../../api/client';
import StateGrid from './StateGrid';

// All 50 states + DC. Used to identify "state-like" form fields and to seed
// the StateGrid options when the form field doesn't carry an explicit list.
const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
];
const STATE_SET = new Set(US_STATES);

// Routing each form_field's `field_type` to a control kind drives the whole UI
// without per-field hard-coding — adding a new field_type in form_fields just
// shows up as a text filter until a new branch is added here.
const kindFor = (f) => {
  const name = String(f.name || '').toLowerCase();
  const label = String(f.label || '').toLowerCase();
  if (/state\b/.test(name) || /state\b/.test(label)) return 'state';
  switch (f.field_type) {
    case 'select':                 return 'multi';
    case 'checkbox':               return 'bool';
    case 'number':
    case 'sale_down_payment':
    case 'sale_monthly_payment':   return 'range_num';
    case 'date':
    case 'sale_date':              return 'range_date';
    case 'sale_status':            return 'multi_enum';
    default:                       return 'text';
  }
};

// Known enum lists for the few special field_types that don't carry their own
// options. Anything else with field_type='select' uses its own options list.
const ENUMS = {
  sale_status: ['open', 'pending_review', 'closed_won', 'closed_lost', 'sold', 'cancelled', 'follow_up', 'needs_revision'],
};

const SECTION = ({ title, open, onToggle, children, count }) => (
  <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
    <button type="button" onClick={onToggle}
      className="w-full flex items-center justify-between px-4 py-2.5"
      style={{ backgroundColor: 'var(--color-bg-secondary)', borderBottom: open ? '1px solid var(--color-border)' : 'none' }}>
      <span className="flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--color-text)' }}>
        {title}
        {count > 0 && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
            style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>
            {count}
          </span>
        )}
      </span>
      {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
    </button>
    {open && <div className="p-4 space-y-3">{children}</div>}
  </div>
);

const Label = ({ children, sub }) => (
  <label className="block text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-text-secondary)' }}>
    {children}
    {sub && <span className="ml-1 font-medium normal-case opacity-60">{sub}</span>}
  </label>
);

// One control per field, returned in a list. State for each filter lives in
// `filters[field.name]` so a single payload feeds both the UI and the request.
const FieldControl = ({ field, value, onChange }) => {
  const kind = kindFor(field);
  const set  = (v) => onChange(v);

  if (kind === 'state') {
    return <StateGrid value={value || []} onChange={set} states={US_STATES} />;
  }
  if (kind === 'multi' || kind === 'multi_enum') {
    const options = kind === 'multi_enum'
      ? ENUMS[field.field_type] || []
      : Array.isArray(field.options) ? field.options : [];
    const sel = new Set(value || []);
    return (
      <div className="flex flex-wrap gap-1.5">
        {options.length === 0
          ? <p className="text-xs italic" style={{ color: 'var(--color-text-tertiary)' }}>No options configured.</p>
          : options.map(o => {
            const on = sel.has(o);
            return (
              <button key={o} type="button"
                onClick={() => set(on ? (value || []).filter(x => x !== o) : [...(value || []), o])}
                className="text-xs font-semibold px-2.5 py-1 rounded-md transition-colors"
                style={{
                  backgroundColor: on ? 'var(--color-primary-600)' : 'var(--color-bg-secondary)',
                  color:           on ? 'white' : 'var(--color-text-secondary)',
                  border: `1px solid ${on ? 'var(--color-primary-600)' : 'var(--color-border)'}`,
                }}>
                {String(o).replace(/_/g, ' ')}
              </button>
            );
          })}
      </div>
    );
  }
  if (kind === 'bool') {
    return (
      <div className="flex gap-2">
        {[['', 'Any'], ['true', 'Yes'], ['false', 'No']].map(([v, l]) => (
          <button key={v} type="button" onClick={() => set(v)}
            className="text-xs font-semibold px-3 py-1 rounded-md"
            style={{
              backgroundColor: (value || '') === v ? 'var(--color-primary-600)' : 'var(--color-bg-secondary)',
              color:           (value || '') === v ? 'white' : 'var(--color-text-secondary)',
              border: '1px solid var(--color-border)',
            }}>{l}</button>
        ))}
      </div>
    );
  }
  if (kind === 'range_num') {
    const [lo = '', hi = ''] = value || [];
    return (
      <div className="grid grid-cols-2 gap-2">
        <input type="number" value={lo} onChange={e => set([e.target.value, hi])} className="input text-sm" placeholder="Min" />
        <input type="number" value={hi} onChange={e => set([lo, e.target.value])} className="input text-sm" placeholder="Max" />
      </div>
    );
  }
  if (kind === 'range_date') {
    const [lo = '', hi = ''] = value || [];
    return (
      <div className="grid grid-cols-2 gap-2">
        <input type="date" value={lo} onChange={e => set([e.target.value, hi])} className="input text-sm" />
        <input type="date" value={hi} onChange={e => set([lo, e.target.value])} className="input text-sm" />
      </div>
    );
  }
  return (
    <input type="text" value={value || ''} onChange={e => set(e.target.value)} className="input text-sm" placeholder="Contains…" />
  );
};

// Convert the UI filter map → backend payload.
const buildPayload = (fields, filters) => fields
  .map(f => {
    const v = filters[f.name];
    const kind = kindFor(f);
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) return null;
    if (kind === 'state' || kind === 'multi' || kind === 'multi_enum') {
      return Array.isArray(v) && v.length ? { field: f.name, op: 'in', value: v } : null;
    }
    if (kind === 'bool') return { field: f.name, op: 'eq', value: v };
    if (kind === 'range_num' || kind === 'range_date') {
      const [lo, hi] = v;
      if ((lo === '' || lo == null) && (hi === '' || hi == null)) return null;
      return { field: f.name, op: 'between', value: [lo, hi] };
    }
    return { field: f.name, op: 'ilike', value: v };
  })
  .filter(Boolean);

const DataAnalyzer = () => {
  const [fields, setFields]     = useState([]);
  const [filters, setFilters]   = useState({});
  const [open, setOpen]         = useState({ filters: true });
  const [rows, setRows]         = useState([]);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(1);
  const [limit]                 = useState(50);
  const [loading, setLoading]   = useState(false);
  const [err, setErr]           = useState('');

  useEffect(() => {
    client.get('forms/fields').then(r => setFields(r.data.fields || [])).catch(() => {});
  }, []);

  const payload = useMemo(() => buildPayload(fields, filters), [fields, filters]);
  const activeCount = payload.length;

  const run = useCallback(async (p = 1) => {
    setLoading(true); setErr('');
    try {
      const r = await client.post('data-analyzer/query', { filters: payload, page: p, limit });
      setRows(r.data.sales || []);
      setTotal(r.data.total || 0);
      setPage(p);
    } catch (e) { setErr(e.response?.data?.error || 'Query failed'); }
    finally { setLoading(false); }
  }, [payload, limit]);

  // Auto-run once on first field load so the table isn't blank.
  useEffect(() => { if (fields.length) run(1); /* eslint-disable-next-line */ }, [fields.length]);

  const reset = () => { setFilters({}); setPage(1); };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="rounded-2xl p-6 flex items-center justify-between flex-wrap gap-3" style={{ background: 'var(--gradient-sidebar)' }}>
        <div className="flex items-center gap-2.5">
          <Database size={22} className="text-white" />
          <div>
            <h2 className="text-2xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>Data Analyzer</h2>
            <p className="text-sm text-white/80">Filter sales across every configured form field.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={reset}
            className="px-3 py-2 rounded-lg text-xs font-bold bg-white/20 hover:bg-white/30 text-white">
            Clear ({activeCount})
          </button>
          <button onClick={() => run(1)} disabled={loading}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-white text-primary-700 disabled:opacity-50">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Run query
          </button>
        </div>
      </div>

      {err && <p className="text-sm rounded-xl p-3" style={{ backgroundColor: 'var(--color-error-50)', color: 'var(--color-error-700)' }}>{err}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-5">
        {/* Filters panel */}
        <SECTION title={<span className="flex items-center gap-1.5"><Filter size={14} /> Filters</span>}
          open={open.filters} onToggle={() => setOpen(o => ({ ...o, filters: !o.filters }))} count={activeCount}>
          {fields.length === 0
            ? <p className="text-sm italic" style={{ color: 'var(--color-text-tertiary)' }}>Loading form fields…</p>
            : fields.map(f => {
              const v = filters[f.name];
              const active = v != null && v !== '' && !(Array.isArray(v) && v.length === 0);
              return (
                <div key={f.id || f.name} className="rounded-lg p-2.5"
                  style={{ border: `1px solid ${active ? 'var(--color-primary-300)' : 'var(--color-border)'}`, backgroundColor: active ? 'var(--color-primary-50)' : 'transparent' }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <Label sub={`(${f.field_type})`}>{f.label || f.name}</Label>
                    {active && (
                      <button type="button" onClick={() => setFilters(s => { const n = { ...s }; delete n[f.name]; return n; })}
                        className="text-[10px] font-bold flex items-center gap-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                        <X size={11} /> clear
                      </button>
                    )}
                  </div>
                  <FieldControl field={f} value={v} onChange={(nv) => setFilters(s => ({ ...s, [f.name]: nv }))} />
                </div>
              );
            })}
        </SECTION>

        {/* Results */}
        <div className="space-y-3">
          <div className="rounded-xl px-4 py-2.5 flex items-center justify-between" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              <strong>{total.toLocaleString()}</strong> match{total === 1 ? '' : 'es'} · page {page} of {Math.max(1, Math.ceil(total / limit))}
            </span>
            <div className="flex gap-1.5">
              <button onClick={() => run(page - 1)} disabled={loading || page <= 1}
                className="px-3 py-1 rounded-md text-xs font-bold disabled:opacity-30" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>Prev</button>
              <button onClick={() => run(page + 1)} disabled={loading || page * limit >= total}
                className="px-3 py-1 rounded-md text-xs font-bold disabled:opacity-30" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>Next</button>
            </div>
          </div>

          <div className="rounded-xl overflow-x-auto" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                  {['Customer', 'Phone', 'Car', 'Plan', 'Down', '/mo', 'Status', 'Company', 'Closer', 'Sale Date'].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading
                  ? <tr><td colSpan={10} className="text-center py-6 text-sm" style={{ color: 'var(--color-text-tertiary)' }}><Loader2 size={16} className="animate-spin inline mr-1" /> Loading…</td></tr>
                  : rows.length === 0
                    ? <tr><td colSpan={10} className="text-center py-10 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No matches.</td></tr>
                    : rows.map(s => (
                      <tr key={s.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td className="px-3 py-2 font-semibold" style={{ color: 'var(--color-text)' }}>{s.customer_name || '—'}</td>
                        <td className="px-3 py-2" style={{ color: 'var(--color-text-secondary)' }}>{s.customer_phone || '—'}</td>
                        <td className="px-3 py-2" style={{ color: 'var(--color-text-secondary)' }}>{[s.car_year, s.car_make, s.car_model].filter(Boolean).join(' ') || '—'}</td>
                        <td className="px-3 py-2" style={{ color: 'var(--color-text-secondary)' }}>{s.plan || '—'}</td>
                        <td className="px-3 py-2" style={{ color: 'var(--color-text-secondary)' }}>{s.down_payment ? `$${Number(s.down_payment).toLocaleString()}` : '—'}</td>
                        <td className="px-3 py-2" style={{ color: 'var(--color-text-secondary)' }}>{s.monthly_payment ? `$${Number(s.monthly_payment).toLocaleString()}` : '—'}</td>
                        <td className="px-3 py-2" style={{ color: 'var(--color-text-secondary)' }}>{s.status || '—'}</td>
                        <td className="px-3 py-2" style={{ color: 'var(--color-text-secondary)' }}>{s.company_name || '—'}</td>
                        <td className="px-3 py-2" style={{ color: 'var(--color-text-secondary)' }}>{s.closer_name || '—'}</td>
                        <td className="px-3 py-2" style={{ color: 'var(--color-text-secondary)' }}>{s.sale_date || '—'}</td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DataAnalyzer;
export { US_STATES, STATE_SET };
