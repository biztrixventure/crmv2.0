import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Radio, Plus, Trash2, Save, Copy, RefreshCw, Loader2, AlertTriangle,
  Wifi, ListTree, Users, ScrollText, BookOpen, Play, Eye, KeyRound,
  Plug, CheckCircle2, CircleSlash, Link2, Download,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button, Alert } from '../../UI';
import client from '../../../api/client';
import ThemedSelect from '../../UI/Select';
import { Loading, SectionHeader, PillTabs, Panel, EmptyState, TableScroll, Toggle } from '../../UI/kit';

// ============================================================================
// DialerHub — connect ANY dialer to the CRM (migration 320).
//
// The flow this screen is built around, in order:
//   1. Connections  create the account, copy the webhook URL into the dialer
//   2. Events       fire one real call and SEE what the dialer sent
//   3. Mapping      point each CRM field at a key from that real payload
//   4. Agents       turn the dialer's agent ids into CRM people
//
// That order matters. Mapping first — from documentation — is how integrations
// end up quietly half-wired; mapping from a payload you are looking at cannot
// go wrong the same way. Every tab here exists to keep that loop tight: dry
// runs that write nothing, a replay button for calls that landed before the
// mapping was right, and a verdict in plain words ("Creates a PENDING
// TRANSFER…") rather than a JSON dump.
//
// VICIdial is untouched by all of this — it keeps its own screen and its own
// ingest URLs. This is for everything else.
// ============================================================================

const TABS = [
  { k: 'connections', label: 'Connections', icon: Radio },
  { k: 'wiring',      label: 'Wiring',      icon: Plug },
  { k: 'mapping',     label: 'Mapping',     icon: ListTree },
  { k: 'agents',      label: 'Agents',      icon: Users },
  { k: 'events',      label: 'Events',      icon: ScrollText },
  { k: 'setup',       label: 'How to wire it up', icon: BookOpen },
];

const webhookUrl = (token) => `${window.location.origin.replace(/\/$/, '')}/api/dialer/hook/${token}`;

const copy = (text, what = 'Copied') => {
  navigator.clipboard?.writeText(text).then(
    () => toast.success(what),
    () => toast.error('Could not copy — select it by hand'),
  );
};

const StatusPill = ({ status }) => {
  const tone = {
    accepted: { bg: 'var(--color-success-100, #dcfce7)', fg: 'var(--color-success-700, #15803d)' },
    ignored:  { bg: 'var(--color-bg-tertiary)',          fg: 'var(--color-text-secondary)' },
    rejected: { bg: 'var(--color-danger-100, #fee2e2)',  fg: 'var(--color-danger-700, #b91c1c)' },
    error:    { bg: 'var(--color-danger-100, #fee2e2)',  fg: 'var(--color-danger-700, #b91c1c)' },
  }[status] || { bg: 'var(--color-bg-tertiary)', fg: 'var(--color-text-secondary)' };
  return (
    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium"
      style={{ background: tone.bg, color: tone.fg }}>{status}</span>
  );
};

// ── Connections ─────────────────────────────────────────────────────────────
const AccountEditor = ({ account, providers, companies, onSaved, onCancel }) => {
  const isNew = !account;
  const [f, setF] = useState({
    provider: account?.provider || 'calltools',
    name: account?.name || '',
    company_id: account?.company_id || '',
    prefix: account?.prefix || '',
    base_url: account?.base_url || '',
    token: account?.auth?.token || '',
    auth_type: account?.auth?.type || 'bearer',
    webhook_secret: '',
    xfer_dispos: (account?.settings?.xfer_dispos || []).join(', '),
    default_leg: account?.settings?.default_leg || 'fronter',
    is_active: account ? account.is_active : true,
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  const save = async () => {
    if (!f.name.trim()) return toast.error('Give the connection a name');
    setBusy(true);
    try {
      const body = {
        provider: f.provider, name: f.name.trim(), company_id: f.company_id || null,
        prefix: f.prefix || null, base_url: f.base_url || null,
        auth: { ...(account?.auth || {}), type: f.auth_type, token: f.token },
        settings: {
          ...(account?.settings || {}),
          xfer_dispos: f.xfer_dispos.split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
          default_leg: f.default_leg,
        },
        is_active: f.is_active,
      };
      // Blank means "leave the signing secret as it is" — sending an empty
      // string would clear a secret the operator never intended to touch.
      if (f.webhook_secret) body.webhook_secret = f.webhook_secret;
      if (isNew) await client.post('dialer-admin/accounts', body);
      else await client.patch(`dialer-admin/accounts/${account.id}`, body);
      toast.success(isNew ? 'Connection created' : 'Saved');
      onSaved();
    } catch (e) { toast.error(e.response?.data?.error || 'Save failed'); }
    finally { setBusy(false); }
  };

  return (
    <Panel className="p-4 space-y-3">
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <label className="text-sm">
          <span className="block mb-1" style={{ color: 'var(--color-text-secondary)' }}>Dialer</span>
          <ThemedSelect
            value={f.provider} onChange={(v) => set('provider', v)} disabled={!isNew}
            options={providers.map(p => ({ value: p.key, label: p.label }))} />
        </label>
        <label className="text-sm">
          <span className="block mb-1" style={{ color: 'var(--color-text-secondary)' }}>Name</span>
          <input className="input w-full" value={f.name} onChange={e => set('name', e.target.value)}
            placeholder="CallTools — main floor" />
        </label>
        <label className="text-sm">
          <span className="block mb-1" style={{ color: 'var(--color-text-secondary)' }}>Company</span>
          <ThemedSelect
            value={f.company_id} onChange={(v) => set('company_id', v)}
            options={[{ value: '', label: 'Resolve from the agent' }, ...companies.map(c => ({ value: c.id, label: c.name }))]} />
        </label>
        <label className="text-sm">
          <span className="block mb-1" style={{ color: 'var(--color-text-secondary)' }}>Lead-code prefix</span>
          <input className="input w-full" value={f.prefix} onChange={e => set('prefix', e.target.value.toUpperCase())}
            placeholder="CT" maxLength={8} />
        </label>
        <label className="text-sm">
          <span className="block mb-1" style={{ color: 'var(--color-text-secondary)' }}>API base URL</span>
          <input className="input w-full" value={f.base_url} onChange={e => set('base_url', e.target.value)}
            placeholder="https://app.calltools.com" />
        </label>
        <label className="text-sm">
          <span className="block mb-1" style={{ color: 'var(--color-text-secondary)' }}>API token</span>
          <input className="input w-full" value={f.token} onChange={e => set('token', e.target.value)}
            placeholder={account ? 'leave as-is to keep it' : 'paste the dialer API token'} />
        </label>
        <label className="text-sm">
          <span className="block mb-1" style={{ color: 'var(--color-text-secondary)' }}>Auth style</span>
          <ThemedSelect value={f.auth_type} onChange={(v) => set('auth_type', v)} options={[
            { value: 'bearer', label: 'Authorization: Bearer <token>' },
            { value: 'header', label: 'Custom header' },
            { value: 'query',  label: 'Query parameter' },
            { value: 'basic',  label: 'Basic auth' },
            { value: 'none',   label: 'No API auth' },
          ]} />
        </label>
        <label className="text-sm">
          <span className="block mb-1" style={{ color: 'var(--color-text-secondary)' }}>Signing secret</span>
          <input className="input w-full" value={f.webhook_secret} onChange={e => set('webhook_secret', e.target.value)}
            placeholder={account?.has_secret ? 'set — type to replace' : 'optional HMAC-SHA256 secret'} />
        </label>
        <label className="text-sm">
          <span className="block mb-1" style={{ color: 'var(--color-text-secondary)' }}>Transfer dispositions</span>
          <input className="input w-full" value={f.xfer_dispos} onChange={e => set('xfer_dispos', e.target.value)}
            placeholder="TRANSFERRED, XFER" />
        </label>
        <label className="text-sm">
          <span className="block mb-1" style={{ color: 'var(--color-text-secondary)' }}>Default leg</span>
          <ThemedSelect value={f.default_leg} onChange={(v) => set('default_leg', v)} options={[
            { value: 'fronter', label: 'Fronter (creates transfers)' },
            { value: 'closer',  label: 'Closer (applies dispositions)' },
          ]} />
        </label>
      </div>
      <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
        The prefix makes this dialer's lead ids unique across the estate (lead <code>88421</code> becomes
        <code> CT88421</code>), so two dialers numbering leads from 1 can never land on the same transfer.
        A transfer is only created when the fronter's disposition is one of the ones listed above — everything
        else is still recorded for QA. A signing secret is optional, but once set an unsigned webhook is refused.
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <Toggle checked={f.is_active} onChange={(v) => set('is_active', v)} label="Accepting calls" />
        <div className="flex-1" />
        {onCancel && <Button variant="secondary" onClick={onCancel}>Cancel</Button>}
        <Button onClick={save} disabled={busy}>
          {busy ? <Loader2 size={14} className="inline animate-spin mr-1" /> : <Save size={14} className="inline mr-1" />}
          {isNew ? 'Create connection' : 'Save'}
        </Button>
      </div>
    </Panel>
  );
};

const ConnectionsTab = ({ accounts, providers, companies, selected, onSelect, reload }) => {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [testing, setTesting] = useState(null);

  const testApi = async (a) => {
    setTesting(a.id);
    try {
      const r = await client.post(`dialer-admin/accounts/${a.id}/test-api`);
      (r.data.ok ? toast.success : toast.error)(r.data.message || (r.data.ok ? 'Connected' : 'Failed'));
    } catch (e) { toast.error(e.response?.data?.error || 'Test failed'); }
    finally { setTesting(null); }
  };

  const rotate = async (a) => {
    if (!window.confirm(`Rotate the webhook URL for "${a.name}"?\n\nThe current URL stops working immediately — you will have to paste the new one into the dialer.`)) return;
    try { await client.post(`dialer-admin/accounts/${a.id}/rotate-token`); toast.success('New URL issued'); reload(); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const remove = async (a) => {
    if (!window.confirm(`Delete "${a.name}"?\n\nIts webhook stops working and its agent links and event history go with it. Transfers and QA rows already created are kept.`)) return;
    try { await client.delete(`dialer-admin/accounts/${a.id}`); toast.success('Deleted'); reload(); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  return (
    <div className="space-y-4">
      {!accounts.length && !adding && (
        <EmptyState
          icon={Radio}
          title="No dialer connected yet"
          hint="Create a connection, paste its webhook URL into the dialer, then fire one call to see what it sends."
          action={<Button onClick={() => setAdding(true)}><Plus size={14} className="inline mr-1" /> Connect a dialer</Button>}
        />
      )}

      {accounts.map(a => (
        <Panel key={a.id} className="p-4 space-y-3">
          <div className="flex items-start gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium">{a.name}</span>
                <span className="text-xs px-2 py-0.5 rounded-full"
                  style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text-secondary)' }}>
                  {a.provider}
                </span>
                {!a.is_active && <span className="text-xs" style={{ color: 'var(--color-danger-600, #dc2626)' }}>switched off</span>}
                {selected === a.id && <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>· shown on the other tabs</span>}
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                {a.company_name ? `Pinned to ${a.company_name}` : 'Company resolved from the agent'}
                {a.prefix ? ` · prefix ${a.prefix}` : ''}
                {a.has_secret ? ' · signed' : ''}
                {a.last_event_at ? ` · last call ${new Date(a.last_event_at).toLocaleString()}` : ' · nothing received yet'}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                24h: {a.last_24h.accepted}/{a.last_24h.total}
                {a.last_24h.problems ? ` · ${a.last_24h.problems} problem${a.last_24h.problems > 1 ? 's' : ''}` : ''}
              </span>
              <Button variant="secondary" className="text-xs" onClick={() => testApi(a)} disabled={testing === a.id}>
                {testing === a.id ? <Loader2 size={13} className="inline animate-spin" /> : <Wifi size={13} className="inline" />} Test API
              </Button>
              <Button variant="secondary" className="text-xs" onClick={() => onSelect(a.id)}>
                <Eye size={13} className="inline" /> Select
              </Button>
              <Button variant="secondary" className="text-xs" onClick={() => setEditing(editing === a.id ? null : a.id)}>
                Edit
              </Button>
            </div>
          </div>

          <div className="rounded p-2 text-xs flex items-center gap-2 flex-wrap"
            style={{ background: 'var(--color-bg-tertiary)' }}>
            <KeyRound size={13} />
            <code className="truncate flex-1 min-w-0">{webhookUrl(a.webhook_token)}</code>
            <Button variant="secondary" className="text-xs" onClick={() => copy(webhookUrl(a.webhook_token), 'Webhook URL copied')}>
              <Copy size={12} className="inline" /> Copy
            </Button>
            <Button variant="secondary" className="text-xs" onClick={() => copy(`${webhookUrl(a.webhook_token)}?dry=1`, 'Dry-run URL copied')}>
              Dry-run URL
            </Button>
            <Button variant="secondary" className="text-xs" onClick={() => rotate(a)}>
              <RefreshCw size={12} className="inline" /> Rotate
            </Button>
            <Button variant="secondary" className="text-xs" onClick={() => remove(a)}>
              <Trash2 size={12} className="inline" />
            </Button>
          </div>

          {!!a.gaps?.length && (
            <Alert type="warning">
              Not fully mapped yet — <strong>{a.gaps.join(', ')}</strong> {a.gaps.length > 1 ? 'have' : 'has'} no source field.
              Calls will be logged but cannot create transfers until they do.
            </Alert>
          )}

          {editing === a.id && (
            <AccountEditor account={a} providers={providers} companies={companies}
              onSaved={() => { setEditing(null); reload(); }} onCancel={() => setEditing(null)} />
          )}
        </Panel>
      ))}

      {adding
        ? <AccountEditor account={null} providers={providers} companies={companies}
            onSaved={() => { setAdding(false); reload(); }} onCancel={() => setAdding(false)} />
        : !!accounts.length && (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            <Plus size={14} className="inline mr-1" /> Connect another dialer
          </Button>
        )}
    </div>
  );
};

// ── Wiring ──────────────────────────────────────────────────────────────────
// Set the DIALER up from here. Without this tab an operator has two admin
// panels open and copies disposition ids between them by hand, which is how an
// integration ends up listening for "XFER Transferred" while the dialer sends
// "XFER Transfered" — no error anywhere, just no transfers.
const WiringTab = ({ account, reload }) => {
  const [wiring, setWiring] = useState(null);
  const [dispos, setDispos] = useState(null);
  const [picked, setPicked] = useState([]);
  const [dryRun, setDryRun] = useState(true);
  const [busy, setBusy] = useState(false);
  const accountId = account?.id;

  const load = useCallback(() => {
    if (!accountId) return;
    setWiring(null); setDispos(null);
    client.get(`dialer-admin/accounts/${accountId}/wiring`)
      .then(r => { setWiring(r.data); setDryRun(r.data?.dry_run !== false); })
      .catch(e => setWiring({ ok: false, error: e.response?.data?.error || 'Could not read the dialer' }));
    client.get(`dialer-admin/accounts/${accountId}/remote-dispositions`)
      .then(r => {
        setDispos(r.data);
        setPicked((r.data?.dispositions || []).filter(d => d.selected).map(d => d.id));
      })
      .catch(() => setDispos({ ok: false, dispositions: [] }));
  }, [accountId]);
  useEffect(() => { load(); }, [load]);

  const provision = async () => {
    if (!picked.length) return toast.error('Pick the disposition(s) that mean "transferred"');
    const names = (dispos?.dispositions || []).filter(d => picked.includes(d.id)).map(d => d.name);
    if (!dryRun && !window.confirm(
      `Go LIVE?\n\nEvery call an agent marks "${names.join('", "')}" will create a real pending transfer in the CRM and notify the fronter.`
    )) return;
    setBusy(true);
    try {
      const r = await client.post(`dialer-admin/accounts/${accountId}/wiring`, {
        disposition_ids: picked, disposition_names: names, dry_run: dryRun,
      });
      toast.success(r.data.dry_run ? 'Wired up in dry-run mode' : 'Wired up — LIVE');
      load(); reload();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not write to the dialer'); }
    finally { setBusy(false); }
  };

  const toggleActive = async (next) => {
    setBusy(true);
    try {
      await client.post(`dialer-admin/accounts/${accountId}/wiring/active`, { active: next });
      toast.success(next ? 'Automation resumed' : 'Automation paused in the dialer');
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
    finally { setBusy(false); }
  };

  if (!account) return <EmptyState icon={Plug} title="Pick a connection first" />;
  if (wiring === null) return <Loading variant="rows" rows={4} />;
  if (wiring.ok === false) {
    return <Alert type="warning">{wiring.error} — set the API base URL and token on the Connections tab, then come back.</Alert>;
  }

  return (
    <div className="space-y-4" style={{ maxWidth: 900 }}>
      <Panel className="p-4 space-y-2">
        <SectionHeader title="What the dialer is doing right now" actions={
          <Button variant="secondary" className="text-xs" onClick={load}><RefreshCw size={12} className="inline" /> Refresh</Button>
        } />
        <div className="flex items-center gap-2 text-sm flex-wrap">
          {wiring.wired
            ? <><CheckCircle2 size={15} style={{ color: 'var(--color-success-600, #16a34a)' }} /> Wired up</>
            : <><CircleSlash size={15} style={{ color: 'var(--color-text-tertiary)' }} /> Nothing wired yet</>}
          {wiring.wired && (
            <span className="px-2 py-0.5 rounded-full text-[11px]"
              style={{
                background: wiring.dry_run ? 'var(--color-bg-tertiary)' : 'var(--color-success-100, #dcfce7)',
                color: wiring.dry_run ? 'var(--color-text-secondary)' : 'var(--color-success-700, #15803d)',
              }}>
              {wiring.dry_run ? 'dry run — nothing is written' : 'LIVE — creating transfers'}
            </span>
          )}
          {wiring.wired && !wiring.active && (
            <span className="text-[11px]" style={{ color: 'var(--color-danger-600, #dc2626)' }}>paused in the dialer</span>
          )}
        </div>
        {wiring.automation && (
          <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            Automation #{wiring.automation.id} “{wiring.automation.name}” → webhook #{wiring.request?.id}
          </div>
        )}
        {wiring.request?.url && (
          <code className="block text-[11px] rounded p-2 truncate" style={{ background: 'var(--color-bg-tertiary)' }}>
            {wiring.request.url}
          </code>
        )}
        {wiring.wired && (
          <div className="flex gap-2 pt-1">
            <Button variant="secondary" className="text-xs" disabled={busy} onClick={() => toggleActive(!wiring.active)}>
              {wiring.active ? 'Pause in the dialer' : 'Resume'}
            </Button>
          </div>
        )}
      </Panel>

      <Panel className="p-4 space-y-3">
        <SectionHeader
          title="Which dispositions mean “transferred”"
          subtitle="Read live from the dialer, so the names always match exactly. Everything not ticked is still recorded for QA — it just does not create a transfer."
        />
        {dispos === null ? <Loading variant="rows" rows={3} /> : !dispos.dispositions?.length ? (
          <Alert type="warning">Could not read the dialer's dispositions. Check the API token on the Connections tab.</Alert>
        ) : (
          <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', maxHeight: 280, overflow: 'auto' }}>
            {dispos.dispositions.map(d => (
              <label key={d.id} className="flex items-center gap-2 text-sm px-1 py-0.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={picked.includes(d.id)}
                  onChange={e => setPicked(p => (e.target.checked ? [...p, d.id] : p.filter(x => x !== d.id)))}
                />
                <span className="truncate" title={d.name}>{d.name}</span>
              </label>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap pt-1" style={{ borderTop: '1px solid var(--color-border)' }}>
          <Toggle
            checked={dryRun} onChange={setDryRun}
            label="Dry run"
            hint="The dialer fires and the CRM logs it, but no transfer is created. Turn this off when the mapping looks right."
          />
          <div className="flex-1" />
          <Button onClick={provision} disabled={busy}>
            {busy ? <Loader2 size={14} className="inline animate-spin mr-1" /> : <Plug size={14} className="inline mr-1" />}
            {wiring.wired ? 'Update the dialer' : 'Wire it up'}
          </Button>
        </div>
        <p className="text-xs m-0" style={{ color: 'var(--color-text-tertiary)' }}>
          This writes to the dialer: it creates (or repairs) one automation, one webhook, and the link between them —
          never a second copy, because two automations on one disposition would post every transfer twice.
        </p>
      </Panel>
    </div>
  );
};

// ── Mapping ─────────────────────────────────────────────────────────────────
// The canonical field on the left, where to read it from on the right, and the
// keys the dialer really sent underneath — so mapping is picking, not guessing.
const MappingTab = ({ account, fields, transforms, reload }) => {
  const [map, setMap] = useState({});
  const [seen, setSeen] = useState(null);
  const [sample, setSample] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState(null);   // which canonical field is being pointed

  const accountId = account?.id;

  useEffect(() => { setMap(account?.field_map || {}); setResult(null); setSample(''); }, [accountId]);   // eslint-disable-line react-hooks/exhaustive-deps

  const loadSeen = useCallback(() => {
    if (!accountId) return;
    client.get(`dialer-admin/accounts/${accountId}/fields`)
      .then(r => {
        setSeen(r.data);
        if (r.data.sample_payload) setSample(s => s || JSON.stringify(r.data.sample_payload, null, 2));
      })
      .catch(() => setSeen({ fields: [], events: [] }));
  }, [accountId]);
  useEffect(() => { loadSeen(); }, [loadSeen]);

  // A mapping value is either a plain path or an object with a transform. Keep
  // the simple case simple: a row only becomes an object when a transform is
  // chosen or several paths are given, so a hand-written map stays readable.
  const pathOf = (v) => (typeof v === 'string' ? v : Array.isArray(v) ? v.join(' | ') : (v?.path || (v?.paths || []).join(' | ') || ''));
  const transformOf = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? (v.transform || '') : '');

  const rebuild = (paths, transform) => {
    if (!paths.length) return null;
    const base = paths.length > 1 ? { paths } : { path: paths[0] };
    if (transform) return { ...base, transform };
    return paths.length > 1 ? base : paths[0];
  };

  const setPath = (key, text) => setMap(m => {
    const paths = String(text).split('|').map(s => s.trim()).filter(Boolean);
    const next = rebuild(paths, transformOf(m[key]));
    if (!next) { const c = { ...m }; delete c[key]; return c; }
    return { ...m, [key]: next };
  });

  const setTransform = (key, t) => setMap(m => {
    const paths = pathOf(m[key]).split('|').map(s => s.trim()).filter(Boolean);
    const next = rebuild(paths, t);
    if (!next) return m;
    return { ...m, [key]: next };
  });

  const test = async () => {
    setBusy(true);
    try {
      const body = { field_map: map };
      if (sample.trim()) body.payload = sample;
      else if (seen?.events?.[0]) body.event_id = seen.events[0].id;
      const r = await client.post(`dialer-admin/accounts/${accountId}/test`, body);
      setResult(r.data);
    } catch (e) { toast.error(e.response?.data?.error || 'Could not test'); }
    finally { setBusy(false); }
  };

  const save = async () => {
    setBusy(true);
    try {
      await client.patch(`dialer-admin/accounts/${accountId}`, { field_map: map });
      toast.success('Mapping saved');
      reload();
    } catch (e) { toast.error(e.response?.data?.error || 'Save failed'); }
    finally { setBusy(false); }
  };

  if (!account) return <EmptyState icon={ListTree} title="Pick a connection first" hint="Select one on the Connections tab." />;

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
      <div className="space-y-3 min-w-0">
        <SectionHeader title="What the CRM needs" subtitle="Point each one at a key from the dialer's payload. Required fields are starred." />
        <TableScroll>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ color: 'var(--color-text-secondary)' }}>
                <th className="text-left font-medium py-1">CRM field</th>
                <th className="text-left font-medium py-1">Read from</th>
                <th className="text-left font-medium py-1">Transform</th>
              </tr>
            </thead>
            <tbody>
              {fields.map(f => (
                <tr key={f.key} style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td className="py-1 pr-2 align-top" style={{ width: 160 }}>
                    <div className="font-medium">
                      {f.label}{f.required && <span style={{ color: 'var(--color-danger-600, #dc2626)' }}> *</span>}
                    </div>
                    {f.hint && <div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{f.hint}</div>}
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      className="input w-full text-xs"
                      value={pathOf(map[f.key])}
                      onFocus={() => setFocus(f.key)}
                      onChange={e => setPath(f.key, e.target.value)}
                      placeholder="data.contact.phone_number"
                    />
                  </td>
                  <td className="py-1" style={{ width: 130 }}>
                    <ThemedSelect
                      value={transformOf(map[f.key])}
                      onChange={(v) => setTransform(f.key, v)}
                      options={[{ value: '', label: '—' }, ...transforms.map(t => ({ value: t, label: t }))]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={save} disabled={busy}><Save size={14} className="inline mr-1" /> Save mapping</Button>
          <Button variant="secondary" onClick={test} disabled={busy}>
            {busy ? <Loader2 size={14} className="inline animate-spin mr-1" /> : <Play size={14} className="inline mr-1" />}
            Test it (writes nothing)
          </Button>
        </div>
        {result && (
          <Alert type={result.ok ? 'success' : 'warning'}>
            <div className="font-medium">{result.verdict}</div>
            <pre className="text-[11px] mt-2 overflow-auto" style={{ maxHeight: 220 }}>
              {JSON.stringify(result.normalized, null, 2)}
            </pre>
          </Alert>
        )}
      </div>

      <div className="space-y-3 min-w-0">
        <SectionHeader
          title="What the dialer actually sent"
          subtitle={focus
            ? `Click a key to use it for "${fields.find(f => f.key === focus)?.label}"`
            : 'Click a CRM field on the left first, then click a key here'}
          actions={<Button variant="secondary" className="text-xs" onClick={loadSeen}><RefreshCw size={12} className="inline" /> Refresh</Button>}
        />
        {seen === null ? <Loading variant="rows" rows={4} /> : !seen.fields?.length ? (
          <Alert type="info">
            Nothing received yet. Paste the webhook URL into the dialer and fire one call —
            add <code>?dry=1</code> while testing and nothing will be written.
          </Alert>
        ) : (
          <div className="rounded overflow-auto" style={{ maxHeight: 460, background: 'var(--color-bg-tertiary)' }}>
            {seen.fields.map(f => (
              <button key={f.path} type="button"
                onClick={() => {
                  if (!focus) return toast.error('Click a CRM field on the left first');
                  setPath(focus, f.path);
                  toast.success(`${f.path} → ${focus}`);
                }}
                className="w-full text-left px-2 py-1 text-xs"
                style={{ borderBottom: '1px solid var(--color-border)' }}>
                <div className="font-mono truncate">{f.path}</div>
                {!!f.samples.length && (
                  <div className="truncate" style={{ color: 'var(--color-text-tertiary)' }}>{f.samples.join('  ·  ')}</div>
                )}
              </button>
            ))}
          </div>
        )}
        <label className="text-sm block">
          <span className="block mb-1" style={{ color: 'var(--color-text-secondary)' }}>Sample payload to test against</span>
          <textarea className="input w-full font-mono text-[11px]" rows={8}
            value={sample} onChange={e => setSample(e.target.value)}
            placeholder={'{"data": {"user": {"username": "1001"}}}'} />
        </label>
      </div>
    </div>
  );
};

// ── Agents ──────────────────────────────────────────────────────────────────
// Pull the dialer's own roster and link it in one pass. The CRM SUGGESTS who
// each dialer login is — from the VICIdial id already on their profile, or an
// exact name match — but never applies a guess silently: crediting a transfer
// to the wrong person is worse than leaving it unmapped, where it at least
// shows up as a problem.
const RosterPanel = ({ account, onLinked }) => {
  const [roster, setRoster] = useState(null);
  const [busy, setBusy] = useState(false);
  const accountId = account?.id;

  const pull = useCallback(() => {
    if (!accountId) return;
    setRoster(undefined);
    client.get(`dialer-admin/accounts/${accountId}/remote-agents`)
      .then(r => setRoster(r.data))
      .catch(e => setRoster({ ok: false, error: e.response?.data?.error || 'Could not read the dialer', agents: [] }));
  }, [accountId]);

  const linkSuggested = async () => {
    const links = (roster?.agents || [])
      .filter(a => a.suggested_user_id)
      .map(a => ({ external_id: a.external_id, username: a.username, user_id: a.suggested_user_id }));
    if (!links.length) return toast.error('Nothing left to link');
    setBusy(true);
    try {
      const r = await client.post(`dialer-admin/accounts/${accountId}/sync-agents`, { links });
      toast.success(`Linked ${links.length} agent${links.length > 1 ? 's' : ''} (${r.data.linked} ids)`);
      pull(); onLinked?.();
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
    finally { setBusy(false); }
  };

  if (roster === null) {
    return (
      <Panel className="p-3 flex items-center gap-2 flex-wrap">
        <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          Read the agent list straight from the dialer and match it to CRM people.
        </span>
        <div className="flex-1" />
        <Button variant="secondary" className="text-xs" onClick={pull}>
          <Download size={13} className="inline mr-1" /> Pull the roster
        </Button>
      </Panel>
    );
  }
  if (roster === undefined) return <Loading variant="rows" rows={3} />;
  if (roster.ok === false) return <Alert type="warning">{roster.error}</Alert>;

  const suggested = (roster.agents || []).filter(a => a.suggested_user_id);
  const unknown = (roster.agents || []).filter(a => !a.suggested_user_id && !a.linked_user_id);

  return (
    <Panel className="p-3 space-y-2">
      <SectionHeader
        title={`The dialer's roster — ${roster.agents.length} logins`}
        subtitle={`${roster.agents.filter(a => a.linked_user_id).length} already linked · ${suggested.length} suggested · ${unknown.length} unrecognised`}
        actions={<Button variant="secondary" className="text-xs" onClick={pull}><RefreshCw size={12} className="inline" /> Refresh</Button>}
      />
      {!!suggested.length && (
        <>
          <div className="space-y-1" style={{ maxHeight: 220, overflow: 'auto' }}>
            {suggested.map(a => (
              <div key={a.external_id} className="flex items-center gap-2 text-sm flex-wrap">
                <code className="px-1.5 py-0.5 rounded text-xs" style={{ background: 'var(--color-bg-tertiary)' }}>
                  {a.username || a.external_id}
                </code>
                <span style={{ color: 'var(--color-text-tertiary)' }}>{a.name}</span>
                <Link2 size={12} style={{ color: 'var(--color-text-tertiary)' }} />
                <span>{a.suggested_name}</span>
                <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>({a.suggested_because})</span>
              </div>
            ))}
          </div>
          <Button onClick={linkSuggested} disabled={busy}>
            {busy ? <Loader2 size={14} className="inline animate-spin mr-1" /> : <Link2 size={14} className="inline mr-1" />}
            Link all {suggested.length} suggested
          </Button>
        </>
      )}
      {!!unknown.length && (
        <p className="text-xs m-0" style={{ color: 'var(--color-text-tertiary)' }}>
          No CRM match for {unknown.map(a => a.username || a.external_id).join(', ')} — link those by hand below if they take calls.
        </p>
      )}
    </Panel>
  );
};

const AgentsTab = ({ account }) => {
  const [data, setData] = useState(null);
  const [people, setPeople] = useState([]);
  const [draft, setDraft] = useState({ external_agent_id: '', user_id: '' });
  const accountId = account?.id;

  const load = useCallback(() => {
    if (!accountId) return;
    client.get(`dialer-admin/accounts/${accountId}/agents`)
      .then(r => setData(r.data)).catch(() => setData({ links: [], unmapped: [] }));
  }, [accountId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    // Reuses the VICIdial agent listing purely as a people picker — it is the
    // existing superadmin-only roster of CRM users with their company and role.
    client.get('vicidial/agents').then(r => setPeople(r.data.agents || [])).catch(() => {});
  }, []);

  const link = async (agentId, userId) => {
    try {
      await client.post(`dialer-admin/accounts/${accountId}/agents`, { external_agent_id: agentId, user_id: userId });
      toast.success(`${agentId} linked`); setDraft({ external_agent_id: '', user_id: '' }); load();
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };
  const unlink = async (id) => {
    try { await client.delete(`dialer-admin/agents/${id}`); load(); } catch { toast.error('Failed'); }
  };

  if (!account) return <EmptyState icon={Users} title="Pick a connection first" />;
  if (data === null) return <Loading variant="rows" rows={4} />;


  const peopleOptions = people.map(p => ({ value: p.user_id, label: `${p.name}${p.company ? ` — ${p.company}` : ''}` }));

  return (
    <div className="space-y-4">
      <Alert type="info">
        A call from an unmapped agent is recorded in the event log and goes no further — the CRM has nobody to
        credit the transfer to. VICIdial agents stay where they are (User Control Center → VICIdial); this list
        is only for <strong>{account.name}</strong>.
      </Alert>

      <RosterPanel account={account} onLinked={load} />


      {!!data.unmapped.length && (
        <Panel className="p-3 space-y-2">
          <SectionHeader title="Seen in the last 7 days but not mapped" />
          {data.unmapped.map(u => (
            <div key={u.agent} className="flex items-center gap-2 text-sm flex-wrap">
              <code className="px-2 py-0.5 rounded" style={{ background: 'var(--color-bg-tertiary)' }}>{u.agent}</code>
              <span style={{ color: 'var(--color-text-tertiary)' }}>{u.calls} call{u.calls > 1 ? 's' : ''}</span>
              <div className="flex-1" />
              <div style={{ minWidth: 260 }}>
                <ThemedSelect
                  value="" onChange={(v) => v && link(u.agent, v)}
                  options={[{ value: '', label: 'Link to a CRM user…' }, ...peopleOptions]} />
              </div>
            </div>
          ))}
        </Panel>
      )}

      <Panel className="p-3 space-y-2">
        <SectionHeader title="Mapped agents" />
        {!data.links.length && <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Nothing mapped yet.</p>}
        {data.links.map(l => (
          <div key={l.id} className="flex items-center gap-2 text-sm">
            <code className="px-2 py-0.5 rounded" style={{ background: 'var(--color-bg-tertiary)' }}>{l.external_agent_id}</code>
            <span>→ {l.user_name || l.user_id}</span>
            <div className="flex-1" />
            <Button variant="secondary" className="text-xs" onClick={() => unlink(l.id)}><Trash2 size={12} className="inline" /></Button>
          </div>
        ))}
        <div className="flex items-end gap-2 pt-2 flex-wrap" style={{ borderTop: '1px solid var(--color-border)' }}>
          <label className="text-sm">
            <span className="block mb-1" style={{ color: 'var(--color-text-secondary)' }}>Agent id on the dialer</span>
            <input className="input" value={draft.external_agent_id}
              onChange={e => setDraft(d => ({ ...d, external_agent_id: e.target.value }))} placeholder="1001" />
          </label>
          <div style={{ minWidth: 260 }}>
            <span className="block mb-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>CRM user</span>
            <ThemedSelect value={draft.user_id} onChange={(v) => setDraft(d => ({ ...d, user_id: v }))}
              options={[{ value: '', label: 'Choose…' }, ...peopleOptions]} />
          </div>
          <Button onClick={() => draft.external_agent_id && draft.user_id && link(draft.external_agent_id, draft.user_id)}>
            <Plus size={14} className="inline mr-1" /> Link
          </Button>
        </div>
      </Panel>
    </div>
  );
};

// ── Events ──────────────────────────────────────────────────────────────────
const EventsTab = ({ account }) => {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  const [filter, setFilter] = useState('');
  const accountId = account?.id;

  const load = useCallback(() => {
    if (!accountId) return;
    client.get(`dialer-admin/accounts/${accountId}/events`, { params: filter ? { status: filter } : {} })
      .then(r => setRows(r.data.events || [])).catch(() => setRows([]));
  }, [accountId, filter]);
  useEffect(() => { load(); }, [load]);

  const replay = async (id) => {
    try {
      const r = await client.post(`dialer-admin/events/${id}/replay`);
      (r.data.ok ? toast.success : toast.error)(r.data.ok ? `Replayed — ${r.data.route}` : r.data.reason);
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Replay failed'); }
  };

  if (!account) return <EmptyState icon={ScrollText} title="Pick a connection first" />;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div style={{ width: 200 }}>
          <ThemedSelect value={filter} onChange={setFilter} options={[
            { value: '', label: 'Everything' },
            { value: 'accepted', label: 'Accepted' },
            { value: 'ignored', label: 'Ignored' },
            { value: 'rejected', label: 'Rejected' },
            { value: 'error', label: 'Errors' },
          ]} />
        </div>
        <Button variant="secondary" className="text-xs" onClick={load}><RefreshCw size={12} className="inline" /> Refresh</Button>
        <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Kept for 14 days — raw payloads hold customer detail.</span>
      </div>

      {rows === null ? <Loading variant="rows" rows={5} /> : !rows.length ? (
        <Alert type="info">Nothing yet. Fire one call from the dialer with the webhook URL configured.</Alert>
      ) : (
        <div className="space-y-1">
          {rows.map(e => (
            <div key={e.id} className="rounded" style={{ border: '1px solid var(--color-border)' }}>
              <button type="button" className="w-full text-left px-3 py-2 flex items-center gap-2 flex-wrap"
                onClick={() => setOpen(open === e.id ? null : e.id)}>
                <StatusPill status={e.status} />
                <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                  {new Date(e.received_at).toLocaleString()}
                </span>
                {e.normalized?.agent && <code className="text-xs">{e.normalized.agent}</code>}
                {e.normalized?.dispo && <span className="text-xs">{e.normalized.dispo}</span>}
                {e.normalized?.phone && <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{e.normalized.phone}</span>}
                <span className="text-xs flex-1 truncate" style={{ color: 'var(--color-text-secondary)' }}>{e.outcome}</span>
                {e.duration_ms != null && <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{e.duration_ms}ms</span>}
              </button>
              {open === e.id && (
                <div className="px-3 pb-3 space-y-2">
                  {e.error && <Alert type="error">{e.error}</Alert>}
                  <div className="flex gap-2 flex-wrap">
                    <Button variant="secondary" className="text-xs" onClick={() => replay(e.id)}>
                      <Play size={12} className="inline" /> Replay through the current mapping
                    </Button>
                    <Button variant="secondary" className="text-xs" onClick={() => copy(JSON.stringify(e.payload, null, 2), 'Payload copied')}>
                      <Copy size={12} className="inline" /> Copy payload
                    </Button>
                  </div>
                  <pre className="text-[11px] overflow-auto rounded p-2" style={{ maxHeight: 300, background: 'var(--color-bg-tertiary)' }}>
                    {JSON.stringify(e.payload, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Setup ───────────────────────────────────────────────────────────────────
const SetupTab = ({ account, providers }) => {
  const provider = providers.find(p => p.key === account?.provider);
  const url = account ? webhookUrl(account.webhook_token) : 'https://your-crm/api/dialer/hook/<token>';
  return (
    <div className="space-y-4" style={{ maxWidth: 820 }}>
      <Alert type="info">
        {provider?.docs || 'Point anything that can POST JSON at the webhook URL, then finish the mapping from a real payload.'}
      </Alert>
      <ol className="space-y-3 text-sm list-decimal pl-5">
        <li>
          <strong>Put this URL in the dialer</strong> as the webhook / automation target:
          <div className="rounded p-2 mt-1 flex items-center gap-2" style={{ background: 'var(--color-bg-tertiary)' }}>
            <code className="text-xs truncate flex-1">{url}</code>
            <Button variant="secondary" className="text-xs" onClick={() => copy(url, 'Copied')}><Copy size={12} className="inline" /></Button>
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
            POST JSON is best; a GET with query parameters works too. While testing add <code>?dry=1</code> — the call
            is mapped and logged, and nothing is written.
          </div>
        </li>
        <li><strong>Fire one real call</strong>, then open <em>Events</em>. The raw payload is there whether or not the mapping worked.</li>
        <li><strong>Finish the mapping</strong> on the <em>Mapping</em> tab by clicking the keys the dialer sent. Agent, phone and disposition are the three that matter.</li>
        <li><strong>Name your transfer dispositions</strong> on the connection. A transfer is only created when the fronter's disposition is one of those; everything else is still recorded for QA.</li>
        <li><strong>Map the agents</strong> on the <em>Agents</em> tab. Unmapped agents' calls are logged and stop there.</li>
        <li><strong>Recordings.</strong> If the payload carries a recording URL, QA gets the audio immediately. If not, set the API base URL + token and the poller fetches it by call id a minute later.</li>
      </ol>
      <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
        The closer side works the same way: point the closer campaign at the same URL and set its leg to closer (or
        add a leg rule), and its dispositions land on the transfer the fronter created — matched on the lead code,
        then on the customer's number, and queued for the closer if neither matches.
      </p>
    </div>
  );
};

// ── Hub ─────────────────────────────────────────────────────────────────────
export default function DialerHub() {
  const [tab, setTab] = useState('connections');
  const [accounts, setAccounts] = useState(null);
  const [providers, setProviders] = useState([]);
  const [fields, setFields] = useState([]);
  const [transforms, setTransforms] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [selected, setSelected] = useState(null);

  const reload = useCallback(() => {
    client.get('dialer-admin/accounts').then(r => {
      const list = r.data.accounts || [];
      setAccounts(list);
      setSelected(s => (s && list.some(a => a.id === s) ? s : (list[0]?.id || null)));
    }).catch(() => setAccounts([]));
  }, []);

  useEffect(() => {
    reload();
    client.get('dialer-admin/providers').then(r => {
      setProviders(r.data.providers || []);
      setFields(r.data.fields || []);
      setTransforms(r.data.transforms || []);
    }).catch(() => {});
    client.get('companies').then(r => setCompanies(r.data.companies || [])).catch(() => {});
  }, [reload]);

  const account = useMemo(() => (accounts || []).find(a => a.id === selected) || null, [accounts, selected]);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Dialers"
        subtitle="Connect CallTools — or any dialer with a webhook — alongside VICIdial. Its calls become transfers, dispositions and QA recordings through exactly the same engine."
        level="page"
        icon={Radio}
        actions={accounts && accounts.length > 1 ? (
          <div style={{ minWidth: 220 }}>
            <ThemedSelect value={selected || ''} onChange={setSelected}
              options={accounts.map(a => ({ value: a.id, label: a.name }))} />
          </div>
        ) : null}
      />

      {account && !!account.gaps?.length && tab !== 'mapping' && (
        <Alert type="warning">
          <AlertTriangle size={14} className="inline mr-1" />
          <strong>{account.name}</strong> has no source for {account.gaps.join(', ')} — its calls are being
          logged but cannot create transfers yet.
        </Alert>
      )}

      <PillTabs items={TABS.map(t => ({ key: t.k, label: t.label, icon: t.icon }))} value={tab} onChange={setTab} />

      {accounts === null ? <Loading variant="rows" rows={4} /> : (
        <>
          {tab === 'connections' && (
            <ConnectionsTab accounts={accounts} providers={providers} companies={companies}
              selected={selected} onSelect={setSelected} reload={reload} />
          )}
          {tab === 'wiring'  && <WiringTab account={account} reload={reload} />}
          {tab === 'mapping' && <MappingTab account={account} fields={fields} transforms={transforms} reload={reload} />}
          {tab === 'agents'  && <AgentsTab account={account} />}
          {tab === 'events'  && <EventsTab account={account} />}
          {tab === 'setup'   && <SetupTab account={account} providers={providers} />}
        </>
      )}
    </div>
  );
}
