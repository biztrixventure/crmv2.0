import { useMemo, useState } from 'react';
import { LayoutDashboard, AlertTriangle, Info, ChevronUp, ChevronDown, RotateCcw, Eye, EyeOff, Pencil, Check, X, GripVertical, ToggleLeft, ToggleRight } from 'lucide-react';
import { clearShellLayoutCache } from '../../../hooks/useShellLayout';

/*
 * ShellLayoutRules
 *
 * SuperAdmin UI for shell.layout.<shellId>. Manages:
 *   - tabs: hide/rename/reorder + default landing tab
 *   - stat_cards: hide/show per shell (Phase 2)
 *   - filters: hide/show date range + agent select per shell (Phase 2)
 *   - actions: hide/show shell-level action buttons like Export (Phase 2)
 *
 * Permission/feature-flag gates still apply first. Admin can only narrow.
 */

const SHELLS = [
  {
    id: 'staff',
    label: 'Staff (Closer + Fronter)',
    desc:
      'Closer + Fronter day-to-day shell. Tabs are role-aware at the permission level (e.g. fronters never see "My Sales"), so an admin disable here narrows what each role sees within their already-allowed surface.',
    defaultTabs: [
      { key: 'sales',           label: 'My Sales' },
      { key: 'transfers',       label: 'My Transfers' },
      { key: 'team_transfers',  label: 'Team Transfers' },
      { key: 'team_sales',      label: 'Team Sales' },
      { key: 'callbacks',       label: 'Callbacks' },
      { key: 'team_callbacks',  label: 'Team Callbacks' },
      { key: 'tracked_numbers', label: 'Tracked Numbers' },
      { key: 'numbers',         label: 'My Numbers' },
      { key: 'search',          label: 'Search Sales' },
      { key: 'faqs',            label: 'FAQs' },
      { key: 'scripts',         label: 'Scripts' },
    ],
    statCards: [
      { key: 'my_sales',                label: 'My Sales (closer)' },
      { key: 'approved',                label: 'Approved (closer)' },
      { key: 'cancelled',               label: 'Cancelled (closer)' },
      { key: 'awaiting_review',         label: 'Awaiting Review (closer)' },
      { key: 'resells',                 label: 'Resells (closer)' },
      { key: 'total_leads',             label: 'Total Leads (fronter)' },
      { key: 'fronter_approved',        label: 'Approved (fronter)' },
      { key: 'fronter_awaiting_review', label: 'Awaiting Review (fronter)' },
    ],
    filters: [
      { key: 'date_range',   label: 'Date range picker' },
      { key: 'agent_select', label: 'Agent select dropdown' },
    ],
    actions: [],
  },
  {
    id: 'manager',
    label: 'Manager (Fronter / Closer / Operations / Company Admin)',
    desc:
      'Manager-tier shell for fronter_manager, closer_manager, operations_manager, and company_admin. Tabs filtered by role + permission before this override applies.',
    defaultTabs: [
      { key: 'overview',     label: 'Overview' },
      { key: 'transfers',    label: 'Team Transfers' },
      { key: 'team_sales',   label: 'Team Sales' },
      { key: 'my_sales',     label: 'My Sales' },
      { key: 'callbacks',    label: 'Team Callbacks' },
      { key: 'numbers',      label: 'Numbers' },
      { key: 'search',       label: 'Sale Search' },
      { key: 'spiffs',       label: 'SPIFFs' },
      { key: 'activity_log', label: 'Activity Log' },
      { key: 'faqs',         label: 'FAQs' },
      { key: 'scripts',      label: 'Scripts' },
    ],
    statCards: [
      { key: 'transfers',       label: 'Total Transfers' },
      { key: 'sales',           label: 'Total Sales' },
      { key: 'approved',        label: 'Approved' },
      { key: 'awaiting_review', label: 'Awaiting Review' },
      { key: 'cancelled',       label: 'Cancelled' },
      { key: 'resells',         label: 'Resells' },
      { key: 'dup_attempts',    label: 'Dup Attempts' },
    ],
    filters: [
      { key: 'date_range',   label: 'Date range picker' },
      { key: 'agent_select', label: 'Agent select dropdown (transfers + sales tabs)' },
    ],
    actions: [
      { key: 'export', label: 'Export button (header)' },
    ],
  },
  {
    id: 'compliance',
    label: 'Compliance',
    desc:
      'Compliance-staff shell. Tabs are not feature-flag gated, so an admin disable here is the only way to hide a destination from compliance users.',
    defaultTabs: [
      { key: 'companies',   label: 'Companies' },
      { key: 'calendar',    label: 'Calendar' },
      { key: 'queue',       label: 'Review Queue' },
      { key: 'sales',       label: 'All Sales' },
      { key: 'bulk_status', label: 'Bulk Status Update' },
      { key: 'transfers',   label: 'Transfers' },
      { key: 'callbacks',   label: 'Callbacks' },
      { key: 'reviews',     label: 'Call Reviews' },
      { key: 'numbers',     label: 'Call Numbers' },
    ],
    statCards: [],
    filters:   [],
    actions:   [],
  },
];

function resolveTabs(stored, defaultTabs) {
  const storedTabs = Array.isArray(stored?.tabs) ? stored.tabs : [];
  const storedMap = new Map(storedTabs.map((t, i) => [t.key, { ...t, __idx: i }]));
  const out = [];
  defaultTabs.forEach((d, codeIdx) => {
    const s = storedMap.get(d.key);
    out.push({
      key: d.key,
      label: s && typeof s.label === 'string' && s.label.trim() ? s.label : d.label,
      enabled: s ? s.enabled !== false : true,
      order:   s && Number.isFinite(s.order) ? s.order : codeIdx,
      __fromDefault: true,
    });
  });
  storedTabs.forEach((s) => {
    if (!s || !s.key) return;
    if (out.some((t) => t.key === s.key)) return;
    out.push({
      key: s.key,
      label: typeof s.label === 'string' && s.label.trim() ? s.label : s.key.replace(/_/g, ' '),
      enabled: s.enabled !== false,
      order: Number.isFinite(s.order) ? s.order : 2000,
      __fromDefault: false,
    });
  });
  out.sort((a, b) => a.order - b.order);
  return out;
}

// Resolve a generic sub-collection (stat_cards / filters / actions).
// Returns array of { key, label, enabled } merging stored + default.
function resolveGeneric(stored, defaults, collection) {
  const storedArr = Array.isArray(stored?.[collection]) ? stored[collection] : [];
  const storedMap = new Map(storedArr.map((s) => [s?.key, s]));
  return defaults.map((d) => {
    const s = storedMap.get(d.key);
    return { key: d.key, label: d.label, enabled: s ? s.enabled !== false : true };
  });
}

const Section = ({ title, desc, accent = 'primary', children, defaultOpen = true }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section
      className="rounded-2xl mb-4 overflow-hidden"
      style={{
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderTop: `3px solid var(--color-${accent}-500, #6366f1)`,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full p-5 text-left hover:bg-bg-secondary transition-colors flex items-start justify-between gap-3"
      >
        <div className="flex-1">
          <h2 className="text-base font-bold text-text mb-1">{title}</h2>
          {desc && <p className="text-xs text-text-secondary max-w-2xl leading-relaxed">{desc}</p>}
        </div>
        {open ? <ChevronUp size={16} className="flex-shrink-0 mt-1" /> : <ChevronDown size={16} className="flex-shrink-0 mt-1" />}
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </section>
  );
};

const ShellLayoutRules = ({ config, scope, onSave }) => {
  const [shellId, setShellId] = useState('staff');
  const shellMeta = SHELLS.find((s) => s.id === shellId) || SHELLS[0];

  const stored = config?.[`shell.layout.${shellId}`] || null;
  const tabs       = useMemo(() => resolveTabs(stored, shellMeta.defaultTabs), [stored, shellMeta]);
  const statCards  = useMemo(() => resolveGeneric(stored, shellMeta.statCards, 'stat_cards'), [stored, shellMeta]);
  const filters    = useMemo(() => resolveGeneric(stored, shellMeta.filters, 'filters'), [stored, shellMeta]);
  const actions    = useMemo(() => resolveGeneric(stored, shellMeta.actions, 'actions'), [stored, shellMeta]);

  const defaultTabKey = stored?.default_tab || tabs.find((t) => t.enabled)?.key || tabs[0]?.key || '';

  const [editingKey, setEditingKey] = useState('');
  const [editValue, setEditValue]   = useState('');

  // Centralized save — writes the full merged shape so order of edits
  // doesn't matter (last edit wins).
  const persistAll = (patch = {}) => {
    const nextTabs       = (patch.tabs       || tabs).map((t, i) => ({ key: t.key, enabled: t.enabled !== false, label: t.label, order: i }));
    const nextCards      = (patch.statCards  || statCards).map((c) => ({ key: c.key, enabled: c.enabled !== false }));
    const nextFilters    = (patch.filters    || filters).map((f) => ({ key: f.key, enabled: f.enabled !== false }));
    const nextActions    = (patch.actions    || actions).map((a) => ({ key: a.key, enabled: a.enabled !== false }));
    const nextDefault    = patch.default_tab || defaultTabKey;
    const payload = {
      tabs: nextTabs,
      default_tab: nextDefault,
      stat_cards: nextCards,
      filters: nextFilters,
      actions: nextActions,
    };
    onSave(`shell.layout.${shellId}`, payload);
    clearShellLayoutCache(shellId);
  };

  const updateTab = (idx, p) => persistAll({ tabs: tabs.map((t, i) => (i === idx ? { ...t, ...p } : t)) });
  const moveTab = (idx, delta) => {
    const ni = idx + delta;
    if (ni < 0 || ni >= tabs.length) return;
    const next = [...tabs];
    [next[idx], next[ni]] = [next[ni], next[idx]];
    persistAll({ tabs: next });
  };
  const resetToDefaults = () => {
    if (!window.confirm(
      `Reset the ${shellMeta.label} layout to the system defaults?\n\nAll renames, hides, reorders, and card/filter/action toggles will be cleared. Existing data is untouched.`,
    )) return;
    persistAll({
      tabs:       shellMeta.defaultTabs.map((d) => ({ key: d.key, enabled: true, label: d.label })),
      statCards:  shellMeta.statCards.map((c) => ({ key: c.key, enabled: true })),
      filters:    shellMeta.filters.map((f) => ({ key: f.key, enabled: true })),
      actions:    shellMeta.actions.map((a) => ({ key: a.key, enabled: true })),
      default_tab: shellMeta.defaultTabs[0]?.key || '',
    });
  };

  const beginEdit = (t) => { setEditingKey(t.key); setEditValue(t.label); };
  const commitEdit = () => {
    if (!editingKey) return;
    const idx = tabs.findIndex((t) => t.key === editingKey);
    if (idx >= 0 && editValue.trim()) updateTab(idx, { label: editValue.trim() });
    setEditingKey(''); setEditValue('');
  };
  const cancelEdit = () => { setEditingKey(''); setEditValue(''); };

  // Reusable visibility toggle list — pattern shared by cards / filters /
  // actions sections. Each entry: { key, label, enabled }.
  const ToggleList = ({ items, onToggle, emptyLabel }) => {
    if (!items.length) {
      return <p className="text-xs text-text-tertiary italic py-2">{emptyLabel}</p>;
    }
    return (
      <div className="space-y-1.5">
        {items.map((it, i) => (
          <div
            key={it.key}
            className="rounded-xl flex items-center justify-between gap-2 px-3 py-2"
            style={{
              backgroundColor: it.enabled === false ? 'var(--color-bg-secondary)' : 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              opacity: it.enabled === false ? 0.65 : 1,
            }}
          >
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-text">{it.label}</span>
              <code
                className="text-[10px] font-mono px-1 py-0.5 rounded mt-0.5 w-fit"
                style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}
              >
                {it.key}
              </code>
            </div>
            <button
              type="button"
              onClick={() => onToggle(i, !it.enabled)}
              title={it.enabled ? 'Hide' : 'Show'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex-shrink-0"
              style={{
                border: '1px solid var(--color-border)',
                backgroundColor: it.enabled ? 'var(--color-success-50, #ecfdf5)' : 'var(--color-bg-secondary)',
                color: it.enabled ? 'var(--color-success-700, #047857)' : 'var(--color-text-secondary)',
                minHeight: 32,
              }}
            >
              {it.enabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
              {it.enabled ? 'Visible' : 'Hidden'}
            </button>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="max-w-3xl pb-8">
      {scope !== 'global' && (
        <div
          className="rounded-2xl p-4 mb-4 flex items-start gap-3"
          style={{
            backgroundColor: 'var(--color-warning-50, #fffbeb)',
            border: '1px solid var(--color-warning-300, #fcd34d)',
          }}
        >
          <AlertTriangle size={18} style={{ color: 'var(--color-warning-700, #b45309)' }} className="flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-bold mb-0.5" style={{ color: 'var(--color-warning-800, #92400e)' }}>
              Per-company override active
            </p>
            <p style={{ color: 'var(--color-warning-700, #b45309)' }}>
              Changes here apply only to the selected company.
            </p>
          </div>
        </div>
      )}

      <div className="mb-6">
        <h2 className="text-xl font-bold text-text mb-1 flex items-center gap-2" style={{ fontFamily: 'var(--font-display)' }}>
          <LayoutDashboard size={20} className="text-primary-600" /> Shell Layouts
        </h2>
        <p className="text-sm text-text-secondary max-w-2xl leading-relaxed">
          Hide tabs, rename labels, reorder them, pick the default landing tab, and toggle stat cards,
          filters, and action buttons per shell. One setting, everywhere — change here and every user in
          that shell sees the change on next mount. Permissions and feature flags still apply first.
        </p>
      </div>

      {/* Shell picker */}
      <div
        className="flex gap-1 p-1 rounded-xl overflow-x-auto mb-4"
        style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
      >
        {SHELLS.map((s) => {
          const active = s.id === shellId;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => { setShellId(s.id); setEditingKey(''); }}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap flex-shrink-0"
              style={{
                background: active ? 'var(--gradient-sidebar)' : 'transparent',
                color: active ? 'white' : 'var(--color-text-secondary)',
                boxShadow: active ? 'var(--shadow-sm)' : 'none',
              }}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      <Section accent="primary" title={`Tabs — ${shellMeta.label}`} desc={shellMeta.desc}>
        <div className="space-y-1.5">
          {tabs.map((t, i) => {
            const isEditing = editingKey === t.key;
            return (
              <div
                key={t.key + ':' + i}
                className="rounded-xl overflow-hidden"
                style={{
                  backgroundColor: t.enabled === false ? 'var(--color-bg-secondary)' : 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  opacity: t.enabled === false ? 0.6 : 1,
                }}
              >
                <div className="flex items-center gap-2 p-2.5 flex-wrap">
                  <GripVertical size={13} style={{ color: 'var(--color-text-tertiary)' }} className="flex-shrink-0" />

                  <div className="flex flex-col" style={{ minWidth: 110 }}>
                    <span className="text-[9px] font-bold uppercase tracking-wider text-text-tertiary">Key</span>
                    <code
                      className="text-xs font-mono px-1 py-0.5 rounded"
                      style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}
                    >
                      {t.key}
                    </code>
                  </div>

                  <div className="flex flex-col flex-1 min-w-[140px]">
                    <label className="text-[9px] font-bold uppercase tracking-wider text-text-tertiary">Label</label>
                    {isEditing ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEdit();
                            if (e.key === 'Escape') cancelEdit();
                          }}
                          autoFocus
                          className="input text-xs py-1 flex-1"
                        />
                        <button type="button" onClick={commitEdit} aria-label="Save label"
                          className="p-1 rounded hover:bg-bg-secondary"
                          style={{ color: 'var(--color-success-600, #16a34a)', minWidth: 26, minHeight: 26 }}>
                          <Check size={13} />
                        </button>
                        <button type="button" onClick={cancelEdit} aria-label="Cancel"
                          className="p-1 rounded hover:bg-bg-secondary"
                          style={{ color: 'var(--color-error-600, #dc2626)', minWidth: 26, minHeight: 26 }}>
                          <X size={13} />
                        </button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => beginEdit(t)}
                        className="text-sm font-semibold text-text text-left hover:underline flex items-center gap-1.5">
                        {t.label}
                        <Pencil size={11} style={{ color: 'var(--color-text-tertiary)' }} />
                      </button>
                    )}
                  </div>

                  <label className="inline-flex items-center gap-1.5 cursor-pointer flex-shrink-0"
                    title="Make this the default landing tab">
                    <input
                      type="radio"
                      name={`default-tab-${shellId}`}
                      checked={defaultTabKey === t.key}
                      disabled={t.enabled === false}
                      onChange={() => persistAll({ default_tab: t.key })}
                    />
                    <span className="text-[10px] font-semibold text-text-secondary">Default</span>
                  </label>

                  <button
                    type="button"
                    onClick={() => updateTab(i, { enabled: t.enabled === false })}
                    title={t.enabled === false ? 'Show this tab' : 'Hide this tab'}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors flex-shrink-0"
                    style={{
                      border: '1px solid var(--color-border)',
                      backgroundColor: t.enabled === false ? 'var(--color-bg-secondary)' : 'var(--color-success-50, #ecfdf5)',
                      color: t.enabled === false ? 'var(--color-text-secondary)' : 'var(--color-success-700, #047857)',
                      minHeight: 30,
                    }}
                  >
                    {t.enabled === false ? <EyeOff size={11} /> : <Eye size={11} />}
                    {t.enabled === false ? 'Hidden' : 'Visible'}
                  </button>

                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <button type="button" onClick={() => moveTab(i, -1)} disabled={i === 0}
                      aria-label="Move tab up" title="Move up"
                      className="p-1 rounded hover:bg-bg-secondary disabled:opacity-30"
                      style={{ minWidth: 26, minHeight: 26 }}>
                      <ChevronUp size={12} />
                    </button>
                    <button type="button" onClick={() => moveTab(i, 1)} disabled={i === tabs.length - 1}
                      aria-label="Move tab down" title="Move down"
                      className="p-1 rounded hover:bg-bg-secondary disabled:opacity-30"
                      style={{ minWidth: 26, minHeight: 26 }}>
                      <ChevronDown size={12} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section accent="success" title={`Stat cards — ${shellMeta.label}`}
        desc="Toggle which KPI cards appear on this shell's overview/landing tab. Each card uses real data from /stats/dashboard; hiding a card stops it from rendering without affecting the data it would have shown.">
        <ToggleList
          items={statCards}
          onToggle={(idx, enabled) => persistAll({ statCards: statCards.map((c, i) => (i === idx ? { ...c, enabled } : c)) })}
          emptyLabel="This shell has no stat cards configured yet."
        />
      </Section>

      <Section accent="warning" title={`Filters — ${shellMeta.label}`}
        desc="Toggle which filter UI elements appear in this shell's tab bars. Hiding the date range picker, for example, makes every list default to all-time data with no user-side override.">
        <ToggleList
          items={filters}
          onToggle={(idx, enabled) => persistAll({ filters: filters.map((f, i) => (i === idx ? { ...f, enabled } : f)) })}
          emptyLabel="This shell has no filter toggles configured yet."
        />
      </Section>

      <Section accent="info" title={`Actions — ${shellMeta.label}`}
        desc="Toggle shell-level action buttons (Export, future Bulk Edit / Delete, etc). These hide the button entirely — the underlying capability is unchanged.">
        <ToggleList
          items={actions}
          onToggle={(idx, enabled) => persistAll({ actions: actions.map((a, i) => (i === idx ? { ...a, enabled } : a)) })}
          emptyLabel="This shell has no action toggles configured yet."
        />
      </Section>

      <div className="flex items-center justify-between gap-2 mt-4">
        <button
          type="button"
          onClick={resetToDefaults}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors hover:bg-bg-secondary"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)', minHeight: 36 }}
        >
          <RotateCcw size={12} /> Reset {shellMeta.label} to defaults
        </button>
      </div>

      <p className="text-xs text-text-tertiary mt-4 flex items-start gap-1.5 leading-relaxed">
        <Info size={12} className="flex-shrink-0 mt-0.5" />
        The tab <code>key</code>, card <code>key</code>, etc. are raw identifiers the code reads for routing
        and visibility. Labels are display-only. Disabling never deletes data; it only hides the surface from
        the user. Permissions + feature flags still gate first, so an admin re-enable cannot widen access for
        a role that lacks the permission.
      </p>
    </div>
  );
};

export default ShellLayoutRules;
