import { useState, useEffect } from 'react';
import { BarChart3, AlertTriangle, Info, LayoutDashboard, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { KPI_METRICS, KPI_CARDS, resolveCardConfig } from '../../../config/kpiCatalog';
import { clearShellLayoutCache } from '../../../hooks/useShellLayout';

const cfg = (config, key, fallback) => (config?.[key] !== undefined ? config[key] : fallback);

// Roles that use each shell — drives the per-role KPI override picker.
const SHELL_ROLES = {
  staff:   [{ key: 'closer', label: 'Closer' }, { key: 'fronter', label: 'Fronter' }],
  manager: [
    { key: 'company_admin',      label: 'Company Admin' },
    { key: 'operations_manager', label: 'Operations Mgr' },
    { key: 'closer_manager',     label: 'Closer Mgr' },
    { key: 'fronter_manager',    label: 'Fronter Mgr' },
  ],
};

const Section = ({ title, desc, accent = 'primary', children }) => (
  <section className="rounded-2xl mb-4 overflow-hidden"
    style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)',
             borderTop: `3px solid var(--color-${accent}-500, #6366f1)` }}>
    <div className="p-5">
      <h2 className="text-base font-bold text-text mb-1">{title}</h2>
      {desc && <p className="text-xs text-text-secondary mb-4 max-w-2xl leading-relaxed">{desc}</p>}
      {children}
    </div>
  </section>
);

const RadioGroup = ({ value, onChange, options, name }) => (
  <div role="radiogroup" aria-label={name} className="space-y-1.5">
    {options.map(opt => (
      <label key={opt.key}
        className="flex items-start gap-3 py-2 px-3 rounded-lg cursor-pointer hover:bg-bg-secondary transition-colors min-h-[44px]"
        style={{
          border: '1px solid',
          borderColor: value === opt.key ? 'var(--color-primary-400, #818cf8)' : 'var(--color-border)',
          backgroundColor: value === opt.key ? 'var(--color-primary-50, #eef2ff)' : 'transparent',
        }}>
        <input type="radio" name={name} checked={value === opt.key} onChange={() => onChange(opt.key)}
          className="mt-1 w-4 h-4 flex-shrink-0 cursor-pointer" style={{ accentColor: 'var(--color-primary-600)' }} />
        <div className="flex-1">
          <p className="text-sm font-semibold text-text">{opt.label}</p>
          {opt.detail && <p className="text-xs text-text-tertiary mt-0.5">{opt.detail}</p>}
        </div>
      </label>
    ))}
  </div>
);

const CheckboxRow = ({ checked, onChange, label, sub, danger }) => (
  <label className="flex items-start gap-3 py-2 px-3 rounded-lg cursor-pointer hover:bg-bg-secondary transition-colors min-h-[44px]">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
      className="mt-1 w-4 h-4 flex-shrink-0 cursor-pointer"
      style={{ accentColor: danger ? 'var(--color-error-600)' : 'var(--color-primary-600)' }}
      aria-label={label} />
    <div className="flex-1">
      <span className="text-sm font-semibold text-text">{label}</span>
      {sub && <p className="text-xs text-text-tertiary mt-0.5">{sub}</p>}
    </div>
  </label>
);

const NUM_OPTS = [
  { key: 'closed_won',                       label: 'Closed Won only',           detail: 'Strict — compliance-approved sales only' },
  { key: 'closed_won_plus_sold',             label: 'Closed Won + Sold',         detail: 'Includes legacy "sold" status for tenants migrating' },
  { key: 'all_non_cancelled',                label: 'All non-cancelled sales',   detail: 'Loose — any sale that survived compliance' },
];

const DEN_OPTS = [
  { key: 'all_transfers',                    label: 'All transfers',             detail: 'Conservative — fronter activity counts equally' },
  { key: 'transfers_minus_rejected',         label: 'Transfers minus rejected',  detail: 'Excludes leads the closer rejected' },
  { key: 'assigned_transfers_only',          label: 'Assigned transfers only',   detail: 'Strict — only counts leads a closer actually worked' },
];

const TIMEZONES = [
  { v: 'America/New_York',    l: 'Eastern Time (ET)' },
  { v: 'America/Chicago',     l: 'Central Time (CT)' },
  { v: 'America/Denver',      l: 'Mountain Time (MT)' },
  { v: 'America/Los_Angeles', l: 'Pacific Time (PT)' },
  { v: 'Asia/Karachi',        l: 'Pakistan (PKT)' },
  { v: 'Asia/Dubai',          l: 'Dubai (GST)' },
  { v: 'UTC',                 l: 'UTC' },
];

// `label` here is the SHIPPED default label each card renders with in the
// shell (the fallback useShellLayout.cardLabel returns). `group` tags which
// part of the staff shell a card belongs to so the admin can tell the closer
// and fronter cards apart.
const SHELL_STAT_CARDS = {
  staff: [
    { key: 'my_sales',                label: 'My Sales',        group: 'Closer view'  },
    { key: 'approved',                label: 'Approved',        group: 'Closer view'  },
    { key: 'cancelled',               label: 'Cancelled',       group: 'Closer view'  },
    { key: 'awaiting_review',         label: 'Awaiting Review', group: 'Closer view'  },
    { key: 'resells',                 label: 'Resells',         group: 'Closer view'  },
    { key: 'conversion',              label: 'Conversion',      group: 'Closer view'  },
    { key: 'total_leads',             label: 'Total Leads',     group: 'Fronter view' },
    { key: 'fronter_approved',        label: 'Approved',        group: 'Fronter view' },
    { key: 'fronter_awaiting_review', label: 'Awaiting Review', group: 'Fronter view' },
  ],
  manager: [
    { key: 'transfers',               label: 'Total Transfers' },
    { key: 'sales',                   label: 'Total Sales' },
    { key: 'approved',                label: 'Approved' },
    { key: 'awaiting_review',         label: 'Awaiting Review' },
    { key: 'cancelled',               label: 'Cancelled' },
    { key: 'resells',                 label: 'Resells' },
    { key: 'dup_attempts',            label: 'Dup Attempts' },
  ],
};

// Cards whose numbers aren't segment-configurable (display-only tiles like the
// single "X%" conversion card). They still support show/hide per role.
const SEGMENT_LOCKED = new Set(['conversion']);

// Read a card entry from the active scope — a per-role override block when
// roleKey is set, otherwise the shell-wide list.
const readScopedCard = (layout, roleKey, cardKey) => {
  const arr = roleKey ? (layout?.role_overrides?.[roleKey]?.stat_cards || []) : (layout?.stat_cards || []);
  return arr.find(c => c?.key === cardKey) || {};
};

// Patch a card in the active scope, preserving every other field + the other
// scope's data (so a role edit never wipes shell-wide config and vice-versa).
function patchScopedCard(layout, roleKey, cardKey, patch) {
  const base = { ...(layout || {}) };
  const upsert = (arr) => {
    const cards = Array.isArray(arr) ? [...arr] : [];
    const i = cards.findIndex(c => c?.key === cardKey);
    if (i >= 0) cards[i] = { ...cards[i], ...patch }; else cards.push({ key: cardKey, ...patch });
    return cards;
  };
  if (!roleKey) { base.stat_cards = upsert(base.stat_cards); return base; }
  const ro = { ...(base.role_overrides || {}) };
  const block = { ...(ro[roleKey] || {}) };
  block.stat_cards = upsert(block.stat_cards);
  ro[roleKey] = block;
  base.role_overrides = ro;
  return base;
}

// One number slot: pick which metric it shows + its sub-label.
const SegmentRow = ({ shell, seg, index, onMetric, onLabel, onRemove, canRemove }) => {
  const [label, setLabel] = useState(seg.label || '');
  useEffect(() => { setLabel(seg.label || ''); }, [seg.label]);
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-bold w-4 text-center flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>{index + 1}</span>
      <select value={seg.metric} onChange={(e) => onMetric(index, e.target.value)} className="input text-xs py-1.5 flex-1 min-w-0">
        {(KPI_METRICS[shell] || []).map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
      </select>
      <input type="text" value={label} placeholder="Label"
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => onLabel(index, label.trim())}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        className="input text-xs py-1.5 w-28 flex-shrink-0" title="Sub-label under the number" />
      <button type="button" onClick={() => onRemove(index)} disabled={!canRemove}
        title="Remove this number" className="p-1.5 rounded-lg flex-shrink-0 disabled:opacity-30"
        style={{ color: 'var(--color-error-600)' }}>
        <Trash2 size={13} />
      </button>
    </div>
  );
};

// Full editor for ONE card in the active scope: visibility, title, description,
// and the ordered list of numbers (which metric + label each shows).
const CardBuilder = ({ shell, card, layout, roleKey, layoutKey, onSave }) => {
  const stored  = readScopedCard(layout, roleKey, card.key);
  const eff     = resolveCardConfig(shell, card.key, layout, roleKey);
  const enabled = stored.enabled !== false;
  const locked  = SEGMENT_LOCKED.has(card.key);
  const def     = KPI_CARDS[shell]?.[card.key];

  const [label, setLabel] = useState('');
  const [desc, setDesc]   = useState('');
  useEffect(() => { setLabel(stored.label ?? ''); setDesc(stored.description ?? ''); }, [stored.label, stored.description, roleKey]);

  const save = (patch) => { onSave(layoutKey, patchScopedCard(layout, roleKey, card.key, patch)); clearShellLayoutCache(shell); };

  // Segments currently in effect for this scope (stored override if any, else
  // the shipped catalog default as the editing starting point).
  const curSegs = (Array.isArray(stored.segments) && stored.segments.length) ? stored.segments : (def?.segments || []);
  const setMetric   = (i, metric) => save({ segments: curSegs.map((s, idx) => idx === i ? { ...s, metric } : s) });
  const setSegLabel = (i, lbl)    => save({ segments: curSegs.map((s, idx) => idx === i ? { ...s, label: lbl } : s) });
  const removeSeg   = (i)         => save({ segments: curSegs.filter((_, idx) => idx !== i) });
  const addSeg      = ()          => { if (curSegs.length < 3) save({ segments: [...curSegs, { metric: KPI_METRICS[shell][0].key, label: 'New' }] }); };

  return (
    <div className="rounded-xl p-3 mb-2"
      style={{ border: '1px solid var(--color-border)', backgroundColor: enabled ? 'transparent' : 'var(--color-bg-secondary)', opacity: enabled ? 1 : 0.75 }}>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => save({ enabled: !enabled })} title={enabled ? 'Visible — click to hide' : 'Hidden — click to show'}
          className="p-1.5 rounded-lg flex-shrink-0"
          style={{ color: enabled ? 'var(--color-primary-600)' : 'var(--color-text-tertiary)', backgroundColor: enabled ? 'var(--color-primary-50, #eef2ff)' : 'transparent' }}>
          {enabled ? <Eye size={16} /> : <EyeOff size={16} />}
        </button>
        {locked ? (
          <span className="text-sm font-semibold flex-1" style={{ color: 'var(--color-text)' }}>
            {card.label} <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>· show / hide only</span>
          </span>
        ) : (
          <input type="text" value={label} placeholder={def?.label || card.key}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => { if (label.trim() !== (stored.label ?? '')) save({ label: label.trim() }); }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            className="input text-sm py-1.5 flex-1 min-w-0 font-semibold" title="Card title" />
        )}
        <code className="text-[10px] font-mono px-1 py-0.5 rounded flex-shrink-0" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}>{card.key}</code>
      </div>

      {!locked && enabled && (
        <div className="mt-2 pl-9">
          <input type="text" value={desc} placeholder="Optional caption shown under the numbers"
            onChange={(e) => setDesc(e.target.value)}
            onBlur={() => { if (desc !== (stored.description ?? '')) save({ description: desc }); }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            className="input text-xs py-1.5 w-full mb-2" />
          <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
            Numbers ({curSegs.length}/3) — choose what each represents
          </p>
          <div className="space-y-1.5">
            {curSegs.map((seg, i) => (
              <SegmentRow key={i} shell={shell} seg={seg} index={i}
                onMetric={setMetric} onLabel={setSegLabel} onRemove={removeSeg} canRemove={curSegs.length > 1} />
            ))}
          </div>
          {curSegs.length < 3 && (
            <button type="button" onClick={addSeg}
              className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border"
              style={{ borderColor: 'var(--color-primary-300, #a5b4fc)', color: 'var(--color-primary-600)' }}>
              <Plus size={12} /> Add number
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const KpiRules = ({ config, scope, onSave }) => {
  const numerator   = cfg(config, 'kpi.conversion_numerator',   'closed_won');
  const denominator = cfg(config, 'kpi.conversion_denominator', 'all_transfers');
  const counts      = cfg(config, 'kpi.resell_counts_in', { closer_total: true, conversion: false, fronter_stats: false, resells_card: true });
  const tz          = cfg(config, 'kpi.today_timezone', 'America/New_York');
  const staffLayout = cfg(config, 'shell.layout.staff',   null) || {};
  const mgrLayout   = cfg(config, 'shell.layout.manager', null) || {};

  const updateCount = (key, val) => onSave('kpi.resell_counts_in', { ...counts, [key]: val });

  // KPI builder scope: which shell + which role override is being edited.
  const [kpiShell, setKpiShell] = useState('staff');
  const [kpiRole,  setKpiRole]  = useState('');   // '' = shell default (all roles)
  const builderLayout = kpiShell === 'staff' ? staffLayout : mgrLayout;
  const builderKey    = `shell.layout.${kpiShell}`;
  const roleLabel = (SHELL_ROLES[kpiShell].find(r => r.key === kpiRole) || {}).label;

  return (
    <div className="max-w-3xl pb-8">
      {scope !== 'global' && (
        <div className="rounded-2xl p-4 mb-4 flex items-start gap-3"
          style={{ backgroundColor: 'var(--color-warning-50, #fffbeb)', border: '1px solid var(--color-warning-300, #fcd34d)' }}>
          <AlertTriangle size={18} style={{ color: 'var(--color-warning-700, #b45309)' }} className="flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-bold mb-0.5" style={{ color: 'var(--color-warning-800, #92400e)' }}>Per-company override active</p>
            <p style={{ color: 'var(--color-warning-700, #b45309)' }}>Changes here apply only to the selected company.</p>
          </div>
        </div>
      )}

      <div className="mb-6">
        <h2 className="text-xl font-bold text-text mb-1 flex items-center gap-2" style={{ fontFamily: 'var(--font-display)' }}>
          <BarChart3 size={20} className="text-primary-600" /> Stats &amp; KPIs
        </h2>
        <p className="text-sm text-text-secondary max-w-2xl leading-relaxed">
          Controls how conversion rates and dashboard counts are calculated. Affects every shell's stat cards. Changes apply on next dashboard refresh — no deploy needed.
        </p>
      </div>

      <Section accent="primary" title="Conversion rate — numerator"
        desc="Which sales count as 'won' for the conversion formula.">
        <RadioGroup name="numerator" value={numerator} onChange={(v) => onSave('kpi.conversion_numerator', v)} options={NUM_OPTS} />
      </Section>

      <Section accent="primary" title="Conversion rate — denominator"
        desc="Which transfers count as 'leads' for the conversion formula.">
        <RadioGroup name="denominator" value={denominator} onChange={(v) => onSave('kpi.conversion_denominator', v)} options={DEN_OPTS} />
      </Section>

      <Section accent="info" title="Resells count in which stats?"
        desc="Resells are real revenue but they distort first-touch conversion. Choose where they belong.">
        <div className="space-y-1">
          <CheckboxRow checked={!!counts.closer_total} onChange={(v) => updateCount('closer_total', v)}
            label="Closer's Total Sales card"
            sub="Resells contribute to the closer's headline number" />
          <CheckboxRow checked={!!counts.conversion} onChange={(v) => updateCount('conversion', v)}
            label="Conversion rate"
            sub="Including resells inflates conversion — usually OFF" />
          <CheckboxRow checked={!!counts.fronter_stats} onChange={(v) => updateCount('fronter_stats', v)}
            label="Fronter stats"
            sub="Privacy filter still wins — fronters never see resells if hide_from_fronter=true"
            danger />
          <CheckboxRow checked={!!counts.resells_card} onChange={(v) => updateCount('resells_card', v)}
            label="Show a dedicated 'Resells this month' card"
            sub="Adds a fifth/sixth card to the closer + manager dashboards" />
        </div>
      </Section>

      <Section accent="warning" title="Today timezone"
        desc="Day cutoff used by 'Today' filters and stat cards. Should match your call center's working day boundary.">
        <select value={tz} onChange={(e) => onSave('kpi.today_timezone', e.target.value)}
          className="input text-sm py-2 w-full max-w-xs">
          {TIMEZONES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
        </select>
        <p className="text-xs text-text-tertiary mt-2 flex items-start gap-1.5">
          <Info size={12} className="flex-shrink-0 mt-0.5" />
          Changing this affects when "Today" rolls over for every user, regardless of their browser timezone.
        </p>
      </Section>

      <div className="mt-8 mb-4 flex items-center gap-2">
        <LayoutDashboard size={20} className="text-primary-600" />
        <h2 className="text-xl font-bold text-text" style={{ fontFamily: 'var(--font-display)' }}>
          KPI Card Builder
        </h2>
      </div>
      <p className="text-sm text-text-secondary mb-4 max-w-2xl leading-relaxed">
        Full control over every KPI card: <Eye size={13} className="inline mx-0.5 align-text-bottom" /> show / hide it,
        rename it, give it a caption, and choose <strong>how many numbers</strong> it shows (1–3) and <strong>exactly
        what each number represents</strong>. Leave the role on <strong>All roles</strong> for the shell default, or pick a
        role to override just that role. Superadmin always sees the full set. Takes effect on the next dashboard refresh.
      </p>

      {/* Shell + role scope pickers */}
      <div className="flex gap-1 p-1 rounded-xl mb-3 w-fit"
        style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
        {[{ k: 'staff', l: 'Staff (Closer + Fronter)' }, { k: 'manager', l: 'Manager' }].map(s => {
          const active = kpiShell === s.k;
          return (
            <button key={s.k} type="button" onClick={() => { setKpiShell(s.k); setKpiRole(''); }}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap"
              style={{ background: active ? 'var(--gradient-sidebar)' : 'transparent', color: active ? 'white' : 'var(--color-text-secondary)', boxShadow: active ? 'var(--shadow-sm)' : 'none' }}>
              {s.l}
            </button>
          );
        })}
      </div>

      <div className="flex gap-1 p-1 rounded-xl mb-4 flex-wrap w-fit"
        style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
        <button type="button" onClick={() => setKpiRole('')}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap"
          style={{ background: !kpiRole ? 'var(--gradient-sidebar)' : 'transparent', color: !kpiRole ? 'white' : 'var(--color-text-secondary)', boxShadow: !kpiRole ? 'var(--shadow-sm)' : 'none' }}>
          All roles (default)
        </button>
        {SHELL_ROLES[kpiShell].map(r => {
          const active = kpiRole === r.key;
          return (
            <button key={r.key} type="button" onClick={() => setKpiRole(r.key)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap"
              style={{ background: active ? 'var(--gradient-sidebar)' : 'transparent', color: active ? 'white' : 'var(--color-text-secondary)', boxShadow: active ? 'var(--shadow-sm)' : 'none' }}>
              {r.label}
            </button>
          );
        })}
      </div>

      {kpiRole && (
        <div className="rounded-xl p-3 mb-3 flex items-start gap-2"
          style={{ backgroundColor: 'var(--color-warning-50, #fffbeb)', border: '1px solid var(--color-warning-300, #fcd34d)' }}>
          <Info size={15} style={{ color: 'var(--color-warning-700, #b45309)' }} className="flex-shrink-0 mt-0.5" />
          <p className="text-xs" style={{ color: 'var(--color-warning-800, #92400e)' }}>
            Editing the <strong>{roleLabel}</strong> override. These settings apply only to that role and fall back to the
            shell default wherever you leave them unchanged.
          </p>
        </div>
      )}

      <Section accent="success"
        title={`${kpiShell === 'staff' ? 'Staff' : 'Manager'} shell — ${kpiRole ? roleLabel : 'all roles'}`}
        desc="Each card: toggle visibility, rename, set a caption, and configure its numbers.">
        {(() => {
          let lastGroup = null;
          return SHELL_STAT_CARDS[kpiShell].map(card => {
            const header = card.group && card.group !== lastGroup ? (lastGroup = card.group) : null;
            return (
              <div key={card.key}>
                {header && (
                  <p className="text-[10px] font-bold uppercase tracking-widest mt-3 mb-1.5 px-1"
                    style={{ color: 'var(--color-text-tertiary)' }}>{header}</p>
                )}
                <CardBuilder shell={kpiShell} card={card} layout={builderLayout}
                  roleKey={kpiRole || null} layoutKey={builderKey} onSave={onSave} />
              </div>
            );
          });
        })()}
      </Section>
    </div>
  );
};

export default KpiRules;
