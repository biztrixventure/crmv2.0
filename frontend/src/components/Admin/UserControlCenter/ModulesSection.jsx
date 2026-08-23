// ModulesSection -- who ALSO works as the accountant or the HR manager, and
// FOR WHICH COMPANIES.
//
// This is the control the whole designation design exists for. Nobody is going
// to be given the accountant or hr_manager ROLE: the people who do these jobs
// already hold compliance_manager, company_admin or operations_manager, and
// changing their role would change their shell and their permissions. So the
// superadmin flips a switch here instead and their existing access is untouched
// -- exactly how the quality-manager designation works (mig 227).
//
// The company list (mig 293) is what makes it useful rather than decorative.
// The job is routinely cross-tenant: a compliance manager who belongs to
// 1-Vertex may be the person who runs HR and the books for Wavetech Infomatics.
// Leaving the list empty keeps the older meaning -- they act in the companies
// they already belong to -- so this section says that out loud rather than
// leaving an empty list looking like a mistake.
//
// Both switches are independent. One person can be the accountant, the HR
// manager, both, or neither, each with its own set of companies.
//
// Superadmin only. A non-superadmin viewer gets a 403 from the endpoint, and
// the section simply does not render its switches rather than showing dead ones.
import { useState, useEffect, useCallback } from 'react';
import { Scale, IdCard, Layers, Building2 } from 'lucide-react';
import client from '../../../api/client';
import { Alert } from '../../../components/UI';
import { Panel, SectionHeader, Loading, Toggle, CheckRow, useFlash } from '../../UI/kit';

const MODULES = [
  {
    key: 'accounting',
    icon: Scale,
    title: 'Accounting',
    label: 'This user also works as the accountant',
    hint: 'Opens /accounting in full -- chart of accounts, journal, invoices, expenses and reports -- without changing their role, their shell or any permission they already have.',
  },
  {
    key: 'hr',
    icon: IdCard,
    title: 'HR',
    label: 'This user also works as the HR manager',
    hint: 'Opens /hr in full -- people, attendance, leave, payroll and performance reviews -- without changing their role, their shell or any permission they already have.',
  },
];

export default function ModulesSection({ account }) {
  const userId = account?.user_id;
  const [held, setHeld] = useState([]);
  const [scope, setScope] = useState({});          // module -> [company_id]
  const [allCompanies, setAllCompanies] = useState([]);
  const [memberIds, setMemberIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(true);
  const [busy, setBusy] = useState(null);
  const { msg, flash, clear } = useFlash();

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const r = await client.get(`module-designations/user/${userId}`);
      setHeld(r.data.modules || []);
      setScope(r.data.companies || {});
      setAllCompanies(r.data.all_companies || []);
      setMemberIds(r.data.member_company_ids || []);
      setAllowed(true);
    } catch (e) {
      // 403 = the viewer is not a superadmin. Hide the switches rather than
      // rendering controls that cannot work.
      if (e.response?.status === 403) setAllowed(false);
      setHeld([]);
    } finally { setLoading(false); }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  // One writer for both the toggle and the company checkboxes, so the two can
  // never disagree about what was just saved.
  const save = async (mod, enabled, companyIds) => {
    setBusy(mod);
    try {
      const body = { user_id: userId, module: mod, enabled };
      if (Array.isArray(companyIds)) body.company_ids = companyIds;
      const r = await client.put('module-designations', body);
      setHeld(r.data.modules || []);
      setScope(s => ({ ...s, [mod]: r.data.companies || [] }));

      const n = (r.data.companies || []).length;
      flash('success', !enabled
        ? `${mod.charAt(0).toUpperCase() + mod.slice(1)} access removed. Their company choices and anything they created are kept.`
        : n
          ? `Saved. They can now run ${mod} for ${n} ${n === 1 ? 'company' : 'companies'} -- their own role and permissions are unchanged.`
          : `Saved. With no company picked they act as ${mod} only in the companies they already belong to.`);
    } catch (e) {
      flash('error', e.response?.data?.error || 'Save failed.');
    } finally { setBusy(null); }
  };

  const toggleCompany = (mod, companyId) => {
    const current = scope[mod] || [];
    const next = current.includes(companyId)
      ? current.filter(id => id !== companyId)
      : [...current, companyId];
    // Picking a company implies the designation itself -- otherwise the choice
    // silently does nothing until a second click on the switch.
    save(mod, true, next);
  };

  if (loading) return <Loading variant="rows" rows={4} label="Loading module access" />;

  if (!allowed) {
    return (
      <div className="max-w-2xl">
        <SectionHeader icon={Layers} title="Modules" />
        <Alert type="info" dismissible={false}>
          Only a superadmin can grant Accounting or HR module access.
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <SectionHeader icon={Layers} title="Modules"
        subtitle="Extra jobs this person does, on top of the role they already hold" />
      {msg && <Alert type={msg.type} onDismiss={clear}>{msg.text}</Alert>}

      <p className="text-[11px] m-0" style={{ color: 'var(--color-text-secondary)' }}>
        These are designations, not roles. Turning one on grants that module in full and changes nothing else --
        the user keeps their current shell, role level and permissions. Pick the companies they run it for; those
        can be companies they do not otherwise belong to. Turning one off only closes the module; the records they
        created there stay exactly as they are.
      </p>

      {MODULES.map(m => {
        const on = held.includes(m.key);
        const picked = scope[m.key] || [];
        return (
          <Panel key={m.key} tone="inset" radius="xl">
            <SectionHeader level="sub" icon={m.icon} title={m.title}
              actions={busy === m.key ? <Loading variant="inline" size={13} /> : null} />
            <Toggle
              checked={on}
              onChange={(next) => save(m.key, next)}
              busy={busy === m.key}
              label={m.label}
              hint={m.hint} />

            {on && (
              <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Building2 size={13} style={{ color: 'var(--color-text-tertiary)' }} />
                  <span className="text-[11px] font-bold uppercase tracking-wider"
                    style={{ color: 'var(--color-text-secondary)' }}>
                    Companies they run {m.title.toLowerCase()} for
                  </span>
                </div>
                <p className="text-[11px] m-0 mb-2" style={{ color: 'var(--color-text-tertiary)' }}>
                  {picked.length === 0
                    ? 'None picked, so this applies only to the companies they already belong to. Tick a company to extend it beyond that.'
                    : `${picked.length} picked. Only these count -- membership elsewhere still works as it always did.`}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                  {allCompanies.map(c => (
                    <CheckRow key={c.id}
                      label={c.name}
                      checked={picked.includes(c.id)}
                      busy={busy === m.key}
                      onChange={() => toggleCompany(m.key, c.id)}
                      trailing={memberIds.includes(c.id)
                        ? <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>member</span>
                        : null} />
                  ))}
                </div>
                {allCompanies.length === 0 && (
                  <p className="text-[11px] m-0" style={{ color: 'var(--color-text-tertiary)' }}>No active companies.</p>
                )}
              </div>
            )}
          </Panel>
        );
      })}
    </div>
  );
}
