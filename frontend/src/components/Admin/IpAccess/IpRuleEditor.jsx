// ============================================================================
// IpRuleEditor -- list + add / edit / switch off / delete allow and deny rules,
// for one user (userId) or for everyone (userId = null, "global").
//
// Every change goes through `run` (useGuardedAction) so a change that would
// block the admin's OWN address stops at an "I understand" dialog. The address
// is checked as it is typed with the same rules the server applies.
// ============================================================================
import { useState } from 'react';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../../api/client';
import ThemedSelect from '../../UI/Select';
import { Toggle, IconButton, EmptyState } from '../../UI/kit';
import { validateIpOrCidr } from './ipValidate';
import { TypePill, fmtWhen } from './IpAccessShared';

const errText = (e, fallback) => e?.response?.data?.error || fallback;

function IpInputHint({ value }) {
  if (!value) {
    return <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>One address (203.0.113.44) or a range (203.0.113.0/24, 2001:db8::/32).</span>;
  }
  const v = validateIpOrCidr(value);
  if (!v.ok) return <span className="text-[11px]" style={{ color: 'var(--color-error-600)' }}>{v.error}</span>;
  return (
    <span className="text-[11px]" style={{ color: v.masked ? 'var(--color-warning-600)' : 'var(--color-success-600)' }}>
      {v.masked ? `Will be stored as ${v.value} (the host part of a range is cleared).` : `IPv${v.version} ${v.value.includes('/') ? 'range' : 'address'} ✓`}
    </span>
  );
}

export default function IpRuleEditor({ userId = null, rules = [], run, onChanged, emptyHint }) {
  const [form, setForm] = useState({ type: 'allow', ip_value: '', label: '' });
  const [editing, setEditing] = useState(null);   // { id, type, ip_value, label }
  const [busy, setBusy] = useState(null);         // 'add' | rule id

  const formOk = validateIpOrCidr(form.ip_value).ok;
  const editOk = editing ? validateIpOrCidr(editing.ip_value).ok : false;

  const add = async (e) => {
    e.preventDefault();
    if (!formOk) return;
    setBusy('add');
    try {
      const res = await run(flags => client.post('ip-access/rules', {
        user_id: userId, type: form.type, ip_value: form.ip_value, label: form.label, ...flags,
      }));
      if (res) {
        toast.success(res.data?.note || `${form.type === 'deny' ? 'Deny' : 'Allow'} rule added`);
        setForm(f => ({ ...f, ip_value: '', label: '' }));
        onChanged?.();
      }
    } catch (err) { toast.error(errText(err, 'Could not add the rule')); }
    finally { setBusy(null); }
  };

  const update = async (rule, patch, okText) => {
    setBusy(rule.id);
    try {
      const res = await run(flags => client.put(`ip-access/rules/${rule.id}`, { ...patch, ...flags }));
      if (res) { toast.success(res.data?.note || okText); setEditing(null); onChanged?.(); }
    } catch (err) { toast.error(errText(err, 'Could not save the rule')); }
    finally { setBusy(null); }
  };

  const remove = async (rule) => {
    if (!window.confirm(`Delete the ${rule.type} rule for ${rule.ip_value}?`)) return;
    setBusy(rule.id);
    try {
      const res = await run(flags => client.delete(`ip-access/rules/${rule.id}`, { params: flags }));
      if (res) { toast.success('Rule deleted'); onChanged?.(); }
    } catch (err) { toast.error(errText(err, 'Could not delete the rule')); }
    finally { setBusy(null); }
  };

  const inputStyle = { minWidth: 0 };

  return (
    <div className="space-y-3">
      {/* Add */}
      <form onSubmit={add} className="rounded-xl p-3 space-y-2" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
        <div className="grid gap-2 grid-cols-1 sm:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)_auto] items-start">
          <ThemedSelect value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className="input">
            <option value="allow">Allow</option>
            <option value="deny">Deny</option>
          </ThemedSelect>
          <div className="min-w-0">
            <input value={form.ip_value} onChange={e => setForm(f => ({ ...f, ip_value: e.target.value }))}
              placeholder="203.0.113.0/24" className="input w-full font-mono" style={inputStyle}
              aria-label="IP address or CIDR range" spellCheck={false} autoComplete="off" />
            <div className="mt-1"><IpInputHint value={form.ip_value} /></div>
          </div>
          <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value.slice(0, 120) }))}
            placeholder={userId ? 'Label, e.g. "Home fiber"' : 'Label, e.g. "Head office"'} className="input w-full" style={inputStyle}
            aria-label="Label" />
          <button type="submit" disabled={!formOk || busy === 'add'}
            className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: 'var(--gradient-sidebar, var(--color-primary-600))' }}>
            <Plus size={14} /> Add
          </button>
        </div>
      </form>

      {/* List */}
      {rules.length === 0 ? (
        <EmptyState compact title="No rules yet" hint={emptyHint || 'Add an address or a range above.'} />
      ) : (
        <ul className="space-y-1.5 m-0 p-0 list-none">
          {rules.map(rule => {
            const isEditing = editing?.id === rule.id;
            return (
              <li key={rule.id} className="rounded-xl px-3 py-2"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', opacity: rule.is_active ? 1 : 0.65 }}>
                {isEditing ? (
                  <div className="grid gap-2 grid-cols-1 sm:grid-cols-[110px_minmax(0,1fr)_minmax(0,1fr)_auto] items-start">
                    <ThemedSelect value={editing.type} onChange={e => setEditing(s => ({ ...s, type: e.target.value }))} className="input">
                      <option value="allow">Allow</option>
                      <option value="deny">Deny</option>
                    </ThemedSelect>
                    <div className="min-w-0">
                      <input value={editing.ip_value} onChange={e => setEditing(s => ({ ...s, ip_value: e.target.value }))}
                        className="input w-full font-mono" style={inputStyle} aria-label="IP address or CIDR range" spellCheck={false} />
                      <div className="mt-1"><IpInputHint value={editing.ip_value} /></div>
                    </div>
                    <input value={editing.label} onChange={e => setEditing(s => ({ ...s, label: e.target.value.slice(0, 120) }))}
                      className="input w-full" style={inputStyle} aria-label="Label" />
                    <div className="flex items-center gap-1.5">
                      <IconButton label="Save" tone="success" disabled={!editOk || busy === rule.id}
                        onClick={() => update(rule, { type: editing.type, ip_value: editing.ip_value, label: editing.label }, 'Rule saved')}>
                        <Check size={15} />
                      </IconButton>
                      <IconButton label="Cancel" onClick={() => setEditing(null)}><X size={15} /></IconButton>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 flex-wrap">
                    <TypePill type={rule.type} />
                    <span className="font-mono text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{rule.ip_value}</span>
                    {rule.label && <span className="text-[13px] truncate" style={{ color: 'var(--color-text-secondary)' }}>{rule.label}</span>}
                    <span className="text-[11px] ml-auto" style={{ color: 'var(--color-text-tertiary)' }}
                      title={rule.created_by_name ? `Added by ${rule.created_by_name}` : undefined}>
                      {rule.created_by_name ? `${rule.created_by_name} · ` : ''}{fmtWhen(rule.created_at)}
                    </span>
                    <Toggle checked={rule.is_active} busy={busy === rule.id} label={rule.is_active ? 'Active' : 'Off'}
                      onChange={(on) => update(rule, { is_active: on }, on ? 'Rule switched on' : 'Rule switched off')} />
                    <IconButton label="Edit" onClick={() => setEditing({ id: rule.id, type: rule.type, ip_value: rule.ip_value, label: rule.label || '' })}>
                      <Pencil size={14} />
                    </IconButton>
                    <IconButton label="Delete" tone="danger" disabled={busy === rule.id} onClick={() => remove(rule)}>
                      <Trash2 size={14} />
                    </IconButton>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
