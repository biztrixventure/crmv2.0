import { useState, useEffect, useCallback } from 'react';
import { PhoneCall, Plus, Trash2, Save, Search, Hash, Users, ChevronDown, Loader2, Check, ListChecks, AlertTriangle, DownloadCloud, RotateCcw, Info, Server, ShieldCheck, Wifi } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Alert } from '../../UI';
import client from '../../../api/client';
import ThemedSelect from '../../UI/Select';

// Superadmin config for the VICIdial integration: the per-company prefix
// registry (makes the correlation code globally unique) and the VICIdial-agent
// → CRM-user map (routes pending transfers + dispositions to the right person).
const TABS = [
  { k: 'boxes',    label: 'Dialer boxes',     icon: Server },
  { k: 'validate', label: 'IP validation',    icon: ShieldCheck },
  { k: 'prefixes', label: 'Prefix registry',  icon: Hash },
  { k: 'agents',   label: 'Agent mapping',    icon: Users },
  { k: 'dispo',    label: 'Disposition map',  icon: ListChecks },
  { k: 'backfill', label: 'Backfill dispos',  icon: DownloadCloud },
  { k: 'setup',    label: 'Setup URLs',       icon: PhoneCall },
];

// ── Dialer boxes (URL / API user+pass / prefix) ──────────────────────────────
const Boxes = () => {
  const [rows, setRows] = useState(null);
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => { client.get('vicidial/boxes').then(r => setRows(r.data.boxes || [])).catch(() => setRows([])); }, []);
  useEffect(() => { load(); }, [load]);

  const del = async (b) => { if (!window.confirm(`Delete dialer box "${b.name}" (${b.prefix})? Lookups for its leads will stop working.`)) return; try { await client.delete(`vicidial/boxes/${b.id}`); toast.success('Box deleted'); load(); } catch (e) { toast.error(e.response?.data?.error || 'Failed'); } };

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        The VICIdial servers the CRM talks to for dispositions + recordings. Change a <strong>URL</strong>, <strong>API user/password</strong>, or <strong>prefix</strong> here when a dialer changes — it takes effect within ~60s, no redeploy.
      </p>
      {rows === null ? <div className="flex justify-center py-8"><Loader2 className="animate-spin" /></div> : (
        <div className="space-y-2">
          {rows.map(b => <BoxRow key={b.id} box={b} onSaved={load} onDelete={() => del(b)} />)}
          {adding
            ? <BoxRow box={null} onSaved={() => { setAdding(false); load(); }} onDelete={() => setAdding(false)} />
            : <Button onClick={() => setAdding(true)} variant="secondary" className="text-sm"><Plus size={14} className="inline mr-1" /> Add dialer box</Button>}
        </div>
      )}
    </div>
  );
};

const BoxRow = ({ box, onSaved, onDelete }) => {
  const isNew = !box;
  const [f, setF] = useState({ name: box?.name || '', prefix: box?.prefix || '', base_url: box?.base_url || '', api_user: box?.api_user || '', api_pass: box ? '' : '', validation_url: box?.validation_url || '', is_active: box ? box.is_active : true });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const save = async () => {
    setBusy(true);
    try {
      const body = { ...f }; if (!isNew && !body.api_pass) delete body.api_pass;   // blank = keep
      if (isNew) await client.post('vicidial/boxes', body); else await client.patch(`vicidial/boxes/${box.id}`, body);
      toast.success(isNew ? 'Box added' : 'Box saved'); onSaved();
    } catch (e) { toast.error(e.response?.data?.error || 'Save failed'); } finally { setBusy(false); }
  };
  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', opacity: box && !box.is_active ? 0.6 : 1 }}>
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 items-end">
        <Field label="Name (id)" v={f.name} onChange={v => set('name', v)} ph="tmc" disabled={!isNew} />
        <Field label="Prefix" v={f.prefix} onChange={v => set('prefix', v.toUpperCase())} ph="TMC" />
        <div className="sm:col-span-2"><Field label="Base URL" v={f.base_url} onChange={v => set('base_url', v)} ph="https://host.i5.tel" /></div>
        <Field label="API user" v={f.api_user} onChange={v => set('api_user', v)} ph="apiuser" />
        <Field label={isNew ? 'API pass' : 'API pass (blank=keep)'} v={f.api_pass} onChange={v => set('api_pass', v)} ph="••••" type="text" />
      </div>
      <div className="mt-2">
        <Field label="IP validation URL (optional)" v={f.validation_url} onChange={v => set('validation_url', v)} ph="https://host:81/PATH/index.php — blank = http://<host>:81/index.php" />
        <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
          Full URL of the dialer's IP-validation portal. Leave blank for the classic <code>http://&lt;host&gt;:81/index.php</code> form. Set it for dialers with a custom scheme/port/path (e.g. <code>https://host:81/KyZvls/index.php</code>).
        </p>
      </div>
      <div className="flex items-center justify-between mt-2">
        <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--color-text-secondary)' }}>
          <input type="checkbox" checked={f.is_active} onChange={e => set('is_active', e.target.checked)} /> Active
        </label>
        <div className="flex gap-1.5">
          <Button onClick={save} disabled={busy} variant="primary" className="text-xs">{busy ? <Loader2 size={13} className="animate-spin inline" /> : <Save size={13} className="inline mr-1" />}{isNew ? 'Add' : 'Save'}</Button>
          <button onClick={onDelete} className="p-2 rounded-lg hover:bg-error-50"><Trash2 size={14} style={{ color: 'var(--color-error-500)' }} /></button>
        </div>
      </div>
    </div>
  );
};

const Field = ({ label, v, onChange, ph, disabled, type = 'text' }) => (
  <div>
    <label className="block text-[10px] font-bold uppercase tracking-wide mb-0.5" style={{ color: 'var(--color-text-tertiary)' }}>{label}</label>
    <input type={type} value={v} onChange={e => onChange(e.target.value)} placeholder={ph} disabled={disabled} className="input text-sm" />
  </div>
);

// ── IP validation (moved here from Chat Control) ─────────────────────────────
// Submits THIS server's IP to each dialer's IP-validation portal so the dialer
// whitelists the CRM server (required before recording fetch works). Supports
// each box's saved validation_url (any scheme/port/path) plus an ad-hoc URL
// test for a dialer you haven't saved yet.
const IPValidation = () => {
  const [boxes, setBoxes] = useState(null);
  const [val, setVal] = useState(null);
  const [valBusy, setValBusy] = useState('');      // '' | 'all' | box name
  const [diag, setDiag] = useState(null);
  const [diagBusy, setDiagBusy] = useState(false);
  const [adhoc, setAdhoc] = useState({ box: '', validation_url: '', userid: '', password: '' });
  const [adhocBusy, setAdhocBusy] = useState(false);

  useEffect(() => { client.get('vicidial/boxes').then(r => setBoxes(r.data.boxes || [])).catch(() => setBoxes([])); }, []);

  const runValidate = async (boxName) => {
    setValBusy(boxName || 'all'); setVal(null);
    try {
      const r = await client.post('portal/admin/validate-ip', boxName ? { box: boxName } : {});
      setVal(r.data);
      if ((r.data.results || []).some(x => x.api_open)) { toast.success('Server IP validated — dialer reachable'); runDiag(); }
      else toast.message('Submitted to the validation portal — re-test in a moment');
    } catch (e) { setVal({ error: e.response?.data?.error || 'Validation failed' }); }
    finally { setValBusy(''); }
  };

  const runDiag = async () => {
    setDiagBusy(true); setDiag(null);
    try { const r = await client.get('portal/admin/diag'); setDiag(r.data); }
    catch (e) { setDiag({ error: e.response?.data?.error || 'Diagnostic failed' }); }
    finally { setDiagBusy(false); }
  };

  const runAdhoc = async () => {
    if (!adhoc.validation_url.trim() && !adhoc.box) { toast.error('Pick a dialer or enter a validation URL'); return; }
    setAdhocBusy(true); setVal(null);
    try {
      const body = {};
      if (adhoc.box) body.box = adhoc.box;
      if (adhoc.validation_url.trim()) body.validation_url = adhoc.validation_url.trim();
      if (adhoc.userid.trim()) body.userid = adhoc.userid.trim();
      if (adhoc.password) body.password = adhoc.password;
      const r = await client.post('portal/admin/validate-ip', body);
      setVal(r.data);
      if ((r.data.results || []).some(x => x.api_open)) toast.success('Validated — dialer reachable');
      else toast.message('Submitted — re-test in a moment');
    } catch (e) { setVal({ error: e.response?.data?.error || 'Validation failed' }); }
    finally { setAdhocBusy(false); }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        Before the CRM can pull dispositions + recordings, each dialer must whitelist this server's IP. Hit <strong>Validate</strong> to submit this server's IP to a dialer's IP-validation portal, then <strong>Test dialer access</strong> to confirm the API opened. Set a per-dialer <strong>IP validation URL</strong> on the Dialer boxes tab for dialers whose portal isn't the classic <code>http://&lt;host&gt;:81/index.php</code>.
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        <Button onClick={() => runValidate()} disabled={!!valBusy} variant="primary" className="text-sm">
          {valBusy === 'all' ? <Loader2 size={14} className="animate-spin inline mr-1" /> : <ShieldCheck size={14} className="inline mr-1" />} Validate all dialers
        </Button>
        <Button onClick={runDiag} disabled={diagBusy} variant="secondary" className="text-sm">
          {diagBusy ? <Loader2 size={14} className="animate-spin inline mr-1" /> : <Wifi size={14} className="inline mr-1" />} Test dialer access
        </Button>
      </div>

      {/* Per-box validate */}
      {boxes === null ? <div className="flex justify-center py-4"><Loader2 className="animate-spin" /></div> : boxes.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          {boxes.map(b => (
            <div key={b.id} className="flex items-center justify-between gap-2 px-3 py-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <div className="min-w-0">
                <div className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>{b.name} <span className="text-xs font-normal" style={{ color: 'var(--color-text-tertiary)' }}>({b.prefix})</span></div>
                <div className="text-[11px] font-mono truncate" style={{ color: 'var(--color-text-tertiary)' }}>{b.validation_url || `http://${String(b.base_url || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '')}:81/index.php`}</div>
              </div>
              <Button onClick={() => runValidate(b.name)} disabled={!!valBusy} variant="secondary" className="text-xs shrink-0">
                {valBusy === b.name ? <Loader2 size={13} className="animate-spin inline mr-1" /> : <Check size={13} className="inline mr-1" />} Validate
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Ad-hoc test for an unsaved dialer */}
      <div className="rounded-xl p-3 space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>Test a dialer before saving it</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Field label="Validation URL" v={adhoc.validation_url} onChange={v => setAdhoc(p => ({ ...p, validation_url: v }))} ph="https://tmcsolinb.i5.tel:81/KyZvls/index.php" />
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wide mb-0.5" style={{ color: 'var(--color-text-tertiary)' }}>Use saved box creds (optional)</label>
            <select value={adhoc.box} onChange={e => setAdhoc(p => ({ ...p, box: e.target.value }))} className="input text-sm">
              <option value="">— enter creds below —</option>
              {(boxes || []).map(b => <option key={b.id} value={b.name}>{b.name} ({b.prefix})</option>)}
            </select>
          </div>
          <Field label="API user (if not using a box)" v={adhoc.userid} onChange={v => setAdhoc(p => ({ ...p, userid: v }))} ph="apiuser" />
          <Field label="API pass (if not using a box)" v={adhoc.password} onChange={v => setAdhoc(p => ({ ...p, password: v }))} ph="••••" />
        </div>
        <Button onClick={runAdhoc} disabled={adhocBusy} variant="primary" className="text-sm">
          {adhocBusy ? <Loader2 size={14} className="animate-spin inline mr-1" /> : <ShieldCheck size={14} className="inline mr-1" />} Validate this URL
        </Button>
      </div>

      {val && (
        <div className="rounded-xl p-3 text-sm" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          {val.error ? <span style={{ color: 'var(--color-error-600)' }}>{val.error}</span> : (
            <div className="space-y-1">
              <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>Submitted this server's IP to the dialer's validation portal</div>
              {(val.results || []).map(r => (
                <div key={r.box} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: r.api_open ? 'var(--color-success-500)' : r.submitted ? 'var(--color-warning-500)' : 'var(--color-error-500)' }} />
                  <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{r.box}</span>
                  <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    {r.error ? r.error : r.api_open ? 'validated — API reachable ✓' : r.submitted ? 'submitted (re-test in a moment)' : 'could not reach portal'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {diag && (
        <div className="rounded-xl p-3 text-sm" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          {diag.error ? <span style={{ color: 'var(--color-error-600)' }}>{diag.error}</span> : (
            <div className="space-y-1">
              {diag.server_ip && (
                <div className="flex items-center gap-2 mb-2 pb-2 flex-wrap" style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>Whitelist this IP on the dialer:</span>
                  <code className="px-2 py-0.5 rounded font-mono text-sm font-bold" style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-primary-700)' }}>{diag.server_ip}</code>
                  <button onClick={() => { navigator.clipboard?.writeText(diag.server_ip); toast.success('IP copied'); }}
                    className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>Copy</button>
                </div>
              )}
              <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>Dialer reachability from this server</div>
              {(diag.boxes || []).map(b => {
                const ok = b.status === 'reachable';
                return (
                  <div key={b.box} className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: ok ? 'var(--color-success-500)' : 'var(--color-error-500)' }} />
                    <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{b.box}</span>
                    <span style={{ color: ok ? 'var(--color-success-600)' : 'var(--color-error-600)' }}>{b.status}</span>
                    <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{b.ms}ms {b.error || ''}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Prefix registry ──────────────────────────────────────────────────────────
const Prefixes = () => {
  const [rows, setRows] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [form, setForm] = useState({ prefix: '', company_id: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { client.get('vicidial/config').then(r => setRows(r.data.configs || [])).catch(() => {}); }, []);
  useEffect(() => { load(); client.get('companies').then(r => setCompanies(r.data.companies || [])).catch(() => {}); }, [load]);

  const add = async () => {
    if (!form.prefix.trim()) { toast.error('Prefix is required'); return; }
    setBusy(true);
    try { await client.post('vicidial/config', { prefix: form.prefix.trim(), company_id: form.company_id || null }); setForm({ prefix: '', company_id: '' }); load(); toast.success('Prefix added'); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
    finally { setBusy(false); }
  };
  const toggle = async (c) => { try { await client.put(`vicidial/config/${c.id}`, { is_active: !c.is_active }); load(); } catch { toast.error('Failed'); } };
  const del = async (c) => { if (!window.confirm(`Delete prefix "${c.prefix}"?`)) return; try { await client.delete(`vicidial/config/${c.id}`); load(); } catch { toast.error('Failed'); } };

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        A short prefix per fronter dialer makes the correlation code (<code>prefix + lead_id</code>) globally unique, so two companies that transfer the same phone never clash.
      </p>
      <div className="flex items-end gap-2 flex-wrap rounded-2xl p-4" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Prefix</label>
          <input value={form.prefix} onChange={e => setForm(f => ({ ...f, prefix: e.target.value }))} placeholder="A1" className="input" style={{ maxWidth: 120 }} />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Company (fronter)</label>
          <select value={form.company_id} onChange={e => setForm(f => ({ ...f, company_id: e.target.value }))} className="input">
            <option value="">— Unassigned —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <Button variant="primary" onClick={add} disabled={busy} className="flex items-center gap-1.5"><Plus size={15} /> Add</Button>
      </div>

      {rows.length === 0 ? <p className="text-sm py-6 text-center" style={{ color: 'var(--color-text-tertiary)' }}>No prefixes yet.</p> : (
        <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <table className="w-full text-sm">
            <thead><tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
              {['Prefix', 'Company', 'Transfer dispos', 'Active', ''].map(h => <th key={h} className="px-4 py-2.5 text-left text-xs font-bold uppercase" style={{ color: 'var(--color-text-secondary)' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td className="px-4 py-3 font-mono font-bold" style={{ color: 'var(--color-text)' }}>{c.prefix}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--color-text-secondary)' }}>{c.company_name || '—'}</td>
                  <td className="px-4 py-3"><XferDispoCell c={c} onSaved={load} /></td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggle(c)} className="text-xs font-bold px-2 py-1 rounded" style={{ backgroundColor: c.is_active ? 'var(--color-success-100, #d1fae5)' : 'var(--color-bg-secondary)', color: c.is_active ? 'var(--color-success-700, #047857)' : 'var(--color-text-tertiary)' }}>{c.is_active ? 'Active' : 'Off'}</button>
                  </td>
                  <td className="px-4 py-3"><button onClick={() => del(c)} className="p-1.5 rounded-lg hover:bg-error-50"><Trash2 size={15} style={{ color: '#ef4444' }} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// Per-company transfer dispositions → field_map.xfer_dispos. Blank = any dispo
// creates a transfer (the fronter Dispo Call URL fires on every disposition).
const XferDispoCell = ({ c, onSaved }) => {
  const init = Array.isArray(c.field_map?.xfer_dispos) ? c.field_map.xfer_dispos.join(', ') : '';
  const [val, setVal] = useState(init);
  const [busy, setBusy] = useState(false);
  const dirty = val.trim() !== init;
  const save = async () => {
    setBusy(true);
    const list = val.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    try { await client.put(`vicidial/config/${c.id}`, { field_map: { ...(c.field_map || {}), xfer_dispos: list } }); toast.success('Saved'); onSaved(); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); } finally { setBusy(false); }
  };
  return (
    <div className="flex items-center gap-1.5">
      <input value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && dirty) save(); }}
        placeholder="any" title="Comma-separated transfer dispositions (e.g. XFER, XFERA). Only these create a pending transfer. Blank = any disposition does."
        className="input py-1 text-xs" style={{ maxWidth: 160, fontFamily: 'monospace' }} />
      <button onClick={save} disabled={!dirty || busy} className="text-[11px] font-bold px-2 py-1 rounded inline-flex items-center gap-1 text-white disabled:opacity-40" style={{ background: 'var(--gradient-sidebar)' }}>
        {busy ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
      </button>
    </div>
  );
};

// ── Agent mapping ────────────────────────────────────────────────────────────
// Name → order-independent token key, so "M. Abu Zar" (CRM) matches "M Abu Zar"
// (dialer) regardless of punctuation/word order.
const nameKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).sort().join(' ');
const PREFIX_TINT = { WTI: '#2563eb', TMC: '#d97706', ETC: '#7c3aed', OAT: '#0891b2' };
const idTint = (id) => { const m = String(id).match(/^([A-Za-z]+)/); return (m && PREFIX_TINT[m[1].toUpperCase()]) || '#64748b'; };
const IdChip = ({ id, onRemove }) => {
  const c = idTint(id);
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full font-mono" style={{ background: `${c}1f`, color: c, border: `1px solid ${c}55` }}>
      {id}{onRemove && <button onClick={onRemove} title="Remove this id" className="opacity-60 hover:opacity-100 font-sans">×</button>}
    </span>
  );
};

const AgentRow = ({ a, roster, onSaved }) => {
  const [ids, setIds] = useState(a.agent_ids || []);
  const [txt, setTxt] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setIds(a.agent_ids || []); }, [a.agent_ids]);

  const commit = async (next) => {
    setBusy(true);
    try { await client.post('vicidial/agents', { user_id: a.user_id, agent_id: next.join(',') }); setIds(next); toast.success('Saved'); onSaved?.(); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); setIds(a.agent_ids || []); }
    finally { setBusy(false); }
  };
  const addId = (raw) => { const u = String(raw || '').trim().toUpperCase(); if (!u || ids.includes(u)) return; commit([...ids, u]); };
  const removeId = (id) => commit(ids.filter(x => x !== id));

  // dialer logins whose name matches this user and aren't mapped yet
  const key = nameKey(a.name);
  const suggestions = (roster || []).filter(r => nameKey(r.full_name) === key && !ids.includes(r.login) && !r.mapped_to);

  return (
    <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
      <td className="px-4 py-2.5 align-top">
        <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{a.name}</p>
        <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{[a.role, a.company].filter(Boolean).join(' · ') || '—'}</p>
      </td>
      <td className="px-4 py-2.5 align-top">
        <div className="flex flex-wrap items-center gap-1.5">
          {ids.length ? ids.map(id => <IdChip key={id} id={id} onRemove={() => removeId(id)} />) : <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>—</span>}
          {busy && <Loader2 size={13} className="animate-spin" style={{ color: 'var(--color-text-tertiary)' }} />}
        </div>
      </td>
      <td className="px-4 py-2.5 align-top">
        <div className="flex flex-wrap items-center gap-1.5">
          {suggestions.map(s => (
            <button key={s.box_id + s.login} onClick={() => addId(s.login)} disabled={busy}
              title={`${s.full_name} · ${s.prefix} box · ${s.group || '—'} · ${s.calls} calls`}
              className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full font-mono"
              style={{ color: idTint(s.login), border: `1px dashed ${idTint(s.login)}88`, background: 'transparent' }}>
              + {s.login}
            </button>
          ))}
          <input value={txt} onChange={e => setTxt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { addId(txt); setTxt(''); } }}
            placeholder="add id…" className="input py-1 text-xs" style={{ maxWidth: 120, fontFamily: 'monospace' }} />
        </div>
      </td>
    </tr>
  );
};

const Agents = () => {
  const [q, setQ] = useState('');
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [boxes, setBoxes] = useState([]);
  const [box, setBox] = useState('');
  const [days, setDays] = useState(14);
  const [roster, setRoster] = useState([]);
  const [rosterLoading, setRosterLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await client.get('vicidial/agents', { params: { q: q || undefined } }); setAgents(r.data.agents || []); }
    catch { /* ignore */ } finally { setLoading(false); }
  }, [q]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { client.get('vicidial/boxes').then(r => setBoxes(r.data.boxes || r.data || [])).catch(() => {}); }, []);

  const loadRoster = async () => {
    setRosterLoading(true);
    try {
      const r = await client.get('vicidial/agents/roster', { params: { box: box || undefined, days } });
      setRoster(r.data.roster || []);
      if (r.data.boxes?.length) setBoxes(bs => bs.length ? bs : r.data.boxes);
      toast.success(`Loaded ${r.data.roster?.length || 0} dialer agents — name-matched suggestions now show below`);
    } catch (e) { toast.error(e.response?.data?.error || 'Could not load the dialer roster'); }
    finally { setRosterLoading(false); }
  };

  const suggestedCount = roster.length ? agents.reduce((n, a) => {
    const key = nameKey(a.name);
    return n + (roster.some(r => nameKey(r.full_name) === key && !(a.agent_ids || []).includes(r.login) && !r.mapped_to) ? 1 : 0);
  }, 0) : 0;

  return (
    <div className="space-y-3">
      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        Map each VICIdial agent id (the dialer's <code>user</code>) to a CRM user. A person who works <b>more than one box</b> — or who kept an <b>old login and got a new one</b> (e.g. a <code>TMC…</code> id plus a new <code>WTI…</code> id) — should have <b>all of them</b> mapped so every recording resolves. Load the dialer roster to get <b>one-click, name-matched suggestions</b>.
      </p>

      {/* dialer-roster loader */}
      <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
        <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>Dialer roster</span>
        <select value={box} onChange={e => setBox(e.target.value)} className="input py-1.5 text-sm" style={{ maxWidth: 180 }}>
          <option value="">All boxes</option>
          {boxes.map(b => <option key={b.id} value={b.id}>{b.name || b.id}{b.prefix ? ` (${b.prefix})` : ''}</option>)}
        </select>
        <label className="text-xs inline-flex items-center gap-1" style={{ color: 'var(--color-text-secondary)' }}>last
          <input type="number" min={1} max={60} value={days} onChange={e => setDays(Math.max(1, Math.min(60, +e.target.value || 14)))} className="input py-1 text-sm text-center" style={{ width: 56 }} /> days</label>
        <button onClick={loadRoster} disabled={rosterLoading} className="text-xs font-bold px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 text-white disabled:opacity-50" style={{ background: 'var(--gradient-sidebar)' }}>
          {rosterLoading ? <Loader2 size={13} className="animate-spin" /> : <Users size={13} />} Load dialer roster
        </button>
        {roster.length > 0 && <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{roster.length} dialer agents · <b style={{ color: 'var(--color-warning-700, #b45309)' }}>{suggestedCount}</b> user{suggestedCount === 1 ? '' : 's'} with a suggestion</span>}
      </div>

      <div className="relative max-w-md">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search people or agent id…" className="input" style={{ paddingLeft: 34 }} />
      </div>
      {loading ? <div className="flex justify-center py-8"><Loader2 className="animate-spin" /></div> : agents.length === 0 ? <p className="text-sm py-6 text-center" style={{ color: 'var(--color-text-tertiary)' }}>No users.</p> : (
        <div className="rounded-2xl overflow-x-auto" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <table className="w-full text-sm">
            <thead><tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
              {['User', 'Mapped agent ids', 'Add / suggested from dialer'].map(h => <th key={h} className="px-4 py-2.5 text-left text-xs font-bold uppercase whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>{h}</th>)}
            </tr></thead>
            <tbody>{agents.map(a => <AgentRow key={a.user_id} a={a} roster={roster} onSaved={load} />)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ── Disposition map (raw dialer code → CRM disposition) ──────────────────────
const DispoMap = () => {
  const [companies, setCompanies] = useState([]);
  const [companyId, setCompanyId] = useState('');
  const [rows, setRows] = useState([]);
  const [dispositions, setDispositions] = useState([]);
  const [newCode, setNewCode] = useState('');
  const [newDisp, setNewDisp] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { client.get('companies').then(r => setCompanies(r.data.companies || [])).catch(() => {}); }, []);
  const load = useCallback(() => {
    if (!companyId) { setRows([]); setDispositions([]); return; }
    client.get('vicidial/dispo-map', { params: { company_id: companyId } }).then(r => setRows(r.data.map || [])).catch(() => {});
    client.get('vicidial/dispositions', { params: { company_id: companyId } }).then(r => setDispositions(r.data.dispositions || [])).catch(() => {});
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  const setMap = async (row, name) => { try { await client.put(`vicidial/dispo-map/${row.id}`, { disposition_name: name || null }); load(); } catch { toast.error('Failed'); } };
  const del = async (row) => { if (!window.confirm(`Delete mapping for "${row.vici_code}"?`)) return; try { await client.delete(`vicidial/dispo-map/${row.id}`); load(); } catch { toast.error('Failed'); } };
  const add = async () => {
    if (!companyId || !newCode.trim()) { toast.error('Scope + code required'); return; }
    setBusy(true);
    try { await client.post('vicidial/dispo-map', { company_id: companyId, vici_code: newCode.trim(), disposition_name: newDisp || null }); setNewCode(''); setNewDisp(''); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); } finally { setBusy(false); }
  };

  // A code with a Global row (company_id null + named) resolves for EVERY company
  // via fallback — so a company's own blank row for that code isn't really
  // unmapped. Only flag codes that have neither a company name nor a global one.
  const globalByCode = {};
  rows.forEach(r => { if (!r.company_id && r.disposition_name) globalByCode[r.vici_code] = r.disposition_name; });
  const isCovered = (r) => !!r.disposition_name || !!globalByCode[r.vici_code];
  const unmapped = rows.filter(r => !isCovered(r)).length;

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        Map each raw VICIdial closer code (NI, CB, SALE…) to a CRM disposition. Pick <strong>🌐 Global</strong> to map a code once for <strong>every</strong> company (recommended — dialer codes are the same everywhere); a company-specific row overrides the global. Unmapped codes are auto-recorded (with a hit count) for you to resolve — nothing is lost.
      </p>
      <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="input" style={{ maxWidth: 320 }}>
        <option value="">Select scope…</option>
        <option value="__global__">🌐 Global (all companies)</option>
        {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>

      {companyId && (
        <>
          {dispositions.length === 0 && <Alert type="warning" message="This company has no configured dispositions yet — add them under Dispositions/Form config first, then map here." />}
          {unmapped > 0
            ? <p className="text-xs font-bold flex items-center gap-1.5" style={{ color: 'var(--color-warning-700, #b45309)' }}><AlertTriangle size={13} /> {unmapped} code(s) with no mapping (and no Global fallback) — resolve below.</p>
            : companyId !== '__global__' && <p className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--color-success-700, #047857)' }}><Check size={13} /> Every code the dialer sent is covered (here or by 🌐 Global). Nothing to do.</p>}

          {/* Add row */}
          <div className="flex items-end gap-2 flex-wrap rounded-xl p-3" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div><label className="block text-[11px] font-bold uppercase mb-1" style={{ color: 'var(--color-text-secondary)' }}>Dialer code</label>
              <input value={newCode} onChange={e => setNewCode(e.target.value.toUpperCase())} placeholder="NI" className="input" style={{ maxWidth: 130, fontFamily: 'monospace' }} /></div>
            <div className="flex-1 min-w-[180px]"><label className="block text-[11px] font-bold uppercase mb-1" style={{ color: 'var(--color-text-secondary)' }}>CRM disposition</label>
              <select value={newDisp} onChange={e => setNewDisp(e.target.value)} className="input">
                <option value="">— leave unmapped —</option>
                {dispositions.map(d => <option key={d} value={d}>{d}</option>)}
              </select></div>
            <Button variant="primary" onClick={add} disabled={busy} className="flex items-center gap-1.5"><Plus size={15} /> Add</Button>
          </div>

          {rows.length === 0 ? <p className="text-sm py-6 text-center" style={{ color: 'var(--color-text-tertiary)' }}>No codes yet.</p> : (
            <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <table className="w-full text-sm">
                <thead><tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                  {['Dialer code', 'CRM disposition', 'Hits', ''].map(h => <th key={h} className="px-4 py-2.5 text-left text-xs font-bold uppercase" style={{ color: 'var(--color-text-secondary)' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {rows.map(r => {
                    const coveredByGlobal = !r.disposition_name && !!globalByCode[r.vici_code] && !!r.company_id;
                    const trulyUnmapped = !r.disposition_name && !coveredByGlobal;
                    return (
                    <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: trulyUnmapped ? 'var(--color-warning-50, #fffbeb)' : undefined }}>
                      <td className="px-4 py-2.5 font-mono font-bold" style={{ color: 'var(--color-text)' }}>
                        {r.vici_code}
                        {!r.company_id && <span className="ml-2 text-[9px] font-sans font-bold px-1.5 py-0.5 rounded-full align-middle" style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>🌐 global</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <select value={r.disposition_name || ''} onChange={e => setMap(r, e.target.value)} className="input py-1.5 text-sm">
                          <option value="">{coveredByGlobal ? `— using 🌐 Global: ${globalByCode[r.vici_code]} —` : '— unmapped —'}</option>
                          {dispositions.map(d => <option key={d} value={d}>{d}</option>)}
                          {r.disposition_name && !dispositions.includes(r.disposition_name) && <option value={r.disposition_name}>{r.disposition_name}</option>}
                        </select>
                        {coveredByGlobal && <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>Resolves via 🌐 Global — only set here to override for this company.</p>}
                      </td>
                      <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{r.hits}</td>
                      <td className="px-4 py-2.5"><button onClick={() => del(r)} className="p-1.5 rounded-lg hover:bg-error-50"><Trash2 size={15} style={{ color: '#ef4444' }} /></button></td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
};

// ── Setup URLs help ──────────────────────────────────────────────────────────
const Setup = () => {
  const base = window.location.origin.replace(/\/$/, '');
  const block = (s) => <pre className="text-[11px] whitespace-pre-wrap rounded-lg p-3 overflow-x-auto" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>{s}</pre>;
  const Card = ({ title, children }) => (
    <div className="rounded-xl p-4 space-y-2" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <p className="font-bold" style={{ color: 'var(--color-text)' }}>{title}</p>
      {children}
    </div>
  );
  return (
    <div className="space-y-5 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
      <p>Set <code>VICIDIAL_INGEST_TOKEN</code> in the backend env, then use <code>?key=THAT_TOKEN</code> in every URL below.</p>

      {/* Golden rules */}
      <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-primary-50, #eef2ff)', border: '1px solid var(--color-primary-200, #c7d2fe)' }}>
        <p className="font-bold mb-2" style={{ color: 'var(--color-primary-700, #4338ca)' }}>Read this first — the 3 rules that make it work</p>
        <ul className="list-disc pl-5 space-y-1 text-xs">
          <li><strong>Map agents FIRST</strong> (Agent mapping tab). A pending transfer is created only for a mapped <em>fronter</em> agent; a disposition is attributed only for a mapped <em>closer</em> agent. Unmapped agent → it's lost.</li>
          <li><strong>Fronter URL → the fronter CAMPAIGN's Dispo Call URL.</strong> It fires on the transfer disposition (set <strong>Transfer dispos = XFER</strong> on the Prefix tab so only real transfers create a pending).</li>
          <li><strong>Closer URL → the closer IN-GROUP's Dispo Call URL — NOT the campaign.</strong> Inbound/transferred calls fire the <em>in-group</em>, not the campaign. Put it on <em>every</em> in-group a closer answers transfers in (e.g. SIP_INB, ETCdialer, TransferGroup).</li>
        </ul>
      </div>

      {/* Scenario A */}
      <Card title="Scenario A · SAME VICIdial box (fronter + closer share one dialer)">
        <p className="text-xs">The transfer keeps the same <code>lead_id</code> + customer phone, so it matches by <strong>phone</strong>. No webform, no prefix needed.</p>
        <p className="text-xs font-semibold mt-1" style={{ color: 'var(--color-text)' }}>① Fronter outbound campaign → Dispo Call URL:</p>
        {block(`${base}/api/vicidial/fronter-xfer?key=YOUR_TOKEN&code=--A--lead_id--B--&phone=--A--phone_number--B--&agent=--A--user--B--&dispo=--A--dispo--B--`)}
        <p className="text-xs font-semibold mt-1" style={{ color: 'var(--color-text)' }}>② Closer in-group → Dispo Call URL (the one closer URL, see below).</p>
      </Card>

      {/* Scenario B */}
      <Card title="Scenario B · DIFFERENT VICIdial box (fronter pushes to the closer box)">
        <p className="text-xs">The closer box makes its own <code>lead_id</code>, so the fronter's id must ride across in <code>vendor_lead_code</code>. Matches by <strong>vendor_lead_code</strong> (<code>{'{PREFIX}'}</code> + lead id) — exact.</p>
        <p className="text-xs font-semibold mt-1" style={{ color: 'var(--color-text)' }}>① Fronter <strong>webform (add_lead)</strong>, pushing the lead to the closer box — append:</p>
        {block('&vendor_lead_code={PREFIX}--A--lead_id--B--')}
        <p className="text-xs font-semibold mt-1" style={{ color: 'var(--color-text)' }}>② Fronter outbound campaign → Dispo Call URL (same prefix):</p>
        {block(`${base}/api/vicidial/fronter-xfer?key=YOUR_TOKEN&code={PREFIX}--A--lead_id--B--&phone=--A--phone_number--B--&agent=--A--user--B--&dispo=--A--dispo--B--`)}
        <p className="text-xs font-semibold mt-1" style={{ color: 'var(--color-text)' }}>③ Closer in-group → Dispo Call URL (the one closer URL, see below).</p>
        <p className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>Register <code>{'{PREFIX}'}</code> (e.g. ETC) on the Prefix tab for that fronter. The webform and the fronter URL must use the <strong>identical</strong> prefix.</p>
      </Card>

      {/* Closer URL */}
      <Card title="The Closer Dispo Call URL — one URL, every in-group, both scenarios">
        <p className="text-xs">Put this on each closer <strong>in-group</strong>'s Dispo Call URL. It sends <code>vendor_lead_code</code> (matches Scenario B) and <code>lead_id</code> + <code>phone</code> (match Scenario A) — the CRM uses whichever hits.</p>
        {block(`${base}/api/vicidial/closer-dispo?key=YOUR_TOKEN&code=--A--vendor_lead_code--B--&alt_code=--A--lead_id--B--&phone=--A--phone_number--B--&dispo=--A--dispo--B--&talk_time=--A--talk_time--B--&agent=--A--user--B--`)}
      </Card>

      {/* Matching */}
      <Card title="How a disposition finds its lead (and why it never mixes up closers)">
        <ol className="list-decimal pl-5 space-y-1 text-xs">
          <li><strong>vendor_lead_code</strong> — exact, the lead's own id (Scenario B).</li>
          <li><strong>phone</strong> — the customer's own number (Scenario A).</li>
          <li><strong>No match → queued</strong> for that closer to attach to the right lead by hand (their "pending dispositions"). It <strong>never guesses</strong> a lead from "whatever came in last", so one closer's disposition can never land on another's.</li>
        </ol>
      </Card>

      {/* Troubleshooting */}
      <Card title="Troubleshooting">
        <ul className="list-disc pl-5 space-y-1 text-xs">
          <li><code>{'{ok:false, "agent not mapped"}'}</code> → map that dialer agent (Agent mapping).</li>
          <li><strong>Pending transfer never appears</strong> → the <em>fronter</em> agent isn't mapped, or the fronter-xfer URL isn't on the fronter <em>campaign</em>, or Transfer dispos doesn't include the dispo the fronter used.</li>
          <li><strong>Closer dispo doesn't attach</strong> → the closer URL is on the <em>campaign</em>, not the <em>in-group</em> — move it. Or <code>vendor_lead_code</code>/<code>phone</code> isn't being sent.</li>
          <li><strong>Dispo shows the raw code</strong> (e.g. <code>SALE</code>) → name it in the Disposition map (use 🌐 Global to cover every company at once).</li>
          <li><strong>Disposition tagged to the wrong company</strong> → the agent is mapped to the wrong company; fix it in Agent mapping.</li>
        </ul>
      </Card>
    </div>
  );
};

// ── Backfill dispositions for OLD coded transfers ────────────────────────────
const Backfill = () => {
  const [running, setRunning] = useState(false);
  const [found, setFound] = useState(0);
  const [processed, setProcessed] = useState(0);
  const [remaining, setRemaining] = useState(null);
  const [done, setDone] = useState(false);
  const [impBusy, setImpBusy] = useState(false);
  const [impRes, setImpRes] = useState(null);
  const [batches, setBatches] = useState([]);
  const [undoing, setUndoing] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const [boxPrefix, setBoxPrefix] = useState('WTI');
  const [dateFmt, setDateFmt] = useState('AUTO');

  const loadBatches = useCallback(async () => {
    try { const r = await client.get('vicidial/backfill/batches'); setBatches(r.data.batches || []); } catch { /* ignore */ }
  }, []);
  useEffect(() => { loadBatches(); }, [loadBatches]);

  const undoBatch = async (id) => {
    if (!window.confirm('Undo this import? It restores every disposition this batch filled (leaving any that changed since).')) return;
    setUndoing(id);
    try {
      const r = await client.post(`vicidial/backfill/batches/${id}/undo`);
      toast.success(`Undone — ${r.data.undone} reverted${r.data.skipped ? `, ${r.data.skipped} left (changed since)` : ''}`);
      await loadBatches();
    } catch (e) { toast.error(e.response?.data?.error || 'Undo failed'); }
    finally { setUndoing(null); }
  };

  // Parse a vicidial_list "Download leads" CSV → group leads by phone → map each
  // transfer to its nearest-in-time lead (lead_id + status) on the backend.
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImpBusy(true); setImpRes(null);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (!lines.length) throw new Error('Empty file');
      const delim = lines[0].includes('\t') ? '\t' : lines[0].includes('|') ? '|' : ',';
      // Quote-aware split — a quoted field may contain the delimiter (VICIdial
      // address/comment columns) and "" is an escaped quote.
      const split = (line) => {
        const out = []; let cur = '', inQ = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (inQ) {
            if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
            else cur += ch;
          } else if (ch === '"') { inQ = true; }
          else if (ch === delim) { out.push(cur); cur = ''; }
          else cur += ch;
        }
        out.push(cur);
        return out.map(s => s.trim());
      };
      const header = split(lines[0]).map(h => h.toLowerCase());
      const find = (...names) => { for (const n of names) { const i = header.indexOf(n); if (i >= 0) return i; } return -1; };
      const iPhone = find('phone_number', 'phone');
      const iStatus = find('status');
      const iLead = find('lead_id', 'leadid');
      // Match any date/time-ish column, incl. combined headers like
      // "last_local_call_time/entry_date".
      const iDate = header.findIndex(h => /call_time|entry_date|modify_date|call_date|last_local|date/.test(h));
      if (iPhone < 0 || iStatus < 0 || iLead < 0) throw new Error('CSV needs phone_number, status, and lead_id columns (VICIdial "Download leads" with a header row)');

      // ── date parsing ── ISO is unambiguous; slash dates need a day/month order.
      const rawRows = lines.slice(1).map(split).filter(c => c[iPhone] && c[iStatus] && c[iLead]);
      const detectFmt = () => {
        if (iDate < 0) return 'NONE';
        let iso = 0, slash = 0, dmy = 0, mdy = 0;
        for (const c of rawRows) {
          const t = (c[iDate] || '').trim();
          if (/^\d{4}-\d{1,2}-\d{1,2}/.test(t)) iso++;
          else { const m = t.match(/^(\d{1,2})\/(\d{1,2})\/\d{2,4}/); if (m) { slash++; if (+m[1] > 12) dmy++; else if (+m[2] > 12) mdy++; } }
        }
        if (iso >= slash) return 'ISO';
        if (dmy && !mdy) return 'DMY';
        if (mdy && !dmy) return 'MDY';
        return 'DMY';  // ambiguous slash (e.g. 01/05) → default day-first; user can override
      };
      const usedFmt = dateFmt === 'AUTO' ? detectFmt() : dateFmt;
      const toIso = (s) => {
        if (!s || iDate < 0 || usedFmt === 'NONE') return '';
        s = s.trim();
        let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
        if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0))).toISOString();
        m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2}))?/);
        if (m) {
          let p1 = +m[1], p2 = +m[2], y = +m[3]; if (y < 100) y += 2000;
          const day = usedFmt === 'MDY' ? p2 : p1, mon = usedFmt === 'MDY' ? p1 : p2;
          if (mon < 1 || mon > 12 || day < 1 || day > 31) return '';
          return new Date(Date.UTC(y, mon - 1, day, +(m[4] || 0), +(m[5] || 0))).toISOString();
        }
        return '';
      };

      const norm = (p) => String(p || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
      const map = new Map();  // normalized phone → [{ status, lead_id, date }]
      for (const c of rawRows) {
        const ph = norm(c[iPhone]);
        if (!ph) continue;
        if (!map.has(ph)) map.set(ph, []);
        map.get(ph).push({ status: c[iStatus], lead_id: c[iLead], date: toIso(c[iDate]) });
      }
      const groups = [...map.entries()].map(([phone, leads]) => ({ phone, leads }));
      if (!groups.length) throw new Error('No usable rows found under the header (need phone_number + status + lead_id)');
      const batchId = (window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}-4000-8000-000000000000`.padEnd(36, '0').slice(0, 36));
      let received = 0, matched = 0, applied = 0, skipped = 0, noMatch = 0;
      // Backend bulk-processes a whole chunk, so send large batches of phones to
      // cut round-trips (each request is fast — batched reads + one bulk write).
      const CHUNK = 1500;
      for (let i = 0; i < groups.length; i += CHUNK) {
        const r = await client.post('vicidial/backfill/from-list', { batch_id: batchId, source: file.name, box_prefix: boxPrefix, groups: groups.slice(i, i + CHUNK) });
        received += r.data.received; matched += r.data.matched; applied += r.data.applied; skipped += r.data.skipped_status; noMatch += r.data.no_match;
        setImpRes({ total: groups.length, processed: Math.min(i + CHUNK, groups.length), received, matched, applied, skipped, noMatch });
      }
      const fmtLabel = usedFmt === 'NONE' ? 'no date column (order-based)' : usedFmt === 'ISO' ? 'ISO dates' : usedFmt === 'DMY' ? 'DD/MM/YYYY dates' : 'MM/DD/YYYY dates';
      toast.success(`Mapped ${applied} to ${boxPrefix} lead ids · ${fmtLabel}`);
      await loadBatches();
    } catch (err) {
      toast.error(err.response?.data?.error || err.message || 'Import failed');
    } finally { setImpBusy(false); e.target.value = ''; }
  };

  const run = async () => {
    setRunning(true); setDone(false); setFound(0); setProcessed(0);
    let before = null, tFound = 0, tProc = 0;
    try {
      for (;;) {
        const r = await client.post('vicidial/backfill/coded', { batch: 25, before });
        tFound += r.data.found; tProc += r.data.processed;
        setFound(tFound); setProcessed(tProc); setRemaining(r.data.remaining);
        before = r.data.cursor;
        if (r.data.done) break;
      }
      setDone(true);
      toast.success(`Backfill complete — recovered ${tFound} disposition${tFound === 1 ? '' : 's'}`);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Backfill failed');
    } finally { setRunning(false); }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <Alert variant="info">
        <p className="font-semibold mb-1">Two ways to recover dispositions.</p>
        <p className="text-sm">
          <b>Coded transfers</b> (carry <code>WTI/ETC/TMC…</code>): read straight from the dialer by lead id — use the
          button below. <b>Code-less transfers</b> (no lead id, phone call-log archives daily): the API can't reach them,
          but the closer/transfer list still holds them — export that list and use the CSV import below. Going forward
          the fronter-xfer URLs make every new transfer coded, so this gap stops growing.
        </p>
      </Alert>

      <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>Recover dispositions from the dialer</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
              Reads each coded transfer's lead status (throttled — gentle on the dialer). Safe to re-run.
            </p>
          </div>
          <Button onClick={run} disabled={running}>
            {running ? <Loader2 size={15} className="animate-spin" /> : <DownloadCloud size={15} />}
            {running ? 'Running…' : 'Start backfill'}
          </Button>
        </div>

        {(running || done) && (
          <div className="mt-4 pt-4 text-sm" style={{ borderTop: '1px solid var(--color-border)' }}>
            <div className="flex gap-6 flex-wrap" style={{ color: 'var(--color-text-secondary)' }}>
              <span>Scanned: <b style={{ color: 'var(--color-text)' }}>{processed}</b></span>
              <span>Recovered: <b style={{ color: 'var(--color-success-600, #059669)' }}>{found}</b></span>
              {remaining != null && <span>Coded still missing: <b style={{ color: 'var(--color-text)' }}>{remaining}</b></span>}
            </div>
            {done && <p className="mt-2 flex items-center gap-1.5" style={{ color: 'var(--color-success-600, #059669)' }}><Check size={15} /> Done — {found} recovered. The rest had no readable status (purged / no-connect).</p>}
          </div>
        )}
      </div>

      {/* Code-LESS recovery via a vicidial_list export (the 46k) */}
      <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>Map code-less transfers to dialer lead ids</p>
          <button onClick={() => setShowHelp(v => !v)} className="text-xs font-semibold inline-flex items-center gap-1" style={{ color: 'var(--color-primary-600)' }}>
            <Info size={13} /> {showHelp ? 'Hide' : 'How to get & prepare the file'}
          </button>
        </div>
        <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
          Export the <b>closer list</b> the closers work in (one source for all fronters), then upload it. Each transfer is
          matched to its <b>nearest-in-time</b> lead by phone, then stamped with that <code>lead_id</code> (becomes coded →
          Fetch Dispo works on it forever) plus its <code>status</code>. Only fills transfers with no code yet. Undoable below.
        </p>

        {showHelp && (
          <div className="mt-3 rounded-xl p-4 text-xs leading-relaxed" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
            <p className="font-bold mb-1.5" style={{ color: 'var(--color-text)' }}>Where to get the file</p>
            <ol className="list-decimal ml-4 space-y-1">
              <li>On the dialer the <b>closers</b> run on (Wavetech): <b>Admin → Lists</b>.</li>
              <li>Open <b>every list in the <code>transfer</code> campaign</b> — the active one is <b>List 101010</b>, plus any older/rotated closer lists (to cover the full 1.5 years).</li>
              <li>Click <b>Download leads</b> → <b>CSV</b>, <b>include the header row</b>. One file per list.</li>
              <li>Pick the matching <b>box</b> below before uploading each file.</li>
            </ol>
            <p className="font-bold mt-3 mb-1.5" style={{ color: 'var(--color-text)' }}>Required columns (by header name)</p>
            <ul className="list-disc ml-4 space-y-1">
              <li><code>phone_number</code> — customer number (10-digit; +1 / dashes fine, it's normalized).</li>
              <li><code>status</code> — the closer's disposition code (<code>SALE</code>, <code>NI</code>, <code>CALLBK</code>…).</li>
              <li><code>lead_id</code> — the dialer lead id (this is what gets stamped — <b>required</b>).</li>
              <li><i>a date column</i> — <code>last_local_call_time</code> / <code>entry_date</code> (optional but recommended; it's how a repeat number's transfers align to the right lead).</li>
            </ul>
            <p className="mt-2">Extra columns ignored. Comma / tab / pipe auto-detected. Column order doesn't matter.</p>
            <p className="font-bold mt-3 mb-1.5" style={{ color: 'var(--color-text)' }}>How matching works</p>
            <p>Leads are grouped by phone. For each CRM transfer on that phone with no code yet, the <b>nearest-dated</b> unused lead (within ±21 days) is chosen — so a number with several transfers maps each to its own call, not all to one. The lead id is stamped as <code>{boxPrefix}&lt;lead_id&gt;</code>; the status fills the dispo. <b>Every real status maps</b> (incl. no-answer / answering-machine / dead-air); only <i>non-dispositions</i> — a lead still routing or never worked (<code>NEW</code>, <code>XFER</code>, <code>QUEUE</code>, blank) — map the id but set no dispo. A transfer that already has a disposition (column or actions log) is never overwritten.</p>
          </div>
        )}

        <div className="flex items-center gap-4 mt-3 flex-wrap">
          <label className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
            This export is from:
            <select value={boxPrefix} onChange={e => setBoxPrefix(e.target.value)} disabled={impBusy}
              className="input ml-2 py-1.5 text-sm" style={{ width: 'auto', display: 'inline-block' }}>
              <option value="WTI">Wavetech (WTI)</option>
              <option value="ETC">EasyTech (ETC)</option>
              <option value="TMC">Mejor / TMC (TMC)</option>
            </select>
          </label>
          <label className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
            Date format:
            <select value={dateFmt} onChange={e => setDateFmt(e.target.value)} disabled={impBusy}
              className="input ml-2 py-1.5 text-sm" style={{ width: 'auto', display: 'inline-block' }}>
              <option value="AUTO">Auto-detect</option>
              <option value="ISO">ISO (YYYY-MM-DD)</option>
              <option value="DMY">DD/MM/YYYY</option>
              <option value="MDY">MM/DD/YYYY</option>
            </select>
          </label>
        </div>

        <label className="inline-flex items-center gap-2 mt-3 px-3 py-2 rounded-lg text-sm font-semibold cursor-pointer text-white disabled:opacity-40"
          style={{ background: 'var(--gradient-sidebar)', opacity: impBusy ? 0.5 : 1, pointerEvents: impBusy ? 'none' : 'auto' }}>
          {impBusy ? <Loader2 size={15} className="animate-spin" /> : <DownloadCloud size={15} />}
          {impBusy ? 'Matching…' : 'Upload list CSV'}
          <input type="file" accept=".csv,.txt,.tsv" className="hidden" onChange={onFile} disabled={impBusy} />
        </label>

        {impRes && (
          <div className="mt-4 pt-4 text-sm" style={{ borderTop: '1px solid var(--color-border)' }}>
            <div className="flex gap-5 flex-wrap" style={{ color: 'var(--color-text-secondary)' }}>
              <span>Phones: <b style={{ color: 'var(--color-text)' }}>{impRes.processed}/{impRes.total}</b></span>
              <span>Mapped: <b style={{ color: 'var(--color-success-600, #059669)' }}>{impRes.applied}</b></span>
              <span>No CRM match: <b style={{ color: 'var(--color-text)' }}>{impRes.noMatch}</b></span>
              <span>Lead-id only (no dispo): <b style={{ color: 'var(--color-text)' }}>{impRes.skipped}</b></span>
            </div>
          </div>
        )}
      </div>

      {/* Recent imports — review + undo */}
      {batches.length > 0 && (
        <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <p className="font-bold text-sm mb-3" style={{ color: 'var(--color-text)' }}>Recent imports</p>
          <div className="space-y-2">
            {batches.map(b => (
              <div key={b.id} className="flex items-center justify-between gap-3 flex-wrap rounded-lg px-3 py-2" style={{ border: '1px solid var(--color-border)' }}>
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{b.source || 'list export'}</p>
                  <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                    {new Date(b.created_at).toLocaleString()} · filled <b>{b.applied_count}</b> of {b.total_rows} rows
                    {b.undone_at && <span style={{ color: 'var(--color-error-600, #dc2626)' }}> · undone ({b.undone_count} reverted)</span>}
                  </p>
                </div>
                {b.undone_at ? (
                  <span className="text-xs font-semibold px-2 py-1 rounded" style={{ color: 'var(--color-text-tertiary)' }}>Undone</span>
                ) : (
                  <button onClick={() => undoBatch(b.id)} disabled={undoing === b.id || b.applied_count === 0}
                    className="text-xs font-bold px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1 disabled:opacity-40"
                    style={{ border: '1px solid var(--color-error-300, #fca5a5)', color: 'var(--color-error-600, #dc2626)' }}>
                    {undoing === b.id ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} Undo
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const VicidialAdmin = () => {
  const [tab, setTab] = useState('boxes');
  return (
    <div className="space-y-5 max-w-4xl">
      <div className="rounded-2xl p-6 relative overflow-hidden" style={{ background: 'var(--gradient-sidebar)' }}>
        <div className="relative z-10 flex items-center gap-2.5">
          <PhoneCall size={22} className="text-white" />
          <div>
            <h2 className="text-2xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>VICIdial Integration</h2>
            <p className="text-sm text-white/80">Prefix registry, agent mapping, and the dialer URLs that feed pending transfers + dispositions into the CRM.</p>
          </div>
        </div>
      </div>

      <Alert type="info" message="Pending transfers only appear for an agent that's mapped below. Map agents first, then wire the VICIdial URLs (Setup tab)." />

      <div className="flex gap-1 p-1 rounded-xl w-fit" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
        {TABS.map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
            style={{ background: tab === t.k ? 'var(--gradient-sidebar)' : 'transparent', color: tab === t.k ? 'white' : 'var(--color-text-secondary)' }}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'boxes'    && <Boxes />}
      {tab === 'validate' && <IPValidation />}
      {tab === 'prefixes' && <Prefixes />}
      {tab === 'agents'   && <Agents />}
      {tab === 'dispo'    && <DispoMap />}
      {tab === 'backfill' && <Backfill />}
      {tab === 'setup'    && <Setup />}
    </div>
  );
};

export default VicidialAdmin;
