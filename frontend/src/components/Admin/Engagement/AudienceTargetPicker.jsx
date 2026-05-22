import { useState, useMemo } from 'react';
import { Search, X, Check } from 'lucide-react';

// Lightweight multi-select with optional search. options: [{value,label,sub?}]
export const MultiSelect = ({ label, options, selected = [], onChange, searchable, placeholder = 'Search…' }) => {
  const [q, setQ] = useState('');
  const sel = new Set(selected);
  const toggle = (v) => onChange(sel.has(v) ? selected.filter(x => x !== v) : [...selected, v]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return !s ? options : options.filter(o => `${o.label} ${o.sub || ''}`.toLowerCase().includes(s));
  }, [options, q]);

  return (
    <div>
      {label && <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>{label}</label>}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {selected.map(v => {
            const o = options.find(x => x.value === v);
            return (
              <span key={v} className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md font-medium"
                style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>
                {o?.label || v}<button type="button" onClick={() => toggle(v)}><X size={10} /></button>
              </span>
            );
          })}
        </div>
      )}
      {searchable && (
        <div className="relative mb-1.5">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} className="input pl-8 text-sm" />
        </div>
      )}
      <div className="rounded-lg max-h-44 overflow-y-auto" style={{ border: '1px solid var(--color-border)' }}>
        {filtered.length === 0 ? (
          <p className="text-xs p-2" style={{ color: 'var(--color-text-tertiary)' }}>No matches.</p>
        ) : filtered.map(o => {
          const on = sel.has(o.value);
          return (
            <button key={o.value} type="button" onClick={() => toggle(o.value)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-sm transition-colors"
              style={{ backgroundColor: on ? 'var(--color-primary-50)' : 'transparent', color: 'var(--color-text)' }}>
              <span className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0" style={{ border: `1px solid ${on ? 'var(--color-primary-500)' : 'var(--color-border)'}`, backgroundColor: on ? 'var(--color-primary-500)' : 'transparent' }}>
                {on && <Check size={11} className="text-white" />}
              </span>
              <span className="flex-1 min-w-0 truncate">{o.label}{o.sub && <span className="opacity-50 ml-1 text-xs">{o.sub}</span>}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

// Audience picker. withType=true → announcement-style (Global/Role/Users/Company
// radio + the one relevant select). withType=false → marquee/spiff style (three
// optional selects; empty = everyone).
const AudienceTargetPicker = ({ value, onChange, reference, withType = false }) => {
  const roleOpts    = (reference.roles || []).map(r => ({ value: r, label: r.replace(/_/g, ' ') }));
  const companyOpts = (reference.companies || []).map(c => ({ value: c.id, label: c.name }));
  const userOpts    = (reference.users || []).map(u => ({ value: u.user_id, label: u.name, sub: u.email || u.company_name || '' }));
  const set = (patch) => onChange({ ...value, ...patch });

  if (withType) {
    const TYPES = [{ k: 'global', l: 'Everyone' }, { k: 'role', l: 'By Role' }, { k: 'users', l: 'Specific Users' }, { k: 'company', l: 'By Company' }];
    return (
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Audience</label>
          <div className="flex gap-1 p-1 rounded-xl flex-wrap" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            {TYPES.map(t => (
              <button key={t.k} type="button" onClick={() => set({ target_type: t.k })}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={{ background: value.target_type === t.k ? 'var(--gradient-sidebar)' : 'transparent', color: value.target_type === t.k ? 'white' : 'var(--color-text-secondary)' }}>
                {t.l}
              </button>
            ))}
          </div>
        </div>
        {value.target_type === 'role'    && <MultiSelect label="Roles"     options={roleOpts}    selected={value.target_roles || []}       onChange={v => set({ target_roles: v })} />}
        {value.target_type === 'users'   && <MultiSelect label="Users"     options={userOpts}    selected={value.target_user_ids || []}    onChange={v => set({ target_user_ids: v })} searchable placeholder="Search by name or email…" />}
        {value.target_type === 'company' && <MultiSelect label="Companies" options={companyOpts} selected={value.target_company_ids || []} onChange={v => set({ target_company_ids: v })} />}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>Leave a list empty to target everyone in that dimension.</p>
      <MultiSelect label="Companies" options={companyOpts} selected={value.target_company_ids || []} onChange={v => set({ target_company_ids: v })} />
      <MultiSelect label="Roles"     options={roleOpts}    selected={value.target_roles || []}       onChange={v => set({ target_roles: v })} />
      <MultiSelect label="Users"     options={userOpts}    selected={value.target_user_ids || []}    onChange={v => set({ target_user_ids: v })} searchable placeholder="Search by name or email…" />
    </div>
  );
};

export default AudienceTargetPicker;
