// CustomerLookupSection — who may use the customer lookup tool, and where that
// tool actually lives.
//
// Two things on one page, because they are useless apart: the switches decide
// WHO, the service card decides WHAT they are calling. Both are superadmin-only.
//
// The service is external and self-hosted, so nothing about it is compiled in:
// the base URL, the key and the timeout are all editable here and take effect
// on the next search. The key is write-only — it is stored server-side in
// app_secrets and only ever comes back as a masked tail.
//
// Both user switches default OFF. Turning the service on globally still shows
// the tool to nobody until a switch is flipped for a named person.
import { useState, useEffect, useCallback } from 'react';
import { Search, User, Car, Link2, KeyRound, Timer, Plug, CheckCircle2, XCircle } from 'lucide-react';
import client from '../../../api/client';
import { Alert } from '../../../components/UI';
import { Panel, SectionHeader, Loading, Toggle, Field, useFlash } from '../../UI/kit';

const SWITCHES = [
  {
    key: 'people',
    icon: User,
    label: 'Look customers up by phone or name',
    hint: 'Opens the People search: a phone number (optionally narrowed by a name) or a name returns the profile — other numbers on the same person, addresses, relatives and property.',
  },
  {
    key: 'vehicles',
    icon: Car,
    label: 'Find vehicles at an address',
    hint: 'Opens the Vehicles search: vehicles recorded at an address. They can type the address, or turn a name or phone into one — that path returns addresses only, never a full profile.',
  },
];

export default function CustomerLookupSection({ account }) {
  const userId = account?.user_id;
  const [access, setAccess]   = useState({ people: false, vehicles: false });
  const [cfg, setCfg]         = useState(null);
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(true);
  const [busy, setBusy]       = useState(null);
  const { msg, flash, clear } = useFlash();

  // Service form (local until saved).
  const [baseUrl, setBaseUrl]   = useState('');
  const [apiKey, setApiKey]     = useState('');
  const [timeoutMs, setTimeoutMs] = useState(25000);
  const [testing, setTesting]   = useState(false);
  const [testRes, setTestRes]   = useState(null);

  const hydrate = useCallback((settings) => {
    setCfg(settings);
    setBaseUrl(settings.base_url || settings.default_base_url || '');
    setTimeoutMs(settings.timeout_ms || 25000);
  }, []);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const r = await client.get(`customer-lookup/access/${userId}`);
      setAccess({ people: !!r.data.people, vehicles: !!r.data.vehicles });
      hydrate(r.data.settings);
      setAllowed(true);
    } catch (e) {
      if (e.response?.status === 403) setAllowed(false);
    } finally { setLoading(false); }
  }, [userId, hydrate]);

  useEffect(() => { load(); }, [load]);

  const saveSwitch = async (key, next) => {
    setBusy(key);
    try {
      const r = await client.put(`customer-lookup/access/${userId}`, { [key]: next });
      setAccess({ people: !!r.data.people, vehicles: !!r.data.vehicles });
      hydrate(r.data.settings);
      const what = key === 'people' ? 'People search' : 'Vehicle search';
      flash('success', next
        ? `${what} is on for this user. It appears in their Staff shell as "Customer Lookup".`
        : `${what} is off for this user.`);
    } catch (e) {
      flash('error', e.response?.data?.error || 'Could not save that switch.');
    } finally { setBusy(null); }
  };

  const saveService = async (patch, note) => {
    setBusy('service');
    try {
      const r = await client.put('customer-lookup/settings', patch);
      hydrate(r.data);
      setApiKey('');
      setTestRes(null);
      flash('success', note || 'Saved.');
    } catch (e) {
      flash('error', e.response?.data?.error || 'Could not save the service settings.');
    } finally { setBusy(null); }
  };

  const runTest = async () => {
    setTesting(true); setTestRes(null);
    try {
      const r = await client.get('customer-lookup/settings/test');
      setTestRes(r.data);
    } catch (e) {
      setTestRes({ ok: false, error: e.response?.data?.error || 'Test failed.' });
    } finally { setTesting(false); }
  };

  if (loading) return <Loading variant="rows" rows={4} label="Loading customer lookup access" />;

  if (!allowed) {
    return (
      <div className="max-w-2xl">
        <SectionHeader icon={Search} title="Customer Lookup" />
        <Alert type="info" dismissible={false}>Only a superadmin can grant customer lookup or change the service.</Alert>
      </div>
    );
  }

  const live = cfg?.enabled && cfg?.configured;

  return (
    <div className="space-y-5 max-w-2xl">
      <SectionHeader icon={Search} title="Customer Lookup"
        subtitle="Let this person look a customer up against the external lookup service" />

      {msg && <Alert type={msg.type} onDismiss={clear}>{msg.text}</Alert>}

      {!live && (
        <Alert type="warning" dismissible={false}>
          {cfg?.enabled === false
            ? 'The lookup service is switched off, so these switches grant nothing yet. Turn it on below.'
            : 'The lookup service has no base URL or API key yet, so these switches grant nothing. Set it up below.'}
        </Alert>
      )}

      {/* ── who ─────────────────────────────────────────────────────────────── */}
      {SWITCHES.map(s => (
        <Panel key={s.key} tone="inset" radius="xl">
          <Toggle
            checked={access[s.key]}
            onChange={(next) => saveSwitch(s.key, next)}
            busy={busy === s.key}
            label={s.label}
            hint={s.hint} />
        </Panel>
      ))}

      <p className="text-[11px] m-0" style={{ color: 'var(--color-text-secondary)' }}>
        Both are off for everyone until you turn them on, one person at a time. The tool never writes to the CRM —
        results are shown and forgotten — but every search is written to the server log against this user's name.
      </p>

      {/* ── what ────────────────────────────────────────────────────────────── */}
      <Panel radius="xl">
        <SectionHeader level="sub" icon={Plug} title="Lookup service"
          actions={
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold"
              style={{ color: live ? 'var(--color-success-600)' : 'var(--color-text-tertiary)' }}>
              {live ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
              {live ? 'Live' : (cfg?.enabled ? 'Not configured' : 'Off')}
            </span>
          } />

        <div className="space-y-3">
          <Field label="Base URL" hint="Where the service runs. Everything else is appended to this — /api/lookup, /api/search, /api/vehicles.">
            <div className="relative">
              <Link2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-text-tertiary)' }} />
              <input className="input pl-9" value={baseUrl} placeholder={cfg?.default_base_url || 'http://host:port'}
                onChange={e => setBaseUrl(e.target.value)} spellCheck={false} />
            </div>
          </Field>

          <Field label="API key"
            hint={cfg?.has_key ? `A key is stored (${cfg.key_preview}). Type a new one to replace it.` : 'Sent as the X-API-Key header. Stored server-side; it never reaches a browser.'}>
            <div className="relative">
              <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-text-tertiary)' }} />
              <input className="input pl-9" type="password" autoComplete="new-password" value={apiKey}
                placeholder={cfg?.has_key ? '•••••••••••••••' : 'Paste the API key'}
                onChange={e => setApiKey(e.target.value)} spellCheck={false} />
            </div>
          </Field>

          <Field label="Timeout (ms)" hint="A first-time lookup has to fetch, so keep this generous. 3000–90000.">
            <div className="relative">
              <Timer size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-text-tertiary)' }} />
              <input className="input pl-9" type="number" min={3000} max={90000} step={1000} value={timeoutMs}
                onChange={e => setTimeoutMs(e.target.value)} />
            </div>
          </Field>

          <div className="flex items-center gap-2 flex-wrap pt-1">
            <button type="button" disabled={busy === 'service'}
              onClick={() => saveService(
                { base_url: baseUrl, timeout_ms: timeoutMs, ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}) },
                apiKey.trim() ? 'Saved. The new key is stored and the service is on.' : 'Saved.',
              )}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold text-white disabled:opacity-60"
              style={{ background: 'var(--gradient-sidebar)' }}>
              Save service
            </button>
            <button type="button" onClick={runTest} disabled={testing || !cfg?.configured}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold border disabled:opacity-50"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)', background: 'var(--color-surface)' }}>
              {testing ? 'Testing…' : 'Test connection'}
            </button>
            {cfg?.has_key && (
              <button type="button" disabled={busy === 'service'}
                onClick={() => saveService({ clear_key: true }, 'Key removed. The service is switched off until a new key is saved.')}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold border ml-auto disabled:opacity-60"
                style={{ borderColor: 'var(--color-error-600)', color: 'var(--color-error-600)', background: 'transparent' }}>
                Remove key
              </button>
            )}
          </div>

          {testRes && (
            <Alert type={testRes.ok ? 'success' : 'error'} dismissible={false}>
              {testRes.ok ? testRes.message : testRes.error}
            </Alert>
          )}

          <div className="pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
            <Toggle
              checked={!!cfg?.enabled}
              onChange={(next) => saveService({ enabled: next }, next ? 'Lookup service on.' : 'Lookup service off — nobody can search until it is back on.')}
              busy={busy === 'service'}
              label="Lookup service is on"
              hint="The master switch. Off closes the tool for everyone at once without touching anybody's switches." />
          </div>

          {cfg?.granted_users > 0 && (
            <p className="text-[11px] m-0" style={{ color: 'var(--color-text-tertiary)' }}>
              {cfg.granted_users} {cfg.granted_users === 1 ? 'user has' : 'users have'} at least one of these switches on.
            </p>
          )}
        </div>
      </Panel>
    </div>
  );
}
