import { useEffect, useState, useCallback } from 'react';
import { Headphones, Plus, Trash2, Pencil, X, History, Power, Loader2, Check, Search, Wifi } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Alert } from '../../UI';
import client from '../../../api/client';

const fmt = (s) => s ? new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

// ── Superadmin: manage external client logins for the recording portal ───────
export default function ClientPortalTab() {
  const [clients, setClients] = useState(null);
  const [closers, setClosers] = useState([]);
  const [editing, setEditing] = useState(null);   // client obj or 'new'
  const [auditFor, setAuditFor] = useState(null);
  const [diag, setDiag] = useState(null);
  const [diagBusy, setDiagBusy] = useState(false);

  const runDiag = async () => {
    setDiagBusy(true); setDiag(null);
    try { const r = await client.get('portal/admin/diag'); setDiag(r.data); }
    catch (e) { setDiag({ error: e.response?.data?.error || 'Diagnostic failed' }); }
    finally { setDiagBusy(false); }
  };

  const load = useCallback(async () => {
    const [c, cl] = await Promise.all([
      client.get('portal/admin/clients').catch(() => ({ data: { clients: [] } })),
      client.get('portal/admin/closers').catch(() => ({ data: { closers: [] } })),
    ]);
    setClients(c.data.clients || []);
    setClosers(cl.data.closers || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const del = async (c) => {
    if (!window.confirm(`Delete client login "${c.name}"? Their access is removed immediately.`)) return;
    try { await client.delete(`portal/admin/clients/${c.id}`); toast.success('Client deleted'); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'Delete failed'); }
  };
  const toggle = async (c) => {
    try { await client.patch(`portal/admin/clients/${c.id}`, { is_active: !c.is_active }); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'Update failed'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <Headphones size={18} /> Client Recording Portal
          </h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            External logins that only see assigned closers' sales + play the actual sale-call recording. They never see the CRM.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={runDiag} disabled={diagBusy} variant="secondary" className="text-sm">
            {diagBusy ? <Loader2 size={14} className="animate-spin inline mr-1" /> : <Wifi size={14} className="inline mr-1" />} Test dialer access
          </Button>
          <Button onClick={() => setEditing('new')} variant="primary" className="text-sm">
            <Plus size={15} className="inline mr-1" /> New client
          </Button>
        </div>
      </div>

      {diag && (
        <div className="rounded-xl p-3 text-sm" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          {diag.error ? <span style={{ color: 'var(--color-error-600)' }}>{diag.error}</span> : (
            <div className="space-y-1">
              <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>Dialer reachability from this server</div>
              {(diag.boxes || []).map(b => {
                const ok = b.status === 'reachable';
                return (
                  <div key={b.box} className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ background: ok ? 'var(--color-success-500)' : 'var(--color-error-500)' }} />
                    <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{b.box}</span>
                    <span style={{ color: ok ? 'var(--color-success-600)' : 'var(--color-error-600)' }}>{b.status}</span>
                    <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{b.ms}ms {b.error || ''}</span>
                  </div>
                );
              })}
              {(diag.boxes || []).every(b => b.status !== 'reachable') && (
                <p className="text-xs mt-1" style={{ color: 'var(--color-warning-700)' }}>
                  All boxes unreachable → this server's IP is likely not whitelisted on the dialer. Recordings can't be fetched until it is.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {clients === null ? (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin" style={{ color: 'var(--color-primary-500)' }} /></div>
      ) : clients.length === 0 ? (
        <div className="text-center py-12 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
          No client logins yet. Create one to give a client recording access.
        </div>
      ) : (
        <div className="space-y-2">
          {clients.map(c => (
            <div key={c.id} className="rounded-xl p-4 flex items-center gap-3 flex-wrap"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>{c.name}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-bold"
                    style={{ background: c.is_active ? 'var(--color-success-100)' : 'var(--color-bg-secondary)', color: c.is_active ? 'var(--color-success-700)' : 'var(--color-text-tertiary)' }}>
                    {c.is_active ? 'Active' : 'Disabled'}
                  </span>
                </div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{c.login_email}</div>
                <div className="text-[11px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                  {c.closers.map(x => x.name).join(', ') || 'No closers'} · {c.listen_count} listen{c.listen_count === 1 ? '' : 's'}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setAuditFor(c)} title="Listen history" className="p-2 rounded-lg hover:bg-bg-secondary"><History size={15} style={{ color: 'var(--color-text-secondary)' }} /></button>
                <button onClick={() => toggle(c)} title={c.is_active ? 'Disable' : 'Enable'} className="p-2 rounded-lg hover:bg-bg-secondary"><Power size={15} style={{ color: c.is_active ? 'var(--color-success-600)' : 'var(--color-text-tertiary)' }} /></button>
                <button onClick={() => setEditing(c)} title="Edit" className="p-2 rounded-lg hover:bg-bg-secondary"><Pencil size={15} style={{ color: 'var(--color-text-secondary)' }} /></button>
                <button onClick={() => del(c)} title="Delete" className="p-2 rounded-lg hover:bg-error-50"><Trash2 size={15} style={{ color: 'var(--color-error-500)' }} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && <ClientEditor client={editing === 'new' ? null : editing} closers={closers} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {auditFor && <AuditModal client={auditFor} onClose={() => setAuditFor(null)} />}
    </div>
  );
}

// ── create / edit ────────────────────────────────────────────────────────────
function ClientEditor({ client: c, closers, onClose, onSaved }) {
  const [name, setName] = useState(c?.name || '');
  const [email, setEmail] = useState(c?.login_email || '');
  const [password, setPassword] = useState('');
  const [picked, setPicked] = useState(new Set(c?.closer_ids || []));
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const isNew = !c;

  const togglePick = (id) => setPicked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const save = async () => {
    setErr(''); setBusy(true);
    try {
      const closer_ids = [...picked];
      if (isNew) {
        await client.post('portal/admin/clients', { name, email, password, closer_ids });
        toast.success('Client created');
      } else {
        const body = { name, closer_ids };
        if (password) body.password = password;
        await client.patch(`portal/admin/clients/${c.id}`, body);
        toast.success('Client updated');
      }
      onSaved();
    } catch (e) { setErr(e.response?.data?.error || 'Save failed'); } finally { setBusy(false); }
  };

  const shown = closers.filter(x => !q.trim() || x.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl p-5 max-h-[90vh] overflow-y-auto" style={{ background: 'var(--color-surface)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold" style={{ color: 'var(--color-text)' }}>{isNew ? 'New client login' : 'Edit client'}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-bg-secondary"><X size={16} /></button>
        </div>
        {err && <Alert type="error" message={err} />}
        <div className="space-y-3">
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>Client name</label>
            <input value={name} onChange={e => setName(e.target.value)} className="input text-sm mt-1" placeholder="Acme Insurance" />
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>Login email</label>
            <input value={email} onChange={e => setEmail(e.target.value)} disabled={!isNew} className="input text-sm mt-1" placeholder="client@example.com" />
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>{isNew ? 'Password' : 'New password (optional)'}</label>
            <input value={password} onChange={e => setPassword(e.target.value)} type="text" className="input text-sm mt-1" placeholder={isNew ? '6+ characters' : 'leave blank to keep'} />
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wide flex items-center justify-between" style={{ color: 'var(--color-text-secondary)' }}>
              <span>Closers this client can see ({picked.size})</span>
            </label>
            <div className="relative mt-1 mb-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter closers…" className="input text-sm pl-8" />
            </div>
            <div className="max-h-52 overflow-y-auto space-y-1 rounded-lg p-1" style={{ border: '1px solid var(--color-border)' }}>
              {shown.map(x => {
                const on = picked.has(x.id);
                return (
                  <button key={x.id} onClick={() => togglePick(x.id)} className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-sm"
                    style={{ background: on ? 'var(--color-primary-100)' : 'transparent', color: 'var(--color-text)' }}>
                    <span className="w-4 h-4 rounded flex items-center justify-center" style={{ background: on ? 'var(--color-primary-500)' : 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                      {on && <Check size={11} className="text-white" />}
                    </span>
                    {x.name}
                  </button>
                );
              })}
              {shown.length === 0 && <p className="text-xs italic py-2 px-2" style={{ color: 'var(--color-text-tertiary)' }}>No closers match.</p>}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button onClick={onClose} variant="secondary" className="text-sm">Cancel</Button>
          <Button onClick={save} disabled={busy || !name || (isNew && (!email || password.length < 6)) || picked.size === 0} variant="primary" className="text-sm">
            {busy ? <Loader2 size={14} className="animate-spin inline mr-1" /> : null}{isNew ? 'Create' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── audit ────────────────────────────────────────────────────────────────────
function AuditModal({ client: c, onClose }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    client.get(`portal/admin/clients/${c.id}/listens`)
      .then(r => setRows(r.data.listens || [])).catch(() => setRows([]));
  }, [c.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl p-5 max-h-[90vh] overflow-y-auto" style={{ background: 'var(--color-surface)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}><History size={17} /> {c.name} — listen history</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-bg-secondary"><X size={16} /></button>
        </div>
        {rows === null ? (
          <div className="flex justify-center py-8"><Loader2 className="animate-spin" /></div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-center py-8" style={{ color: 'var(--color-text-tertiary)' }}>No recordings played yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr style={{ borderBottom: '1px solid var(--color-border)' }}>
              {['Customer', 'Closer', 'When', 'IP'].map(h => <th key={h} className="text-left px-2 py-2 text-[11px] font-bold uppercase" style={{ color: 'var(--color-text-secondary)' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td className="px-2 py-2" style={{ color: 'var(--color-text)' }}>{r.customer_name || '—'}</td>
                  <td className="px-2 py-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{r.closer_name || '—'}</td>
                  <td className="px-2 py-2 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{fmt(r.listened_at)}</td>
                  <td className="px-2 py-2 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{r.ip || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
