import { useEffect, useState } from 'react';
import { X, AlertTriangle, DollarSign, CheckCircle, Clock, RefreshCw } from 'lucide-react';
import { Badge, SmartText, BalancedText } from '../UI';
import SaleStatusBadge from '../UI/SaleStatusBadge';
import client from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { fmtSaleDate } from '../../utils/timezone';
import ResellModal from '../Closer/ResellModal';
import { useDrawerLayout } from '../../hooks/useDrawerLayout';

const SALE_BADGE = {
  open: 'info', sold: 'success', cancelled: 'error', follow_up: 'warning',
  closed_won: 'success', closed_lost: 'error',
  pending_review: 'warning', needs_revision: 'error',
};
const SALE_LABEL = {
  open: 'Pending', sold: 'Sold', cancelled: 'Cancelled', follow_up: 'Follow Up',
  closed_won: 'Approved', closed_lost: 'Lost',
  pending_review: 'In Review', needs_revision: 'Needs Revision',
};

const SKIP_KEYS = new Set([
  'customer_name', 'customer_phone', 'customer_email', 'customer_address',
  'FirstName', 'LastName', 'Phone', 'Phone2', 'Email', 'Address', 'City', 'State', 'Zip',
  'CarYear', 'CarMake', 'CarModel', 'CarMiles', 'CarVin',
  'SaleDisposition',
  // Internal/derived keys we never want to render as free-form rows.
  'manual_entry_by', 'cli_number', 'transfer_date', 'last_redial_at', 'state_abbr',
]);

// Safely stringify a form_data value — objects become JSON strings so we
// never render "[object Object]" by accident.
const renderVal = (v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch { return ''; }
  }
  return String(v);
};

const Row = ({ label, value, mono = false, highlight }) => {
  if (!value && value !== 0) return null;
  return (
    <div className="flex justify-between items-start gap-4 py-2"
      style={{ borderBottom: '1px solid var(--color-border)' }}>
      <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide flex-shrink-0">{label}</span>
      <span className={`text-sm text-right ${mono ? 'font-mono' : ''} ${highlight ? 'font-bold' : 'text-text'}`}
        style={highlight ? { color: highlight } : undefined}>{value}</span>
    </div>
  );
};

const Section = ({ title, children }) => (
  <div className="mb-5">
    <p className="text-xs font-bold uppercase tracking-widest mb-2"
      style={{ color: 'var(--color-primary-600)' }}>{title}</p>
    <div className="rounded-xl px-4 py-1"
      style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
      {children}
    </div>
  </div>
);

export default function SaleDetailDrawer({ sale, onClose, onResold }) {
  const { user, hasPermission, isReadOnly, roFlag } = useAuth();
  const { sections, isFieldVisible } = useDrawerLayout('sale');
  const [resellOpen, setResellOpen]       = useState(false);
  const [enabledStatuses, setEnabledStatuses] = useState(null);
  // Resell chain — fetched on open when this sale carries an
  // original_sale_id OR has been resold into another row. Walk both
  // directions: original_sale_id chain backward + any row whose
  // original_sale_id points at us forward. Result: a linear timeline
  // ordered by sale_date so the auditor sees lifetime customer history.
  const [chain, setChain] = useState([]);
  // Lifetime customer rollup — fetched when the sale has a customer_uuid
  // (mig 079 backfilled it). Surfaces cross-company activity from the
  // /sales/lifetime/by-phone endpoint, role-scoped server-side.
  const [lifetime, setLifetime] = useState(null);

  // Pull resell.enabled_statuses once so the button hides for statuses the
  // superadmin has disabled. Falls back to a safe default when offline.
  useEffect(() => {
    if (!sale) return;
    client.get('business-config')
      .then(r => setEnabledStatuses(r.data?.config?.['resell.enabled_statuses'] || null))
      .catch(() => setEnabledStatuses(null));
  }, [sale?.id]);

  // Resell chain fetch — only runs when this sale is part of one.
  useEffect(() => {
    if (!sale) { setChain([]); return; }
    if (!sale.is_resell && !sale.original_sale_id) {
      // Could still be the ORIGINAL with resells off it; do a forward check.
    }
    let cancelled = false;
    // Use the existing compliance sales endpoint for cross-company visibility;
    // any user inside the drawer already has read access to this sale's
    // company, so the role-scoped endpoint is the safe shared fallback.
    const rootId = sale.original_sale_id || sale.id;
    client.get(`sales/${rootId}/chain`).then(r => {
      if (cancelled) return;
      setChain(Array.isArray(r.data?.chain) ? r.data.chain : []);
    }).catch(() => { /* endpoint optional; silent fallback */ });
    return () => { cancelled = true; };
  }, [sale?.id, sale?.original_sale_id]);

  // Lifetime customer fetch — by phone so cross-company sales surface even
  // when this user has never seen the other rows directly. Server-side
  // role scoping ensures the response is already permission-filtered.
  useEffect(() => {
    if (!sale?.customer_phone) { setLifetime(null); return; }
    let cancelled = false;
    client.get(`sales/lifetime/by-phone/${encodeURIComponent(sale.customer_phone)}`)
      .then(r => { if (!cancelled) setLifetime(r.data || null); })
      .catch(() => { /* silent */ });
    return () => { cancelled = true; };
  }, [sale?.id, sale?.customer_phone]);

  if (!sale) return null;

  // Closer-side roles only — fronters never see this button per privacy spec.
  const closerSide = ['closer', 'closer_manager', 'company_admin', 'operations_manager', 'compliance_manager', 'superadmin', 'readonly_admin'].includes(user?.role);
  const fallback = ['cancelled', 'compliance_cancelled', 'closed_won', 'sold', 'closed_lost', 'expired'];
  const eligible = (enabledStatuses ?? fallback).includes(sale.status);
  const showResell = !isReadOnly && closerSide && eligible && !sale.is_resell; // can't resell a resell row directly — use the new sale instead

  const fd = sale.form_data || {};
  // Same safe filter the transfer drawer uses — object values never leak.
  const extraFields = Object.entries(fd).filter(
    ([k, v]) => !SKIP_KEYS.has(k)
      && v !== null && v !== undefined && String(v).trim() !== ''
      && typeof v !== 'object'
  );

  const hist = Array.isArray(sale.edit_history) ? sale.edit_history : [];

  const complianceColor = {
    open: 'var(--color-info-600)',
    pending_review: 'var(--color-warning-600)',
    needs_revision: 'var(--color-error-600)',
    closed_won: '#16a34a',
    closed_lost: 'var(--color-error-600)',
  }[sale.status];

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}
        onClick={onClose} />

      <div className="fixed right-0 top-0 h-full z-50 flex flex-col shadow-2xl animate-slide-in-right"
        style={{
          width: 'min(480px, 100vw)',
          backgroundColor: 'var(--color-surface)',
          borderLeft: '1px solid var(--color-border)',
        }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ background: 'var(--gradient-sidebar)' }}>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-white/20">
              <DollarSign size={18} className="text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white truncate max-w-[260px]">
                {sale.customer_name || 'Sale'}
              </h2>
              <p className="text-xs text-white/70">Sale Details</p>
            </div>
          </div>
          <button onClick={onClose}
            className="p-2 rounded-xl bg-white/20 hover:bg-white/30 transition-colors">
            <X size={18} className="text-white" />
          </button>
        </div>

        {/* Status bar */}
        <div className="flex items-center gap-3 px-5 py-3 flex-shrink-0 flex-wrap"
          style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
          <SaleStatusBadge sale={sale} size="md" />
          {sale.is_resell && (
            <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded inline-flex items-center gap-1"
              style={{ backgroundColor: 'var(--color-primary-100, #e0e7ff)', color: 'var(--color-primary-700, #4338ca)' }}>
              <RefreshCw size={10} /> Resell{sale.resell_intent ? ` · ${sale.resell_intent}` : ''}
            </span>
          )}
          {sale.reference_no && (
            <span className="text-xs font-mono text-text-tertiary">#{sale.reference_no}</span>
          )}
          <span className="text-xs text-text-tertiary ml-auto">
            {new Date(sale.created_at).toLocaleString()}
          </span>
          {showResell && (
            <button
              type="button"
              onClick={() => setResellOpen(true)}
              className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full transition-all hover:scale-105"
              style={{ background: 'var(--gradient-sidebar)', color: 'white', minHeight: 32 }}
              title="Resell this policy or add a new sale on this lead"
              aria-label="Resell or add new sale on this lead"
            >
              <RefreshCw size={12} /> New sale on lead
            </button>
          )}
        </div>

        {/* Compliance note banner */}
        {sale.status === 'needs_revision' && sale.compliance_note && (
          <div className="mx-5 mt-4 p-3 rounded-xl flex items-start gap-2 flex-shrink-0"
            style={{ backgroundColor: 'var(--color-error-50)', border: '1px solid var(--color-error-200)' }}>
            <AlertTriangle size={14} className="text-error-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs font-bold text-error-700">Compliance Note</p>
              <SmartText text={sale.compliance_note} maxLines={4} className="text-xs text-error-600 mt-0.5" />
            </div>
          </div>
        )}

        {/* Scrollable body — section order + visibility from useDrawerLayout
            (SuperAdmin configures per role in Business Rules → Drawer Layout).
            Unknown sections (e.g. 'compliance_actions' for compliance role) are
            tolerated; renderer map below decides what to render. */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {sections.filter(s => s.visible).map(s => {
            switch (s.id) {
              case 'customer':
                return (
                  <Section key="customer" title={s.label || 'Customer'}>
                    {isFieldVisible('customer', 'name')    && <Row label="Name"  value={sale.customer_name} />}
                    {isFieldVisible('customer', 'phone')   && <Row label="Phone" value={sale.customer_phone} />}
                    {isFieldVisible('customer', 'phone_2') && sale.customer_phone_2 && <Row label="Phone 2" value={sale.customer_phone_2} />}
                    {isFieldVisible('customer', 'email')   && sale.customer_email   && <Row label="Email"   value={sale.customer_email} />}
                    {isFieldVisible('customer', 'address') && sale.customer_address && <Row label="Address" value={sale.customer_address} />}
                  </Section>
                );
              case 'vehicle':
                if (!(sale.car_year || sale.car_make || sale.car_model)) return null;
                return (
                  <Section key="vehicle" title={s.label || 'Vehicle'}>
                    {isFieldVisible('vehicle', 'year')  && sale.car_year  && <Row label="Year"  value={sale.car_year} />}
                    {isFieldVisible('vehicle', 'make')  && sale.car_make  && <Row label="Make"  value={sale.car_make} />}
                    {isFieldVisible('vehicle', 'model') && sale.car_model && <Row label="Model" value={sale.car_model} />}
                    {isFieldVisible('vehicle', 'miles') && sale.car_miles && <Row label="Miles" value={Number(sale.car_miles).toLocaleString()} />}
                    {isFieldVisible('vehicle', 'vin')   && sale.car_vin   && <Row label="VIN"   value={sale.car_vin} mono />}
                  </Section>
                );
              case 'sale_info':
                return (
                  <Section key="sale_info" title={s.label || 'Sale Info'}>
                    {isFieldVisible('sale_info', 'client')             && sale.client_name && <Row label="Client"  value={sale.client_name} />}
                    {isFieldVisible('sale_info', 'plan')               && sale.plan        && <Row label="Plan"    value={sale.plan} />}
                    {isFieldVisible('sale_info', 'sale_date')          && sale.sale_date   && <Row label="Sale Date" value={fmtSaleDate(sale.sale_date)} />}
                    {isFieldVisible('sale_info', 'status')             && <Row label="Status" value={SALE_LABEL[sale.status] || sale.status} />}
                    {sale.cancellation_date && <Row label="Cancellation Date" value={fmtSaleDate(sale.cancellation_date)} highlight="var(--color-error-600, #dc2626)" />}
                    {isFieldVisible('sale_info', 'closer_disposition') && sale.closer_disposition && (
                      <Row label="Closer Disposition" value={sale.closer_disposition}
                        highlight="var(--color-primary-600)" />
                    )}
                  </Section>
                );
              case 'financial':
                if (!hasPermission('view_financial_data') || !roFlag('view_financial_data')) return null;
                return (
                  <Section key="financial" title={s.label || 'Financial'}>
                    {isFieldVisible('financial', 'monthly_payment') && sale.monthly_payment && (
                      <Row label="Monthly Payment" value={`$${Number(sale.monthly_payment).toLocaleString()}/mo`}
                        highlight="#16a34a" />
                    )}
                    {isFieldVisible('financial', 'down_payment') && sale.down_payment && (
                      <Row label="Down Payment" value={`$${Number(sale.down_payment).toLocaleString()}`} />
                    )}
                    {isFieldVisible('financial', 'payment_due_note') && sale.payment_due_note && (
                      <Row label="Due Note" value={sale.payment_due_note} />
                    )}
                  </Section>
                );
              case 'additional':
                if (extraFields.length === 0) return null;
                return (
                  <Section key="additional" title={s.label || 'Additional Info'}>
                    {extraFields.map(([k, v]) => (
                      <Row key={k} label={k.replace(/_/g, ' ')} value={renderVal(v)} />
                    ))}
                  </Section>
                );
              case 'people':
                return (
                  <Section key="people" title={s.label || 'People'}>
                    {isFieldVisible('people', 'closer')  && sale.closer_name  && <Row label="Closer"  value={sale.closer_name} />}
                    {isFieldVisible('people', 'fronter') && sale.fronter_name && <Row label="Fronter" value={sale.fronter_name} />}
                  </Section>
                );
              case 'timeline':
                return (
                  <Section key="timeline" title={s.label || 'Timeline'}>
                    {isFieldVisible('timeline', 'created') && (
                      <Row label="Created" value={new Date(sale.created_at).toLocaleString()} />
                    )}
                    {isFieldVisible('timeline', 'updated') && sale.updated_at && sale.updated_at !== sale.created_at && (
                      <Row label="Updated" value={new Date(sale.updated_at).toLocaleString()} />
                    )}
                    {isFieldVisible('timeline', 'submitted_for_review') && sale.submitted_for_review_at && (
                      <Row label="Submitted for Review" value={new Date(sale.submitted_for_review_at).toLocaleString()} />
                    )}
                    {isFieldVisible('timeline', 'compliance_reviewed') && sale.compliance_reviewed_at && (
                      <Row label="Compliance Reviewed" value={new Date(sale.compliance_reviewed_at).toLocaleString()} />
                    )}
                  </Section>
                );
              case 'compliance_actions':
                // Reserved for an action toolbar inside the drawer — wired in a
                // future commit where the compliance approve/return UI moves
                // here. Render nothing for now so the section can be toggled
                // without breaking the layout.
                return null;
              case 'audit':
                // Audit trail is rendered after the switch (it has its own
                // custom layout) — see below.
                return null;
              default:
                return null;
            }
          })}

          {/* Lifetime customer banner (G17 / G27). Visible only when the
              customer touched more than one company across the system —
              this is the cross-co dedup signal auto-warranty audit asks
              for. Single-company lifetime rolls into the chain section
              below, so we hide this banner when there's nothing new. */}
          {lifetime && Array.isArray(lifetime.companies) && lifetime.companies.length > 1 && (
            <div className="mb-4 rounded-xl p-3 flex items-start gap-2"
              style={{ backgroundColor: 'var(--color-info-50, #eff6ff)', border: '1px solid var(--color-info-200, #bfdbfe)' }}>
              <span className="text-lg leading-none">🧬</span>
              <div className="flex-1 text-xs">
                <p className="font-bold" style={{ color: 'var(--color-info-700, #1d4ed8)' }}>
                  Lifetime customer — {lifetime.sales.length} sale{lifetime.sales.length === 1 ? '' : 's'} across {lifetime.companies.length} companies
                </p>
                <p className="mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                  Same phone has produced sales at multiple fronter / closer companies. Cross-co rollups in the lifetime endpoint show every term — visible to compliance and parent-co.
                </p>
              </div>
            </div>
          )}

          {/* Resell chain timeline (G9) — only renders when the sale is
              part of a chain (it has an original_sale_id, or another row
              points at it). Lifetime customer view: each term as a node. */}
          {chain && chain.length > 1 && (
            <div className="mb-5">
              <p className="text-xs font-bold uppercase tracking-widest mb-2"
                style={{ color: 'var(--color-primary-600)' }}>
                Sale Chain · {chain.length} term{chain.length === 1 ? '' : 's'}
              </p>
              <div className="space-y-1.5">
                {chain.map((c, i) => {
                  const isCurrent = c.id === sale.id;
                  return (
                    <div key={c.id} className="rounded-xl p-2.5 flex items-center gap-2.5 flex-wrap"
                      style={{
                        backgroundColor: isCurrent ? 'var(--color-primary-50, #eef2ff)' : 'var(--color-bg-secondary)',
                        border: isCurrent ? '1px solid var(--color-primary-300, #c7d2fe)' : '1px solid var(--color-border)',
                      }}>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: isCurrent ? 'var(--color-primary-200, #c7d2fe)' : 'var(--color-surface)', color: isCurrent ? 'var(--color-primary-700, #4338ca)' : 'var(--color-text-secondary)' }}>
                        #{i + 1}
                      </span>
                      <code className="text-xs font-mono font-bold" style={{ color: 'var(--color-text)' }}>
                        {c.reference_no || c.id.slice(0, 8)}
                      </code>
                      <span className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                        {c.sale_date || '—'}
                      </span>
                      {c.client_name && (
                        <span className="text-[11px] px-1.5 py-0.5 rounded font-semibold"
                          style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}>
                          {c.client_name}
                        </span>
                      )}
                      {c.plan && (
                        <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                          {c.plan}
                        </span>
                      )}
                      <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
                        style={{
                          backgroundColor: c.is_resell ? '#ede9fe' : '#dcfce7',
                          color:           c.is_resell ? '#6d28d9' : '#166534',
                        }}>
                        {c.is_resell ? 'resell' : 'original'}
                      </span>
                      <span className="text-[10px] uppercase tracking-wide font-bold ml-auto"
                        style={{ color: 'var(--color-text-secondary)' }}>
                        {(c.status || '').replace(/_/g, ' ')}
                      </span>
                      {c.cancellation_date && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                          style={{ backgroundColor: 'var(--color-error-50, #fef2f2)', color: 'var(--color-error-700, #b91c1c)' }}>
                          cancelled {c.cancellation_date}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Audit trail — gated by layout config + readonly_admin flag */}
          {sections.find(s => s.id === 'audit')?.visible && hist.length > 0 && roFlag('view_audit_history') && (
            <div className="mb-5">
              <p className="text-xs font-bold uppercase tracking-widest mb-2"
                style={{ color: 'var(--color-primary-600)' }}>Audit Trail</p>
              <div className="space-y-2">
                {hist.map((h, i) => {
                  const actionLabel = h.action === 'approved' ? '✓ Approved'
                    : h.action === 'returned' ? '↩ Returned'
                    : h.action ? h.action.replace(/_/g, ' ') : 'Updated';
                  const actionColor = h.action === 'approved' ? '#16a34a'
                    : h.action === 'returned' ? '#d97706'
                    : 'var(--color-text-secondary)';
                  return (
                    <div key={i} className="p-3 rounded-xl text-xs"
                      style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                      <div className="flex justify-between mb-1">
                        <span className="font-bold capitalize" style={{ color: actionColor }}>{actionLabel}</span>
                        <span style={{ color: 'var(--color-text-tertiary)' }}>
                          {new Date(h.edited_at).toLocaleString()}
                        </span>
                      </div>
                      {h.previous_status && (
                        <p className="mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                          {h.previous_status} → {h.new_status || h.action}
                        </p>
                      )}
                      {(h.note || h.reason) && (
                        <BalancedText
                          text={`"${h.note || h.reason}"`}
                          className="italic"
                          style={{ color: 'var(--color-text)' }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Resell modal — gated by config + status; parent gets the new sale id
          via onResold callback so it can navigate or refresh the list. */}
      <ResellModal
        isOpen={resellOpen}
        sale={sale}
        onClose={() => setResellOpen(false)}
        onSuccess={(newSale, oldSale) => { setResellOpen(false); onResold?.(newSale, oldSale); }}
      />
    </>
  );
}
