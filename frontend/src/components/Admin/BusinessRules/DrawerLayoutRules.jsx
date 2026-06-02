import { useEffect, useMemo, useState } from 'react';
import { LayoutTemplate, AlertTriangle, Eye, EyeOff, GripVertical, ChevronUp, ChevronDown, Info } from 'lucide-react';
import { clearDrawerLayoutCache } from '../../../hooks/useDrawerLayout';

// Drawer types + roles the SuperAdmin can configure.
const DRAWER_TYPES = [
  { key: 'sale',     label: 'Sale Drawer',     desc: 'Closer / manager / compliance click on a sale row → this drawer opens.' },
  { key: 'transfer', label: 'Transfer Drawer', desc: 'Click on a transfer row → this drawer opens.' },
  { key: 'callback', label: 'Callback Drawer', desc: 'Click on a callback row → this drawer opens.' },
];

const ROLES = [
  { key: 'closer',             label: 'Closer',             color: 'success' },
  { key: 'closer_manager',     label: 'Closer Manager',     color: 'success' },
  { key: 'fronter',            label: 'Fronter',            color: 'info'    },
  { key: 'fronter_manager',    label: 'Fronter Manager',    color: 'info'    },
  { key: 'compliance_manager', label: 'Compliance',         color: 'warning' },
  { key: 'superadmin',         label: 'Superadmin',         color: 'primary' },
  { key: 'company_admin',      label: 'Company Admin',      color: 'primary' },
];

// Catalog of sections the SuperAdmin can include in each drawer. Description
// tells them what the section shows so a non-engineer understands the impact
// of toggling it off.
const SECTION_CATALOG = {
  sale: [
    { id: 'customer',           label: 'Customer',           desc: 'Name, phone, email, address' },
    { id: 'vehicle',            label: 'Vehicle',            desc: 'Year/make/model/VIN/miles' },
    { id: 'sale_info',          label: 'Sale Info',          desc: 'Plan, sale date, status, closer disposition, client' },
    { id: 'financial',          label: 'Financial',          desc: 'Monthly + down payment. Hide from fronters per policy.' },
    { id: 'compliance_actions', label: 'Compliance Actions', desc: 'Approve / return / cancel buttons (compliance only)' },
    { id: 'additional',         label: 'Additional Info',    desc: 'Any extra form_data fields not in the main sections' },
    { id: 'people',             label: 'People',             desc: 'Closer + fronter attribution' },
    { id: 'timeline',           label: 'Timeline',           desc: 'Created / updated / review timestamps' },
    { id: 'audit',              label: 'Audit Trail',        desc: 'Edit history JSONB log + field_audit_log entries' },
  ],
  transfer: [
    { id: 'customer',     label: 'Customer',     desc: 'Lead identity fields' },
    { id: 'vehicle',      label: 'Vehicle',      desc: 'Year/make/model/VIN' },
    { id: 'lead_info',    label: 'Lead Info',    desc: 'Other form_data fields' },
    { id: 'people',       label: 'People',       desc: 'Fronter + assigned closer' },
    { id: 'dispositions', label: 'Dispositions', desc: 'Disposition action history' },
    { id: 'timeline',     label: 'Timeline',     desc: 'Created / updated / rejected timestamps' },
    { id: 'audit',        label: 'Audit Trail',  desc: 'Edit history + audit log' },
  ],
  callback: [
    { id: 'schedule', label: 'Schedule', desc: 'Callback time + priority + customer timezone' },
    { id: 'customer', label: 'Customer', desc: 'Customer name + phone' },
    { id: 'notes',    label: 'Notes',    desc: 'Closer notes' },
    { id: 'history',  label: 'History',  desc: 'Reschedule + status-change audit log' },
  ],
};

// ── Section row ────────────────────────────────────────────────────────────
const SectionRow = ({ section, catalogEntry, idx, total, onToggle, onMove }) => {
  const desc = catalogEntry?.desc || '';
  return (
    <div className="flex items-center gap-2 p-2.5 rounded-lg transition-all"
      style={{
        backgroundColor: section.visible ? 'var(--color-surface)' : 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border)',
        opacity: section.visible ? 1 : 0.55,
      }}>
      <GripVertical size={14} style={{ color: 'var(--color-text-tertiary)' }} className="flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text">{section.label || catalogEntry?.label || section.id}</p>
        {desc && <p className="text-xs text-text-tertiary mt-0.5 leading-relaxed">{desc}</p>}
      </div>
      <div className="flex items-center gap-0.5 flex-shrink-0">
        <button type="button" onClick={() => onMove(idx, -1)} disabled={idx === 0}
          aria-label="Move up" title="Move up"
          className="p-1.5 rounded hover:bg-bg-secondary disabled:opacity-30 disabled:cursor-not-allowed"
          style={{ minWidth: 32, minHeight: 32 }}>
          <ChevronUp size={14} />
        </button>
        <button type="button" onClick={() => onMove(idx, 1)} disabled={idx === total - 1}
          aria-label="Move down" title="Move down"
          className="p-1.5 rounded hover:bg-bg-secondary disabled:opacity-30 disabled:cursor-not-allowed"
          style={{ minWidth: 32, minHeight: 32 }}>
          <ChevronDown size={14} />
        </button>
      </div>
      <button type="button" onClick={onToggle}
        aria-label={section.visible ? 'Hide section' : 'Show section'}
        title={section.visible ? 'Hide section' : 'Show section'}
        className="flex items-center gap-1 px-2 py-1 rounded text-xs font-bold flex-shrink-0"
        style={{
          backgroundColor: section.visible ? 'var(--color-success-100, #d1fae5)' : 'var(--color-bg-secondary)',
          color: section.visible ? 'var(--color-success-700, #047857)' : 'var(--color-text-tertiary)',
          minHeight: 32,
        }}>
        {section.visible ? <><Eye size={11} /> Visible</> : <><EyeOff size={11} /> Hidden</>}
      </button>
    </div>
  );
};

const DrawerLayoutRules = ({ config, scope, onSave }) => {
  const [drawerType, setDrawerType] = useState('sale');
  const [role,       setRole]       = useState('closer');

  const key = `drawer.layout.${drawerType}.${role}`;
  const catalog = SECTION_CATALOG[drawerType] || [];

  // Resolve current sections from config or fall back to a full catalog copy
  // so the SuperAdmin can start from "everything visible" and toggle off.
  const sections = useMemo(() => {
    const stored = config?.[key];
    if (Array.isArray(stored) && stored.length) {
      // Merge with catalog so newly added sections appear at the bottom hidden
      const known = new Set(stored.map(s => s.id));
      const extras = catalog.filter(c => !known.has(c.id))
        .map((c, i) => ({ id: c.id, label: c.label, visible: false, order: stored.length + i + 1 }));
      return [...stored, ...extras].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }
    return catalog.map((c, i) => ({ id: c.id, label: c.label, visible: true, order: i + 1 }));
  }, [config, key, catalog]);

  const persist = (next) => {
    // Re-number `order` so consumers can rely on 1..N contiguous values.
    const renumbered = next.map((s, i) => ({ ...s, order: i + 1 }));
    onSave(key, renumbered);
    clearDrawerLayoutCache();
  };

  const toggle = (idx) => {
    const next = [...sections];
    next[idx] = { ...next[idx], visible: !next[idx].visible };
    persist(next);
  };

  const move = (idx, delta) => {
    const ni = idx + delta;
    if (ni < 0 || ni >= sections.length) return;
    const next = [...sections];
    [next[idx], next[ni]] = [next[ni], next[idx]];
    persist(next);
  };

  const resetToDefault = () => {
    if (!window.confirm('Reset this drawer + role to the default catalog (all visible)?')) return;
    persist(catalog.map((c, i) => ({ id: c.id, label: c.label, visible: true, order: i + 1 })));
  };

  return (
    <div className="max-w-3xl pb-8">
      {scope !== 'global' && (
        <div className="rounded-2xl p-4 mb-4 flex items-start gap-3"
          style={{ backgroundColor: 'var(--color-warning-50, #fffbeb)', border: '1px solid var(--color-warning-300, #fcd34d)' }}>
          <AlertTriangle size={18} style={{ color: 'var(--color-warning-700, #b45309)' }} className="flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-bold mb-0.5" style={{ color: 'var(--color-warning-800, #92400e)' }}>Per-company override active</p>
            <p style={{ color: 'var(--color-warning-700, #b45309)' }}>Layout changes apply only to the selected company. Roles you don't customize here fall back to global defaults.</p>
          </div>
        </div>
      )}

      <div className="mb-6">
        <h2 className="text-xl font-bold text-text mb-1 flex items-center gap-2" style={{ fontFamily: 'var(--font-display)' }}>
          <LayoutTemplate size={20} className="text-primary-600" /> Drawer Layout
        </h2>
        <p className="text-sm text-text-secondary max-w-2xl leading-relaxed">
          Configure which sections each role sees inside the Sale / Transfer / Callback drawers, and the order they appear in. Hiding a section here hides it everywhere — closer drawers, compliance drawers, even the admin's deep links.
        </p>
      </div>

      {/* ── Drawer + role picker ────────────────────────────────────── */}
      <section className="rounded-2xl mb-4 p-5"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderTop: '3px solid var(--color-primary-500)' }}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="drawer-type" className="text-xs font-bold uppercase tracking-wide text-text-secondary mb-1.5 block">
              Drawer type
            </label>
            <select id="drawer-type" value={drawerType} onChange={(e) => setDrawerType(e.target.value)}
              className="input text-sm py-2 w-full">
              {DRAWER_TYPES.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
            <p className="text-xs text-text-tertiary mt-1.5 leading-relaxed">
              {DRAWER_TYPES.find(d => d.key === drawerType)?.desc}
            </p>
          </div>
          <div>
            <label htmlFor="drawer-role" className="text-xs font-bold uppercase tracking-wide text-text-secondary mb-1.5 block">
              Role
            </label>
            <select id="drawer-role" value={role} onChange={(e) => setRole(e.target.value)}
              className="input text-sm py-2 w-full">
              {ROLES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
            <p className="text-xs text-text-tertiary mt-1.5 leading-relaxed">
              Editing as <strong>{ROLES.find(r => r.key === role)?.label}</strong>. Each role saves independently.
            </p>
          </div>
        </div>
      </section>

      {/* ── Sections list ──────────────────────────────────────────── */}
      <section className="rounded-2xl p-5"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderTop: '3px solid var(--color-info-500, #06b6d4)' }}>
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <div>
            <h3 className="text-base font-bold text-text">Sections</h3>
            <p className="text-xs text-text-secondary mt-0.5">
              Arrows reorder · eye icon toggles visibility. Re-saves on every change.
            </p>
          </div>
          <button type="button" onClick={resetToDefault}
            className="text-xs font-semibold px-3 py-2 rounded-lg border transition-colors hover:bg-bg-secondary"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)', minHeight: 36 }}>
            Reset to default
          </button>
        </div>

        <div className="space-y-1.5">
          {sections.map((s, i) => (
            <SectionRow
              key={s.id}
              section={s}
              catalogEntry={catalog.find(c => c.id === s.id)}
              idx={i}
              total={sections.length}
              onToggle={() => toggle(i)}
              onMove={move}
            />
          ))}
        </div>

        <p className="text-xs text-text-tertiary mt-4 flex items-start gap-1.5 leading-relaxed">
          <Info size={12} className="flex-shrink-0 mt-0.5" />
          Section IDs are stable and known to the drawer code. Hiding a section here removes the section block; field-level edits within a section will land in a future update.
        </p>
      </section>
    </div>
  );
};

export default DrawerLayoutRules;
