// ============================================================================
// IpAccessShared -- the pieces every IP Access screen shares (mig 319).
//
// useGuardedAction(): the server refuses a risky change with
//   409 { needs_confirm: 'enable' | 'empty_allowlist' | 'self_lockout', ... }
// This hook shows the matching confirmation, and on "yes" resends the SAME
// request with the flag the server asked for. The confirmations are enforced by
// the backend, so a skipped dialog can never skip the check.
//
//   const { run, dialog } = useGuardedAction();
//   const res = await run(flags => client.put(url, { ...body, ...flags }));
//   if (res === null) return;      // the admin cancelled
//   ...render {dialog} somewhere in the tree
// ============================================================================
import { useState, useCallback } from 'react';
import { AlertTriangle, ShieldAlert, CheckCircle2, XCircle, HelpCircle } from 'lucide-react';
import Modal from '../../UI/Modal';
import { accent } from '../../UI/kit';

const FLAG = { enable: 'confirm', empty_allowlist: 'confirm_empty', self_lockout: 'acknowledge_self_lockout' };

export function useGuardedAction() {
  const [pending, setPending] = useState(null);   // { kind, data, resolve }

  const run = useCallback(async (fn) => {
    let flags = {};
    // Each confirmation can reveal the next one (turning the switch on may then
    // need "this locks you out"), so loop -- bounded, one per kind.
    for (let i = 0; i < 4; i++) {
      try {
        return await fn(flags);
      } catch (e) {
        const d = e.response?.data;
        const kind = e.response?.status === 409 ? d?.needs_confirm : null;
        if (!kind || !FLAG[kind] || flags[FLAG[kind]]) throw e;
        const yes = await new Promise(resolve => setPending({ kind, data: d, resolve }));
        setPending(null);
        if (!yes) return null;
        flags = { ...flags, [FLAG[kind]]: true };
      }
    }
    return null;
  }, []);

  const dialog = pending
    ? <ConfirmDialog kind={pending.kind} data={pending.data} onAnswer={pending.resolve} />
    : null;
  return { run, dialog };
}

function ConfirmDialog({ kind, data, onAnswer }) {
  const [understood, setUnderstood] = useState(false);
  const needsTick = kind === 'self_lockout';
  const danger = kind !== 'enable';

  const title = {
    enable: 'Turn on IP restriction?',
    empty_allowlist: 'Restrict with an empty allowlist?',
    self_lockout: 'This would lock YOU out',
  }[kind];

  return (
    <Modal isOpen onClose={() => onAnswer(false)} title={title} size="lg">
      <div className="space-y-3 text-sm" style={{ color: 'var(--color-text)' }}>
        {kind === 'enable' && <EnableBody data={data} />}
        {kind === 'empty_allowlist' && (
          <Callout tone="warn" icon={AlertTriangle}>{data?.error}</Callout>
        )}
        {kind === 'self_lockout' && (
          <>
            <Callout tone="danger" icon={ShieldAlert}>{data?.error}</Callout>
            <label className="flex items-start gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={understood} onChange={e => setUnderstood(e.target.checked)}
                style={{ accentColor: 'var(--color-error-600)', width: 16, height: 16, marginTop: 2 }} />
              <span>
                I understand. If IP restriction is on, I will be signed out and cannot sign back in from{' '}
                <strong className="font-mono">{data?.ip || 'this address'}</strong> until someone fixes it.
              </span>
            </label>
          </>
        )}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          <button type="button" onClick={() => onAnswer(false)}
            className="px-4 py-2 rounded-lg text-sm font-semibold"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
            Cancel
          </button>
          <button type="button" disabled={needsTick && !understood} onClick={() => onAnswer(true)}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: danger ? 'var(--color-error-600)' : 'var(--gradient-sidebar, var(--color-primary-600))' }}>
            {kind === 'enable' ? 'Turn it on' : kind === 'empty_allowlist' ? 'Restrict anyway' : 'Save anyway'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function EnableBody({ data }) {
  const s = data?.summary || {};
  const without = s.restricted_without_allow || [];
  return (
    <>
      <p className="m-0">
        The server sees you at <strong className="font-mono">{data?.detected_ip || 'unknown'}</strong>.
        {' '}{data?.would_pass
          ? 'From here you will still get in.'
          : 'From here YOU would be blocked.'}
      </p>
      <Callout tone="warn" icon={AlertTriangle}>
        From now on, every user set to <strong>restricted</strong> can only use the CRM from the networks their rules allow.
        Anyone signed in somewhere else is signed out on their next click. Misconfigured rules can lock people out --
        everyone set to <strong>anywhere</strong> (the default) is unaffected.
      </Callout>
      <p className="m-0 text-[13px]" style={{ color: 'var(--color-text-secondary)' }}>
        {s.restricted_count || 0} restricted user{s.restricted_count === 1 ? '' : 's'} ·
        {' '}{s.global_allow_count || 0} global allow rule{s.global_allow_count === 1 ? '' : 's'} ·
        {' '}{s.global_deny_count || 0} global deny rule{s.global_deny_count === 1 ? '' : 's'}
      </p>
      {without.length > 0 && (
        <Callout tone="danger" icon={ShieldAlert}>
          {without.length} restricted user{without.length === 1 ? ' has' : 's have'} no allowed address and will be blocked everywhere:
          {' '}<strong>{without.slice(0, 8).map(u => u.name).join(', ')}{without.length > 8 ? ` and ${without.length - 8} more` : ''}</strong>.
        </Callout>
      )}
      {(data?.warnings || []).map((w, i) => <Callout key={i} tone="warn" icon={AlertTriangle}>{w}</Callout>)}
      <p className="m-0 text-[12px]" style={{ color: 'var(--color-text-tertiary)' }}>
        Locked out? On the server: <code className="font-mono">npm run ip-access -- disable</code> (in backend/), or set
        {' '}<code className="font-mono">IP_RESTRICTION_FORCE_OFF=true</code> and restart.
      </p>
    </>
  );
}

export function Callout({ tone = 'info', icon: Icon = AlertTriangle, children, className = '' }) {
  const a = accent(tone);
  return (
    <div className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-[13px] ${className}`}
      style={{ background: a.soft, border: `1px solid color-mix(in srgb, ${a.fg} 30%, transparent)`, color: 'var(--color-text)' }}>
      <Icon size={15} className="flex-shrink-0 mt-0.5" style={{ color: a.fg }} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// -- Small shared bits ----------------------------------------------------------------------
export const fmtWhen = (iso) => (iso
  ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—');

export function Pill({ tone = 'muted', children, title }) {
  const a = accent(tone);
  return (
    <span title={title} className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: a.soft, color: a.fg }}>
      {children}
    </span>
  );
}

export const ModePill = ({ mode }) => (mode === 'restricted'
  ? <Pill tone="warn">Restricted</Pill>
  : <Pill tone="muted">Anywhere</Pill>);

export const TypePill = ({ type }) => (type === 'deny'
  ? <Pill tone="danger">Deny</Pill>
  : <Pill tone="success">Allow</Pill>);

export const ResultPill = ({ result }) => (result === 'blocked'
  ? <Pill tone="danger"><XCircle size={11} /> Blocked</Pill>
  : <Pill tone="success"><CheckCircle2 size={11} /> Allowed</Pill>);

// Green = their address would pass, red = it would be blocked, grey = unknown.
export function PassDot({ pass, title }) {
  const tone = pass === true ? 'success' : pass === false ? 'danger' : 'muted';
  const Icon = pass === true ? CheckCircle2 : pass === false ? XCircle : HelpCircle;
  const label = pass === true ? 'Would pass' : pass === false ? 'Would be blocked' : 'No address yet';
  return (
    <span title={title || label} className="inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: accent(tone).fg }}>
      <Icon size={14} /> {label}
    </span>
  );
}
