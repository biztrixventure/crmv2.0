import { useState, useEffect } from 'react';
import { BarChart3, AlertTriangle, Info, LayoutDashboard, RotateCcw, Eye, EyeOff } from 'lucide-react';

const cfg = (config, key, fallback) => (config?.[key] !== undefined ? config[key] : fallback);

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

const findCard = (layout, key) =>
  (Array.isArray(layout?.stat_cards) ? layout.stat_cards : []).find(c => c.key === key);

// Merge one field into a card entry, creating the entry if it's the first edit.
function patchCard(layout, key, patch) {
  const cards = Array.isArray(layout?.stat_cards) ? [...layout.stat_cards] : [];
  const idx = cards.findIndex(c => c.key === key);
  if (idx >= 0) cards[idx] = { ...cards[idx], ...patch };
  else cards.push({ key, ...patch });
  return { ...(layout || {}), stat_cards: cards };
}

// One editable card row: show/hide toggle + custom-label field. The label
// commits on blur (not per keystroke) so we don't PUT business-config on every
// character. Blank label = render the shipped default.
const StatCardRow = ({ card, layout, layoutKey, onSave }) => {
  const entry   = findCard(layout, card.key);
  const enabled = entry ? entry.enabled !== false : true;
  const saved   = entry?.label ?? '';
  const [label, setLabel] = useState(saved);
  useEffect(() => { setLabel(saved); }, [saved]);

  const commitLabel = () => {
    const next = label.trim();
    if (next !== saved) onSave(layoutKey, patchCard(layout, card.key, { label: next }));
  };
  const toggle = () => onSave(layoutKey, patchCard(layout, card.key, { enabled: !enabled }));
  const reset  = () => { setLabel(''); onSave(layoutKey, patchCard(layout, card.key, { label: '' })); };

  return (
    <div className="flex items-center gap-2 py-2 px-3 rounded-lg transition-colors"
      style={{ border: '1px solid', borderColor: enabled ? 'var(--color-border)' : 'transparent',
               backgroundColor: enabled ? 'transparent' : 'var(--color-bg-secondary)', opacity: enabled ? 1 : 0.7 }}>
      <button type="button" onClick={toggle} title={enabled ? 'Visible — click to hide' : 'Hidden — click to show'}
        className="p-1.5 rounded-lg flex-shrink-0 transition-colors"
        style={{ color: enabled ? 'var(--color-primary-600)' : 'var(--color-text-tertiary)',
                 backgroundColor: enabled ? 'var(--color-primary-50, #eef2ff)' : 'transparent' }}>
        {enabled ? <Eye size={16} /> : <EyeOff size={16} />}
      </button>
      <input type="text" value={label} placeholder={card.label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={commitLabel}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        disabled={!enabled}
        className="input text-sm py-1.5 flex-1 min-w-0"
        title="Custom label shown on the card — leave blank to use the default" />
      {label && label !== card.label && (
        <button type="button" onClick={reset} title="Reset to default label"
          className="p-1.5 rounded-lg flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>
          <RotateCcw size={14} />
        </button>
      )}
    </div>
  );
};

// Renders a shell's card rows, inserting a subheader whenever the card group
// changes (staff has Closer view + Fronter view groups).
const StatCardsEditor = ({ cards, layout, layoutKey, onSave }) => {
  let lastGroup = null;
  return (
    <div className="space-y-1.5">
      {cards.map(card => {
        const header = card.group && card.group !== lastGroup
          ? (lastGroup = card.group)
          : null;
        return (
          <div key={card.key}>
            {header && (
              <p className="text-[10px] font-bold uppercase tracking-widest mt-2 mb-1 px-1"
                style={{ color: 'var(--color-text-tertiary)' }}>{header}</p>
            )}
            <StatCardRow card={card} layout={layout} layoutKey={layoutKey} onSave={onSave} />
          </div>
        );
      })}
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
          KPI Cards per Shell
        </h2>
      </div>
      <p className="text-sm text-text-secondary mb-4 max-w-2xl leading-relaxed">
        Control which KPI cards each shell shows and what they're called. The
        <Eye size={13} className="inline mx-1 align-text-bottom" /> toggle hides or shows a card; the text field renames it
        (leave blank to keep the built-in label). Takes effect on the next dashboard refresh — no deploy needed.
      </p>

      <Section accent="success" title="Staff Shell — Closer &amp; Fronter cards"
        desc="KPI cards shown to closers and fronters on their dashboard.">
        <StatCardsEditor cards={SHELL_STAT_CARDS.staff} layout={staffLayout} layoutKey="shell.layout.staff" onSave={onSave} />
      </Section>

      <Section accent="success" title="Manager Shell — Stat cards"
        desc="KPI cards shown to managers, operations managers, and company admins.">
        <StatCardsEditor cards={SHELL_STAT_CARDS.manager} layout={mgrLayout} layoutKey="shell.layout.manager" onSave={onSave} />
      </Section>
    </div>
  );
};

export default KpiRules;
