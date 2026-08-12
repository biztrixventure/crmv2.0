import { useState, useEffect, useMemo } from 'react';
import { ListChecks, Search, ArrowUp, ArrowDown } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';
import ThemedSelect from '../UI/Select';
import { TableScroll } from '../UI/kit';
import { fmtSaleDate } from '../../utils/timezone';
import { Overlay, ModalHeader, fetchAllForExport } from './shared';

const DP_OPTIONS = [
  { value: '', label: 'No change' },
  { value: 'pending', label: 'Pending' },
  { value: 'paid', label: 'Paid' },
  { value: 'reverted', label: 'Reverted' },
];
const PAYOUT_OPTIONS = [
  { value: '', label: 'No change' },
  { value: 'pending', label: 'Pending' },
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];
// A raw checkbox can only mean "set to true" — no way to leave 10,000 rows'
// paid_to_closer alone. A 3-way dropdown adds the "don't touch it" option
// the same way the DP/Payout Status dropdowns already do.
const PAID_OPTIONS = [
  { value: '', label: 'No change' },
  { value: 'yes', label: 'Checked (paid)' },
  { value: 'no', label: 'Unchecked (not paid)' },
];

const money = (v) => (v == null || v === '' ? '—' : `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);

// Every sortable column + how to read its sort value off a row, plus which
// ones default to descending on first click (dates/money — newest/highest
// first reads better than ascending) vs ascending (text).
const SORT_COLS = {
  customer_name:    { get: r => (r.customer_name || '').toLowerCase(), dir: 'asc' },
  customer_phone:   { get: r => r.customer_phone || '', dir: 'asc' },
  client_name:      { get: r => (r.client_name || '').toLowerCase(), dir: 'asc' },
  sale_date:        { get: r => r.sale_date || '', dir: 'desc' },
  down_payment:     { get: r => Number(r.down_payment) || 0, dir: 'desc' },
  payout_status:    { get: r => r.payout_status || 'pending', dir: 'asc' },
  payout_confirmed: { get: r => r.payout_confirmed || 'pending', dir: 'asc' },
};

// Clickable column header — local (in-memory) sort only, since the modal
// already holds every row matching the tab's filters. Distinct from the
// server-driven TqTh/ColumnHeader the main Sales table uses.
const SortTh = ({ col, sortBy, sortDir, onSort, align = 'left', children }) => {
  const active = sortBy === col;
  const Icon = sortDir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className={`px-3 py-2 text-${align} text-xs font-bold select-none cursor-pointer`}
      style={{ color: active ? 'var(--color-text)' : 'var(--color-text-tertiary)' }}
      onClick={() => onSort(col)}>
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        {children}
        {active && <Icon size={11} />}
      </span>
    </th>
  );
};

// Compliance Sales tab → "Bulk Update". Loads every sale matching the tab's
// current filters (same params the CSV/PDF export already uses, so the row
// count here matches what's on screen) and lets a superadmin apply DP
// Status / Payout Status / Paid-to-closer to a selected subset in one call.
const BulkPayoutUpdateModal = ({ fetchParams, onClose, onDone }) => {
  const [rows, setRows] = useState([]);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [dpStatus, setDpStatus] = useState('');
  const [payoutConfirmed, setPayoutConfirmed] = useState('');
  const [paidToCloser, setPaidToCloser] = useState('');
  const [paidToPartner, setPaidToPartner] = useState('');
  const [saving, setSaving] = useState(false);
  // Local search/sort — this modal already holds every row matching the
  // tab's filters, so narrowing further is a client-side operation, not a
  // new server round-trip.
  const [q, setQ] = useState('');
  const [sortBy, setSortBy] = useState('sale_date');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setRowsLoading(true);
      try {
        const data = await fetchAllForExport('compliance/sales', fetchParams, 'sales');
        if (cancelled) return;
        setRows(data);
        setSelected(new Set(data.map(r => r.id)));   // select-all by default
      } catch (err) {
        if (!cancelled) setLoadErr(err.message || 'Failed to load matching sales');
      } finally { if (!cancelled) setRowsLoading(false); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const displayRows = useMemo(() => {
    let out = rows;
    const term = q.trim().toLowerCase();
    if (term) {
      out = out.filter(r =>
        (r.customer_name || '').toLowerCase().includes(term) ||
        (r.customer_phone || '').toLowerCase().includes(term) ||
        (r.client_name || '').toLowerCase().includes(term) ||
        (r.reference_no || '').toLowerCase().includes(term));
    }
    const col = SORT_COLS[sortBy];
    if (col) {
      out = [...out].sort((a, b) => {
        const av = col.get(a), bv = col.get(b);
        if (av < bv) return sortDir === 'asc' ? -1 : 1;
        if (av > bv) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return out;
  }, [rows, q, sortBy, sortDir]);

  const onSort = (col) => {
    if (sortBy === col) { setSortDir(d => (d === 'asc' ? 'desc' : 'asc')); return; }
    setSortBy(col);
    setSortDir(SORT_COLS[col].dir);
  };

  // Select-all only ever acts on what's currently visible (search-filtered)
  // — rows hidden by the search box keep whatever selection they already had.
  const allVisibleSelected = displayRows.length > 0 && displayRows.every(r => selected.has(r.id));
  const toggleAll = () => setSelected(prev => {
    const next = new Set(prev);
    displayRows.forEach(r => (allVisibleSelected ? next.delete(r.id) : next.add(r.id)));
    return next;
  });
  const toggleOne = (id) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const noFieldChosen = !dpStatus && !payoutConfirmed && !paidToCloser && !paidToPartner;

  const submit = async () => {
    if (!selected.size || noFieldChosen) return;
    setSaving(true);
    try {
      const { data } = await client.patch('payouts/bulk', {
        ids: Array.from(selected),
        payout_status: dpStatus || undefined,
        payout_confirmed: payoutConfirmed || undefined,
        paid_to_closer: paidToCloser === '' ? undefined : paidToCloser === 'yes',
        paid_to_partner: paidToPartner === '' ? undefined : paidToPartner === 'yes',
      });
      toast.success(`Updated ${data.updated}${data.skipped ? `, skipped ${data.skipped}` : ''}`);
      onDone();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Bulk update failed');
    } finally { setSaving(false); }
  };

  return (
    <Overlay>
      <div className="w-full max-w-4xl h-dvh sm:h-auto sm:max-h-[85vh] rounded-none sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <ModalHeader icon={ListChecks} title="Bulk Update"
          subtitle={rowsLoading ? 'Loading matching sales…' : `${rows.length.toLocaleString()} sale${rows.length === 1 ? '' : 's'} match the current filters`}
          onClose={onClose} />

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {loadErr ? (
            <p className="text-sm" style={{ color: 'var(--color-error-600)' }}>{loadErr}</p>
          ) : rowsLoading ? (
            <div className="flex justify-center py-10">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2" style={{ borderColor: 'var(--color-primary-600)' }} />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm py-6 text-center" style={{ color: 'var(--color-text-tertiary)' }}>No sales match the current filters.</p>
          ) : (
            <>
              <div className="relative max-w-xs">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
                <input value={q} onChange={e => setQ(e.target.value)}
                  placeholder="Search name, phone, client…"
                  className="input text-sm w-full" style={{ paddingLeft: 30 }} />
              </div>
              <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
                <TableScroll label="Bulk update candidates">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                        <th className="px-3 py-2 text-left">
                          <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} aria-label="Select all" />
                        </th>
                        <SortTh col="customer_name" sortBy={sortBy} sortDir={sortDir} onSort={onSort}>Customer</SortTh>
                        <SortTh col="customer_phone" sortBy={sortBy} sortDir={sortDir} onSort={onSort}>Phone</SortTh>
                        <SortTh col="client_name" sortBy={sortBy} sortDir={sortDir} onSort={onSort}>Client</SortTh>
                        <SortTh col="sale_date" sortBy={sortBy} sortDir={sortDir} onSort={onSort}>Sale Date</SortTh>
                        <SortTh col="down_payment" sortBy={sortBy} sortDir={sortDir} onSort={onSort} align="right">DP</SortTh>
                        <SortTh col="payout_status" sortBy={sortBy} sortDir={sortDir} onSort={onSort}>DP Status</SortTh>
                        <SortTh col="payout_confirmed" sortBy={sortBy} sortDir={sortDir} onSort={onSort}>Payout Status</SortTh>
                      </tr>
                    </thead>
                    <tbody>
                      {displayRows.map(r => (
                        <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                          <td className="px-3 py-1.5">
                            <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} aria-label={`Select ${r.customer_name || r.id}`} />
                          </td>
                          <td className="px-3 py-1.5 text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{r.customer_name || '—'}</td>
                          <td className="px-3 py-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{r.customer_phone || '—'}</td>
                          <td className="px-3 py-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{r.client_name || '—'}</td>
                          <td className="px-3 py-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{r.sale_date ? fmtSaleDate(r.sale_date) : '—'}</td>
                          <td className="px-3 py-1.5 text-xs text-right tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{money(r.down_payment)}</td>
                          <td className="px-3 py-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{r.payout_status || 'pending'}</td>
                          <td className="px-3 py-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{r.payout_confirmed || 'pending'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
              </div>
              <p className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                {selected.size.toLocaleString()} selected
                {q.trim() ? ` · ${displayRows.length.toLocaleString()} shown of ${rows.length.toLocaleString()}` : ` of ${rows.length.toLocaleString()}`}
              </p>
            </>
          )}
        </div>

        {/* Footer controls — one set applied to every selected row. */}
        <div className="flex-shrink-0 p-4 sm:p-6 grid grid-cols-1 sm:grid-cols-4 gap-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--color-text)' }}>DP Status</label>
            <ThemedSelect value={dpStatus} onChange={e => setDpStatus(e.target.value)} className="input text-sm w-full">
              {DP_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </ThemedSelect>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--color-text)' }}>Payout Status</label>
            <ThemedSelect value={payoutConfirmed} onChange={e => setPayoutConfirmed(e.target.value)} className="input text-sm w-full">
              {PAYOUT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </ThemedSelect>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--color-text)' }}>Paid to closer</label>
            <ThemedSelect value={paidToCloser} onChange={e => setPaidToCloser(e.target.value)} className="input text-sm w-full">
              {PAID_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </ThemedSelect>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--color-text)' }}>Paid to Partner</label>
            <ThemedSelect value={paidToPartner} onChange={e => setPaidToPartner(e.target.value)} className="input text-sm w-full">
              {PAID_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </ThemedSelect>
          </div>
          <div className="sm:col-span-4 flex gap-3">
            <button onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border font-semibold text-sm"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Cancel</button>
            <button onClick={submit} disabled={saving || !selected.size || noFieldChosen}
              title={noFieldChosen ? 'Pick at least one field to change' : (!selected.size ? 'Select at least one row' : undefined)}
              className="flex-1 py-2.5 rounded-xl font-semibold text-sm text-white disabled:opacity-50"
              style={{ background: 'var(--gradient-sidebar)' }}>
              {saving ? 'Updating…' : `Update ${selected.size.toLocaleString()} Selected`}
            </button>
          </div>
        </div>
      </div>
    </Overlay>
  );
};

export default BulkPayoutUpdateModal;
