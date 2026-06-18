import { useState, useEffect, useCallback } from 'react';
import { PhoneCall, Plus, Trash2, Save, Search, Hash, Users, ChevronDown, Loader2, Check, ListChecks, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Alert } from '../../UI';
import client from '../../../api/client';

// Superadmin config for the VICIdial integration: the per-company prefix
// registry (makes the correlation code globally unique) and the VICIdial-agent
// → CRM-user map (routes pending transfers + dispositions to the right person).
const TABS = [
  { k: 'prefixes', label: 'Prefix registry',  icon: Hash },
  { k: 'agents',   label: 'Agent mapping',    icon: Users },
  { k: 'dispo',    label: 'Disposition map',  icon: ListChecks },
  { k: 'setup',    label: 'Setup URLs',       icon: PhoneCall },
];

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
const AgentRow = ({ a, onSaved }) => {
  const [val, setVal] = useState(a.vicidial_agent_id || '');
  const [busy, setBusy] = useState(false);
  const dirty = val.trim() !== (a.vicidial_agent_id || '');
  const save = async () => {
    setBusy(true);
    try { await client.post('vicidial/agents', { user_id: a.user_id, agent_id: val.trim() }); toast.success('Saved'); onSaved(); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
    finally { setBusy(false); }
  };
  return (
    <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
      <td className="px-4 py-2.5">
        <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{a.name}</p>
        <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{[a.role, a.company].filter(Boolean).join(' · ') || '—'}</p>
      </td>
      <td className="px-4 py-2.5">
        <input value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && dirty) save(); }} placeholder="e.g. TMC100682" className="input py-1.5 text-sm" style={{ maxWidth: 200, fontFamily: 'monospace' }} />
      </td>
      <td className="px-4 py-2.5">
        <button onClick={save} disabled={!dirty || busy} className="text-xs font-bold px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1 text-white disabled:opacity-40" style={{ background: 'var(--gradient-sidebar)' }}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
        </button>
      </td>
    </tr>
  );
};

const Agents = () => {
  const [q, setQ] = useState('');
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await client.get('vicidial/agents', { params: { q: q || undefined } }); setAgents(r.data.agents || []); }
    catch { /* ignore */ } finally { setLoading(false); }
  }, [q]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  return (
    <div className="space-y-3">
      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        Map each VICIdial agent id (the dialer's <code>user</code>) to a CRM user, so pending transfers + dispositions route to the right person. One agent id per user.
      </p>
      <div className="relative max-w-md">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search people or agent id…" className="input" style={{ paddingLeft: 34 }} />
      </div>
      {loading ? <div className="flex justify-center py-8"><Loader2 className="animate-spin" /></div> : agents.length === 0 ? <p className="text-sm py-6 text-center" style={{ color: 'var(--color-text-tertiary)' }}>No users.</p> : (
        <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <table className="w-full text-sm">
            <thead><tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
              {['User', 'VICIdial agent id', ''].map(h => <th key={h} className="px-4 py-2.5 text-left text-xs font-bold uppercase" style={{ color: 'var(--color-text-secondary)' }}>{h}</th>)}
            </tr></thead>
            <tbody>{agents.map(a => <AgentRow key={a.user_id} a={a} onSaved={load} />)}</tbody>
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
    if (!companyId || !newCode.trim()) { toast.error('Company + code required'); return; }
    setBusy(true);
    try { await client.post('vicidial/dispo-map', { company_id: companyId, vici_code: newCode.trim(), disposition_name: newDisp || null }); setNewCode(''); setNewDisp(''); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); } finally { setBusy(false); }
  };

  const unmapped = rows.filter(r => !r.disposition_name).length;

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        Map each raw VICIdial closer code (NI, CB, SALE…) to a CRM disposition. A code the dialer sends that isn't mapped is auto-recorded here (with a hit count) and left for you to map or add — nothing is lost, and the closer can still pick it manually.
      </p>
      <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="input" style={{ maxWidth: 300 }}>
        <option value="">Select a company…</option>
        {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>

      {companyId && (
        <>
          {dispositions.length === 0 && <Alert type="warning" message="This company has no configured dispositions yet — add them under Dispositions/Form config first, then map here." />}
          {unmapped > 0 && <p className="text-xs font-bold flex items-center gap-1.5" style={{ color: 'var(--color-warning-700, #b45309)' }}><AlertTriangle size={13} /> {unmapped} unmapped code(s) the dialer sent — resolve below.</p>}

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
                  {rows.map(r => (
                    <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: r.disposition_name ? undefined : 'var(--color-warning-50, #fffbeb)' }}>
                      <td className="px-4 py-2.5 font-mono font-bold" style={{ color: 'var(--color-text)' }}>{r.vici_code}</td>
                      <td className="px-4 py-2.5">
                        <select value={r.disposition_name || ''} onChange={e => setMap(r, e.target.value)} className="input py-1.5 text-sm">
                          <option value="">— unmapped —</option>
                          {dispositions.map(d => <option key={d} value={d}>{d}</option>)}
                          {r.disposition_name && !dispositions.includes(r.disposition_name) && <option value={r.disposition_name}>{r.disposition_name}</option>}
                        </select>
                      </td>
                      <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{r.hits}</td>
                      <td className="px-4 py-2.5"><button onClick={() => del(r)} className="p-1.5 rounded-lg hover:bg-error-50"><Trash2 size={15} style={{ color: '#ef4444' }} /></button></td>
                    </tr>
                  ))}
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
  return (
    <div className="space-y-5 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
      <p>Set <code>VICIDIAL_INGEST_TOKEN</code> in the backend env, then use <code>?key=THAT_TOKEN</code> in the URLs below. Replace <code>{'{PREFIX}'}</code> with the company's prefix (Prefix registry tab). The fronter Dispo Call URL fires on <strong>every</strong> disposition — set <strong>Transfer dispos</strong> on the Prefix registry tab so only real transfers (e.g. <code>XFER</code>) create a pending transfer.</p>

      <div className="rounded-xl p-3" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <p className="font-bold mb-2" style={{ color: 'var(--color-text)' }}>A · Fronter &amp; closer on the SAME VICIdial box</p>
        <p className="mb-2 text-xs">The call transfer keeps the same <code>lead_id</code>, so both sides match on it. <strong>No webform needed.</strong></p>
        <p className="font-semibold mb-1" style={{ color: 'var(--color-text)' }}>Fronter Dispo Call URL:</p>
        {block(`${base}/api/vicidial/fronter-xfer?key=YOUR_TOKEN&code={PREFIX}--A--lead_id--B--&phone=--A--phone_number--B--&agent=--A--user--B--&dispo=--A--dispo--B--`)}
        <p className="font-semibold mb-1 mt-2" style={{ color: 'var(--color-text)' }}>Closer Dispo Call URL:</p>
        {block(`${base}/api/vicidial/closer-dispo?key=YOUR_TOKEN&code={PREFIX}--A--lead_id--B--&dispo=--A--dispo--B--&talk_time=--A--talk_time--B--&agent=--A--user--B--`)}
      </div>

      <div className="rounded-xl p-3" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <p className="font-bold mb-2" style={{ color: 'var(--color-text)' }}>B · Fronter &amp; closer on DIFFERENT VICIdial boxes</p>
        <p className="mb-2 text-xs">The closer box assigns its own <code>lead_id</code>, so the fronter's id must ride across in <code>vendor_lead_code</code>. Add this param to the fronter <strong>webform (add_lead)</strong>, pointed at the closer box:</p>
        {block('&vendor_lead_code={PREFIX}--A--lead_id--B--')}
        <p className="font-semibold mb-1 mt-2" style={{ color: 'var(--color-text)' }}>Fronter Dispo Call URL:</p>
        {block(`${base}/api/vicidial/fronter-xfer?key=YOUR_TOKEN&code={PREFIX}--A--lead_id--B--&phone=--A--phone_number--B--&agent=--A--user--B--&dispo=--A--dispo--B--`)}
        <p className="font-semibold mb-1 mt-2" style={{ color: 'var(--color-text)' }}>Closer Dispo Call URL (note: <code>vendor_lead_code</code>, already holds the prefix):</p>
        {block(`${base}/api/vicidial/closer-dispo?key=YOUR_TOKEN&code=--A--vendor_lead_code--B--&dispo=--A--dispo--B--&talk_time=--A--talk_time--B--&agent=--A--user--B--`)}
      </div>
    </div>
  );
};

const VicidialAdmin = () => {
  const [tab, setTab] = useState('prefixes');
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

      {tab === 'prefixes' && <Prefixes />}
      {tab === 'agents'   && <Agents />}
      {tab === 'dispo'    && <DispoMap />}
      {tab === 'setup'    && <Setup />}
    </div>
  );
};

export default VicidialAdmin;
