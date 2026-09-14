// ============================================================================
// HR -> People -> "Leavers waiting for you".
//
// When a CRM login is switched off or removed, the mig 314 trigger opens an
// exit case instead of guessing. This panel is HR's side of it:
//   Confirm  -> resigned or let go, last working day, reason, rehire?
//   Not leaving -> dismiss with a note ("login paused during leave")
// Confirming sets the employee's status and last day; the change record keeps
// the reason. Renders nothing when nothing is waiting.
// ============================================================================
import { useCallback, useEffect, useState } from 'react';
import { DoorOpen, Check, X } from 'lucide-react';
import client from '../../api/client';
import { Panel, SectionHeader, Field } from '../../components/UI/kit';
import { Alert } from '../../components/UI';
import ThemedSelect from '../../components/UI/Select';
import ThemedDate from '../../components/UI/ThemedDate';
import { Btn, ModuleModal } from '../../components/Modules/ModuleUI';
import { fmtDate, todayISO } from '../../utils/money';

const TRIGGER_WORDS = {
  crm_deactivated: 'CRM login switched off',
  crm_removed: 'Removed from the company in the CRM',
  manual: 'Opened by HR',
};

export default function ExitCasesPanel({ companyId, onChanged }) {
  const [exits, setExits] = useState([]);
  const [canManage, setCanManage] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const [dismissing, setDismissing] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await client.get('hr/people/exits', { params: { company_id: companyId || undefined } });
      setExits(r.data.exits || []);
      setCanManage(!!r.data.can_manage);
    } catch { setExits([]); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  if (!exits.length && !notice) return null;

  const name = (e) => [e.hr_employees?.first_name, e.hr_employees?.last_name].filter(Boolean).join(' ') || e.hr_employees?.employee_no;

  return (
    <Panel tone="surface">
      <SectionHeader icon={DoorOpen} title="Leavers waiting for you"
        subtitle="Their CRM login was switched off or removed. Confirm whether they have left -- nobody is marked as leaving until you do." />
      {notice && <Alert type={notice.type} onDismiss={() => setNotice(null)} className="mb-3">{notice.text}</Alert>}
      <ul className="m-0 p-0 list-none">
        {exits.map(e => (
          <li key={e.id} className="flex items-center gap-3 py-2 flex-wrap" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold m-0" style={{ color: 'var(--color-text)' }}>{name(e)}</p>
              <p className="text-xs m-0" style={{ color: 'var(--color-text-secondary)' }}>
                {TRIGGER_WORDS[e.trigger] || e.trigger} · {fmtDate(e.opened_at)}
                {e.hr_employees?.hire_date ? ` · started ${fmtDate(e.hr_employees.hire_date)}` : ''}
              </p>
            </div>
            {canManage && (
              <div className="flex items-center gap-2">
                <Btn size="sm" icon={X} onClick={() => setDismissing(e)}>Not leaving</Btn>
                <Btn size="sm" variant="primary" icon={Check} onClick={() => setConfirming(e)}>Confirm exit</Btn>
              </div>
            )}
          </li>
        ))}
      </ul>

      {confirming && (
        <ConfirmExitDialog exit={confirming} name={name(confirming)} onClose={() => setConfirming(null)}
          onSubmit={async (payload) => {
            try {
              await client.post(`hr/people/exits/${confirming.id}/confirm`, { company_id: companyId, ...payload });
              setConfirming(null);
              setNotice({ type: 'success', text: `${name(confirming)} is recorded as ${payload.exit_type === 'resigned' ? 'resigned' : 'let go'}.` });
              await load(); onChanged?.();
            } catch (err) {
              setNotice({ type: 'error', text: err.response?.data?.error || 'Could not confirm the exit.' });
            }
          }} />
      )}

      {dismissing && (
        <DismissDialog name={name(dismissing)} onClose={() => setDismissing(null)}
          onSubmit={async (note) => {
            try {
              await client.post(`hr/people/exits/${dismissing.id}/dismiss`, { company_id: companyId, note });
              setDismissing(null);
              setNotice({ type: 'success', text: `${name(dismissing)} stays on the team.` });
              await load(); onChanged?.();
            } catch (err) {
              setNotice({ type: 'error', text: err.response?.data?.error || 'Could not update the case.' });
            }
          }} />
      )}
    </Panel>
  );
}

function ConfirmExitDialog({ name, onClose, onSubmit }) {
  const [form, setForm] = useState({ exit_type: 'resigned', last_day: todayISO(), reason: '', eligible_for_rehire: 'yes' });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  return (
    <ModuleModal title={`Confirm exit -- ${name}`} subtitle="This sets their status and last day. It is kept in their history with your reason."
      onClose={onClose}
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" icon={Check} busy={busy} disabled={!form.last_day}
          onClick={async () => { setBusy(true); await onSubmit({ ...form, eligible_for_rehire: form.eligible_for_rehire === 'yes' }); setBusy(false); }}>
          Confirm exit
        </Btn>
      </>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="What happened">
          <ThemedSelect value={form.exit_type} onChange={e => set('exit_type', e.target.value)}>
            <option value="resigned">They resigned</option>
            <option value="terminated">The company let them go</option>
          </ThemedSelect>
        </Field>
        <Field label="Last working day">
          <ThemedDate value={form.last_day} onChange={e => set('last_day', e.target.value)} />
        </Field>
        <Field label="Can be rehired later?">
          <ThemedSelect value={form.eligible_for_rehire} onChange={e => set('eligible_for_rehire', e.target.value)}>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </ThemedSelect>
        </Field>
        <Field label="Reason" className="sm:col-span-2">
          <textarea className="input w-full" rows={2} maxLength={500} value={form.reason}
            onChange={e => set('reason', e.target.value)} placeholder="e.g. Found another job; attendance issues" />
        </Field>
      </div>
    </ModuleModal>
  );
}

function DismissDialog({ name, onClose, onSubmit }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <ModuleModal title={`${name} is not leaving`} subtitle="Say why the login was switched off, so the next person reading the history knows."
      onClose={onClose}
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" busy={busy} disabled={!note.trim()}
          onClick={async () => { setBusy(true); await onSubmit(note.trim()); setBusy(false); }}>Keep on the team</Btn>
      </>}>
      <Field label="Why">
        <textarea className="input w-full" rows={2} maxLength={500} value={note} onChange={e => setNote(e.target.value)}
          placeholder="e.g. On leave -- login paused until they return" />
      </Field>
    </ModuleModal>
  );
}
