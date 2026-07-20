import { useState, useEffect, useCallback } from 'react';
import { Zap, ZapOff, Plus, Pencil, Trash2, X, Check, ChevronDown, ChevronUp, Building2, AlertTriangle } from 'lucide-react';
import client from '../../api/client';
import ThemedSelect from '../UI/Select';

const CATEGORIES = ['core', 'operations', 'quality', 'analytics', 'admin', 'general'];

const CAT = {
  core:       { bg: '#dbeafe', color: '#1d4ed8', label: 'Core' },
  operations: { bg: '#dcfce7', color: '#15803d', label: 'Ops' },
  quality:    { bg: '#fef3c7', color: '#b45309', label: 'Quality' },
  analytics:  { bg: '#f3e8ff', color: '#7c3aed', label: 'Analytics' },
  admin:      { bg: '#fee2e2', color: '#b91c1c', label: 'Admin' },
  general:    { bg: '#f1f5f9', color: '#475569', label: 'General' },
};

function FlagForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState({
    key:             initial?.key             || '',
    label:           initial?.label           || '',
    description:     initial?.description     || '',
    category:        initial?.category        || 'general',
    default_enabled: initial?.default_enabled ?? false,
    sort_order:      initial?.sort_order      ?? 99,
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const submit = async () => {
    if (!form.key.trim() || !form.label.trim()) { setError('Key and label required'); return; }
    setSaving(true); setError('');
    try { await onSave(form); }
    catch (e) { setError(e.response?.data?.error || e.message || 'Save failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="rounded-2xl p-5 mb-4 animate-fade-in"
      style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-primary-200)' }}>
      <h3 className="font-bold text-sm mb-4" style={{ color: 'var(--color-text)' }}>
        {initial ? 'Edit Flag' : 'New Feature Flag'}
      </h3>
      {error && (
        <div className="mb-3 px-3 py-2 rounded-xl text-xs font-medium"
          style={{ backgroundColor: 'var(--color-error-50)', color: 'var(--color-error-700)', border: '1px solid var(--color-error-200)' }}>
          {error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>
            Key <span style={{ color: 'var(--color-error-500)' }}>*</span>
          </label>
          <input value={form.key}
            onChange={e => set('key', e.target.value.toLowerCase().replace(/[^a-z_]/g, ''))}
            disabled={!!initial} placeholder="e.g. my_feature"
            className="w-full px-3 py-2 rounded-xl text-sm font-mono"
            style={{ backgroundColor: initial ? 'var(--color-bg-tertiary)' : 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)', opacity: initial ? 0.6 : 1 }} />
        </div>
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>
            Label <span style={{ color: 'var(--color-error-500)' }}>*</span>
          </label>
          <input value={form.label} onChange={e => set('label', e.target.value)} placeholder="Display name"
            className="w-full px-3 py-2 rounded-xl text-sm"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
        </div>
      </div>
      <div className="mb-3">
        <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>Description</label>
        <textarea value={form.description} onChange={e => set('description', e.target.value)}
          placeholder="What does this feature do?" rows={2}
          className="w-full px-3 py-2 rounded-xl text-sm resize-none"
          style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
      </div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>Category</label>
          <ThemedSelect value={form.category} onChange={e => set('category', e.target.value)}
            className="w-full px-3 py-2 rounded-xl text-sm"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
            {CATEGORIES.map(c => <option key={c} value={c}>{CAT[c]?.label || c}</option>)}
          </ThemedSelect>
        </div>
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>Sort Order</label>
          <input type="number" min={0} value={form.sort_order}
            onChange={e => set('sort_order', parseInt(e.target.value) || 0)}
            className="w-full px-3 py-2 rounded-xl text-sm"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
        </div>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <div onClick={() => set('default_enabled', !form.default_enabled)}
              className="relative w-10 h-5 rounded-full transition-colors cursor-pointer"
              style={{ backgroundColor: form.default_enabled ? 'var(--color-primary-500)' : 'var(--color-border)' }}>
              <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                style={{ transform: form.default_enabled ? 'translateX(22px)' : 'translateX(2px)' }} />
            </div>
            <span className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Default on</span>
          </label>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button onClick={onCancel} className="px-4 py-2 rounded-xl text-sm font-semibold"
          style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
          Cancel
        </button>
        <button onClick={submit} disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white"
          style={{ background: 'var(--gradient-sidebar)', opacity: saving ? 0.7 : 1 }}>
          {saving ? <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" /> : <Check size={14} />}
          {initial ? 'Save Changes' : 'Create Flag'}
        </button>
      </div>
    </div>
  );
}

function CompanyRow({ company, flagKey, defaultEnabled, onToggle, toggling }) {
  const enabled   = company.flags[flagKey]?.is_enabled ?? defaultEnabled;
  const isLoading = toggling === `${company.id}-${flagKey}`;

  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-xl transition-colors"
      style={{ backgroundColor: enabled ? 'var(--color-primary-50)' : 'transparent' }}>
      <div className="flex items-center gap-2 min-w-0">
        <Building2 size={13} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
        <span className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{company.name}</span>
        <span className="text-xs px-1.5 py-0.5 rounded-md"
          style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)', border: '1px solid var(--color-border)' }}>
          {company.company_type}
        </span>
      </div>
      <button onClick={() => onToggle(company.id, flagKey, !enabled)} disabled={isLoading}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all hover:scale-105 flex-shrink-0"
        style={{
          backgroundColor: enabled ? 'var(--color-primary-100)' : 'var(--color-bg-secondary)',
          color: enabled ? 'var(--color-primary-700)' : 'var(--color-text-tertiary)',
          border: `1px solid ${enabled ? 'var(--color-primary-200)' : 'var(--color-border)'}`,
          opacity: isLoading ? 0.6 : 1, cursor: isLoading ? 'not-allowed' : 'pointer',
          minWidth: '70px', justifyContent: 'center',
        }}>
        {isLoading
          ? <div className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
          : enabled ? <><Zap size={10} /> On</> : <><ZapOff size={10} /> Off</>}
      </button>
    </div>
  );
}

const FeatureFlagsManager = () => {
  const [catalog,      setCatalog]      = useState([]);
  const [companies,    setCompanies]    = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const [toggling,     setToggling]     = useState(null);
  const [expanded,     setExpanded]     = useState(null);
  const [showCreate,   setShowCreate]   = useState(false);
  const [editing,      setEditing]      = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting,     setDeleting]     = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await client.get('feature-flags/companies');
      setCatalog(res.data.catalog || []);
      setCompanies(res.data.companies || []);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (companyId, key, value) => {
    const tid = `${companyId}-${key}`;
    setToggling(tid);
    try {
      await client.put(`feature-flags/companies/${companyId}/${key}`, { is_enabled: value });
      setCompanies(prev => prev.map(c =>
        c.id !== companyId ? c : { ...c, flags: { ...c.flags, [key]: { ...c.flags[key], is_enabled: value } } }
      ));
    } catch (e) { setError(e.response?.data?.error || 'Toggle failed'); }
    finally { setToggling(null); }
  };

  const createFlag = async (form) => {
    const res = await client.post('feature-flags', form);
    const f = res.data.flag;
    setCatalog(prev => [...prev, f].sort((a, b) => a.sort_order - b.sort_order));
    setCompanies(prev => prev.map(c => ({ ...c, flags: { ...c.flags, [f.key]: { is_enabled: f.default_enabled } } })));
    setShowCreate(false);
  };

  const saveEdit = async (form) => {
    const res = await client.put(`feature-flags/${editing.key}`, form);
    const updated = res.data.flag;
    setCatalog(prev => prev.map(f => f.key === updated.key ? { ...f, ...updated } : f));
    setEditing(null);
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await client.delete(`feature-flags/${deleteTarget.key}`);
      setCatalog(prev => prev.filter(f => f.key !== deleteTarget.key));
      setCompanies(prev => prev.map(c => {
        const flags = { ...c.flags }; delete flags[deleteTarget.key]; return { ...c, flags };
      }));
      if (expanded === deleteTarget.key) setExpanded(null);
      setDeleteTarget(null);
    } catch (e) { setError(e.response?.data?.error || 'Delete failed'); }
    finally { setDeleting(false); }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: 'var(--color-primary-400)', borderTopColor: 'transparent' }} />
    </div>
  );

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-bold flex items-center gap-2"
            style={{ color: 'var(--color-text)' }}>
            <Zap size={15} style={{ color: 'var(--color-primary-600)' }} />
            Feature Flags
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            Enable or disable features per company. Changes take effect immediately.
          </p>
        </div>
        <button onClick={() => { setShowCreate(true); setEditing(null); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all hover:opacity-90"
          style={{ background: 'var(--gradient-sidebar)' }}>
          <Plus size={13} /> New Flag
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium"
          style={{ backgroundColor: 'var(--color-error-50)', border: '1px solid var(--color-error-200)', color: 'var(--color-error-700)' }}>
          <AlertTriangle size={15} /> {error}
          <button onClick={() => setError('')} className="ml-auto p-0.5 rounded hover:bg-error-100"><X size={13} /></button>
        </div>
      )}

      {showCreate && !editing && <FlagForm onSave={createFlag} onCancel={() => setShowCreate(false)} />}

      {deleteTarget && (
        <div className="mb-4 p-4 rounded-2xl animate-fade-in"
          style={{ backgroundColor: 'var(--color-error-50)', border: '1px solid var(--color-error-200)' }}>
          <p className="text-sm font-semibold mb-3" style={{ color: 'var(--color-error-700)' }}>
            Delete <code className="bg-white px-1.5 py-0.5 rounded">{deleteTarget.key}</code>? Removes it from all companies.
          </p>
          <div className="flex gap-2">
            <button onClick={() => setDeleteTarget(null)}
              className="px-3 py-1.5 rounded-xl text-sm font-semibold"
              style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
              Cancel
            </button>
            <button onClick={doDelete} disabled={deleting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold text-white"
              style={{ backgroundColor: 'var(--color-error-600)', opacity: deleting ? 0.7 : 1 }}>
              {deleting ? <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" /> : <Trash2 size={13} />}
              Delete
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {catalog.map(flag => {
          const catStyle     = CAT[flag.category] || CAT.general;
          const isExpanded   = expanded === flag.key;
          const isEditingThis = editing?.key === flag.key;
          const enabledCount = companies.filter(c => (c.flags[flag.key]?.is_enabled ?? flag.default_enabled)).length;

          return (
            <div key={flag.key} className="rounded-2xl overflow-hidden transition-all"
              style={{
                backgroundColor: 'var(--color-surface)',
                border: `1px solid ${isExpanded ? 'var(--color-primary-200)' : 'var(--color-border)'}`,
                boxShadow: isExpanded ? 'var(--shadow-md)' : 'var(--shadow-sm)',
              }}>
              <div className="flex items-center gap-3 p-4">
                <span className="flex-shrink-0 px-2 py-0.5 rounded-lg text-xs font-bold"
                  style={{ backgroundColor: catStyle.bg, color: catStyle.color }}>
                  {catStyle.label}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>{flag.label}</span>
                    <code className="text-xs px-1.5 py-0.5 rounded-md font-mono"
                      style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)', border: '1px solid var(--color-border)' }}>
                      {flag.key}
                    </code>
                  </div>
                  {flag.description && (
                    <p className="text-xs mt-0.5 line-clamp-1" style={{ color: 'var(--color-text-secondary)' }}>{flag.description}</p>
                  )}
                </div>
                <div className="flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full"
                  style={{
                    backgroundColor: enabledCount > 0 ? 'var(--color-primary-50)' : 'var(--color-bg-secondary)',
                    color: enabledCount > 0 ? 'var(--color-primary-700)' : 'var(--color-text-tertiary)',
                    border: `1px solid ${enabledCount > 0 ? 'var(--color-primary-200)' : 'var(--color-border)'}`,
                  }}>
                  {enabledCount}/{companies.length}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button onClick={() => { setEditing(isEditingThis ? null : flag); setShowCreate(false); }}
                    className="p-1.5 rounded-lg hover:bg-bg-secondary transition-colors" title="Edit">
                    <Pencil size={13} style={{ color: 'var(--color-text-tertiary)' }} />
                  </button>
                  <button onClick={() => setDeleteTarget(flag)}
                    className="p-1.5 rounded-lg hover:bg-error-50 transition-colors" title="Delete">
                    <Trash2 size={13} style={{ color: 'var(--color-error-500)' }} />
                  </button>
                  <button onClick={() => setExpanded(isExpanded ? null : flag.key)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-colors"
                    style={{
                      backgroundColor: isExpanded ? 'var(--color-primary-100)' : 'var(--color-bg-secondary)',
                      color: isExpanded ? 'var(--color-primary-700)' : 'var(--color-text-secondary)',
                      border: '1px solid var(--color-border)',
                    }}>
                    {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    Companies
                  </button>
                </div>
              </div>

              {isEditingThis && (
                <div className="px-4 pb-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
                  <div className="pt-4">
                    <FlagForm initial={flag} onSave={saveEdit} onCancel={() => setEditing(null)} />
                  </div>
                </div>
              )}

              {isExpanded && !isEditingThis && (
                <div className="px-4 pb-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
                  <p className="text-xs font-semibold mt-3 mb-2 tracking-wide"
                    style={{ color: 'var(--color-text-secondary)' }}>PER-COMPANY STATE</p>
                  {companies.length === 0
                    ? <p className="text-sm text-center py-4" style={{ color: 'var(--color-text-tertiary)' }}>No companies.</p>
                    : <div className="space-y-1">
                        {companies.map(company => (
                          <CompanyRow key={company.id} company={company} flagKey={flag.key}
                            defaultEnabled={flag.default_enabled} onToggle={toggle} toggling={toggling} />
                        ))}
                      </div>
                  }
                </div>
              )}
            </div>
          );
        })}

        {catalog.length === 0 && !showCreate && (
          <div className="text-center py-16" style={{ color: 'var(--color-text-tertiary)' }}>
            <Zap size={40} className="mx-auto mb-3 opacity-20" />
            <p className="text-sm">No feature flags yet. Create one to get started.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default FeatureFlagsManager;
