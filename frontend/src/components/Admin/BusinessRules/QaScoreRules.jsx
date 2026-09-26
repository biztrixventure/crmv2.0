import { useState, useEffect } from 'react';
import { Award, Eye, EyeOff, Info } from 'lucide-react';

// Business Rules -> QA Scores. Whether an agent sees their OWN QA numbers.
//
// The self-view (Staff shell -> QA Scores, GET /qa2/my-scores) used to be a
// pure role question: hold qa2.view_own_scores and the tab is there, for every
// company, forever. Showing someone a score is a coaching decision though --
// it differs per floor and per company, and a number with nobody beside it to
// explain it starts an argument instead of a conversation.
//
// FRONTERS ARE OFF BY DEFAULT. Closers keep what they have, so turning this
// page on changes nothing for them until someone says otherwise.
//
// The switch is enforced in the API as well (utils/qaScoreVisibility.js): the
// tab disappears AND the endpoint refuses, because hiding a tab only hides a
// button. Managers, QA and compliance are unaffected -- this governs the
// agent's own view of themselves, nothing else.
const KEY = 'qa.agent_scores';
const DEFAULTS = { fronter: false, closer: true };

const FLOORS = [
  {
    key: 'fronter',
    label: 'Fronters',
    desc: 'Fronters and trainees. A trainee follows this switch too -- they are the most likely person to be handed a number with no coaching around it.',
  },
  {
    key: 'closer',
    label: 'Closers',
    desc: 'Closers and closer managers, on their own reviewed calls.',
  },
];

const QaScoreRules = ({ config, onSave }) => {
  const read = () => ({ ...DEFAULTS, ...((config?.[KEY] && typeof config[KEY] === 'object') ? config[KEY] : {}) });
  const [val, setVal] = useState(read);
  useEffect(() => { setVal(read()); /* eslint-disable-next-line */ }, [config]);

  const set = (floor, on) => { const next = { ...val, [floor]: on }; setVal(next); onSave(KEY, next); };

  const card = { backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderTop: '3px solid #6366f1' };

  return (
    <div className="rounded-2xl overflow-hidden" style={card}>
      <div className="p-5">
        <div className="flex items-center gap-2 mb-1">
          <Award size={18} style={{ color: '#6366f1' }} />
          <h2 className="text-base font-bold text-text">QA Scores shown to agents</h2>
        </div>
        <p className="text-xs text-text-secondary mb-4 max-w-2xl leading-relaxed">
          Whether an agent can open their own <b>QA Scores</b> tab &mdash; final score and pass/fail for calls a
          reviewer has scored. Off means the tab is gone <b>and</b> the data is refused, so it cannot be
          reached another way. Managers, QA reviewers and compliance always see everything; this only
          governs what an agent sees about themselves.
        </p>

        <div className="space-y-3">
          {FLOORS.map(({ key, label, desc }) => {
            const on = val[key] !== false;
            return (
              <div key={key} className="p-3.5 rounded-xl flex items-start gap-3" style={{ background: 'var(--color-bg-secondary)' }}>
                <span className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: on ? 'rgba(99,102,241,0.12)' : 'var(--color-surface)', color: on ? '#6366f1' : 'var(--color-text-tertiary)' }}>
                  {on ? <Eye size={16} /> : <EyeOff size={16} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-text">{label}</span>
                    <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-md"
                      style={{ backgroundColor: on ? 'var(--color-success-50)' : 'var(--color-bg-secondary)', color: on ? 'var(--color-success-600)' : 'var(--color-text-tertiary)' }}>
                      {on ? 'can see their scores' : 'cannot see their scores'}
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary mt-0.5 mb-0">{desc}</p>
                </div>
                <label className="flex items-center gap-2 cursor-pointer select-none flex-shrink-0">
                  <input type="checkbox" checked={on} onChange={e => set(key, e.target.checked)}
                    className="w-4 h-4" style={{ accentColor: '#6366f1' }} />
                  <span className="text-xs font-semibold text-text-secondary">Show</span>
                </label>
              </div>
            );
          })}
        </div>

        <p className="text-[11px] text-text-tertiary mt-4 flex items-start gap-1.5 max-w-2xl">
          <Info size={12} className="mt-0.5 flex-shrink-0" />
          Set globally here, or pick a company at the top of Business Rules to overrule it for that company
          only. An agent already looking at the tab loses it on their next page load.
        </p>
      </div>
    </div>
  );
};

export default QaScoreRules;
