import { useState, useEffect } from 'react';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { Alert } from '../../../components/UI';
import { usePermissions } from '../../../hooks/usePermissions';

const CAT_META = {
  sales:     { accent: '#8b5cf6', light: 'rgba(139,92,246,0.08)',  border: 'rgba(139,92,246,0.25)', label: 'Sales' },
  admin:     { accent: '#ef4444', light: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.25)',  label: 'Administration' },
  reports:   { accent: '#3b82f6', light: 'rgba(59,130,246,0.08)',  border: 'rgba(59,130,246,0.25)', label: 'Reports' },
  callbacks: { accent: '#10b981', light: 'rgba(16,185,129,0.08)',  border: 'rgba(16,185,129,0.25)', label: 'Callbacks' },
  reviews:   { accent: '#f59e0b', light: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.25)', label: 'Reviews' },
  users:     { accent: '#06b6d4', light: 'rgba(6,182,212,0.08)',   border: 'rgba(6,182,212,0.25)',  label: 'Users' },
};

const toLabel = (name) =>
  name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const PermChip = ({ perm, selected, accent, light, border, onToggle }) => (
  <button
    type="button"
    onClick={() => onToggle(perm.name)}
    className="flex items-start gap-2.5 p-3 rounded-xl text-left w-full transition-all duration-150 hover:scale-[1.01]"
    style={{
      border: `2px solid ${selected ? accent : 'var(--color-border)'}`,
      backgroundColor: selected ? light : 'var(--color-surface)',
    }}
  >
    {/* Checkbox visual */}
    <div className="flex-shrink-0 mt-0.5 w-4 h-4 rounded flex items-center justify-center transition-all"
      style={{
        border: `2px solid ${selected ? accent : 'var(--color-border)'}`,
        backgroundColor: selected ? accent : 'transparent',
      }}>
      {selected && <Check size={9} strokeWidth={3} className="text-white" />}
    </div>

    {/* Text */}
    <div className="min-w-0">
      <p className="text-xs font-bold leading-snug"
        style={{ color: selected ? accent : 'var(--color-text)' }}>
        {toLabel(perm.name)}
      </p>
      {perm.description && (
        <p className="text-xs mt-0.5 leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
          {perm.description}
        </p>
      )}
    </div>
  </button>
);

const CategoryBlock = ({ category, perms, selected, onToggle, onToggleAll }) => {
  const [collapsed, setCollapsed] = useState(false);
  const meta = CAT_META[category] || {
    accent: '#6366f1', light: 'rgba(99,102,241,0.08)', border: 'rgba(99,102,241,0.25)', label: category,
  };
  const selectedCount = perms.filter(p => selected.includes(p.name)).length;
  const allSel = selectedCount === perms.length;
  const noneSel = selectedCount === 0;

  return (
    <div className="rounded-2xl overflow-hidden"
      style={{ border: `1.5px solid ${meta.border}`, backgroundColor: 'var(--color-surface)' }}>

      {/* Category header */}
      <div className="flex items-center gap-3 px-4 py-3"
        style={{ backgroundColor: meta.light, borderBottom: `1px solid ${meta.border}` }}>
        {/* Color dot + name */}
        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: meta.accent }} />
        <span className="font-bold text-sm flex-1" style={{ color: meta.accent }}>
          {meta.label !== category ? meta.label : toLabel(category)}
        </span>

        {/* Selected counter pill */}
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
          style={{
            backgroundColor: selectedCount > 0 ? meta.accent : 'var(--color-bg-secondary)',
            color: selectedCount > 0 ? '#fff' : 'var(--color-text-tertiary)',
          }}>
          {selectedCount}/{perms.length}
        </span>

        {/* Select-all / Clear toggle */}
        <button
          type="button"
          onClick={() => onToggleAll(category)}
          className="text-xs font-bold px-2.5 py-1 rounded-lg transition-all"
          style={{
            backgroundColor: allSel ? meta.accent : 'var(--color-bg-secondary)',
            color: allSel ? '#fff' : meta.accent,
            border: `1px solid ${allSel ? meta.accent : meta.border}`,
          }}
        >
          {allSel ? 'Clear all' : 'Select all'}
        </button>

        {/* Collapse toggle */}
        <button type="button" onClick={() => setCollapsed(v => !v)}
          className="p-1 rounded transition-colors hover:bg-white/30">
          {collapsed
            ? <ChevronDown size={14} style={{ color: meta.accent }} />
            : <ChevronUp   size={14} style={{ color: meta.accent }} />}
        </button>
      </div>

      {/* Permission chips grid */}
      {!collapsed && (
        <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {perms.map(perm => (
            <PermChip
              key={perm.id}
              perm={perm}
              selected={selected.includes(perm.name)}
              accent={meta.accent}
              light={meta.light}
              border={meta.border}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}

      {collapsed && (
        <div className="px-4 py-2 flex flex-wrap gap-1.5">
          {perms.filter(p => selected.includes(p.name)).map(p => (
            <span key={p.id} className="text-xs px-2 py-0.5 rounded-full font-semibold"
              style={{ backgroundColor: meta.light, color: meta.accent, border: `1px solid ${meta.border}` }}>
              {toLabel(p.name)}
            </span>
          ))}
          {noneSel && (
            <span className="text-xs text-text-tertiary italic">None selected</span>
          )}
        </div>
      )}
    </div>
  );
};

const PermissionMatrix = ({ selectedPermissions = [], onChange }) => {
  const { permissions, loading, error, fetchPermissions } = usePermissions();
  const [localSelected, setLocalSelected] = useState(selectedPermissions);

  useEffect(() => { fetchPermissions(); }, []);
  useEffect(() => { setLocalSelected(selectedPermissions); }, [selectedPermissions]);

  const handleToggle = (name) => {
    const updated = localSelected.includes(name)
      ? localSelected.filter(p => p !== name)
      : [...localSelected, name];
    setLocalSelected(updated);
    onChange(updated);
  };

  const handleToggleAll = (category) => {
    const names = (permissions[category] || []).map(p => p.name);
    const allSel = names.every(n => localSelected.includes(n));
    const updated = allSel
      ? localSelected.filter(n => !names.includes(n))
      : [...new Set([...localSelected, ...names])];
    setLocalSelected(updated);
    onChange(updated);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 gap-2 text-text-secondary">
        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-600" />
        <span className="text-sm">Loading permissions…</span>
      </div>
    );
  }

  if (error) {
    return <Alert type="error" title="Error" message={`Failed to load permissions: ${error}`} />;
  }

  const totalSelected = localSelected.length;
  const totalPerms = Object.values(permissions).flat().length;

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-base text-text">Assign Permissions</h3>
        <span className="text-sm font-semibold px-3 py-1 rounded-full"
          style={{
            backgroundColor: totalSelected > 0 ? 'var(--color-primary-100)' : 'var(--color-bg-secondary)',
            color: totalSelected > 0 ? 'var(--color-primary-700)' : 'var(--color-text-tertiary)',
          }}>
          {totalSelected} of {totalPerms} selected
        </span>
      </div>

      {/* Category blocks */}
      {Object.entries(permissions).map(([category, perms]) => (
        <CategoryBlock
          key={category}
          category={category}
          perms={perms}
          selected={localSelected}
          onToggle={handleToggle}
          onToggleAll={handleToggleAll}
        />
      ))}
    </div>
  );
};

export default PermissionMatrix;
