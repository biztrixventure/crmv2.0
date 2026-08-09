// ============================================================================
// MethodsTab.jsx — create/edit methods in place (never clone), archive-only
// removal, and per-method classification rules. Backend: qa2Methods.js.
// ============================================================================

import { useState, useEffect, useCallback, Fragment } from 'react';
import { Plus, Archive, Pencil, Trash2, ListChecks } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';
import ThemedSelect from '../UI/Select';
import { Panel, SectionHeader, TableScroll, Field, EmptyState, Loading, IconButton } from '../UI/kit';

const LEGS = ['fronter', 'closer', 'both'];
const SOURCES = ['ingest_fronter', 'ingest_closer', 'sweep'];
const MATCH_TYPES = ['any', 'exact', 'prefix', 'regex'];

function MethodForm({ initial, onSave, onCancel }) {
  const [code, setCode] = useState(initial?.code || '');
  const [label, setLabel] = useState(initial?.label || '');
  const [leg, setLeg] = useState(initial?.leg || 'fronter');
  const [requiresTransfer, setRequiresTransfer] = useState(initial?.requires_transfer ?? '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!code.trim() || !label.trim()) return toast.error('Code and label are required');
    setBusy(true);
    try {
      await onSave({
        code: code.trim(), label: label.trim(), leg,
        requires_transfer: requiresTransfer === '' ? null : requiresTransfer === 'true',
      });
    } finally { setBusy(false); }
  };

  return (
    <Panel tone="inset" className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Code" hint="Machine identifier, e.g. tra_fronter">
          <input className="input" value={code} onChange={e => setCode(e.target.value)} disabled={busy} />
        </Field>
        <Field label="Label">
          <input className="input" value={label} onChange={e => setLabel(e.target.value)} disabled={busy} />
        </Field>
        <Field label="Leg">
          <ThemedSelect value={leg} onChange={e => setLeg(e.target.value)} disabled={busy}>
            {LEGS.map(l => <option key={l} value={l}>{l}</option>)}
          </ThemedSelect>
        </Field>
        <Field label="Requires transfer" hint="Leave blank for don't care">
          <ThemedSelect value={requiresTransfer === '' ? '' : String(requiresTransfer)} onChange={e => setRequiresTransfer(e.target.value)} disabled={busy}>
            <option value="">Don't care</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </ThemedSelect>
        </Field>
      </div>
      <div className="flex items-center gap-2">
        <button className="btn btn-primary text-sm" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }} onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </Panel>
  );
}

function RulesPanel({ method, onClose }) {
  const [rules, setRules] = useState(null);
  const [source, setSource] = useState('ingest_fronter');
  const [matchType, setMatchType] = useState('any');
  const [dispoMatch, setDispoMatch] = useState('');
  const [priority, setPriority] = useState(100);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    client.get(`qa2/methods/${method.id}/rules`).then(r => setRules(r.data.rules || [])).catch(() => setRules([]));
  }, [method.id]);
  useEffect(() => { load(); }, [load]);

  const addRule = async () => {
    if (matchType !== 'any' && !dispoMatch.trim()) return toast.error('dispo_match is required unless match_type is "any"');
    setBusy(true);
    try {
      await client.post(`qa2/methods/${method.id}/rules`, { source, match_type: matchType, dispo_match: matchType === 'any' ? null : dispoMatch.trim(), priority: Number(priority) || 100 });
      setDispoMatch('');
      toast.success('Rule added');
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not add rule'); }
    finally { setBusy(false); }
  };

  const removeRule = async (ruleId) => {
    try {
      await client.delete(`qa2/methods/${method.id}/rules/${ruleId}`);
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not remove rule'); }
  };

  return (
    <Panel tone="inset" className="space-y-3">
      <SectionHeader level="sub" icon={ListChecks} title={`Rules for ${method.label}`} actions={
        <button className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }} onClick={onClose}>Close</button>
      } />
      {rules === null ? <Loading variant="rows" rows={2} /> : (
        rules.length === 0
          ? <EmptyState compact title="No rules yet" hint="Every incoming call for this method's sources lands in Unclassified until a rule matches." />
          : (
            <TableScroll>
              <table className="w-full text-sm">
                <thead><tr style={{ color: 'var(--color-text-secondary)' }}>
                  <th className="text-left font-semibold px-2 py-1">Source</th>
                  <th className="text-left font-semibold px-2 py-1">Match</th>
                  <th className="text-left font-semibold px-2 py-1">Pattern</th>
                  <th className="text-left font-semibold px-2 py-1">Priority</th>
                  <th className="px-2 py-1" />
                </tr></thead>
                <tbody>
                  {rules.map(r => (
                    <tr key={r.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                      <td className="px-2 py-1.5">{r.source}</td>
                      <td className="px-2 py-1.5">{r.match_type}</td>
                      <td className="px-2 py-1.5">{r.dispo_match || <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>}</td>
                      <td className="px-2 py-1.5">{r.priority}</td>
                      <td className="px-2 py-1.5 text-right">
                        <IconButton label="Remove rule" variant="ghost" tone="danger" onClick={() => removeRule(r.id)}><Trash2 size={14} /></IconButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
        <Field label="Source">
          <ThemedSelect value={source} onChange={e => setSource(e.target.value)} disabled={busy}>
            {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
          </ThemedSelect>
        </Field>
        <Field label="Match type">
          <ThemedSelect value={matchType} onChange={e => setMatchType(e.target.value)} disabled={busy}>
            {MATCH_TYPES.map(m => <option key={m} value={m}>{m}</option>)}
          </ThemedSelect>
        </Field>
        <Field label="Dispo pattern" hint={matchType === 'any' ? 'n/a for "any"' : undefined}>
          <input className="input" value={dispoMatch} onChange={e => setDispoMatch(e.target.value)} disabled={busy || matchType === 'any'} />
        </Field>
        <Field label="Priority" hint="Lower wins first">
          <input type="number" className="input" value={priority} onChange={e => setPriority(e.target.value)} disabled={busy} />
        </Field>
      </div>
      <button className="btn btn-primary text-sm" onClick={addRule} disabled={busy}>{busy ? 'Adding…' : 'Add rule'}</button>
    </Panel>
  );
}

export default function MethodsTab({ scope }) {
  const [methods, setMethods] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [rulesFor, setRulesFor] = useState(null);
  const canManage = !!scope?.managerAccess;

  const load = useCallback(() => {
    setLoadError(null);
    client.get('qa2/methods').then(r => setMethods(r.data.methods || [])).catch(e => setLoadError(e.response?.data?.error || 'Could not load methods'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const createMethod = async (payload) => {
    try {
      await client.post('qa2/methods', payload);
      toast.success('Method created');
      setCreating(false);
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not create method'); }
  };

  const updateMethod = async (id, payload) => {
    try {
      await client.put(`qa2/methods/${id}`, payload);
      toast.success('Method updated');
      setEditingId(null);
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not update method'); }
  };

  const archiveMethod = async (id) => {
    try {
      await client.post(`qa2/methods/${id}/archive`);
      toast.success('Method archived');
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not archive method'); }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <SectionHeader level="page" icon={ListChecks} title="Methods"
        subtitle="Global catalog — a method's classification rules decide which incoming calls it covers. No defaults: build your own."
        actions={canManage && <button className="btn btn-primary text-sm flex items-center gap-1.5" onClick={() => setCreating(v => !v)}><Plus size={14} />New method</button>}
      />

      {creating && <MethodForm onSave={createMethod} onCancel={() => setCreating(false)} />}

      {loadError && <Panel tone="inset"><p className="text-sm" style={{ color: 'var(--color-error-600)' }}>{loadError}</p></Panel>}
      {!loadError && methods === null && <Loading variant="table" rows={4} />}
      {!loadError && methods && methods.length === 0 && !creating && (
        <EmptyState icon={ListChecks} title="No methods yet" hint="This is expected on a fresh install — create your first method above." />
      )}

      {!loadError && methods && methods.length > 0 && (
        <Panel pad="none">
          <TableScroll>
            <table className="w-full text-sm">
              <thead><tr style={{ color: 'var(--color-text-secondary)' }}>
                <th className="text-left font-semibold px-3 py-2">Label</th>
                <th className="text-left font-semibold px-3 py-2">Code</th>
                <th className="text-left font-semibold px-3 py-2">Leg</th>
                <th className="text-left font-semibold px-3 py-2">Status</th>
                <th className="px-3 py-2" />
              </tr></thead>
              <tbody>
                {methods.map(m => (
                  <Fragment key={m.id}>
                    <tr style={{ borderTop: '1px solid var(--color-border)' }}>
                      <td className="px-3 py-2 font-semibold" style={{ color: 'var(--color-text)' }}>{m.label}</td>
                      <td className="px-3 py-2" style={{ color: 'var(--color-text-secondary)' }}>{m.code}</td>
                      <td className="px-3 py-2">{m.leg}</td>
                      <td className="px-3 py-2">{m.is_active ? 'Active' : 'Archived'}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <IconButton label="Rules" variant="ghost" onClick={() => setRulesFor(rulesFor?.id === m.id ? null : m)}><ListChecks size={15} /></IconButton>
                          {canManage && <IconButton label="Edit" variant="ghost" onClick={() => setEditingId(editingId === m.id ? null : m.id)}><Pencil size={15} /></IconButton>}
                          {canManage && m.is_active && <IconButton label="Archive" variant="ghost" tone="danger" onClick={() => archiveMethod(m.id)}><Archive size={15} /></IconButton>}
                        </div>
                      </td>
                    </tr>
                    {editingId === m.id && (
                      <tr><td colSpan={5} className="px-3 pb-3"><MethodForm initial={m} onSave={p => updateMethod(m.id, p)} onCancel={() => setEditingId(null)} /></td></tr>
                    )}
                    {rulesFor?.id === m.id && (
                      <tr><td colSpan={5} className="px-3 pb-3"><RulesPanel method={m} onClose={() => setRulesFor(null)} /></td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Panel>
      )}
    </div>
  );
}
