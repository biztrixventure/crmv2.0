import { useState, useEffect, useMemo } from 'react';
import { Shuffle, Loader2, ChevronDown, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../contexts/AuthContext';
import client from '../../api/client';
import ThemedSelect from '../UI/Select';

/*
 * ReassignOwnership — SUPERADMIN-ONLY ownership editor for a transfer or a sale.
 * Renders nothing for anyone else. Lets the superadmin move a record to a
 * different fronter / closer / creator / company (and optionally cascade onto
 * the linked sale/transfer), regardless of status / dispo / sale on it.
 *
 * Props: kind = 'transfer' | 'sale', record (must include .id + current name
 * fields for display), onDone() to refresh the parent.
 */
export default function ReassignOwnership({ kind, record, onDone }) {
  const { user } = useAuth();
  const [open, setOpen]       = useState(false);
  const [users, setUsers]     = useState([]);
  const [companies, setCompanies] = useState([]);
  const [sel, setSel]         = useState({});      // field → chosen user_id ('' = keep)
  const [companyId, setCompanyId] = useState('');  // '' = keep
  const [cascade, setCascade] = useState(false);
  const [busy, setBusy]       = useState(false);

  // Hooks must run unconditionally — gate the RENDER, not the hooks.
  const isSuper = user?.role === 'superadmin';

  useEffect(() => {
    if (!open || !isSuper) return;
    client.get('users/lookup').then(r => setUsers(r.data.users || [])).catch(() => {});
    client.get('companies').then(r => setCompanies(r.data.companies || r.data || [])).catch(() => {});
  }, [open, isSuper]);

  // Fields to expose + the current display name for each.
  const fields = useMemo(() => kind === 'transfer'
    ? [
        { key: 'created_by',         label: 'Fronter', current: record?.fronter_name || record?.created_by_name || record?.creator_name || '—' },
        { key: 'assigned_closer_id', label: 'Closer',  current: record?.closer_name || record?.assigned_closer_name || '—' },
      ]
    : [
        { key: 'fronter_id', label: 'Fronter',    current: record?.fronter_name || '—' },
        { key: 'closer_id',  label: 'Closer',     current: record?.closer_name || '—' },
        { key: 'created_by', label: 'Created by', current: record?.created_by_name || '—' },
      ], [kind, record]);

  const userOpts = useMemo(() =>
    users.map(u => ({ value: u.user_id, label: `${u.name}${u.role ? ` · ${String(u.role).replace(/_/g, ' ')}` : ''}${u.company_name ? ` · ${u.company_name}` : ''}` })),
    [users]);

  if (!isSuper) return null;

  const save = async () => {
    const body = {};
    fields.forEach(f => {
      const v = sel[f.key];
      if (v === '__clear__') body[f.key] = null;   // explicit unassign
      else if (v) body[f.key] = v;
    });
    if (companyId) body.company_id = companyId;
    if (!Object.keys(body).length) { toast.error('Pick at least one new owner / company'); return; }
    if (cascade) body[kind === 'transfer' ? 'cascade_sale' : 'cascade_transfer'] = true;
    setBusy(true);
    try {
      const ep = kind === 'transfer' ? `transfers/${record.id}/reassign` : `sales/${record.id}/reassign`;
      const r = await client.patch(ep, body);
      const extra = r.data.sales_updated ? ` · ${r.data.sales_updated} sale(s) updated` : r.data.transfer_updated ? ' · linked transfer updated' : '';
      toast.success(`Ownership updated${extra}`);
      setSel({}); setCompanyId(''); setCascade(false); setOpen(false);
      onDone?.();
    } catch (e) { toast.error(e.response?.data?.error || 'Reassign failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl mt-3 overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm font-semibold"
        style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text)' }}>
        <span className="flex items-center gap-2"><Shuffle size={15} className="text-primary-600" /> Reassign ownership <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'var(--color-primary-100, #e0e7ff)', color: 'var(--color-primary-700)' }}>ADMIN</span></span>
        <ChevronDown size={15} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </button>

      {open && (
        <div className="p-3 space-y-3" style={{ backgroundColor: 'var(--color-surface)' }}>
          {fields.map(f => (
            <div key={f.key}>
              <label className="text-xs font-semibold flex items-center justify-between" style={{ color: 'var(--color-text-secondary)' }}>
                <span>{f.label}</span>
                <span className="text-[11px] font-normal" style={{ color: 'var(--color-text-tertiary)' }}>now: {f.current}</span>
              </label>
              <ThemedSelect value={sel[f.key] || ''} onChange={e => setSel(s => ({ ...s, [f.key]: e.target.value }))}
                className="input w-full text-sm py-1.5 mt-1">
                <option value="">— keep current —</option>
                <option value="__clear__">— unassign (clear) —</option>
                {userOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </ThemedSelect>
            </div>
          ))}

          <div>
            <label className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Company</label>
            <ThemedSelect value={companyId} onChange={e => setCompanyId(e.target.value)} className="w-full text-sm mt-1">
              <option value="">— keep current —</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </ThemedSelect>
          </div>

          <label className="flex items-start gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-text-secondary)' }}>
            <input type="checkbox" checked={cascade} onChange={e => setCascade(e.target.checked)} className="mt-0.5" />
            <span>Also apply the same owners to the linked {kind === 'transfer' ? 'sale' : 'transfer'} (if any).</span>
          </label>

          <div className="flex items-start gap-2 rounded-lg p-2 text-[11px]" style={{ backgroundColor: 'var(--color-warning-50, #fffbeb)', color: 'var(--color-warning-700, #b45309)' }}>
            <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
            <span>Pick owners who belong to the right company, or the record won't appear in their view. The change is audited.</span>
          </div>

          <button onClick={save} disabled={busy}
            className="w-full text-sm font-bold py-2 rounded-lg text-white inline-flex items-center justify-center gap-2 disabled:opacity-40"
            style={{ background: 'var(--gradient-sidebar)' }}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Shuffle size={15} />} Apply reassignment
          </button>
        </div>
      )}
    </div>
  );
}
