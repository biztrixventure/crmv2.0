import { useMemo, useState } from 'react';
import {
  Car, AlertTriangle, Plus, Trash2, RotateCcw, Info, Save, ShieldCheck, ChevronUp, ChevronDown,
} from 'lucide-react';

/*
 * VehicleEligibilityRules
 *
 * SuperAdmin tool for editing per-plan vehicle eligibility rules backed by
 * business_config `vehicle_eligibility` (seeded by mig 081). Operates on
 * the same scope contract as every other Business Rules page so per-
 * company overrides Just Work via the BusinessRulesHub scope picker.
 *
 * Catalog shape (see backend/utils/vehicleEligibility.js):
 *   {
 *     "_default": { min_year, max_miles, allowed_makes, disallowed_makes },
 *     "<plan name lower>": { ... same fields ... }
 *   }
 *
 * Enforcement mode lives at `vehicle_eligibility.enforcement` (block | warn).
 */

const FALLBACK_CATALOG = {
  _default: {
    min_year: 2008,
    max_miles: 150000,
    max_age_miles_combined: null,
    allowed_makes: null,
    disallowed_makes: ['ferrari', 'lamborghini', 'rolls-royce', 'bentley', 'maserati'],
  },
};

// Helpers — turn the comma-list inputs into arrays + back.
const parseMakeList = (s) => String(s || '')
  .split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
const formatMakeList = (arr) => Array.isArray(arr) ? arr.join(', ') : '';

const intOrNull = (s) => {
  if (s === '' || s === null || s === undefined) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
};

const Section = ({ title, desc, accent = 'primary', children }) => (
  <section
    className="rounded-2xl mb-4 overflow-hidden"
    style={{
      backgroundColor: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderTop: `3px solid var(--color-${accent}-500, #6366f1)`,
    }}
  >
    <div className="p-5">
      <h2 className="text-base font-bold text-text mb-1">{title}</h2>
      {desc && <p className="text-xs text-text-secondary mb-4 max-w-2xl leading-relaxed">{desc}</p>}
      {children}
    </div>
  </section>
);

const NumInput = ({ value, onChange, placeholder, suffix }) => (
  <div className="flex items-center gap-1.5">
    <input type="number" value={value ?? ''}
      onChange={e => onChange(intOrNull(e.target.value))}
      placeholder={placeholder}
      className="input text-sm py-1.5 w-32 tabular-nums" />
    {suffix && <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{suffix}</span>}
  </div>
);

export default function VehicleEligibilityRules({ config, scope, onSave }) {
  const stored = config?.['vehicle_eligibility'];
  const catalog = (stored && typeof stored === 'object') ? stored : FALLBACK_CATALOG;
  const enforcement = String(config?.['vehicle_eligibility.enforcement'] || 'block');

  const planKeys = useMemo(
    () => Object.keys(catalog).filter(k => k !== '_default').sort(),
    [catalog],
  );

  const [activePlan, setActivePlan] = useState('_default');
  const [draft, setDraft] = useState(() => catalog[activePlan] || {});
  const [dirty, setDirty] = useState(false);

  // Reload draft when the active plan changes (or the upstream config does).
  useMemo(() => { setDraft(catalog[activePlan] || {}); setDirty(false); }, [activePlan, stored]);

  const patch = (k, v) => { setDraft(d => ({ ...d, [k]: v })); setDirty(true); };

  const savePlan = () => {
    const next = { ...catalog, [activePlan]: { ...draft } };
    // Strip empty arrays so the JSON stays clean.
    if (Array.isArray(next[activePlan].allowed_makes)    && next[activePlan].allowed_makes.length === 0)    delete next[activePlan].allowed_makes;
    if (Array.isArray(next[activePlan].disallowed_makes) && next[activePlan].disallowed_makes.length === 0) delete next[activePlan].disallowed_makes;
    if (next[activePlan].max_age_miles_combined && !Array.isArray(next[activePlan].max_age_miles_combined)) delete next[activePlan].max_age_miles_combined;
    onSave('vehicle_eligibility', next);
    setDirty(false);
  };

  const resetPlan = () => { setDraft(catalog[activePlan] || {}); setDirty(false); };

  const deletePlan = () => {
    if (activePlan === '_default') return;
    if (!window.confirm(`Remove eligibility rules for "${activePlan}"?\n\nSales on this plan will fall back to the _default rule. Existing sales are unaffected — only new POST / PUT checks change.`)) return;
    const next = { ...catalog };
    delete next[activePlan];
    onSave('vehicle_eligibility', next);
    setActivePlan('_default');
  };

  const [newPlanName, setNewPlanName] = useState('');
  const addPlan = () => {
    const key = String(newPlanName || '').trim().toLowerCase();
    if (!key) return;
    if (catalog[key]) { setActivePlan(key); setNewPlanName(''); return; }
    const next = { ...catalog, [key]: { ...catalog._default } };  // clone defaults
    onSave('vehicle_eligibility', next);
    setActivePlan(key);
    setNewPlanName('');
  };

  // Combined age+miles cap is an array of [years, miles] in the catalog;
  // we store as a single boolean+two-input pair in the editor.
  const combined = Array.isArray(draft.max_age_miles_combined) ? draft.max_age_miles_combined : null;

  return (
    <div className="w-full pb-8">
      {scope !== 'global' && (
        <div className="rounded-2xl p-4 mb-4 flex items-start gap-3"
          style={{ backgroundColor: 'var(--color-warning-50, #fffbeb)', border: '1px solid var(--color-warning-300, #fcd34d)' }}>
          <AlertTriangle size={18} style={{ color: 'var(--color-warning-700, #b45309)' }} className="flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-bold mb-0.5" style={{ color: 'var(--color-warning-800, #92400e)' }}>Per-company override active</p>
            <p style={{ color: 'var(--color-warning-700, #b45309)' }}>Changes here apply only to the selected company.</p>
          </div>
        </div>
      )}

      <div className="mb-6">
        <h2 className="text-xl font-bold text-text mb-1 flex items-center gap-2"
          style={{ fontFamily: 'var(--font-display)' }}>
          <Car size={20} className="text-primary-600" /> Vehicle Eligibility
        </h2>
        <p className="text-sm text-text-secondary max-w-2xl leading-relaxed">
          Per-plan eligibility caps. The backend runs every rule on every new sale (and on edits that touch the vehicle or plan); the first failing rule blocks the sale or attaches a warning, depending on the enforcement mode.
        </p>
      </div>

      {/* Year dropdown range — drives the vehicle Year picker on the Sale +
          Transfer forms (free-text year is gone; closers pick from this span). */}
      <Section accent="primary" title="Vehicle year dropdown range"
        desc="Bounds the Year dropdown shown on the fronter + closer forms (and the manual entry form). Newest year appears first. Independent of the per-plan min_year eligibility caps below.">
        <div className="flex items-end gap-6 flex-wrap">
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Oldest year (min)</label>
            <NumInput value={intOrNull(config?.['vehicle.year_min']) ?? null}
              onChange={v => onSave('vehicle.year_min', v)} placeholder="1990" />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Newest year (max)</label>
            <NumInput value={intOrNull(config?.['vehicle.year_max']) ?? null}
              onChange={v => onSave('vehicle.year_max', v)} placeholder={String(new Date().getFullYear() + 1)} />
          </div>
        </div>
        <p className="text-xs mt-3 flex items-start gap-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
          <Info size={12} className="flex-shrink-0 mt-0.5" />
          Leave blank to use defaults (min 1990, max next model year). Takes effect on the next time a form is opened.
        </p>
      </Section>

      {/* Enforcement mode */}
      <Section accent="info" title="Enforcement mode"
        desc="block — POST/PUT return 400 VEHICLE_INELIGIBLE when a rule fails. warn — request succeeds but the response carries eligibility_warning so the UI can flag it.">
        <div className="flex items-center gap-2">
          {['block', 'warn'].map(mode => {
            const active = enforcement === mode;
            return (
              <button key={mode} type="button" onClick={() => onSave('vehicle_eligibility.enforcement', mode)}
                className="px-3 py-2 rounded-lg text-sm font-semibold transition-all"
                style={{
                  background: active ? 'var(--gradient-sidebar)' : 'var(--color-bg-secondary)',
                  color:      active ? 'white' : 'var(--color-text-secondary)',
                  border:     '1px solid var(--color-border)',
                }}>
                {mode === 'block' ? <ShieldCheck size={13} className="inline mr-1" /> : <AlertTriangle size={13} className="inline mr-1" />}
                {mode}
              </button>
            );
          })}
        </div>
      </Section>

      {/* Plan picker */}
      <Section accent="primary" title="Plans"
        desc="_default fires when no plan-specific rule matches. Add or pick a plan to edit its caps. New plan names should match the lowercase plan name as it appears in sale_configs.">
        <div className="flex items-center gap-1 flex-wrap p-1 rounded-xl"
          style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          {['_default', ...planKeys].map(k => {
            const active = k === activePlan;
            return (
              <button key={k} type="button" onClick={() => setActivePlan(k)}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold transition-all whitespace-nowrap"
                style={{
                  background: active ? 'var(--gradient-sidebar)' : 'transparent',
                  color:      active ? 'white' : 'var(--color-text-secondary)',
                  boxShadow:  active ? 'var(--shadow-sm)' : 'none',
                }}>
                {k === '_default' ? '_default' : k}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 mt-3">
          <input value={newPlanName} onChange={e => setNewPlanName(e.target.value)}
            placeholder="New plan name (e.g. omega-stated plan)"
            className="input text-sm py-1.5 flex-1 max-w-md" />
          <button type="button" onClick={addPlan} disabled={!newPlanName.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-40"
            style={{ background: 'var(--gradient-sidebar)' }}>
            <Plus size={13} /> Add plan
          </button>
        </div>
      </Section>

      {/* Rule editor */}
      <Section accent="success" title={`Rule — ${activePlan}`}
        desc="Leave a field blank to skip that check. The backend runs them in order: min_year, max_age_years (relative cap), max_miles, max_age_miles_combined, allowed_makes (whitelist), disallowed_makes (blacklist — overrides allowed when both set).">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-widest mb-1 block" style={{ color: 'var(--color-text-secondary)' }}>Min year</label>
              <NumInput value={draft.min_year ?? null}
                onChange={v => patch('min_year', v)} placeholder="2008" suffix="or later" />
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-widest mb-1 block" style={{ color: 'var(--color-text-secondary)' }}>Max age (years)</label>
              <NumInput value={draft.max_age_years ?? null}
                onChange={v => patch('max_age_years', v)} placeholder="10" suffix="years old" />
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-widest mb-1 block" style={{ color: 'var(--color-text-secondary)' }}>Max odometer</label>
              <NumInput value={draft.max_miles ?? null}
                onChange={v => patch('max_miles', v)} placeholder="100000" suffix="miles" />
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-widest mb-1 block" style={{ color: 'var(--color-text-secondary)' }}>Combined age + miles cap</label>
              <div className="flex items-center gap-1.5">
                <NumInput value={combined?.[0] ?? null}
                  onChange={v => patch('max_age_miles_combined', v !== null ? [v, combined?.[1] ?? 0] : null)} placeholder="10" suffix="y" />
                <span style={{ color: 'var(--color-text-tertiary)' }}>and</span>
                <NumInput value={combined?.[1] ?? null}
                  onChange={v => patch('max_age_miles_combined', combined ? [combined[0], v] : (v !== null ? [0, v] : null))} placeholder="100000" suffix="mi" />
              </div>
              <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                Both must be under the pair; either side over fails.
              </p>
            </div>
          </div>

          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest mb-1 block" style={{ color: 'var(--color-text-secondary)' }}>Allowed makes (whitelist)</label>
            <input type="text"
              value={formatMakeList(draft.allowed_makes)}
              onChange={e => patch('allowed_makes', parseMakeList(e.target.value))}
              placeholder="honda, toyota, ford, chevrolet  (leave blank = unrestricted)"
              className="input text-sm py-1.5 w-full" />
          </div>

          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest mb-1 block" style={{ color: 'var(--color-text-secondary)' }}>Disallowed makes (blacklist — overrides allowed)</label>
            <input type="text"
              value={formatMakeList(draft.disallowed_makes)}
              onChange={e => patch('disallowed_makes', parseMakeList(e.target.value))}
              placeholder="ferrari, lamborghini, rolls-royce, bentley, maserati"
              className="input text-sm py-1.5 w-full" />
            <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
              Comma-separated, lowercase. Closer-typed makes are normalized to lowercase before comparing.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 mt-4 flex-wrap">
          {activePlan !== '_default' && (
            <button type="button" onClick={deletePlan}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border"
              style={{ borderColor: 'var(--color-error-300, #fca5a5)', color: 'var(--color-error-700, #b91c1c)', backgroundColor: 'var(--color-error-50, #fef2f2)' }}>
              <Trash2 size={12} /> Remove this plan rule
            </button>
          )}
          {activePlan === '_default' && <span />}
          <div className="flex items-center gap-2">
            <button type="button" onClick={resetPlan} disabled={!dirty}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border disabled:opacity-40"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
              <RotateCcw size={12} /> Revert
            </button>
            <button type="button" onClick={savePlan} disabled={!dirty}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-40"
              style={{ background: 'var(--gradient-sidebar)' }}>
              <Save size={13} /> Save plan rule
            </button>
          </div>
        </div>
      </Section>

      <p className="text-xs text-text-tertiary mt-3 flex items-start gap-1.5 leading-relaxed">
        <Info size={12} className="flex-shrink-0 mt-0.5" />
        Rule evaluation is server-side (backend/utils/vehicleEligibility.js). New rule keys (e.g. add a min_year of 2014 to Omega Powertrain) take effect on the next POST/PUT — historical sales are never re-validated. Per-company overrides land via the scope picker at the top of Business Rules.
      </p>
    </div>
  );
}
