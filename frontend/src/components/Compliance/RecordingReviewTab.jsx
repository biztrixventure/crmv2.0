import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Clock, Play, Pause, Loader2, CheckCircle2, Circle, X, Search, RefreshCw,
  Phone, User, Calendar, Headphones, ChevronLeft, ChevronRight, ShieldCheck, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';

// ── Compliance recording review ──────────────────────────────────────────────
// Queue of "coded + mapped" sales with no confirmed recording yet. The reviewer
// opens a sale, hears every candidate leg (fronter + closer + redials), and
// confirms the one (or several, for a split call) the client portal should play.
// Only a lightweight reference is stored — never the audio.
const PAGE = 50;
const fmtDur  = (s) => { if (!s && s !== 0) return '—'; const m = Math.floor(s / 60), r = Math.floor(s % 60); return `${m}:${String(r).padStart(2, '0')}`; };
const fmtDate = (d) => { try { return d ? new Date(String(d).length <= 10 ? d + 'T00:00:00' : d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''; } catch { return d || ''; } };
const fmtTime = (s) => { try { return s ? new Date(String(s).replace(' ', 'T')).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; } catch { return s || ''; } };

function AgentChip({ c }) {
  const kind = c.is_closer_agent ? 'Closer' : (c.agent_role === 'fronter' || c.agent_role === 'fronter_manager' ? 'Fronter' : 'Agent');
  const color = kind === 'Closer' ? 'var(--color-success-600)' : kind === 'Fronter' ? 'var(--color-warning-600)' : 'var(--color-text-tertiary)';
  return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface-hover)', color }}>{kind}</span>;
}

export default function RecordingReviewTab({ companyList = [] }) {
  const [filters, setFilters] = useState({ date_from: '', date_to: '', company_id: '', closer_id: '' });
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(null);   // sale row being reviewed

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: PAGE, offset };
      for (const k of ['date_from', 'date_to', 'company_id', 'closer_id']) if (filters[k]) params[k] = filters[k];
      const r = await client.get('compliance/recordings/queue', { params });
      setRows(r.data.queue || []);
      setTotal(r.data.total || 0);
    } catch (e) { toast.error(e.response?.data?.error || 'Could not load the review queue'); setRows([]); }
    finally { setLoading(false); }
  }, [filters, offset]);
  useEffect(() => { load(); }, [load]);

  // closer options derived from what's actually pending
  const closerOptions = useMemo(() => {
    const m = new Map();
    for (const r of rows) if (r.closer_id) m.set(r.closer_id, r.closer_name || r.closer_id);
    return [...m.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  }, [rows]);

  const setF = (k, v) => { setOffset(0); setFilters(f => ({ ...f, [k]: v })); };
  const onConfirmed = (saleId) => { setRows(rs => rs.filter(r => r.sale_id !== saleId)); setTotal(t => Math.max(0, t - 1)); setActive(null); };

  const from = total ? offset + 1 : 0;
  const to = Math.min(offset + PAGE, total);

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex items-center gap-2 flex-wrap">
        <Headphones size={18} style={{ color: 'var(--color-primary-600)' }} />
        <h2 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>Recording Review</h2>
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}>
          {total} pending
        </span>
        <button onClick={load} className="ml-auto p-2 rounded-lg" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }} title="Refresh">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} style={{ color: 'var(--color-text-secondary)' }} />
        </button>
      </div>

      {/* filters — calendar-based browsing */}
      <div className="flex items-end gap-3 flex-wrap p-3 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <Field label="From"><input type="date" value={filters.date_from} onChange={e => setF('date_from', e.target.value)} className="input-date" style={inp} /></Field>
        <Field label="To"><input type="date" value={filters.date_to} onChange={e => setF('date_to', e.target.value)} style={inp} /></Field>
        <Field label="Company">
          <select value={filters.company_id} onChange={e => setF('company_id', e.target.value)} style={inp}>
            <option value="">All companies</option>
            {companyList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Closer (pending)">
          <select value={filters.closer_id} onChange={e => setF('closer_id', e.target.value)} style={inp}>
            <option value="">All closers</option>
            {closerOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </Field>
        {(filters.date_from || filters.date_to || filters.company_id || filters.closer_id) && (
          <button onClick={() => { setOffset(0); setFilters({ date_from: '', date_to: '', company_id: '', closer_id: '' }); }}
            className="text-xs font-semibold px-3 py-2 rounded-lg" style={{ color: 'var(--color-text-secondary)' }}>Clear</button>
        )}
      </div>

      {/* queue */}
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}>
              {['Sale date', 'Customer', 'Phone', 'Closer', 'Company', ''].map((h, i) => (
                <th key={i} className="text-left font-semibold px-3 py-2 text-xs">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-12"><Loader2 className="animate-spin inline" style={{ color: 'var(--color-text-tertiary)' }} /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-12 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
                <ShieldCheck size={26} className="inline mb-2" /><div>No sales pending review{Object.values(filters).some(Boolean) ? ' for these filters' : ''}.</div>
              </td></tr>
            ) : rows.map(r => {
              const co = companyList.find(c => c.id === r.company_id);
              return (
                <tr key={r.sale_id} className="border-t hover:bg-black/[0.02] cursor-pointer" style={{ borderColor: 'var(--color-border)' }} onClick={() => setActive(r)}>
                  <td className="px-3 py-2" style={{ color: 'var(--color-text)' }}>{fmtDate(r.sale_date)}</td>
                  <td className="px-3 py-2 font-medium" style={{ color: 'var(--color-text)' }}>{r.customer_name || '—'}</td>
                  <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{r.customer_phone || '—'}</td>
                  <td className="px-3 py-2" style={{ color: 'var(--color-text-secondary)' }}>{r.closer_name || '—'}</td>
                  <td className="px-3 py-2" style={{ color: 'var(--color-text-secondary)' }}>{co?.name || '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <button className="text-xs font-bold px-3 py-1.5 rounded-lg" style={{ background: 'var(--gradient-sidebar)', color: 'var(--color-text-inverse)' }}>Review</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* pager */}
      {total > PAGE && (
        <div className="flex items-center justify-between text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          <span>{from}–{to} of {total}</span>
          <div className="flex gap-2">
            <button disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - PAGE))} className="p-1.5 rounded-lg disabled:opacity-40" style={{ border: '1px solid var(--color-border)' }}><ChevronLeft size={15} /></button>
            <button disabled={to >= total} onClick={() => setOffset(o => o + PAGE)} className="p-1.5 rounded-lg disabled:opacity-40" style={{ border: '1px solid var(--color-border)' }}><ChevronRight size={15} /></button>
          </div>
        </div>
      )}

      {active && <ReviewModal sale={active} onClose={() => setActive(null)} onConfirmed={onConfirmed} />}
    </div>
  );
}

const inp = { background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)', borderRadius: 8, padding: '6px 10px', fontSize: 13 };
function Field({ label, children }) {
  return <label className="flex flex-col gap-1"><span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>{label}</span>{children}</label>;
}

// ── review modal ─────────────────────────────────────────────────────────────
function ReviewModal({ sale, onClose, onConfirmed }) {
  const [data, setData] = useState(null);       // { sale, candidates, existing }
  const [loading, setLoading] = useState(true);
  const [chosen, setChosen] = useState([]);     // ordered recording_ids
  const [saving, setSaving] = useState(false);
  const [playing, setPlaying] = useState(null); // recording_id currently playing
  const [audioLoad, setAudioLoad] = useState(null);
  const [phoneQ, setPhoneQ] = useState('');
  const [extra, setExtra] = useState([]);       // phone-search results merged in
  const [searching, setSearching] = useState(false);
  const audioRef = useRef(null);
  const urlRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await client.get('compliance/recordings/candidates', { params: { sale_id: sale.sale_id } });
      setData(r.data);
      setChosen((r.data.existing || []).sort((a, b) => a.clip_order - b.clip_order).map(c => c.recording_id));
    } catch (e) { toast.error(e.response?.data?.error || 'Could not load candidates'); }
    finally { setLoading(false); }
  }, [sale.sale_id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const candidates = useMemo(() => {
    const seen = new Set(); const out = [];
    for (const c of [...(data?.candidates || []), ...extra]) { const k = c.box_id + '|' + c.recording_id; if (!seen.has(k)) { seen.add(k); out.push(c); } }
    return out.sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
  }, [data, extra]);
  const byId = useMemo(() => new Map(candidates.map(c => [c.recording_id, c])), [candidates]);

  const play = async (c) => {
    const a = audioRef.current; if (!a) return;
    if (playing === c.recording_id && !a.paused) { a.pause(); return; }
    if (byId.get(c.recording_id) && a.dataset.rid === c.recording_id) { a.play().catch(() => {}); return; }
    setAudioLoad(c.recording_id);
    try {
      const res = await client.get('compliance/recordings/stream', {
        params: { box_id: c.box_id, lead_id: c.lead_id, recording_id: c.recording_id, location: c.location },
        responseType: 'blob',
      });
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(res.data); urlRef.current = url;
      a.src = url; a.dataset.rid = c.recording_id; a.load(); a.play().catch(() => {});
    } catch { toast.error('Could not load that recording'); }
    finally { setAudioLoad(null); }
  };

  const toggle = (rid) => setChosen(cs => cs.includes(rid) ? cs.filter(x => x !== rid) : [...cs, rid]);

  const confirm = async () => {
    if (!chosen.length) { toast.error('Select at least one recording'); return; }
    setSaving(true);
    try {
      const clips = chosen.map(rid => byId.get(rid)).filter(Boolean).map(c => ({
        box_id: c.box_id, lead_id: c.lead_id, recording_id: c.recording_id, location: c.location,
        agent_user: c.agent_user, start_time: c.start_time, duration: c.duration,
      }));
      await client.post('compliance/recordings/confirm', { sale_id: sale.sale_id, clips });
      toast.success(`Confirmed ${clips.length} recording${clips.length === 1 ? '' : 's'} for ${sale.customer_name || 'this sale'}`);
      onConfirmed(sale.sale_id);
    } catch (e) { toast.error(e.response?.data?.error || 'Could not confirm'); }
    finally { setSaving(false); }
  };

  const unconfirm = async () => {
    setSaving(true);
    try { await client.delete(`compliance/recordings/confirm/${sale.sale_id}`); toast.success('Sent back to pending'); onConfirmed(sale.sale_id); }
    catch (e) { toast.error(e.response?.data?.error || 'Could not clear'); }
    finally { setSaving(false); }
  };

  const searchPhone = async () => {
    const digits = phoneQ.replace(/\D/g, ''); if (digits.length < 4) { toast.error('Enter at least 4 digits'); return; }
    setSearching(true);
    try {
      const r = await client.get('compliance/recordings/candidates', { params: { phone: digits } });
      setExtra(r.data.candidates || []);
      if (!(r.data.candidates || []).length) toast.info('No recordings found for that number');
    } catch (e) { toast.error(e.response?.data?.error || 'Search failed'); }
    finally { setSearching(false); }
  };

  const hadExisting = (data?.existing || []).length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl overflow-hidden" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }} onClick={e => e.stopPropagation()}>
        {/* header */}
        <div className="flex items-start gap-3 p-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="min-w-0 flex-1">
            <div className="font-bold" style={{ color: 'var(--color-text)' }}>{sale.customer_name || '—'}</div>
            <div className="flex items-center gap-3 text-xs mt-0.5 flex-wrap" style={{ color: 'var(--color-text-secondary)' }}>
              <span className="flex items-center gap-1"><Phone size={11} />{sale.customer_phone || '—'}</span>
              <span className="flex items-center gap-1"><Calendar size={11} />{fmtDate(sale.sale_date)}</span>
              <span className="flex items-center gap-1"><User size={11} />{sale.closer_name || '—'}</span>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg" style={{ color: 'var(--color-text-secondary)' }}><X size={18} /></button>
        </div>

        {/* candidates */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          <div className="text-xs font-semibold mb-1" style={{ color: 'var(--color-text-tertiary)' }}>
            Every recording on this lead — pick the actual sale call{hadExisting ? ' (currently confirmed pre-selected)' : ''}:
          </div>
          {loading ? (
            <div className="text-center py-10"><Loader2 className="animate-spin inline" style={{ color: 'var(--color-text-tertiary)' }} /></div>
          ) : candidates.length === 0 ? (
            <div className="text-center py-8 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No candidate recordings found on the dialer.</div>
          ) : candidates.map(c => {
            const on = chosen.includes(c.recording_id);
            const order = chosen.indexOf(c.recording_id) + 1;
            const isPlaying = playing === c.recording_id;
            return (
              <div key={c.box_id + c.recording_id} className="flex items-center gap-3 p-2.5 rounded-xl"
                style={{ background: on ? 'var(--color-surface-hover)' : 'var(--color-surface)', border: `1px solid ${on ? 'var(--color-primary-600)' : 'var(--color-border)'}` }}>
                <button onClick={() => play(c)} className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--gradient-sidebar)' }}>
                  {audioLoad === c.recording_id ? <Loader2 size={15} className="animate-spin" style={{ color: '#fff' }} /> : isPlaying ? <Pause size={15} style={{ color: '#fff' }} /> : <Play size={15} style={{ color: '#fff' }} />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--color-text)' }}>{fmtDur(c.duration)}</span>
                    <AgentChip c={c} />
                    <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{c.agent_name}</span>
                    {c.phone_matches && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'var(--color-success-50, rgba(22,163,74,0.1))', color: 'var(--color-success-600)' }}>phone ✓</span>}
                  </div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>{fmtTime(c.start_time)} · {c.box_id}</div>
                </div>
                <button onClick={() => toggle(c.recording_id)} className="flex-shrink-0 flex items-center gap-1" title={on ? 'Selected' : 'Select'}>
                  {on
                    ? <span className="flex items-center gap-1 text-xs font-bold" style={{ color: 'var(--color-primary-600)' }}>{chosen.length > 1 ? `#${order}` : ''}<CheckCircle2 size={20} /></span>
                    : <Circle size={20} style={{ color: 'var(--color-text-tertiary)' }} />}
                </button>
              </div>
            );
          })}

          {/* phone-search fallback */}
          <div className="pt-2 mt-2" style={{ borderTop: '1px dashed var(--color-border)' }}>
            <div className="text-[11px] font-semibold mb-1" style={{ color: 'var(--color-text-tertiary)' }}>Not here? Search the dialer by phone:</div>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
                <input value={phoneQ} onChange={e => setPhoneQ(e.target.value)} inputMode="tel" placeholder="phone number"
                  onKeyDown={e => e.key === 'Enter' && searchPhone()} style={{ ...inp, paddingLeft: 30, width: '100%' }} />
              </div>
              <button onClick={searchPhone} disabled={searching} className="text-xs font-semibold px-3 py-2 rounded-lg" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                {searching ? <Loader2 size={14} className="animate-spin" /> : 'Search'}
              </button>
            </div>
          </div>
        </div>

        {/* footer */}
        <div className="flex items-center gap-2 p-4" style={{ borderTop: '1px solid var(--color-border)' }}>
          <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{chosen.length} selected</span>
          {hadExisting && <button onClick={unconfirm} disabled={saving} className="text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1" style={{ color: 'var(--color-error-600)' }}><Trash2 size={13} /> Send back to pending</button>}
          <button onClick={confirm} disabled={saving || !chosen.length} className="ml-auto text-sm font-bold px-5 py-2 rounded-lg flex items-center gap-2 disabled:opacity-50"
            style={{ background: 'var(--gradient-sidebar)', color: 'var(--color-text-inverse)' }}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}{hadExisting ? 'Update' : 'Confirm'}
          </button>
        </div>

        <audio ref={audioRef} className="hidden" onPlay={() => setPlaying(audioRef.current?.dataset.rid || null)} onPause={() => setPlaying(null)} onEnded={() => setPlaying(null)} />
      </div>
    </div>
  );
}
