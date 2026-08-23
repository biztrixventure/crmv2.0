// ModulesSection -- who ALSO works as the accountant or the HR manager.
//
// This is the control the whole designation design exists for. Nobody is going
// to be given the accountant or hr_manager ROLE: the people who do these jobs
// already hold compliance_manager, company_admin or operations_manager, and
// changing their role would change their shell and their permissions. So the
// superadmin flips a switch here instead and their existing access is untouched
// -- exactly how the quality-manager designation works (mig 227).
//
// Both switches are independent. One person can be the accountant, the HR
// manager, both, or neither.
//
// Superadmin only. A non-superadmin viewer gets a 403 from the endpoint, and
// the section simply does not render its switches rather than showing dead ones.
import { useState, useEffect, useCallback } from 'react';
import { Scale, IdCard, Layers } from 'lucide-react';
import client from '../../../api/client';
import { Alert } from '../../../components/UI';
import { Panel, SectionHeader, Loading, Toggle, useFlash } from '../../UI/kit';

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
      setAllowed(true);
    } catch (e) {
      // 403 = the viewer is not a superadmin. Hide the switches rather than
      // rendering controls that cannot work.
      if (e.response?.status === 403) setAllowed(false);
      setHeld([]);
    } finally { setLoading(false); }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const save = async (mod, enabled) => {
    setBusy(mod);
    try {
      const r = await client.put('module-designations', { user_id: userId, module: mod, enabled });
      setHeld(r.data.modules || []);
      flash('success', enabled
        ? `Designated for ${mod}. They can reach it now -- their existing role and permissions are unchanged.`
        : `${mod.charAt(0).toUpperCase() + mod.slice(1)} access removed. Anything they created there is kept.`);
    } catch (e) {
      flash('error', e.response?.data?.error || 'Save failed.');
    } finally { setBusy(null); }
  };

  if (loading) return <Loading variant="rows" rows={3} label="Loading module access" />;

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
        the user keeps their current shell, role level and permissions. Turning one off only closes the module;
        the records they created there stay exactly as they are.
      </p>

      {MODULES.map(m => (
        <Panel key={m.key} tone="inset" radius="xl">
          <SectionHeader level="sub" icon={m.icon} title={m.title}
            actions={busy === m.key ? <Loading variant="inline" size={13} /> : null} />
          <Toggle
            checked={held.includes(m.key)}
            onChange={(next) => save(m.key, next)}
            busy={busy === m.key}
            label={m.label}
            hint={m.hint} />
        </Panel>
      ))}
    </div>
  );
}
