import { useState, useEffect, useCallback } from 'react';
import {
  Plug, KeyRound, Send, Plus, Copy, Trash2, RefreshCw, Loader2, AlertTriangle, ExternalLink,
  CheckCircle2, CircleSlash, Play, ScrollText, Boxes, ShieldOff, Link2, Pencil, Server, UploadCloud,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button, Alert } from '../../UI';
import client from '../../../api/client';
import { Loading, SectionHeader, PillTabs, Panel, EmptyState, TableScroll, Toggle, CheckRow } from '../../UI/kit';

// ============================================================================
// ConnectionsManager -- let any other app connect to the CRM (migration 348).
//
//   Keys      API keys for the machine API (/api/ext/v1). The key is shown
//             ONCE, at creation; only its hash is kept.
//   Webhooks  URLs the CRM POSTs events to (sale.approved, transfer.created,
//             ...), signed with a secret that is also shown once.
//   External  the two "runs in another app" switches (external_hr /
//             external_qa), per company, through the existing feature-flag API.
//   Outgoing  links FROM the CRM to other apps (migration 349). Today: the
//             hourly approved-sales push to each HR company. Links set up
//             here need no server change; HRMS_URL / HRMS_API_KEYS ones are
//             shown read-only.
//
// Superadmin only (AdminPanel + routes/connections.js). How another app uses
// all this: docs/CONNECTIONS.md.
// ============================================================================

const TABS = [
  { key: 'keys',     label: 'API keys',         icon: KeyRound },
  { key: 'webhooks', label: 'Webhooks',         icon: Send },
  { key: 'external', label: 'External modules', icon: Boxes },
  { key: 'outgoing', label: 'Outgoing links',   icon: Link2 },
];

const copy = (text, what = 'Copied') => {
  navigator.clipboard?.writeText(text).then(
    () => toast.success(what),
    () => toast.error('Could not copy — select it by hand'),
  );
};

const when = (iso) => (iso ? new Date(iso).toLocaleString() : '—');
const errMsg = (e, fallback) => e.response?.data?.error || fallback;

const Pill = ({ tone = 'muted', children }) => {
  const t = {
    ok:    { bg: 'var(--color-success-100, #dcfce7)', fg: 'var(--color-success-700, #15803d)' },
    bad:   { bg: 'var(--color-danger-100, #fee2e2)',  fg: 'var(--color-danger-700, #b91c1c)' },
    warn:  { bg: 'var(--color-warning-100, #fef3c7)', fg: 'var(--color-warning-700, #b45309)' },
    muted: { bg: 'var(--color-bg-tertiary)',          fg: 'var(--color-text-secondary)' },
  }[tone];
  return <span className="px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap" style={{ background: t.bg, color: t.fg }}>{children}</span>;
};

const Label = ({ children }) => (
  <span className="block mb-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>{children}</span>
);

/** A value the operator must copy now: it is never shown again. */
const ShownOnce = ({ title, value, hint, onDone }) => (
  <Panel className="p-4 space-y-2" style={{ border: '1px solid var(--color-warning-300, #fcd34d)' }}>
    <div className="flex items-center gap-2">
      <AlertTriangle size={15} style={{ color: 'var(--color-warning-600, #d97706)' }} />
      <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{title}</span>
    </div>
    <p className="text-xs m-0" style={{ color: 'var(--color-text-secondary)' }}>{hint}</p>
    <div className="flex items-center gap-2 flex-wrap">
      <code className="text-xs px-2 py-1.5 rounded-lg break-all flex-1 min-w-0"
        style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
        {value}
      </code>
      <Button size="sm" onClick={() => copy(value, 'Copied — store it somewhere safe')}><Copy size={13} /> Copy</Button>
      <Button size="sm" variant="secondary" onClick={onDone}>I have saved it</Button>
    </div>
  </Panel>
);

/** null = all companies, else a list of ids. */
const CompanyPicker = ({ companies, value, onChange }) => {
  const all = value == null;
  const set = new Set(value || []);
  return (
    <div className="space-y-1">
      <CheckRow checked={all} onChange={(on) => onChange(on ? null : [])} label="All companies" strong
        hint="including companies added later" />
      {!all && (
        <div className="grid gap-x-4 pl-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
          {companies.map(c => (
            <CheckRow key={c.id} checked={set.has(c.id)} label={c.name}
              onChange={(on) => {
                const next = new Set(set);
                if (on) next.add(c.id); else next.delete(c.id);
                onChange([...next]);
              }} />
          ))}
        </div>
      )}
    </div>
  );
};

const companyText = (ids, companies) => {
  if (ids == null) return 'All companies';
  if (!ids.length) return 'No companies';
  const names = ids.map(id => companies.find(c => c.id === id)?.name || id.slice(0, 8));
  return names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3}` : names.join(', ');
};

// ── Keys ────────────────────────────────────────────────────────────────────
const KeysTab = ({ catalog, companies }) => {
  const [keys, setKeys] = useState(null);
  const [adding, setAdding] = useState(false);
  const [shown, setShown] = useState(null);
  const [f, setF] = useState({ name: '', scopes: [], company_ids: null });
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    client.get('connections/keys').then(r => setKeys(r.data.keys || [])).catch(e => { setKeys([]); toast.error(errMsg(e, 'Could not load keys')); });
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const toggleScope = (k, on) => setF(p => ({ ...p, scopes: on ? [...new Set([...p.scopes, k])] : p.scopes.filter(s => s !== k) }));

  const create = async () => {
    if (!f.name.trim()) return toast.error('Give the key a name (the app it is for)');
    if (!f.scopes.length) return toast.error('Pick at least one scope');
    if (Array.isArray(f.company_ids) && !f.company_ids.length) return toast.error('Pick at least one company, or All companies');
    setBusy(true);
    try {
      const r = await client.post('connections/keys', { name: f.name.trim(), scopes: f.scopes, company_ids: f.company_ids });
      setShown({ name: r.data.key.name, secret: r.data.secret });
      setAdding(false);
      setF({ name: '', scopes: [], company_ids: null });
      reload();
    } catch (e) { toast.error(errMsg(e, 'Could not create the key')); }
    finally { setBusy(false); }
  };

  const revoke = async (k) => {
    if (!window.confirm(`Revoke "${k.name}"?\n\nEvery app using this key loses access immediately. This cannot be undone — you would create a new key instead.`)) return;
    try { await client.post(`connections/keys/${k.id}/revoke`); toast.success('Key revoked'); reload(); }
    catch (e) { toast.error(errMsg(e, 'Could not revoke')); }
  };

  return (
    <div className="space-y-4">
      {shown && (
        <ShownOnce title={`API key for ${shown.name}`} value={shown.secret} onDone={() => setShown(null)}
          hint="Copy it now and paste it into the other app. The CRM keeps only a fingerprint of it, so it cannot be shown again — if it is lost, revoke it and create a new one." />
      )}

      {adding ? (
        <Panel className="p-4 space-y-4">
          <label className="block text-sm" style={{ maxWidth: 420 }}>
            <Label>Name</Label>
            <input className="input w-full" value={f.name} onChange={e => setF(p => ({ ...p, name: e.target.value }))}
              placeholder="HRMS — hr.vertexpakistan.com" maxLength={100} />
          </label>
          <div>
            <Label>What may it do?</Label>
            <div className="grid gap-x-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
              {catalog.scopes.map(s => (
                <CheckRow key={s.key} checked={f.scopes.includes(s.key)} onChange={(on) => toggleScope(s.key, on)}
                  label={s.label} hint={s.key} />
              ))}
            </div>
          </div>
          <div>
            <Label>Which companies?</Label>
            <CompanyPicker companies={companies} value={f.company_ids} onChange={(v) => setF(p => ({ ...p, company_ids: v }))} />
          </div>
          <div className="flex gap-2">
            <Button onClick={create} loading={busy}><KeyRound size={14} /> Create key</Button>
            <Button variant="secondary" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </Panel>
      ) : (
        <div className="flex justify-end">
          <Button onClick={() => setAdding(true)}><Plus size={14} /> New API key</Button>
        </div>
      )}

      {keys === null ? <Loading variant="rows" rows={3} /> : !keys.length ? (
        <EmptyState icon={KeyRound} title="No API keys yet"
          hint="Create one per app that reads from the CRM (the HRMS, the QA platform, a report). Each gets only the scopes it needs." />
      ) : (
        <Panel pad="none" className="overflow-hidden">
          <TableScroll label="API keys">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Key</th>
                  <th className="px-4 py-2 font-medium">Scopes</th>
                  <th className="px-4 py-2 font-medium">Companies</th>
                  <th className="px-4 py-2 font-medium">Last used</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {keys.map(k => (
                  <tr key={k.id} style={{ borderTop: '1px solid var(--color-border)', opacity: k.revoked_at ? 0.6 : 1 }}>
                    <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--color-text)' }}>{k.name}</td>
                    <td className="px-4 py-2.5"><code className="text-xs">{k.key_prefix}…</code></td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">{(k.scopes || []).map(s => <Pill key={s}>{s}</Pill>)}</div>
                    </td>
                    <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{companyText(k.company_ids, companies)}</td>
                    <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{k.last_used_at ? when(k.last_used_at) : 'never'}</td>
                    <td className="px-4 py-2.5">{k.revoked_at ? <Pill tone="bad">revoked {new Date(k.revoked_at).toLocaleDateString()}</Pill> : <Pill tone="ok">active</Pill>}</td>
                    <td className="px-4 py-2.5 text-right">
                      {!k.revoked_at && (
                        <Button size="xs" variant="ghost" onClick={() => revoke(k)}><ShieldOff size={13} /> Revoke</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Panel>
      )}
    </div>
  );
};

// ── Webhooks ────────────────────────────────────────────────────────────────
const EventPicker = ({ events, value, onChange }) => {
  const set = new Set(value);
  const all = set.has('*');
  const groups = [...new Set(events.filter(e => e.group !== 'system').map(e => e.group))];
  const toggle = (k, on) => {
    const next = new Set(set);
    if (on) next.add(k); else next.delete(k);
    onChange([...next]);
  };
  return (
    <div className="space-y-2">
      <CheckRow checked={all} onChange={(on) => onChange(on ? ['*'] : [])} label="Everything" strong hint="* — including events added later" />
      {!all && groups.map(g => {
        const wild = `${g}.*`;
        const groupAll = set.has(wild);
        return (
          <div key={g} className="pl-6">
            <CheckRow checked={groupAll} onChange={(on) => toggle(wild, on)} label={`Every ${g} event`} strong hint={wild} />
            {!groupAll && (
              <div className="grid gap-x-4 pl-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
                {events.filter(e => e.group === g).map(e => (
                  <CheckRow key={e.key} checked={set.has(e.key)} onChange={(on) => toggle(e.key, on)} label={e.key} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

const WebhookEditor = ({ hook, catalog, companies, onSaved, onCancel }) => {
  const isNew = !hook;
  const [f, setF] = useState({
    name: hook?.name || '', url: hook?.url || '',
    events: hook?.events || ['sale.*'], company_ids: hook ? hook.company_ids : null,
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!f.name.trim()) return toast.error('Give the webhook a name');
    if (!/^https?:\/\//i.test(f.url.trim())) return toast.error('The URL must start with https://');
    if (!f.events.length) return toast.error('Pick at least one event');
    if (Array.isArray(f.company_ids) && !f.company_ids.length) return toast.error('Pick at least one company, or All companies');
    setBusy(true);
    try {
      const body = { name: f.name.trim(), url: f.url.trim(), events: f.events, company_ids: f.company_ids };
      if (isNew) {
        const r = await client.post('connections/webhooks', body);
        onSaved({ name: r.data.webhook.name, secret: r.data.secret });
      } else {
        await client.patch(`connections/webhooks/${hook.id}`, body);
        toast.success('Saved');
        onSaved(null);
      }
    } catch (e) { toast.error(errMsg(e, 'Save failed')); }
    finally { setBusy(false); }
  };

  return (
    <Panel className="p-4 space-y-4">
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        <label className="text-sm">
          <Label>Name</Label>
          <input className="input w-full" value={f.name} onChange={e => setF(p => ({ ...p, name: e.target.value }))}
            placeholder="HRMS — sale events" maxLength={100} />
        </label>
        <label className="text-sm">
          <Label>URL the CRM will POST to</Label>
          <input className="input w-full" value={f.url} onChange={e => setF(p => ({ ...p, url: e.target.value }))}
            placeholder="https://hr.vertexpakistan.com/api/v1/connect/crm/webhook" />
        </label>
      </div>
      <div>
        <Label>Events</Label>
        <EventPicker events={catalog.events} value={f.events} onChange={(v) => setF(p => ({ ...p, events: v }))} />
      </div>
      <div>
        <Label>Which companies' events?</Label>
        <CompanyPicker companies={companies} value={f.company_ids} onChange={(v) => setF(p => ({ ...p, company_ids: v }))} />
      </div>
      <div className="flex gap-2">
        <Button onClick={save} loading={busy}>{isNew ? <><Plus size={14} /> Create webhook</> : 'Save'}</Button>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </Panel>
  );
};

const deliveryTone = { delivered: 'ok', failed: 'bad', retrying: 'warn', pending: 'muted' };

const Deliveries = ({ hook }) => {
  const [rows, setRows] = useState(null);
  const load = useCallback(() => {
    client.get(`connections/webhooks/${hook.id}/deliveries`, { params: { limit: 50 } })
      .then(r => setRows(r.data.deliveries || [])).catch(() => setRows([]));
  }, [hook.id]);
  useEffect(() => { load(); }, [load]);

  const retry = async (d) => {
    try { await client.post(`connections/deliveries/${d.id}/retry`); toast.success('Queued — it goes out within 30 seconds'); load(); }
    catch (e) { toast.error(errMsg(e, 'Could not retry')); }
  };

  if (rows === null) return <Loading variant="rows" rows={2} />;
  if (!rows.length) return <EmptyState compact icon={ScrollText} title="Nothing sent yet" hint="Press Test, or wait for the next matching event." />;
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button size="xs" variant="ghost" onClick={load}><RefreshCw size={12} /> Refresh</Button>
      </div>
      <TableScroll label="Deliveries">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left" style={{ color: 'var(--color-text-tertiary)' }}>
              <th className="px-3 py-1.5 font-medium">When</th>
              <th className="px-3 py-1.5 font-medium">Event</th>
              <th className="px-3 py-1.5 font-medium">State</th>
              <th className="px-3 py-1.5 font-medium">HTTP</th>
              <th className="px-3 py-1.5 font-medium">Tries</th>
              <th className="px-3 py-1.5 font-medium">Detail</th>
              <th className="px-3 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map(d => (
              <tr key={d.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                <td className="px-3 py-1.5 whitespace-nowrap">{when(d.created_at)}</td>
                <td className="px-3 py-1.5"><code>{d.event}</code></td>
                <td className="px-3 py-1.5"><Pill tone={deliveryTone[d.state]}>{d.state}</Pill></td>
                <td className="px-3 py-1.5">{d.last_status ?? '—'}</td>
                <td className="px-3 py-1.5">{d.attempts}</td>
                <td className="px-3 py-1.5 max-w-xs truncate" title={d.last_error || ''} style={{ color: 'var(--color-text-secondary)' }}>
                  {d.last_error || (d.state === 'retrying' ? `next try ${when(d.next_attempt_at)}` : d.record_id ? `record ${d.record_id.slice(0, 8)}…` : '')}
                </td>
                <td className="px-3 py-1.5 text-right">
                  {!d.delivered_at && (d.state === 'failed' || d.state === 'retrying') && (
                    <Button size="xs" variant="ghost" onClick={() => retry(d)}>Retry now</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </div>
  );
};

const WebhooksTab = ({ catalog, companies }) => {
  const [hooks, setHooks] = useState(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(null);
  const [shown, setShown] = useState(null);
  const [busy, setBusy] = useState(null);

  const reload = useCallback(() => {
    client.get('connections/webhooks').then(r => setHooks(r.data.webhooks || [])).catch(e => { setHooks([]); toast.error(errMsg(e, 'Could not load webhooks')); });
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const setActive = async (h, active) => {
    setBusy(h.id);
    try { await client.patch(`connections/webhooks/${h.id}`, { active }); reload(); }
    catch (e) { toast.error(errMsg(e, 'Failed')); }
    finally { setBusy(null); }
  };

  const test = async (h) => {
    setBusy(h.id);
    try {
      const r = await client.post(`connections/webhooks/${h.id}/test`);
      if (r.data.ok) toast.success(`Ping delivered — HTTP ${r.data.status} in ${r.data.ms} ms`);
      else toast.error(`Ping failed — ${r.data.error || 'no answer'}`);
      reload();
      setOpen(h.id);
    } catch (e) { toast.error(errMsg(e, 'Test failed')); }
    finally { setBusy(null); }
  };

  const rotate = async (h) => {
    if (!window.confirm(`Issue a new signing secret for "${h.name}"?\n\nThe receiver must switch to the new secret, or it will reject every event signed from now on.`)) return;
    try { const r = await client.post(`connections/webhooks/${h.id}/rotate-secret`); setShown({ name: h.name, secret: r.data.secret }); }
    catch (e) { toast.error(errMsg(e, 'Failed')); }
  };

  const remove = async (h) => {
    if (!window.confirm(`Delete "${h.name}"?\n\nNo more events go to it, and its delivery history goes too.`)) return;
    try { await client.delete(`connections/webhooks/${h.id}`); toast.success('Deleted'); reload(); }
    catch (e) { toast.error(errMsg(e, 'Failed')); }
  };

  const health = (h) => {
    if (!h.active) return <Pill>off</Pill>;
    if (h.failing_since) return <Pill tone="bad">failing since {when(h.failing_since)}</Pill>;
    if (h.last_delivery_at) return <Pill tone="ok">last OK {when(h.last_delivery_at)}</Pill>;
    return <Pill>nothing sent yet</Pill>;
  };

  return (
    <div className="space-y-4">
      {shown && (
        <ShownOnce title={`Signing secret for ${shown.name}`} value={shown.secret} onDone={() => setShown(null)}
          hint="The receiver uses it to check x-crm-signature on every event (docs/CONNECTIONS.md shows how). It is not shown again; rotate it if it is lost." />
      )}

      {adding ? (
        <WebhookEditor catalog={catalog} companies={companies}
          onSaved={(s) => { setAdding(false); if (s) setShown(s); reload(); }} onCancel={() => setAdding(false)} />
      ) : (
        <div className="flex justify-end">
          <Button onClick={() => setAdding(true)}><Plus size={14} /> New webhook</Button>
        </div>
      )}

      {hooks === null ? <Loading variant="rows" rows={3} /> : !hooks.length && !adding ? (
        <EmptyState icon={Send} title="No webhooks yet"
          hint="A webhook tells another app the moment something happens — a sale approved, cancelled or charged back, a new transfer — instead of it asking every few minutes." />
      ) : hooks.map(h => (
        <Panel key={h.id} className="p-4 space-y-3">
          <div className="flex items-start gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium" style={{ color: 'var(--color-text)' }}>{h.name}</span>
                {health(h)}
                {h.last_status != null && <Pill tone={h.last_status >= 200 && h.last_status < 300 ? 'ok' : 'bad'}>HTTP {h.last_status}</Pill>}
              </div>
              <div className="text-xs mt-1 break-all" style={{ color: 'var(--color-text-tertiary)' }}>{h.url}</div>
              <div className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                {(h.events || []).join(', ')} · {companyText(h.company_ids, companies)}
              </div>
              {h.last_error && (
                <div className="text-xs mt-1" style={{ color: 'var(--color-danger-600, #dc2626)' }}>{h.last_error}</div>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Toggle checked={h.active} busy={busy === h.id} onChange={(on) => setActive(h, on)} label={h.active ? 'On' : 'Off'} />
              <Button size="sm" variant="secondary" onClick={() => test(h)} disabled={busy === h.id}>
                {busy === h.id ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Test
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setOpen(open === h.id ? null : h.id)}><ScrollText size={13} /> Deliveries</Button>
              <Button size="sm" variant="secondary" onClick={() => setEditing(editing === h.id ? null : h.id)}>Edit</Button>
              <Button size="sm" variant="ghost" onClick={() => rotate(h)}><RefreshCw size={13} /> New secret</Button>
              <Button size="sm" variant="ghost" onClick={() => remove(h)}><Trash2 size={13} /></Button>
            </div>
          </div>
          {editing === h.id && (
            <WebhookEditor hook={h} catalog={catalog} companies={companies}
              onSaved={() => { setEditing(null); reload(); }} onCancel={() => setEditing(null)} />
          )}
          {open === h.id && <Deliveries key={`${h.id}-${h.last_delivery_at || ''}`} hook={h} />}
        </Panel>
      ))}
    </div>
  );
};

// ── External modules ────────────────────────────────────────────────────────
const MODULES = [
  { key: 'external_hr', label: 'HR', urlKey: 'hr_url',
    what: 'HR module link and the My HR tab in every shell are replaced by one "HR" link that opens the HRMS in a new tab.' },
  { key: 'external_qa', label: 'QA', urlKey: 'qa_url',
    what: 'QA Department (compliance + admin) and the QA Scores tab are replaced by one "QA" link that opens the QA platform in a new tab.' },
];

const ExternalTab = ({ catalog }) => {
  const [matrix, setMatrix] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    client.get('feature-flags/companies')
      .then(r => setMatrix({ companies: r.data.companies || [], catalog: r.data.catalog || [] }))
      .catch(e => { setMatrix({ companies: [], catalog: [] }); toast.error(errMsg(e, 'Could not load feature flags')); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const flip = async (company, key, on) => {
    setBusy(`${company.id}:${key}`);
    try {
      await client.put(`feature-flags/companies/${company.id}/${key}`, { is_enabled: on });
      setMatrix(m => ({ ...m, companies: m.companies.map(c => (c.id === company.id ? { ...c, flags: { ...c.flags, [key]: { ...(c.flags[key] || {}), is_enabled: on } } } : c)) }));
    } catch (e) { toast.error(errMsg(e, 'Could not change the switch')); }
    finally { setBusy(null); }
  };

  const present = new Set((matrix?.catalog || []).map(f => f.key));
  const missing = matrix && MODULES.some(m => !present.has(m.key));

  return (
    <div className="space-y-4">
      <Panel className="p-4 space-y-2">
        <p className="text-sm m-0" style={{ color: 'var(--color-text)' }}>
          When a company runs HR or QA in its own app, switch it on here. Its people then see one link out instead of the CRM's own screens.
          Off is exactly how the CRM looks today, and the CRM's HR and QA pages are never removed — switch back at any time.
        </p>
        {MODULES.map(m => (
          <div key={m.key} className="text-xs flex items-start gap-2 flex-wrap" style={{ color: 'var(--color-text-secondary)' }}>
            <Pill>{m.key}</Pill>
            <span className="flex-1 min-w-0">{m.what}</span>
            <a href={catalog.external?.[m.urlKey]} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium" style={{ color: 'var(--color-primary-600)' }}>
              {catalog.external?.[m.urlKey]} <ExternalLink size={11} />
            </a>
          </div>
        ))}
        <p className="text-[11px] m-0" style={{ color: 'var(--color-text-tertiary)' }}>
          Addresses come from HR_APP_URL / QA_APP_URL on the server. The same switches also appear under System → Feature Flags.
        </p>
      </Panel>

      {matrix === null ? <Loading variant="rows" rows={4} /> : missing ? (
        <Alert type="warning" dismissible={false}>
          The external_hr / external_qa switches do not exist yet — apply migration 348_connections.sql.
        </Alert>
      ) : !matrix.companies.length ? (
        <EmptyState icon={Boxes} title="No companies" />
      ) : (
        <Panel pad="none" className="overflow-hidden">
          <TableScroll label="External modules" stickyFirst>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                  <th className="px-4 py-2 font-medium">Company</th>
                  {MODULES.map(m => <th key={m.key} className="px-4 py-2 font-medium">{m.label} runs outside</th>)}
                </tr>
              </thead>
              <tbody>
                {matrix.companies.map(c => (
                  <tr key={c.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td className="px-4 py-2.5" style={{ color: 'var(--color-text)' }}>
                      {c.name}
                      {c.is_active === false && <span className="text-[11px] ml-2" style={{ color: 'var(--color-text-tertiary)' }}>inactive</span>}
                    </td>
                    {MODULES.map(m => (
                      <td key={m.key} className="px-4 py-2.5">
                        <Toggle checked={!!c.flags?.[m.key]?.is_enabled} busy={busy === `${c.id}:${m.key}`}
                          onChange={(on) => flip(c, m.key, on)} label={c.flags?.[m.key]?.is_enabled ? 'On' : 'Off'} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Panel>
      )}
    </div>
  );
};

// ── Outgoing links (mig 349) ────────────────────────────────────────────────
const HR_DEFAULT_URL = 'https://hr.vertexpakistan.com';

const LinkEditor = ({ link, onSaved, onCancel }) => {
  const isNew = !link;
  const [f, setF] = useState({ name: link?.name || '', url: link?.url || HR_DEFAULT_URL, api_key: '' });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!f.name.trim()) return toast.error('Give the link a name (the HR company)');
    if (!/^https:\/\//i.test(f.url.trim()) && !/^http:\/\/(localhost|127\.0\.0\.1)([:/]|$)/i.test(f.url.trim())) {
      return toast.error('The HR address must start with https://');
    }
    if (isNew && !f.api_key.trim()) return toast.error('Paste the API key from the HR system');
    setBusy(true);
    try {
      const body = { name: f.name.trim(), url: f.url.trim() };
      if (f.api_key.trim()) body.api_key = f.api_key.trim();
      if (isNew) await client.post('connections/links', { ...body, enabled: true });
      else await client.patch(`connections/links/${link.id}`, body);
      toast.success(isNew ? 'Link added — press Test to check it' : 'Saved');
      onSaved();
    } catch (e) { toast.error(errMsg(e, 'Save failed')); }
    finally { setBusy(false); }
  };

  return (
    <Panel className="p-4 space-y-4">
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        <label className="text-sm">
          <Label>Name</Label>
          <input className="input w-full" value={f.name} onChange={e => setF(p => ({ ...p, name: e.target.value }))}
            placeholder="WaveTech HR" maxLength={100} />
        </label>
        <label className="text-sm">
          <Label>HR address</Label>
          <input className="input w-full" value={f.url} onChange={e => setF(p => ({ ...p, url: e.target.value }))}
            placeholder={HR_DEFAULT_URL} />
        </label>
        <label className="text-sm">
          <Label>API key{!isNew && link?.key_last4 ? ` (now ••••${link.key_last4})` : ''}</Label>
          <input className="input w-full" type="password" autoComplete="off" value={f.api_key}
            onChange={e => setF(p => ({ ...p, api_key: e.target.value }))}
            placeholder={isNew ? 'Paste the key from HR' : 'Leave empty to keep the current key'} />
        </label>
      </div>
      <p className="text-xs m-0" style={{ color: 'var(--color-text-tertiary)' }}>
        In HR → open the company → Admin → Integrations → CRM → Create key, then paste it here. One link per HR company.
      </p>
      <div className="flex gap-2">
        <Button onClick={save} loading={busy}>{isNew ? <><Plus size={14} /> Add link</> : 'Save'}</Button>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </Panel>
  );
};

/** The last push to one link: counts, or the error. */
const PushResult = ({ result, at }) => {
  if (!result) return <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Not pushed yet</span>;
  if (result.error) {
    return (
      <div className="text-xs" style={{ color: 'var(--color-danger-600, #dc2626)' }}>
        {result.error}{at && <span style={{ color: 'var(--color-text-tertiary)' }}> · {when(at)}</span>}
      </div>
    );
  }
  const parts = [
    ['approved', result.approved], ['sent', result.sent], ['inserted', result.inserted], ['updated', result.updated],
    ['voided', result.voided], ['not employees', result.unknown],
  ].filter(([, v]) => v != null);
  return (
    <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
      {parts.map(([k, v]) => `${v} ${k}`).join(' · ')}
      {at && <span style={{ color: 'var(--color-text-tertiary)' }}> · {when(at)}</span>}
    </div>
  );
};

const OutgoingTab = () => {
  const [data, setData] = useState(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(null);
  const [running, setRunning] = useState(false);

  const reload = useCallback(() => {
    client.get('connections/links').then(r => setData(r.data))
      .catch(e => { setData({ ready: false, links: [] }); toast.error(errMsg(e, 'Could not load links')); });
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const setEnabled = async (l, enabled) => {
    setBusy(l.id);
    try { await client.patch(`connections/links/${l.id}`, { enabled }); reload(); }
    catch (e) { toast.error(errMsg(e, 'Failed')); }
    finally { setBusy(null); }
  };

  const test = async (l) => {
    setBusy(l.id);
    try {
      const r = await client.post(`connections/links/${l.id}/test`);
      if (r.data.ok) toast.success(`Connected to ${l.name} (${r.data.ms} ms)`);
      else toast.error(r.data.message || 'Not connected');
    } catch (e) { toast.error(errMsg(e, 'Test failed')); }
    finally { setBusy(null); }
  };

  const remove = async (l) => {
    if (!window.confirm(`Remove "${l.name}"?\n\nThe CRM stops sending sales to this HR company. Sales already in HR stay there.`)) return;
    try { await client.delete(`connections/links/${l.id}`); toast.success('Removed'); reload(); }
    catch (e) { toast.error(errMsg(e, 'Failed')); }
  };

  const pushNow = async () => {
    setRunning(true);
    try {
      const r = await client.post('connections/links/run');
      if (r.data.skipped) toast.message(`Nothing sent: ${r.data.skipped}`);
      else {
        const errors = (r.data.links || []).filter(x => x.result?.error).length;
        if (errors) toast.error(`Pushed ${r.data.sent} sales — ${errors} link(s) failed, see below`);
        else toast.success(`Pushed ${r.data.sent} approved sales to ${(r.data.links || []).length} HR link(s)`);
      }
      reload();
    } catch (e) { toast.error(errMsg(e, 'Push failed')); }
    finally { setRunning(false); }
  };

  const links = data?.links || [];
  const web = links.filter(l => l.source === 'web');
  const env = links.filter(l => l.source === 'env');

  return (
    <div className="space-y-4">
      <Panel className="p-4 space-y-2">
        <p className="text-sm m-0" style={{ color: 'var(--color-text)' }}>
          Every {data?.everyMinutes || 60} minutes the CRM sends the sales compliance approved (last month and this month) to each HR link below,
          credited to the closer and the fronter. A sale that is cancelled or charged back is withdrawn in HR at the next push.
        </p>
        <p className="text-xs m-0" style={{ color: 'var(--color-text-secondary)' }}>
          In HR → open the company → Admin → Integrations → CRM → Create key, then paste it here. One link per HR company.
        </p>
      </Panel>

      {data && !data.ready && (
        <Alert type="warning" dismissible={false}>
          Links cannot be added yet: apply <code>backend/migrations/349_outgoing_links.sql</code> in the Supabase SQL editor.
          Until then the push uses the server settings only{env.length ? ' (listed below)' : ''}.
        </Alert>
      )}
      {data && data.jobOn === false && (
        <Alert type="info" dismissible={false}>The hourly push is switched off on the server (HRMS_SYNC_MINUTES=0). "Push sales now" still works.</Alert>
      )}

      {adding ? (
        <LinkEditor onSaved={() => { setAdding(false); reload(); }} onCancel={() => setAdding(false)} />
      ) : (
        <div className="flex justify-end gap-2 flex-wrap">
          <Button variant="secondary" onClick={pushNow} loading={running} disabled={!links.length}>
            <UploadCloud size={14} /> Push sales now
          </Button>
          {data?.ready && <Button onClick={() => setAdding(true)}><Plus size={14} /> Add HR link</Button>}
        </div>
      )}

      {data === null ? <Loading variant="rows" rows={3} /> : !links.length && !adding ? (
        <EmptyState icon={Link2} title="No HR links yet"
          hint="Add one per HR company so its people get their sales incentives." />
      ) : (
        <>
          {web.map(l => (
            <Panel key={l.id} className="p-4 space-y-3">
              <div className="flex items-start gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium" style={{ color: 'var(--color-text)' }}>{l.name}</span>
                    {!l.enabled ? <Pill>off</Pill> : l.last_result?.error ? <Pill tone="bad">last push failed</Pill>
                      : l.last_run_at ? <Pill tone="ok">OK</Pill> : <Pill>not pushed yet</Pill>}
                  </div>
                  <div className="text-xs mt-1 break-all" style={{ color: 'var(--color-text-tertiary)' }}>
                    {l.url} · key {l.hasKey ? `••••${l.key_last4 || ''}` : 'missing'}
                  </div>
                  <div className="mt-1"><PushResult result={l.last_result} at={l.last_run_at} /></div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Toggle checked={l.enabled} busy={busy === l.id} onChange={(on) => setEnabled(l, on)} label={l.enabled ? 'On' : 'Off'} />
                  <Button size="sm" variant="secondary" onClick={() => test(l)} disabled={busy === l.id}>
                    {busy === l.id ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Test
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(editing === l.id ? null : l.id)}><Pencil size={13} /> Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(l)}><Trash2 size={13} /></Button>
                </div>
              </div>
              {editing === l.id && (
                <LinkEditor link={l} onSaved={() => { setEditing(null); reload(); }} onCancel={() => setEditing(null)} />
              )}
            </Panel>
          ))}
          {env.map(l => (
            <Panel key={l.id} className="p-4 space-y-1" style={{ opacity: 0.9 }}>
              <div className="flex items-center gap-2 flex-wrap">
                <Server size={14} style={{ color: 'var(--color-text-tertiary)' }} />
                <span className="font-medium" style={{ color: 'var(--color-text)' }}>{l.name}</span>
                <Pill>From server settings</Pill>
                {l.same_as && <Pill tone="warn">same as "{l.same_as}" — sent once</Pill>}
              </div>
              <div className="text-xs break-all" style={{ color: 'var(--color-text-tertiary)' }}>
                {l.url} · key {l.hasKey ? `••••${l.key_last4 || ''}` : 'missing'}
              </div>
              <PushResult result={l.last_result} at={l.last_run_at} />
              <p className="text-[11px] m-0" style={{ color: 'var(--color-text-tertiary)' }}>
                Set by HRMS_URL / HRMS_API_KEYS on the server; change it there. Adding the same company here as a link is fine — it is sent once.
              </p>
            </Panel>
          ))}
        </>
      )}
    </div>
  );
};

// ── Shell ───────────────────────────────────────────────────────────────────
export default function ConnectionsManager() {
  const [tab, setTab] = useState('keys');
  const [catalog, setCatalog] = useState(null);
  const [companies, setCompanies] = useState([]);

  useEffect(() => {
    client.get('connections/catalog').then(r => setCatalog(r.data))
      .catch(e => { setCatalog({ ready: false, error: errMsg(e, 'Could not load'), scopes: [], events: [] }); });
    client.get('companies').then(r => setCompanies(r.data.companies || [])).catch(() => {});
  }, []);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Connections"
        subtitle="Let other apps — the HRMS, the QA platform, anything with an HTTP client — read CRM data with an API key and hear about sales and transfers the moment they happen."
        level="page"
        icon={Plug}
        actions={catalog?.ready ? (
          <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            <CheckCircle2 size={13} style={{ color: 'var(--color-success-600, #16a34a)' }} />
            API at <code>{window.location.origin}{catalog.api_base}</code>
          </span>
        ) : null}
      />

      {catalog && !catalog.ready && (
        <Alert type="warning" dismissible={false}>
          <CircleSlash size={14} className="inline mr-1" />
          {catalog.error || <>Connections are not set up yet: apply <code>backend/migrations/348_connections.sql</code> in the Supabase SQL editor. Until then the machine API answers 503 and no webhooks are sent; nothing else in the CRM is affected.</>}
        </Alert>
      )}

      <PillTabs items={TABS} value={tab} onChange={setTab} />

      {catalog === null ? <Loading variant="rows" rows={4} /> : (
        <>
          {tab === 'keys'     && (catalog.ready ? <KeysTab catalog={catalog} companies={companies} /> : null)}
          {tab === 'webhooks' && (catalog.ready ? <WebhooksTab catalog={catalog} companies={companies} /> : null)}
          {tab === 'external' && <ExternalTab catalog={catalog} />}
          {tab === 'outgoing' && <OutgoingTab />}
        </>
      )}
    </div>
  );
}
