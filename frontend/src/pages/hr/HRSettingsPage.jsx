// ============================================================================
// HR -> Settings. Every rule HR follows for this company, editable, in one
// place (hr_settings, mig 314; read through utils/hrSettings.js).
//
// Sections are added by each stage rather than hardcoded somewhere else:
//   People from the CRM   (stage 2) who gets an HR record automatically, the
//                         employee-number prefix, whether a switched-off login
//                         opens a "confirm exit" case
//   Attendance            (stage 4) the dialer-sync rules, holidays, re-sync
//                         -- AttendanceRulesPanel.jsx
// Every save lands in the change record (mig 313) with who changed it.
// ============================================================================
import { useEffect, useState } from 'react';
import { Settings, Save, RefreshCw, UserPlus } from 'lucide-react';
import client from '../../api/client';
import { Panel, SectionHeader, Loading, EmptyState, Field, Toggle, CheckRow, TableScroll } from '../../components/UI/kit';
import { Alert } from '../../components/UI';
import { Btn } from '../../components/Modules/ModuleUI';
import { HistoryButton } from '../../components/Modules/RecordHistory';
import { fmtDate } from '../../utils/money';
import AttendanceRulesPanel from './AttendanceRulesPanel';

const LEVEL_WORDS = {
  trainee: 'Trainees', fronter: 'Fronters', closer: 'Closers', fronter_manager: 'Fronter managers',
  closer_manager: 'Closer managers', compliance_manager: 'Compliance managers', company_admin: 'Company admins',
  operations_manager: 'Operations managers', qa_agent: 'QA agents', qa_manager: 'QA managers',
  manager: 'Managers', operations: 'Operations', accountant: 'Accountants', hr_manager: 'HR managers', employee: 'Employees',
};

const ACTION_WORDS = {
  will_create: 'Will be added', created: 'Added', role_not_enrolled: 'Role not included',
  auto_enroll_off: 'Automatic adding is off', not_staff: 'Not staff', skipped: 'Skipped',
};

export default function HRSettingsPage({ scope }) {
  // Someone who runs attendance but not the employee records sees only the
  // attendance section -- the people settings would 403 for them.
  if (!scope?.permissions?.['hr.employees.view']) {
    return (
      <div className="space-y-4">
        <SectionHeader level="page" icon={Settings} title="HR settings" subtitle="Attendance rules for this company." />
        <AttendanceRulesPanel scope={scope} />
      </div>
    );
  }
  return <PeopleAndAttendanceSettings scope={scope} />;
}

function PeopleAndAttendanceSettings({ scope }) {
  const companyId = scope?.company_id || null;
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [preview, setPreview] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const load = async () => {
    const r = await client.get('hr/people/settings', { params: { company_id: companyId || undefined } });
    setData(r.data);
    setForm({
      auto_enroll: r.data.settings.auto_enroll,
      enroll_role_levels: r.data.settings.enroll_role_levels || [],
      employee_no_prefix: r.data.settings.employee_no_prefix,
      exit_prompt: r.data.settings.exit_prompt,
    });
  };

  useEffect(() => {
    load().catch(e => setNotice({ type: 'error', text: e.response?.data?.error || 'Could not load the settings' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  if (!data || !form) return notice ? <Alert type={notice.type}>{notice.text}</Alert> : <Loading variant="cards" cards={2} />;
  const canManage = !!data.can_manage;
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const allRoles = form.enroll_role_levels.length === 0;
  const toggleLevel = (lvl, on) => {
    const cur = new Set(allRoles ? data.role_levels.map(r => r.level) : form.enroll_role_levels);
    if (on) cur.add(lvl); else cur.delete(lvl);
    // Every level ticked = "everyone", stored as an empty list so a role added
    // later is included without anyone remembering to tick it.
    const next = [...cur];
    set('enroll_role_levels', next.length === data.role_levels.length ? [] : next);
  };

  const save = async () => {
    setSaving(true); setNotice(null);
    try {
      await client.put('hr/people/settings', { company_id: companyId, ...form });
      await load();
      setNotice({ type: 'success', text: 'Settings saved. The change is in the change log.' });
    } catch (e) {
      setNotice({ type: 'error', text: e.response?.data?.error || 'Could not save the settings' });
    } finally { setSaving(false); }
  };

  const checkMissing = async () => {
    setSyncing(true); setNotice(null);
    try {
      const r = await client.get('hr/people/sync', { params: { company_id: companyId || undefined } });
      setPreview(r.data);
    } catch (e) {
      setNotice({ type: 'error', text: e.response?.data?.error || 'Could not check' });
    } finally { setSyncing(false); }
  };

  const addMissing = async () => {
    setSyncing(true); setNotice(null);
    try {
      const r = await client.post('hr/people/sync', { company_id: companyId });
      setPreview(r.data);
      setNotice({ type: 'success', text: `${r.data.created} ${r.data.created === 1 ? 'person was' : 'people were'} added to HR.` });
    } catch (e) {
      setNotice({ type: 'error', text: e.response?.data?.error || 'Could not add them' });
    } finally { setSyncing(false); }
  };

  return (
    <div className="space-y-4">
      <SectionHeader level="page" icon={Settings} title="HR settings"
        subtitle="The rules HR follows for this company. Change them any time -- every change is recorded." />
      {notice && <Alert type={notice.type} onDismiss={() => setNotice(null)}>{notice.text}</Alert>}

      <Panel>
        <SectionHeader title="People from the CRM"
          subtitle={data.settings.is_default ? 'Using the default rules' : `Last changed ${fmtDate(data.settings.updated_at)}`}
          actions={!data.settings.is_default && (
            <HistoryButton module="hr" table="hr_settings" id={companyId} companyId={companyId} title="History -- HR settings" />
          )} />

        <div className="space-y-4">
          <Toggle checked={form.auto_enroll} disabled={!canManage} onChange={v => set('auto_enroll', v)}
            label="Give every new CRM login an HR record automatically"
            hint="Their start date is the day their login was added to this company." />

          <Field as="div" label="Which roles are added"
            hint={allRoles ? 'Every role (roles added later are included too).' : 'Only the ticked roles.'}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4">
              {data.role_levels.map(r => (
                <CheckRow key={r.level} disabled={!canManage || !form.auto_enroll}
                  checked={allRoles || form.enroll_role_levels.includes(r.level)}
                  onChange={on => toggleLevel(r.level, on)}
                  label={LEVEL_WORDS[r.level] || r.level.replace(/_/g, ' ')} hint={r.names.join(', ')} />
              ))}
            </div>
          </Field>

          <Field label="Employee number starts with" hint="New numbers continue from the highest one with this start, e.g. EMP-00042.">
            <input className="input w-full sm:w-48" maxLength={12} disabled={!canManage}
              value={form.employee_no_prefix} onChange={e => set('employee_no_prefix', e.target.value)} />
          </Field>

          <Toggle checked={form.exit_prompt} disabled={!canManage} onChange={v => set('exit_prompt', v)}
            label="When a CRM login is switched off, ask HR to confirm the exit"
            hint="Nobody is ever marked as leaving automatically -- this only puts them on the 'Waiting for you' list." />

          {canManage && (
            <div className="flex justify-end">
              <Btn variant="primary" icon={Save} busy={saving} onClick={save}>Save settings</Btn>
            </div>
          )}
        </div>
      </Panel>

      {/* Attendance rules have their own permission (hr.attendance.*), so an
          HR manager without employee-management rights still sees them. */}
      {!!scope?.permissions?.['hr.attendance.view_team'] && <AttendanceRulesPanel scope={scope} />}

      {canManage && (
        <Panel>
          <SectionHeader title="People not in HR yet"
            subtitle="Check for CRM logins in this company that have no HR record, then add them in one go."
            actions={<Btn icon={RefreshCw} busy={syncing} onClick={checkMissing}>Check now</Btn>} />
          {!preview && <p className="text-sm m-0" style={{ color: 'var(--color-text-secondary)' }}>Press "Check now" to see who is missing.</p>}
          {preview && preview.rows.length === 0 && (
            <EmptyState compact icon={UserPlus} title="Everyone is in HR" hint="Every active CRM login in this company has an HR record." />
          )}
          {preview && preview.rows.length > 0 && (
            <>
              <div className="flex items-center gap-3 flex-wrap mb-3">
                {Object.entries(preview.counts || {}).map(([k, n]) => (
                  <span key={k} className="text-xs font-semibold px-2 py-1 rounded-full"
                    style={{ background: 'color-mix(in srgb, var(--color-primary-600) 10%, transparent)', color: 'var(--color-text)' }}>
                    {ACTION_WORDS[k] || k}: {n}
                  </span>
                ))}
                {(preview.counts?.will_create || 0) > 0 && (
                  <Btn variant="primary" icon={UserPlus} busy={syncing} className="ml-auto" onClick={addMissing}>
                    Add {preview.counts.will_create} to HR
                  </Btn>
                )}
              </div>
              <TableScroll>
                <table className="w-full">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                      {['Name', 'CRM role', 'In the CRM since', 'What happens'].map(h => (
                        <th key={h} className="td-p text-[11px] font-bold uppercase tracking-wider text-left" style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map(r => (
                      <tr key={r.user_id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td className="td-p text-sm" style={{ color: 'var(--color-text)' }}>{r.full_name || 'No name on the login'}</td>
                        <td className="td-p text-sm" style={{ color: 'var(--color-text-secondary)' }}>{r.role_name}</td>
                        <td className="td-p text-sm" style={{ color: 'var(--color-text-secondary)' }}>{fmtDate(r.member_since)}</td>
                        <td className="td-p text-sm" style={{ color: 'var(--color-text)' }}>{ACTION_WORDS[r.action] || r.action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            </>
          )}
        </Panel>
      )}
    </div>
  );
}
