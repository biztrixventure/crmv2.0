import { useState, useCallback, useEffect, useRef, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { useFocus, useNavFocus } from '../../contexts/FocusContext';
import { useSaleDeepLink } from '../../hooks/useSaleDeepLink';
import { Shield, RotateCcw, Trash2, Eye, ChevronDown, ChevronUp, CheckCircle, Pencil, MoreVertical, Clock, CheckCircle2, XCircle, Download, FileDown, ListChecks } from 'lucide-react';
import { Badge } from '../UI';
import SaleStatusBadge from '../UI/SaleStatusBadge';
import { toast } from 'sonner';
import client from '../../api/client';
import SaleDetailDrawer from '../Shared/SaleDetailDrawer';
import SaleModal from '../Closer/SaleModal';
import ExportModal from './ExportModal';
import BulkPayoutUpdateModal from './BulkPayoutUpdateModal';
import { TableScroll, KpiTile, accent } from '../UI/kit';
import FilterBar, { FilterSelect, MultiFilterSelect } from '../UI/FilterBar';
import DateRangePicker, { getPresetRange } from '../UI/DateRangePicker';
import TabStatsStrip from './TabStatsStrip';
import { prettyDispo } from '../../utils/dispositions';
import { fmtSaleDate } from '../../utils/timezone';
import { useAuth } from '../../contexts/AuthContext';
import { useComplianceStatuses } from '../../hooks/useComplianceStatuses';
import { useCancellationReasons } from '../../hooks/useCancellationReasons';
import { useSaleHighlight } from '../../hooks/useSaleHighlight';
import { salePaidTenure } from '../../utils/saleTenure';
import { writeExport } from '../../utils/exportSpec';
import { buildFilename } from '../../utils/downloadFilename';
import { useExportColumns } from '../../hooks/useExportColumns';
import ThemedSelect from '../UI/Select';
import ThemedDate from '../UI/ThemedDate';
import {
  STATUS_BADGE, STATUS_LABEL, ALL_SALE_STATUSES as FALLBACK_ALL, COMPLIANCE_EDIT_STATUSES as FALLBACK_EDIT, LIMIT,
  fmtDate, closerName,
  TabHeader, Spinner, Empty, ActiveFilters, Pagination, Th, TqTh, Filters, FInput, FSelect,
  Overlay, ModalBox, ModalHeader, fetchAllForExport,
} from './shared';
import { useTableQuery, useAbortable, isCanceled } from '../../hooks/useTableQuery';
import { useFilterOptions } from '../../hooks/useFilterOptions';

// A timestamptz rendered in the VIEWER's timezone. Distinct from fmtSaleDate,
// which slices the leading YYYY-MM-DD off the string: correct for sale_date (a
// DATE column, no zone) but wrong for an instant — a stamp written at 8pm ET is
// already tomorrow in UTC, so slicing would show the wrong day.
const fmtStamp = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString([], {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
};

// When the sale's status was last changed. The edit_history audit trail records
// every status transition with its timestamp — the latest one is the "status
// updated" date (e.g. the moment an approved sale was flipped to cancelled).
// Falls back to updated_at when there's no recorded transition.
const statusUpdatedAt = (s) => {
  const hist = Array.isArray(s?.edit_history) ? s.edit_history : [];
  for (let i = hist.length - 1; i >= 0; i--) {
    const h = hist[i];
    if (h && (h.new_status || h.previous_status)) {
      const ts = h.edited_at || h.at;
      if (ts) return ts;   // keep scanning older entries if this one has no timestamp
    }
  }
  return (s?.updated_at && s.updated_at !== s.created_at) ? s.updated_at : null;
};

const money = (v) => (v == null || v === '' ? '' : `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
const moneyKpi = (v) => `$${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

// Payout section (mig 243/244), merged in from the former standalone Payout
// tab. Two independent fields on the sale, superadmin-only:
//   DP Status (payout_status)        — pending (default) / paid / reverted
//   Payout Status (payout_confirmed) — manual tri-state, pending (default) / yes / no
const PAYOUT_STATUSES = ['pending', 'paid', 'reverted'];
const PAYOUT_LABEL = { pending: 'Pending', paid: 'Paid', reverted: 'Reverted' };
const DP_TINT = {
  pending:  { bg: '#fef3c7', fg: '#b45309' },
  paid:     { bg: '#d1fae5', fg: '#047857' },
  reverted: { bg: '#fee2e2', fg: '#b91c1c' },
};
const PAYOUT_CONFIRMED_STATUSES = ['pending', 'yes', 'no'];
const PAYOUT_CONFIRMED_LABEL = { pending: 'Pending', yes: 'Yes', no: 'No' };
const PAYOUT_CONFIRMED_TINT = {
  pending: { bg: '#fef3c7', fg: '#b45309' },
  yes:     { bg: '#d1fae5', fg: '#047857' },
  no:      { bg: '#f3f4f6', fg: '#6b7280' },
};

// Row overflow menu — Delete / View / Edit / Audit trail tucked behind one
// 3-dot button so the primary compliance workflow buttons (Approve / Return /
// Update / Charge → Sale) aren't crowded by secondary actions. Portalled to
// <body>, same as ColumnHeader's filter popover — a plain absolutely-positioned
// menu would get clipped by TableScroll's horizontal scroll container.
const RowMenu = ({ items }) => {
  const visible = items.filter(Boolean);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      setPos({ top: r.bottom + 4, left: Math.max(8, r.right - 168) });
    };
    place();
    const onDown = (e) => {
      if (menuRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  if (!visible.length) return null;
  return (
    <span className="relative inline-block" onClick={e => e.stopPropagation()}>
      <button ref={btnRef} type="button" onClick={() => setOpen(o => !o)}
        className="p-1 rounded" title="More actions" aria-label="More actions"
        style={{ color: 'var(--color-text-secondary)' }}>
        <MoreVertical size={14} />
      </button>
      {open && pos && createPortal(
        <div ref={menuRef}
          className="rounded-xl overflow-hidden py-1"
          style={{
            position: 'fixed', top: pos.top, left: pos.left, zIndex: 1000, minWidth: 168,
            backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)',
            boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
          }}>
          {visible.map((it, i) => (
            <button key={i} type="button" onClick={() => { setOpen(false); it.onClick(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-left hover:opacity-80"
              style={{ color: it.danger ? '#ef4444' : 'var(--color-text)' }}>
              <it.icon size={13} /> {it.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </span>
  );
};

// Compact, single-card DP Status breakdown — one card, clickable rows (All /
// Pending / Paid / Reverted), each showing its own $ total. Replaced four
// separate KpiTiles per an explicit ask: "combine these into a single kpi
// with the dollar sign." Payout Status (the separate manual tri-state) stays
// three individual KpiTiles with plain counts, no $ — a different field with
// no $ meaning of its own.
const DpStatusCard = ({ rows, width = 168, title = 'DP Status' }) => (
  <div className="rounded-xl p-3 flex-shrink-0" style={{ width, backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
    <p className="text-[11px] font-bold uppercase tracking-widest mb-2 m-0 truncate" style={{ color: 'var(--color-text-tertiary)' }} title={title}>{title}</p>
    <div className="space-y-1">
      {rows.map((r) => {
        const a = accent(r.tone);
        return (
          <button key={r.key} type="button" onClick={r.onClick}
            className="w-full flex items-center justify-between px-2 py-1 rounded-lg text-left transition-colors"
            style={{ backgroundColor: r.active ? a.soft : 'transparent' }}>
            <span className="text-xs font-semibold truncate" style={{ color: r.active ? a.fg : 'var(--color-text-secondary)' }}>{r.label}</span>
            <span className="text-xs font-bold tabular-nums flex-shrink-0 ml-2" style={{ color: a.fg }}>{r.value}</span>
          </button>
        );
      })}
    </div>
  </div>
);

const SalesTab = ({ companyList, initCompany = '', initStatus = '', disposition = '', isPostDate = false }) => {
  const { user, isReadOnly, roControlAllowed } = useAuth();
  // Config-driven status catalog — SuperAdmin → Business Rules → Compliance
  // Workflow drives the dropdowns, labels, and badge colors. labelOf/badgeOf
  // gracefully fall back to a humanized key / 'secondary' so existing records
  // with legacy statuses always render correctly.
  const { allStatuses: cfgAll, editStatuses: cfgEdit, labelOf, badgeOf } = useComplianceStatuses();
  const { activeReasons: cancelReasonChoices } = useCancellationReasons();
  const { cfg: highlightCfg, colorFor: highlightFor, countFor: highlightCountFor } = useSaleHighlight();
  // Superadmin-configured export columns for this user (Data Egress → Fields,
  // or the per-user override in the User Control Center). null = keep this
  // tab's own default column set.
  const { allowedFor } = useExportColumns(['sales']);
  const ALL_SALE_STATUSES        = cfgAll?.length  ? cfgAll  : FALLBACK_ALL;
  const COMPLIANCE_EDIT_STATUSES = cfgEdit?.length ? cfgEdit : FALLBACK_EDIT;
  const [sales, setSales]       = useState([]);
  // Full form-field edit target for compliance — opens SaleModal pre-filled
  // and dispatches PUT /sales/:id on submit. Separate from the existing
  // status-only edit modal (editTarget) which only changes status + reason.
  const [editFieldsTarget, setEditFieldsTarget] = useState(null);
  const [editFieldsSaving, setEditFieldsSaving] = useState(false);
  const [total, setTotal]       = useState(0);
  const [statusCounts, setStatusCounts] = useState(null);
  const [loading, setLoading]   = useState(false);
  // Why the last load failed, if it did. Without this a 500 or a dropped
  // connection rendered as an empty table — indistinguishable from "there are
  // no sales", which is the worst possible way for a compliance list to fail.
  const [loadError, setLoadError] = useState('');
  const [page, setPage]         = useState(1);
  const [search, setSearch]     = useState('');
  // Company / Status / Closer / DP Status / Payout Status are all multi-select
  // — every one is an array now, [] meaning "no filter" (was '' before).
  const [statuses, setStatuses]     = useState(initStatus ? [initStatus] : []);
  const [companyIds, setCompanyIds] = useState(initCompany ? [initCompany] : []);
  // Defaults to "This month" (not all-time) — matches the DateRangePicker's
  // defaultPreset below, so the label and the actual filter agree from load.
  const [dateFrom, setDateFrom] = useState(() => getPresetRange('month').date_from || '');
  const [dateTo, setDateTo]     = useState(() => getPresetRange('month').date_to || '');
  const [expanded, setExpanded] = useState(null);
  // Payout section — superadmin only (merged in from the former standalone
  // Payout tab). DP Status filter/KPIs = payout_status; Payout Status
  // filter = the manual payout_confirmed tri-state (pending/yes/no).
  const isSuperadmin = user?.role === 'superadmin';
  const [payoutStatuses, setPayoutStatuses]       = useState([]);
  const [payoutConfirmeds, setPayoutConfirmeds]   = useState([]);
  const [payoutKpis, setPayoutKpis]           = useState(null);
  const [payoutConfirmedKpis, setPayoutConfirmedKpis] = useState(null);
  // Per-client DP Status cards (Business Rules → DP Status Clients, mig 247)
  // — array of { client, pending, paid, reverted }, independent of the
  // Client column filter below.
  const [payoutKpisByClient, setPayoutKpisByClient] = useState([]);
  const [payoutExporting, setPayoutExporting] = useState('');
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  // Closer filter — dedicated dropdown, all closer agents.
  const [closerIds, setCloserIds] = useState([]);
  // Sort + per-column filters. Default is unchanged: newest SALE first (by the
  // Sale Date column the list shows), so the latest sales lead. sale_date nulls
  // sort last; created_at is the tiebreaker.
  //
  // `columns` is whatever /compliance/sales advertised for THIS caller — the
  // server decides what may be sorted and filtered, so a column a readonly
  // admin has masked never gets a header control.
  const [columns, setColumns] = useState({});
  const tq = useTableQuery({
    scope: 'compliance:sales',
    columns,
    defaultSort: { by: 'sale_date', dir: 'desc' },
  });
  const abortable = useAbortable();
  // Dropdown vocabularies for the uuid/enum headers. Companies come from the
  // prop the shell already holds; users are one cached fetch per session.
  // Statuses use the compliance label overrides, not the raw enum keys.
  const { userOptions, companyOptions, clientOptions } = useFilterOptions({ companyList });
  const statusOptions = ALL_SALE_STATUSES.map(s => ({ value: s, label: labelOf(s) }));
  // Closer filter dropdown — userOptions carries each user's role level;
  // narrow to closers only so fronters/managers don't clutter the list.
  const closerOptions = userOptions.filter(u => u.role === 'closer');
  // Company dropdown vocabulary for the multi-select — companyList is the
  // shell's already-loaded {id,name} list, same source the old single-select
  // <option> loop used.
  const companyMultiOptions = companyList.map(c => ({ value: c.id, label: c.name }));
  // A KPI-card row click still means "narrow to just this one" (its old
  // single-select behavior) — clicking it again clears back to "all". The
  // filter-bar dropdown above is the new way to pick several at once; this
  // click-a-tile shortcut stays a single-value toggle for muscle memory.
  const isSoleFilter = (arr, v) => arr.length === 1 && arr[0] === v;
  const toggleSoleFilter = (setter, arr, v) => setter(isSoleFilter(arr, v) ? [] : [v]);

  const [approving, setApproving]   = useState(null);
  const [detailSale, setDetailSale] = useState(null);

  // Notification deep-link → scroll + highlight the matching sale row 5s.
  // `hot` gates the ring + scroll. The focus TARGET is long-lived now, so a
  // slow cold start still lands on the record; the highlight itself must still
  // fade after ~6s instead of staying lit for the rest of the session.
  const { focus, hot } = useFocus();
  const focusRef = useRef(null);
  const focusedId = hot && focus?.kind === 'sale' ? focus.id : null;
  // When the notification asked for the record itself, open its drawer.
  // useNavFocus, not the `hot`-gated id above: the ring is allowed to have
  // faded during a slow cold start and the record is still the one the user
  // tapped — but the 5-minute nav window must still apply, or this tab
  // remounting an hour later would pop a drawer nobody asked for.
  const navFocus = useNavFocus();
  useSaleDeepLink(navFocus, setDetailSale);
  useEffect(() => {
    if (focusedId && focusRef.current) {
      try { focusRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* noop */ }
    }
  }, [focusedId, sales]);
  const [exportOpen, setExportOpen] = useState(false);

  // Return modal
  const [returnTarget, setReturnTarget] = useState(null);
  const [returnNote, setReturnNote]     = useState('');
  const [returning, setReturning]       = useState(false);
  const [returnMsg, setReturnMsg]       = useState('');

  // Edit modal
  const [editTarget, setEditTarget] = useState(null);
  const [editStatus, setEditStatus] = useState('');
  const [editReason, setEditReason] = useState('');
  const [editReasonKey, setEditReasonKey] = useState('');
  const [editCancelDate, setEditCancelDate] = useState('');
  const [editChargebackAmt, setEditChargebackAmt] = useState('');
  const [editPayoutStatus, setEditPayoutStatus]       = useState('pending');
  const [editPayoutConfirmed, setEditPayoutConfirmed] = useState('pending');
  const [editPaidToCloser, setEditPaidToCloser]       = useState(false);
  const [editPaidToPartner, setEditPaidToPartner]     = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editMsg, setEditMsg]       = useState('');
  // Cancel-like statuses gate the cancellation_date field. Keeps the rule
  // identical to the bulk endpoint so single + bulk flows behave the same.
  const CANCEL_LIKE = new Set(['cancelled', 'compliance_cancelled', 'closed_lost', 'chargeback', 'dispute']);
  const isCancelLikeStatus = CANCEL_LIKE.has(editStatus);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting]         = useState(false);
  // Post Date tab — charge-date window filter + in-flight charge action.
  const [chargeFrom, setChargeFrom] = useState('');
  const [chargeTo, setChargeTo]     = useState('');
  const [charging, setCharging]     = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.get('compliance/sales', {
        params: {
          search: search || undefined, status: statuses.join(',') || undefined,
          company_id: companyIds.join(',') || undefined,
          user_ids: closerIds.join(',') || undefined,
          disposition: disposition || undefined,
          // All Sales (no disposition) hides un-charged post-date sales — they
          // belong only to the Post Date tab until "Charge → Sale" is clicked.
          exclude_post_date: disposition ? undefined : 1,
          charge_from: chargeFrom || undefined, charge_to: chargeTo || undefined,
          date_from: dateFrom || undefined, date_to: dateTo || undefined,
          // Payout section (superadmin only — plain undefined for everyone else).
          payout_status: payoutStatuses.join(',') || undefined,
          payout_confirmed: payoutConfirmeds.join(',') || undefined,
          // sort_by / sort_dir / filters — all resolved by useTableQuery.
          ...tq.params,
          page, limit: LIMIT,
        },
        // Typing in a header filter must not queue a request per keystroke;
        // each load cancels the one before it.
        signal: abortable(),
      });
      setLoadError('');
      setSales(res.data.sales || []);
      setTotal(res.data.total || 0);
      if (res.data.columns) setColumns(res.data.columns);
      setPayoutKpis(res.data.payout_kpis || null);
      setPayoutConfirmedKpis(res.data.payout_confirmed_kpis || null);
      setPayoutKpisByClient(res.data.payout_kpis_by_client || []);
      // Keep page-1 totals across pages; clear when a status filter is active
      // (then the page-derived breakdown — the one filtered status — is correct).
      setStatusCounts(prev => statuses.length ? null : (res.data.status_counts ?? prev));
    } catch (e) {
      // A cancelled request is a superseded one, not a failure — leaving
      // `loading` on would freeze the table on every keystroke.
      if (isCanceled(e)) return;
      // Everything else is a real failure and must be visible. Swallowing it
      // here is what turned a 500 into "zero sales" with no explanation.
      const httpStatus = e.response?.status;   // not the `status` filter above
      setLoadError(e.response?.data?.error || (httpStatus ? `the server returned ${httpStatus}` : (e.message || 'the request failed')));
    } finally { setLoading(false); }
  }, [search, statuses, companyIds, closerIds, disposition, chargeFrom, chargeTo, dateFrom, dateTo, payoutStatuses, payoutConfirmeds, page, tq.version, tq.params, abortable]);

  useEffect(() => { load(); }, [load]);

  // A new sort or filter re-windows the whole dataset, so page 2 of the old
  // result is meaningless — go back to page 1.
  const firstQuery = useRef(true);
  useEffect(() => {
    if (firstQuery.current) { firstQuery.current = false; return; }
    setPage(1);
  }, [tq.version]);

  const approve = async (sale) => {
    setApproving(sale.id);
    try {
      const r = await client.post(`sales/${sale.id}/compliance-approve`);
      // Instant feedback: flip the row to its new status (badge + Approve→Update), then resync.
      const updated = r.data?.sale;
      if (updated) setSales(list => list.map(x => x.id === sale.id ? { ...x, ...updated } : x));
      load();
    } catch { /* user retries */ } finally { setApproving(null); }
  };

  // Charge a post-dated sale → flip disposition to "sale" so it leaves this tab,
  // then submit it to review so it appears — approvable — in All Sales (mirrors
  // the closer-side Charge button). Approve is NOT shown in the Post Date tab.
  const chargeSale = async (s) => {
    setCharging(s.id);
    try {
      await client.put(`sales/${s.id}`, { closer_disposition: 'sale', charge_at: null });
      try { await client.post(`sales/${s.id}/submit-review`); } catch { /* already in review */ }
      setSales(list => list.filter(x => x.id !== s.id));
      load();
    } catch { /* user retries */ } finally { setCharging(null); }
  };

  const openReturn = (s) => { setReturnTarget(s); setReturnNote(''); setReturnMsg(''); };
  const doReturn = async () => {
    if (!returnNote.trim()) { setReturnMsg('Note required.'); return; }
    setReturning(true);
    try {
      await client.post(`sales/${returnTarget.id}/compliance-return`, { note: returnNote });
      setReturnTarget(null); load();
    } catch (err) { setReturnMsg(err.response?.data?.error || 'Failed'); }
    finally { setReturning(false); }
  };

  const openEdit = (s) => {
    setEditTarget(s);
    setEditStatus(s.status);
    setEditReason('');
    setEditReasonKey(s.cancellation_reason_key || '');
    setEditCancelDate(s.cancellation_date || '');
    setEditChargebackAmt(s.chargeback_amount || '');
    setEditPayoutStatus(s.payout_status || 'pending');
    setEditPayoutConfirmed(s.payout_confirmed || 'pending');
    setEditPaidToCloser(!!s.paid_to_closer);
    setEditPaidToPartner(!!s.paid_to_partner);
    setEditMsg('');
  };

  // Direct field-level edit for compliance. SaleForm produces a full payload
  // matching the closer flow; we forward it to PUT /sales/:id (backend
  // already lets compliance_manager through, see sales.js line 472).
  const doEditFields = async (payload) => {
    if (!editFieldsTarget) return;
    setEditFieldsSaving(true);
    try {
      await client.put(`sales/${editFieldsTarget.id}`, payload);
      setEditFieldsTarget(null);
      toast.success('Sale updated');
      load();   // refetch from the server so the row reflects the saved values
    } catch (err) {
      // Previously this had no catch — a rejected save looked like "nothing
      // happened". Surface the real reason so compliance knows what to fix.
      toast.error(err.response?.data?.error || 'Failed to save changes');
    } finally { setEditFieldsSaving(false); }
  };
  const doEdit = async () => {
    if (isCancelLikeStatus && !editCancelDate) {
      setEditMsg('Cancellation date is required for this status.'); return;
    }
    // G28 — frontend mirror of the server-side requirement so the
    // operator sees the gate immediately instead of round-tripping.
    if (isCancelLikeStatus && !editReasonKey) {
      setEditMsg('Pick a canonical Reason from the dropdown.'); return;
    }
    setEditSaving(true);
    try {
      await client.post(`sales/${editTarget.id}/compliance`, {
        status: editStatus,
        reason: editReason,
        // Always send cancellation_date so a non-cancel status with a
        // previously-set date can clear it ("" → null on the server).
        cancellation_date: editCancelDate || null,
        cancellation_reason_key: editReasonKey || null,
        chargeback_amount: editStatus === 'chargeback' ? (editChargebackAmt || null) : undefined,
        chargeback_date:   editStatus === 'chargeback' ? (editCancelDate || null) : undefined,
      });
      // Payout section (superadmin only, only for a sale compliance has ever
      // approved) — a second, independent write so a rejected payout PATCH
      // never blocks the compliance status update that already succeeded.
      if (isSuperadmin && editTarget?.compliance_reviewed_at) {
        const prevStatus    = editTarget.payout_status || 'pending';
        const prevConfirmed = editTarget.payout_confirmed || 'pending';
        const prevPaid      = !!editTarget.paid_to_closer;
        const prevPartner   = !!editTarget.paid_to_partner;
        if (editPayoutStatus !== prevStatus || editPayoutConfirmed !== prevConfirmed || editPaidToCloser !== prevPaid || editPaidToPartner !== prevPartner) {
          try {
            await client.patch(`payouts/${editTarget.id}`, {
              payout_status: editPayoutStatus, payout_confirmed: editPayoutConfirmed,
              paid_to_closer: editPaidToCloser, paid_to_partner: editPaidToPartner,
            });
          } catch (payoutErr) {
            toast.error(payoutErr.response?.data?.error || 'Saved the compliance update, but the payout fields failed to save');
          }
        }
      }
      setEditTarget(null); load();
    } catch (err) { setEditMsg(err.response?.data?.error || 'Failed'); }
    finally { setEditSaving(false); }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try { await client.delete(`sales/${deleteTarget.id}`); setDeleteTarget(null); load(); }
    catch { /* user retries */ } finally { setDeleting(false); }
  };

  const handleExport = async ({ dateFrom: df, dateTo: dt, company: co, userIds }) => {
    // Export mirrors the active tab: a disposition tab exports its own
    // disposition; All Sales excludes un-charged post-date sales. Fetches ALL
    // matching rows (paged), not just the first 5,000.
    const allSales = await fetchAllForExport('compliance/sales',
      { disposition: disposition || undefined, exclude_post_date: disposition ? undefined : 1,
        date_from: df || undefined, date_to: dt || undefined, company_id: co || undefined, user_ids: userIds.length ? userIds.join(',') : undefined },
      'sales');
    // Columns come from the shared catalog. Unconfigured → the compliance_sales
    // surface, which is this tab's existing twelve columns unchanged. labelOf is
    // threaded through so Status keeps the configurable compliance workflow
    // labels rather than the static fallback map.
    writeExport({
      dataset: 'sales', surface: 'compliance_sales', allowed: allowedFor('sales'),
      rows: allSales, ctx: { labelOf },
      filename: buildFilename({ dataset: disposition ? `sales-${disposition}` : 'sales', scope: companyList.find(c => c.id === co)?.name, dateFrom: df, dateTo: dt }),
    });
  };

  // Payout report export (CSV + A4 PDF) — superadmin only. Pulls the same
  // rows the table is currently showing (current filters, not just the page).
  const payoutExportParams = () => ({
    disposition: disposition || undefined, exclude_post_date: disposition ? undefined : 1,
    search: search || undefined, status: statuses.join(',') || undefined, company_id: companyIds.join(',') || undefined,
    user_ids: closerIds.join(',') || undefined,
    date_from: dateFrom || undefined, date_to: dateTo || undefined,
    payout_status: payoutStatuses.join(',') || undefined, payout_confirmed: payoutConfirmeds.join(',') || undefined,
    // Column filters (Client, etc.) + sort — same params the on-screen table's
    // own load() sends. Without this, CSV/PDF/bulk-update silently ignored
    // whatever the Client column filter was narrowed to.
    ...tq.params,
  });
  // A single company name for the export filename — only meaningful when
  // exactly one company is selected; a multi-company export doesn't have one
  // scope name to show.
  const soleCompanyName = companyIds.length === 1 ? companyList.find(c => c.id === companyIds[0])?.name : undefined;
  const handlePayoutCsv = async () => {
    if (payoutExporting) return;
    setPayoutExporting('csv');
    try {
      const rows = await fetchAllForExport('compliance/sales', payoutExportParams(), 'sales');
      writeExport({
        dataset: 'sales', surface: 'payout_sales', allowed: null,
        rows, ctx: { labelOf },
        filename: buildFilename({ dataset: 'payouts', scope: soleCompanyName, dateFrom, dateTo }),
      });
    } catch (err) { toast.error(err.egressBlocked ? err.message : 'Failed to export CSV'); }
    finally { setPayoutExporting(''); }
  };
  const handlePayoutPdf = async () => {
    if (payoutExporting) return;
    setPayoutExporting('pdf');
    try {
      const rows = await fetchAllForExport('compliance/sales', payoutExportParams(), 'sales');
      const { exportPayoutReportPdf } = await import('../../utils/payoutReportPdf');
      exportPayoutReportPdf({
        rows, kpis: payoutKpis, labelOf,
        filters: { date_from: dateFrom, date_to: dateTo, payout_status: payoutStatuses.join(', ') },
        companyName: soleCompanyName || '',
      });
    } catch (err) { toast.error(err.egressBlocked ? err.message : 'Could not build the PDF'); }
    finally { setPayoutExporting(''); }
  };

  return (
    <div>
      <TabHeader
        title={disposition ? prettyDispo(disposition) : 'All Sales'}
        subtitle={disposition
          ? (isPostDate
              ? 'Post-dated sales awaiting their charge date. Charge one to move it to All Sales.'
              : `Sales with the “${prettyDispo(disposition)}” disposition, across all companies.`)
          : 'Closer sales across all companies — full management access'}
        onRefresh={() => { setPage(1); load(); }}
        onExport={() => setExportOpen(true)}
      />

      <FilterBar
        search={{
          value: search,
          onChange: (v) => { setSearch(v); setPage(1); },
          placeholder: 'Search anything — record id, any field…',
        }}
        dateRange={{
          value: { date_from: dateFrom, date_to: dateTo },
          onChange: (r) => { setDateFrom(r.date_from || ''); setDateTo(r.date_to || ''); setPage(1); },
          defaultPreset: 'month',
        }}
        extras={
          <>
            <MultiFilterSelect value={companyIds} onChange={v => { setCompanyIds(v); setPage(1); }}
              options={companyMultiOptions} placeholder="All companies" title="Filter by company" />
            <MultiFilterSelect
              value={Array.isArray(tq.draft?.client_name?.v) ? tq.draft.client_name.v : (tq.draft?.client_name?.v ? [tq.draft.client_name.v] : [])}
              onChange={v => tq.setFilter('client_name', v.length ? { op: 'in', v } : null)}
              options={clientOptions} placeholder="All clients" title="Filter by client" />
            <MultiFilterSelect value={statuses} onChange={v => { setStatuses(v); setPage(1); }}
              options={statusOptions} placeholder="All statuses" title="Filter by status" />
            <MultiFilterSelect value={closerIds} onChange={v => { setCloserIds(v); setPage(1); }}
              options={closerOptions} placeholder="All closers" title="Filter by closer" />
            {isPostDate && (
              <span className="inline-flex items-center gap-1.5">
                <span className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Charge:</span>
                <DateRangePicker
                  allowFuture
                  value={{ date_from: chargeFrom ? chargeFrom.slice(0, 10) : '', date_to: chargeTo ? chargeTo.slice(0, 10) : '' }}
                  defaultPreset="all"
                  onChange={(r) => {
                    setChargeFrom(r.date_from ? `${r.date_from}T00:00:00` : '');
                    setChargeTo(r.date_to ? `${r.date_to}T23:59:59` : '');
                    setPage(1);
                  }}
                  onClear={() => { setChargeFrom(''); setChargeTo(''); setPage(1); }}
                />
              </span>
            )}
            {/* Payout section — superadmin only, pushed to the very right of
                the filter bar (ml-auto) so compliance's own filters stay left. */}
            {isSuperadmin && (
              <span className="inline-flex items-center gap-2 ml-auto">
                <MultiFilterSelect value={payoutStatuses} onChange={v => { setPayoutStatuses(v); setPage(1); }}
                  options={PAYOUT_STATUSES.map(s => ({ value: s, label: PAYOUT_LABEL[s] }))}
                  placeholder="All DP Status" title="Filter by DP Status" />
                <MultiFilterSelect value={payoutConfirmeds} onChange={v => { setPayoutConfirmeds(v); setPage(1); }}
                  options={PAYOUT_CONFIRMED_STATUSES.map(s => ({ value: s, label: PAYOUT_CONFIRMED_LABEL[s] }))}
                  placeholder="All Payout Status" title="Filter by Payout Status" />
              </span>
            )}
          </>
        }
        onClearAll={() => {
          setSearch(''); setCompanyIds([]); setStatuses([]); setCloserIds([]);
          // Back to the default range (this month), not all-time — matches
          // defaultPreset above and what FilterBar's own "Clear all" already
          // reset the picker to, so the two don't fight over the result.
          const monthRange = getPresetRange('month');
          setDateFrom(monthRange.date_from || ''); setDateTo(monthRange.date_to || '');
          setChargeFrom(''); setChargeTo(''); setPage(1);
          setPayoutStatuses([]); setPayoutConfirmeds([]);
          tq.clearFilter('client_name');
        }}
      />

      {/* Stats strip (compliance's own totals) on the left; the payout KPI
          block (superadmin only) sits beside it on the SAME line, pinned
          right. TabStatsStrip is flex-1 (grows/shrinks, 280px floor); the
          payout block is flex-shrink-0 with its own flex-nowrap + horizontal
          scroll so a width squeeze scrolls the tiles instead of wrapping them
          into a ragged second row. Every tile carries both a value AND a sub
          line (never one without the other) so all 7 stay the same height. */}
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[280px]">
          <TabStatsStrip
            total={total}
            records={sales}
            statusTotals={statusCounts}
            activeStatus={statuses.length === 1 ? statuses[0] : ''}
            onSelectStatus={(s) => { setStatuses(s ? [s] : []); setPage(1); }}
            labelOf={labelOf}
            badgeOf={(key) => {
              // Map the catalog badge variant to bg/color the strip expects.
              const variant = badgeOf(key);
              const VAR = {
                success:   { bg: '#d1fae5', color: '#047857' },
                error:     { bg: '#fee2e2', color: '#b91c1c' },
                warning:   { bg: '#fef3c7', color: '#b45309' },
                info:      { bg: '#dbeafe', color: '#1d4ed8' },
                secondary: { bg: '#f3f4f6', color: '#6b7280' },
              };
              return { ...(VAR[variant] || VAR.secondary), label: labelOf(key) };
            }}
          />
        </div>

        {isSuperadmin && (
          <div className="flex-shrink-0 mb-4" style={{ maxWidth: '100%' }}>
            <div className="flex items-center justify-between mb-1.5 gap-2">
              <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-tertiary)' }}>
                Payout
              </span>
              <div className="flex items-center gap-1">
                <button onClick={handlePayoutCsv} disabled={!!payoutExporting} title="Export payout report — CSV"
                  className="p-1.5 rounded-full border disabled:opacity-50 transition-colors"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-surface)' }}>
                  <Download size={12} />
                </button>
                <button onClick={handlePayoutPdf} disabled={!!payoutExporting} title="Export payout report — A4 PDF"
                  className="p-1.5 rounded-full border disabled:opacity-50 transition-colors"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-surface)' }}>
                  <FileDown size={12} />
                </button>
                <button onClick={() => setBulkModalOpen(true)} title="Bulk update DP Status / Payout Status / Paid to closer"
                  className="p-1.5 rounded-full border disabled:opacity-50 transition-colors"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-surface)' }}>
                  <ListChecks size={12} />
                </button>
              </div>
            </div>
            <div className="flex flex-nowrap items-start gap-2 overflow-x-auto pb-1">
              {/* DP Status — one combined card, four $ rows. */}
              <DpStatusCard rows={[
                { key: '', label: 'All', tone: 'primary',
                  value: moneyKpi((payoutKpis?.pending?.gross || 0) + (payoutKpis?.paid?.gross || 0) + (payoutKpis?.reverted?.gross || 0)),
                  active: !payoutStatuses.length, onClick: () => { setPayoutStatuses([]); setPage(1); } },
                { key: 'pending', label: 'Pending', tone: 'warn', value: moneyKpi(payoutKpis?.pending?.gross),
                  active: isSoleFilter(payoutStatuses, 'pending'), onClick: () => { toggleSoleFilter(setPayoutStatuses, payoutStatuses, 'pending'); setPage(1); } },
                { key: 'paid', label: 'Paid', tone: 'success', value: moneyKpi(payoutKpis?.paid?.gross),
                  active: isSoleFilter(payoutStatuses, 'paid'), onClick: () => { toggleSoleFilter(setPayoutStatuses, payoutStatuses, 'paid'); setPage(1); } },
                { key: 'reverted', label: 'Reverted', tone: 'danger', value: moneyKpi(payoutKpis?.reverted?.gross),
                  active: isSoleFilter(payoutStatuses, 'reverted'), onClick: () => { toggleSoleFilter(setPayoutStatuses, payoutStatuses, 'reverted'); setPage(1); } },
              ]} />
              {/* Per-client DP Status cards (Business Rules → DP Status
                  Clients, mig 247) — always show every configured client,
                  regardless of the Client column filter above. Clicking a
                  row still SETS that filter (+ payoutStatus) as an action;
                  it just never collapses the card list. */}
              {payoutKpisByClient.map((c) => {
                const clientFilterValues = Array.isArray(tq.draft?.client_name?.v) ? tq.draft.client_name.v : (tq.draft?.client_name?.v ? [tq.draft.client_name.v] : []);
                const clientFilterActive = isSoleFilter(clientFilterValues, c.client);
                const drill = (statusKey) => {
                  tq.setFilter('client_name', { op: 'in', v: [c.client] });
                  setPayoutStatuses(clientFilterActive && isSoleFilter(payoutStatuses, statusKey) ? [] : [statusKey]);
                  setPage(1);
                };
                const totalGross = (c.pending?.gross || 0) + (c.paid?.gross || 0) + (c.reverted?.gross || 0);
                return (
                  <DpStatusCard key={c.client} title={c.client} rows={[
                    { key: '', label: 'All', tone: 'primary', value: moneyKpi(totalGross),
                      active: clientFilterActive && !payoutStatuses.length,
                      onClick: () => { tq.setFilter('client_name', clientFilterActive ? null : { op: 'in', v: [c.client] }); setPayoutStatuses([]); setPage(1); } },
                    { key: 'pending', label: 'Pending', tone: 'warn', value: moneyKpi(c.pending?.gross),
                      active: clientFilterActive && isSoleFilter(payoutStatuses, 'pending'), onClick: () => drill('pending') },
                    { key: 'paid', label: 'Paid', tone: 'success', value: moneyKpi(c.paid?.gross),
                      active: clientFilterActive && isSoleFilter(payoutStatuses, 'paid'), onClick: () => drill('paid') },
                    { key: 'reverted', label: 'Reverted', tone: 'danger', value: moneyKpi(c.reverted?.gross),
                      active: clientFilterActive && isSoleFilter(payoutStatuses, 'reverted'), onClick: () => drill('reverted') },
                  ]} />
                );
              })}
              {/* Payout Status (manual tri-state, mig 244) — three separate
                  tiles, pending first, plain counts — no $ sign. */}
              <KpiTile icon={Clock} label="Payout Pending" value={(payoutConfirmedKpis?.pending?.count ?? 0).toLocaleString()}
                tone="warn" active={isSoleFilter(payoutConfirmeds, 'pending')}
                onClick={() => { toggleSoleFilter(setPayoutConfirmeds, payoutConfirmeds, 'pending'); setPage(1); }}
                className="flex-shrink-0" style={{ width: 116 }} />
              <KpiTile icon={CheckCircle2} label="Payout Yes" value={(payoutConfirmedKpis?.yes?.count ?? 0).toLocaleString()}
                tone="success" active={isSoleFilter(payoutConfirmeds, 'yes')}
                onClick={() => { toggleSoleFilter(setPayoutConfirmeds, payoutConfirmeds, 'yes'); setPage(1); }}
                className="flex-shrink-0" style={{ width: 116 }} />
              <KpiTile icon={XCircle} label="Payout No" value={(payoutConfirmedKpis?.no?.count ?? 0).toLocaleString()}
                tone="muted" active={isSoleFilter(payoutConfirmeds, 'no')}
                onClick={() => { toggleSoleFilter(setPayoutConfirmeds, payoutConfirmeds, 'no'); setPage(1); }}
                className="flex-shrink-0" style={{ width: 116 }} />
            </div>
          </div>
        )}
      </div>

      <ActiveFilters tq={tq} />

      {/* A failed load must never look like an empty result set. */}
      {loadError && (
        <div className="flex items-center gap-2 flex-wrap mb-3 px-3 py-2 rounded-xl text-xs font-semibold"
          style={{ backgroundColor: 'color-mix(in srgb, var(--color-error-600) 8%, transparent)', color: 'var(--color-error-600)', border: '1px solid color-mix(in srgb, var(--color-error-600) 30%, transparent)' }}>
          <span>Could not load sales — {loadError}</span>
          <button onClick={load} className="px-2 py-0.5 rounded-full font-bold"
            style={{ border: '1px solid color-mix(in srgb, var(--color-error-600) 40%, transparent)' }}>Retry</button>
        </div>
      )}

      <div className="rounded-xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        {loading ? <Spinner /> : sales.length === 0 ? (
          // Say WHY it is empty. A bare "No records found" under an off-screen
          // column filter is what sent somebody hunting for missing sales.
          <Empty
            msg={loadError ? 'The list could not be loaded.' : 'No sales match the current filters.'}
            hint={loadError ? 'This is a load failure, not an empty result — the records are still there.'
              : tq.activeCount ? 'A column filter is narrowing this list. Clear it to see every sale again.'
              : (search || statuses.length || companyIds.length || dateFrom || dateTo)
                ? 'Search, status, company or date filters are active above.'
                : null}
            onAction={!loadError && tq.activeCount ? tq.clearAll : null}
            actionLabel="Clear column filters"
          />
        ) : (
          // Customer stays pinned while the rest scrolls — this table measures
          // 851px inside a 346px phone viewport, and without the pin scrolling
          // right leaves you reading rows you can no longer identify.
          <TableScroll stickyFirst inheritRowBg label="Sales">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                  <TqTh tq={tq} col="customer">Customer</TqTh>
                  <TqTh tq={tq} col="status" options={statusOptions}>Status</TqTh>
                  <TqTh tq={tq} col="client_name" options={clientOptions}>Client</TqTh>
                  <TqTh tq={tq} col="down_payment" align="right">DP</TqTh>
                  <TqTh tq={tq} col="fronter" options={userOptions}>Fronter</TqTh>
                  <TqTh tq={tq} col="closer"  options={userOptions}>Closer</TqTh>
                  <TqTh tq={tq} col="company" options={companyOptions}>Company</TqTh>
                  <TqTh tq={tq} col="sale_date">Sale Date</TqTh>
                  <TqTh tq={tq} col="status_updated">Status Updated</TqTh>
                  {isPostDate && <Th>Charge Date</Th>}
                  {isSuperadmin && <Th>DP Status</Th>}
                  {isSuperadmin && <Th>Payout Status</Th>}
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {sales.map(s => {
                  const focused = focusedId && String(focusedId) === String(s.id);
                  const hl = highlightFor(s);                       // config-driven duplicate-sale tint
                  // Opaque, not transparent: the pinned first column inherits
                  // the row background, so a see-through row would let the
                  // scrolled content show through the pinned cell. Surface is
                  // what the card behind it already paints, so this is a
                  // no-op visually while keeping the duplicate/focus tints.
                  const baseBg = focused ? 'var(--color-primary-50, #eef2ff)' : (hl || 'var(--color-surface)');
                  const dupN = highlightCountFor(s);                 // ALL sales on the configured field (active + cancelled)
                  const dupField = highlightCfg.field === 'vin' ? 'VIN' : 'customer number';
                  const dupActive = highlightCfg.field === 'vin' ? s.vin_dupe_active_count : s.dupe_active_count;
                  return (
                  <Fragment key={s.id}>
                    <tr className="cursor-pointer"
                      ref={focused ? focusRef : null}
                      style={{ borderBottom: '1px solid var(--color-border)',
                        backgroundColor: baseBg,
                        boxShadow: focused ? 'inset 3px 0 0 var(--color-primary-500, #6366f1)' : (hl ? 'inset 3px 0 0 #f59e0b' : 'none'),
                        transition: 'background-color 0.3s' }}
                      onClick={() => setDetailSale(s)}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = focused ? 'var(--color-primary-50, #eef2ff)' : (hl || 'var(--color-bg-secondary)')}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = baseBg}>
                      <td className="px-3 py-1.5">
                        <p className="font-semibold flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>{s.customer_name || '—'}
                          {dupN >= 2 && (
                            <span title={`${dupN} sales on this ${dupField} (active + cancelled)${dupActive != null ? ` · ${dupActive} active` : ''}`}
                              className="text-[11px] sm:text-[10px] font-extrabold px-1.5 py-0.5 rounded-full"
                              style={{ background: '#f59e0b22', color: '#b45309', border: '1px solid #f59e0b55' }}>×{dupN}</span>
                          )}
                        </p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{s.customer_phone || ''}</p>
                        {s.reference_no && (
                          <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>#{s.reference_no}</p>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <SaleStatusBadge sale={s} size="sm" />
                          {/* Came from a post-date. Deliberately a pill and not
                              a banner — the ask was "no major prompt", just
                              enough to understand at a glance. P→S = charged and
                              converted; P = still waiting on the card. Reads the
                              markers stamped by trg_stamp_post_date (mig 221);
                              before that, charging a post-date overwrote every
                              trace it had ever been one. */}
                          {s.post_dated_at && (
                            <span title={s.post_date_converted_at
                                ? `Post-dated ${fmtStamp(s.post_dated_at)} → charged ${fmtStamp(s.post_date_converted_at)}`
                                : `Post-dated ${fmtStamp(s.post_dated_at)} — card not charged yet`}
                              className="inline-flex items-center text-[11px] sm:text-[10px] font-extrabold px-1.5 py-0.5 rounded whitespace-nowrap"
                              style={{
                                backgroundColor: 'color-mix(in srgb, var(--color-primary-500, #6366f1) 16%, transparent)',
                                color: 'var(--color-primary-700, #4338ca)',
                                border: '1px solid color-mix(in srgb, var(--color-primary-500, #6366f1) 40%, transparent)',
                              }}>
                              {s.post_date_converted_at ? 'P → S' : 'P'}
                            </span>
                          )}
                          {(() => { const t = salePaidTenure(s); return t ? (
                            <span title={`Kept paying ${t.label} — sale ${fmtSaleDate(s.sale_date)} → cancelled ${fmtSaleDate(s.cancellation_date)}`}
                              className="inline-flex items-center text-[11px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap"
                              style={{ backgroundColor: '#fef3c7', color: '#b45309' }}>
                              paid {t.short}
                            </span>
                          ) : null; })()}
                          {s.is_resell && (
                            <span title={`Resell · ${s.resell_intent || ''}`}
                              className="inline-flex items-center gap-1 text-[11px] sm:text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded whitespace-nowrap"
                              style={{ backgroundColor: '#ddd6fe', color: '#5b21b6' }}>
                              ↻ {(s.resell_intent || 'resell').replace(/_/g, ' ')}
                            </span>
                          )}
                          {s.group_count > 1 && (
                            <span title="Multi-vehicle bundle — this row is one car of one deal"
                              className="inline-flex items-center gap-1 text-[11px] sm:text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded whitespace-nowrap"
                              style={{ backgroundColor: '#d1fae5', color: '#065f46' }}>
                              {s.group_count}-car deal
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{s.client_name || '—'}</td>
                      <td className="px-3 py-1.5 text-xs text-right tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{money(s.down_payment) || '—'}</td>
                      <td className="px-3 py-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{s.fronter_name || '—'}</td>
                      <td className="px-3 py-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{closerName(s)}</td>
                      <td className="px-3 py-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{s.companies?.name || '—'}</td>
                      {/* Show the actual sale_date the closer entered (carries through
                          bulk uploads) instead of the upload moment. Falls back to
                          created_at on legacy rows where sale_date wasn't captured. */}
                      <td className="px-3 py-1.5 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{s.sale_date ? fmtSaleDate(s.sale_date) : fmtDate(s.created_at)}</td>
                      {/* When the status was last changed (approve, cancel, …). */}
                      <td className="px-3 py-1.5 text-xs whitespace-nowrap" style={{ color: statusUpdatedAt(s) ? 'var(--color-text-secondary)' : 'var(--color-text-tertiary)' }}>
                        {(() => { const d = statusUpdatedAt(s); return d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'; })()}
                      </td>
                      {isPostDate && (
                        <td className="px-3 py-1.5 text-xs font-semibold" style={{ color: s.charge_at ? '#b45309' : 'var(--color-text-tertiary)' }}>
                          {s.charge_at ? new Date(s.charge_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}
                        </td>
                      )}
                      {/* Payout section (superadmin only) — read-only here; set
                          from the Update popup, not inline. */}
                      {isSuperadmin && (
                        <td className="px-3 py-1.5 text-xs">
                          {s.compliance_reviewed_at ? (
                            <span className="inline-flex items-center text-[11px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap"
                              style={{ backgroundColor: DP_TINT[s.payout_status || 'pending'].bg, color: DP_TINT[s.payout_status || 'pending'].fg }}>
                              {PAYOUT_LABEL[s.payout_status || 'pending']}
                            </span>
                          ) : <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>}
                        </td>
                      )}
                      {isSuperadmin && (
                        <td className="px-3 py-1.5 text-xs">
                          {s.compliance_reviewed_at ? (
                            <span className="inline-flex items-center gap-1 flex-wrap">
                              <span className="inline-flex items-center text-[11px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap"
                                style={{ backgroundColor: PAYOUT_CONFIRMED_TINT[s.payout_confirmed || 'pending'].bg, color: PAYOUT_CONFIRMED_TINT[s.payout_confirmed || 'pending'].fg }}>
                                {PAYOUT_CONFIRMED_LABEL[s.payout_confirmed || 'pending']}
                              </span>
                              {s.payout_confirmed === 'yes' && s.paid_to_closer && (
                                <span className="inline-flex items-center text-[11px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap"
                                  style={{ backgroundColor: 'var(--color-success-100)', color: 'var(--color-success-700)' }}>
                                  Paid
                                </span>
                              )}
                            </span>
                          ) : <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>}
                        </td>
                      )}
                      <td className="px-3 py-1.5" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1 flex-wrap justify-end">
                          {isPostDate && !isReadOnly && roControlAllowed('cc-sales.charge') && (
                            <button onClick={() => chargeSale(s)} disabled={charging === s.id}
                              title="Charge the card and move this to All Sales for approval"
                              className="px-2 py-1 rounded-md text-xs font-bold text-white disabled:opacity-60 hover:opacity-90"
                              style={{ background: 'var(--gradient-sidebar)' }}>
                              {charging === s.id ? '…' : 'Charge → Sale'}
                            </button>
                          )}
                          {/* Approve / Return / Update are hidden in the Post Date tab —
                              a post-dated sale isn't reviewed until it's charged and lands
                              in All Sales. */}
                          {!isPostDate && (s.status === 'pending_review' ? (
                            !isReadOnly && (
                              <>
                                {roControlAllowed('cc-sales.approve') && (
                                  <button onClick={() => approve(s)} disabled={approving === s.id}
                                    className="px-2 py-1 rounded-md text-xs font-bold text-white disabled:opacity-60 hover:opacity-90"
                                    style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)' }}>
                                    {approving === s.id ? '…' : 'Approve'}
                                  </button>
                                )}
                                {roControlAllowed('cc-sales.return') && (
                                  <button onClick={() => openReturn(s)}
                                    className="px-2 py-1 rounded-md text-xs font-bold hover:opacity-90"
                                    style={{ color: '#d97706', border: '1px solid #fbbf24', backgroundColor: '#fffbeb' }}>
                                    Return
                                  </button>
                                )}
                              </>
                            )
                          ) : (
                            !isReadOnly && (
                              <button onClick={() => openEdit(s)}
                                className="px-2 py-1 rounded-md text-xs font-bold text-white hover:opacity-90"
                                style={{ background: 'var(--gradient-sidebar)' }}>
                                Update
                              </button>
                            )
                          ))}
                          {/* Secondary actions — View / Edit / Audit trail / Delete —
                              tucked behind one 3-dot menu so they don't crowd the
                              primary workflow buttons (Approve/Return/Update/Charge). */}
                          <RowMenu items={[
                            { icon: Eye, label: 'View', onClick: () => setDetailSale(s) },
                            !isReadOnly && roControlAllowed('cc-sales.edit') && {
                              icon: Pencil, label: 'Edit', onClick: () => setEditFieldsTarget(s),
                            },
                            Array.isArray(s.edit_history) && s.edit_history.length > 0 && {
                              icon: expanded === s.id ? ChevronUp : ChevronDown,
                              label: expanded === s.id ? 'Hide audit trail' : 'Audit trail',
                              onClick: () => setExpanded(expanded === s.id ? null : s.id),
                            },
                            !isReadOnly && roControlAllowed('cc-sales.delete') && {
                              icon: Trash2, label: 'Delete', onClick: () => setDeleteTarget(s), danger: true,
                            },
                          ]} />
                        </div>
                      </td>
                    </tr>
                    {expanded === s.id && Array.isArray(s.edit_history) && (
                      <tr key={`${s.id}-hist`} style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                        <td colSpan={(isPostDate ? 11 : 10) + (isSuperadmin ? 2 : 0)} className="px-5 py-3">
                          <p className="text-xs font-bold mb-2" style={{ color: 'var(--color-text-secondary)' }}>Audit Trail</p>
                          <div className="space-y-1">
                            {s.edit_history.map((h, i) => (
                              <div key={i} className="text-xs flex gap-3">
                                <span style={{ color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>
                                  {new Date(h.edited_at).toLocaleString()}
                                </span>
                                {h.previous_status && (
                                  <span style={{ color: 'var(--color-text-secondary)' }}>
                                    {h.previous_status} → {h.new_status || h.action}
                                  </span>
                                )}
                                {(h.reason || h.note) && (
                                  <span className="italic" style={{ color: 'var(--color-text)' }}>"{h.reason || h.note}"</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        )}
        <Pagination page={page} total={total} limit={LIMIT} onPage={setPage} />
      </div>

      {/* Return modal */}
      {returnTarget && (
        <Overlay>
          <ModalBox>
            <ModalHeader icon={RotateCcw} title="Return to Closer"
              subtitle={`${returnTarget.customer_name} · Ref: ${returnTarget.reference_no || '—'}`}
              onClose={() => setReturnTarget(null)} />
            <div className="p-6 space-y-3">
              <textarea value={returnNote} onChange={e => setReturnNote(e.target.value)}
                placeholder="Explain what needs to be corrected…"
                rows={4} className="input text-sm w-full" autoFocus maxLength={2000} />
              <div className="flex justify-between">
                {returnMsg ? <p className="text-xs text-red-500">{returnMsg}</p> : <span />}
                <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{returnNote.length}/2000</span>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setReturnTarget(null)}
                  className="flex-1 py-2.5 rounded-xl border font-semibold text-sm"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Cancel</button>
                <button onClick={doReturn} disabled={returning}
                  className="flex-1 py-2.5 rounded-xl font-semibold text-sm text-white disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg,#d97706,#b45309)' }}>
                  {returning ? 'Returning…' : 'Return'}
                </button>
              </div>
            </div>
          </ModalBox>
        </Overlay>
      )}

      {/* Edit modal */}
      {editTarget && (
        <Overlay>
          <ModalBox>
            <ModalHeader icon={Shield} title="Compliance Update"
              subtitle={`${editTarget.customer_name} · Ref: ${editTarget.reference_no || '—'}`}
              onClose={() => setEditTarget(null)} />
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>New Status</label>
                <ThemedSelect value={editStatus} onChange={e => setEditStatus(e.target.value)} className="input text-sm w-full">
                  {COMPLIANCE_EDIT_STATUSES.map(s => <option key={s} value={s}>{labelOf(s)}</option>)}
                </ThemedSelect>
              </div>
              {/* Cancellation date — surfaces only when the picked status is
                  cancel-like (cancelled / compliance_cancelled / closed_lost /
                  chargeback / dispute). Same rule + key as the bulk
                  endpoint so single + bulk flows stay aligned. */}
              {isCancelLikeStatus && (
                <>
                  <div>
                    <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>
                      Cancellation Date <span className="text-red-500">*</span>
                    </label>
                    <ThemedDate value={editCancelDate}
                      onChange={e => setEditCancelDate(e.target.value)}
                      className="input text-sm w-full"
                      style={{
                        borderColor: !editCancelDate ? 'var(--color-error-300, #fca5a5)' : 'var(--color-border)',
                      }} />
                    <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                      Business date the cancellation took effect. Drives monthly cancel reports.
                      {editTarget?.cancellation_date && !editCancelDate && ` Previously: ${editTarget.cancellation_date}.`}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>
                      Reason (catalog)
                    </label>
                    <ThemedSelect value={editReasonKey}
                      onChange={e => setEditReasonKey(e.target.value)}
                      className="input text-sm w-full">
                      <option value="">— pick a canonical reason —</option>
                      {cancelReasonChoices.map(r => (
                        <option key={r.key} value={r.key}>{r.label}</option>
                      ))}
                    </ThemedSelect>
                    <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                      Optional canonical key for top-reason reports. Free-text reason below still appended to the compliance note.
                    </p>
                  </div>
                  {editStatus === 'chargeback' && (
                    <div>
                      <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>
                        Chargeback Amount (USD)
                      </label>
                      <input type="number" step="0.01" min="0" value={editChargebackAmt}
                        onChange={e => setEditChargebackAmt(e.target.value)}
                        className="input text-sm w-full"
                        placeholder="e.g. 1250.00" />
                      <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                        Money charged back. Used in net-revenue + chargeback-rate reports.
                      </p>
                    </div>
                  )}
                </>
              )}
              {/* Payout section — superadmin only, only for a sale compliance
                  has ever approved (nothing to track otherwise). */}
              {isSuperadmin && editTarget?.compliance_reviewed_at && (
                <div className="grid grid-cols-2 gap-3 p-3 rounded-xl" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                  <div>
                    <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>DP Status</label>
                    <ThemedSelect value={editPayoutStatus} onChange={e => setEditPayoutStatus(e.target.value)} className="input text-sm w-full">
                      {PAYOUT_STATUSES.map(s => <option key={s} value={s}>{PAYOUT_LABEL[s]}</option>)}
                    </ThemedSelect>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>Payout Status</label>
                    <ThemedSelect value={editPayoutConfirmed} onChange={e => setEditPayoutConfirmed(e.target.value)} className="input text-sm w-full">
                      {PAYOUT_CONFIRMED_STATUSES.map(s => <option key={s} value={s}>{PAYOUT_CONFIRMED_LABEL[s]}</option>)}
                    </ThemedSelect>
                  </div>
                  <div className="col-span-2">
                    <label className="flex items-center gap-2 text-sm font-semibold cursor-pointer" style={{ color: 'var(--color-text)' }}>
                      <input type="checkbox" checked={editPaidToCloser} onChange={e => setEditPaidToCloser(e.target.checked)} />
                      Paid to closer
                    </label>
                    <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                      Shows as "Paid" on the closer's own Incentive pill instead of "Eligible".
                    </p>
                  </div>
                  <div className="col-span-2">
                    <label className="flex items-center gap-2 text-sm font-semibold cursor-pointer" style={{ color: 'var(--color-text)' }}>
                      <input type="checkbox" checked={editPaidToPartner} onChange={e => setEditPaidToPartner(e.target.checked)} />
                      Paid to Partner
                    </label>
                    <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                      Independent of "Paid to closer" — this reflects to the company_admin of {editTarget?.companies?.name || 'this sale\'s company'} in their Team Sales tab.
                    </p>
                  </div>
                </div>
              )}
              <div>
                <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>
                  Reason
                </label>
                <textarea value={editReason} onChange={e => setEditReason(e.target.value)}
                  placeholder="Explain the reason for this update… (optional)"
                  rows={3} className="input text-sm w-full" />
              </div>
              {editMsg && <p className="text-xs text-red-500">{editMsg}</p>}
              <div className="flex gap-3">
                <button onClick={() => setEditTarget(null)}
                  className="flex-1 py-2.5 rounded-xl border font-semibold text-sm"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Cancel</button>
                <button onClick={doEdit} disabled={editSaving}
                  className="flex-1 py-2.5 rounded-xl font-semibold text-sm text-white disabled:opacity-50"
                  style={{ background: 'var(--gradient-sidebar)' }}>
                  {editSaving ? 'Saving…' : 'Save Update'}
                </button>
              </div>
            </div>
          </ModalBox>
        </Overlay>
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <Overlay>
          <ModalBox>
            <div className="p-6 text-center">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4 mx-auto"
                style={{ backgroundColor: '#fee2e2' }}>
                <Trash2 size={22} style={{ color: '#dc2626' }} />
              </div>
              <p className="text-base font-bold mb-2" style={{ color: 'var(--color-text)' }}>Delete Sale?</p>
              <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>
                {deleteTarget.customer_name} · {deleteTarget.reference_no || '—'}. Cannot be undone.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteTarget(null)}
                  className="flex-1 py-2.5 rounded-xl border font-semibold text-sm"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Cancel</button>
                <button onClick={doDelete} disabled={deleting}
                  className="flex-1 py-2.5 rounded-xl font-semibold text-sm text-white disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg,#dc2626,#b91c1c)' }}>
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          </ModalBox>
        </Overlay>
      )}

      <SaleDetailDrawer sale={detailSale} onClose={() => setDetailSale(null)} />
      {exportOpen && (
        <ExportModal tab="sales" companyList={companyList}
          onClose={() => setExportOpen(false)} onExport={handleExport} />
      )}
      {bulkModalOpen && (
        <BulkPayoutUpdateModal
          fetchParams={payoutExportParams()}
          onClose={() => setBulkModalOpen(false)}
          onDone={() => { setBulkModalOpen(false); load(); }}
        />
      )}

      {/* Compliance field-level edit — SaleModal in update mode. */}
      <SaleModal
        isOpen={!!editFieldsTarget}
        onClose={() => setEditFieldsTarget(null)}
        user={user}
        existingSale={editFieldsTarget}
        onSubmit={doEditFields}
        isLoading={editFieldsSaving}
      />
    </div>
  );
};

export default SalesTab;
