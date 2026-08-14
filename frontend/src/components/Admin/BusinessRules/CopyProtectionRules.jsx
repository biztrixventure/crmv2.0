import { useState, useEffect } from 'react';
import { ClipboardX, Info } from 'lucide-react';
import { COPY_PROTECTION_KEY, DEFAULT_COPY_PROTECTION } from '../../../hooks/useCopyProtection';

// Business Rules → Copy Protection. Superadmin decides whether the staff shell
// (closer / fronter dashboard) blocks text selection + copying. Default ON —
// that has always been the behavior, so an untouched deployment is unchanged.
// Superadmin is exempt from the lock either way.
const SHELLS = [
  {
    id: 'staff',
    label: 'Staff dashboard (closer / fronter)',
    hint: 'Blocks selecting and copying record text on the /staff, /closer and /fronter dashboards. Form inputs stay typeable, and the small copy buttons (phone numbers, copy bar) keep working.',
  },
];

const CopyProtectionRules = ({ config, onSave, scope, onResetOverride }) => {
  const resolve = (cfg) => (cfg?.[COPY_PROTECTION_KEY] && typeof cfg[COPY_PROTECTION_KEY] === 'object')
    ? { ...DEFAULT_COPY_PROTECTION, ...cfg[COPY_PROTECTION_KEY] }
    : DEFAULT_COPY_PROTECTION;

  const [val, setVal] = useState(() => resolve(config));
  useEffect(() => { setVal(resolve(config)); }, [config]);

  const push = (next) => { setVal(next); onSave(COPY_PROTECTION_KEY, next); };
  const locked = (id) => val[id] !== false;          // missing → locked
  const toggle = (id) => push({ ...val, [id]: !locked(id) });

  const card = { backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderTop: '3px solid #6366f1' };

  return (
    <div className="rounded-2xl overflow-hidden" style={card}>
      <div className="p-5">
        <div className="flex items-center gap-2 mb-1">
          <ClipboardX size={18} style={{ color: '#6366f1' }} />
          <h2 className="text-base font-bold text-text">Copy Protection</h2>
        </div>
        <p className="text-xs text-text-secondary mb-4 max-w-2xl leading-relaxed">
          Turn the copy restriction for a shell <b>on</b> to stop users selecting and copying content out of it,
          or <b>off</b> to let them copy normally. Superadmin is never restricted.
        </p>

        <div className="space-y-2">
          {SHELLS.map(s => (
            <div key={s.id} className="flex items-start justify-between gap-4 p-3 rounded-xl"
              style={{ background: 'var(--color-bg-secondary)' }}>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-text">{s.label}</div>
                <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">{s.hint}</p>
              </div>
              <button type="button" role="switch" aria-checked={locked(s.id)} onClick={() => toggle(s.id)}
                title={locked(s.id) ? 'Copying is blocked — click to allow' : 'Copying is allowed — click to block'}
                className="flex-shrink-0 inline-flex items-center gap-2">
                <span className="relative inline-block rounded-full transition-colors"
                  style={{ width: 40, height: 22, background: locked(s.id) ? '#6366f1' : 'var(--color-border)' }}>
                  <span className="absolute rounded-full bg-white transition-all"
                    style={{ width: 16, height: 16, top: 3, left: locked(s.id) ? 21 : 3 }} />
                </span>
                <span className="text-xs font-bold w-7 text-left" style={{ color: locked(s.id) ? '#6366f1' : 'var(--color-text-tertiary)' }}>
                  {locked(s.id) ? 'On' : 'Off'}
                </span>
              </button>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-start gap-1.5 text-xs text-text-tertiary leading-relaxed">
          <Info size={12} className="mt-0.5 flex-shrink-0" />
          <span>
            Takes effect within 30 seconds (config cache) or on the next page load. This does not change the
            stricter read-only-admin <b>no copy</b> governance flag, which is set per user in the User Control Center.
          </span>
        </div>

        {scope !== 'global' && (
          <button onClick={() => onResetOverride?.(COPY_PROTECTION_KEY)}
            className="mt-4 text-xs font-semibold px-3 py-1.5 rounded-lg"
            style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
            Reset to global default
          </button>
        )}
      </div>
    </div>
  );
};

export default CopyProtectionRules;
