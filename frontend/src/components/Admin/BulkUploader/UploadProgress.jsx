const UploadProgress = ({ progress }) => {
  if (!progress) return null;
  const { phase, done, total } = progress;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const label = phase === 'confirm' ? 'Inserting records' : 'Validating records';
  return (
    <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <div className="flex items-center justify-between mb-2 text-sm">
        <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{label}…</span>
        <span style={{ color: 'var(--color-text-secondary)' }}>{done} / {total} ({pct}%)</span>
      </div>
      <div className="h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
        <div className="h-full rounded-full transition-all duration-200" style={{ width: `${pct}%`, background: 'var(--gradient-sidebar)' }} />
      </div>
    </div>
  );
};

export default UploadProgress;
