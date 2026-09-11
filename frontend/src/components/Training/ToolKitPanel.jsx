// ============================================================================
// ToolKitPanel -- the pronunciation drill.
//
// Two lists, one treatment. Cars come LIVE from the form builder catalog
// (vehicle_makes / vehicle_models) so a trainee is always practising the names
// the form actually offers; customer names come from an uploaded list. Both
// render as the same card, because the skill being practised is the same one.
//
// THE HIGHLIGHT is the point of the screen. The browser's speech engine fires
// `onboundary` as it reaches each word, and useSpeech turns that into an index;
// the card lights that word. For a single-word term there is only ever one
// boundary, so the card lights the whole word for the utterance instead of
// blinking a lone highlight on and off -- the feedback has to read the same
// either way.
// ============================================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Volume2, Car, Users, Search, Play, Square, Gauge, Rabbit, Turtle, X,
} from 'lucide-react';
import client from '../../api/client';
import { Panel, PillTabs, EmptyState, Loading, IconButton, accent } from '../UI/kit';
import Select from '../UI/Select';
import useSpeech, { syllabify } from './useSpeech';

// ── one term, lit word by word while the voice moves through it ──────────────
function SpokenText({ text, active, wordIndex }) {
  const parts = useMemo(() => String(text || '').split(/(\s+)/), [text]);
  const wordCount = useMemo(() => parts.filter(p => !/^\s+$/.test(p)).length, [parts]);
  let wi = -1;
  return (
    <span>
      {parts.map((w, i) => {
        if (/^\s+$/.test(w)) return <span key={i}>{w}</span>;
        wi += 1;
        // A one-word term produces exactly one boundary event, so "the word
        // being spoken" and "this card is speaking" are the same thing.
        const lit = active && (wordCount === 1 || wordIndex === wi);
        return (
          <span key={i}
            style={{
              borderRadius: 4,
              padding: lit ? '0 3px' : 0,
              margin: lit ? '0 -3px' : 0,
              background: lit ? 'var(--color-primary-100)' : 'transparent',
              color: lit ? 'var(--color-primary-700)' : 'inherit',
              transition: 'background 120ms linear, color 120ms linear',
            }}>
            {w}
          </span>
        );
      })}
    </span>
  );
}

// ── the dictionary card ──────────────────────────────────────────────────────
function PronounceCard({ id, term, sub, phonetic, speech, onPlayed }) {
  const active = speech.speakingId === id;
  const a = accent('primary');

  // A manager's own phonetic hint always wins. The generated syllable split is
  // a fallback so an unfamiliar name still shows someone where to break it.
  const guide = phonetic || syllabify(term).join('-');

  const play = (rate) => {
    speech.speak(term, { id, rate });
    onPlayed?.();
  };

  return (
    <div
      className="rounded-2xl p-4 transition-all h-full"
      style={{
        background: 'var(--color-surface)',
        border: `1px solid ${active ? 'var(--color-primary-400, #818cf8)' : 'var(--color-border)'}`,
        boxShadow: active ? '0 0 0 3px color-mix(in srgb, var(--color-primary-600) 14%, transparent)' : 'none',
      }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg font-bold m-0 leading-tight" style={{ color: 'var(--color-text)' }}>
            <SpokenText text={term} active={active} wordIndex={speech.wordIndex} />
          </p>
          {guide && guide.toLowerCase() !== term.toLowerCase() && (
            <p className="text-xs m-0 mt-0.5 font-mono tracking-wide"
              style={{ color: 'var(--color-text-tertiary)' }}>{guide}</p>
          )}
          {sub && (
            <p className="text-[11px] m-0 mt-1 truncate" style={{ color: 'var(--color-text-secondary)' }}>{sub}</p>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <IconButton label={`Say ${term} slowly`} title="Say it slowly" onClick={() => play(0.6)}>
            <Turtle size={15} />
          </IconButton>
          <button
            onClick={() => (active ? speech.stop() : play())}
            title={active ? 'Stop' : 'Say it'}
            aria-label={active ? `Stop ${term}` : `Pronounce ${term}`}
            className="w-9 h-9 rounded-full flex items-center justify-center transition-colors flex-shrink-0"
            style={{ background: active ? a.fg : a.soft, color: active ? '#fff' : a.fg }}>
            {active ? <Square size={14} fill="currentColor" /> : <Volume2 size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── voice + speed, once for the whole panel ──────────────────────────────────
function VoiceBar({ speech, onPractice, practising, count }) {
  if (!speech.supported) {
    return (
      <Panel tone="inset" radius="xl" pad="md">
        <p className="text-xs m-0" style={{ color: 'var(--color-warning-700, #b45309)' }}>
          This browser cannot speak. Chrome, Edge and Safari all can — open the Tool Kit in one of those
          and the pronunciation buttons will work.
        </p>
      </Panel>
    );
  }
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div style={{ minWidth: 210 }}>
        <label className="text-[10px] font-bold uppercase tracking-wider block mb-1"
          style={{ color: 'var(--color-text-secondary)' }}>Voice</label>
        <Select value={speech.voiceURI} onChange={(e) => speech.setVoice(e.target.value)}>
          {speech.voices.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>)}
        </Select>
      </div>
      <div>
        <span className="text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1"
          style={{ color: 'var(--color-text-secondary)' }}>
          <Gauge size={11} /> Speed · {speech.rate.toFixed(2)}×
        </span>
        <div className="flex items-center gap-2 h-9">
          <Turtle size={13} style={{ color: 'var(--color-text-tertiary)' }} />
          <input type="range" min="0.5" max="1.5" step="0.05" value={speech.rate}
            onChange={(e) => speech.setRate(parseFloat(e.target.value))}
            aria-label="Speaking speed"
            style={{ accentColor: 'var(--color-primary-600)', width: 120 }} />
          <Rabbit size={13} style={{ color: 'var(--color-text-tertiary)' }} />
        </div>
      </div>
      <button
        onClick={onPractice}
        disabled={!count}
        className="h-9 px-3.5 rounded-lg text-xs font-bold flex items-center gap-1.5 disabled:opacity-40"
        style={{
          background: practising ? 'var(--color-error-600)' : 'var(--color-primary-600)',
          color: '#fff',
        }}>
        {practising
          ? <><Square size={12} fill="currentColor" /> Stop</>
          : <><Play size={12} /> Practise all{count ? ` (${count})` : ''}</>}
      </button>
      {speech.voices.length === 0 && (
        <p className="text-[11px] m-0 self-center" style={{ color: 'var(--color-text-tertiary)' }}>
          Loading voices…
        </p>
      )}
    </div>
  );
}

// ── the panel ────────────────────────────────────────────────────────────────
export default function ToolKitPanel({ companyId, onProgress }) {
  const speech = useSpeech();
  const [tab, setTab] = useState('cars');
  const [loading, setLoading] = useState(true);
  const [makes, setMakes] = useState([]);
  const [extras, setExtras] = useState([]);
  const [names, setNames] = useState([]);
  const [makeId, setMakeId] = useState('');
  const [q, setQ] = useState('');
  const [practising, setPractising] = useState(false);
  const cancelPractice = useRef(null);

  useEffect(() => {
    let dead = false;
    setLoading(true);
    const kind = tab === 'names' ? 'name' : 'vehicle';
    const params = new URLSearchParams({ kind });
    if (companyId) params.set('company_id', companyId);
    client.get(`training/toolkit?${params.toString()}`)
      .then(r => {
        if (dead) return;
        if (kind === 'name') setNames(r.data.names || []);
        else { setMakes(r.data.makes || []); setExtras(r.data.extras || []); }
      })
      .catch(() => { if (!dead) { setMakes([]); setExtras([]); setNames([]); } })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [tab, companyId]);

  // Stop the voice when the tab changes or the panel closes -- a drill that
  // keeps talking over the next screen is the thing people hate most about
  // audio in a web app.
  const stopRef = useRef(speech.stop);
  stopRef.current = speech.stop;
  useEffect(() => () => { cancelPractice.current?.(); stopRef.current(); }, [tab]);

  const selectedMake = useMemo(() => makes.find(m => m.id === makeId) || null, [makes, makeId]);
  const needle = q.trim().toLowerCase();

  // What the grid shows right now. Searching looks across every make and model
  // at once (that is what someone typing a half-remembered name wants); with no
  // search it is the picked make's models, or the makes themselves.
  const cards = useMemo(() => {
    if (tab === 'names') {
      return names
        .filter(n => !needle || n.term.toLowerCase().includes(needle))
        .map(n => ({ id: `name-${n.id}`, term: n.term, phonetic: n.phonetic, sub: n.note }));
    }

    const extraCards = extras
      .filter(e => !needle || e.term.toLowerCase().includes(needle))
      .map(e => ({ id: `extra-${e.id}`, term: e.term, phonetic: e.phonetic, sub: e.note || 'Added by your manager' }));

    if (needle) {
      const hits = [];
      for (const m of makes) {
        const makeHit = m.name.toLowerCase().includes(needle);
        if (makeHit) hits.push({ id: `make-${m.id}`, term: m.name, sub: 'Make' });
        for (const mo of m.models) {
          if (makeHit || mo.name.toLowerCase().includes(needle)) {
            hits.push({ id: `model-${mo.id}`, term: `${m.name} ${mo.name}`, sub: `${m.name} · model` });
          }
        }
        if (hits.length > 300) break;
      }
      return [...extraCards, ...hits].slice(0, 300);
    }

    if (selectedMake) {
      return [
        { id: `make-${selectedMake.id}`, term: selectedMake.name, sub: 'Make' },
        ...selectedMake.models.map(mo => ({
          id: `model-${mo.id}`, term: `${selectedMake.name} ${mo.name}`, sub: `${selectedMake.name} · model`,
        })),
      ];
    }
    return [...extraCards, ...makes.map(m => ({
      id: `make-${m.id}`, term: m.name, sub: `${m.models.length} model${m.models.length === 1 ? '' : 's'}`,
    }))];
  }, [tab, names, makes, extras, needle, selectedMake]);

  const practice = () => {
    if (practising) { cancelPractice.current?.(); setPractising(false); return; }
    setPractising(true);
    // Capped: a full catalog read aloud is 40 minutes of audio nobody asked for.
    cancelPractice.current = speech.speakSequence(
      cards.slice(0, 60).map(c => ({ id: c.id, text: c.term })),
      { onDone: () => setPractising(false) },
    );
    onProgress?.();
  };

  const showDrillLink = tab === 'cars' && !needle && !selectedMake;

  return (
    <div className="space-y-4">
      <PillTabs
        value={tab}
        onChange={(k) => { cancelPractice.current?.(); setPractising(false); setQ(''); setMakeId(''); setTab(k); }}
        items={[
          { key: 'cars',  label: 'Car makes & models', icon: Car },
          { key: 'names', label: 'Customer names',     icon: Users },
        ]} />

      <VoiceBar speech={speech} onPractice={practice} practising={practising} count={cards.length} />

      <div className="flex items-center gap-2">
        <div className="relative flex-1" style={{ maxWidth: 420 }}>
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--color-text-tertiary)' }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tab === 'names' ? 'Search names…' : 'Search any make or model…'}
            className="input text-sm py-2 pl-9 pr-8 w-full" />
          {q && (
            <button onClick={() => setQ('')} aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2">
              <X size={14} style={{ color: 'var(--color-text-tertiary)' }} />
            </button>
          )}
        </div>
        {tab === 'cars' && selectedMake && !needle && (
          <button onClick={() => setMakeId('')}
            className="text-xs font-semibold px-3 h-9 rounded-lg"
            style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
            ← All makes
          </button>
        )}
      </div>

      {loading ? <Loading variant="rows" rows={4} label="Loading the word list" /> : (
        cards.length === 0 ? (
          <EmptyState icon={Volume2}
            title={needle ? 'Nothing matches that' : (tab === 'names' ? 'No names uploaded yet' : 'No vehicles configured yet')}
            hint={needle
              ? 'Try a shorter spelling — the search matches any part of a make or model.'
              : (tab === 'names'
                ? 'Your manager uploads the customer-name list under Manage → Tool Kit.'
                : 'Makes and models come from the vehicle catalog in the form builder.')} />
        ) : (
          <>
            {showDrillLink && (
              <p className="text-xs m-0" style={{ color: 'var(--color-text-secondary)' }}>
                Tap a make to hear it, or open one to drill its models.
              </p>
            )}
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
              {cards.map(c => (
                <div key={c.id}>
                  <PronounceCard id={c.id} term={c.term} sub={c.sub} phonetic={c.phonetic}
                    speech={speech} onPlayed={onProgress} />
                  {showDrillLink && c.id.startsWith('make-') && (
                    <button onClick={() => setMakeId(c.id.slice(5))}
                      className="text-[11px] font-semibold mt-1 ml-1"
                      style={{ color: 'var(--color-primary-600)' }}>
                      Drill its models →
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        )
      )}
    </div>
  );
}
