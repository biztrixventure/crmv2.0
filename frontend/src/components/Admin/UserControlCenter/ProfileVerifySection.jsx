// ProfileVerifySection — ask staff to confirm their own details, then approve
// what they send back.
//
// The dialer id is why this exists: a wrong one silently stops that person's
// transfers and dispositions reaching the CRM, and an admin cannot know every
// agent's dialer login. The user's answer is a PROPOSAL — nothing changes on
// their profile until it is approved here.
//
// UI from components/UI/kit (docs/ui-design-system.md).
import { useState, useEffect, useCallback } from 'react';
import { BellRing, BellOff, Check, X, ArrowRight, Clock } from 'lucide-react';
import client from '../../../api/client';
import { SectionHeader, useFlash, Loading } from '../../UI/kit';
import { Alert } from '../../../components/UI';

const fmt = (iso) => { try { return new Date(iso).toLocaleString(); } catch { return iso; } };
const idList = (a) => (a && a.length ? a.join(', ') : 'not set');

export default function ProfileVerifySection({ account, onChanged }) {
  const [state, setState] = useState(null);
  const [busy, setBusy]   = useState(false);
  const [askName, setAskName] = useState(false);
  const { msg, flash, clear } = useFlash();

  const load = useCallback(() => {
    if (!account?.user_id) return;
    client.get(`users/${account.user_id}/profile-verification`)
      .then(r => setState(r.data))
      .catch(() => setState({}));
  }, [account?.user_id]);

  useEffect(() => { load(); }, [load]);

  const act = async (fn, okMsg) => {
    setBusy(true); clear();
    try { await fn(); flash('success', okMsg); load(); onChanged?.(); }
    catch (e) { flash('error', e.response?.data?.error || 'Action failed.'); }
    finally { setBusy(false); }
  };

  const ask      = () => act(() => client.post('users/profile-verification', {
    user_ids: [account.user_id], action: 'request',
    fields: askName ? ['vicidial_agent_id', 'name'] : ['vicidial_agent_id'],
  }), 'Asked this user to verify their details.');
  const withdraw = () => act(() => client.post('users/profile-verification', { user_ids: [account.user_id], action: 'cancel' }),  'Request withdrawn — the user will no longer be prompted.');
  const review   = (action) => act(() => client.post(`users/${account.user_id}/profile-verification/review`, { action }), action === 'approve' ? 'Approved — the profile has been updated.' : 'Rejected — the user can submit again.');

  if (!state) return <Loading />;

  const status = state.awaiting_review ? 'awaiting'
    : state.pending ? 'asked'
    : state.verified_at ? 'verified' : 'none';

  const badge = {
    awaiting: ['Awaiting your approval', 'var(--color-warning-700, #b45309)', 'var(--color-warning-50, #fffbeb)'],
    asked:    ['Prompt showing to user', 'var(--color-primary-700)', 'var(--color-primary-50, #eef2ff)'],
    verified: ['Verified', 'var(--color-success-600)', 'var(--color-bg-secondary)'],
    none:     ['Not being asked', 'var(--color-text-secondary)', 'var(--color-bg-secondary)'],
  }[status];

  return (
    <div className="space-y-4">
      <SectionHeader icon={BellRing} title="Profile verification"
        subtitle="Ask this person to confirm their details. Their answer needs your approval before it changes anything." />

      {msg && <Alert type={msg.type} message={msg.text} dismissible onDismiss={clear} />}

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-bold px-2.5 py-1 rounded-full"
              style={{ color: badge[1], backgroundColor: badge[2], border: `1px solid ${badge[1]}33` }}>
          {badge[0]}
        </span>
        {state.verified_at && <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>last verified {fmt(state.verified_at)}</span>}
        {state.requested_at && !state.verified_at && <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>asked {fmt(state.requested_at)}</span>}
      </div>

      {/* What the user sent back — approve to apply it to their profile. */}
      {state.awaiting_review && (
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-warning-200, #fde68a)' }}>
          <p className="text-xs font-semibold mb-2 flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
            <Clock size={13} /> Submitted {fmt(state.submitted_at)}
          </p>
          <div className="flex items-center gap-2 flex-wrap text-sm font-mono mb-3">
            <span className="px-2 py-1 rounded" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
              {idList(state.previous_ids)}
            </span>
            <ArrowRight size={14} style={{ color: 'var(--color-text-tertiary)' }} />
            <span className="px-2 py-1 rounded font-semibold"
                  style={{ backgroundColor: 'var(--color-success-600)22', color: 'var(--color-success-600)', border: '1px solid var(--color-success-600)44' }}>
              {idList(state.submitted_ids)}
            </span>
          </div>
          <div className="flex gap-2">
            <button onClick={() => review('approve')} disabled={busy}
              className="text-xs font-bold px-3 py-1.5 rounded-lg text-white flex items-center gap-1.5 disabled:opacity-60"
              style={{ backgroundColor: 'var(--color-success-600)' }}>
              <Check size={13} /> Approve &amp; apply
            </button>
            <button onClick={() => review('reject')} disabled={busy}
              className="text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 disabled:opacity-60"
              style={{ color: 'var(--color-danger-700, #b91c1c)', backgroundColor: 'var(--color-danger-50, #fef2f2)', border: '1px solid var(--color-danger-200, #fecaca)' }}>
              <X size={13} /> Reject
            </button>
          </div>
          <p className="text-[11px] mt-2" style={{ color: 'var(--color-text-tertiary)' }}>
            Rejecting keeps the prompt open so they can try again.
          </p>
        </div>
      )}

      {/* Choose what to ask for. Dialer ID is always included — it is the whole
          reason this exists — so only the name is optional. */}
      {status !== 'asked' && status !== 'awaiting' && (
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={askName} onChange={e => setAskName(e.target.checked)} />
          <span className="text-xs" style={{ color: 'var(--color-text)' }}>
            Also ask for their <strong>name</strong>
            <span style={{ color: 'var(--color-text-tertiary)' }}> — dialer ID is always included</span>
          </span>
        </label>
      )}

      <div className="flex gap-2 flex-wrap">
        {status === 'asked' || status === 'awaiting' ? (
          <button onClick={withdraw} disabled={busy}
            className="text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 disabled:opacity-60"
            style={{ color: 'var(--color-text)', backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            <BellOff size={13} /> Stop asking this user
          </button>
        ) : (
          <button onClick={ask} disabled={busy}
            className="text-xs font-bold px-3 py-1.5 rounded-lg text-white flex items-center gap-1.5 disabled:opacity-60"
            style={{ background: 'var(--gradient-sidebar)' }}>
            <BellRing size={13} /> Ask this user to verify
          </button>
        )}
      </div>
      <p className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
        The prompt stays on the user's screen until they answer it, or until you stop asking.
        Estate-wide actions (ask/stop everyone, bulk approve) are on the User Control Center home page.
      </p>
    </div>
  );
}
