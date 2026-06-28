import { useState, useRef, useEffect } from 'react';
import { DownloadCloud, Loader2, X, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const GAP_SEC = 15;     // pause between batches (gentle on the dialers)
const BATCH   = 20;     // records per batch
const DAYS    = 2;      // window: last 2 days

// Compliance: walk EVERY transfer in the last 2 days (all companies), one paced
// batch at a time with a 15s gap, fetching each closer disposition. Shows live
// progress + lists the numbers whose dispo couldn't be found, with the reason.
export default function FetchAllDisposButton({ onDone }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}
        title="Fetch every undisposed transfer's disposition (all companies, last 2 days, paced)"
        className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg"
        style={{ background: 'var(--gradient-sidebar)', color: 'white' }}>
        <DownloadCloud size={14} /> Fetch all dispos
      </button>
      {open && <FetchAllModal onClose={() => { setOpen(false); onDone?.(); }} />}
    </>
  );
}

function FetchAllModal({ onClose }) {
  const [total, setTotal]       = useState(0);
  const [processed, setProcessed] = useState(0);
  const [stats, setStats]       = useState({ fetched: 0, already: 0, notfound: 0 });
  const [notFound, setNotFound] = useState([]);
  const [running, setRunning]   = useState(true);
  const [wait, setWait]         = useState(0);
  const stopRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let off = 0, tot = null;
      try {
        while (!stopRef.current) {
          const { data } = await client.post('vicidial/fetch-all-dispos', { days: DAYS, offset: off, batch: BATCH, total: tot });
          if (cancelled) return;
          tot = data.total; setTotal(data.total);
          setProcessed(p => p + data.processed);
          setStats(s => ({ fetched: s.fetched + data.fetched, already: s.already + data.already, notfound: s.notfound + data.notfound }));
          const miss = (data.results || []).filter(x => x.status === 'not_found');
          if (miss.length) setNotFound(nf => [...nf, ...miss]);
          if (data.next_offset == null) break;
          off = data.next_offset;
          for (let s = GAP_SEC; s > 0 && !stopRef.current; s--) { setWait(s); await sleep(1000); if (cancelled) return; }
          setWait(0);
        }
      } catch (e) {
        if (!cancelled) toast.error(e.response?.data?.error || 'Fetch failed');
      }
      if (!cancelled) setRunning(false);
    })();
    return () => { cancelled = true; stopRef.current = true; };
  }, []);

  const pct = total ? Math.round((processed / total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="w-full max-w-lg rounded-2xl p-5 max-h-[88vh] flex flex-col" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <DownloadCloud size={18} /> Fetch all dispositions — last {DAYS} days
          </h3>
          <button onClick={() => { stopRef.current = true; onClose(); }} className="p-1.5 rounded-lg hover:bg-bg-secondary"><X size={16} /></button>
        </div>

        {/* progress */}
        <div className="mb-3">
          <div className="flex items-center justify-between text-xs mb-1" style={{ color: 'var(--color-text-secondary)' }}>
            <span>{processed} / {total} records</span>
            <span className="flex items-center gap-1">
              {running ? (wait > 0 ? <><Clock size={12} /> next batch in {wait}s</> : <><Loader2 size={12} className="animate-spin" /> fetching…</>) : 'Done'}
            </span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-bg-secondary)' }}>
            <div className="h-full transition-all" style={{ width: `${pct}%`, background: 'var(--gradient-sidebar)' }} />
          </div>
        </div>

        {/* counts */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <Stat icon={CheckCircle2} color="var(--color-success-600)" n={stats.fetched} label="Fetched" />
          <Stat icon={DownloadCloud} color="var(--color-text-tertiary)" n={stats.already} label="Already had" />
          <Stat icon={AlertTriangle} color="#d97706" n={stats.notfound} label="Not found" />
        </div>

        {/* not-found list with reasons */}
        <div className="flex-1 overflow-y-auto rounded-xl p-2" style={{ background: 'var(--color-bg-secondary)', minHeight: 80 }}>
          {notFound.length === 0 ? (
            <p className="text-xs italic p-2" style={{ color: 'var(--color-text-tertiary)' }}>
              {running ? 'Working… numbers with no dispo will be listed here.' : 'No missing dispositions — every record was fetched or already had one. ✅'}
            </p>
          ) : (
            <>
              <p className="text-[11px] font-bold uppercase tracking-wide px-1 pb-1" style={{ color: 'var(--color-text-secondary)' }}>No disposition found ({notFound.length})</p>
              {notFound.map((m, i) => (
                <div key={i} className="px-2 py-1.5 rounded-lg mb-1 text-xs" style={{ background: 'var(--color-surface)' }}>
                  <span className="font-semibold tabular-nums" style={{ color: 'var(--color-text)' }}>{m.phone}</span>
                  {m.name ? <span style={{ color: 'var(--color-text-tertiary)' }}> · {m.name}</span> : null}
                  <div style={{ color: '#b45309' }}>{m.reason}</div>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-3">
          {running
            ? <button onClick={() => { stopRef.current = true; setRunning(false); }} className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: 'var(--color-error-50)', color: 'var(--color-error-600)', border: '1px solid var(--color-error-200,#fecaca)' }}>Stop</button>
            : <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: 'var(--gradient-sidebar)', color: 'white' }}>Close</button>}
        </div>
      </div>
    </div>
  );
}

const Stat = ({ icon: Icon, color, n, label }) => (
  <div className="rounded-xl p-2 text-center" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
    <Icon size={15} style={{ color }} className="mx-auto mb-0.5" />
    <div className="text-lg font-bold leading-none" style={{ color: 'var(--color-text)' }}>{n}</div>
    <div className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>{label}</div>
  </div>
);
