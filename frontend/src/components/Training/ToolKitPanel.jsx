// ============================================================================
// ToolKitPanel -- the pronunciation drill.
//
// Two lists, one treatment. Cars come LIVE from the form builder catalog
// (vehicle_makes / vehicle_models) so a trainee is always practising the names
// the form actually offers; customer names come from an uploaded list. Both
// render as the same card, because the skill being practised is the same one.
//
// THE HIGHLIGHT is the point of the screen, and it runs on the SYLLABLE line,
// not the plain name. Lighting "Volkswagen" whole says nothing an agent can use;
// lighting Volk, then swa, then gen while the voice says them is the thing that
// teaches the word. The plain name stays unhighlighted above it so the card is
// still readable as "what am I looking at".
//
// The browser only reports WORD boundaries, so useSpeech steps the syllables
// inside a word on a self-calibrating timer and re-syncs on every boundary --
// see the SYLLABLE TIMING note there.
// ============================================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Volume2, Car, Users, Search, Play, Square, Gauge, Rabbit, Turtle, X,
} from 'lucide-react';
import client from '../../api/client';
import { Panel, PillTabs, EmptyState, Loading, IconButton, accent } from '../UI/kit';
import Select from '../UI/Select';
import useSpeech, { syllabify } from './useSpeech';

// ── the syllable line: the thing that actually lights up ─────────────────────
function SyllableLine({ term, active, wordIndex, syllableIndex }) {
  // Same split useSpeech walks, so the highlight index always names the
  // syllable the viewer is looking at.
  const words = useMemo(
    () => String(term || '').trim().split(/\s+/).filter(Boolean).map(w => syllabify(w)),
    [term],
  );
  return (
    <span className="font-mono tracking-wide">
      {words.map((syls, wi) => (
        <span key={wi}>
          {wi > 0 && <span className="px-1.5" style={{ opacity: 0.4 }}>·</span>}
          {syls.map((sy, si) => {
            const lit = active && wi === wordIndex && si === syllableIndex;
            return (
              <span key={si}>
                {si > 0 && <span style={{ opacity: 0.35 }}>-</span>}
                <span
                  style={{
                    borderRadius: 4,
                    padding: lit ? '1px 3px' : '1px 0',
                    background: lit ? 'var(--color-primary-600)' : 'transparent',
                    color: lit ? '#fff' : 'inherit',
                    fontWeight: lit ? 700 : 400,
                    transition: 'background 90ms linear, color 90ms linear',
                  }}>
                  {sy}
                </span>
              </span>
            );
          })}
        </span>
      ))}
    </span>
  );
}

// ── the dictionary card ──────────────────────────────────────────────────────
//
// `footer` renders INSIDE the card. It used to be a sibling underneath it, and
// because the card carried h-full it filled the grid cell and pushed the footer
// out past the row -- the "Drill its models" link ended up drawn behind the card
// on the next row. Anything belonging to a card lives in the card.
function PronounceCard({ id, term, sub, phonetic, speech, onPlayed, footer }) {
  const active = speech.speakingId === id;
  const a = accent('primary');

  const play = (rate) => {
    speech.speak(term, { id, rate });
    onPlayed?.();
  };

  return (
    <div
      className="rounded-2xl p-4 transition-all h-full flex flex-col"
      style={{
        background: 'var(--color-surface)',
        border: `1px solid ${active ? 'var(--color-primary-400, #818cf8)' : 'var(--color-border)'}`,
        boxShadow: active ? '0 0 0 3px color-mix(in srgb, var(--color-primary-600) 14%, transparent)' : 'none',
      }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* The name, read but never lit -- the highlight belongs to the line
              below it, which is the one an agent is meant to follow. */}
          <p className="text-lg font-bold m-0 leading-tight" style={{ color: 'var(--color-text)' }}>
            {term}
          </p>
          <p className="text-sm m-0 mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            <SyllableLine term={term} active={active}
              wordIndex={speech.wordIndex} syllableIndex={speech.syllableIndex} />
          </p>
          {/* A manager's hand-typed hint, when there is one. Shown as well as
              the syllables, not instead: nothing maps it to what the voice is
              saying, so it cannot be highlighted -- but it is the better guide. */}
          {phonetic && (
            <p className="text-[11px] m-0 mt-1 font-mono" style={{ color: 'var(--color-text-tertiary)' }}>
              say it: {phonetic}
            </p>
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
      {/* mt-auto pins it to the bottom so every card in a row lines up. */}
      {footer && <div className="mt-auto pt-3">{footer}</div>}
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
              {/* The card IS the grid cell -- no wrapper. The drill link goes in
                  as a footer, because a sibling under an h-full card overflows
                  the row and paints behind the next one. */}
              {cards.map(c => (
                <PronounceCard key={c.id} id={c.id} term={c.term} sub={c.sub} phonetic={c.phonetic}
                  speech={speech} onPlayed={onProgress}
                  footer={showDrillLink && c.id.startsWith('make-') ? (
                    <button onClick={() => setMakeId(c.id.slice(5))}
                      className="text-[11px] font-semibold"
                      style={{ color: 'var(--color-primary-600)' }}>
                      Drill its models →
                    </button>
                  ) : null} />
              ))}
            </div>
          </>
        )
      )}
    </div>
  );
}
