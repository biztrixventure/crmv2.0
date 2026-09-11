// ============================================================================
// ToolKitPanel -- the pronunciation drill.
//
// Two lists, one treatment. Cars come LIVE from the form builder catalog
// (vehicle_makes / vehicle_models) so a trainee is always practising the names
// the form actually offers; customer names come from an uploaded list. Both
// render as the same card, because the skill being practised is the same one.
//
// THE LINE UNDER THE NAME is what lights up, and it is drawn from the same
// speechUnits split the engine times against -- so "BMW" shows B-M-W and lights
// each letter, "CX-90" shows C-X-90, "Volkswagen" shows Volks-wa-gen. See the
// header of useSpeech.js for how the timing is kept honest.
//
// Only the card being spoken re-renders while the voice runs: each card
// subscribes to its own cursor (useSpeechCursor), and every other card is
// memoised with stable props. A 300-card grid repainting on every syllable was
// part of why the old highlight stuttered.
// ============================================================================
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Volume2, Car, Users, Search, Play, Square, Gauge, Rabbit, Turtle, X, CheckCircle2, Info,
} from 'lucide-react';
import client from '../../api/client';
import { Panel, PillTabs, EmptyState, Loading, IconButton, accent } from '../UI/kit';
import Select from '../UI/Select';
import useSpeech, { useSpeechCursor } from './useSpeech';
import { segment } from './speechUnits';

// ── the unit line: the thing that actually lights up ─────────────────────────
//
// Every unit has the SAME padding in every state, and only colours change.
// Growing the padding on the lit unit (what the old version did) shifted the
// whole line sideways on every syllable, which reads as jitter.
//
// Colours follow the kit rule: -600 is for TEXT, fills are a tint of it. White
// text on a -600 fill is unreadable in dark mode, where -600 turns light.
const UNIT_BASE = {
  borderRadius: 4,
  padding: '1px 2px',
  transition: 'background-color 80ms linear, color 80ms linear',
};
const UNIT_STYLE = {
  todo: UNIT_BASE,
  said: { ...UNIT_BASE, color: 'var(--color-primary-600)' },
  now: {
    ...UNIT_BASE,
    color: 'var(--color-primary-600)',
    fontWeight: 800,
    backgroundColor: 'color-mix(in srgb, var(--color-primary-600) 22%, transparent)',
    boxShadow: 'inset 0 -2px 0 var(--color-primary-600)',
  },
};

function UnitLine({ term, cursor }) {
  const { tokens } = useMemo(() => segment(term), [term]);
  const speaking = cursor.phase === 'speak';
  const done = cursor.phase === 'done';

  const stateOf = (ti, ui) => {
    if (done) return 'said';
    if (!speaking) return 'todo';
    if (ti < cursor.token || (ti === cursor.token && ui < cursor.unit)) return 'said';
    if (ti === cursor.token && ui === cursor.unit) return 'now';
    return 'todo';
  };

  return (
    <span className="font-mono tracking-wide">
      {tokens.map((tok, ti) => {
        const pieces = [];
        let at = 0;
        tok.units.forEach((u, ui) => {
          // Original characters between units (the hyphen in "CX-90") are
          // drawn as they are; units that touch get a dictionary hyphen.
          if (u.start > at) {
            pieces.push(<span key={`g${ui}`} style={{ opacity: 0.45 }}>{tok.text.slice(at, u.start)}</span>);
          } else if (ui > 0) {
            pieces.push(<span key={`s${ui}`} style={{ opacity: 0.35 }}>-</span>);
          }
          pieces.push(<span key={`u${ui}`} style={UNIT_STYLE[stateOf(ti, ui)]}>{u.text}</span>);
          at = u.end;
        });
        if (at < tok.text.length) {
          pieces.push(<span key="tail" style={{ opacity: 0.45 }}>{tok.text.slice(at)}</span>);
        }
        return (
          <span key={ti}>
            {ti > 0 && <span className="px-1" style={{ opacity: 0.4 }}> · </span>}
            {pieces}
          </span>
        );
      })}
    </span>
  );
}

// ── the dictionary card ──────────────────────────────────────────────────────
// Memoised, with stable props only (no JSX children, no `speech` object), so a
// card that is not being spoken never re-renders while another one is.
const PronounceCard = memo(function PronounceCard({ id, term, sub, phonetic, onPlay, onStop, drillId, onDrill }) {
  const cursor = useSpeechCursor(id);
  const a = accent('primary');
  // "Speaking" for the button is the audible part only. After the last unit
  // (phase 'done') the engine still reports speaking for most of a second;
  // offering Play again there is right, because the voice has stopped.
  const live = cursor.phase === 'wait' || cursor.phase === 'speak';

  return (
    <div
      className="rounded-2xl p-4 transition-shadow h-full flex flex-col"
      style={{
        background: 'var(--color-surface)',
        border: `1px solid ${live ? 'var(--color-primary-600)' : 'var(--color-border)'}`,
        boxShadow: live ? '0 0 0 3px color-mix(in srgb, var(--color-primary-600) 16%, transparent)' : 'none',
      }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg font-bold m-0 leading-tight" style={{ color: 'var(--color-text)' }}>
            {term}
          </p>
          <p className="text-sm m-0 mt-1.5 flex items-center gap-1.5" style={{ color: 'var(--color-text-secondary)' }}>
            <UnitLine term={term} cursor={cursor} />
            {cursor.phase === 'done' && (
              <CheckCircle2 size={13} style={{ color: 'var(--color-primary-600)' }} className="flex-shrink-0" />
            )}
          </p>
          {/* A manager's hand-typed hint. Shown alongside, not instead: nothing
              maps it to what the voice is saying, so it cannot light up. */}
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
          <IconButton label={`Say ${term} slowly`} title="Say it slowly" onClick={() => onPlay(id, term, 0.6)}>
            <Turtle size={15} />
          </IconButton>
          <button
            onClick={() => (live ? onStop() : onPlay(id, term))}
            title={live ? 'Stop' : 'Say it'}
            aria-label={live ? `Stop ${term}` : `Pronounce ${term}`}
            className="w-9 h-9 rounded-full flex items-center justify-center transition-colors flex-shrink-0"
            // The icon takes the SURFACE colour on the solid fill -- dark on a
            // light fill in dark mode, light on a dark fill in light mode.
            style={{ background: live ? a.fg : a.soft, color: live ? 'var(--color-surface)' : a.fg }}>
            {live ? <Square size={14} fill="currentColor" /> : <Volume2 size={16} />}
          </button>
        </div>
      </div>
      {/* Inside the card and pinned to its bottom (mt-auto). As a sibling under
          an h-full card it overflowed the row and painted behind the next one. */}
      {drillId && (
        <div className="mt-auto pt-3">
          <button onClick={() => onDrill(drillId)}
            className="text-[11px] font-semibold"
            style={{ color: 'var(--color-primary-600)' }}>
            Drill its models →
          </button>
        </div>
      )}
    </div>
  );
});

// ── voice + speed, once for the whole panel ──────────────────────────────────
function VoiceBar({ speech, onPractice, practising, count }) {
  if (!speech.supported) {
    return (
      <Panel tone="inset" radius="xl" pad="md">
        <p className="text-xs m-0" style={{ color: 'var(--color-warning-600)' }}>
          This browser cannot speak. Chrome, Edge and Safari all can — open the Tool Kit in one of those
          and the pronunciation buttons will work.
        </p>
      </Panel>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <div style={{ minWidth: 230 }}>
          <label className="text-[10px] font-bold uppercase tracking-wider block mb-1"
            style={{ color: 'var(--color-text-secondary)' }}>Voice</label>
          <Select value={speech.voiceURI} onChange={(e) => speech.setVoice(e.target.value)}>
            {speech.voices.map(v => (
              <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>
            ))}
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
            color: 'var(--color-surface)',
          }}>
          {practising
            ? <><Square size={12} fill="currentColor" /> Stop</>
            : <><Play size={12} /> Practise all{count ? ` (${count > 60 ? '60' : count})` : ''}</>}
        </button>
        {speech.voices.length === 0 && (
          <p className="text-[11px] m-0 self-center" style={{ color: 'var(--color-text-tertiary)' }}>
            Loading voices…
          </p>
        )}
      </div>
      {/* Honest about the one case the highlight cannot track exactly. */}
      {speech.voices.length > 0 && !speech.voiceTimed && (
        <p className="text-[11px] m-0 flex items-start gap-1.5" style={{ color: 'var(--color-warning-600)' }}>
          <Info size={12} className="flex-shrink-0 mt-0.5" />
          This voice does not report its timing, so the highlight follows it approximately.
          Pick a Microsoft voice for a highlight that tracks every word exactly.
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

  // Stop the voice when the tab changes -- a drill that keeps talking over the
  // next screen is the thing people hate most about audio in a web app.
  const { stop, speak, speakSequence } = speech;
  useEffect(() => () => { cancelPractice.current?.(); stop(); }, [tab, stop]);

  // Stable callbacks, so memoised cards never re-render for a new function.
  const progressRef = useRef(onProgress);
  progressRef.current = onProgress;
  const onPlay = useCallback((id, term, rate) => {
    cancelPractice.current = null;
    setPractising(false);
    speak(term, { id, rate });
    progressRef.current?.();
  }, [speak]);
  const onStop = useCallback(() => { setPractising(false); stop(); }, [stop]);
  const onDrill = useCallback((id) => { stop(); setMakeId(id); }, [stop]);

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
      drillId: m.id,
    }))];
  }, [tab, names, makes, extras, needle, selectedMake]);

  const practice = () => {
    if (practising) { cancelPractice.current?.(); setPractising(false); return; }
    setPractising(true);
    // Capped: a full catalog read aloud is 40 minutes of audio nobody asked for.
    cancelPractice.current = speakSequence(
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
                <PronounceCard key={c.id} id={c.id} term={c.term} sub={c.sub} phonetic={c.phonetic}
                  onPlay={onPlay} onStop={onStop}
                  drillId={showDrillLink ? c.drillId : undefined} onDrill={onDrill} />
              ))}
            </div>
          </>
        )
      )}
    </div>
  );
}
