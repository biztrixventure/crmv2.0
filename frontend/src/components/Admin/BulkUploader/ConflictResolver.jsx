import { ArrowRight } from 'lucide-react';

// Side-by-side existing vs incoming for each CLI conflict; user picks include/exclude.
const ConflictResolver = ({ conflicts, decisions, toggleConflict, setAllConflicts }) => {
  if (!conflicts.length) return null;
  const includedCount = conflicts.filter((_, i) => decisions[i]).length;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          Same CLI as an existing record but a different fronter/company. {includedCount} of {conflicts.length} selected to include.
        </p>
        <div className="flex gap-2">
          <button onClick={() => setAllConflicts(true)} className="text-xs font-semibold px-2.5 py-1 rounded-lg" style={{ color: 'var(--color-primary-600)', backgroundColor: 'var(--color-primary-50)' }}>Include all</button>
          <button onClick={() => setAllConflicts(false)} className="text-xs font-semibold px-2.5 py-1 rounded-lg" style={{ color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-bg-secondary)' }}>Exclude all</button>
        </div>
      </div>

      {conflicts.map((c, i) => {
        const included = !!decisions[i];
        return (
          <div key={i} className="rounded-xl p-3" style={{ backgroundColor: 'var(--color-surface)', border: `1px solid ${included ? 'var(--color-warning-300, #fbbf24)' : 'var(--color-border)'}` }}>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 items-center">
              <div className="rounded-lg p-2.5" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                <p className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-text-tertiary)' }}>Existing {c.existing?.source === 'file' ? '(earlier in file)' : '(in system)'}</p>
                <p className="text-xs" style={{ color: 'var(--color-text)' }}>CLI <strong>{c.existing?.cli_number || '—'}</strong></p>
                <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{c.existing?.fronter_name || c.existing?.fronter_user_id || '—'} · {c.existing?.company_name || c.existing?.company_id || '—'}</p>
              </div>
              <ArrowRight size={16} className="hidden md:block mx-auto" style={{ color: 'var(--color-text-tertiary)' }} />
              <div className="rounded-lg p-2.5" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                <p className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-text-tertiary)' }}>Incoming (this file)</p>
                <p className="text-xs" style={{ color: 'var(--color-text)' }}>CLI <strong>{c.incoming?.cli_number || '—'}</strong></p>
                <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{c.incoming?.fronter_name || '—'} · {c.incoming?.company_name || '—'}</p>
              </div>
            </div>
            <label className="flex items-center gap-2 mt-2.5 cursor-pointer select-none">
              <input type="checkbox" checked={included} onChange={() => toggleConflict(i)} />
              <span className="text-sm font-medium" style={{ color: included ? 'var(--color-text)' : 'var(--color-text-secondary)' }}>
                {included ? 'Will be inserted' : 'Excluded'}
              </span>
            </label>
          </div>
        );
      })}
    </div>
  );
};

export default ConflictResolver;
