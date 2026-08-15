import { ArrowDownRight } from 'lucide-react';

// Where a batch came from and everywhere it was re-sent. Lives in its own file
// so both the workspace and the roster can show it without importing each other.
export function Lineage({ data, onBack }) {
  const Row = ({ b }) => (
    <div className="flex items-center gap-2 py-1.5" style={{ paddingLeft: (b.depth || 0) * 16 }}>
      {b.depth > 0 && <ArrowDownRight size={13} style={{ color: 'var(--color-text-tertiary)' }} />}
      <span className="text-[11px] sm:text-[9px] font-bold px-1 py-0.5 rounded" style={{ background: 'var(--color-surface-hover)', color: b.source === 'sub_batch' ? 'var(--color-text-tertiary)' : 'var(--color-primary-600)' }}>
        {b.source === 'sub_batch' ? 'SUB' : b.source === 'upload' ? 'UPLOAD' : 'ORIGINAL'}
      </span>
      <span className="text-sm font-medium" style={{ color: b.status === 'deleted' ? 'var(--color-text-tertiary)' : 'var(--color-text)', textDecoration: b.status === 'deleted' ? 'line-through' : 'none' }}>{b.name}</span>
      <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{b.created_by_name} → {b.sent_to_name}</span>
    </div>
  );
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <button onClick={onBack} className="text-xs font-semibold mb-3" style={{ color: 'var(--color-primary-600)' }}>← Back to items</button>
      <div className="text-[11px] sm:text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-text-tertiary)' }}>Ancestors (origin → here)</div>
      {(data?.ancestors || []).slice().reverse().map(b => <Row key={b.id} b={{ ...b, depth: 0 }} />)}
      <div className="text-[11px] sm:text-[10px] font-bold uppercase tracking-wide mt-4 mb-1" style={{ color: 'var(--color-text-tertiary)' }}>Descendants (everywhere re-sent)</div>
      {(data?.descendants || []).map(b => <Row key={b.id} b={b} />)}
    </div>
  );
}

export default Lineage;
