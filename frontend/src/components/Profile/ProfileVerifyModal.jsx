import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, Headphones, Lock, AlertTriangle, CheckCircle2, ArrowRight } from 'lucide-react';
import Modal from '../UI/Modal';
import client from '../../api/client';

/**
 * ProfileVerifyModal — the "please confirm your details" prompt a superadmin
 * raises from the User Control Center.
 *
 * WHY IT EXISTS: a wrong or missing dialer ID means the CRM cannot match that
 * person to their dialer activity, so their transfers and dispositions are
 * dropped without any visible error. Admins can't know every agent's dialer
 * login — the agent can. This asks them, once, in plain language.
 *
 * RULES BAKED IN:
 *  - Name and email are READ-ONLY. Identity is not self-service; the user is
 *    verifying them, not editing them.
 *  - The dialer ID is the single editable field, and the current value is shown
 *    beside the new one so the user sees exactly what is being replaced.
 *  - Submitting does NOT change the profile — it goes to a superadmin for
 *    approval. Letting people self-apply an unreviewed ID would just move the
 *    wrong-ID problem rather than fix it.
 *  - Not dismissible: no close button, and ESC is a no-op, so the prompt stays
 *    until it is answered (or the superadmin withdraws it).
 */
export default function ProfileVerifyModal() {
  const [state, setState] = useState(null);    // server payload
  const [ids, setIds]     = useState('');
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent]   = useState(false);

  const load = useCallback(() => {
    client.get('users/me/profile-verification')
      .then(r => {
        setState(r.data);
        if (r.data?.profile) setIds(r.data.profile.vicidial_agent_id || '');
      })
      .catch(() => {});   // never block the app on this
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!state) return null;
  const awaiting = state.awaiting_review || sent;
  if (!state.required && !awaiting) return null;

  const current = state.profile?.vicidial_agent_id || '';
  const changed = ids.trim() !== current.trim();

  const submit = async () => {
    setBusy(true); setError('');
    try {
      await client.post('users/me/profile-verification/confirm', { vicidial_agent_id: ids });
      setSent(true);
    } catch (e) {
      setError(e?.response?.data?.error || 'Could not send. Please try again.');
    } finally { setBusy(false); }
  };

  // ── Sent: the answer is with a superadmin, nothing more for the user to do ──
  if (awaiting) {
    return (
      <Modal isOpen title="Thanks — sent for confirmation" size="md" showCloseButton={false} onClose={() => {}}>
        <div className="p-6 text-center">
          <CheckCircle2 size={44} className="mx-auto mb-3" style={{ color: 'var(--color-success-600)' }} />
          <p className="text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>
            Your information has been sent for confirmation
          </p>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
            An administrator will review it shortly. Your profile updates once it is approved —
            until then your current details stay exactly as they are.
          </p>
          {(state.submitted_ids || ids) && (
            <p className="text-xs mt-3 font-mono px-3 py-2 rounded-lg inline-block"
               style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
              Submitted dialer ID: {state.submitted_ids || ids}
            </p>
          )}
        </div>
      </Modal>
    );
  }

  // ── The prompt ──
  return (
    <Modal isOpen title="Verify your information" size="md" showCloseButton={false} onClose={() => {}}>
      <div className="p-6 space-y-4">
        <div className="flex items-start gap-2.5 rounded-xl p-3"
             style={{ backgroundColor: 'var(--color-primary-50, #eef2ff)', border: '1px solid var(--color-primary-200, #c7d2fe)' }}>
          <ShieldCheck size={17} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-primary-700)' }} />
          <p className="text-xs leading-relaxed" style={{ color: 'var(--color-primary-700)' }}>
            Please check the details below are correct. If your <strong>dialer ID</strong> is wrong or missing,
            your calls and transfers may not show on your dashboard.
          </p>
        </div>

        {/* Identity — shown for confirmation only, never editable here. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[['Name', `${state.profile.first_name} ${state.profile.last_name}`.trim() || '—'],
            ['Email', state.profile.email || '—']].map(([label, value]) => (
            <div key={label}>
              <label className="block text-[11px] font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>{label}</label>
              <div className="flex items-center gap-2 rounded-lg px-3 py-2"
                   style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                <Lock size={12} style={{ color: 'var(--color-text-tertiary)' }} />
                <span className="text-sm truncate" style={{ color: 'var(--color-text)' }}>{value}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] -mt-2" style={{ color: 'var(--color-text-tertiary)' }}>
          Name and email can't be changed here — contact your manager if either is wrong.
        </p>

        {/* The one editable field. */}
        <div>
          <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>
            Your dialer ID
          </label>
          <div className="relative">
            <Headphones size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-secondary)' }} />
            {/* autofill opt-outs: Chrome has previously dropped an email address
                into dialer-ID boxes, which is the exact fault this prompt fixes */}
            <input value={ids} onChange={e => setIds(e.target.value)}
              placeholder="e.g. ETC0895 or 5006"
              autoComplete="off" data-lpignore="true" data-1p-ignore data-form-type="other"
              spellCheck={false} className="input pl-9 w-full" />
          </div>
          <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
            This is your login on the dialer. Work more than one dialer? List them separated by commas.
          </p>
        </div>

        {/* Before → after, so the change is never a surprise. */}
        <div className="rounded-xl p-3" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          <p className="text-[11px] font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            {changed ? 'This is what will change' : 'Your dialer ID on record'}
          </p>
          <div className="flex items-center gap-2 flex-wrap text-sm font-mono">
            <span className="px-2 py-1 rounded" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
              {current || 'not set'}
            </span>
            {changed && (
              <>
                <ArrowRight size={14} style={{ color: 'var(--color-text-tertiary)' }} />
                <span className="px-2 py-1 rounded font-semibold"
                      style={{ backgroundColor: 'var(--color-success-600)22', color: 'var(--color-success-600)', border: '1px solid var(--color-success-600)44' }}>
                  {ids.trim() || 'cleared'}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-start gap-2.5 rounded-xl p-3"
             style={{ backgroundColor: 'var(--color-warning-50, #fffbeb)', border: '1px solid var(--color-warning-200, #fde68a)' }}>
          <AlertTriangle size={17} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-warning-700, #b45309)' }} />
          <p className="text-xs leading-relaxed" style={{ color: 'var(--color-warning-700, #b45309)' }}>
            Please be careful — entering the <strong>wrong dialer ID</strong> will cause your calls, transfers
            and dispositions to stop appearing on your dashboard. Only enter the ID you actually log into the dialer with.
          </p>
        </div>

        {error && (
          <p className="text-xs rounded-lg px-3 py-2"
             style={{ backgroundColor: 'var(--color-danger-50, #fef2f2)', color: 'var(--color-danger-700, #b91c1c)', border: '1px solid var(--color-danger-200, #fecaca)' }}>
            {error}
          </p>
        )}

        <button onClick={submit} disabled={busy}
          className="w-full text-sm font-bold px-4 py-2.5 rounded-xl text-white disabled:opacity-60"
          style={{ background: 'var(--gradient-sidebar)' }}>
          {busy ? 'Sending…' : 'Confirm — this is correct'}
        </button>
        <p className="text-[11px] text-center" style={{ color: 'var(--color-text-tertiary)' }}>
          Your answer is sent to an administrator for approval before anything changes.
        </p>
      </div>
    </Modal>
  );
}
