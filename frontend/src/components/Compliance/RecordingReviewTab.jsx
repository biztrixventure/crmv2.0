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
  const [loadedRid, setLoadedRid] = useState(null);
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
      a.src = url; a.dataset.rid = c.recording_id; setLoadedRid(c.recording_id); a.load(); a.play().catch(() => {});
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
      {/* FIX 1 — real inline player with native controls (seek bar, time, volume).
          The per-card ▶ loads the clip; the stream is blob-fetched with the
          compliance auth header (a raw <audio src> to the authed route would 401),
          so the src is an object URL. Visible once a clip has been loaded. */}
      <div className="sticky bottom-0 pt-2" style={{ background: 'var(--color-bg)', display: loadedRid ? 'block' : 'none' }}>
        <audio ref={audioRef} controls className="w-full"
          onPlay={() => setPlayingId(audioRef.current?.dataset.rid || null)} onPause={() => setPlayingId(null)} onEnded={() => setPlayingId(null)} />
      </div>
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
  // FIX 2 — manual phone-search fallback when the auto lookup finds nothing
  const [manualMode, setManualMode] = useState(false);
  const [manualCands, setManualCands] = useState(null);
  const [manualBusy, setManualBusy] = useState(false);
  const [mPhone, setMPhone] = useState(''); const [mFrom, setMFrom] = useState(''); const [mTo, setMTo] = useState('');

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
  // Fall back to already-confirmed clips when the auto lookup returns nothing, so a
  // re-review of a manually-linked sale still shows its confirmed recordings.
  const autoCandidates = (data?.candidates && data.candidates.length) ? data.candidates : (data?.existing || []);
  const candidates = manualMode ? (manualCands || []) : autoCandidates;
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

  // FIX 2 — locate a recording by phone when the automatic lookup found none.
  // Results feed the SAME CandidateList → confirming saves against THIS sale.
  const runManualSearch = async (phone, from, to) => {
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.length < 4) { toast.error('Enter at least 4 digits'); return; }
    setManualBusy(true);
    try {
      const r = await client.get('compliance/recordings/candidates', { params: { phone: digits, date_from: from || undefined, date_to: to || undefined } });
      setManualCands(r.data.candidates || []);
    } catch (e) { toast.error(e.response?.data?.error || 'Search failed'); setManualCands([]); }
    finally { setManualBusy(false); }
  };
  const startManual = () => {
    const digits = String(sale.phone || '').replace(/\D/g, '');
    setMPhone(digits); setMFrom(sale.sale_date || ''); setMTo(sale.sale_date || '');
    setChosen([]); setManualMode(true);
    if (digits.length >= 4) runManualSearch(digits, sale.sale_date, sale.sale_date);
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
      {!loading && !manualMode && autoCandidates.length === 0 ? (
        <div className="p-4 rounded-xl text-center space-y-3" style={{ background: 'var(--color-warning-50, rgba(217,119,6,0.08))', border: '1px solid var(--color-warning-200, rgba(217,119,6,0.25))' }}>
          <div className="flex items-center justify-center gap-2 text-sm font-bold" style={{ color: 'var(--color-warning-700, #b45309)' }}><AlertTriangle size={16} /> No recording found automatically</div>
          <div className="text-xs max-w-md mx-auto" style={{ color: 'var(--color-text-secondary)' }}>The lead-id / agent+date lookup returned nothing. Search the dialer by phone number to locate it manually — once you confirm it, it saves to this sale and is found instantly every time after, straight from the CRM.</div>
          <button onClick={startManual} className="text-sm font-bold px-4 py-2 rounded-lg inline-flex items-center gap-2" style={{ background: 'var(--gradient-sidebar)', color: 'var(--color-text-inverse)' }}><Search size={15} /> Search by phone to locate it</button>
        </div>
      ) : (
        <>
          {manualMode && (
            <div className="p-2.5 rounded-xl mb-3 flex items-end gap-2 flex-wrap" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <div className="flex-1 min-w-[130px]"><label className="text-[10px] font-bold uppercase block" style={{ color: 'var(--color-text-tertiary)' }}>Phone</label><input value={mPhone} onChange={e => setMPhone(e.target.value)} inputMode="tel" onKeyDown={e => e.key === 'Enter' && runManualSearch(mPhone, mFrom, mTo)} style={{ ...inp }} /></div>
              <div><label className="text-[10px] font-bold uppercase block" style={{ color: 'var(--color-text-tertiary)' }}>From</label><input type="date" value={mFrom} onChange={e => setMFrom(e.target.value)} style={inp} /></div>
              <div><label className="text-[10px] font-bold uppercase block" style={{ color: 'var(--color-text-tertiary)' }}>To</label><input type="date" value={mTo} onChange={e => setMTo(e.target.value)} style={inp} /></div>
              <button onClick={() => runManualSearch(mPhone, mFrom, mTo)} disabled={manualBusy} className="text-sm font-bold px-3 py-2 rounded-lg flex items-center gap-1.5" style={{ background: 'var(--gradient-sidebar)', color: 'var(--color-text-inverse)' }}>{manualBusy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Search</button>
              <button onClick={() => { setManualMode(false); setManualCands(null); setChosen((data?.existing || []).map(c => c.recording_id)); }} className="text-xs font-semibold px-2 py-2 rounded-lg" style={{ color: 'var(--color-text-secondary)' }}>Back</button>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="text-xs font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>
              {manualMode ? 'Phone-search results — pick the actual sale call, then Confirm to save it to this sale:' : `Every recording on this lead — pick the actual sale call${hadExisting ? ' (currently confirmed pre-selected)' : ''}:`}
            </div>
            {!manualMode && <button onClick={startManual} className="text-[11px] font-bold px-2 py-1 rounded-lg flex items-center gap-1 flex-shrink-0" style={{ border: '1px solid var(--color-border)', color: 'var(--color-primary-600)' }}><Search size={12} /> Search all dialers by phone</button>}
          </div>
          <CandidateList candidates={candidates} loading={loading || manualBusy} chosen={chosen} setChosen={setChosen} emptyText={manualMode ? 'No recordings for that number/date on the dialer.' : undefined} />
        </>
      )}
    </Modal>
  );
}

// ── dialer search (standalone) — phone / lead id / recording id ───────────────
// Searches the raw dialers directly. lead_id + phone return EVERY leg regardless
// of whether the agent is mapped in the CRM; recording_id is matched against the
// CRM's linked clips (the dialer API can't search by recording_id) and, if that
// clip has a lead_id, the whole lead is then pulled raw off the dialer too.
const DIALER_SEARCH_TYPES = [['phone', 'Phone'], ['lead_id', 'Lead ID'], ['recording_id', 'Recording ID']];
function PhoneSearchView() {
  const [type, setType] = useState('phone');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [cands, setCands] = useState(null);
  const [note, setNote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [chosen, setChosen] = useState([]);
  const [linking, setLinking] = useState(false);

  const placeholder = type === 'phone' ? 'phone number' : type === 'lead_id' ? 'dialer lead id (digits)' : 'recording id';
  const digitsType = type === 'phone' || type === 'lead_id';

  const search = async () => {
    const val = q.trim();
    if (type === 'phone') { if (val.replace(/\D/g, '').length < 4) { toast.error('Enter at least 4 digits'); return; } }
    else if (!val) { toast.error('Enter a value to search'); return; }
    setLoading(true); setChosen([]); setNote(null);
    try {
      const params = { date_from: from || undefined, date_to: to || undefined };
      if (type === 'phone')            params.phone = val.replace(/\D/g, '');
      else if (type === 'lead_id')     params.lead_id = val.replace(/\D/g, '');
      else                             params.recording_id = val;
      const r = await client.get('compliance/recordings/candidates', { params });
      setCands(r.data.candidates || []);
      setNote(r.data.note || null);
    } catch (e) { toast.error(e.response?.data?.error || 'Search failed'); setCands([]); }
    finally { setLoading(false); }
  };

  const byId = useMemo(() => new Map((cands || []).map(c => [c.recording_id, c])), [cands]);
  const clips = chosen.map(rid => byId.get(rid)).filter(Boolean).map(c => ({ box_id: c.box_id, lead_id: c.lead_id, recording_id: c.recording_id, location: c.location, agent_user: c.agent_user, start_time: c.start_time, duration: c.duration }));

  const help = type === 'phone'
    ? 'Phone search reads the dialer call log, which has a SHORT retention window (best within the last day or two). For older calls, search by Lead ID — it has no retention limit.'
    : type === 'lead_id'
    ? 'Lead ID pulls every recording on that lead from ALL connected dialers — the fronter leg, the closer leg and any redials — whether or not the agent is mapped in the CRM.'
    : 'Recording IDs can only be searched once a recording has been linked to a sale (the dialer API has no recording-id search). If it is linked, its whole lead is pulled raw from the dialer too.';

  return (
    <div className="space-y-4">
      <div className="p-3 rounded-xl flex items-start gap-2" style={{ background: 'var(--color-warning-50, rgba(217,119,6,0.08))', border: '1px solid var(--color-warning-200, rgba(217,119,6,0.2))' }}>
        <AlertTriangle size={15} style={{ color: 'var(--color-warning-600)' }} className="mt-0.5 flex-shrink-0" />
        <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{help}</div>
      </div>

      {/* type selector */}
      <div className="flex rounded-lg overflow-hidden w-fit" style={{ border: '1px solid var(--color-border)' }}>
        {DIALER_SEARCH_TYPES.map(([k, label]) => (
          <button key={k} onClick={() => { setType(k); setCands(null); setNote(null); setChosen([]); }} className="text-xs font-semibold px-3 py-1.5"
            style={{ background: type === k ? 'var(--gradient-sidebar)' : 'transparent', color: type === k ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)' }}>{label}</button>
        ))}
      </div>

      <div className="flex items-end gap-3 flex-wrap p-3 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <Field label={DIALER_SEARCH_TYPES.find(t => t[0] === type)[1]}>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
            <input value={q} onChange={e => setQ(e.target.value)} inputMode={digitsType ? 'numeric' : 'text'} placeholder={placeholder} onKeyDown={e => e.key === 'Enter' && search()} style={{ ...inp, paddingLeft: 30, minWidth: 220 }} />
          </div>
        </Field>
        {type !== 'recording_id' && <>
          <Field label="From"><input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inp} /></Field>
          <Field label="To"><input type="date" value={to} onChange={e => setTo(e.target.value)} style={inp} /></Field>
        </>}
        <button onClick={search} disabled={loading} className="text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2" style={{ background: 'var(--gradient-sidebar)', color: 'var(--color-text-inverse)' }}>
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Search
        </button>
      </div>

      {cands !== null && (
        <>
          {note === 'recording_id_not_linked' && (
            <div className="text-xs p-2.5 rounded-lg" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
              That recording id isn’t linked to any sale yet, so the dialer can’t locate it directly. Search by <b>lead id</b> or <b>phone</b> to pull it raw.
            </div>
          )}
          <CandidateList candidates={cands} loading={loading} chosen={chosen} setChosen={setChosen}
            emptyText={type === 'phone' ? 'No recordings found for that number in range.' : type === 'lead_id' ? 'No recordings on that lead id in any dialer.' : 'No linked recording matches that id.'} />
          {chosen.length > 0 && (
            <div className="flex justify-end">
              <button onClick={() => setLinking(true)} className="text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2" style={{ background: 'var(--gradient-sidebar)', color: 'var(--color-text-inverse)' }}>
                <Link2 size={15} /> Attach {chosen.length} to a client’s sale…
              </button>
            </div>
          )}
        </>
      )}
      {linking && <ClientSalePicker clips={clips} onClose={() => setLinking(false)}
        onDone={(cl, sale) => { setLinking(false); setChosen([]); toast.success(`Attached to ${sale.customer_name || 'sale'} — ${cl.name} can now hear it`); }} />}
    </div>
  );
}

// Pick a portal CLIENT, then one of that client's in-scope sales, and ATTACH
// (append) the phone-searched clips so that client hears them on that sale —
// even a recording that doesn't "belong" to the sale. Sales are scoped exactly
// like the portal browse, so whatever you attach, the chosen client will see.
function ClientSalePicker({ clips, onClose, onDone }) {
  const [step, setStep] = useState('client');   // 'client' → 'sale'
  const [clients, setClients] = useState([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [clientQ, setClientQ] = useState('');
  const [chosenClient, setChosenClient] = useState(null);

  const [saleQ, setSaleQ] = useState('');
  const [sales, setSales] = useState([]);
  const [salesLoading, setSalesLoading] = useState(false);
  const [saving, setSaving] = useState(null);

  useEffect(() => {
    let cancelled = false;
    client.get('compliance/recordings/portal-clients')
      .then(r => { if (!cancelled) setClients(r.data.clients || []); })
      .catch(() => { if (!cancelled) setClients([]); })
      .finally(() => { if (!cancelled) setClientsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const loadSales = useCallback(async (clientId, term) => {
    setSalesLoading(true);
    try {
      const r = await client.get('compliance/recordings/client-sales', { params: { client_id: clientId, search: term || undefined, limit: 40 } });
      setSales(r.data.sales || []);
    } catch { setSales([]); } finally { setSalesLoading(false); }
  }, []);
  useEffect(() => {
    if (step !== 'sale' || !chosenClient) return;
    const t = setTimeout(() => loadSales(chosenClient.id, saleQ), 300);
    return () => clearTimeout(t);
  }, [step, chosenClient, saleQ, loadSales]);

  const pickClient = (c) => { setChosenClient(c); setSaleQ(''); setSales([]); setStep('sale'); };
  const attach = async (sale) => {
    setSaving(sale.sale_id);
    try { await client.post('compliance/recordings/confirm', { sale_id: sale.sale_id, clips, append: true }); onDone(chosenClient, sale); }
    catch (e) { toast.error(e.response?.data?.error || 'Could not attach'); setSaving(null); }
  };

  const fc = clientQ.trim().toLowerCase();
  const filteredClients = clients.filter(c => !fc
    || (c.name || '').toLowerCase().includes(fc)
    || (c.login_email || '').toLowerCase().includes(fc)
    || (c.closer_names || []).join(' ').toLowerCase().includes(fc)
    || (c.client_names || []).join(' ').toLowerCase().includes(fc));

  return (
    <Modal onClose={onClose}
      title={step === 'client' ? 'Attach to a client’s sale' : `Pick a sale for ${chosenClient?.name || 'client'}`}
      subtitle={step === 'client'
        ? <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Step 1 of 2 — choose the client login. Attaching {clips.length} recording{clips.length === 1 ? '' : 's'}.</span>
        : <button onClick={() => { setStep('client'); setChosenClient(null); }} className="text-xs inline-flex items-center gap-1" style={{ color: 'var(--color-primary-600)' }}><ChevronLeft size={13} /> back to clients</button>}>
      {step === 'client' ? (
        <>
          <div className="relative mb-3">
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
            <input autoFocus value={clientQ} onChange={e => setClientQ(e.target.value)} placeholder="Search client logins…" style={{ ...inp, paddingLeft: 32, width: '100%' }} />
          </div>
          {clientsLoading ? <div className="text-center py-6"><Loader2 className="animate-spin inline" style={{ color: 'var(--color-text-tertiary)' }} /></div>
            : filteredClients.length === 0 ? <div className="text-center py-6 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No client logins found.</div>
            : <div className="space-y-1.5 max-h-80 overflow-y-auto">
                {filteredClients.map(c => (
                  <button key={c.id} onClick={() => pickClient(c)} className="w-full text-left flex items-center gap-3 p-2.5 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', opacity: c.is_active ? 1 : 0.55 }}>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>{c.name}{!c.is_active && <span className="text-[10px] font-bold" style={{ color: 'var(--color-error-600)' }}>· inactive</span>}</div>
                      <div className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>{c.login_email}</div>
                      <div className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                        {(c.closer_names || []).length ? `${c.closer_names.length} closer${c.closer_names.length === 1 ? '' : 's'}` : ''}
                        {(c.closer_names || []).length && (c.client_names || []).length ? ' · ' : ''}
                        {(c.client_names || []).length ? c.client_names.join(', ') : ''}
                      </div>
                    </div>
                    <ChevronRight size={16} style={{ color: 'var(--color-primary-600)' }} />
                  </button>
                ))}
              </div>}
        </>
      ) : (
        <>
          <div className="relative mb-3">
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
            <input autoFocus value={saleQ} onChange={e => setSaleQ(e.target.value)} placeholder="Search this client’s sales — name, phone, ref" style={{ ...inp, paddingLeft: 32, width: '100%' }} />
          </div>
          {salesLoading ? <div className="text-center py-6"><Loader2 className="animate-spin inline" style={{ color: 'var(--color-text-tertiary)' }} /></div>
            : sales.length === 0 ? <div className="text-center py-6 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No sales visible to this client{saleQ ? ' for that search' : ''}.</div>
            : <div className="space-y-1.5 max-h-80 overflow-y-auto">
                {sales.map(r => (
                  <button key={r.sale_id} onClick={() => attach(r)} disabled={saving} className="w-full text-left flex items-center gap-3 p-2.5 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{r.customer_name || '—'} {r.confirmed && <span className="text-[10px] font-bold" style={{ color: 'var(--color-success-600)' }}>· has {r.clip_count} clip{r.clip_count === 1 ? '' : 's'}</span>}</div>
                      <div className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>{r.customer_phone} · {r.closer_name || '—'} · {fmtDate(r.sale_date)}{r.client_name ? ` · ${r.client_name}` : ''}</div>
                    </div>
                    {saving === r.sale_id ? <Loader2 size={16} className="animate-spin" style={{ color: 'var(--color-primary-600)' }} /> : <Link2 size={16} style={{ color: 'var(--color-primary-600)' }} />}
                  </button>
                ))}
              </div>}
        </>
      )}
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
      // Y3: total comes back only on page 1 (null on later pages) — keep the
      // page-1 total across pages so pagination controls don't collapse.
      setRows(r.data.queue || []); setTotal(t => (r.data.total == null ? t : (r.data.total || 0)));
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
            <input value={filters.search} onChange={e => setF('search', e.target.value)} placeholder="Search anything — name, phone, closer, company, product, ref, code, rec id" style={{ ...inp, paddingLeft: 30, minWidth: 340 }} />
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
      <p className="text-[11px] -mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
        Searching a recording id here matches <b>confirmed</b> sales (a pending sale has no recording linked yet). To pull a recording straight off the dialers by <b>lead id</b>, <b>phone</b>, or <b>recording id</b>, use the <b>Dialer Search</b> tab.
      </p>

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
                <td className="px-3 py-2 font-medium" style={{ color: 'var(--color-text)' }}>
                  {r.customer_name || '—'}
                  {r.recording_ids && <div className="text-[10px] font-mono mt-0.5 truncate max-w-[220px]" title={r.recording_ids} style={{ color: 'var(--color-text-tertiary)' }}>rec {r.recording_ids}</div>}
                </td>
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
          {[['queue', 'Review Queue'], ['phone', 'Dialer Search']].map(([k, label]) => (
            <button key={k} onClick={() => setMode(k)} className="text-xs font-semibold px-3 py-1.5"
              style={{ background: mode === k ? 'var(--gradient-sidebar)' : 'transparent', color: mode === k ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)' }}>{label}</button>
          ))}
        </div>
      </div>
      {mode === 'queue' ? <QueueView companyList={companyList} /> : <PhoneSearchView />}
    </div>
  );
}
