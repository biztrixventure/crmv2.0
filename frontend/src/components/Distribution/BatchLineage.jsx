import { useMemo } from 'react';
import { CornerDownRight, Package, Send, Upload, Database, Trash2, User } from 'lucide-react';

// Where a batch came from and everywhere it went — drawn as an actual tree, not
// an indented list: each hop is a card, and elbow connectors show which card it
// hangs off. Lives in its own file so the workspace and the roster can both show
// it without importing each other.

const SOURCE = {
  data_analyzer: { label: 'Data Analyzer', icon: Database, color: '#4f46e5' },
  upload:        { label: 'Uploaded file', icon: Upload,   color: '#0891b2' },
  sub_batch:     { label: 'Assigned',      icon: Send,     color: '#64748b' },
};
const fmt = (d) => { try { return d ? new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; } catch { return ''; } };

function Node({ b, depth, isCurrent, last }) {
  const s = SOURCE[b.source] || SOURCE.sub_batch;
  const Icon = s.icon;
  const dead = b.status === 'deleted';
  return (
    <div className="relative flex items-start gap-2" style={{ paddingLeft: depth * 26 }}>
      {/* elbow into this card. The vertical run stops at the last child so the
          line never dangles past the end of a branch. */}
      {depth > 0 && (
        <>
          <span aria-hidden className="absolute" style={{
            left: (depth - 1) * 26 + 11, top: 0, width: 1,
            height: last ? 20 : '100%', background: 'var(--color-border)',
          }} />
          <span aria-hidden className="absolute" style={{
            left: (depth - 1) * 26 + 11, top: 20, width: 14, height: 1, background: 'var(--color-border)',
          }} />
        </>
      )}
      <div className="flex-1 rounded-xl px-3 py-2 mb-1.5 flex items-center gap-3 flex-wrap"
        style={{
          border: `1px solid ${isCurrent ? s.color : 'var(--color-border)'}`,
          background: isCurrent ? `${s.color}0f` : 'var(--color-surface)',
          opacity: dead ? 0.55 : 1,
        }}>
        <span className="rounded-lg p-1.5 flex" style={{ background: `${s.color}1a`, color: s.color }}><Icon size={14} /></span>
        <div className="min-w-0">
          <div className="text-sm font-bold truncate flex items-center gap-1.5"
            style={{ color: 'var(--color-text)', textDecoration: dead ? 'line-through' : 'none' }}>
            {b.name}
            {isCurrent && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: s.color, color: '#fff' }}>YOU ARE HERE</span>}
            {dead && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full inline-flex items-center gap-1" style={{ background: '#fee2e2', color: '#dc2626' }}><Trash2 size={9} /> deleted</span>}
          </div>
          <div className="text-[11px] flex items-center gap-1.5 flex-wrap" style={{ color: 'var(--color-text-secondary)' }}>
            <span>{s.label}</span>
            {b.created_by_name && <><span style={{ color: 'var(--color-text-tertiary)' }}>·</span><User size={10} /> {b.created_by_name}</>}
            {b.sent_to_name && <><CornerDownRight size={10} style={{ color: 'var(--color-text-tertiary)' }} /> <strong style={{ color: 'var(--color-text)' }}>{b.sent_to_name}</strong></>}
            {b.sent_at && <><span style={{ color: 'var(--color-text-tertiary)' }}>·</span>{fmt(b.sent_at)}</>}
          </div>
        </div>
        {b.item_count != null && (
          <span className="ml-auto text-xs font-bold tabular-nums px-2 py-1 rounded-lg inline-flex items-center gap-1"
            style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
            <Package size={11} /> {b.item_count}
          </span>
        )}
      </div>
    </div>
  );
}

export function Lineage({ data, onBack }) {
  const ancestors = data?.ancestors || [];
  const descendants = data?.descendants || [];
  // The RPC returns descendants as a flat depth list; work out "is this the last
  // child of its parent" so each connector run stops in the right place.
  const rows = useMemo(() => descendants.map((d, i) => {
    const next = descendants.slice(i + 1).find(x => x.depth <= d.depth);
    return { ...d, last: !next || next.depth < d.depth };
  }), [descendants]);

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <button onClick={onBack} className="text-xs font-semibold mb-3" style={{ color: 'var(--color-primary-600)' }}>← Back to numbers</button>

      {ancestors.length > 1 && (
        <>
          <div className="text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
            Where it came from
          </div>
          {ancestors.slice().reverse().map((b, i, arr) => (
            <Node key={b.id} b={b} depth={i} last={i === arr.length - 1} isCurrent={i === arr.length - 1} />
          ))}
          <div className="h-3" />
        </>
      )}

      <div className="text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
        Where it went ({Math.max(0, rows.length - 1)} onward {rows.length === 2 ? 'hop' : 'hops'})
      </div>
      {rows.length <= 1 ? (
        <div className="text-sm rounded-xl px-3 py-6 text-center" style={{ border: '1px dashed var(--color-border)', color: 'var(--color-text-tertiary)' }}>
          Not passed on yet — every number is still in this batch.
        </div>
      ) : rows.map((b, i) => (
        <Node key={b.id} b={b} depth={b.depth} last={b.last} isCurrent={i === 0} />
      ))}
    </div>
  );
}

export default Lineage;
