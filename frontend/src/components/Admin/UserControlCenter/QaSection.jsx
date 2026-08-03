// QaSection — per-user QA settings, shown for QA-role users and for compliance
// managers. Three controls, all on existing audited endpoints:
//   1. Quality-manager designation (superadmin) — PUT /qa/admin/manager-designation.
//   2. Bound review methods (qa_agent only) — GET/PUT /qa/agent-methods.
//   3. Transcription access — GET/PUT /qa/transcription-access (global allowlist).
//
// UI from components/UI/kit (docs/ui-design-system.md).
import { useState, useEffect, useCallback } from 'react';
import { ClipboardCheck, Mic, UserCheck } from 'lucide-react';
import client from '../../../api/client';
import { Alert } from '../../../components/UI';
import { Panel, SectionHeader, Loading, CheckRow, useFlash } from '../../UI/kit';

// Mirrors qa.js SLOT_LABELS / WORK_TYPES.
const QA_METHODS = [
  { key: 'tra',          label: 'TRA · Transfers' },
  { key: 'rcm',          label: 'RCM · Random' },
  { key: 'closer_sales', label: 'Closed Sale' },
  { key: 'closer_dispo', label: 'Unclosed Sale' },
];

export default function QaSection({ account, assignment }) {
  const userId = account.user_id;
  const companyId = assignment?.company_id;
  const isAgent = assignment?.role_level === 'qa_agent';
  // Anyone who can hold the job: a compliance manager (who does it in practice)
  // or someone actually carrying the qa_manager role.
  const canBeManager = ['compliance_manager', 'qa_manager'].includes(assignment?.role_level);
  const [methods, setMethods]   = useState([]);
  const [methodsOk, setMethodsOk] = useState(true);   // false if this user isn't in the agent pool
  const [transcribe, setTranscribe] = useState(false);
  const [mgr, setMgr] = useState(null);               // this user's row from /manager-candidates
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(null);
  const { msg, flash, clear } = useFlash();

  const load = useCallback(async () => {
    setLoading(true);
    const jobs = [client.get('qa/transcription-access')];
    if (isAgent && companyId) jobs.push(client.get('qa/agent-methods', { params: { company_id: companyId } }));
    const res = await Promise.allSettled(jobs);
    if (res[0].status === 'fulfilled') {
      const u = (res[0].value.data.users || []).find(x => x.user_id === userId);
      setTranscribe(!!u?.enabled);
    }
    if (isAgent && companyId) {
      if (res[1]?.status === 'fulfilled') {
        const me = (res[1].value.data.agents || []).find(a => a.id === userId);
        setMethods(me?.methods || []);
        setMethodsOk(!!me);   // present in the pool?
      } else { setMethodsOk(false); }
    }
    if (canBeManager) {
      // superadmin-only endpoint; a failure just hides the control rather than
      // breaking the rest of the QA settings
      try {
        const r = await client.get('qa/admin/manager-candidates');
        setMgr((r.data.candidates || []).find(c => c.user_id === userId) || { designated: false, companies: 0, agents: 0 });
      } catch { setMgr(null); }
    }
    setLoading(false);
  }, [userId, companyId, isAgent, canBeManager]);

  useEffect(() => { load(); }, [load]);

  const saveMethods = async (next) => {
    setBusy('methods');
    try {
      await client.put('qa/agent-methods', { user_id: userId, company_id: companyId, methods: next });
      setMethods(next); flash('success', 'Methods saved.');
    } catch (e) { flash('error', e.response?.data?.error || 'Save failed.'); } finally { setBusy(null); }
  };

  const saveTranscribe = async (enabled) => {
    setBusy('transcribe');
    try {
      await client.put('qa/transcription-access', { user_id: userId, enabled });
      setTranscribe(enabled); flash('success', 'Transcription access saved.');
    } catch (e) { flash('error', e.response?.data?.error || 'Save failed.'); } finally { setBusy(null); }
  };

  const saveDesignation = async (enabled) => {
    setBusy('designation');
    try {
      await client.put('qa/admin/manager-designation', { user_id: userId, enabled });
      setMgr(m => ({ ...(m || {}), designated: enabled }));
      flash('success', enabled
        ? 'Designated as a quality manager — they now appear in Compliance → QA Department, where companies and team members are assigned to them.'
        : 'Designation removed. Any companies and agents already wired to them are kept, but they no longer appear in the QA org chart.');
    } catch (e) { flash('error', e.response?.data?.error || 'Save failed.'); } finally { setBusy(null); }
  };

  if (loading) return <Loading variant="rows" rows={4} label="Loading QA settings…" />;

  return (
    <div className="space-y-5 max-w-2xl">
      <SectionHeader icon={ClipboardCheck} title="QA settings" />
      {msg && <Alert type={msg.type} onDismiss={clear}>{msg.text}</Alert>}

      {/* Quality-manager designation. This is what puts a compliance manager in
          the QA org chart: the manager list is built from the qa_manager role,
          and nobody holds it — so without this the picker is empty and no
          company or agent can be assigned to anyone. */}
      {canBeManager && mgr && (
        <Panel tone="inset" radius="xl">
          <SectionHeader level="sub" icon={UserCheck} title="Quality manager"
            actions={busy === 'designation' ? <Loading variant="inline" size={13} /> : null} />
          <p className="text-[11px] text-text-secondary mb-3 m-0">
            Lets this user act as a quality manager in the QA department without changing their role — their
            {' '}{assignment?.role_level === 'compliance_manager' ? 'compliance' : 'current'} access is untouched.
            Once on, they appear in <strong>Compliance → QA Department</strong>, where companies and team members are assigned to them.
          </p>
          <CheckRow label="This user is a quality manager"
            checked={!!mgr.designated} onChange={saveDesignation} />
          {mgr.designated && (
            <p className="text-[11px] text-text-tertiary mt-2 m-0">
              Currently owns {mgr.companies || 0} {mgr.companies === 1 ? 'company' : 'companies'} and {mgr.agents || 0} team {mgr.agents === 1 ? 'member' : 'members'}.
            </p>
          )}
        </Panel>
      )}

      {/* Bound methods (qa_agent only) */}
      {isAgent && (
        <Panel tone="inset" radius="xl">
          <SectionHeader level="sub" title={`Bound review methods · ${assignment.company_name || '—'}`}
            actions={busy === 'methods' ? <Loading variant="inline" size={13} /> : null} />
          <p className="text-[11px] text-text-secondary mb-3">Which review types this agent is assigned. Empty = not set up (permissive).</p>
          {!methodsOk && <p className="text-[11px] mb-2" style={{ color: 'var(--color-warning-600)' }}>This agent isn’t in the QA pool for this company yet — saving will create their binding.</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {QA_METHODS.map(m => (
              <CheckRow key={m.key} label={m.label} checked={methods.includes(m.key)}
                onChange={next => saveMethods(next ? [...new Set([...methods, m.key])] : methods.filter(x => x !== m.key))} />
            ))}
          </div>
        </Panel>
      )}

      {/* Transcription access (any QA user) */}
      <Panel tone="inset" radius="xl">
        <SectionHeader level="sub" icon={Mic} title="Call transcription access"
          actions={busy === 'transcribe' ? <Loading variant="inline" size={13} /> : null} />
        <CheckRow label="Allow this user to trigger on-demand call transcription"
          checked={transcribe} onChange={saveTranscribe} />
      </Panel>
    </div>
  );
}
