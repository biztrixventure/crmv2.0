import { useState, useEffect, useCallback, useMemo } from 'react';
import { MonitorSmartphone, RefreshCw, Trash2, Search, ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../../api/client';
import { Panel, SectionHeader, Loading, EmptyState, TableScroll, IconButton } from '../../UI/kit';
import Button from '../../UI/Button';

// ============================================================================
// Devices — every browser that has a live push subscription.
//
// The endpoint column shows the push service HOST only. A push endpoint is a
// capability URL: anyone holding it can push to that device, so the token never
// leaves the server (see backend/routes/pwa.js). There is nothing to reveal
// here, which is why there is no "show full endpoint" affordance.
//
// Revoking deletes the subscription row. It does not punish the user — their
// browser re-subscribes on the next permission check — so it is the right tool
// for a stale device, not a disciplinary one.
// ============================================================================

// A user-agent string is not identity, it is a hint. Parsing it down to
// "Chrome · Windows" is more honest than printing 180 characters of it, and the
// full string stays in the title attribute for when the hint isn't enough.
function describeUA(ua) {
  if (!ua) return 'Unknown device';
  const browser =
    /Edg\//.test(ua)                      ? 'Edge'
    : /OPR\/|Opera/.test(ua)              ? 'Opera'
    : /Chrome\//.test(ua)                 ? 'Chrome'
    : /Firefox\//.test(ua)                ? 'Firefox'
    : /Safari\//.test(ua)                 ? 'Safari'
    : 'Browser';
  const os =
    /Android/.test(ua)                    ? 'Android'
    : /iPhone|iPad|iPod/.test(ua)         ? 'iOS'
    : /Windows/.test(ua)                  ? 'Windows'
    : /Mac OS X/.test(ua)                 ? 'macOS'
    : /Linux/.test(ua)                    ? 'Linux'
    : 'Unknown OS';
  return `${browser} · ${os}`;
}

const fmt = (iso) => { try { return new Date(iso).toLocaleString(); } catch { return '—'; } };

export default function DevicesSection() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [confirming, setConfirming] = useState(null);   // device id awaiting a second click
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await client.get('pwa/devices');
      setDevices(r.data.devices || []);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not load devices.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const revoke = async (id) => {
    setBusyId(id);
    try {
      await client.delete(`pwa/devices/${id}`);
      setDevices(d => d.filter(x => x.id !== id));
      toast.success('Device revoked.');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Revoke failed.');
    } finally {
      setBusyId(null);
      setConfirming(null);
    }
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return devices;
    return devices.filter(d =>
      [d.user, d.email, d.provider, d.user_agent].filter(Boolean)
        .some(v => String(v).toLowerCase().includes(needle)));
  }, [devices, q]);

  const users = useMemo(() => new Set(devices.map(d => d.user_id)).size, [devices]);

  return (
    <Panel pad="lg">
      <SectionHeader
        icon={MonitorSmartphone}
        title="Subscribed devices"
        subtitle={loading ? 'Loading…' : `${devices.length} device${devices.length === 1 ? '' : 's'} across ${users} user${users === 1 ? '' : 's'}.`}
        actions={
          <>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: 'var(--color-text-tertiary)' }} />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search user, browser…"
                className="w-full min-w-0 pl-8 pr-3 py-2 text-sm rounded-lg"
                style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)', maxWidth: 220 }} />
            </div>
            <Button variant="ghost" size="sm" onClick={load}><RefreshCw size={14} /> Refresh</Button>
          </>
        }
      />

      {loading ? (
        <Loading variant="table" rows={5} />
      ) : !filtered.length ? (
        <EmptyState
          icon={MonitorSmartphone}
          title={devices.length ? 'No device matches that search' : 'No subscribed devices yet'}
          hint={devices.length
            ? 'Clear the search to see all of them.'
            : 'A device appears here once someone grants notification permission in their browser.'}
          action={devices.length ? <Button variant="secondary" size="sm" onClick={() => setQ('')}>Clear search</Button> : null}
        />
      ) : (
        <TableScroll stickyFirst label="Subscribed devices">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                {['User', 'Device', 'Push service', 'Subscribed', ''].map((h, i) => (
                  <th key={h || i}
                    className="text-left px-3 py-2 text-[11px] sm:text-[10px] font-bold uppercase tracking-wider leading-none whitespace-nowrap"
                    style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => (
                <tr key={d.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td className="px-3 py-2.5">
                    <div className="font-semibold whitespace-nowrap" style={{ color: 'var(--color-text)' }}>{d.user}</div>
                    {d.email && (
                      <div className="text-[11px] leading-none mt-1 whitespace-nowrap"
                        style={{ color: 'var(--color-text-tertiary)' }}>{d.email}</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap" title={d.user_agent || ''}
                    style={{ color: 'var(--color-text-secondary)' }}>
                    {describeUA(d.user_agent)}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap font-mono text-[13px]"
                    style={{ color: 'var(--color-text-secondary)' }}>{d.provider}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                    {fmt(d.created_at)}
                  </td>
                  <td className="px-3 py-2.5">
                    {/* Two-step, not a native confirm(): the second click IS the
                        confirmation, and it stays inside the row you aimed at. */}
                    {confirming === d.id ? (
                      <div className="flex items-center gap-1.5">
                        <Button variant="danger" size="xs" onClick={() => revoke(d.id)}
                          loading={busyId === d.id}>Revoke</Button>
                        <IconButton label="Cancel" variant="ghost" onClick={() => setConfirming(null)}>
                          <X size={15} />
                        </IconButton>
                      </div>
                    ) : (
                      <IconButton label={`Revoke ${d.user}'s device`} tone="danger" variant="ghost"
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

      <div className="flex items-start gap-2.5 mt-4">
        <ShieldCheck size={13} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-success-600)' }} />
        <p className="text-[11px] m-0" style={{ color: 'var(--color-text-tertiary)' }}>
          Only the push service host is shown. The endpoint itself is a capability URL — anyone holding it can push
          to that device — so it never leaves the server. Revoking stops pushes to that one browser; the person can
          re-subscribe simply by allowing notifications again.
        </p>
      </div>
    </Panel>
  );
}
