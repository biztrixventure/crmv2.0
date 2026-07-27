import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Smartphone, BellOff, Bell, BellRing, Save, RotateCcw, Trash2,
  MonitorSmartphone, Download, Info, X,
} from 'lucide-react';
import { toast } from 'sonner';
import client from '../../../api/client';
import { Panel, SectionHeader, Loading, EmptyState, Toggle, Field, TableScroll, IconButton } from '../../UI/kit';
import ThemedSelect from '../../UI/Select';
import Button from '../../UI/Button';
import Badge from '../../UI/Badge';

// ============================================================================
// PwaSection — the PWA + notification controls for ONE user.
//
// Everything here is an OVERRIDE of the global matrix in Look & Feel →
// Progressive Web App, and every control is shown next to what the global
// setting currently decides. Without that, "Inherit" is a word with no meaning
// and the admin has to cross-reference two screens to predict what will happen.
//
// The effective result is computed SERVER-side and returned with the override,
// so this screen shows the same verdict the notification pipeline will reach
// rather than its own re-implementation of the rules.
//
// An override can only ever reduce what the global matrix decided. There is no
// per-user "turn it on": that could create a delivery the event has no channel
// for, and would silently contradict the switch set globally.
// ============================================================================

const EVENT_CHOICES = [
  { v: 'inherit', label: 'Inherit the global setting' },
  { v: 'inapp',   label: 'In-app only — no device push' },
  { v: 'off',     label: 'Off for this user' },
];

const INSTALL_CHOICES = [
  { v: 'inherit', label: 'Inherit — follow the global audience' },
  { v: 'show',    label: 'Always show them the install prompt' },
  { v: 'hide',    label: 'Never show them the install prompt' },
];

const inputStyle = { background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' };
const INPUT = 'w-full min-w-0 px-3 py-2 text-sm rounded-lg';

const fmt = (iso) => { try { return new Date(iso).toLocaleString(); } catch { return '—'; } };

function describeUA(ua) {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux' : 'Unknown OS';
  return `${browser} · ${os}`;
}

// What the global matrix does for one event, in three words.
function globalLabel(g) {
  if (g.push) return 'Push';
  if (g.inapp) return 'In-app';
  return 'Off';
}

export default function PwaSection({ account }) {
  const userId = account?.user_id || account?.id;
  const [data, setData]   = useState(null);
  const [draft, setDraft] = useState(null);
  const [baseline, setBaseline] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const r = await client.get(`pwa/user/${userId}`);
      setData(r.data);
      setDraft(r.data.override);
      setBaseline(JSON.stringify(r.data.override));
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not load notification settings.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const dirty = useMemo(
    () => Boolean(draft) && JSON.stringify(draft) !== baseline,
    [draft, baseline],
  );

  const save = async () => {
    setSaving(true);
    try {
      await client.put(`pwa/user/${userId}`, { override: draft });
      // Re-read rather than trusting local state: the server recomputes the
      // effective result, which is the whole point of showing it.
      await load();
      toast.success('Saved. This user’s notification settings are live.');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const revokeDevice = async (id) => {
    try {
      await client.delete(`pwa/devices/${id}`);
      setData(d => ({ ...d, devices: d.devices.filter(x => x.id !== id) }));
      toast.success('Device revoked.');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Revoke failed.');
    } finally {
      setConfirming(null);
    }
  };

  if (loading || !draft) return <Loading variant="rows" rows={6} />;

  const setEvent = (id, v) => setDraft(p => {
    const events = { ...p.events };
    if (v === 'inherit') delete events[id]; else events[id] = v;
    return { ...p, events: events };
  });

  const overriddenCount = Object.keys(draft.events).length;
  const groups = (data.catalog || []).reduce((m, e) => {
    (m[e.group] = m[e.group] || []).push(e);
    return m;
  }, {});

  return (
    <div className="space-y-5">
      <SectionHeader
        icon={Smartphone}
        title="App & notifications"
        subtitle="Per-user overrides of the global PWA settings. Anything left on Inherit follows Look & Feel → Progressive Web App."
        actions={
          <>
            {dirty && (
              <Button variant="ghost" size="sm" onClick={() => setDraft(JSON.parse(baseline))}>
                <RotateCcw size={14} /> Discard
              </Button>
            )}
            <Button variant="primary" size="sm" onClick={save} loading={saving} disabled={!dirty}>
              {!saving && <Save size={14} />} {dirty ? 'Save changes' : 'Saved'}
            </Button>
          </>
        }
      />

      {!data.pwa_enabled && (
        <Panel tone="inset" radius="xl" pad="sm">
          <p className="text-[11px] m-0" style={{ color: 'var(--color-warning-600)' }}>
            The PWA layer is switched off globally, so the install prompt will not appear for anyone regardless of
            what is set here. Notification overrides below still apply — those are independent of it.
          </p>
        </Panel>
      )}

      {/* ── Blanket switches ─────────────────────────────────────────────── */}
      <Panel tone="inset" radius="xl" pad="md">
        <SectionHeader level="sub" icon={BellOff} title="Blanket" />
        <div className="space-y-4">
          <Toggle
            checked={!!draft.mute_all}
            onChange={v => setDraft(p => ({ ...p, mute_all: v }))}
            label="Mute everything for this user"
            tone={draft.mute_all ? 'warn' : 'muted'}
            hint="No in-app notifications and no device pushes, for any event. The strongest switch here — it overrules everything below."
          />
          <Toggle
            checked={!!draft.push_off}
            onChange={v => setDraft(p => ({ ...p, push_off: v }))}
            label="No device pushes — in-app only"
            tone={draft.push_off ? 'warn' : 'muted'}
            disabled={draft.mute_all}
            hint="They still get every notification in the bell; their phone and desktop just stay quiet."
          />
        </div>
      </Panel>

      {/* ── Install prompt ───────────────────────────────────────────────── */}
      <Panel tone="inset" radius="xl" pad="md">
        <SectionHeader level="sub" icon={Download} title="Install prompt" />
        <div className="grid sm:grid-cols-2 gap-4 items-start">
          <Field label="For this user">
            <ThemedSelect value={draft.install_prompt} className={INPUT} style={inputStyle}
              onChange={e => setDraft(p => ({ ...p, install_prompt: e.target.value }))}>
              {INSTALL_CHOICES.map(c => <option key={c.v} value={c.v}>{c.label}</option>)}
            </ThemedSelect>
          </Field>
          <div className="min-w-0">
            <div className="text-[11px] sm:text-[10px] font-bold uppercase tracking-wider leading-none mb-1"
              style={{ color: 'var(--color-text-secondary)' }}>Right now</div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={data.install.result ? 'success' : 'warning'} size="sm">
                {data.install.result ? 'They see it' : 'They do not see it'}
              </Badge>
              <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                global audience: {data.install.audience === 'superadmin' ? 'superadmins only' : 'everyone'}
              </span>
            </div>
            <p className="text-[11px] m-0 mt-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
              This is our own prompt. A browser's built-in Install menu item is a browser feature and stays
              available whatever is set here.
            </p>
          </div>
        </div>
      </Panel>

      {/* ── Per-event ────────────────────────────────────────────────────── */}
      <Panel tone="inset" radius="xl" pad="md">
        <SectionHeader level="sub" icon={Bell}
          title={`Per event${overriddenCount ? ` — ${overriddenCount} overridden` : ''}`} />
        {draft.mute_all && (
          <p className="text-[11px] m-0 mb-3" style={{ color: 'var(--color-warning-600)' }}>
            Everything is muted for this user, so the choices below have no effect until you turn that off.
          </p>
        )}
        <div className="space-y-4">
          {Object.entries(groups).map(([group, list]) => (
            <div key={group}>
              <div className="text-[11px] sm:text-[10px] font-bold uppercase tracking-wider leading-none mb-2"
                style={{ color: 'var(--color-text-tertiary)' }}>{group}</div>
              <div className="space-y-2">
                {list.map(e => {
                  const eff = data.effective[e.id] || { global: {}, result: {} };
                  const choice = draft.events[e.id] || 'inherit';
                  const globalOff = !eff.global.inapp && !eff.global.push;
                  return (
                    <div key={e.id}
                      className="flex items-center justify-between gap-3 flex-wrap px-3 py-2 rounded-xl"
                      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                      <div className="min-w-0 flex-1" style={{ minWidth: 150 }}>
                        <div className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>{e.label}</div>
                        {/* The whole reason "Inherit" is meaningful. */}
                        <div className="text-[11px] leading-none mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                          Global: {globalLabel(eff.global)}
                          {globalOff && ' — already off for everyone'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <ThemedSelect value={choice} className="px-3 py-1.5 text-sm rounded-lg min-w-0"
                          style={{ ...inputStyle, maxWidth: 240 }}
                          onChange={ev => setEvent(e.id, ev.target.value)}>
                          {EVENT_CHOICES.map(c => <option key={c.v} value={c.v}>{c.label}</option>)}
                        </ThemedSelect>
                        {/* The saved verdict, not the unsaved draft — it comes
                            from the server, so it only moves once you save. */}
                        {eff.result.push ? <BellRing size={14} style={{ color: 'var(--color-success-600)' }} />
                          : eff.result.inapp ? <Bell size={14} style={{ color: 'var(--color-info-600)' }} />
                          : <BellOff size={14} style={{ color: 'var(--color-text-tertiary)' }} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-start gap-2 mt-3">
          <Info size={12} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-text-tertiary)' }} />
          <p className="text-[11px] m-0" style={{ color: 'var(--color-text-tertiary)' }}>
            The icon on the right is the SAVED result, computed by the server — the same verdict the notification
            pipeline reaches. It moves when you save, not while you are choosing.
          </p>
        </div>
      </Panel>

      {/* ── This user's devices ──────────────────────────────────────────── */}
      <Panel tone="inset" radius="xl" pad="md">
        <SectionHeader level="sub" icon={MonitorSmartphone}
          title={`Devices — ${data.devices.length}`} />
        {!data.devices.length ? (
          <EmptyState compact icon={MonitorSmartphone} title="No subscribed devices"
            hint="A device appears once this user grants notification permission in their browser." />
        ) : (
          <TableScroll stickyFirst label="This user's devices">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  {['Device', 'Push service', 'Subscribed', ''].map((h, i) => (
                    <th key={h || i}
                      className="text-left px-3 py-2 text-[11px] sm:text-[10px] font-bold uppercase tracking-wider leading-none whitespace-nowrap"
                      style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.devices.map(d => (
                  <tr key={d.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td className="px-3 py-2.5 whitespace-nowrap" title={d.user_agent || ''}
                      style={{ color: 'var(--color-text)' }}>{describeUA(d.user_agent)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap font-mono text-[13px]"
                      style={{ color: 'var(--color-text-secondary)' }}>{d.provider}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap"
                      style={{ color: 'var(--color-text-secondary)' }}>{fmt(d.created_at)}</td>
                    <td className="px-3 py-2.5">
                      {confirming === d.id ? (
                        <div className="flex items-center gap-1.5">
                          <Button variant="danger" size="xs" onClick={() => revokeDevice(d.id)}>Revoke</Button>
                          <IconButton label="Cancel" variant="ghost" onClick={() => setConfirming(null)}>
                            <X size={15} />
                          </IconButton>
                        </div>
                      ) : (
                        <IconButton label="Revoke this device" tone="danger" variant="ghost"
                          onClick={() => setConfirming(d.id)}>
                          <Trash2 size={15} />
                        </IconButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
        <p className="text-[11px] m-0 mt-3" style={{ color: 'var(--color-text-tertiary)' }}>
          Revoking stops pushes to that one browser. It is not a punishment — they re-subscribe by allowing
          notifications again, which is also the cure for a user whose subscriptions have piled up.
        </p>
      </Panel>
    </div>
  );
}
