// BusinessRulesHub sub-page: batch distribution skip/merge rules.
// Reads/writes business_config key 'batch_rules' via the hub's onSave(key,value).
const DEFAULTS = { block_reassign_same_person: false, skip_if_transferred_by_recipient: false, skip_if_transferred_by_anyone: false, transferred_scope: 'company' };

const Section = ({ title, desc, children }) => (
  <section className="rounded-2xl mb-4 overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderTop: '3px solid var(--color-primary-500, #6366f1)' }}>
    <div className="p-5">
      <h2 className="text-base font-bold text-text mb-1">{title}</h2>
      {desc && <p className="text-xs text-text-secondary mb-4 max-w-2xl leading-relaxed">{desc}</p>}
      {children}
    </div>
  </section>
);
const CheckboxRow = ({ checked, onChange, label, sub }) => (
  <label className="flex items-start gap-3 py-2 px-3 rounded-lg cursor-pointer hover:bg-bg-secondary transition-colors min-h-[44px]">
    <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} className="mt-1 w-4 h-4 flex-shrink-0 cursor-pointer" style={{ accentColor: 'var(--color-primary-600)' }} aria-label={label} />
    <div className="flex-1"><span className="text-sm font-semibold text-text">{label}</span>{sub && <p className="text-xs text-text-tertiary mt-0.5">{sub}</p>}</div>
  </label>
);
const RadioGroup = ({ value, onChange, options, name }) => (
  <div role="radiogroup" aria-label={name} className="space-y-1.5">
    {options.map(opt => (
      <label key={opt.key} className="flex items-start gap-3 py-2 px-3 rounded-lg cursor-pointer hover:bg-bg-secondary transition-colors min-h-[44px]"
        style={{ border: '1px solid', borderColor: value === opt.key ? 'var(--color-primary-400, #818cf8)' : 'var(--color-border)', backgroundColor: value === opt.key ? 'var(--color-primary-50, #eef2ff)' : 'transparent' }}>
        <input type="radio" name={name} checked={value === opt.key} onChange={() => onChange(opt.key)} className="mt-1 w-4 h-4 flex-shrink-0 cursor-pointer" style={{ accentColor: 'var(--color-primary-600)' }} />
        <div className="flex-1"><p className="text-sm font-semibold text-text">{opt.label}</p>{opt.detail && <p className="text-xs text-text-tertiary mt-0.5">{opt.detail}</p>}</div>
      </label>
    ))}
  </div>
);

export default function BatchRules({ config, onSave }) {
  const rules = { ...DEFAULTS, ...(config?.batch_rules || {}) };
  const set = (patch) => onSave('batch_rules', { ...rules, ...patch });

  return (
    <div>
      <Section title="Skip / exclude rules"
        desc="When a batch reaches a fronter/closer, matching numbers are marked EXCLUDED (kept on the record with a reason, hidden from their My Numbers) instead of being dialed again. Upstream managers still receive everything; the excluded count is previewed at each send.">
        <CheckboxRow checked={rules.block_reassign_same_person} onChange={v => set({ block_reassign_same_person: v })}
          label="Don’t re-assign a number to the same person" sub="If a number is already in an active batch/list assigned to that fronter, exclude it." />
        <CheckboxRow checked={rules.skip_if_transferred_by_recipient} onChange={v => set({ skip_if_transferred_by_recipient: v })}
          label="Skip numbers the recipient already transferred" sub="The fronter previously created a transfer on this number → exclude it for them." />
        <CheckboxRow checked={rules.skip_if_transferred_by_anyone} onChange={v => set({ skip_if_transferred_by_anyone: v })}
          label="Skip numbers ANY fronter already transferred" sub="Someone (anyone) already transferred this number → exclude it." />
      </Section>

      <Section title="Transfer-history scope"
        desc="Which transfers count toward the two “already transferred” rules above.">
        <RadioGroup name="transferred_scope" value={rules.transferred_scope} onChange={v => set({ transferred_scope: v })}
          options={[
            { key: 'company', label: 'This company only (recommended)', detail: 'Fast, indexed (idx_transfers_fronter_phone). The usual choice.' },
            { key: 'anywhere', label: 'Across all companies', detail: 'Checks transfers in every company. Uses the cross-company index; slightly heavier.' },
          ]} />
      </Section>
    </div>
  );
}
