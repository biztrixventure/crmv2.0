import { useState } from 'react';
import { CheckCircle2, RefreshCw, XCircle, AlertTriangle, Ban, ChevronDown } from 'lucide-react';
import { Button } from '../../UI';
import SaleUpdateReviewer from './SaleUpdateReviewer';

const Stat = ({ icon: Icon, color, count, label }) => (
  <div className="flex items-center gap-3 rounded-xl px-4 py-3 flex-1 min-w-[130px]" style={{ backgroundColor: 'var(--color-surface)', border: `1px solid ${color}` }}>
    <Icon size={20} style={{ color }} />
    <div><p className="text-xl font-bold" style={{ color: 'var(--color-text)' }}>{count}</p><p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{label}</p></div>
  </div>
);

const Collapsible = ({ icon: Icon, color, title, rows }) => {
  const [open, setOpen] = useState(false);
  if (!rows.length) return null;
  return (
    <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between p-3">
        <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--color-text)' }}><Icon size={15} style={{ color }} /> {title} ({rows.length})</span>
        <ChevronDown size={16} className="transition-transform" style={{ color: 'var(--color-text-tertiary)', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && (
        <div className="px-3 pb-3 max-h-64 overflow-y-auto space-y-1">
          {rows.map((r, i) => (
            <div key={i} className="text-xs py-1 px-2 rounded" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
              <strong style={{ color: 'var(--color-text)' }}>{r.cli_number || r.customer_phone || '—'}</strong> · {r.fronter_name || '—'} · {r.company_name || '—'}
              {r.reason && <span style={{ color: 'var(--color-error-600)' }}> — {r.reason}</span>}
              {!r.reason && r.match_note && <span style={{ color: '#7c3aed' }}> — {r.match_note}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const SaleValidationSummary = ({ results, decisions, toggleUpdate, setAllUpdates, onConfirm, onBack, busy }) => {
  const { newSales, updates, skipped, unmatched, ambiguous, invalid } = results;
  const includedUpdates = updates.filter((_, i) => decisions[i]).length;
  const total = newSales.length + includedUpdates;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2.5">
        <Stat icon={CheckCircle2} color="var(--color-success-600)" count={newSales.length} label="New sales" />
        <Stat icon={RefreshCw} color="#2563eb" count={updates.length} label="Updates (review)" />
        <Stat icon={XCircle} color="var(--color-error-600)" count={skipped.length} label="True duplicates" />
        <Stat icon={AlertTriangle} color="#d97706" count={ambiguous.length} label="Ambiguous" />
        <Stat icon={Ban} color="var(--color-text-tertiary)" count={unmatched.length + (invalid?.length || 0)} label="Unmatched / invalid" />
      </div>

      {updates.length > 0 && (
        <div className="rounded-2xl p-4" style={{ backgroundColor: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.25)' }}>
          <h4 className="text-sm font-bold mb-3 flex items-center gap-1.5" style={{ color: '#2563eb' }}><RefreshCw size={15} /> Existing sales — review each update</h4>
          <SaleUpdateReviewer updates={updates} decisions={decisions} toggleUpdate={toggleUpdate} setAllUpdates={setAllUpdates} />
        </div>
      )}

      <Collapsible icon={AlertTriangle} color="#7c3aed" title="Auto-matched — please review (fronter/duplicate/new-car)" rows={newSales.filter(r => r.match_note)} />
      <Collapsible icon={XCircle} color="var(--color-error-600)" title="True duplicates (auto-skipped)" rows={skipped} />
      <Collapsible icon={AlertTriangle} color="#d97706" title="Ambiguous (multiple transfers/sales match)" rows={ambiguous} />
      <Collapsible icon={Ban} color="var(--color-text-tertiary)" title="Unmatched (no transfer found)" rows={unmatched} />
      <Collapsible icon={Ban} color="var(--color-text-tertiary)" title="Invalid (missing required fields)" rows={invalid || []} />

      <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          <strong style={{ color: 'var(--color-text)' }}>{newSales.length}</strong> new + <strong style={{ color: 'var(--color-text)' }}>{includedUpdates}</strong> update{includedUpdates !== 1 ? 's' : ''} will be applied
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

export default SaleValidationSummary;
