// ============================================================================
// HR -> Pay -> Commission plans (mig 318). The rules a payroll run uses to
// SUGGEST each person's commission -- nothing here pays anyone. HR applies the
// suggestions on a run ("Commission & SPIFF"), and the payslip shows which plan
// and how many sales each amount came from.
// Reads/writes /hr/commissions/plans (routes/hr/commissions.js).
// ============================================================================
import { useEffect, useState } from 'react';
import { Percent, Plus, Pencil, Trash2, Save } from 'lucide-react';
import client from '../../api/client';
import { Panel, SectionHeader, Loading, EmptyState, Field, Toggle, CheckRow, TableScroll } from '../../components/UI/kit';
import { Alert } from '../../components/UI';
import ThemedSelect from '../../components/UI/Select';
import ThemedDate from '../../components/UI/ThemedDate';
import { Btn, ModuleModal } from '../../components/Modules/ModuleUI';
import AskDialog from '../../components/Modules/AskDialog';
import { fmtMoney, fmtDate, DEFAULT_CURRENCY } from '../../utils/money';

const LEVEL_WORDS = {
  trainee: 'Trainees', fronter: 'Fronters', closer: 'Closers', fronter_manager: 'Fronter managers',
  closer_manager: 'Closer managers', company_admin: 'Company admins', operations_manager: 'Operations managers',
};
const blank = () => ({
  name: '', applies_to: 'closer', role_levels: [], basis: 'per_sale', amount: '', dp_currency: 'USD',
  min_sales: 0, counts_on: 'approved', is_active: true, effective_from: '2026-06-01', effective_to: '', note: '',
});

export default function CommissionPlansPanel({ companyId, scope }) {
  const currency = scope?.currency || DEFAULT_CURRENCY;
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState(null);
  const [asking, setAsking] = useState(null);

  const load = async () => {
    const r = await client.get('hr/commissions/plans', { params: { company_id: companyId || undefined } });
    setData(r.data);
  };
  useEffect(() => {
    load().catch(e => setNotice({ type: 'error', text: e.response?.data?.error || 'Could not load the plans' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  if (!data) return notice ? <Alert type={notice.type}>{notice.text}</Alert> : <Loading variant="rows" rows={4} />;
  const canManage = !!data.can_manage;

  const describe = (p) => {
    const who = p.applies_to === 'closer' ? 'sales they close' : 'sales they pass on';
    const pay = p.basis === 'per_sale' ? `${fmtMoney(Number(p.amount), currency)} per sale` : `${Number(p.amount)}% of the down payment (${p.dp_currency})`;
    return `${pay}, on ${who}` + (p.min_sales ? `, from the ${p.min_sales}th sale in the period` : '')
      + (p.counts_on === 'dp_paid' ? ', once the DP is paid' : '');
  };

  const remove = (p) => setAsking({
    title: `Remove "${p.name}"?`,
    message: 'Runs already paid keep what was applied. Draft runs stop suggesting this plan. To pause it instead, edit it and switch it off.',
    confirmLabel: 'Remove plan', reason: 'required', danger: true,
    onConfirm: async (why) => {
      try {
        await client.delete(`hr/commissions/plans/${p.id}`, { data: { company_id: companyId, change_reason: why } });
        await load(); setAsking(null);
        setNotice({ type: 'success', text: 'Plan removed.' });
      } catch (e) { setNotice({ type: 'error', text: e.response?.data?.error || 'Could not remove it' }); }
    },
  });

  return (
    <div className="space-y-4">
      {notice && <Alert type={notice.type} onDismiss={() => setNotice(null)}>{notice.text}</Alert>}
      <Panel>
        <SectionHeader icon={Percent} title="Commission plans"
          subtitle="Rules for what people earn from their sales. A payroll run suggests the amounts; HR applies them. Nothing is paid from a plan by itself."
          actions={canManage ? <Btn variant="primary" icon={Plus} onClick={() => setEditing(blank())}>New plan</Btn> : null} />
        {(data.plans || []).length === 0 ? (
          <EmptyState compact icon={Percent} title="No commission plans yet"
            hint={canManage ? 'Add one, e.g. "Closers: 500 per approved sale".' : 'Ask HR to set these up.'} />
        ) : (
          <TableScroll>
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  {['Plan', 'Pays', 'Who', 'Active', ''].map(h => (
                    <th key={h} className="td-p text-[11px] font-bold uppercase tracking-wider text-left" style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.plans.map(p => (
                  <tr key={p.id} style={{ borderBottom: '1px solid var(--color-border)', opacity: p.is_active ? 1 : 0.55 }}>
                    <td className="td-p text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                      {p.name}
                      <span className="block text-[11px] font-normal" style={{ color: 'var(--color-text-tertiary)' }}>
                        From {fmtDate(p.effective_from)}{p.effective_to ? ` to ${fmtDate(p.effective_to)}` : ''}
                      </span>
                    </td>
                    <td className="td-p text-sm" style={{ color: 'var(--color-text-secondary)' }}>{describe(p)}</td>
                    <td className="td-p text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                      {(p.role_levels || []).length ? p.role_levels.map(l => LEVEL_WORDS[l] || l.replace(/_/g, ' ')).join(', ') : 'Anyone with those sales'}
                    </td>
                    <td className="td-p text-sm" style={{ color: 'var(--color-text-secondary)' }}>{p.is_active ? 'Yes' : 'Paused'}</td>
                    <td className="td-p text-right whitespace-nowrap">
                      {canManage && (
                        <>
                          <Btn size="sm" icon={Pencil} onClick={() => setEditing({ ...p, effective_to: p.effective_to || '', note: p.note || '' })}><span className="sr-only">Edit</span></Btn>{' '}
                          <Btn size="sm" variant="danger" icon={Trash2} onClick={() => remove(p)}><span className="sr-only">Remove</span></Btn>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Panel>

      {editing && (
        <PlanEditor plan={editing} levels={data.role_levels || []} currency={currency} onClose={() => setEditing(null)}
          onSave={async (form, why) => {
            try {
              const body = { company_id: companyId, ...form, amount: Number(form.amount), min_sales: Number(form.min_sales || 0), effective_to: form.effective_to || null };
              if (form.id) await client.put(`hr/commissions/plans/${form.id}`, { ...body, change_reason: why });
              else await client.post('hr/commissions/plans', body);
              await load(); setEditing(null);
              setNotice({ type: 'success', text: 'Plan saved. Open a draft payroll run and use "Commission & SPIFF" to see what it suggests.' });
            } catch (e) { setNotice({ type: 'error', text: e.response?.data?.error || 'Could not save the plan' }); }
          }} />
      )}
      {asking && <AskDialog {...asking} onClose={() => setAsking(null)} />}
    </div>
  );
}

function PlanEditor({ plan, levels, currency, onClose, onSave }) {
  const [form, setForm] = useState(plan);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const ready = form.name.trim() && form.amount !== '' && Number(form.amount) >= 0 && (!form.id || why.trim());

  return (
    <ModuleModal wide title={form.id ? `Edit ${plan.name}` : 'New commission plan'} onClose={onClose}
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" icon={Save} busy={busy} disabled={!ready}
          onClick={async () => { setBusy(true); try { await onSave(form, why.trim()); } finally { setBusy(false); } }}>Save plan</Btn>
      </>}>
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Name" required>
            <input className="input w-full" maxLength={120} value={form.name} onChange={e => set('name', e.target.value)} placeholder="Closers -- per approved sale" />
          </Field>
          <Field label="Whose sales count">
            <ThemedSelect value={form.applies_to} onChange={e => set('applies_to', e.target.value)}>
              <option value="closer">Sales the person closed</option>
              <option value="fronter">Sales the person passed on (fronted)</option>
            </ThemedSelect>
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <Field label="Pays">
            <ThemedSelect value={form.basis} onChange={e => set('basis', e.target.value)}>
              <option value="per_sale">A fixed amount per sale</option>
              <option value="dp_percent">A percent of the down payment</option>
            </ThemedSelect>
          </Field>
          <Field label={form.basis === 'per_sale' ? `Amount (${currency})` : 'Percent'} required>
            <input className="input w-full" type="number" min="0" step="0.01" value={form.amount} onChange={e => set('amount', e.target.value)} />
          </Field>
          {form.basis === 'dp_percent' && (
            <Field label="Down payments are in" hint="Converted with the exchange rate at the period end.">
              <input className="input w-full uppercase" maxLength={3} value={form.dp_currency} onChange={e => set('dp_currency', e.target.value.toUpperCase())} />
            </Field>
          )}
          <Field label="Only from sale number" hint="0 = from the first sale in the period.">
            <input className="input w-full" type="number" min="0" step="1" value={form.min_sales} onChange={e => set('min_sales', e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="A sale counts once">
            <ThemedSelect value={form.counts_on} onChange={e => set('counts_on', e.target.value)}>
              <option value="approved">It is approved (or its DP is paid)</option>
              <option value="dp_paid">Its DP is paid</option>
            </ThemedSelect>
          </Field>
          <Field label="From"><ThemedDate value={form.effective_from} onChange={e => set('effective_from', e.target.value)} /></Field>
          <Field label="Until (optional)"><ThemedDate value={form.effective_to} onChange={e => set('effective_to', e.target.value)} /></Field>
        </div>
        <Field as="div" label="Who it applies to" hint={form.role_levels.length ? 'Only the ticked roles.' : 'Nobody ticked = anyone who has those sales.'}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4">
            {levels.map(l => (
              <CheckRow key={l.level} checked={form.role_levels.includes(l.level)} label={LEVEL_WORDS[l.level] || l.level.replace(/_/g, ' ')} hint={l.names.join(', ')}
                onChange={on => set('role_levels', on ? [...new Set([...form.role_levels, l.level])] : form.role_levels.filter(x => x !== l.level))} />
            ))}
          </div>
        </Field>
        <Toggle checked={form.is_active} onChange={v => set('is_active', v)} label="Active" hint="A paused plan suggests nothing." />
        {form.id && (
          <Field label="Why is it changing?" required hint="Kept in the plan's history.">
            <input className="input w-full" maxLength={500} value={why} onChange={e => setWhy(e.target.value)} />
          </Field>
        )}
      </div>
    </ModuleModal>
  );
}
