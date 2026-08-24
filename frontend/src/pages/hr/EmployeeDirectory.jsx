// ============================================================================
// HR -> Employee directory, and the profile view behind it.
//
// The list endpoint serves two audiences from one payload: without
// hr.employees.manage the sensitive columns (salary, date of birth, address,
// emergency contact) are simply ABSENT from the response, not blanked here. So
// this page renders what it was given -- it never has the data to leak, which
// is a stronger guarantee than a conditional render.
//
// Deleting is refused once someone has HR history; the server says so and says
// to terminate instead. That refusal is shown as written, because it is the
// instruction, not an error.
// ============================================================================
import { useState, useEffect } from 'react';
import {
  Users, Plus, Search, Building2, Briefcase, Mail, Phone, Trash2, Pencil, ArrowLeft, UserCheck,
} from 'lucide-react';
import { Panel, SectionHeader, Loading, EmptyState, Field, KpiTile, TableScroll, PillTabs } from '../../components/UI/kit';
import { Alert } from '../../components/UI';
import ThemedSelect from '../../components/UI/Select';
import SearchSelect from '../../components/UI/SearchSelect';
import { Btn, StatusPill, ModuleModal } from '../../components/Modules/ModuleUI';
import { useEmployees } from '../../hooks/useEmployees';
import { fmtMoney, fmtDate, CURRENCIES } from '../../utils/money';

const fullName = (e) => [e?.first_name, e?.last_name].filter(Boolean).join(' ') || 'Unnamed';

export default function EmployeeDirectory({ scope }) {
  const companyId = scope?.company_id || null;
  const {
    employees, departments, positions, canManage, myEmployeeId, loading, error,
    fetchEmployees, fetchEmployee, createEmployee, updateEmployee, deleteEmployee,
    fetchDepartments, saveDepartment, deleteDepartment,
    fetchPositions, savePosition, deletePosition, fetchLinkableUsers,
  } = useEmployees(companyId);

  const [tab, setTab] = useState('people');
  const [search, setSearch] = useState('');
  const [dept, setDept] = useState('');
  const [editing, setEditing] = useState(null);
  const [profile, setProfile] = useState(null);
  const [linkable, setLinkable] = useState([]);
  const [notice, setNotice] = useState(null);

  useEffect(() => { fetchDepartments(); fetchPositions(); }, [fetchDepartments, fetchPositions]);
  useEffect(() => {
    fetchEmployees({ search: search || undefined, department_id: dept || undefined });
  }, [fetchEmployees, search, dept]);
  // Refetched whenever the open editor changes, passing that employee's current
  // user so their existing link is present in the options.
  useEffect(() => {
    if (!canManage) return;
    fetchLinkableUsers(editing?.user_id || null).then(setLinkable);
  }, [canManage, fetchLinkableUsers, editing?.id, editing?.user_id]);

  const openProfile = async (id) => {
    const d = await fetchEmployee(id);
    if (d) setProfile(d);
  };

  const onDelete = async (e) => {
    if (!window.confirm(`Delete ${fullName(e)}?`)) return;
    setNotice(null);
    try {
      await deleteEmployee(e.id);
      setNotice({ type: 'success', text: 'Employee deleted.' });
    } catch (err) {
      setNotice({ type: 'warning', text: err.response?.data?.error || 'Could not delete this employee.' });
    }
  };

  const active = employees.filter(e => e.status === 'active').length;
  const onLeave = employees.filter(e => e.status === 'on_leave').length;

  if (profile) {
    return <EmployeeProfile data={profile} canManage={canManage} onBack={() => setProfile(null)}
      onEdit={() => { setEditing(profile.employee); setProfile(null); }} />;
  }

  return (
    <div className="space-y-4">
      <SectionHeader level="page" icon={Users} title="People"
        subtitle={scope?.company_name || undefined}
        actions={canManage ? <Btn variant="primary" icon={Plus} onClick={() => setEditing({})}>New employee</Btn> : null} />

      {error && <Alert type="error">{error}</Alert>}
      {notice && <Alert type={notice.type} onDismiss={() => setNotice(null)}>{notice.text}</Alert>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile icon={Users} label="Employees" value={employees.length} tone="primary" />
        <KpiTile icon={UserCheck} label="Active" value={active} tone="success" />
        <KpiTile label="On leave" value={onLeave} tone={onLeave ? 'warning' : 'muted'} />
        <KpiTile icon={Building2} label="Departments" value={departments.length} tone="info" />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <PillTabs value={tab} onChange={setTab} items={[
          { key: 'people', label: 'Directory', icon: Users },
          { key: 'org', label: 'Departments and roles', icon: Building2 },
        ]} />
        {tab === 'people' && (
          <>
            <ThemedSelect value={dept} onChange={e => setDept(e.target.value)}>
              <option value="">All departments</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </ThemedSelect>
            <div className="relative ml-auto">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
              <input className="input pl-8" placeholder="Name, employee no, email" value={search}
                onChange={e => setSearch(e.target.value)} style={{ minWidth: 220 }} />
            </div>
          </>
        )}
      </div>

      {tab === 'org' ? (
        <OrgTab departments={departments} positions={positions} canManage={canManage}
          onSaveDept={saveDepartment} onDeleteDept={deleteDepartment}
          onSavePos={savePosition} onDeletePos={deletePosition}
          onNotice={setNotice} />
      ) : (
        loading && employees.length === 0 ? <Loading variant="table" rows={6} label="Loading the directory" /> : (
          employees.length === 0 ? (
            <EmptyState icon={Users} title="Nobody here yet"
              hint={canManage
                ? 'Add people one at a time, or link an existing CRM user to a new employee record.'
                : 'No employee records have been created for this company.'}
              action={canManage ? <Btn variant="primary" icon={Plus} onClick={() => setEditing({})}>New employee</Btn> : null} />
          ) : (
            <Panel pad="none">
              <TableScroll stickyFirst>
                <table className="w-full">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                      {['Name', 'Employee no', 'Department', 'Position', 'Contact', 'Hired', 'Status', ''].map((h, i) => (
                        <th key={h + i} className="td-p text-[11px] font-bold uppercase tracking-wider text-left"
                          style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map(e => (
                      <tr key={e.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td className="td-p">
                          <button onClick={() => openProfile(e.id)} className="text-sm font-semibold text-left"
                            style={{ color: 'var(--color-primary-600)' }}>
                            {fullName(e)}
                          </button>
                          {e.id === myEmployeeId && (
                            <span className="ml-1.5 text-[10px] font-bold uppercase" style={{ color: 'var(--color-text-tertiary)' }}>you</span>
                          )}
                        </td>
                        <td className="td-p text-xs font-mono" style={{ color: 'var(--color-text-secondary)' }}>{e.employee_no}</td>
                        <td className="td-p text-xs" style={{ color: 'var(--color-text-secondary)' }}>{e.hr_departments?.name || '--'}</td>
                        <td className="td-p text-xs" style={{ color: 'var(--color-text-secondary)' }}>{e.hr_positions?.title || '--'}</td>
                        <td className="td-p text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                          {e.work_email && <span className="flex items-center gap-1"><Mail size={11} />{e.work_email}</span>}
                          {e.phone && <span className="flex items-center gap-1"><Phone size={11} />{e.phone}</span>}
                          {!e.work_email && !e.phone && '--'}
                        </td>
                        <td className="td-p text-xs" style={{ color: 'var(--color-text-secondary)' }}>{fmtDate(e.hire_date)}</td>
                        <td className="td-p"><StatusPill status={e.status} /></td>
                        <td className="td-p">
                          {canManage && (
                            <div className="flex items-center gap-1.5 justify-end">
                              <Btn size="sm" icon={Pencil} onClick={() => setEditing(e)}>Edit</Btn>
                              <Btn size="sm" variant="danger" icon={Trash2} onClick={() => onDelete(e)}>Delete</Btn>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            </Panel>
          )
        )
      )}

      {editing && (
        <EmployeeEditor employee={editing} departments={departments} positions={positions}
          colleagues={employees} linkable={linkable}
          onClose={() => setEditing(null)}
          onSave={async (payload) => {
            setNotice(null);
            try {
              if (editing.id) await updateEmployee(editing.id, payload);
              else await createEmployee(payload);
              setEditing(null);
              setNotice({ type: 'success', text: 'Saved.' });
            } catch (e) {
              setNotice({ type: 'error', text: e.response?.data?.error || 'Could not save the employee.' });
            }
          }} />
      )}
    </div>
  );
}

// -- Profile -------------------------------------------------------------------

function EmployeeProfile({ data, canManage, onBack, onEdit }) {
  const e = data.employee;
  const reports = data.direct_reports || [];
  // Salary is only in the payload when the viewer is allowed it -- see header.
  const seesPay = e.base_salary !== undefined;

  return (
    <div className="space-y-4">
      <SectionHeader level="page" icon={Users} title={fullName(e)}
        subtitle={[e.hr_positions?.title, e.hr_departments?.name].filter(Boolean).join(' -- ') || e.employee_no}
        actions={
          <div className="flex items-center gap-2">
            <Btn icon={ArrowLeft} onClick={onBack}>Back to directory</Btn>
            {canManage && <Btn variant="primary" icon={Pencil} onClick={onEdit}>Edit</Btn>}
          </div>
        } />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Panel className="lg:col-span-2">
          <SectionHeader title="Details" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
            <Detail label="Employee number" value={e.employee_no} mono />
            <Detail label="Status" value={<StatusPill status={e.status} />} />
            <Detail label="Work email" value={e.work_email} />
            <Detail label="Phone" value={e.phone} />
            <Detail label="Hired" value={fmtDate(e.hire_date)} />
            <Detail label="Employment type" value={e.employment_type?.replace(/_/g, ' ')} />
            {e.termination_date && <Detail label="Terminated" value={fmtDate(e.termination_date)} />}
            <Detail label="CRM login" value={e.user_id ? 'Linked' : 'Not linked'} />
          </div>

          {seesPay && (
            <div className="mt-5 pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
              <p className="text-[11px] font-bold uppercase tracking-wider m-0 mb-3"
                style={{ color: 'var(--color-text-secondary)' }}>Compensation and personal</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                <Detail label="Base salary" value={fmtMoney(e.base_salary, e.currency)} />
                <Detail label="Pay frequency" value={e.pay_frequency?.replace(/_/g, ' ')} />
                <Detail label="Date of birth" value={fmtDate(e.date_of_birth)} />
                <Detail label="Personal email" value={e.personal_email} />
                <Detail label="Address" value={e.address} />
              </div>
            </div>
          )}
        </Panel>

        <Panel>
          <SectionHeader title="Direct reports" subtitle={`${reports.length} ${reports.length === 1 ? 'person' : 'people'}`} />
          {reports.length === 0 ? (
            <EmptyState compact icon={Users} title="No direct reports" />
          ) : (
            <div className="space-y-1.5">
              {reports.map(r => (
                <div key={r.id} className="flex items-center justify-between py-1.5"
                  style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <span className="text-sm" style={{ color: 'var(--color-text)' }}>{fullName(r)}</span>
                  <StatusPill status={r.status} />
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

const Detail = ({ label, value, mono }) => (
  <div>
    <p className="text-[10px] font-bold uppercase tracking-wider m-0 mb-0.5" style={{ color: 'var(--color-text-secondary)' }}>{label}</p>
    <p className={`text-sm m-0 ${mono ? 'font-mono' : ''}`} style={{ color: 'var(--color-text)' }}>
      {value || <span style={{ color: 'var(--color-text-tertiary)' }}>--</span>}
    </p>
  </div>
);

// -- Editor ---------------------------------------------------------------------

function EmployeeEditor({ employee, departments, positions, colleagues, linkable, onClose, onSave }) {
  const isNew = !employee.id;
  const [form, setForm] = useState({
    user_id: employee.user_id || '',
    employee_no: employee.employee_no || '',
    first_name: employee.first_name || '',
    last_name: employee.last_name || '',
    work_email: employee.work_email || '',
    personal_email: employee.personal_email || '',
    phone: employee.phone || '',
    date_of_birth: employee.date_of_birth || '',
    address: employee.address || '',
    department_id: employee.department_id || '',
    position_id: employee.position_id || '',
    manager_employee_id: employee.manager_employee_id || '',
    hire_date: employee.hire_date || '',
    termination_date: employee.termination_date || '',
    employment_type: employee.employment_type || 'full_time',
    status: employee.status || 'active',
    base_salary: employee.base_salary ?? '',
    pay_frequency: employee.pay_frequency || 'monthly',
    currency: employee.currency || 'PKR',
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Picking an unlinked CRM user pre-fills the name, so the common path is one
  // click rather than retyping what the CRM already knows.
  const onPickUser = (userId) => {
    const u = linkable.find(x => x.user_id === userId);
    setForm(f => ({
      ...f,
      user_id: userId,
      first_name: f.first_name || u?.first_name || '',
      last_name: f.last_name || u?.last_name || '',
    }));
  };

  const submit = async (ev) => {
    ev.preventDefault();
    setSaving(true);
    await onSave({
      ...form,
      user_id: form.user_id || null,
      employee_no: form.employee_no || undefined,
      department_id: form.department_id || null,
      position_id: form.position_id || null,
      manager_employee_id: form.manager_employee_id || null,
      hire_date: form.hire_date || null,
      termination_date: form.termination_date || null,
      date_of_birth: form.date_of_birth || null,
      base_salary: form.base_salary === '' ? null : Number(form.base_salary),
    });
    setSaving(false);
  };

  return (
    <ModuleModal wide title={isNew ? 'New employee' : `Edit ${fullName(employee)}`} onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={saving} onClick={submit}>Save</Btn></>}>
      <form onSubmit={submit} className="space-y-4">
        {/* Shown when editing as well as when creating. Linking is exactly the
            thing you come back to fix on a record that already exists -- it is
            what lets that person see their own attendance, leave, payslips and
            review, and it was unreachable after the record was made.
            Searchable, not a native select: one row per unlinked colleague, so
            it runs to dozens and typing a name has to filter. */}
        {(linkable.length > 0 || form.user_id) && (
          <Field as="div" label="Link to a CRM user"
            hint="Optional, but this is what lets them see their own attendance, leave, payslips and review.">
            <SearchSelect
              value={form.user_id}
              onChange={onPickUser}
              options={linkable.map(u => ({ value: u.user_id, label: u.name, hint: u.role || '' }))}
              placeholder="Search by name or role..."
              emptyLabel="No CRM login (record only)" />
          </Field>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="First name" required>
            <input className="input w-full" required value={form.first_name} onChange={e => set('first_name', e.target.value)} />
          </Field>
          <Field label="Last name">
            <input className="input w-full" value={form.last_name} onChange={e => set('last_name', e.target.value)} />
          </Field>
          <Field label="Employee number" hint={isNew ? 'Left blank, one is generated.' : undefined}>
            <input className="input w-full" value={form.employee_no} onChange={e => set('employee_no', e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Work email"><input className="input w-full" type="email" value={form.work_email} onChange={e => set('work_email', e.target.value)} /></Field>
          <Field label="Personal email"><input className="input w-full" type="email" value={form.personal_email} onChange={e => set('personal_email', e.target.value)} /></Field>
          <Field label="Phone"><input className="input w-full" value={form.phone} onChange={e => set('phone', e.target.value)} /></Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Department">
            <ThemedSelect value={form.department_id} onChange={e => set('department_id', e.target.value)}>
              <option value="">None</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </ThemedSelect>
          </Field>
          <Field label="Position">
            <ThemedSelect value={form.position_id} onChange={e => set('position_id', e.target.value)}>
              <option value="">None</option>
              {positions.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
            </ThemedSelect>
          </Field>
          <Field as="div" label="Reports to" hint="Their reviewer by default when a cycle launches.">
            <SearchSelect
              value={form.manager_employee_id}
              onChange={v => set('manager_employee_id', v)}
              options={colleagues.filter(c => c.id !== employee.id)
                .map(c => ({ value: c.id, label: fullName(c), hint: c.employee_no || '' }))}
              placeholder="Search by name or employee no..."
              emptyLabel="Nobody" />
          </Field>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="Hire date"><input className="input w-full" type="date" value={form.hire_date} onChange={e => set('hire_date', e.target.value)} /></Field>
          <Field label="Employment type">
            <ThemedSelect value={form.employment_type} onChange={e => set('employment_type', e.target.value)}>
              {['full_time', 'part_time', 'contract', 'intern', 'temp'].map(t => (
                <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
              ))}
            </ThemedSelect>
          </Field>
          <Field label="Status">
            <ThemedSelect value={form.status} onChange={e => set('status', e.target.value)}>
              {['active', 'on_leave', 'suspended', 'resigned', 'terminated'].map(s => (
                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
              ))}
            </ThemedSelect>
          </Field>
          <Field label={['resigned', 'terminated'].includes(form.status) ? 'Last working day' : 'Termination date'}
            hint={['resigned', 'terminated'].includes(form.status) ? 'Set to today if left blank.' : undefined}>
            <input className="input w-full" type="date" value={form.termination_date} onChange={e => set('termination_date', e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <Field label="Base salary" hint="Per pay period. Payroll is manual entry -- this only prefills a run.">
            <input className="input w-full" type="number" step="0.01" min="0" value={form.base_salary}
              onChange={e => set('base_salary', e.target.value)} />
          </Field>
          <Field label="Pay frequency">
            <ThemedSelect value={form.pay_frequency} onChange={e => set('pay_frequency', e.target.value)}>
              {['weekly', 'biweekly', 'semi_monthly', 'monthly'].map(p => (
                <option key={p} value={p}>{p.replace(/_/g, ' ')}</option>
              ))}
            </ThemedSelect>
          </Field>
          <Field label="Currency">
            <ThemedSelect value={form.currency} onChange={e => set('currency', e.target.value)}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </ThemedSelect>
          </Field>
          <Field label="Date of birth"><input className="input w-full" type="date" value={form.date_of_birth} onChange={e => set('date_of_birth', e.target.value)} /></Field>
        </div>

        <Field label="Address"><textarea className="input w-full" rows={2} value={form.address} onChange={e => set('address', e.target.value)} /></Field>
      </form>
    </ModuleModal>
  );
}

// -- Departments and positions --------------------------------------------------

function OrgTab({ departments, positions, canManage, onSaveDept, onDeleteDept, onSavePos, onDeletePos, onNotice }) {
  const [deptName, setDeptName] = useState('');
  const [posTitle, setPosTitle] = useState('');
  const [posDept, setPosDept] = useState('');

  const guard = async (fn, ok) => {
    try { await fn(); onNotice({ type: 'success', text: ok }); }
    catch (e) { onNotice({ type: 'warning', text: e.response?.data?.error || 'That did not work.' }); }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Panel>
        <SectionHeader icon={Building2} title="Departments" subtitle={`${departments.length} in this company`} />
        {canManage && (
          <div className="flex items-center gap-2 mb-3">
            <input className="input flex-1" placeholder="New department name" value={deptName}
              onChange={e => setDeptName(e.target.value)} />
            <Btn variant="primary" icon={Plus} disabled={!deptName.trim()}
              onClick={() => guard(async () => { await onSaveDept({ name: deptName.trim() }); setDeptName(''); }, 'Department added.')}>
              Add
            </Btn>
          </div>
        )}
        {departments.length === 0 ? <EmptyState compact icon={Building2} title="No departments yet" /> : (
          departments.map(d => (
            <div key={d.id} className="flex items-center justify-between py-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <span className="text-sm" style={{ color: 'var(--color-text)' }}>{d.name}</span>
              <div className="flex items-center gap-2">
                <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{d.headcount} people</span>
                {canManage && (
                  <Btn size="sm" variant="danger" icon={Trash2}
                    onClick={() => guard(() => onDeleteDept(d.id), 'Department deleted.')}>
                    <span className="sr-only">Delete</span>
                  </Btn>
                )}
              </div>
            </div>
          ))
        )}
      </Panel>

      <Panel>
        <SectionHeader icon={Briefcase} title="Positions" subtitle={`${positions.length} defined`} />
        {canManage && (
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <input className="input flex-1" placeholder="New position title" value={posTitle}
              onChange={e => setPosTitle(e.target.value)} style={{ minWidth: 140 }} />
            <ThemedSelect value={posDept} onChange={e => setPosDept(e.target.value)}>
              <option value="">No department</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </ThemedSelect>
            <Btn variant="primary" icon={Plus} disabled={!posTitle.trim()}
              onClick={() => guard(async () => {
                await onSavePos({ title: posTitle.trim(), department_id: posDept || null });
                setPosTitle('');
              }, 'Position added.')}>
              Add
            </Btn>
          </div>
        )}
        {positions.length === 0 ? <EmptyState compact icon={Briefcase} title="No positions yet" /> : (
          positions.map(p => (
            <div key={p.id} className="flex items-center justify-between py-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <span className="text-sm" style={{ color: 'var(--color-text)' }}>
                {p.title}
                {p.hr_departments?.name && (
                  <span className="ml-2 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{p.hr_departments.name}</span>
                )}
              </span>
              {canManage && (
                <Btn size="sm" variant="danger" icon={Trash2}
                  onClick={() => guard(() => onDeletePos(p.id), 'Position deleted.')}>
                  <span className="sr-only">Delete</span>
                </Btn>
              )}
            </div>
          ))
        )}
      </Panel>
    </div>
  );
}
