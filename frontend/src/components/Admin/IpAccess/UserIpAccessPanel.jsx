// ============================================================================
// UserIpAccessPanel -- one user's IP access (mig 319): the "allow access from
// anywhere" switch, their allow/deny rules, where they last connected from,
// whether that would pass, their recent attempts and the change history.
//
// Mounted in the IP Access tab (from the users table) and in the User Control
// Center, so the same controls appear wherever a superadmin looks at a person.
// ============================================================================
import { useState, useEffect, useCallback } from 'react';
import { Globe, MapPin, LogIn, Plus, ShieldCheck, History, ListChecks } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../../api/client';
import { Panel, Loading, Toggle, EmptyState, TableScroll } from '../../UI/kit';
import IpRuleEditor from './IpRuleEditor';
import { useGuardedAction, Callout, ModePill, PassDot, ResultPill, TypePill, Pill, fmtWhen } from './IpAccessShared';

const errText = (e, fallback) => e?.response?.data?.error || fallback;

function Stat({ icon: Icon, label, ip, when }) {
  return (
    <div className="rounded-xl px-3 py-2.5 min-w-0" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
      <p className="m-0 text-[10px] font-bold uppercase tracking-wider leading-none flex items-center gap-1" style={{ color: 'var(--color-text-secondary)' }}>
        <Icon size={11} /> {label}
      </p>
      <p className="m-0 mt-1.5 font-mono text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{ip || '—'}</p>
      <p className="m-0 mt-0.5 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{when ? fmtWhen(when) : 'never recorded'}</p>
    </div>
  );
}

export default function UserIpAccessPanel({ userId, onChanged }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const { run, dialog } = useGuardedAction();

  const load = useCallback(async () => {
    try {
      const r = await client.get(`ip-access/users/${userId}`);
      setD(r.data);
      setErr(null);
    } catch (e) { setErr(errText(e, 'Could not load this user.')); }
  }, [userId]);

  useEffect(() => { setD(null); load(); }, [load]);

  const changed = () => { load(); onChanged?.(); };

  const setMode = async (mode) => {
    setBusy('mode');
    try {
      const res = await run(flags => client.put(`ip-access/users/${userId}/mode`, { mode, ...flags }));
      if (res) {
        toast.success(mode === 'anywhere' ? 'Allowed from anywhere' : 'Restricted to allowed networks');
        changed();
      }
    } catch (e) { toast.error(errText(e, 'Could not change the access mode')); }
    finally { setBusy(null); }
  };

  const addCurrent = async (source) => {
    setBusy(source);
    try {
      const r = await client.post(`ip-access/users/${userId}/rules/from-current`, { source });
      toast.success(r.data?.note || `Allowed ${r.data?.rule?.ip_value}`);
      changed();
    } catch (e) { toast.error(errText(e, 'Could not add the address')); }
    finally { setBusy(null); }
  };

  if (err) return <Callout tone="danger">{err}</Callout>;
  if (!d) return <Loading variant="rows" rows={5} label="Loading IP access…" />;

  const { user, access, settings } = d;
  const anywhere = access.ip_access_mode !== 'restricted';
  const seenIp = access.last_seen_ip || access.last_login_ip;
  const verdict = anywhere ? d.verdict_if_restricted : d.verdict_last_seen;
  const activeGlobals = (d.global_rules || []).filter(r => r.is_active);

  return (
    <div className="space-y-4">
      {dialog}

      {/* Who */}
      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="m-0 text-base font-bold truncate" style={{ color: 'var(--color-text)' }}>{user.name || user.email}</p>
          <p className="m-0 text-[13px] truncate" style={{ color: 'var(--color-text-secondary)' }}>
            {user.email}{user.role_name ? ` · ${user.role_name}` : ''}{user.company_name ? ` · ${user.company_name}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <ModePill mode={access.ip_access_mode} />
          {user.is_superadmin && <Pill tone="info">Superadmin -- always allowed</Pill>}
          {d.has_bypass && <Pill tone="info">Has bypass permission</Pill>}
        </div>
      </div>

      {!settings?.effective_enabled && (
        <Callout tone="info" icon={ShieldCheck}>
          IP restriction is currently <strong>off</strong> for the whole CRM. These settings are saved now and apply the moment it is turned on.
        </Callout>
      )}
      {user.is_superadmin && (
        <Callout tone="info" icon={ShieldCheck}>
          Superadmins always bypass IP restriction, whatever is set here. That cannot be switched off -- it is what makes recovery possible.
        </Callout>
      )}

      {/* The one-click choice */}
      <Panel tone="inset" pad="md">
        <Toggle
          checked={anywhere}
          busy={busy === 'mode'}
          onChange={(on) => setMode(on ? 'anywhere' : 'restricted')}
          label="Allow access from anywhere"
          hint={anywhere
            ? 'On: this person can use the CRM from any network, even while IP restriction is on.'
            : 'Off: only from the addresses allowed below (and any global allow rule). Everything else is refused.'}
        />
      </Panel>

      {d.warning === 'no_allow_rules' && (
        <Callout tone="danger">
          <strong>No permitted addresses.</strong> This user is restricted but nothing is allowed for them (and there is no global allow rule),
          so they are blocked from every network while IP restriction is on. Add an address below, or switch them back to anywhere.
        </Callout>
      )}

      {/* Where they connect from */}
      <div className="grid gap-2 grid-cols-1 sm:grid-cols-3">
        <Stat icon={MapPin} label="Last seen" ip={access.last_seen_ip} when={access.last_seen_at} />
        <Stat icon={LogIn} label="Last login" ip={access.last_login_ip} when={access.last_login_at} />
        <div className="rounded-xl px-3 py-2.5 min-w-0" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
          <p className="m-0 text-[10px] font-bold uppercase tracking-wider leading-none" style={{ color: 'var(--color-text-secondary)' }}>
            {anywhere ? 'If restricted' : 'Their last address'}
          </p>
          <div className="mt-1.5">
            {user.is_superadmin
              ? <PassDot pass title="Superadmins always pass" />
              : <PassDot pass={seenIp ? !!verdict?.allowed : null} title={verdict?.reason} />}
          </div>
          {verdict && !user.is_superadmin && seenIp && (
            <p className="m-0 mt-0.5 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{verdict.reason}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" disabled={!seenIp || !!busy} onClick={() => addCurrent('last_seen')}
          title={seenIp ? `Allow ${seenIp} for this user` : 'No address recorded yet -- addresses are recorded once IP restriction is on'}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
          <Plus size={14} /> Add current IP{seenIp ? ` (${seenIp})` : ''}
        </button>
        {d.viewer_is_self && d.viewer_ip && (
          <button type="button" disabled={!!busy} onClick={() => addCurrent('request')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
            <Plus size={14} /> Add my address right now ({d.viewer_ip})
          </button>
        )}
      </div>

      {/* Rules */}
      <section className="space-y-2">
        <h4 className="m-0 text-sm font-bold flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
          <ListChecks size={15} /> Rules for this user
        </h4>
        <IpRuleEditor userId={userId} rules={d.rules || []} run={run} onChanged={changed}
          emptyHint="Allow the networks this person works from. Deny rules win over allow rules." />
        {activeGlobals.length > 0 && (
          <div className="rounded-xl px-3 py-2" style={{ background: 'var(--color-bg)', border: '1px dashed var(--color-border)' }}>
            <p className="m-0 text-[12px] font-semibold flex items-center gap-1.5" style={{ color: 'var(--color-text-secondary)' }}>
              <Globe size={13} /> Global rules also apply to this user when restricted:
            </p>
            <div className="flex flex-wrap gap-2 mt-1.5">
              {activeGlobals.map(r => (
                <span key={r.id} className="inline-flex items-center gap-1.5 text-[12px]">
                  <TypePill type={r.type} /> <span className="font-mono">{r.ip_value}</span>
                  {r.label && <span style={{ color: 'var(--color-text-tertiary)' }}>({r.label})</span>}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Attempts */}
      <section className="space-y-2">
        <h4 className="m-0 text-sm font-bold" style={{ color: 'var(--color-text)' }}>Recent access attempts</h4>
        {(d.recent_attempts || []).length === 0 ? (
          <EmptyState compact title="Nothing recorded" hint="Logins and blocked requests appear here while IP restriction is on." />
        ) : (
          <TableScroll label="Recent access attempts">
            <table className="w-full text-[13px]">
              <thead>
                <tr style={{ color: 'var(--color-text-secondary)' }}>
                  <th className="text-left font-semibold py-1.5 pr-3">When</th>
                  <th className="text-left font-semibold py-1.5 pr-3">Address</th>
                  <th className="text-left font-semibold py-1.5 pr-3">Result</th>
                  <th className="text-left font-semibold py-1.5 pr-3">Event</th>
                  <th className="text-left font-semibold py-1.5">Reason</th>
                </tr>
              </thead>
              <tbody>
                {d.recent_attempts.map(a => (
                  <tr key={a.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{fmtWhen(a.created_at)}</td>
                    <td className="py-1.5 pr-3 font-mono">{a.ip_address || '—'}</td>
                    <td className="py-1.5 pr-3"><ResultPill result={a.result} /></td>
                    <td className="py-1.5 pr-3">{a.event}</td>
                    <td className="py-1.5" style={{ color: 'var(--color-text-secondary)' }}>{a.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </section>

      {/* History */}
      <section className="space-y-2">
        <h4 className="m-0 text-sm font-bold flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
          <History size={15} /> Change history
        </h4>
        {(d.history || []).length === 0 ? (
          <EmptyState compact title="No changes yet" />
        ) : (
          <ul className="m-0 p-0 list-none space-y-1">
            {d.history.map(h => (
              <li key={h.id} className="text-[13px] flex items-baseline gap-2 flex-wrap">
                <span className="whitespace-nowrap text-[12px]" style={{ color: 'var(--color-text-tertiary)' }}>{fmtWhen(h.changed_at)}</span>
                <span style={{ color: 'var(--color-text)' }}>{h.summary}</span>
                <span className="text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>by {h.changed_by_name || 'system'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
