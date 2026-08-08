import { useState, useEffect } from 'react';
import { PartyPopper, Play, Info } from 'lucide-react';
import { DEFAULT_CELEBRATIONS } from '../../../hooks/useCelebrationConfig';
import { CELEBRATION_TEMPLATES, CELEBRATION_TEMPLATE_KEYS, fireCelebration } from '../../../utils/celebration';
import ThemedSelect from '../../UI/Select';

// Business Rules → Celebrations. Superadmin picks which morale-moment
// notifications trigger confetti, and which named template plays for each.
// Every "Preview" button below calls the exact same fireCelebration() used
// live in the app (useNotifications.js) — what you see here is what fires
// for real, and previewing works from the in-memory draft, not the last save.
const KEY = 'celebrations.config';

const EVENT_META = [
  { key: 'sale_approved',   label: 'Sale Approved',   desc: 'Fires the moment compliance approves a sale — reaches the fronter, the closer, and their managers, whoever is online.' },
  { key: 'quota_milestone', label: 'Milestone Earned', desc: 'Fires for whoever crosses a quota milestone (Business Rules → Stats & KPIs) — closer, fronter, or team lead.' },
];

const CelebrationRules = ({ config, onSave }) => {
  const initial = (config?.[KEY] && typeof config[KEY] === 'object') ? config[KEY] : DEFAULT_CELEBRATIONS;
  const [val, setVal] = useState(initial);
  useEffect(() => { setVal((config?.[KEY] && typeof config[KEY] === 'object') ? config[KEY] : DEFAULT_CELEBRATIONS); }, [config]);

  const events = val.events && typeof val.events === 'object' ? val.events : DEFAULT_CELEBRATIONS.events;
  const push = (next) => { setVal(next); onSave(KEY, next); };
  const setEnabled = (b) => push({ ...val, enabled: b });
  const setEvent = (key, patch) => push({
    ...val,
    events: { ...events, [key]: { ...(events[key] || DEFAULT_CELEBRATIONS.events[key] || { enabled: true, template: 'classic' }), ...patch } },
  });
  const resetDefault = () => push(DEFAULT_CELEBRATIONS);

  const card = { backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderTop: '3px solid #ec4899' };

  return (
    <div className="rounded-2xl overflow-hidden" style={card}>
      <div className="p-5">
        <div className="flex items-center gap-2 mb-1">
          <PartyPopper size={18} style={{ color: '#ec4899' }} />
          <h2 className="text-base font-bold text-text">Celebrations</h2>
        </div>
        <p className="text-xs text-text-secondary mb-4 max-w-2xl leading-relaxed">
          Confetti for morale moments — a sale getting approved, a quota milestone earned. Fires live for
          whoever is looking at the app when the notification lands; nothing is queued or shown after the fact.
          Respects <b>reduce motion</b> automatically, and the master switch below is a hard off — no per-template
          exceptions.
        </p>

        <label className="flex items-center gap-3 mb-5 cursor-pointer">
          <input type="checkbox" checked={val.enabled !== false} onChange={e => setEnabled(e.target.checked)}
            className="w-4 h-4" style={{ accentColor: '#ec4899' }} />
          <span className="text-sm font-semibold text-text">Celebrations {val.enabled !== false ? 'on' : 'off'}</span>
        </label>

        {/* per-event config */}
        <div className="space-y-3 mb-6" style={{ opacity: val.enabled !== false ? 1 : 0.5 }}>
          {EVENT_META.map(({ key, label, desc }) => {
            const ev = events[key] || DEFAULT_CELEBRATIONS.events[key] || { enabled: true, template: 'classic' };
            return (
              <div key={key} className="p-3 rounded-xl" style={{ background: 'var(--color-bg-secondary)' }}>
                <div className="flex items-center justify-between flex-wrap gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={ev.enabled !== false}
                      onChange={e => setEvent(key, { enabled: e.target.checked })}
                      className="w-3.5 h-3.5" style={{ accentColor: '#ec4899' }} />
                    <span className="text-sm font-bold text-text">{label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <ThemedSelect value={ev.template} onChange={e => setEvent(key, { template: e.target.value })}
                      className="input text-sm py-1 min-w-[160px]">
                      {CELEBRATION_TEMPLATE_KEYS.map(k => (
                        <option key={k} value={k}>{CELEBRATION_TEMPLATES[k].label}</option>
                      ))}
                    </ThemedSelect>
                    <button type="button" onClick={() => fireCelebration(ev.template)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg"
                      style={{ color: '#be185d', background: '#ec489918' }}>
                      <Play size={12} /> Preview
                    </button>
                  </div>
                </div>
                <p className="text-xs text-text-tertiary leading-relaxed">{desc}</p>
              </div>
            );
          })}
        </div>

        {/* template gallery */}
        <div className="text-[11px] font-bold uppercase tracking-wide text-text-tertiary mb-1.5 flex items-center gap-1">
          <Info size={12} /> Templates
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
          {CELEBRATION_TEMPLATE_KEYS.map(k => {
            const tpl = CELEBRATION_TEMPLATES[k];
            return (
              <div key={k} className="flex items-center justify-between gap-2 p-2.5 rounded-xl"
                style={{ border: '1px solid var(--color-border)' }}>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-text">{tpl.label}</div>
                  <div className="text-xs text-text-tertiary truncate">{tpl.desc}</div>
                </div>
                <button type="button" onClick={() => fireCelebration(k)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg flex-shrink-0"
                  style={{ color: '#be185d', background: '#ec489918' }}>
                  <Play size={12} /> Try it
                </button>
              </div>
            );
          })}
        </div>

        <p className="text-xs text-text-tertiary mb-4">
          This section uses the same global/per-company Scope picker above — pick a company up top to override
          just that company's celebrations instead of the global default.
        </p>

        <button onClick={resetDefault} className="text-xs font-semibold px-3 py-1.5 rounded-lg"
          style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
          Reset to defaults
        </button>
      </div>
    </div>
  );
};

export default CelebrationRules;
