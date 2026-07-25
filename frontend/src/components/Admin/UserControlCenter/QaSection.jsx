// QaSection — per-user QA settings, shown only for QA-role users (qa_agent /
// qa_manager). Two controls, both on existing audited endpoints:
//   1. Bound review methods (qa_agent only) — GET/PUT /qa/agent-methods.
//   2. Transcription access — GET/PUT /qa/transcription-access (global allowlist).
import { useState, useEffect, useCallback } from 'react';
import { ClipboardCheck, Loader2, Mic } from 'lucide-react';
import client from '../../../api/client';
import { Alert } from '../../../components/UI';

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
  const [methods, setMethods]   = useState([]);
  const [methodsOk, setMethodsOk] = useState(true);   // false if this user isn't in the agent pool
  const [transcribe, setTranscribe] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(null);
  const [msg, setMsg]         = useState(null);

  const flash = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 4000); };

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
    setLoading(false);
  }, [userId, companyId, isAgent]);

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

  if (loading) return <div className="flex justify-center py-10"><Loader2 size={22} className="animate-spin" style={{ color: 'var(--color-primary-600)' }} /></div>;

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-2"><ClipboardCheck size={16} style={{ color: 'var(--color-primary-600)' }} /><h3 className="text-sm font-bold text-text">QA settings</h3></div>
      {msg && <Alert type={msg.type}>{msg.text}</Alert>}

      {/* Bound methods (qa_agent only) */}
      {isAgent && (
        <div className="rounded-xl p-4" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-xs font-bold uppercase tracking-wider text-text-secondary">Bound review methods · {assignment.company_name || '—'}</h4>
            {busy === 'methods' && <Loader2 size={13} className="animate-spin" style={{ color: 'var(--color-primary-600)' }} />}
          </div>
          <p className="text-[11px] text-text-secondary mb-3">Which review types this agent is assigned. Empty = not set up (permissive).</p>
          {!methodsOk && <p className="text-[11px] mb-2" style={{ color: 'var(--color-warning-600)' }}>This agent isn’t in the QA pool for this company yet — saving will create their binding.</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {QA_METHODS.map(m => {
              const on = methods.includes(m.key);
              return (
                <label key={m.key} className="flex items-center gap-2 cursor-pointer text-sm py-1">
                  <input type="checkbox" checked={on} onChange={e => saveMethods(e.target.checked ? [...new Set([...methods, m.key])] : methods.filter(x => x !== m.key))}
                    className="accent-[var(--color-primary-600)]" />
                  <span className="text-text">{m.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* Transcription access (any QA user) */}
      <div className="rounded-xl p-4" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-2 mb-1">
          <Mic size={13} style={{ color: 'var(--color-primary-600)' }} />
          <h4 className="text-xs font-bold uppercase tracking-wider text-text-secondary">Call transcription access</h4>
          {busy === 'transcribe' && <Loader2 size={13} className="animate-spin" style={{ color: 'var(--color-primary-600)' }} />}
        </div>
        <label className="flex items-center gap-2 cursor-pointer text-sm py-1">
          <input type="checkbox" checked={transcribe} onChange={e => saveTranscribe(e.target.checked)} className="accent-[var(--color-primary-600)]" />
          <span className="text-text">Allow this user to trigger on-demand call transcription</span>
        </label>
      </div>
    </div>
  );
}
