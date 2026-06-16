const PHASE_LABEL = {
  parse:    'Reading file',
  prepare:  'Preparing rows',
  validate: 'Validating records',
  confirm:  'Inserting records',
};

const UploadProgress = ({ progress }) => {
  if (!progress) return null;
  const { phase, done, total, indeterminate } = progress;
  const label = PHASE_LABEL[phase] || 'Working';
  const determinate = !indeterminate && total > 0;
  const pct = determinate ? Math.round((done / total) * 100) : 0;
  return (
    <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <div className="flex items-center justify-between mb-2 text-sm">
        <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{label}…</span>
        <span style={{ color: 'var(--color-text-secondary)' }}>
          {determinate ? `${done} / ${total} (${pct}%)` : 'working…'}
        </span>
      </div>
      <div className="h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
        {determinate ? (
          <div className="h-full rounded-full transition-all duration-200"
            style={{ width: `${pct}%`, background: 'var(--gradient-sidebar)' }} />
        ) : (
          // Indeterminate: a pulsing partial bar so the user always sees activity
          // during phases without a per-row count (file read, row prep, updates).
          <div className="h-full rounded-full animate-pulse"
            style={{ width: '45%', background: 'var(--gradient-sidebar)' }} />
        )}
      </div>
    </div>
  );
};

export default UploadProgress;
