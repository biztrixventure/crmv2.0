import { useState } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Ban, ChevronDown } from 'lucide-react';
import { Button } from '../../UI';
import ConflictResolver from './ConflictResolver';

const Stat = ({ icon: Icon, color, count, label }) => (
  <div className="flex items-center gap-3 rounded-xl px-4 py-3 flex-1 min-w-[140px]" style={{ backgroundColor: 'var(--color-surface)', border: `1px solid ${color}` }}>
    <Icon size={20} style={{ color }} />
    <div><p className="text-xl font-bold" style={{ color: 'var(--color-text)' }}>{count}</p><p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{label}</p></div>
  </div>
);

const Collapsible = ({ icon: Icon, color, title, rows, render }) => {
  const [open, setOpen] = useState(false);
  if (!rows.length) return null;
  return (
    <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between p-3">
        <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
          <Icon size={15} style={{ color }} /> {title} ({rows.length})
        </span>
        <ChevronDown size={16} className="transition-transform" style={{ color: 'var(--color-text-tertiary)', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && <div className="px-3 pb-3 max-h-64 overflow-y-auto space-y-1">{rows.map(render)}</div>}
    </div>
  );
};

const rowLine = (r, i) => (
  <div key={i} className="text-xs py-1 px-2 rounded" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
    <strong style={{ color: 'var(--color-text)' }}>{r.cli_number || '—'}</strong> · {r.fronter_name || '—'} · {r.company_name || '—'}
    {r.reason && <span style={{ color: 'var(--color-error-600)' }}> — {r.reason}</span>}
  </div>
);

const ValidationSummary = ({ results, decisions, toggleConflict, setAllConflicts, onConfirm, onBack, busy }) => {
  const { clean, trueDuplicates, conflicts, unmatched, invalid } = results;
  const includedConflicts = conflicts.filter((_, i) => decisions[i]).length;
  const toInsert = clean.length + includedConflicts;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2.5">
        <Stat icon={CheckCircle2} color="var(--color-success-600)" count={clean.length} label="Ready to insert" />
        <Stat icon={AlertTriangle} color="#d97706" count={conflicts.length} label="Conflicts (you choose)" />
        <Stat icon={XCircle} color="var(--color-error-600)" count={trueDuplicates.length} label="True duplicates (skipped)" />
        <Stat icon={Ban} color="var(--color-text-tertiary)" count={unmatched.length + invalid.length} label="Unmatched / invalid" />
      </div>

      {conflicts.length > 0 && (
        <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--color-warning-50, #fffbeb)', border: '1px solid var(--color-warning-200, #fde68a)' }}>
          <h4 className="text-sm font-bold mb-3 flex items-center gap-1.5" style={{ color: '#b45309' }}><AlertTriangle size={15} /> Conflicts — review each</h4>
          <ConflictResolver conflicts={conflicts} decisions={decisions} toggleConflict={toggleConflict} setAllConflicts={setAllConflicts} />
        </div>
      )}

      <Collapsible icon={XCircle} color="var(--color-error-600)" title="True duplicates (auto-skipped)" rows={trueDuplicates} render={rowLine} />
      <Collapsible icon={Ban} color="var(--color-text-tertiary)" title="Unmatched (fronter/company not found)" rows={unmatched} render={rowLine} />
      <Collapsible icon={Ban} color="var(--color-text-tertiary)" title="Invalid (missing required fields)" rows={invalid} render={rowLine} />

      <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          <strong style={{ color: 'var(--color-text)' }}>{toInsert}</strong> record{toInsert !== 1 ? 's' : ''} will be inserted
          {includedConflicts > 0 && <> ({clean.length} clean + {includedConflicts} conflict{includedConflicts !== 1 ? 's' : ''})</>}
        </p>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={onBack}>Back</Button>
          <Button variant="primary" onClick={onConfirm} disabled={busy || toInsert === 0}>
            {busy ? 'Inserting…' : `Insert ${toInsert} record${toInsert !== 1 ? 's' : ''}`}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ValidationSummary;
