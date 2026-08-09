// ============================================================================
// FormsTab.jsx — list forms, create a new one, hand off to FormBuilder for
// the actual sections/parameters/options/publish work. Backend: qa2Forms.js.
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import { Plus, FileSpreadsheet, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';
import ThemedSelect from '../UI/Select';
import { Panel, SectionHeader, TableScroll, Field, EmptyState, Loading } from '../UI/kit';
import Badge from '../UI/Badge';
import FormBuilder from './FormBuilder';

const STATUS_VARIANT = { draft: 'warning', active: 'success', archived: 'error' };

function CreateForm({ methods, onCreate, onCancel }) {
  const [name, setName] = useState('');
  const [methodId, setMethodId] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim() || !methodId) return toast.error('Name and method are required');
    setBusy(true);
    try { await onCreate({ name: name.trim(), method_id: methodId, company_id: companyId || null }); }
    finally { setBusy(false); }
  };

  return (
    <Panel tone="inset" className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Name"><input className="input" value={name} onChange={e => setName(e.target.value)} disabled={busy} /></Field>
        <Field label="Method">
          <ThemedSelect value={methodId} onChange={e => setMethodId(e.target.value)} disabled={busy}>
            <option value="">Pick a method…</option>
            {methods.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </ThemedSelect>
        </Field>
        <Field label="Scope" hint="Leave blank for a global card">
          <input className="input" placeholder="company_id (optional)" value={companyId} onChange={e => setCompanyId(e.target.value)} disabled={busy} />
        </Field>
      </div>
      <div className="flex items-center gap-2">
        <button className="btn btn-primary text-sm" onClick={submit} disabled={busy}>{busy ? 'Creating…' : 'Create'}</button>
        <button className="text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }} onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </Panel>
  );
}

export default function FormsTab() {
  const [forms, setForms] = useState(null);
  const [methods, setMethods] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [openForm, setOpenForm] = useState(null); // { form, versionId }

  const load = useCallback(() => {
    setLoadError(null);
    Promise.all([client.get('qa2/forms'), client.get('qa2/methods')])
      .then(([f, m]) => { setForms(f.data.forms || []); setMethods(m.data.methods || []); })
      .catch(e => setLoadError(e.response?.data?.error || 'Could not load forms'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const createForm = async (payload) => {
    try {
      const r = await client.post('qa2/forms', payload);
      toast.success('Form created');
      setCreating(false);
      load();
      setOpenForm({ form: r.data.form, versionId: r.data.version.id });
    } catch (e) { toast.error(e.response?.data?.error || 'Could not create form'); }
  };

  if (openForm) {
    return (
      <FormBuilder
        form={openForm.form}
        initialVersionId={openForm.versionId}
        onBack={() => { setOpenForm(null); load(); }}
      />
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <SectionHeader level="page" icon={FileSpreadsheet} title="Form Builder"
        subtitle="Global catalog with per-company override. Exactly one active form per method (and, separately, per company) at a time."
        actions={<button className="btn btn-primary text-sm flex items-center gap-1.5" onClick={() => setCreating(v => !v)}><Plus size={14} />New form</button>}
      />

      {creating && <CreateForm methods={methods.filter(m => m.is_active)} onCreate={createForm} onCancel={() => setCreating(false)} />}

      {loadError && <Panel tone="inset"><p className="text-sm" style={{ color: 'var(--color-error-600)' }}>{loadError}</p></Panel>}
      {!loadError && forms === null && <Loading variant="table" rows={4} />}
      {!loadError && forms && forms.length === 0 && !creating && (
        <EmptyState icon={FileSpreadsheet} title="No forms yet" hint="Create your first scorecard above." />
      )}

      {!loadError && forms && forms.length > 0 && (
        <Panel pad="none">
          <TableScroll>
            <table className="w-full text-sm">
              <thead><tr style={{ color: 'var(--color-text-secondary)' }}>
                <th className="text-left font-semibold px-3 py-2">Name</th>
                <th className="text-left font-semibold px-3 py-2">Method</th>
                <th className="text-left font-semibold px-3 py-2">Scope</th>
                <th className="text-left font-semibold px-3 py-2">Status</th>
                <th className="px-3 py-2" />
              </tr></thead>
              <tbody>
                {forms.map(f => (
                  <tr key={f.id} style={{ borderTop: '1px solid var(--color-border)', cursor: 'pointer' }}
                    onClick={() => setOpenForm({ form: f, versionId: null })}>
                    <td className="px-3 py-2 font-semibold" style={{ color: 'var(--color-text)' }}>{f.name}</td>
                    <td className="px-3 py-2">{f.qa2_method?.label || '—'}</td>
                    <td className="px-3 py-2">{f.companies?.name || 'Global'}</td>
                    <td className="px-3 py-2"><Badge variant={STATUS_VARIANT[f.status] || 'primary'} size="sm">{f.status}</Badge></td>
                    <td className="px-3 py-2 text-right"><ChevronRight size={16} style={{ color: 'var(--color-text-tertiary)' }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Panel>
      )}
    </div>
  );
}
