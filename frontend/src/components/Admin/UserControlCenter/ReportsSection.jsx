// ReportsSection -- may this one person open Company Reports, which companies,
// and do they see the money (payment amounts) in them?
//
// Three switches, each with "Role decides" as its own state (mig 333,
// user_report_access). Role decides = nothing was set for this person, so their
// role's report permission / view_financial_data answers -- shown on the row,
// so it never has to be guessed. On / Off are decisions about THEM and beat the
// role either way. The amounts switch is for the reports only: turning it off
// does not take money away anywhere else in the CRM.
//
// Nothing changes until Save.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Check, X, CornerDownRight, DollarSign, Building2, Info } from 'lucide-react';
import client from '../../../api/client';
import { Panel, SectionHeader, Loading, EmptyState, CheckRow, useFlash, accent } from '../../UI/kit';

const TONE = { on: 'var(--color-success-600)', off: 'var(--color-error-600)', role: 'var(--color-text-secondary)' };

function TriSwitch({ value, onPick, labels }) {
  const opts = [
    { key: 'on', label: labels.on, icon: Check },
    { key: 'role', label: 'Role decides', icon: CornerDownRight },
    { key: 'off', label: labels.off, icon: X },
  ];
  return (
    <div className="inline-flex rounded-xl overflow-hidden flex-shrink-0" style={{ border: '1px solid var(--color-border)' }}>
      {opts.map((o, i) => {
        const active = value === o.key;
        const Icon = o.icon;
        return (
          <button key={o.key} type="button" onClick={() => onPick(o.key)} aria-pressed={active}
            className="px-2.5 py-1.5 text-xs font-bold inline-flex items-center gap-1 transition-colors"
            style={{
              background: active ? `color-mix(in srgb, ${TONE[o.key]} 12%, transparent)` : 'transparent',
              color: active ? TONE[o.key] : 'var(--color-text-tertiary)',
              borderLeft: i === 0 ? 'none' : '1px solid var(--color-border)',
            }}>
            <Icon size={12} /> {o.label}
          </button>
        );
      })}
    </div>
  );
}

const toKey = (v) => (v === true ? 'on' : v === false ? 'off' : 'role');
const fromKey = (k) => (k === 'on' ? true : k === 'off' ? false : null);

const yesNo = (v) => (v === true ? 'Yes' : v === 'some' ? 'Some companies' : 'No');
const companiesText = (c) => (c === 'all' ? 'Every company' : (c || []).map(x => x.name).join(', ') || '—');
const SOURCE = {
  person: 'set for this person',
  role: 'from their role',
  estate: 'compliance sees every company',
  none: 'their role has no report permission',
};

function Fact({ icon: Icon, label, value, note, tone }) {
  return (
    <div className="rounded-xl px-3 py-2.5 min-w-0" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
      <p className="text-[10px] font-bold uppercase tracking-wider m-0 leading-none flex items-center gap-1" style={{ color: 'var(--color-text-secondary)' }}>
        <Icon size={11} /> {label}
      </p>
      <p className="text-sm font-bold m-0 mt-1.5" style={{ color: tone || 'var(--color-text)' }}>{value}</p>
      {note && <p className="text-[11px] m-0 mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>{note}</p>}
    </div>
  );
}

export default function ReportsSection({ account }) {
  const userId = account?.user_id;
  const [data, setData] = useState(null);
  const [allowed, setAllowed] = useState(true);
  const [view, setView] = useState('role');
  const [amounts, setAmounts] = useState('role');
  const [pickCompanies, setPickCompanies] = useState(false);
  const [picked, setPicked] = useState([]);
  const [saving, setSaving] = useState(false);
  const { msg, flash, clear } = useFlash();

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const r = await client.get(`company-reports/access/${userId}`);
      const o = r.data.override || {};
      setData(r.data);
      setView(toKey(o.can_view));
      setAmounts(toKey(o.show_amounts));
      setPickCompanies(!!o.company_ids);
      setPicked(o.company_ids || []);
      setAllowed(true);
    } catch (e) {
      if (e.response?.status === 403) setAllowed(false);
      setData(null);
    }
  }, [userId]);

  useEffect(() => { setData(null); load(); }, [load]);

  const own = useMemo(() => (data?.memberships || []).map(m => m.company).filter(Boolean), [data]);
  const role = data?.role_only;
  const sameSet = (a, b) => [...a].sort().join() === [...b].sort().join();
  const dirty = !!data && (
    toKey(data.override.can_view) !== view
    || toKey(data.override.show_amounts) !== amounts
    || (view === 'on' && (!!data.override.company_ids !== pickCompanies
      || (pickCompanies && !sameSet(picked, data.override.company_ids || []))))
  );

  const save = async () => {
    if (view === 'on' && pickCompanies && picked.length === 0) {
      flash('error', 'Pick at least one company, or choose "Their own companies".');
      return;
    }
    setSaving(true); clear();
    try {
      await client.put(`company-reports/access/${userId}`, {
        can_view: fromKey(view),
        show_amounts: fromKey(amounts),
        company_ids: view === 'on' && pickCompanies ? picked : null,
      });
      await load();
      flash('success', 'Saved. It applies the next time their screen loads the reports (within a minute).');
    } catch (e) {
      flash('error', e.response?.data?.error || 'Could not save.');
    } finally { setSaving(false); }
  };

  if (!allowed) return <EmptyState icon={BarChart3} title="Superadmin only" hint="Only a superadmin can decide who sees Company Reports." />;
  if (!data) return <Loading />;

  const eff = data.effective;
  return (
    <div className="space-y-5">
      <SectionHeader icon={BarChart3} title="Company Reports"
        subtitle="Whether this person can open the per-agent reports, for which companies, and whether they see the payment amounts in them." />

      {/* ── what they get right now ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <Fact icon={BarChart3} label="Can open reports" value={eff.can_view ? 'Yes' : 'No'}
          tone={eff.can_view ? accent('success').fg : accent('danger').fg} note={SOURCE[eff.view_source]} />
        <Fact icon={Building2} label="Companies" value={eff.can_view ? companiesText(eff.companies) : '—'} />
        <Fact icon={DollarSign} label="Sees payment amounts" value={eff.can_view ? yesNo(eff.amounts) : '—'}
          tone={eff.can_view && eff.amounts === true ? accent('success').fg : undefined}
          note={eff.can_view ? (eff.amounts_source === 'person' ? 'set for this person' : 'from their role (view_financial_data)') : null} />
      </div>

      {/* ── 1. may they open it ── */}
      <Panel tone="inset" pad="md" className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-bold m-0" style={{ color: 'var(--color-text)' }}>Company Reports</p>
            <p className="text-xs m-0 mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
              Role decides today: <b>{role?.can_view ? `yes — ${companiesText(role.companies)}` : 'no'}</b>
              {own.length > 0 && <> · member of {own.join(', ')}</>}
            </p>
          </div>
          <TriSwitch value={view} onPick={setView} labels={{ on: 'On', off: 'Off' }} />
        </div>

        {view === 'on' && (
          <div className="pt-3 space-y-2" style={{ borderTop: '1px solid var(--color-border)' }}>
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
              <input type="radio" checked={!pickCompanies} onChange={() => setPickCompanies(false)} style={{ accentColor: 'var(--color-primary-600)' }} />
              Their own companies{own.length ? ` (${own.join(', ')})` : ''}
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
              <input type="radio" checked={pickCompanies} onChange={() => setPickCompanies(true)} style={{ accentColor: 'var(--color-primary-600)' }} />
              Only the companies I pick (may include companies they are not a member of)
            </label>
            {pickCompanies && (
              <div className="ml-6 grid grid-cols-1 sm:grid-cols-2 gap-x-4 rounded-xl px-3 py-1" style={{ border: '1px solid var(--color-border)' }}>
                {(data.companies || []).map(c => (
                  <CheckRow key={c.id} label={c.name} hint={c.company_type}
                    checked={picked.includes(c.id)}
                    onChange={(on) => setPicked(p => (on ? [...p, c.id] : p.filter(x => x !== c.id)))} />
                ))}
              </div>
            )}
          </div>
        )}
      </Panel>

      {/* ── 2. do they see the money ── */}
      <Panel tone="inset" pad="md">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-bold m-0" style={{ color: 'var(--color-text)' }}>Payment amounts in the reports</p>
            <p className="text-xs m-0 mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
              Down payments, monthly book, average deal and the money rankings. Hide = counts only.
              Role decides today: <b>{yesNo(role?.can_view ? role.amounts : false)}</b>.
            </p>
            <p className="text-[11px] m-0 mt-1 flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}>
              <Info size={11} /> Only affects Company Reports — money elsewhere in the CRM still follows their permissions.
            </p>
          </div>
          <TriSwitch value={amounts} onPick={setAmounts} labels={{ on: 'Show', off: 'Hide' }} />
        </div>
      </Panel>

      <div className="flex items-center gap-3 flex-wrap">
        <button type="button" onClick={save} disabled={!dirty || saving}
          className="btn btn-primary text-sm disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        {dirty && <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Unsaved changes</span>}
        {msg && <span className="text-xs font-semibold" style={{ color: msg.type === 'error' ? accent('danger').fg : accent('success').fg }}>{msg.text}</span>}
      </div>
    </div>
  );
}
