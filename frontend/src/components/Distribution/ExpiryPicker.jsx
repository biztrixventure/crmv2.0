import { Clock } from 'lucide-react';
import ThemedDate from '../UI/ThemedDate';
import { EXPIRY_PRESETS, fromLocalInputValue, fmtDeadline } from '../../utils/expiry';

// ── "they keep these until…" ─────────────────────────────────────────────────
// The control the person handing numbers down uses to say how long the other
// person keeps them. Presets for the answers people actually give (a shift, a
// day, a week) plus an exact day + time for the ones they don't.
//
// State lives with the caller as { preset, customLocal } and is turned into the
// API's shape by expiryPayload() — one function, so /assign, /reassign and the
// change-limit dialog cannot disagree about what "no limit" means.
export const EMPTY_EXPIRY = { preset: 'none', customLocal: '' };

export function expiryPayload(v) {
  if (!v || v.preset === 'none') return {};
  if (v.preset === 'custom') {
    const at = fromLocalInputValue(v.customLocal);
    return at ? { expires_at: at } : {};
  }
  const hours = EXPIRY_PRESETS.find(p => p.key === v.preset)?.hours;
  return hours ? { expires_in_hours: hours } : {};
}

// What the chosen setting means in plain words, for the confirmation line.
export function expirySummary(v) {
  if (!v || v.preset === 'none') return 'They keep these numbers until someone takes them back.';
  if (v.preset === 'custom') {
    const at = fromLocalInputValue(v.customLocal);
    return at ? `These numbers go back on ${fmtDeadline(at)}.` : 'Pick the day and time they go back.';
  }
  const p = EXPIRY_PRESETS.find(x => x.key === v.preset);
  const at = p?.hours ? new Date(Date.now() + p.hours * 3600 * 1000).toISOString() : null;
  return at ? `These numbers go back on ${fmtDeadline(at)}.` : '';
}

export default function ExpiryPicker({ value = EMPTY_EXPIRY, onChange, label = 'Time limit' }) {
  const set = (patch) => onChange?.({ ...value, ...patch });
  return (
    <div>
      <div className="text-xs font-semibold mb-1 flex items-center gap-1.5" style={{ color: 'var(--color-text-secondary)' }}>
        <Clock size={13} /> {label}
      </div>
      <div className="flex flex-wrap gap-1">
        {EXPIRY_PRESETS.map(p => {
          const on = value.preset === p.key;
          return (
            <button key={p.key} type="button" onClick={() => set({ preset: p.key })}
              className="text-xs font-bold px-2.5 py-1.5 rounded-full whitespace-nowrap"
              style={{
                background: on ? 'var(--color-primary-600)' : 'var(--color-surface)',
                color: on ? '#fff' : 'var(--color-text-secondary)',
                border: '1px solid var(--color-border)',
              }}>
              {p.label}
            </button>
          );
        })}
      </div>
      {value.preset === 'custom' && (
        <div className="mt-2">
          <ThemedDate withTime value={value.customLocal} onChange={e => set({ customLocal: e.target.value })}
            className="input text-sm" aria-label="Numbers go back on" />
        </div>
      )}
      <div className="text-[11px] mt-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
        {expirySummary(value)}
      </div>
    </div>
  );
}
