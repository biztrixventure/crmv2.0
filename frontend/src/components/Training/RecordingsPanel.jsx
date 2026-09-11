// ============================================================================
// RecordingsPanel -- training calls, listened to in place.
//
// One <audio controls> per card rather than a shared player at the top: a
// trainee compares two calls by flipping between them, and a single player
// makes that a two-step (pick, then press play) every time. The browser's own
// controls are deliberate -- they carry scrubbing, speed and keyboard support
// that a hand-rolled transport would have to re-earn.
//
// `preload="none"` matters. A page of ten calls with the default preload pulls
// ten files the moment the tab opens; agents on a shared office line notice.
//
// This is NOT the QA call player. That one streams VICIdial recordings through
// a ticket-authenticated proxy (backend/routes/qaMedia.js) because those files
// live on the dialer; these are uploaded to our own bucket and are plain URLs.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { Headphones, CheckCircle2, Check, Search, Clock } from 'lucide-react';
import client from '../../api/client';
import { EmptyState, Loading, PillTabs, accent } from '../UI/kit';

const clock = (s) => {
  if (!s || s < 0) return '';
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
};

export default function RecordingsPanel({ companyId, done, onOpen, onFinish }) {
  const [recs, setRecs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');

  useEffect(() => {
    let dead = false;
    setLoading(true);
    const params = companyId ? `?company_id=${companyId}` : '';
    client.get(`training/recordings${params}`)
      .then(r => { if (!dead) setRecs(r.data.recordings || []); })
      .catch(() => { if (!dead) setRecs([]); })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [companyId]);

  const categories = useMemo(() => {
    const seen = [...new Set(recs.map(r => r.category).filter(Boolean))];
    return seen.length > 1 ? [{ key: 'all', label: 'All' }, ...seen.map(c => ({ key: c, label: c }))] : [];
  }, [recs]);

  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => recs.filter(r =>
    (cat === 'all' || r.category === cat)
    && (!needle || `${r.title} ${r.description || ''}`.toLowerCase().includes(needle))
  ), [recs, cat, needle]);

  if (loading) return <Loading variant="rows" rows={4} label="Loading the recordings" />;

  const a = accent('info');

  return (
    <div className="space-y-4">
      {(categories.length > 0 || recs.length > 6) && (
        <div className="flex flex-wrap items-center gap-3">
          {categories.length > 0 && <PillTabs items={categories} value={cat} onChange={setCat} />}
          {recs.length > 6 && (
            <div className="relative" style={{ maxWidth: 300, flex: 1 }}>
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--color-text-tertiary)' }} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search recordings…"
                className="input text-sm py-2 pl-9 w-full" />
            </div>
          )}
        </div>
      )}

      {shown.length === 0 ? (
        <EmptyState icon={Headphones}
          title={recs.length ? 'Nothing matches that' : 'No recordings yet'}
          hint={recs.length
            ? 'Clear the search or pick another category.'
            : 'Your manager uploads training calls under Manage → Recordings.'} />
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
          {shown.map(r => {
            const finished = done?.has(`recording:${r.id}`);
            return (
              <div key={r.id} className="rounded-2xl p-4"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <div className="flex items-start gap-3">
                  <span className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: a.soft }}>
                    <Headphones size={18} style={{ color: a.fg }} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold m-0 leading-snug" style={{ color: 'var(--color-text)' }}>
                      {r.title}
                    </p>
                    {r.description && (
                      <p className="text-[11px] m-0 mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                        {r.description}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      {r.category && (
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                          style={{ background: a.soft, color: a.fg }}>{r.category}</span>
                      )}
                      {r.duration_sec ? (
                        <span className="text-[10px] flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}>
                          <Clock size={10} /> {clock(r.duration_sec)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {finished && (
                    <CheckCircle2 size={18} style={{ color: 'var(--color-success-600)' }} className="flex-shrink-0" />
                  )}
                </div>

                {/* preload="none" -- see the header. onPlay records the open;
                    onEnded is what actually means "listened to it", so the
                    trainee never has to remember to tick anything. */}
                <audio
                  src={r.file_url}
                  controls
                  preload="none"
                  className="w-full mt-3"
                  onPlay={() => onOpen?.(r.id)}
                  onEnded={() => onFinish?.(r.id)}
                />

                {!finished && (
                  <button onClick={() => onFinish?.(r.id)}
                    className="text-[11px] font-semibold mt-2 flex items-center gap-1"
                    style={{ color: 'var(--color-success-600)' }}>
                    <Check size={12} /> Mark as listened
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
