// ============================================================================
// IpAccessManager -- SuperAdmin -> Access & Governance -> IP Access (mig 319).
//
// Which networks each person may use the CRM from. Everything here is dormant
// until the master switch is on, and even then a user set to "anywhere" (the
// default for everyone) is never checked -- so the safe rollout is: switch on
// with nobody restricted, let real addresses accumulate, then restrict people
// one at a time from what they actually use.
//
// Lockout safety lives on the SERVER (409 needs_confirm); useGuardedAction only
// renders the questions it asks.
// ============================================================================
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Globe, RefreshCw, Wifi, Users, ShieldAlert, ShieldCheck, ListChecks, History, Search, AlertTriangle, Save } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../../api/client';
import Modal from '../../UI/Modal';
import ThemedSelect from '../../UI/Select';
import { Panel, SectionHeader, Loading, EmptyState, KpiTile, PillTabs, TableScroll, Toggle, Field } from '../../UI/kit';
import IpRuleEditor from './IpRuleEditor';
import IpAccessLog from './IpAccessLog';
import UserIpAccessPanel from './UserIpAccessPanel';
import { useGuardedAction, Callout, ModePill, PassDot, Pill, fmtWhen } from './IpAccessShared';

const errText = (e, fallback) => e?.response?.data?.error || fallback;

const TABS = [
  { key: 'users',    label: 'Users',            icon: Users },
  { key: 'global',   label: 'Global rules',     icon: ListChecks },
  { key: 'attempts', label: 'Access attempts',  icon: ShieldAlert },
  { key: 'history',  label: 'Change history',   icon: History },
];

export default function IpAccessManager() {
  const [cfg, setCfg] = useState(null);           // { settings, env, summary }
  const [who, setWho] = useState(null);           // /whoami
  const [list, setList] = useState(null);         // { users, global, settings }
  const [globalRules, setGlobalRules] = useState([]);
  const [history, setHistory] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [tab, setTab] = useState('users');
  const [openUser, setOpenUser] = useState(null);
  const [busy, setBusy] = useState(null);
  const [retention, setRetention] = useState('');
  const [q, setQ] = useState('');
  const [modeFilter, setModeFilter] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const { run, dialog } = useGuardedAction();

  const loadAll = useCallback(async () => {
    const [s, w, u, g] = await Promise.allSettled([
      client.get('ip-access/settings'),
      client.get('ip-access/whoami'),
      client.get('ip-access/users'),
      client.get('ip-access/rules', { params: { scope: 'global' } }),
    ]);
    if (s.status === 'fulfilled') { setCfg(s.value.data); setRetention(String(s.value.data.settings?.log_retention_days ?? 90)); }
    if (w.status === 'fulfilled') setWho(w.value.data);
    if (u.status === 'fulfilled') setList(u.value.data);
    if (g.status === 'fulfilled') setGlobalRules(g.value.data.rules || []);
    const failed = [s, w, u, g].find(x => x.status === 'rejected');
    setLoadErr(failed ? errText(failed.reason, 'Some of this page could not be loaded.') : null);
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const r = await client.get('ip-access/history', { params: { limit: 150 } });
      setHistory(r.data.history || []);
    } catch (e) { setHistory([]); toast.error(errText(e, 'Could not load the change history')); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { if (tab === 'history') loadHistory(); }, [tab, loadHistory]);

  const refreshLists = () => {
    loadAll();
    if (tab === 'history') loadHistory();
  };

  const setSwitch = async (on) => {
    setBusy('switch');
    try {
      const res = await run(flags => client.put('ip-access/settings', { enabled: on, ...flags }));
      if (res) { toast.success(on ? 'IP restriction is ON' : 'IP restriction is OFF'); refreshLists(); }
    } catch (e) { toast.error(errText(e, 'Could not change the switch')); }
    finally { setBusy(null); }
  };

  const saveRetention = async () => {
    const n = Number(retention);
    if (!Number.isInteger(n) || n < 1 || n > 3650) { toast.error('Enter a whole number of days between 1 and 3650.'); return; }
    setBusy('retention');
    try {
      await client.put('ip-access/settings', { log_retention_days: n });
      toast.success(`Access attempts are kept for ${n} days`);
      refreshLists();
    } catch (e) { toast.error(errText(e, 'Could not save')); }
    finally { setBusy(null); }
  };

  const setMode = async (u, mode) => {
    setBusy(`mode:${u.user_id}`);
    try {
      const res = await run(flags => client.put(`ip-access/users/${u.user_id}/mode`, { mode, ...flags }));
      if (res) { toast.success(`${u.name || u.email}: ${mode === 'anywhere' ? 'allowed from anywhere' : 'restricted'}`); refreshLists(); }
    } catch (e) { toast.error(errText(e, 'Could not change the access mode')); }
    finally { setBusy(null); }
  };

  const users = list?.users || [];
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return users.filter(u => {
      if (!showInactive && !u.is_active) return false;
      if (modeFilter && u.ip_access_mode !== modeFilter) return false;
      if (!needle) return true;
      return [u.name, u.email, u.company_name, u.role_name, u.last_seen_ip, u.last_login_ip]
        .some(v => String(v || '').toLowerCase().includes(needle));
    });
  }, [users, q, modeFilter, showInactive]);

  const restricted = users.filter(u => u.ip_access_mode === 'restricted' && !u.is_superadmin);
  const noAllow = restricted.filter(u => u.warning === 'no_allow_rules');
  const wouldBlock = restricted.filter(u => u.would_pass === false);

  if (!cfg && !loadErr) return <Loading variant="cards" cards={3} label="Loading IP access…" />;

  const settings = cfg?.settings || {};
  const env = cfg?.env || {};

  return (
    <div className="space-y-5">
      {dialog}
      <SectionHeader
        level="page"
        icon={Globe}
        title="IP Access"
        subtitle="Which networks each person may use the CRM from. Off by default -- and everyone is set to 'anywhere' until you restrict them."
        actions={(
          <button type="button" onClick={refreshLists}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
            <RefreshCw size={14} /> Reload
          </button>
        )}
      />

      {loadErr && <Callout tone="danger">{loadErr}</Callout>}
      {env.force_off && (
        <Callout tone="danger" icon={ShieldAlert}>
          <strong>IP_RESTRICTION_FORCE_OFF</strong> is set on the server, so nothing is enforced whatever the switch below says.
          Remove it from the backend environment and restart to let the switch take effect.
        </Callout>
      )}

      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        {/* Master switch */}
        <Panel pad="lg" className="space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <Toggle
              checked={!!settings.enabled}
              busy={busy === 'switch'}
              tone={settings.enabled ? 'warn' : 'primary'}
              onChange={setSwitch}
              label="Restrict CRM access by IP address"
              hint={settings.enabled
                ? 'ON: restricted users can only sign in and work from networks their rules allow.'
                : 'OFF: the CRM behaves exactly as if this feature did not exist.'}
            />
            {settings.effective_enabled
              ? <Pill tone="warn"><ShieldCheck size={11} /> Enforcing</Pill>
              : <Pill tone="muted">Not enforcing</Pill>}
          </div>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] items-end pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
            <Field label="Keep access attempts for (days)" hint="Older attempts are deleted automatically.">
              <input type="number" min={1} max={3650} value={retention} onChange={e => setRetention(e.target.value)} className="input w-full" />
            </Field>
            <button type="button" onClick={saveRetention} disabled={busy === 'retention' || String(settings.log_retention_days) === retention}
              className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
              <Save size={14} /> Save
            </button>
          </div>
          <p className="m-0 text-[12px]" style={{ color: 'var(--color-text-tertiary)' }}>
            Superadmins are never blocked. Locked out anyway? On the server run <code className="font-mono">npm run ip-access -- disable</code>
            {' '}in backend/ (takes effect within a minute), or set <code className="font-mono">IP_RESTRICTION_FORCE_OFF=true</code> and restart.
          </p>
        </Panel>

        {/* Your connection */}
        <Panel pad="lg" className="space-y-3">
          <p className="m-0 text-[10px] font-bold uppercase tracking-wider leading-none flex items-center gap-1" style={{ color: 'var(--color-text-secondary)' }}>
            <Wifi size={11} /> Your connection, as the server sees it
          </p>
          <p className="m-0 font-mono font-bold" style={{ color: 'var(--color-text)', fontSize: 'clamp(20px, 4vw, 26px)' }}>{who?.ip || '—'}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <PassDot pass={who ? !!who.would_pass : null} title={who?.verdict?.reason} />
            {who?.verdict?.reason && <span className="text-[12px]" style={{ color: 'var(--color-text-tertiary)' }}>({who.verdict.reason})</span>}
          </div>
          <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>
            <dt>Connected from</dt>
            <dd className="m-0 font-mono truncate">{who?.peer_ip || '—'} {who ? (who.peer_trusted ? '(trusted proxy)' : '(not a trusted proxy)') : ''}</dd>
            <dt>Address header</dt>
            <dd className="m-0 font-mono">{env.client_header || who?.header || 'x-forwarded-for'}</dd>
            <dt>Trusted proxies</dt>
            <dd className="m-0 font-mono truncate">{(env.trusted_proxies || []).join(', ') || 'none (IP_TRUSTED_PROXIES not set)'}</dd>
          </dl>
          {(who?.warnings || []).map((w, i) => <Callout key={i} tone="warn" icon={AlertTriangle}>{w}</Callout>)}
          {who && !who.warnings?.length && (
            <p className="m-0 text-[12px]" style={{ color: 'var(--color-text-tertiary)' }}>
              If this is not the address your network shows on a "what is my IP" site, fix the proxy settings before restricting anyone.
            </p>
          )}
        </Panel>
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <KpiTile icon={Users} label="Restricted users" value={restricted.length} tone="warn"
          onClick={() => { setTab('users'); setModeFilter(modeFilter === 'restricted' ? '' : 'restricted'); }} active={modeFilter === 'restricted'} />
        <KpiTile icon={ShieldAlert} label="No allowed address" value={noAllow.length} tone={noAllow.length ? 'danger' : 'muted'}
          sub={noAllow.length ? 'Blocked everywhere when on' : 'None'} />
        <KpiTile icon={AlertTriangle} label="Last address fails" value={wouldBlock.length} tone={wouldBlock.length ? 'danger' : 'muted'}
          sub="Restricted, last seen outside their rules" />
        <KpiTile icon={ListChecks} label="Global rules" value={(list?.global?.allow || 0) + (list?.global?.deny || 0)} tone="info"
          sub={`${list?.global?.allow || 0} allow · ${list?.global?.deny || 0} deny`} onClick={() => setTab('global')} />
      </div>

      <PillTabs value={tab} onChange={setTab} items={TABS} />

      {tab === 'users' && (
        <Panel pad="lg" className="space-y-3">
          <div className="flex items-end gap-2 flex-wrap">
            <Field label="Search" className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-text-tertiary)' }} />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Name, email, company or address" className="input w-full pl-9" />
              </div>
            </Field>
            <Field label="Access mode" className="w-[170px]">
              <ThemedSelect value={modeFilter} onChange={e => setModeFilter(e.target.value)} className="input w-full">
                <option value="">All</option>
                <option value="restricted">Restricted</option>
                <option value="anywhere">Anywhere</option>
              </ThemedSelect>
            </Field>
            <Toggle checked={showInactive} onChange={setShowInactive} label="Show inactive" className="pb-2" />
          </div>

          {!list ? <Loading variant="rows" rows={6} /> : visible.length === 0 ? (
            <EmptyState title="No users match" hint="Clear the search or the filters." />
          ) : (
            <TableScroll label="Users and their IP access" stickyFirst>
              <table className="w-full text-[13px]">
                <thead>
                  <tr style={{ color: 'var(--color-text-secondary)' }}>
                    <th className="text-left font-semibold py-2 pr-3">User</th>
                    <th className="text-left font-semibold py-2 pr-3">Allow from anywhere</th>
                    <th className="text-left font-semibold py-2 pr-3">Rules</th>
                    <th className="text-left font-semibold py-2 pr-3">Last seen address</th>
                    <th className="text-left font-semibold py-2 pr-3">Last seen</th>
                    <th className="text-left font-semibold py-2">That address</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(u => (
                    <tr key={u.user_id} onClick={() => setOpenUser(u.user_id)} className="cursor-pointer"
                      style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                      <td className="py-2 pr-3 min-w-[200px]">
                        <p className="m-0 font-semibold truncate" style={{ color: 'var(--color-text)' }}>{u.name || u.email}</p>
                        <p className="m-0 text-[12px] truncate" style={{ color: 'var(--color-text-tertiary)' }}>
                          {u.email}{u.company_name ? ` · ${u.company_name}` : ''}{u.role_name ? ` · ${u.role_name}` : ''}{u.is_active ? '' : ' · inactive'}
                        </p>
                      </td>
                      <td className="py-2 pr-3" onClick={e => e.stopPropagation()}>
                        {u.is_superadmin ? <Pill tone="info">Superadmin -- always</Pill> : (
                          <div className="flex items-center gap-2">
                            <Toggle checked={u.ip_access_mode !== 'restricted'} busy={busy === `mode:${u.user_id}`}
                              label={u.ip_access_mode !== 'restricted' ? 'Anywhere' : 'Restricted'}
                              onChange={(on) => setMode(u, on ? 'anywhere' : 'restricted')} />
                            {u.warning === 'no_allow_rules' && (
                              <span title="Restricted with no allowed address -- blocked everywhere while IP restriction is on">
                                <AlertTriangle size={15} style={{ color: 'var(--color-error-600)' }} />
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {u.rule_counts.allow + u.rule_counts.deny === 0
                          ? <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>
                          : <span>{u.rule_counts.allow} allow · {u.rule_counts.deny} deny</span>}
                        {u.rule_counts.inactive > 0 && <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}> (+{u.rule_counts.inactive} off)</span>}
                      </td>
                      <td className="py-2 pr-3 font-mono whitespace-nowrap">{u.last_seen_ip || u.last_login_ip || '—'}</td>
                      <td className="py-2 pr-3 whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>{fmtWhen(u.last_seen_at || u.last_login_at)}</td>
                      <td className="py-2 whitespace-nowrap"><PassDot pass={u.would_pass} title={u.verdict?.reason} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
          <p className="m-0 text-[12px]" style={{ color: 'var(--color-text-tertiary)' }}>
            "That address" answers: would this person get in from where they last connected, if IP restriction were on?
            Addresses are recorded while the switch is on. <ModePill mode="anywhere" /> users always pass.
          </p>
        </Panel>
      )}

      {tab === 'global' && (
        <Panel pad="lg" className="space-y-3">
          <Callout tone="info" icon={Globe}>
            Global rules apply to <strong>every restricted user</strong>. A global allow rule (your office, say) lets any restricted user in from
            there; a global deny rule blocks an address for all of them. Deny always wins. Users set to anywhere are never checked.
          </Callout>
          <IpRuleEditor userId={null} rules={globalRules} run={run} onChanged={refreshLists}
            emptyHint="No global rules. Add your office network here to allow every restricted user in from it." />
        </Panel>
      )}

      {tab === 'attempts' && (
        <Panel pad="lg">
          <IpAccessLog users={users} onOpenUser={setOpenUser} />
        </Panel>
      )}

      {tab === 'history' && (
        <Panel pad="lg">
          {!history ? <Loading variant="rows" rows={6} /> : history.length === 0 ? (
            <EmptyState title="No changes yet" hint="Every change to the switch, an access mode or a rule is recorded here." />
          ) : (
            <TableScroll label="IP access change history">
              <table className="w-full text-[13px]">
                <thead>
                  <tr style={{ color: 'var(--color-text-secondary)' }}>
                    <th className="text-left font-semibold py-2 pr-3">When</th>
                    <th className="text-left font-semibold py-2 pr-3">Change</th>
                    <th className="text-left font-semibold py-2 pr-3">For</th>
                    <th className="text-left font-semibold py-2">By</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(h => (
                    <tr key={h.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                      <td className="py-2 pr-3 whitespace-nowrap">{fmtWhen(h.changed_at)}</td>
                      <td className="py-2 pr-3" style={{ color: 'var(--color-text)' }}>{h.summary}</td>
                      <td className="py-2 pr-3">
                        {h.subject_user_id
                          ? <button type="button" className="hover:underline" style={{ color: 'var(--color-primary-600)' }} onClick={() => setOpenUser(h.subject_user_id)}>{h.subject_name || 'user'}</button>
                          : <span style={{ color: 'var(--color-text-tertiary)' }}>{h.table_name === 'business_config' ? 'Whole CRM' : 'Everyone (global)'}</span>}
                      </td>
                      <td className="py-2" style={{ color: 'var(--color-text-secondary)' }}>{h.changed_by_name || 'system'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </Panel>
      )}

      <Modal isOpen={!!openUser} onClose={() => setOpenUser(null)} title="IP access" size="2xl">
        {openUser && <UserIpAccessPanel userId={openUser} onChanged={refreshLists} />}
      </Modal>
    </div>
  );
}
