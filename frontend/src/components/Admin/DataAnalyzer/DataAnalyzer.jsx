import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRef } from 'react';
import { Filter, Search, X, Loader2, Database, ChevronDown, ChevronUp, Download, BookmarkPlus, BarChart3, DollarSign, Send, Trash2, Building2, CalendarRange, GripVertical } from 'lucide-react';
import client from '../../../api/client';
import StateGrid, { ChipGrid, CollapsibleChipGrid } from './StateGrid';

// Persisted custom order of the filter cards (drag-and-drop).
const ORDER_KEY = 'bsx_data_analyzer_field_order_v1';
const readOrder  = () => { try { return JSON.parse(localStorage.getItem(ORDER_KEY) || '[]'); } catch { return []; } };
const writeOrder = (o) => { try { localStorage.setItem(ORDER_KEY, JSON.stringify(o)); } catch { /* quota */ } };

// Single, meaningful date column per dataset: the actual sale date for sales,
// the date the transfer happened for transfers.
const DATE_FIELDS = {
  sales:     [{ v: 'sale_date',  l: 'Sale date' }],
  transfers: [{ v: 'created_at', l: 'Transfer date' }],
};
const ymd = (d) => d.toISOString().slice(0, 10);

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
];

// Forms store the full state name ("New York"); the analyzer chip grid shows
// initials for compactness. These maps let us display "NY" in the grid while
// sending "New York" to the backend `in` filter so the WHERE clause actually
// matches what's in form_data.
const STATE_INITIAL_TO_FULL = {
  AL: 'Alabama',        AK: 'Alaska',        AZ: 'Arizona',        AR: 'Arkansas',
  CA: 'California',     CO: 'Colorado',      CT: 'Connecticut',    DE: 'Delaware',
  FL: 'Florida',        GA: 'Georgia',       HI: 'Hawaii',         ID: 'Idaho',
  IL: 'Illinois',       IN: 'Indiana',       IA: 'Iowa',           KS: 'Kansas',
  KY: 'Kentucky',       LA: 'Louisiana',     ME: 'Maine',          MD: 'Maryland',
  MA: 'Massachusetts',  MI: 'Michigan',      MN: 'Minnesota',      MS: 'Mississippi',
  MO: 'Missouri',       MT: 'Montana',       NE: 'Nebraska',       NV: 'Nevada',
  NH: 'New Hampshire',  NJ: 'New Jersey',    NM: 'New Mexico',     NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota',  OH: 'Ohio',           OK: 'Oklahoma',
  OR: 'Oregon',         PA: 'Pennsylvania',  RI: 'Rhode Island',   SC: 'South Carolina',
  SD: 'South Dakota',   TN: 'Tennessee',     TX: 'Texas',          UT: 'Utah',
  VT: 'Vermont',        VA: 'Virginia',      WA: 'Washington',     WV: 'West Virginia',
  WI: 'Wisconsin',      WY: 'Wyoming',       DC: 'District of Columbia',
};
const STATE_FULL_TO_INITIAL = Object.fromEntries(Object.entries(STATE_INITIAL_TO_FULL).map(([k, v]) => [v.toLowerCase(), k]));

// Routing each form_field's `field_type` to a control kind drives the whole UI
// without per-field hard-coding — a new field_type in form_fields shows up as
// a text filter until a new branch is added here.
const kindFor = (f) => {
  if (f.field_type === 'agent') return 'agent';   // closer/fronter person picker
  const name  = String(f.name  || '').toLowerCase();
  const label = String(f.label || '').toLowerCase();
  // Name/label pattern detection runs BEFORE field_type — so a `select` with
  // name=State still becomes a state grid, and a free-text `Make` field still
  // becomes a make grid.
  if (/state\b/.test(name) || /state\b/.test(label)) return 'state';
  // Model check must run BEFORE make so "car_model" doesn't accidentally match
  // the /make/ pattern via substring (it doesn't today, but the order keeps
  // future renames safe).
  if (/\bmodel\b/.test(name) || /\bmodel\b/.test(label)) return 'car_model';
  if (/make/.test(name)    || /make/.test(label))    return 'make';
  // Numeric fields → a start/end range. Detected by name/label because the form
  // schema often types mileage/zip as plain text/zip rather than number. Year is
  // also caught here (in addition to its field_type:number).
  if (/year|mile|odomet|zip|postal/.test(name) || /year|mile|odomet|zip|postal/.test(label)) return 'range_num';
  // sale_client → Plan parent; sale_plan → its child. Field_type-based detection
  // covers admin-named variants like SalePlan / CustomPlan.
  if (f.field_type === 'sale_client') return 'sale_client';
  if (f.field_type === 'sale_plan') return 'sale_plan';
  switch (f.field_type) {
    case 'select':                 return 'multi';
    case 'checkbox':               return 'bool';
    case 'number':
    case 'sale_down_payment':
    case 'sale_monthly_payment':   return 'range_num';
    case 'date':
    case 'sale_date':              return 'range_date';
    case 'sale_status':            return 'multi_enum';
    default:
      // Any field whose form_fields row carries a non-empty options[] becomes
      // a chip-grid filter — covers sale_disposition, sale_call_review, and
      // any future option-bearing type without per-type wiring. The string-only
      // guard skips sale_plan which uses options as { client, plans } objects.
      if (Array.isArray(f.options) && f.options.length > 0 && f.options.every(o => typeof o === 'string')) {
        return 'multi';
      }
      return 'text';
  }
};

const SALE_STATUSES     = ['open', 'pending_review', 'closed_won', 'closed_lost', 'sold', 'cancelled', 'follow_up', 'needs_revision'];
const TRANSFER_STATUSES = ['pending', 'assigned', 'completed', 'rejected', 'cancelled'];

// Datasets share the same filter UI (form_fields) but get dataset-specific
// extras like the always-on Status filter and the group-by candidates.
const DATASETS = {
  sales: {
    label: 'Sales', icon: DollarSign,
    statusField: { name: 'status', label: 'Status', field_type: 'sale_status', options: SALE_STATUSES, _enum: true },
    columns: [
      { key: 'customer_name', label: 'Customer' },
      { key: 'customer_phone', label: 'Phone' },
      { key: '_car',          label: 'Car', render: r => [r.car_year, r.car_make, r.car_model].filter(Boolean).join(' ') || '—' },
      { key: 'plan',          label: 'Plan' },
      { key: 'down_payment',  label: 'Down',  render: r => r.down_payment ? `$${Number(r.down_payment).toLocaleString()}` : '—' },
      { key: 'monthly_payment', label: '/mo', render: r => r.monthly_payment ? `$${Number(r.monthly_payment).toLocaleString()}` : '—' },
      { key: 'status',        label: 'Status' },
      { key: 'closer_disposition', label: 'Disposition' },
      { key: 'company_name',  label: 'Company' },
      { key: 'closer_name',   label: 'Closer' },
      { key: 'sale_date',     label: 'Sale Date' },
    ],
    groupOptions: [
      { value: 'status',             label: 'Status' },
      { value: 'closer_disposition', label: 'Disposition' },
      { value: 'plan',       label: 'Plan' },
      { value: 'car_make',   label: 'Car Make' },
      { value: 'car_year',   label: 'Car Year' },
      { value: 'closer_id',  label: 'Closer' },
      { value: 'fronter_id', label: 'Fronter' },
      { value: 'company_id', label: 'Company' },
    ],
  },
  transfers: {
    label: 'Transfers', icon: Send,
    statusField: { name: 'status', label: 'Status', field_type: 'sale_status', options: TRANSFER_STATUSES, _enum: true },
    columns: [
      { key: '_customer', label: 'Customer', render: r => r.form_data?.customer_name || r.form_data?.FirstName || '—' },
      { key: 'normalized_phone', label: 'Phone' },
      { key: 'status', label: 'Status' },
      { key: 'latest_disposition', label: 'Disposition' },
      { key: 'company_name', label: 'Company' },
      { key: 'created_by_name', label: 'Fronter' },
      { key: 'assigned_closer_name', label: 'Closer' },
      { key: 'rejection_count', label: 'Rejects' },
      { key: 'sale_reference_no', label: 'Sale Ref' },
      { key: 'created_at', label: 'Created', render: r => r.created_at ? new Date(r.created_at).toLocaleDateString() : '—' },
    ],
    groupOptions: [
      { value: 'status',             label: 'Status' },
      { value: 'latest_disposition', label: 'Disposition' },
      { value: 'company_id',         label: 'Company' },
      { value: 'created_by',         label: 'Fronter' },
      { value: 'assigned_closer_id', label: 'Closer' },
    ],
  },
};

const PRESETS_KEY = 'bsx_data_analyzer_presets_v1';
const readPresets  = () => { try { return JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]'); } catch { return []; } };
const writePresets = (p) => { try { localStorage.setItem(PRESETS_KEY, JSON.stringify(p)); } catch { /* quota */ } };

const Section = ({ title, open, onToggle, children, count }) => (
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

// Compute the child-field options for parent → child pairs. Returns a string
// array when the field is a known child AND should be scoped, or null when it
// isn't a recognized pair — caller falls back to the field's own options[].
//
// Today this covers two pairs: sale_client → sale_plan and car_make → car_model.
// Adding a new pair = one extra branch here; the FieldControl plumbing already
// passes everything needed (parent fields, current filters, vehicle tree).
const scopedChildOptions = ({ field, fields, filters, vehicleTree }) => {
  const kind = kindFor(field);

  if (kind === 'sale_plan') {
    const clientField = fields.find(f => f.field_type === 'sale_client');
    const selectedClients = (clientField && Array.isArray(filters[clientField.name]))
      ? filters[clientField.name]
      : [];
    const mapping = Array.isArray(field.options) ? field.options : [];
    const isObjMap = mapping.every(o => o && typeof o === 'object' && Array.isArray(o.plans));
    // Without a parent selection, surface every plan across every client so
    // the user isn't forced into picking a client first. Same fallback when
    // the field's options aren't in the {client, plans} object shape.
    if (!isObjMap) return Array.isArray(field.options) ? field.options : [];
    if (selectedClients.length === 0) {
      const all = new Set();
      mapping.forEach(o => (o.plans || []).forEach(p => all.add(p)));
      return [...all];
    }
    // Union of plans across the selected parents — picking multiple clients
    // shouldn't AND-clip plans down to nothing.
    const out = new Set();
    selectedClients.forEach(c => {
      const m = mapping.find(x => String(x.client).toLowerCase() === String(c).toLowerCase());
      if (m) (m.plans || []).forEach(p => out.add(p));
    });
    return [...out];
  }

  if (kind === 'car_model') {
    const makeField = fields.find(f => kindFor(f) === 'make');
    const selectedMakes = (makeField && Array.isArray(filters[makeField.name]))
      ? filters[makeField.name]
      : [];
    if (selectedMakes.length === 0) {
      const all = new Set();
      (vehicleTree || []).forEach(mk => (mk.models || []).forEach(m => all.add(m.name)));
      return [...all];
    }
    const out = new Set();
    selectedMakes.forEach(name => {
      const mk = (vehicleTree || []).find(x => x.name.toLowerCase() === String(name).toLowerCase());
      if (mk) (mk.models || []).forEach(m => out.add(m.name));
    });
    return [...out];
  }

  return null;
};

// Apply a filter change and, when the change is on a parent, drop any child
// values that no longer fit the new parent set. Keeps the UI from showing
// "active" chips on a child that the new parent scope can't actually reach,
// which would otherwise emit a payload no row could match.
const onParentOrChildChange = (state, field, nextVal, allFields, vehicleTree) => {
  const next = { ...state, [field.name]: nextVal };
  if (field.field_type === 'sale_client') {
    const planField = allFields.find(f => f.field_type === 'sale_plan');
    if (planField && Array.isArray(next[planField.name]) && next[planField.name].length) {
      const allowed = new Set(
        scopedChildOptions({ field: planField, fields: allFields, filters: next, vehicleTree }) || []
      );
      next[planField.name] = next[planField.name].filter(p => allowed.has(p));
    }
  }
  if (kindFor(field) === 'make') {
    const modelField = allFields.find(f => kindFor(f) === 'car_model');
    if (modelField && Array.isArray(next[modelField.name]) && next[modelField.name].length) {
      const allowed = new Set(
        scopedChildOptions({ field: modelField, fields: allFields, filters: next, vehicleTree }) || []
      );
      next[modelField.name] = next[modelField.name].filter(m => allowed.has(m));
    }
  }
  return next;
};

const FieldControl = ({ field, value, onChange, vehicleMakes = [], vehicleTree = [], fields = [], filters = {} }) => {
  const kind = kindFor(field);
  const set = (v) => onChange(v);

  if (kind === 'state') {
    // Storage: full names (so the IN filter matches form_data values).
    // Display: initials in the chip grid (compact). Translate both ways.
    //
    // "Unspecified" pseudo-chip surfaces rows whose state value is NULL or
    // not in the canonical 51-state list (placeholder dashes, numeric junk,
    // typos that escaped migration 067). Sent as the literal sentinel
    // '__UNSPECIFIED__' which the backend's `in` op detects and converts to
    // an OR group (is.null OR not.in.(canonical 51)).
    const UNSPEC = '__UNSPECIFIED__';
    const fullValues   = value || [];
    const hasUnspec    = fullValues.includes(UNSPEC);
    const stateValues  = fullValues.filter(v => v !== UNSPEC);
    const valueAsInitials = stateValues.map(full => STATE_FULL_TO_INITIAL[String(full).toLowerCase()] || full);
    return (
      <div className="space-y-2">
        <StateGrid
          value={valueAsInitials}
          onChange={(initials) => {
            const fulls = initials.map(i => STATE_INITIAL_TO_FULL[i] || i);
            set(hasUnspec ? [...fulls, UNSPEC] : fulls);
          }}
          states={US_STATES}
        />
        <button type="button"
          onClick={() => set(hasUnspec ? stateValues : [...stateValues, UNSPEC])}
          className="text-[11px] font-bold py-1.5 px-3 rounded-md transition-all w-full"
          style={{
            backgroundColor: hasUnspec ? 'var(--color-warning-600, #d97706)' : 'var(--color-bg-secondary)',
            color:           hasUnspec ? 'white' : 'var(--color-text-secondary)',
            border: `1px solid ${hasUnspec ? 'var(--color-warning-600, #d97706)' : 'var(--color-border)'}`,
          }}>
          Unspecified / Other (NULL or non-state value)
        </button>
      </div>
    );
  }
  if (kind === 'make') {
    // Use the superadmin's /vehicles registry instead of a hardcoded list, so
    // the chip grid stays in sync with whatever the configured makes are. Falls
    // back to an empty array (grid renders nothing) if the registry hasn't been
    // seeded yet — the explanatory helper text in the field card kicks in.
    return <ChipGrid value={value || []} onChange={set} options={vehicleMakes} cols={5} />;
  }
  if (kind === 'car_model') {
    // Child of `make`: options narrow to models belonging to currently-selected
    // makes. With no make picked the grid shows every model across the
    // registry so a "any-make Camry" query stays possible.
    //
    // CollapsibleChipGrid keeps the rail short when the registry runs into
    // hundreds of models — header collapses by default past 24 entries, with
    // an internal search box for fast narrowing. Same chip click-to-toggle
    // mechanics as the regular grid, no behavior change beyond visibility.
    const scoped = scopedChildOptions({ field, fields, filters, vehicleTree }) || [];
    return <CollapsibleChipGrid value={value || []} onChange={set} options={scoped} cols={5} />;
  }
  if (kind === 'sale_client') {
    // Parent of `sale_plan`. Client names live on the sale_plan field's
    // { client, plans } mapping (the sale_client field itself often has no
    // string options), so derive them from there; fall back to its own options.
    const planField = fields.find(f => f.field_type === 'sale_plan');
    const mapping = Array.isArray(planField?.options) ? planField.options : [];
    const clients = [...new Set(mapping.filter(o => o && typeof o === 'object' && o.client).map(o => String(o.client)))];
    const opts = clients.length ? clients : (Array.isArray(field.options) ? field.options.filter(o => typeof o === 'string') : []);
    return <ChipGrid value={value || []} onChange={set} options={opts} cols={4} />;
  }
  if (kind === 'sale_plan') {
    // Child of `sale_client`: options narrow to plans for the selected clients,
    // mirroring the cascading dropdown in SaleForm. Multi-select chip layout.
    const scoped = scopedChildOptions({ field, fields, filters, vehicleTree }) || [];
    return <ChipGrid value={value || []} onChange={set} options={scoped} cols={4} />;
  }
  if (kind === 'agent') {
    // Person picker (closer / fronter). Options are { value: user_id, label }.
    // Stored as a single-element array so it rides the same `in` payload path.
    const opts = Array.isArray(field.options) ? field.options : [];
    const cur = Array.isArray(value) && value.length ? value[0] : '';
    return (
      <select value={cur} onChange={e => set(e.target.value ? [e.target.value] : [])}
        className="input text-sm">
        <option value="">Any {String(field.label || 'agent').toLowerCase()}…</option>
        {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  if (kind === 'multi' || kind === 'multi_enum') {
    // Generic option-bearing field. If it happens to be the child side of a
    // parent → child pair, prefer the scoped option list over the raw config.
    const scoped = scopedChildOptions({ field, fields, filters, vehicleTree });
    const options = scoped != null
      ? scoped
      : (field._enum
          ? field.options
          : (Array.isArray(field.options) ? field.options : []));
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
    const [lo = '', hi = ''] = Array.isArray(value) ? value : [];
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

const buildPayload = (fields, filters) => fields
  .map(f => {
    const v = filters[f.name];
    const kind = kindFor(f);
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) return null;
    if (
      kind === 'state' || kind === 'make' || kind === 'car_model' ||
      kind === 'sale_client' || kind === 'sale_plan' || kind === 'multi' || kind === 'multi_enum' ||
      kind === 'agent'
    ) {
      return Array.isArray(v) && v.length ? { field: f.name, op: 'in', value: v } : null;
    }
    if (kind === 'bool') return { field: f.name, op: 'eq', value: v };
    if (kind === 'range_num' || kind === 'range_date') {
      const [lo, hi] = Array.isArray(v) ? v : [];
      if ((lo === '' || lo == null) && (hi === '' || hi == null)) return null;
      return { field: f.name, op: 'between', value: [lo, hi] };
    }
    return { field: f.name, op: 'ilike', value: v };
  })
  .filter(Boolean);

const StatPill = ({ label, value, tone = 'primary' }) => {
  const tones = {
    primary: ['var(--color-primary-50)',  'var(--color-primary-700)'],
    success: ['var(--color-success-50)',  'var(--color-success-700)'],
    warning: ['var(--color-warning-50)',  'var(--color-warning-700)'],
    info:    ['var(--color-bg-secondary)','var(--color-text-secondary)'],
  };
  const [bg, fg] = tones[tone] || tones.primary;
  return (
    <div className="rounded-lg px-3 py-2" style={{ backgroundColor: bg, border: '1px solid var(--color-border)' }}>
      <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: fg, opacity: 0.7 }}>{label}</p>
      <p className="text-base font-black" style={{ color: fg, letterSpacing: '-0.02em' }}>{value}</p>
    </div>
  );
};

// Guard everything — when the user toggles datasets the agg from the previous
// request is briefly the wrong shape (sales has no `completed`/`rejected`,
// transfers has no `won`/`down_total`), so accessing those fields blindly used
// to crash with `Cannot read properties of undefined (reading 'toLocaleString')`.
// Defaulting to 0 keeps the banner safe during the transition.
const num$  = v => `$${(Number(v) || 0).toLocaleString()}`;
const numFmt = v => (Number(v) || 0).toLocaleString();

const StatsBanner = ({ dataset, agg }) => {
  if (!agg) return null;
  if (dataset === 'sales') {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2">
        <StatPill label="Matches"       value={numFmt(agg.count)} />
        <StatPill label="Won"           value={numFmt(agg.won)}            tone="success" />
        <StatPill label="Win Rate"      value={`${agg.win_rate || 0}%`}    tone="success" />
        <StatPill label="Down Total"    value={num$(agg.down_total)}       tone="primary" />
        <StatPill label="Monthly Total" value={num$(agg.monthly_total)}    tone="primary" />
        <StatPill label="Avg Down"      value={num$(agg.avg_down)}         tone="info" />
        <StatPill label="Closers"       value={numFmt(agg.distinct_closers)} tone="info" />
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
      <StatPill label="Matches"      value={numFmt(agg.count)} />
      <StatPill label="Completed"    value={numFmt(agg.completed)}            tone="success" />
      <StatPill label="Completion %" value={`${agg.completion_rate || 0}%`}   tone="success" />
      <StatPill label="Rejected"     value={numFmt(agg.rejected)}             tone="warning" />
      <StatPill label="Fronters"     value={numFmt(agg.distinct_fronters)}    tone="info" />
      <StatPill label="Closers"      value={numFmt(agg.distinct_closers)}     tone="info" />
    </div>
  );
};

const Breakdown = ({ items, total }) => {
  if (!items?.length) return <p className="text-sm italic" style={{ color: 'var(--color-text-tertiary)' }}>No data to break down.</p>;
  const max = items[0]?.count || 1;
  return (
    <div className="space-y-1.5 max-h-72 overflow-y-auto">
      {items.map(it => {
        const pct = Math.round((it.count / max) * 100);
        const share = total ? Math.round((it.count / total) * 100) : 0;
        return (
          <div key={it.key} className="text-xs">
            <div className="flex items-center justify-between mb-0.5">
              <span className="font-semibold truncate" style={{ color: 'var(--color-text)' }}>{it.label}</span>
              <span style={{ color: 'var(--color-text-tertiary)' }}>
                <strong style={{ color: 'var(--color-text-secondary)' }}>{it.count.toLocaleString()}</strong> · {share}%
              </span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--gradient-sidebar)' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

const DataAnalyzer = () => {
  const [dataset, setDataset] = useState('sales');
  const [fields, setFields]   = useState([]);
  const [filters, setFilters] = useState({});
  const [open, setOpen]       = useState({ filters: true, breakdown: true, presets: false });
  const [rows, setRows]       = useState([]);
  const [total, setTotal]     = useState(0);
  const [agg, setAgg]         = useState(null);
  const [page, setPage]       = useState(1);
  const [limit]               = useState(50);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [err, setErr]         = useState('');

  // Disposition names from the Dispositions tab (disposition_configs) — drive the
  // disposition filter dynamically so new dispositions show up without code.
  const [dispositions, setDispositions] = useState([]);
  const [agents, setAgents] = useState([]);   // active users, for the agent (closer/fronter) filter

  // Global scope filters (apply on top of the per-field filters, and to export).
  const [companies, setCompanies]   = useState([]);
  const [companyIds, setCompanyIds] = useState([]);
  const [dateField, setDateField]   = useState('sale_date');
  const [dateFrom, setDateFrom]     = useState('');
  const [dateTo, setDateTo]         = useState('');

  const cfg = DATASETS[dataset];

  // Group-by + breakdown
  const [groupBy, setGroupBy] = useState(cfg.groupOptions[0].value);
  const [breakdown, setBreakdown] = useState(null);

  // Filter presets
  const [presets, setPresets] = useState(readPresets);

  // Drag-and-drop filter order (persisted).
  const [fieldOrder, setFieldOrder] = useState(readOrder);
  const dragName = useRef(null);

  // Per-field expand/collapse. Default: collapsed, but an active filter shows
  // expanded so you can see what's set. An explicit toggle overrides that.
  const [openMap, setOpenMap] = useState({});
  const isFieldOpen = (name, active) => (openMap[name] !== undefined ? openMap[name] : active);
  const toggleField = (name, active) => setOpenMap(m => ({ ...m, [name]: !(m[name] !== undefined ? m[name] : active) }));

  // Vehicle registry powers the Car Make chip grid AND the Car Model child
  // filter — keeping the full tree (not just make names) lets the Model
  // filter scope its options to the currently-selected makes.
  const [vehicleTree, setVehicleTree] = useState([]);
  const vehicleMakes = useMemo(() => vehicleTree.map(m => m.name), [vehicleTree]);
  useEffect(() => {
    client.get('forms/fields').then(r => setFields(r.data.fields || [])).catch(() => {});
    client.get('vehicles').then(r => setVehicleTree(r.data.makes || [])).catch(() => {});
    client.get('companies').then(r => setCompanies(r.data.companies || [])).catch(() => {});
    client.get('users/lookup').then(r => setAgents(r.data.users || [])).catch(() => {});
    client.get('disposition-configs/all').then(r => {
      const names = [...new Set((r.data.configs || []).filter(c => c.is_active !== false && c.name).map(c => c.name))];
      setDispositions(names);
    }).catch(() => {});
  }, []);

  // Reset group-by + aggregates when dataset changes (filters stay — they're
  // shared by name). Clearing `agg` immediately prevents the StatsBanner from
  // reading sales-shaped fields on the transfers branch (or vice versa) during
  // the brief window before the new /query response lands.
  useEffect(() => {
    setGroupBy(DATASETS[dataset].groupOptions[0].value);
    setBreakdown(null);
    setAgg(null);
    setRows([]);
    setTotal(0);
    setDateField((DATE_FIELDS[dataset] || DATE_FIELDS.sales)[0].v);
  }, [dataset]);

  // Disposition filter — dynamic options from disposition_configs. Filters the
  // dataset's real disposition column (sales: closer_disposition; transfers:
  // latest_disposition, kept in sync by a trigger), so it scales to any volume.
  const dispositionField = useMemo(() => {
    // Offer both the Dispositions-tab names AND the sale form's disposition
    // field options, so the filter matches whatever the column actually stores
    // (transfers use disposition_configs names; sales use the sale_disposition
    // field's values — these may differ).
    const saleDispoField = fields.find(f => f.field_type === 'sale_disposition' || f.field_type === 'sale_status');
    const saleDispoOpts = Array.isArray(saleDispoField?.options) ? saleDispoField.options.filter(o => typeof o === 'string') : [];
    const opts = [...new Set([...(dispositions || []), ...saleDispoOpts])];
    return {
      name: dataset === 'sales' ? 'closer_disposition' : 'latest_disposition',
      label: 'Disposition',
      field_type: 'select',
      options: opts,
      _enum: true,
    };
  }, [dataset, dispositions, fields]);

  // Agent filters — pick the closer and/or fronter whose data to see. Options
  // are active users (scoped to the selected companies when any are chosen),
  // filtering the dataset's real person columns. closer_id/fronter_id on sales;
  // assigned_closer_id/created_by on transfers — all typed columns the backend
  // already accepts.
  const agentOpts = useMemo(() => {
    const list = companyIds.length ? agents.filter(a => companyIds.includes(a.company_id)) : agents;
    const seen = new Set(), out = [];
    list.forEach(a => {
      if (seen.has(a.user_id)) return;
      seen.add(a.user_id);
      out.push({ value: a.user_id, label: `${a.name}${a.role ? ' · ' + String(a.role).replace(/_/g, ' ') : ''}` });
    });
    return out.sort((x, y) => x.label.localeCompare(y.label));
  }, [agents, companyIds]);

  const agentFields = useMemo(() => {
    const closerCol  = dataset === 'sales' ? 'closer_id'  : 'assigned_closer_id';
    const fronterCol = dataset === 'sales' ? 'fronter_id' : 'created_by';
    return [
      { name: closerCol,  label: 'Closer',  field_type: 'agent', options: agentOpts },
      { name: fronterCol, label: 'Fronter', field_type: 'agent', options: agentOpts },
    ];
  }, [dataset, agentOpts]);

  // Status + Disposition + Agents are always present (dataset-specific); before form_fields.
  const allFilterFields = useMemo(
    () => [cfg.statusField, dispositionField, ...agentFields, ...fields],
    [cfg, dispositionField, agentFields, fields],
  );

  // Apply the saved drag-and-drop order; new/unordered fields fall to the end.
  const orderedFields = useMemo(() => {
    const byName = new Map(allFilterFields.map(f => [f.name, f]));
    const out = [];
    fieldOrder.forEach(n => { if (byName.has(n)) { out.push(byName.get(n)); byName.delete(n); } });
    allFilterFields.forEach(f => { if (byName.has(f.name)) out.push(f); });
    return out;
  }, [allFilterFields, fieldOrder]);

  const onFilterDrop = (targetName) => {
    const from = dragName.current; dragName.current = null;
    if (!from || from === targetName) return;
    const names = orderedFields.map(f => f.name);
    const fromIdx = names.indexOf(from), toIdx = names.indexOf(targetName);
    if (fromIdx < 0 || toIdx < 0) return;
    names.splice(toIdx, 0, names.splice(fromIdx, 1)[0]);
    setFieldOrder(names); writeOrder(names);
  };

  const expandAllFields   = () => setOpenMap(Object.fromEntries(orderedFields.map(f => [f.name, true])));
  const collapseAllFields = () => setOpenMap(Object.fromEntries(orderedFields.map(f => [f.name, false])));

  const payload = useMemo(() => {
    const base = buildPayload(allFilterFields, filters);
    if (companyIds.length) base.push({ field: 'company_id', op: 'in', value: companyIds });
    if (dateFrom || dateTo) {
      // End bound → end-of-day so a timestamp column includes the whole `to` day.
      base.push({ field: dateField, op: 'between', value: [dateFrom || '', dateTo ? `${dateTo}T23:59:59.999` : ''] });
    }
    return base;
  }, [allFilterFields, filters, companyIds, dateField, dateFrom, dateTo]);
  const activeCount = payload.length;

  const applyQuickRange = (key) => {
    const today = new Date();
    const start = new Date(today);
    if (key === 'today')      { setDateFrom(ymd(today)); setDateTo(ymd(today)); }
    else if (key === 'yest')  { start.setDate(today.getDate() - 1); setDateFrom(ymd(start)); setDateTo(ymd(start)); }
    else if (key === '7d')    { start.setDate(today.getDate() - 6); setDateFrom(ymd(start)); setDateTo(ymd(today)); }
    else if (key === '30d')   { start.setDate(today.getDate() - 29); setDateFrom(ymd(start)); setDateTo(ymd(today)); }
    else if (key === 'month') { setDateFrom(ymd(new Date(today.getFullYear(), today.getMonth(), 1))); setDateTo(ymd(today)); }
    else if (key === 'year')  { setDateFrom(ymd(new Date(today.getFullYear(), 0, 1))); setDateTo(ymd(today)); }
    else                      { setDateFrom(''); setDateTo(''); }
  };

  const run = useCallback(async (p = 1) => {
    setLoading(true); setErr('');
    try {
      const r = await client.post('data-analyzer/query', { dataset, filters: payload, page: p, limit });
      setRows(r.data.rows || []);
      setTotal(r.data.total || 0);
      setAgg(r.data.aggregates || null);
      setPage(p);
    } catch (e) { setErr(e.response?.data?.error || 'Query failed'); }
    finally { setLoading(false); }
  }, [dataset, payload, limit]);

  // Auto-run once when fields first load AND when dataset changes.
  useEffect(() => { if (fields.length) run(1); /* eslint-disable-next-line */ }, [fields.length, dataset]);

  const reset = () => { setFilters({}); setCompanyIds([]); setDateFrom(''); setDateTo(''); setPage(1); setBreakdown(null); };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const r = await client.post('data-analyzer/export', { dataset, filters: payload }, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = Object.assign(document.createElement('a'), { href: url, download: `data-analyzer_${dataset}_${new Date().toISOString().slice(0,10)}.csv` });
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { setErr(e.response?.data?.error || 'Export failed'); }
    finally { setExporting(false); }
  };

  const runBreakdown = async () => {
    try {
      const r = await client.post('data-analyzer/breakdown', { dataset, filters: payload, group_by: groupBy, top: 20 });
      setBreakdown(r.data);
    } catch (e) { setErr(e.response?.data?.error || 'Breakdown failed'); }
  };

  const savePreset = () => {
    const name = window.prompt('Name this preset (e.g. "Texas closed-won 2026"):');
    if (!name?.trim()) return;
    const next = [...presets.filter(p => p.name !== name.trim()), { name: name.trim(), dataset, filters }];
    setPresets(next); writePresets(next);
  };
  const loadPreset = (p) => { setDataset(p.dataset || 'sales'); setFilters(p.filters || {}); };
  const deletePreset = (name) => { const next = presets.filter(p => p.name !== name); setPresets(next); writePresets(next); };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header — stacks on mobile so the title + button row don't fight for room. */}
      <div className="rounded-2xl p-4 sm:p-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3" style={{ background: 'var(--gradient-sidebar)' }}>
        <div className="flex items-center gap-2.5 min-w-0">
          <Database size={22} className="text-white flex-shrink-0" />
          <div className="min-w-0">
            <h2 className="text-xl sm:text-2xl font-bold text-white truncate" style={{ fontFamily: 'var(--font-display)' }}>Data Analyzer</h2>
            <p className="text-xs sm:text-sm text-white/80">Filter, aggregate, group and export across every form field.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Dataset toggle */}
          <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.3)' }}>
            {Object.entries(DATASETS).map(([key, d]) => {
              const Icon = d.icon;
              const on = dataset === key;
              return (
                <button key={key} onClick={() => setDataset(key)}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold transition-colors"
                  style={{ backgroundColor: on ? 'white' : 'transparent', color: on ? 'var(--color-primary-700)' : 'white' }}>
                  <Icon size={13} /> {d.label}
                </button>
              );
            })}
          </div>
          <button onClick={reset} className="px-3 py-2 rounded-lg text-xs font-bold bg-white/20 hover:bg-white/30 text-white">
            Clear ({activeCount})
          </button>
          <button onClick={savePreset} title="Save current filters as a preset"
            className="px-3 py-2 rounded-lg text-xs font-bold bg-white/20 hover:bg-white/30 text-white flex items-center gap-1">
            <BookmarkPlus size={13} /> Preset
          </button>
          <button onClick={exportCsv} disabled={exporting || loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-white/90 hover:bg-white text-primary-700 disabled:opacity-50">
            {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} CSV
          </button>
          <button onClick={() => run(1)} disabled={loading}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-white text-primary-700 disabled:opacity-50">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Run query
          </button>
        </div>
      </div>

      {err && <p className="text-sm rounded-xl p-3" style={{ backgroundColor: 'var(--color-error-50)', color: 'var(--color-error-700)' }}>{err}</p>}

      {/* Aggregate stats banner */}
      <StatsBanner dataset={dataset} agg={agg} />

      {/* Global scope: company multi-select + date range. Applies to query AND export. */}
      <div className="rounded-2xl p-4 space-y-3" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <Label><span className="flex items-center gap-1.5"><Building2 size={13} /> Companies {companyIds.length > 0 && <span className="opacity-60">({companyIds.length} selected)</span>}</span></Label>
            {companyIds.length > 0 && (
              <button type="button" onClick={() => setCompanyIds([])} className="text-[10px] font-bold flex items-center gap-0.5" style={{ color: 'var(--color-text-tertiary)' }}><X size={11} /> all companies</button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {companies.length === 0
              ? <p className="text-xs italic" style={{ color: 'var(--color-text-tertiary)' }}>No companies.</p>
              : companies.map(c => {
                const on = companyIds.includes(c.id);
                return (
                  <button key={c.id} type="button"
                    onClick={() => setCompanyIds(on ? companyIds.filter(x => x !== c.id) : [...companyIds, c.id])}
                    className="text-xs font-semibold px-2.5 py-1 rounded-md transition-colors"
                    style={{
                      backgroundColor: on ? 'var(--color-primary-600)' : 'var(--color-bg-secondary)',
                      color:           on ? 'white' : 'var(--color-text-secondary)',
                      border: `1px solid ${on ? 'var(--color-primary-600)' : 'var(--color-border)'}`,
                    }}>
                    {c.name}{c.company_type ? <span className="opacity-60"> · {c.company_type}</span> : null}
                  </button>
                );
              })}
          </div>
          <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>None selected = all companies. Pick one or more to scope the data + export.</p>
        </div>

        <div className="h-px" style={{ backgroundColor: 'var(--color-border)' }} />

        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label><span className="flex items-center gap-1.5"><CalendarRange size={13} /> Date filter</span></Label>
            <div className="text-sm font-bold px-3 py-1.5 rounded-md" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text)', minWidth: 130 }}>
              {(DATE_FIELDS[dataset] || DATE_FIELDS.sales)[0].l}
            </div>
          </div>
          <div>
            <Label>From</Label>
            <input type="date" value={dateFrom} max={dateTo || undefined} onChange={e => setDateFrom(e.target.value)} className="input text-sm py-1.5" />
          </div>
          <div>
            <Label>To</Label>
            <input type="date" value={dateTo} min={dateFrom || undefined} onChange={e => setDateTo(e.target.value)} className="input text-sm py-1.5" />
          </div>
          <div className="flex flex-wrap gap-1">
            {[['today', 'Today'], ['yest', 'Yesterday'], ['7d', '7d'], ['30d', '30d'], ['month', 'This month'], ['year', 'This year'], ['all', 'All']].map(([k, l]) => (
              <button key={k} type="button" onClick={() => applyQuickRange(k)}
                className="text-[11px] font-bold px-2 py-1.5 rounded-md transition-colors"
                style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                {l}
              </button>
            ))}
          </div>
          {(dateFrom || dateTo) && (
            <span className="text-[11px] font-semibold px-2 py-1 rounded-md self-center" style={{ backgroundColor: 'var(--color-primary-50)', color: 'var(--color-primary-700)' }}>
              {dateFrom || '…'} → {dateTo || '…'}
            </span>
          )}
        </div>
        <p className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>Pick a start and end date (or a quick range). Click <strong>Run query</strong> to apply with the other filters.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-5">
        {/* Filters + Presets */}
        <div className="space-y-3">
          <Section title={<span className="flex items-center gap-1.5"><BookmarkPlus size={14} /> Saved Presets</span>}
            open={open.presets} onToggle={() => setOpen(o => ({ ...o, presets: !o.presets }))} count={presets.length}>
            {presets.length === 0
              ? <p className="text-xs italic" style={{ color: 'var(--color-text-tertiary)' }}>Save the current filter set with the “Preset” button above.</p>
              : presets.map(p => (
                <div key={p.name} className="flex items-center gap-2 text-xs">
                  <button onClick={() => loadPreset(p)} className="flex-1 text-left px-2 py-1.5 rounded-md font-semibold truncate"
                    style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text)' }}>
                    {p.name} <span className="opacity-60">({p.dataset || 'sales'})</span>
                  </button>
                  <button onClick={() => deletePreset(p.name)} className="p-1 rounded-md hover:bg-error-50">
                    <Trash2 size={12} style={{ color: 'var(--color-error-500)' }} />
                  </button>
                </div>
              ))}
          </Section>

          <Section title={<span className="flex items-center gap-1.5"><Filter size={14} /> Filters</span>}
            open={open.filters} onToggle={() => setOpen(o => ({ ...o, filters: !o.filters }))} count={activeCount}>
            <div className="flex items-center justify-between -mt-1 mb-1">
              <p className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>Drag the ⠿ handle to reorder · click a row to expand/collapse.</p>
              <div className="flex gap-1.5">
                <button type="button" onClick={expandAllFields} className="text-[10px] font-bold" style={{ color: 'var(--color-primary-600)' }}>Expand all</button>
                <span style={{ color: 'var(--color-border)' }}>·</span>
                <button type="button" onClick={collapseAllFields} className="text-[10px] font-bold" style={{ color: 'var(--color-primary-600)' }}>Collapse all</button>
              </div>
            </div>
            {orderedFields.map(f => {
              const v = filters[f.name];
              const active = v != null && v !== '' && !(Array.isArray(v) && v.length === 0);
              const fopen = isFieldOpen(f.name, active);
              const selCount = Array.isArray(v) ? v.length : (active ? 1 : 0);
              return (
                <div key={f.id || f.name} className="rounded-lg p-2.5"
                  onDragOver={e => e.preventDefault()} onDrop={() => onFilterDrop(f.name)}
                  style={{ border: `1px solid ${active ? 'var(--color-primary-300)' : 'var(--color-border)'}`, backgroundColor: active ? 'var(--color-primary-50)' : 'transparent' }}>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1 min-w-0 flex-1">
                      <span draggable onDragStart={() => { dragName.current = f.name; }} onDragEnd={() => { dragName.current = null; }}
                        title="Drag to reorder" className="cursor-grab active:cursor-grabbing flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>
                        <GripVertical size={13} />
                      </span>
                      <button type="button" onClick={() => toggleField(f.name, active)} className="flex items-center gap-1 min-w-0 flex-1 text-left">
                        {fopen ? <ChevronUp size={13} className="flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }} /> : <ChevronDown size={13} className="flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />}
                        <span className="text-[11px] font-bold uppercase tracking-wide truncate" style={{ color: 'var(--color-text-secondary)' }}>
                          {f.label || f.name}
                          <span className="ml-1 font-medium normal-case opacity-60">({f.field_type})</span>
                        </span>
                        {!fopen && selCount > 0 && (
                          <span className="ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0" style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>{selCount}</span>
                        )}
                      </button>
                    </span>
                    {active && (
                      <button type="button" onClick={() => setFilters(s => { const n = { ...s }; delete n[f.name]; return n; })}
                        className="text-[10px] font-bold flex items-center gap-0.5 flex-shrink-0 ml-1" style={{ color: 'var(--color-text-tertiary)' }}>
                        <X size={11} /> clear
                      </button>
                    )}
                  </div>
                  {fopen && (
                    <div className="mt-1.5">
                      <FieldControl
                        field={f}
                        value={v}
                        vehicleMakes={vehicleMakes}
                        vehicleTree={vehicleTree}
                        fields={allFilterFields}
                        filters={filters}
                        onChange={(nv) => setFilters(s => onParentOrChildChange(s, f, nv, allFilterFields, vehicleTree))}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </Section>
        </div>

        {/* Results + Breakdown */}
        <div className="space-y-3">
          <Section title={<span className="flex items-center gap-1.5"><BarChart3 size={14} /> Breakdown</span>}
            open={open.breakdown} onToggle={() => setOpen(o => ({ ...o, breakdown: !o.breakdown }))}>
            <div className="flex items-center gap-2 mb-2">
              <Label>Group by</Label>
              <select value={groupBy} onChange={e => setGroupBy(e.target.value)} className="input text-xs h-auto py-1">
                {cfg.groupOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <button onClick={runBreakdown}
                className="text-xs font-bold px-3 py-1 rounded-md text-white"
                style={{ background: 'var(--gradient-sidebar)' }}>
                Run
              </button>
            </div>
            <Breakdown items={breakdown?.items} total={breakdown?.total} />
          </Section>

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
                  {cfg.columns.map(c => (
                    <th key={c.key} className="px-3 py-2 text-left font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading
                  ? <tr><td colSpan={cfg.columns.length} className="text-center py-6 text-sm" style={{ color: 'var(--color-text-tertiary)' }}><Loader2 size={16} className="animate-spin inline mr-1" /> Loading…</td></tr>
                  : rows.length === 0
                    ? <tr><td colSpan={cfg.columns.length} className="text-center py-10 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No matches.</td></tr>
                    : rows.map(r => (
                      <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        {cfg.columns.map(c => (
                          <td key={c.key} className="px-3 py-2" style={{ color: 'var(--color-text-secondary)' }}>
                            {c.render ? c.render(r) : (r[c.key] ?? '—')}
                          </td>
                        ))}
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
export { US_STATES };
