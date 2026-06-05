import { useState } from 'react';
import { CheckCircle2, RefreshCw, XCircle, AlertTriangle, Ban, ChevronDown, Wand2, Plus, ArrowRight, UserX } from 'lucide-react';
import { Button } from '../../UI';
import SaleUpdateReviewer from './SaleUpdateReviewer';

const Stat = ({ icon: Icon, color, count, label }) => (
  <div className="flex items-center gap-3 rounded-xl px-4 py-3 flex-1 min-w-[130px]" style={{ backgroundColor: 'var(--color-surface)', border: `1px solid ${color}` }}>
    <Icon size={20} style={{ color }} />
    <div><p className="text-xl font-bold" style={{ color: 'var(--color-text)' }}>{count}</p><p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{label}</p></div>
  </div>
);

const fmtDate = (s) => s ? new Date(s).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const rowLabel = (r) => `${r.cli_number || r.customer_phone || '—'} · ${r.fronter_name || '—'} · ${r.company_name || '—'}`;
const transferText = (t) => `${fmtDate(t.created_at)} · ${t.status || '—'} · ${t.customer} · ${t.car}${t.sales_count ? ` · ${t.sales_count} sale(s)` : ''}`;

const Collapsible = ({ icon: Icon, color, title, rows, render }) => {
  const [open, setOpen] = useState(false);
  if (!rows.length) return null;
  return (
    <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between p-3">
        <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--color-text)' }}><Icon size={15} style={{ color }} /> {title} ({rows.length})</span>
        <ChevronDown size={16} className="transition-transform" style={{ color: 'var(--color-text-tertiary)', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && <div className="px-3 pb-3 max-h-72 overflow-y-auto space-y-1">{rows.map(render)}</div>}
    </div>
  );
};

// Cards for auto-matched NEW sales: show the picked transfer + let the user
// switch to another candidate (duplicate transfers for the same phone).
const AutoMatchedReview = ({ newSales, onChangeTransfer }) => {
  const items = newSales.map((r, idx) => ({ r, idx })).filter(x => x.r.match_note || x.r.resell_of || x.r.client_switch || (x.r.candidate_transfers || []).length > 1);
  // Rows whose vehicle didn't match any transfer go first — they need a human look.
  items.sort((a, b) => (b.r.match_warning ? 1 : 0) - (a.r.match_warning ? 1 : 0));
  const warnCount = items.filter(x => x.r.match_warning).length;
  const resellCount = items.filter(x => x.r.resell_of).length;
  const [open, setOpen] = useState(warnCount > 0);   // auto-expand when something needs attention
  if (!items.length) return null;

  return (
    <div className="rounded-2xl p-4" style={{ backgroundColor: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.25)' }}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-bold" style={{ color: '#7c3aed' }}>
          <Wand2 size={15} /> Auto-matched — review what the system picked ({items.length})
          {warnCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded text-[11px] font-bold flex items-center gap-1" style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>
              <AlertTriangle size={11} /> {warnCount} need{warnCount === 1 ? 's' : ''} attention
            </span>
          )}
          {resellCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded text-[11px] font-bold flex items-center gap-1"
              style={{ backgroundColor: '#ede9fe', color: '#6d28d9' }}>
              ♻ {resellCount} resell{resellCount === 1 ? '' : 's'}
            </span>
          )}
        </span>
        <ChevronDown size={16} className="transition-transform" style={{ color: '#7c3aed', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && (
        <div className="mt-3 space-y-2 max-h-96 overflow-y-auto">
          {items.map(({ r, idx }) => (
            <div key={idx} className="rounded-xl p-3" style={r.match_warning
              ? { backgroundColor: '#fffbeb', border: '1px solid #fbbf24' }
              : { backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <p className="text-sm font-semibold flex items-center gap-1.5 flex-wrap" style={{ color: 'var(--color-text)' }}>
                {r.match_warning && <AlertTriangle size={13} style={{ color: '#d97706', flexShrink: 0 }} />}
                {r.customer_name || '—'} <span className="font-normal text-xs" style={{ color: 'var(--color-text-tertiary)' }}>· {rowLabel(r)}</span>
                {r.resell_of && !r.is_renewal && (
                  <span className="inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: '#ede9fe', color: '#6d28d9', border: '1px solid #c4b5fd' }}
                    title={`Previous sale: ${r.resell_of.reference_no || '—'} · ${r.resell_of.status} · ${r.resell_of.client_name || '—'}`}>
                    ♻ Resell of {r.resell_of.reference_no || r.resell_of.id?.slice(0,8)}
                    {r.resell_of.cancelled_at && ` · cancelled ${r.resell_of.cancelled_at}`}
                    {!r.resell_of.cancelled_at && r.resell_of.status && ` · ${r.resell_of.status}`}
                  </span>
                )}
                {r.is_renewal && r.resell_of && (
                  <span className="inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: '#ccfbf1', color: '#0f766e', border: '1px solid #5eead4' }}
                    title={`Previous term: ${r.resell_of.reference_no || '—'} · ${r.resell_of.sale_date || '—'}`}>
                    🔁 Renewal of {r.resell_of.reference_no || r.resell_of.id?.slice(0,8)} · {r.resell_of.sale_date || '—'}
                  </span>
                )}
                {r.client_switch && (
                  <span className="inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: '#dbeafe', color: '#1d4ed8', border: '1px solid #93c5fd' }}>
                    ↔ Client switch
                  </span>
                )}
              </p>
              {r.match_note && <p className="text-xs mt-0.5" style={{ color: r.match_warning ? '#b45309' : '#7c3aed' }}>{r.match_note}</p>}
              <div className="flex items-center gap-2 mt-2 text-xs">
                <ArrowRight size={13} style={{ color: 'var(--color-text-tertiary)' }} />
                {(r.candidate_transfers || []).length > 1 ? (
                  <select
                    value={r.chosen_transfer_id || r.matched_transfer?.id || ''}
                    onChange={e => onChangeTransfer(idx, e.target.value)}
                    className="input"
                    style={{ height: 34, fontSize: 12, maxWidth: '100%' }}
                  >
                    {r.candidate_transfers.map(t => <option key={t.id} value={t.id}>{transferText(t)}</option>)}
                  </select>
                ) : (
                  <span style={{ color: 'var(--color-text-secondary)' }}>{r.matched_transfer ? transferText(r.matched_transfer) : 'matched transfer'}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Unmatched rows: when the company+fronter resolve (reason starts "No transfer"),
// offer to create the transfer inline; name-resolution errors get a hint.
const UnmatchedFixer = ({ unmatched, onCreateTransfer }) => {
  const [busyIdx, setBusyIdx] = useState(null);
  const [open, setOpen] = useState(true);
  if (!unmatched.length) return null;

  const run = async (idx) => { setBusyIdx(idx); try { await onCreateTransfer(idx); } finally { setBusyIdx(null); } };

  return (
    <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-bold" style={{ color: 'var(--color-text)' }}><Ban size={15} style={{ color: 'var(--color-text-tertiary)' }} /> Unmatched — fix on this page ({unmatched.length})</span>
        <ChevronDown size={16} className="transition-transform" style={{ color: 'var(--color-text-tertiary)', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && (
        <div className="mt-3 space-y-1.5 max-h-96 overflow-y-auto">
          {unmatched.map((r, idx) => {
            const canCreate = /^No transfer/.test(r.reason || '');
            const nameProblem = /^No (fronter|closer)/.test(r.reason || '');
            return (
              <div key={idx} className="flex items-center gap-3 rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate" style={{ color: 'var(--color-text)' }}>{r.customer_name || '—'} · {rowLabel(r)}</p>
                  <p className="text-xs truncate" style={{ color: nameProblem ? 'var(--color-error-600)' : 'var(--color-text-tertiary)' }}>{r.reason}</p>
                </div>
                {canCreate ? (
                  <Button size="sm" variant="primary" disabled={busyIdx === idx} onClick={() => run(idx)} className="flex items-center gap-1.5 flex-shrink-0">
                    <Plus size={13} /> {busyIdx === idx ? 'Creating…' : 'Create transfer'}
                  </Button>
                ) : nameProblem ? (
                  <span className="flex items-center gap-1 text-xs flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}><UserX size={13} /> fix name / add user</span>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const SaleValidationSummary = ({ results, decisions, toggleUpdate, setAllUpdates, onChangeTransfer, onCreateTransfer, onConfirm, onBack, busy }) => {
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

      <AutoMatchedReview newSales={newSales} onChangeTransfer={onChangeTransfer} />

      {updates.length > 0 && (
        <div className="rounded-2xl p-4" style={{ backgroundColor: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.25)' }}>
          <h4 className="text-sm font-bold mb-3 flex items-center gap-1.5" style={{ color: '#2563eb' }}><RefreshCw size={15} /> Existing sales — review each update</h4>
          <SaleUpdateReviewer updates={updates} decisions={decisions} toggleUpdate={toggleUpdate} setAllUpdates={setAllUpdates} />
        </div>
      )}

      <UnmatchedFixer unmatched={unmatched} onCreateTransfer={onCreateTransfer} />

      <Collapsible icon={XCircle} color="var(--color-error-600)" title="True duplicates (auto-skipped)" rows={skipped}
        render={(r, i) => <div key={i} className="text-xs py-1 px-2 rounded" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>{rowLabel(r)}{r.reason && <span> — {r.reason}</span>}</div>} />
      <Collapsible icon={AlertTriangle} color="#d97706" title="Ambiguous (needs a Ref No / VIN to disambiguate)" rows={ambiguous}
        render={(r, i) => <div key={i} className="text-xs py-1 px-2 rounded" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>{rowLabel(r)}{r.reason && <span style={{ color: '#d97706' }}> — {r.reason}</span>}</div>} />
      <Collapsible icon={Ban} color="var(--color-text-tertiary)" title="Invalid (missing required fields)" rows={invalid || []}
        render={(r, i) => <div key={i} className="text-xs py-1 px-2 rounded" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>{rowLabel(r)}{r.reason && <span style={{ color: 'var(--color-error-600)' }}> — {r.reason}</span>}</div>} />

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
