import { useState, useEffect, useCallback } from 'react';
import { PhoneCall, Plus, Trash2, Save, Search, Hash, Users, ChevronDown, Loader2, Check, ListChecks, AlertTriangle, DownloadCloud } from 'lucide-react';
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
  { k: 'backfill', label: 'Backfill dispos',  icon: DownloadCloud },
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
        <input value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && dirty) save(); }} placeholder="e.g. ETC0895, 2006" className="input py-1.5 text-sm" style={{ maxWidth: 240, fontFamily: 'monospace' }} />
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
        Map each VICIdial agent id (the dialer's <code>user</code>) to a CRM user, so pending transfers + dispositions route to the right person. A person who works <b>more than one box</b> has a different id per box — list all of them <b>comma-separated</b> (e.g. <code>ETC0895, 2006</code>) and any of them maps here.
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
        <p className="font-semibold mb-1">Only coded transfers can be recovered.</p>
        <p className="text-sm">
          A transfer that carries a dialer code (<code>WTI/ETC/TMC…</code>) can have its disposition read straight from
          the dialer by lead id — that status never archives. <b>Code-less transfers</b> (most of the old, pre-link ones)
          have no lead id and the dialer's call log archives daily, so there is no source to read — they're skipped.
          Going forward, the fronter-xfer URLs make every new transfer coded, so this gap stops growing.
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
      {tab === 'backfill' && <Backfill />}
      {tab === 'setup'    && <Setup />}
    </div>
  );
};

export default VicidialAdmin;
