import { useEffect, useState } from 'react';
import { X, AlertTriangle, DollarSign, CheckCircle, Clock, RefreshCw, Copy, Check } from 'lucide-react';
import { Badge, SmartText, BalancedText } from '../UI';
import SaleStatusBadge from '../UI/SaleStatusBadge';
import client from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { fmtSaleDate } from '../../utils/timezone';
import ResellModal from '../Closer/ResellModal';
import CustomerTimeline from './CustomerTimeline';
import NumberRiskCheck from './NumberRiskCheck';
import ReassignOwnership from './ReassignOwnership';
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

// Reference / policy / code-like fields are identifiers whose casing is
// meaningful — always show them uppercase (e.g. MBH4220SBN), even on legacy
// rows whose form_data was stored title-cased before the storage fix.
const REF_KEY_RE = /(reference|ref[_ ]?no|refno|policy|\bcode\b|sku|vin)/i;
const displayFieldValue = (key, v) => {
  const s = renderVal(v);
  return REF_KEY_RE.test(String(key)) ? s.toUpperCase() : s;
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
  const { sections } = useDrawerLayout('sale');
  const [resellOpen, setResellOpen]       = useState(false);
  const [copied, setCopied]               = useState(false);
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
  // FIX 4 — multi-vehicle bundle siblings (shared sale_group_id, mig 165).
  const [groupSiblings, setGroupSiblings] = useState([]);
  useEffect(() => {
    setGroupSiblings([]);
    if (!sale?.id) return;
    // The row may come from a caller that doesn't select sale_group_id, so ask
    // the endpoint regardless — it returns [] instantly for ungrouped sales.
    let cancelled = false;
    client.get(`sales/${sale.id}/group`)
      .then(r => { if (!cancelled) setGroupSiblings(r.data?.siblings || []); })
      .catch(() => { /* pre-mig-165 or no access — section just hides */ });
    return () => { cancelled = true; };
  }, [sale?.id]);

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

  // ── Field renderers, keyed by the field ids the SuperAdmin sees in
  // Business Rules → Drawer Layout. Rendering is keyed by field id (NOT by a
  // hardcoded section), so a field appears in whatever section the SuperAdmin
  // placed it — including after dragging it between sections. Each entry is a
  // <Row> or null (null = empty value or not permitted). Financial fields keep
  // their permission gate no matter which section they're moved into.
  const canFinancial = hasPermission('view_financial_data') && roFlag('view_financial_data');

  // Copy every field as ONE tab-separated row → pasting into a single sheet cell
  // spreads horizontally across columns in this exact sequence. Fields the CRM
  // never stores (payment status/method, card #, CVV, card expiry) are emitted
  // blank so the columns still line up. Maturity = sale date + plan-duration years.
  const g = (...keys) => { for (const k of keys) { const v = fd[k]; if (v != null && String(v).trim() !== '') return String(v).trim(); } return ''; };
  const asDate = (v) => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? '' : d.toISOString().slice(0, 10); };
  const copyCells = () => {
    const planYears = (() => { const m = String(g('PlanDuration')).match(/(\d+)/); return m ? parseInt(m[1], 10) : null; })();
    const maturity = (() => {
      if (!sale.sale_date || !planYears) return '';
      const d = new Date(String(sale.sale_date).slice(0, 10) + 'T00:00:00');
      if (isNaN(d)) return '';
      d.setFullYear(d.getFullYear() + planYears);
      return d.toISOString().slice(0, 10);
    })();
    const name = sale.customer_name || [g('FirstName'), g('LastName')].filter(Boolean).join(' ');
    const cells = [
      String(sale.sale_date || g('SaleDate') || '').slice(0, 10),        // Date
      sale.customer_phone || g('Phone', 'cli_number', 'customer_phone'), // CLI
      sale.client_name || g('SaleClient'),                               // Project
      SALE_LABEL[sale.status] || sale.status || '',                      // Status
      asDate(sale.charge_at),                                            // Post Date
      maturity,                                                          // Maturity Date
      '',                                                                // Payment Status (not stored)
      name,                                                              // Name
      g('Zip'),                                                          // ZIP
      sale.car_year || g('CarYear'),                                     // Year
      sale.car_make || g('CarMake'),                                     // Make
      sale.car_model || g('CarModel'),                                   // Model
      sale.car_miles || g('Miles'),                                      // Miles
      g('PlanDuration'),                                                 // Plan Duration Year
      canFinancial ? (sale.monthly_payment || g('SaleMonthlyPayment')) : '', // Monthly Amount
      canFinancial ? (sale.down_payment || g('SaleDownPayment')) : '',       // Down Payment
      sale.car_vin || g('VIN'),                                          // VIN #
      sale.closer_name || '',                                            // Closer Name
      sale.fronter_name || '',                                           // Employee Name
      sale.customer_address || g('Address'),                             // Address
      g('City'),                                                         // City
      g('State'),                                                        // State
      '',                                                                // Payment Method (not stored)
      '',                                                                // Card # (not stored)
      '',                                                                // CVV (not stored)
      '',                                                                // Expiry Date of Card (not stored)
      sale.customer_email || g('Email'),                                 // Email
      sale.policy_number || sale.reference_no || g('SaleReferenceNo'),   // Policy / Ref #
      sale.compliance_note || '',                                        // Comments
    ];
    const row = cells.map(c => String(c ?? '').replace(/[\t\r\n]+/g, ' ').trim()).join('\t');
    navigator.clipboard?.writeText(row)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })
      .catch(() => {});
  };

  const FIELD = {
    name:    <Row key="name"    label="Name"  value={sale.customer_name} />,
    phone:   sale.customer_phone ? <Row key="phone" label="Phone" value={
               <span className="inline-flex items-center gap-2 justify-end flex-wrap">{sale.customer_phone}<NumberRiskCheck phone={sale.customer_phone} /></span>
             } /> : null,
    phone_2: sale.customer_phone_2 ? <Row key="phone_2" label="Phone 2" value={sale.customer_phone_2} /> : null,
    email:   sale.customer_email   ? <Row key="email"   label="Email"   value={sale.customer_email} /> : null,
    address: sale.customer_address ? <Row key="address" label="Address" value={sale.customer_address} /> : null,
    year:    sale.car_year  ? <Row key="year"  label="Year"  value={sale.car_year} /> : null,
    make:    sale.car_make  ? <Row key="make"  label="Make"  value={sale.car_make} /> : null,
    model:   sale.car_model ? <Row key="model" label="Model" value={sale.car_model} /> : null,
    miles:   sale.car_miles ? <Row key="miles" label="Miles" value={Number(sale.car_miles).toLocaleString()} /> : null,
    vin:     sale.car_vin   ? <Row key="vin"   label="VIN"   value={sale.car_vin} mono /> : null,
    client:  sale.client_name ? <Row key="client" label="Client" value={sale.client_name} /> : null,
    plan:    sale.plan        ? <Row key="plan"   label="Plan"   value={sale.plan} /> : null,
    sale_date: sale.sale_date ? <Row key="sale_date" label="Sale Date" value={fmtSaleDate(sale.sale_date)} /> : null,
    status:  <Row key="status" label="Status" value={SALE_LABEL[sale.status] || sale.status} />,
    cancellation_date: sale.cancellation_date ? <Row key="cancellation_date" label="Cancellation Date" value={fmtSaleDate(sale.cancellation_date)} highlight="var(--color-error-600, #dc2626)" /> : null,
    closer_disposition: sale.closer_disposition ? <Row key="closer_disposition" label="Closer Disposition" value={sale.closer_disposition} highlight="var(--color-primary-600)" /> : null,
    monthly_payment:  (canFinancial && sale.monthly_payment)  ? <Row key="monthly_payment" label="Monthly Payment" value={`$${Number(sale.monthly_payment).toLocaleString()}/mo`} highlight="#16a34a" /> : null,
    down_payment:     (canFinancial && sale.down_payment)     ? <Row key="down_payment" label="Down Payment" value={`$${Number(sale.down_payment).toLocaleString()}`} /> : null,
    payment_due_note: (canFinancial && sale.payment_due_note) ? <Row key="payment_due_note" label="Due Note" value={sale.payment_due_note} /> : null,
    closer:  sale.closer_name  ? <Row key="closer"  label="Closer"  value={sale.closer_name} /> : null,
    fronter: sale.fronter_name ? <Row key="fronter" label="Fronter" value={sale.fronter_name} /> : null,
    created: <Row key="created" label="Created" value={new Date(sale.created_at).toLocaleString()} />,
    updated: (sale.updated_at && sale.updated_at !== sale.created_at) ? <Row key="updated" label="Updated" value={new Date(sale.updated_at).toLocaleString()} /> : null,
    submitted_for_review: sale.submitted_for_review_at ? <Row key="submitted_for_review" label="Submitted for Review" value={new Date(sale.submitted_for_review_at).toLocaleString()} /> : null,
    compliance_reviewed:  sale.compliance_reviewed_at  ? <Row key="compliance_reviewed"  label="Compliance Reviewed"  value={new Date(sale.compliance_reviewed_at).toLocaleString()} /> : null,
  };

  // Default field order per section (used when a section has no configured
  // fields[] — i.e. older configs or untouched sections).
  const DEFAULT_FIELDS = {
    customer:  ['name', 'phone', 'phone_2', 'email', 'address'],
    vehicle:   ['year', 'make', 'model', 'miles', 'vin'],
    sale_info: ['client', 'plan', 'sale_date', 'status', 'cancellation_date', 'closer_disposition'],
    financial: ['monthly_payment', 'down_payment', 'payment_due_note'],
    people:    ['closer', 'fronter'],
    timeline:  ['created', 'updated', 'submitted_for_review', 'compliance_reviewed'],
  };

  // The ordered, visible {id,label} for a section: the SuperAdmin's configured
  // fields[] when present, else the catalog default. label drives the row title
  // for dragged-in dynamic (form-builder) fields.
  const sectionFields = (s) => {
    if (Array.isArray(s.fields) && s.fields.length) {
      return [...s.fields].filter(f => f.visible !== false)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(f => ({ id: f.id, label: f.label }));
    }
    return (DEFAULT_FIELDS[s.id] || []).map(id => ({ id }));
  };

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
          <div className="flex items-center gap-2">
            <button onClick={copyCells}
              title="Copy all fields as a spreadsheet row — paste into one cell, it fills across columns"
              className="p-2 rounded-xl bg-white/20 hover:bg-white/30 transition-colors">
              {copied ? <Check size={18} className="text-white" /> : <Copy size={18} className="text-white" />}
            </button>
            <button onClick={onClose}
              className="p-2 rounded-xl bg-white/20 hover:bg-white/30 transition-colors">
              <X size={18} className="text-white" />
            </button>
          </div>
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
            <span className="text-xs font-mono text-text-tertiary">#{String(sale.reference_no).toUpperCase()}</span>
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
          {(() => {
            // Every field id explicitly placed in some section (core + dynamic).
            const placed = new Set(sections.flatMap(sec => (sec.fields || []).map(f => f.id)));
            // Render any field id: a core field via the FIELD registry, or a
            // dynamic form-config field by reading its form_data value — so a
            // SuperAdmin can drag a form-builder field into any drawer section.
            const renderField = ({ id, label }) => {
              if (FIELD[id] !== undefined) return FIELD[id];        // core (Row or null)
              const v = fd[id];
              return (v != null && String(v).trim() !== '' && typeof v !== 'object')
                ? <Row key={id} label={label || id.replace(/_/g, ' ')} value={displayFieldValue(id, v)} /> : null;
            };
            return sections.filter(s => s.visible).map(s => {
              // Audit has its own custom block (below); compliance_actions reserved.
              if (s.id === 'audit' || s.id === 'compliance_actions') return null;
              const rows = sectionFields(s).map(renderField).filter(Boolean);
              // 'additional' also catches any form-config field not placed elsewhere
              // (so newly-added form fields surface automatically).
              if (s.id === 'additional') {
                extraFields.filter(([k]) => !placed.has(k)).forEach(([k, v]) => rows.push(
                  <Row key={`extra:${k}`} label={k.replace(/_/g, ' ')} value={displayFieldValue(k, v)} />
                ));
              }
              if (rows.length === 0) return null;
              return <Section key={s.id} title={s.label || s.id}>{rows}</Section>;
            });
          })()}

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

          {/* FIX 4 — multi-vehicle bundle siblings: the other cars sold in the
              SAME submit (shared sale_group_id). Small list, alongside (not
              inside) the resell chain — a bundle is one deal, not a lineage. */}
          {groupSiblings.length > 0 && (
            <div className="mb-5">
              <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: '#065f46' }}>
                Multi-Vehicle Deal · {groupSiblings.length + 1} cars
              </p>
              <div className="space-y-1.5">
                {groupSiblings.map(g => (
                  <div key={g.id} className="rounded-xl p-2.5 flex items-center gap-2.5 flex-wrap"
                    style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                    <span className="text-[11px] font-bold" style={{ color: 'var(--color-text)' }}>
                      {[g.car_year, g.car_make, g.car_model].filter(Boolean).join(' ') || 'Vehicle'}
                    </span>
                    <code className="text-[11px] font-mono" style={{ color: 'var(--color-text-secondary)' }}>
                      {g.reference_no || g.id.slice(0, 8)}
                    </code>
                    {g.plan && <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{g.plan}</span>}
                    <span className="text-[10px] uppercase tracking-wide font-bold ml-auto" style={{ color: 'var(--color-text-secondary)' }}>
                      {(g.status || '').replace(/_/g, ' ')}
                    </span>
                  </div>
                ))}
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

          {/* Unified lead → policy lifetime timeline (mig 085–088). Self-
              fetching by phone; role-scoped server-side. Renders nothing when
              the customer has no cross-record history. */}
          {sale.customer_phone && (
            <CustomerTimeline phone={sale.customer_phone} currentRef={sale.reference_no} />
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

          {/* Superadmin-only ownership reassignment (renders nothing for others). */}
          <ReassignOwnership kind="sale" record={sale} onDone={onClose} />
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
