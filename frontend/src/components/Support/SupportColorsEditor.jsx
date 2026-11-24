// ============================================================================
// SupportColorsEditor -- Support Reports -> Colours (superadmin).
//
// One colour per case status and one per call outcome. They drive every row,
// pill and dropdown on the support desk (supportColors.jsx turns them into a
// stylesheet). Saved to business_config 'support.colors' by PUT
// /support/colors, which validates every value again -- this screen is only
// the convenient way to send them.
//
// An outcome may have NO colour (its rows stay white, or take the In Progress
// colour); a status always has one.
// ============================================================================
import { useState } from 'react';
import { Save, RotateCcw } from 'lucide-react';
import client from '../../api/client';
import { errText } from './supportFormat';
import { inkFor } from './supportColors';

const HEX = /^#[0-9a-f]{6}$/i;
const STATUSES = [['saved', 'Saved'], ['open', 'In Progress'], ['lost', 'Not Saved']];

function ColorRow({ id, label, value, canClear, onChange }) {
  const ok = HEX.test(value);
  const bad = value !== '' && !ok;
  return (
    <div className="sx-color-row">
      <label htmlFor={`${id}-hex`} className="sx-color-sample"
        style={ok ? { background: value, color: inkFor(value) } : undefined}>
        {label}{value === '' ? ' (no colour)' : ''}
      </label>
      <input type="color" aria-label={`${label} colour`} value={ok ? value : '#ffffff'} onChange={(e) => onChange(e.target.value)} />
      <input id={`${id}-hex`} className="sx-input" value={value} maxLength={7} spellCheck={false}
        aria-invalid={bad} style={bad ? { borderColor: '#c0392b' } : undefined}
        placeholder="#rrggbb" onChange={(e) => onChange(e.target.value.trim().toLowerCase())} />
      {canClear
        ? <button type="button" className="sx-btn" disabled={value === ''} onClick={() => onChange('')}>None</button>
        : <span />}
    </div>
  );
}

export default function SupportColorsEditor({ me, onSaved }) {
  const [draft, setDraft] = useState(() => ({ status: { ...me.colors.status }, outcomes: { ...me.colors.outcomes } }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');

  const set = (group, key, v) => { setFlash(''); setDraft((d) => ({ ...d, [group]: { ...d[group], [key]: v } })); };
  const dirty = JSON.stringify(draft) !== JSON.stringify({ status: me.colors.status, outcomes: me.colors.outcomes });
  const valid = Object.values(draft.status).every((v) => HEX.test(v))
    && Object.values(draft.outcomes).every((v) => v === '' || HEX.test(v));

  const send = async (body, okText) => {
    setBusy(true); setError(''); setFlash('');
    try {
      const r = await client.put('support/colors', body);
      const colors = r.data.colors;
      setDraft({ status: { ...colors.status }, outcomes: { ...colors.outcomes } });
      onSaved(colors);
      setFlash(okText);
    } catch (e) {
      setError(errText(e, 'Could not save the colours.'));
    } finally { setBusy(false); }
  };

  return (
    <div className="sx-body">
      <div className="sx-hint" style={{ marginBottom: 8 }}>
        These colours are used on every support list, pill and dropdown, for every agent. Pick with the colour box or type a code like #22c55e.
        The text turns white by itself on a dark colour. Agents see a change the next time they open the support desk.
      </div>
      {error && <div className="sx-note bad" role="alert">{error}</div>}
      {flash && <div className="sx-note good" role="status">{flash}</div>}

      <fieldset className="sx-group" style={{ marginBottom: 10 }}>
        <legend>Status</legend>
        <div className="sx-colors">
          {STATUSES.map(([k, label]) => (
            <ColorRow key={k} id={`sc-st-${k}`} label={label} value={draft.status[k] || ''} onChange={(v) => set('status', k, v)} />
          ))}
        </div>
        <div className="sx-hint" style={{ marginTop: 6 }}>
          A Saved customer&apos;s row is a lighter shade of the Saved colour. An In Progress row shows its last call&apos;s colour, or a lighter In Progress colour when that call has none.
        </div>
      </fieldset>

      <fieldset className="sx-group" style={{ marginBottom: 10 }}>
        <legend>Last call (the outcome picked in Log Call)</legend>
        <div className="sx-colors">
          {me.outcomes.map((o) => (
            <ColorRow key={o.key} id={`sc-oc-${o.key}`} label={o.label} canClear value={draft.outcomes[o.key] ?? ''} onChange={(v) => set('outcomes', o.key, v)} />
          ))}
        </div>
      </fieldset>

      <div className="sx-searchbar" style={{ padding: 0, border: 'none', background: 'none' }}>
        <button type="button" className="sx-btn sx-btn-go" disabled={busy || !dirty || !valid}
          onClick={() => send(draft, 'Colours saved.')}>
          <Save size={14} /> {busy ? 'Saving...' : 'Save Colours'}
        </button>
        <button type="button" className="sx-btn" disabled={busy || !dirty}
          onClick={() => { setFlash(''); setError(''); setDraft({ status: { ...me.colors.status }, outcomes: { ...me.colors.outcomes } }); }}>
          Undo changes
        </button>
        <button type="button" className="sx-btn" disabled={busy}
          onClick={() => send({ reset: true }, 'Colours are back to the defaults.')}>
          <RotateCcw size={14} /> Back to defaults
        </button>
        {!valid && <span className="sx-hint">A colour code must look like #1a2b3c.</span>}
      </div>
    </div>
  );
}
