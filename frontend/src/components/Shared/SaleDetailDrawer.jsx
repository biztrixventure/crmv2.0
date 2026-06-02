import { useEffect, useState } from 'react';
import { X, AlertTriangle, DollarSign, CheckCircle, Clock, RefreshCw } from 'lucide-react';
import { Badge, SmartText, BalancedText } from '../UI';
import { useAuth } from '../../contexts/AuthContext';
import { fmtSaleDate } from '../../utils/timezone';
import client from '../../api/client';
import ResellModal from '../Closer/ResellModal';

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
]);

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
  const { user, hasPermission } = useAuth();
  const [resellOpen, setResellOpen]       = useState(false);
  const [enabledStatuses, setEnabledStatuses] = useState(null);

  // Pull resell.enabled_statuses once so the button hides for statuses the
  // superadmin has disabled. Falls back to a safe default when offline.
  useEffect(() => {
    if (!sale) return;
    client.get('business-config')
      .then(r => setEnabledStatuses(r.data?.config?.['resell.enabled_statuses'] || null))
      .catch(() => setEnabledStatuses(null));
  }, [sale?.id]);

  if (!sale) return null;

  // Closer-side roles only — fronters never see this button per privacy spec.
  const closerSide = ['closer', 'closer_manager', 'company_admin', 'operations_manager', 'compliance_manager', 'superadmin', 'readonly_admin'].includes(user?.role);
  const fallback = ['cancelled', 'compliance_cancelled', 'closed_won', 'sold', 'closed_lost', 'expired'];
  const eligible = (enabledStatuses ?? fallback).includes(sale.status);
  const showResell = closerSide && eligible && !sale.is_resell; // can't resell a resell row directly — use the new sale instead

  const fd = sale.form_data || {};
  const extraFields = Object.entries(fd).filter(([k]) => !SKIP_KEYS.has(k));

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
          <Badge variant={SALE_BADGE[sale.status] || 'secondary'}>
            {SALE_LABEL[sale.status] || sale.status?.toUpperCase()}
          </Badge>
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

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">

          {/* Customer */}
          <Section title="Customer">
            <Row label="Name"      value={sale.customer_name} />
            <Row label="Phone"     value={sale.customer_phone} />
            {sale.customer_phone_2 && <Row label="Phone 2" value={sale.customer_phone_2} />}
            {sale.customer_email   && <Row label="Email"   value={sale.customer_email} />}
            {sale.customer_address && <Row label="Address" value={sale.customer_address} />}
          </Section>

          {/* Vehicle */}
          {(sale.car_year || sale.car_make || sale.car_model) && (
            <Section title="Vehicle">
              {sale.car_year  && <Row label="Year"  value={sale.car_year} />}
              {sale.car_make  && <Row label="Make"  value={sale.car_make} />}
              {sale.car_model && <Row label="Model" value={sale.car_model} />}
              {sale.car_miles && <Row label="Miles" value={Number(sale.car_miles).toLocaleString()} />}
              {sale.car_vin   && <Row label="VIN"   value={sale.car_vin} mono />}
            </Section>
          )}

          {/* Sale Info */}
          <Section title="Sale Info">
            {sale.client_name && <Row label="Client"  value={sale.client_name} />}
            {sale.plan        && <Row label="Plan"    value={sale.plan} />}
            {sale.sale_date   && <Row label="Sale Date" value={fmtSaleDate(sale.sale_date)} />}
            <Row label="Status" value={SALE_LABEL[sale.status] || sale.status} />
            {sale.closer_disposition && (
              <Row label="Closer Disposition" value={sale.closer_disposition}
                highlight="var(--color-primary-600)" />
            )}
          </Section>

          {/* Financial — gated */}
          {hasPermission('view_financial_data') && (
            <Section title="Financial">
              {sale.monthly_payment && (
                <Row label="Monthly Payment" value={`$${Number(sale.monthly_payment).toLocaleString()}/mo`}
                  highlight="#16a34a" />
              )}
              {sale.down_payment && (
                <Row label="Down Payment" value={`$${Number(sale.down_payment).toLocaleString()}`} />
              )}
              {sale.payment_due_note && <Row label="Due Note" value={sale.payment_due_note} />}
            </Section>
          )}

          {/* Extra form fields */}
          {extraFields.length > 0 && (
            <Section title="Additional Info">
              {extraFields.map(([k, v]) => (
                <Row key={k} label={k.replace(/_/g, ' ')} value={String(v)} />
              ))}
            </Section>
          )}

          {/* People */}
          <Section title="People">
            {sale.closer_name  && <Row label="Closer"  value={sale.closer_name} />}
            {sale.fronter_name && <Row label="Fronter" value={sale.fronter_name} />}
          </Section>

          {/* Timeline */}
          <Section title="Timeline">
            <Row label="Created"  value={new Date(sale.created_at).toLocaleString()} />
            {sale.updated_at && sale.updated_at !== sale.created_at && (
              <Row label="Updated" value={new Date(sale.updated_at).toLocaleString()} />
            )}
            {sale.submitted_for_review_at && (
              <Row label="Submitted for Review" value={new Date(sale.submitted_for_review_at).toLocaleString()} />
            )}
            {sale.compliance_reviewed_at && (
              <Row label="Compliance Reviewed" value={new Date(sale.compliance_reviewed_at).toLocaleString()} />
            )}
          </Section>

          {/* Audit trail */}
          {hist.length > 0 && (
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
