import { useState } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Ban, ChevronDown, RefreshCw } from 'lucide-react';
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

// Per-row diff line for the Updates collapsible. Renders a checkbox so the
// superadmin can opt OUT of any single update; defaults checked when the row
// has changes. Identical rows (no changes) skip the checkbox — nothing to opt
// in on. Shows each change as `field: prev → next` with strike-through prev.
const updateLine = (updateDecisions, toggleUpdate, allowUpdates) => (u, i) => {
  const changes = Array.isArray(u.changes) ? u.changes : [];
  const hasChanges = changes.length > 0;
  const checked = hasChanges ? !!updateDecisions[i] : false;
  const disabled = !hasChanges || !allowUpdates;
  return (
    <label key={i} className="flex items-start gap-2 text-xs py-1.5 px-2 rounded cursor-pointer" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', opacity: !allowUpdates && hasChanges ? 0.5 : 1 }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={() => toggleUpdate(i)}
        className="mt-0.5"
      />
      <div className="flex-1 min-w-0">
        <div>
          <strong style={{ color: 'var(--color-text)' }}>{u.cli_number || '—'}</strong> · {u.fronter_name || '—'} · {u.company_name || '—'}
          {!hasChanges && <span style={{ color: 'var(--color-text-tertiary)' }}> — no changes (skipped)</span>}
        </div>
        {hasChanges && (
          <ul className="mt-1 ml-1 list-disc list-inside space-y-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            {changes.map((c, j) => (
              <li key={j} className="break-all">
                <span style={{ color: 'var(--color-text-tertiary)' }}>{c.field.replace(/^form_data\./, '')}:</span>{' '}
                <span style={{ textDecoration: 'line-through', opacity: 0.6 }}>{String(c.prev || '—')}</span>
                {' → '}
                <strong style={{ color: 'var(--color-text)' }}>{String(c.next || '—')}</strong>
              </li>
            ))}
          </ul>
        )}
      </div>
    </label>
  );
};

const ValidationSummary = ({
  results, decisions, toggleConflict, setAllConflicts,
  updateDecisions = {}, allowUpdates = true, setAllowUpdates = () => {},
  toggleUpdate = () => {}, setAllUpdates = () => {},
  onConfirm, onBack, busy,
}) => {
  const { clean, updates = [], trueDuplicates, conflicts, unmatched, invalid } = results;
  const includedConflicts = conflicts.filter((_, i) => decisions[i]).length;
  const updatesWithChanges = updates.filter(u => Array.isArray(u.changes) && u.changes.length > 0);
  const updatesUnchanged   = updates.length - updatesWithChanges.length;
  // Count updates that will actually run: master toggle ON, per-row checked, diff non-empty.
  const includedUpdateCount = !allowUpdates ? 0 : updates.reduce(
    (acc, u, i) => acc + ((Array.isArray(u.changes) && u.changes.length > 0 && updateDecisions[i]) ? 1 : 0),
    0
  );
  const toInsert = clean.length + includedConflicts;
  const toUpdate = includedUpdateCount;
  const total    = toInsert + toUpdate;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2.5">
        <Stat icon={CheckCircle2} color="var(--color-success-600)" count={clean.length} label="Ready to insert" />
        <Stat icon={RefreshCw} color="var(--color-primary-600)" count={toUpdate} label={updatesUnchanged ? `Updates (+${updatesUnchanged} unchanged)` : 'Updates (existing records)'} />
        <Stat icon={AlertTriangle} color="#d97706" count={conflicts.length} label="Conflicts (you choose)" />
        <Stat icon={XCircle} color="var(--color-error-600)" count={trueDuplicates.length} label="In-file dups (skipped)" />
        <Stat icon={Ban} color="var(--color-text-tertiary)" count={unmatched.length + invalid.length} label="Unmatched / invalid" />
      </div>

      {conflicts.length > 0 && (
        <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--color-warning-50, #fffbeb)', border: '1px solid var(--color-warning-200, #fde68a)' }}>
          <h4 className="text-sm font-bold mb-3 flex items-center gap-1.5" style={{ color: '#b45309' }}><AlertTriangle size={15} /> Conflicts — review each</h4>
          <ConflictResolver conflicts={conflicts} decisions={decisions} toggleConflict={toggleConflict} setAllConflicts={setAllConflicts} />
        </div>
      )}

      {updates.length > 0 && (
        <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--color-primary-50, #eef2ff)', border: '1px solid var(--color-primary-200, #c7d2fe)' }}>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={allowUpdates}
              onChange={(e) => setAllowUpdates(e.target.checked)}
              className="mt-0.5"
            />
            <div className="flex-1">
              <p className="text-sm font-bold flex items-center gap-1.5" style={{ color: 'var(--color-primary-700, #4338ca)' }}>
                <RefreshCw size={14} /> Allow updates on duplicate matches
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                When ON, rows that match an existing transfer by phone + fronter + company update that record. Mapped fields with a value get patched. Unmapped or blank fields are preserved as-is — your DB Miles stays if the file has no Miles column. created_at, assigned closer, and workflow status stay locked.
              </p>
              {allowUpdates && updatesWithChanges.length > 0 && (
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span style={{ color: 'var(--color-text-tertiary)' }}>Per row:</span>
                  <button type="button" onClick={() => setAllUpdates(true)}  className="px-2 py-0.5 rounded border" style={{ borderColor: 'var(--color-primary-300)', color: 'var(--color-primary-700)' }}>Select all</button>
                  <button type="button" onClick={() => setAllUpdates(false)} className="px-2 py-0.5 rounded border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Clear</button>
                </div>
              )}
            </div>
          </label>
        </div>
      )}

      <Collapsible icon={RefreshCw} color="var(--color-primary-600)" title="Updates (existing records to be patched)" rows={updates} render={updateLine(updateDecisions, toggleUpdate, allowUpdates)} />
      <Collapsible icon={XCircle} color="var(--color-error-600)" title="In-file duplicates (same row twice — skipped)" rows={trueDuplicates} render={rowLine} />
      <Collapsible icon={Ban} color="var(--color-text-tertiary)" title="Unmatched (fronter/company not found)" rows={unmatched} render={rowLine} />
      <Collapsible icon={Ban} color="var(--color-text-tertiary)" title="Invalid (missing required fields)" rows={invalid} render={rowLine} />

      <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          <strong style={{ color: 'var(--color-text)' }}>{toInsert}</strong> insert{toInsert !== 1 ? 's' : ''}
          {' · '}
          <strong style={{ color: 'var(--color-text)' }}>{toUpdate}</strong> update{toUpdate !== 1 ? 's' : ''}
          {includedConflicts > 0 && <> ({clean.length} clean + {includedConflicts} conflict{includedConflicts !== 1 ? 's' : ''})</>}
          {updatesUnchanged > 0 && <> · {updatesUnchanged} unchanged</>}
        </p>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={onBack}>Back</Button>
          <Button variant="primary" onClick={onConfirm} disabled={busy || total === 0}>
            {busy ? 'Applying…' : `Apply ${total} record${total !== 1 ? 's' : ''}`}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ValidationSummary;
