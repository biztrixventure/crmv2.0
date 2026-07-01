import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Clock, Play, Pause, Loader2, CheckCircle2, Circle, X, Search, RefreshCw,
  Phone, User, Calendar, Headphones, ChevronLeft, ChevronRight, ChevronUp, ChevronDown,
  ShieldCheck, Trash2, Building2, Tag, Link2, AlertTriangle, CheckCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';

// ── Compliance recording review ──────────────────────────────────────────────
// Queue of "coded + mapped" sales; the reviewer hears every candidate leg
// (fronter + closer + redials), confirms the one(s) the portal should play, and
// only a lightweight reference is stored — never audio. Plus a standalone
// phone-search tool for spot-checks / disputes.
const PAGE = 50;
const fmtDurLong = (s) => { if (s == null) return '—'; const m = Math.floor(s / 60), r = Math.floor(s % 60); return m ? `${m}m ${String(r).padStart(2, '0')}s` : `${r}s`; };
const fmtDate = (d) => { try { return d ? new Date(String(d).length <= 10 ? d + 'T00:00:00' : d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''; } catch { return d || ''; } };
const fmtTime = (s) => { try { return s ? new Date(String(s).replace(' ', 'T')).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; } catch { return s || ''; } };
const money = (n) => (n == null || n === '' || isNaN(+n)) ? null : `$${(+n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

const inp = { background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)', borderRadius: 8, padding: '6px 10px', fontSize: 13 };
function Field({ label, children }) {
  return <label className="flex flex-col gap-1"><span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>{label}</span>{children}</label>;
}
function AgentBadge({ c }) {
  const kind = c.is_closer_agent ? 'Closer' : (c.agent_role === 'fronter' || c.agent_role === 'fronter_manager' ? 'Fronter' : 'Other agent');
  const color = kind === 'Closer' ? 'var(--color-success-600)' : kind === 'Fronter' ? 'var(--color-warning-600)' : 'var(--color-text-tertiary)';
  return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface-hover)', color }}>{kind}</span>;
}
function PhoneBadge({ c }) {
  return c.phone_matches
    ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded inline-flex items-center gap-0.5" style={{ background: 'var(--color-success-50, rgba(22,163,74,0.12))', color: 'var(--color-success-600)' }}><CheckCheck size={11} />phone</span>
    : <span className="text-[10px] font-bold px-1.5 py-0.5 rounded inline-flex items-center gap-0.5" style={{ background: 'var(--color-error-50, rgba(220,38,38,0.12))', color: 'var(--color-error-600)' }}><AlertTriangle size={11} />no phone match</span>;
}

// ── shared: candidate list with inline players + ordered selection ────────────
function CandidateList({ candidates, loading, chosen, setChosen, emptyText }) {
  const audioRef = useRef(null); const urlRef = useRef(null);
  const [playingId, setPlayingId] = useState(null);
  const [loadingId, setLoadingId] = useState(null);
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const play = async (c) => {
    const a = audioRef.current; if (!a) return;
    if (a.dataset.rid === c.recording_id) { a.paused ? a.play() : a.pause(); return; }
    setLoadingId(c.recording_id);
    try {
      const res = await client.get('compliance/recordings/stream', {
        params: { box_id: c.box_id, lead_id: c.lead_id, recording_id: c.recording_id, location: c.location }, responseType: 'blob',
      });
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(res.data); urlRef.current = url;
      a.src = url; a.dataset.rid = c.recording_id; a.load(); a.play().catch(() => {});
    } catch { toast.error('Could not load that recording'); }
    finally { setLoadingId(null); }
  };

  const byId = useMemo(() => new Map(candidates.map(c => [c.recording_id, c])), [candidates]);
  const toggle = (rid) => setChosen(cs => cs.includes(rid) ? cs.filter(x => x !== rid) : [...cs, rid]);
  const move = (i, d) => setChosen(cs => { const n = [...cs]; const j = i + d; if (j < 0 || j >= n.length) return cs; [n[i], n[j]] = [n[j], n[i]]; return n; });

  return (
    <div className="space-y-3">
      {/* selected (play order) */}
      {chosen.length > 0 && (
        <div className="p-2.5 rounded-xl" style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-primary-600)' }}>
          <div className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-primary-600)' }}>Confirmed play order ({chosen.length})</div>
          <div className="space-y-1">
            {chosen.map((rid, i) => {
              const c = byId.get(rid);
              return (
                <div key={rid} className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text)' }}>
                  <span className="font-bold w-4" style={{ color: 'var(--color-primary-600)' }}>{i + 1}.</span>
                  <span className="tabular-nums font-semibold">{c ? fmtDurLong(c.duration) : '—'}</span>
                  <span style={{ color: 'var(--color-text-secondary)' }}>{c?.agent_name || rid}</span>
                  <span className="ml-auto flex items-center gap-0.5">
                    <button onClick={() => move(i, -1)} disabled={i === 0} className="p-0.5 rounded disabled:opacity-30" style={{ color: 'var(--color-text-secondary)' }}><ChevronUp size={14} /></button>
                    <button onClick={() => move(i, 1)} disabled={i === chosen.length - 1} className="p-0.5 rounded disabled:opacity-30" style={{ color: 'var(--color-text-secondary)' }}><ChevronDown size={14} /></button>
                    <button onClick={() => toggle(rid)} className="p-0.5 rounded" style={{ color: 'var(--color-error-600)' }}><X size={14} /></button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* all candidates */}
      {loading ? (
        <div className="text-center py-10"><Loader2 className="animate-spin inline" style={{ color: 'var(--color-text-tertiary)' }} /><div className="text-xs mt-2" style={{ color: 'var(--color-text-tertiary)' }}>Loading recordings from the dialer…</div></div>
      ) : candidates.length === 0 ? (
        <div className="text-center py-8 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>{emptyText || 'No recordings found on the dialer.'}</div>
      ) : candidates.map(c => {
        const on = chosen.includes(c.recording_id);
        const order = chosen.indexOf(c.recording_id) + 1;
        const isPlaying = playingId === c.recording_id;
        return (
          <div key={c.box_id + c.recording_id} className="flex items-center gap-3 p-2.5 rounded-xl"
            style={{ background: on ? 'var(--color-surface-hover)' : 'var(--color-surface)', border: `1px solid ${on ? 'var(--color-primary-600)' : 'var(--color-border)'}` }}>
            <button onClick={() => play(c)} className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--gradient-sidebar)' }}>
              {loadingId === c.recording_id ? <Loader2 size={15} className="animate-spin" color="#fff" /> : isPlaying ? <Pause size={15} color="#fff" /> : <Play size={15} color="#fff" />}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold tabular-nums" style={{ color: 'var(--color-text)' }}>{fmtDurLong(c.duration)}</span>
                <AgentBadge c={c} />
                <PhoneBadge c={c} />
                <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{c.agent_name}</span>
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>{fmtTime(c.start_time)} · box {c.box_id} · rec {c.recording_id}</div>
            </div>
            <button onClick={() => toggle(c.recording_id)} className="flex-shrink-0 flex items-center gap-1" title={on ? 'Selected' : 'Select'}>
              {on
                ? <span className="flex items-center gap-1 text-xs font-bold" style={{ color: 'var(--color-primary-600)' }}>{chosen.length > 1 ? `#${order}` : ''}<CheckCircle2 size={22} /></span>
                : <Circle size={22} style={{ color: 'var(--color-text-tertiary)' }} />}
            </button>
          </div>
        );
      })}
      <audio ref={audioRef} className="hidden" onPlay={() => setPlayingId(audioRef.current?.dataset.rid || null)} onPause={() => setPlayingId(null)} onEnded={() => setPlayingId(null)} />
    </div>
  );
}

// ── review modal (per queue sale) ────────────────────────────────────────────
function ReviewModal({ saleId, onClose, onConfirmed }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [chosen, setChosen] = useState([]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await client.get('compliance/recordings/candidates', { params: { sale_id: saleId } });
      setData(r.data);
      const ex = (r.data.existing || []).slice().sort((a, b) => a.clip_order - b.clip_order);
      setChosen(ex.map(c => c.recording_id));
      setNote(ex.find(c => c.note)?.note || '');
    } catch (e) { toast.error(e.response?.data?.error || 'Could not load candidates'); }
    finally { setLoading(false); }
  }, [saleId]);
  useEffect(() => { load(); }, [load]);

  const sale = data?.sale || {};
  const candidates = data?.candidates || [];
  const byId = useMemo(() => new Map(candidates.map(c => [c.recording_id, c])), [candidates]);
  const hadExisting = (data?.existing || []).length > 0;

  const confirm = async () => {
    if (!chosen.length) { toast.error('Select at least one recording'); return; }
    setSaving(true);
    try {
      const clips = chosen.map((rid, i) => { const c = byId.get(rid); return c && { box_id: c.box_id, lead_id: c.lead_id, recording_id: c.recording_id, location: c.location, agent_user: c.agent_user, start_time: c.start_time, duration: c.duration, note: i === 0 ? (note || null) : null }; }).filter(Boolean);
      await client.post('compliance/recordings/confirm', { sale_id: saleId, clips });
      toast.success(`Confirmed ${clips.length} recording${clips.length === 1 ? '' : 's'}`);
      onConfirmed(saleId);
    } catch (e) { toast.error(e.response?.data?.error || 'Could not confirm'); }
    finally { setSaving(false); }
  };
  const unconfirm = async () => {
    setSaving(true);
    try { await client.delete(`compliance/recordings/confirm/${saleId}`); toast.success('Sent back to pending'); onConfirmed(saleId); }
    catch (e) { toast.error(e.response?.data?.error || 'Could not clear'); }
    finally { setSaving(false); }
  };

  return (
    <Modal onClose={onClose} title={sale.customer_name || 'Sale'}
      subtitle={<div className="flex items-center gap-3 text-xs flex-wrap" style={{ color: 'var(--color-text-secondary)' }}>
        <span className="flex items-center gap-1"><Phone size={11} />{sale.phone || '—'}</span>
        <span className="flex items-center gap-1"><User size={11} />{sale.closer_name || '—'}</span>
        <span className="flex items-center gap-1"><Calendar size={11} />{fmtDate(sale.sale_date)}</span>
        {sale.company_name && <span className="flex items-center gap-1"><Building2 size={11} />{sale.company_name}</span>}
        {sale.plan && <span className="flex items-center gap-1"><Tag size={11} />{sale.plan}</span>}
        {money(sale.monthly_payment) && <span className="font-semibold">{money(sale.monthly_payment)}/mo</span>}
        {sale.reference_no && <span style={{ color: 'var(--color-text-tertiary)' }}>ref {sale.reference_no}</span>}
      </div>}
      footer={
        <>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Optional note (e.g. call dropped at 3min, continued on clip 2)"
            className="flex-1 min-w-0" style={{ ...inp }} />
          {hadExisting && <button onClick={unconfirm} disabled={saving} className="text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1 flex-shrink-0" style={{ color: 'var(--color-error-600)' }}><Trash2 size={13} /> Pending</button>}
          <button onClick={confirm} disabled={saving || !chosen.length} className="text-sm font-bold px-5 py-2 rounded-lg flex items-center gap-2 disabled:opacity-50 flex-shrink-0" style={{ background: 'var(--gradient-sidebar)', color: 'var(--color-text-inverse)' }}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}{hadExisting ? 'Update' : 'Confirm'}
          </button>
        </>
      }>
      <div className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-tertiary)' }}>
        Every recording on this lead — pick the actual sale call{hadExisting ? ' (currently confirmed pre-selected)' : ''}:
      </div>
      <CandidateList candidates={candidates} loading={loading} chosen={chosen} setChosen={setChosen} />
    </Modal>
  );
}

// ── phone search (standalone) ────────────────────────────────────────────────
function PhoneSearchView() {
  const [phone, setPhone] = useState('');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [cands, setCands] = useState(null);
  const [loading, setLoading] = useState(false);
  const [chosen, setChosen] = useState([]);
  const [linking, setLinking] = useState(false);

  const search = async () => {
    const digits = phone.replace(/\D/g, ''); if (digits.length < 4) { toast.error('Enter at least 4 digits'); return; }
    setLoading(true); setChosen([]);
    try {
      const r = await client.get('compliance/recordings/candidates', { params: { phone: digits, date_from: from || undefined, date_to: to || undefined } });
      setCands(r.data.candidates || []);
    } catch (e) { toast.error(e.response?.data?.error || 'Search failed'); setCands([]); }
    finally { setLoading(false); }
  };

  const byId = useMemo(() => new Map((cands || []).map(c => [c.recording_id, c])), [cands]);
  const clips = chosen.map(rid => byId.get(rid)).filter(Boolean).map(c => ({ box_id: c.box_id, lead_id: c.lead_id, recording_id: c.recording_id, location: c.location, agent_user: c.agent_user, start_time: c.start_time, duration: c.duration }));

  return (
    <div className="space-y-4">
      <div className="p-3 rounded-xl flex items-start gap-2" style={{ background: 'var(--color-warning-50, rgba(217,119,6,0.08))', border: '1px solid var(--color-warning-200, rgba(217,119,6,0.2))' }}>
        <AlertTriangle size={15} style={{ color: 'var(--color-warning-600)' }} className="mt-0.5 flex-shrink-0" />
        <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          Phone search reads the dialer's call log, which has a <b>short retention window</b> (best for calls within the last day or two). Recent numbers work far better than old ones — for older sales, use the <b>Review Queue</b> instead.
        </div>
      </div>
      <div className="flex items-end gap-3 flex-wrap p-3 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <Field label="Phone number">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
            <input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" placeholder="phone number" onKeyDown={e => e.key === 'Enter' && search()} style={{ ...inp, paddingLeft: 30 }} />
          </div>
        </Field>
        <Field label="From"><input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inp} /></Field>
        <Field label="To"><input type="date" value={to} onChange={e => setTo(e.target.value)} style={inp} /></Field>
        <button onClick={search} disabled={loading} className="text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2" style={{ background: 'var(--gradient-sidebar)', color: 'var(--color-text-inverse)' }}>
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Search
        </button>
      </div>

      {cands !== null && (
        <>
          <CandidateList candidates={cands} loading={loading} chosen={chosen} setChosen={setChosen} emptyText="No recordings found for that number in range." />
          {chosen.length > 0 && (
            <div className="flex justify-end">
              <button onClick={() => setLinking(true)} className="text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2" style={{ background: 'var(--gradient-sidebar)', color: 'var(--color-text-inverse)' }}>
                <Link2 size={15} /> Link {chosen.length} to a sale…
              </button>
            </div>
          )}
        </>
      )}
      {linking && <SalePicker clips={clips} onClose={() => setLinking(false)} onDone={() => { setLinking(false); setChosen([]); toast.success('Linked & confirmed'); }} />}
    </div>
  );
}

// pick a sale to attach phone-searched clips to (reuses the queue as a finder)
function SalePicker({ clips, onClose, onDone }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(null);

  const find = useCallback(async (term) => {
    if (!term || term.trim().length < 2) { setRows([]); return; }
    setLoading(true);
    try { const r = await client.get('compliance/recordings/queue', { params: { status: 'all', search: term.trim(), limit: 20 } }); setRows(r.data.queue || []); }
    catch { setRows([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { const t = setTimeout(() => find(q), 300); return () => clearTimeout(t); }, [q, find]);

  const attach = async (sale) => {
    setSaving(sale.sale_id);
    try { await client.post('compliance/recordings/confirm', { sale_id: sale.sale_id, clips }); onDone(); }
    catch (e) { toast.error(e.response?.data?.error || 'Could not link'); setSaving(null); }
  };

  return (
    <Modal onClose={onClose} title="Link to a sale" subtitle={<span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Search by customer name, phone, or reference — confirms {clips.length} clip{clips.length === 1 ? '' : 's'} against it.</span>}>
      <div className="relative mb-3">
        <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search sales…" style={{ ...inp, paddingLeft: 32, width: '100%' }} />
      </div>
      {loading ? <div className="text-center py-6"><Loader2 className="animate-spin inline" style={{ color: 'var(--color-text-tertiary)' }} /></div>
        : rows.length === 0 ? <div className="text-center py-6 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>{q.trim().length < 2 ? 'Type to search…' : 'No matching sales.'}</div>
        : <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {rows.map(r => (
              <button key={r.sale_id} onClick={() => attach(r)} disabled={saving} className="w-full text-left flex items-center gap-3 p-2.5 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{r.customer_name || '—'} {r.confirmed && <span className="text-[10px] font-bold" style={{ color: 'var(--color-success-600)' }}>· confirmed ({r.clip_count})</span>}</div>
                  <div className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>{r.customer_phone} · {r.closer_name} · {fmtDate(r.sale_date)}</div>
                </div>
                {saving === r.sale_id ? <Loader2 size={16} className="animate-spin" style={{ color: 'var(--color-primary-600)' }} /> : <Link2 size={16} style={{ color: 'var(--color-primary-600)' }} />}
              </button>
            ))}
          </div>}
    </Modal>
  );
}

// ── queue view ───────────────────────────────────────────────────────────────
function QueueView({ companyList }) {
  const [status, setStatus] = useState('pending');
  const [filters, setFilters] = useState({ date_from: '', date_to: '', company_id: '', closer_id: '', search: '' });
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(null);
  const [sort, setSort] = useState({ col: 'sale_date', dir: 'desc' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { status, sort: sort.col, dir: sort.dir, limit: PAGE, offset };
      for (const k of ['date_from', 'date_to', 'company_id', 'closer_id', 'search']) if (filters[k]) params[k] = filters[k];
      const r = await client.get('compliance/recordings/queue', { params });
      setRows(r.data.queue || []); setTotal(r.data.total || 0);
    } catch (e) { toast.error(e.response?.data?.error || 'Could not load the queue'); setRows([]); }
    finally { setLoading(false); }
  }, [status, filters, offset, sort]);
  useEffect(() => { load(); }, [load]);
  // click a header → sort by it; click again → flip direction
  const toggleSort = (col) => { setOffset(0); setSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' }); };

  const closerOptions = useMemo(() => {
    const m = new Map(); for (const r of rows) if (r.closer_id) m.set(r.closer_id, r.closer_name || r.closer_id);
    return [...m.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  }, [rows]);
  const setF = (k, v) => { setOffset(0); setFilters(f => ({ ...f, [k]: v })); };
  const onConfirmed = () => { setActive(null); load(); };
  const from = total ? offset + 1 : 0, to = Math.min(offset + PAGE, total);

  return (
    <div className="space-y-4">
      {/* status + count */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
          {['pending', 'confirmed', 'all'].map(s => (
            <button key={s} onClick={() => { setOffset(0); setStatus(s); }} className="text-xs font-semibold px-3 py-1.5 capitalize"
              style={{ background: status === s ? 'var(--gradient-sidebar)' : 'transparent', color: status === s ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)' }}>{s}</button>
          ))}
        </div>
        <span className="text-sm font-bold px-2.5 py-1 rounded-full" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text)' }}>
          {total.toLocaleString()} {status === 'pending' ? 'pending review' : status === 'confirmed' ? 'confirmed' : 'total'}
        </span>
        <button onClick={load} className="ml-auto p-2 rounded-lg" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }} title="Refresh">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} style={{ color: 'var(--color-text-secondary)' }} />
        </button>
      </div>

      {/* filters */}
      <div className="flex items-end gap-3 flex-wrap p-3 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <Field label="Search">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
            <input value={filters.search} onChange={e => setF('search', e.target.value)} placeholder="Search anything — name, phone, closer, company, product, ref, code" style={{ ...inp, paddingLeft: 30, minWidth: 320 }} />
          </div>
        </Field>
        <Field label="From"><input type="date" value={filters.date_from} onChange={e => setF('date_from', e.target.value)} style={inp} /></Field>
        <Field label="To"><input type="date" value={filters.date_to} onChange={e => setF('date_to', e.target.value)} style={inp} /></Field>
        <Field label="Company">
          <select value={filters.company_id} onChange={e => setF('company_id', e.target.value)} style={inp}>
            <option value="">All companies</option>
            {companyList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Closer (this page)">
          <select value={filters.closer_id} onChange={e => setF('closer_id', e.target.value)} style={inp}>
            <option value="">All closers</option>
            {closerOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </Field>
        {Object.values(filters).some(Boolean) && (
          <button onClick={() => { setOffset(0); setFilters({ date_from: '', date_to: '', company_id: '', closer_id: '', search: '' }); }}
            className="text-xs font-semibold px-3 py-2 rounded-lg" style={{ color: 'var(--color-text-secondary)' }}>Clear</button>
        )}
      </div>

      {/* table */}
      <div className="rounded-xl overflow-x-auto" style={{ border: '1px solid var(--color-border)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}>
              {[
                ['Sale date', 'sale_date'], ['Customer', 'customer_name'], ['Phone', 'customer_phone'],
                ['Closer', 'closer_name'], ['Company', 'company_name'], ['Product', 'plan'],
                ['Amount', 'monthly_payment'], ['Status', 'status'], ['', null],
              ].map(([h, key], i) => (
                <th key={i} onClick={() => key && toggleSort(key)}
                  className={`text-left font-semibold px-3 py-2 text-xs whitespace-nowrap select-none ${key ? 'cursor-pointer' : ''}`}
                  style={{ color: sort.col === key ? 'var(--color-primary-600)' : undefined }}>
                  <span className="inline-flex items-center gap-0.5">
                    {h}
                    {key && sort.col === key && (sort.dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="text-center py-12"><Loader2 className="animate-spin inline" style={{ color: 'var(--color-text-tertiary)' }} /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-12 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
                <ShieldCheck size={26} className="inline mb-2" /><div>No sales {status === 'pending' ? 'pending review' : status === 'confirmed' ? 'confirmed' : 'found'}{Object.values(filters).some(Boolean) ? ' for these filters' : ''}.</div>
              </td></tr>
            ) : rows.map(r => (
              <tr key={r.sale_id} className="border-t hover:bg-black/[0.02] cursor-pointer" style={{ borderColor: 'var(--color-border)' }} onClick={() => setActive(r.sale_id)}>
                <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--color-text)' }}>{fmtDate(r.sale_date)}</td>
                <td className="px-3 py-2 font-medium" style={{ color: 'var(--color-text)' }}>{r.customer_name || '—'}</td>
                <td className="px-3 py-2 tabular-nums whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>{r.customer_phone || '—'}</td>
                <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>{r.closer_name || '—'}</td>
                <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>{r.company_name || '—'}</td>
                <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>{r.plan || '—'}</td>
                <td className="px-3 py-2 whitespace-nowrap tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{money(r.monthly_payment) || '—'}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {r.confirmed
                    ? <span className="text-[11px] font-bold" style={{ color: 'var(--color-success-600)' }}>confirmed ({r.clip_count})</span>
                    : <span className="text-[11px] font-bold" style={{ color: 'var(--color-warning-600)' }}>pending</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  <button className="text-xs font-bold px-3 py-1.5 rounded-lg" style={{ background: 'var(--gradient-sidebar)', color: 'var(--color-text-inverse)' }}>{r.confirmed ? 'Re-review' : 'Review'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > PAGE && (
        <div className="flex items-center justify-between text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          <span>{from}–{to} of {total.toLocaleString()}</span>
          <div className="flex gap-2">
            <button disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - PAGE))} className="p-1.5 rounded-lg disabled:opacity-40" style={{ border: '1px solid var(--color-border)' }}><ChevronLeft size={15} /></button>
            <button disabled={to >= total} onClick={() => setOffset(o => o + PAGE)} className="p-1.5 rounded-lg disabled:opacity-40" style={{ border: '1px solid var(--color-border)' }}><ChevronRight size={15} /></button>
          </div>
        </div>
      )}

      {active && <ReviewModal saleId={active} onClose={() => setActive(null)} onConfirmed={onConfirmed} />}
    </div>
  );
}

// ── shared modal shell ───────────────────────────────────────────────────────
function Modal({ title, subtitle, children, footer, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl overflow-hidden" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 p-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="min-w-0 flex-1">
            <div className="font-bold" style={{ color: 'var(--color-text)' }}>{title}</div>
            {subtitle && <div className="mt-0.5">{subtitle}</div>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg" style={{ color: 'var(--color-text-secondary)' }}><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <div className="flex items-center gap-2 p-4" style={{ borderTop: '1px solid var(--color-border)' }}>{footer}</div>}
      </div>
    </div>
  );
}

// ── top: mode tabs ───────────────────────────────────────────────────────────
export default function RecordingReviewTab({ companyList = [] }) {
  const [mode, setMode] = useState('queue');
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Headphones size={18} style={{ color: 'var(--color-primary-600)' }} />
        <h2 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>Recording Review</h2>
        <div className="ml-2 flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
          {[['queue', 'Review Queue'], ['phone', 'Phone Search']].map(([k, label]) => (
            <button key={k} onClick={() => setMode(k)} className="text-xs font-semibold px-3 py-1.5"
              style={{ background: mode === k ? 'var(--gradient-sidebar)' : 'transparent', color: mode === k ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)' }}>{label}</button>
          ))}
        </div>
      </div>
      {mode === 'queue' ? <QueueView companyList={companyList} /> : <PhoneSearchView />}
    </div>
  );
}
