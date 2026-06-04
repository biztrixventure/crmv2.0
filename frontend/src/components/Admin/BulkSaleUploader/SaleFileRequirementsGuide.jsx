import { useState, useMemo } from 'react';
import {
  Download, FileSpreadsheet, CheckCircle2, Info, Building2, ChevronDown,
  ShieldCheck, ListChecks, Hash, Phone, Mail, Calendar, MapPin, FileText, ChevronRight,
} from 'lucide-react';
import { sampleTemplateCsv, CONTROL_FIELDS } from './saleColumnMapping';
import { useComplianceStatuses } from '../../../hooks/useComplianceStatuses';

/*
 * SaleFileRequirementsGuide
 *
 * Dynamic upload-prep cheatsheet. Tells the operator exactly what each
 * column accepts and — critically — what *happens* when a particular
 * value is in the file. Status dropdown options are pulled from the
 * admin-configured compliance.status_catalog so adding "Coverage gap" in
 * Business Rules → Compliance Workflow immediately appears here with a
 * sensible "what happens" line driven by the status category. Every
 * select-type form field listed here pulls its allowed values from
 * form_fields.options the same way.
 */

// Status-category fallbacks. Used when a catalog status has no key-
// specific override below — so a freshly-added status still gets a useful
// "what happens" line driven by its category bucket.
const CATEGORY_EFFECT = {
  pending: 'Sale lands in the compliance review queue. Compliance staff approves, returns for revision, or cancels.',
  won:     'Counts as revenue and closed-won. Locks the sale after the compliance lock window.',
  lost:    'Closed without revenue. Excluded from win-rate calculations.',
  neutral: 'Renders with its label in lists; no special effect on revenue or queue.',
};

// Key-specific overrides — applied on top of the category fallback for the
// well-known lifecycle keys. New admin-defined keys fall through to the
// category fallback above.
const KEY_EFFECT = {
  open:                 'Closer draft. Sale has not been submitted for compliance review yet.',
  sold:                 'Marked sold by the closer but not yet compliance-approved. Lands in the review queue.',
  pending_review:       'Default if the status column is blank. Sale enters the compliance review queue immediately.',
  needs_revision:       'Returned to the closer with the reviewer note. Closer must edit and resubmit.',
  closed_won:           'Approved sale. Counts toward revenue, win-rate, and SPIFF metrics.',
  closed_lost:          'Lost lead. Excluded from revenue and win-rate.',
  cancelled:            'Closer-side cancellation. Excluded from revenue. No compliance lock.',
  compliance_cancelled: 'Compliance rejected the sale. Locked from further closer/manager edits.',
  chargeback:           'Refunded after approval. Excluded from net revenue. Lands in compliance follow-up.',
  dispute:              'Customer-disputed sale. Compliance investigates before final disposition.',
  follow_up:            'Marked for follow-up. Stays in the closer\'s active pipeline.',
};

// Field-type → human-friendly format spec. Used for non-select column
// types so the operator sees "what to type" at a glance.
const FORMAT_SPEC = {
  phone: { icon: Phone,    note: '10 digits, no separators (e.g. 5551234567). Auto-strips spaces, dashes, parens.' },
  tel:   { icon: Phone,    note: '10 digits, no separators.' },
  email: { icon: Mail,     note: 'Standard email. Blank → server defaults to "no@email.com" so the row never breaks.' },
  date:  { icon: Calendar, note: 'YYYY-MM-DD (or Excel date). Sales without a date land on today.' },
  number:{ icon: Hash,     note: 'Integer or decimal. No currency symbols.' },
  zip:   { icon: MapPin,   note: '5-digit US ZIP. Server auto-fills City/State if a single ZIP is sent.' },
  state: { icon: MapPin,   note: '2-letter abbreviation (e.g. CA) or full name. Matched case-insensitively.' },
  textarea:    { icon: FileText, note: 'Free text. Multi-line OK if quoted in CSV.' },
  text:        { icon: FileText, note: 'Free text.' },
  sale_plan:        { icon: ListChecks, note: 'Must match a plan defined for the closer\'s company in Sale Configs.' },
  sale_client:      { icon: ListChecks, note: 'Must match a client defined for the company in Sale Configs.' },
  sale_fronter:     { icon: ListChecks, note: 'Fronter full name. Must match an active fronter in the row\'s company.' },
  sale_date:        { icon: Calendar,   note: 'YYYY-MM-DD. Drives the "Today / MTD" buckets on every shell.' },
  sale_status:      { icon: ListChecks, note: 'Same catalog as the Status column. See Status section above for behavior.' },
  sale_down_payment:   { icon: Hash, note: 'Numeric. Used for revenue + commission calc.' },
  sale_monthly_payment:{ icon: Hash, note: 'Numeric. Drives recurring-revenue projections.' },
  sale_payment_due_note:{ icon: FileText, note: 'Free text. Shown verbatim on the sale drawer.' },
  sale_reference_no: { icon: FileText, note: 'Free text. External reference / order number.' },
};

const FieldRule = ({ icon: Icon, name, label, type, required, helper, children, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  const hasBody = !!children;
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
    >
      <button
        type="button"
        onClick={() => hasBody && setOpen(o => !o)}
        className="w-full px-3 py-2.5 flex items-center gap-2.5 text-left hover:bg-bg-secondary transition-colors"
        style={{ cursor: hasBody ? 'pointer' : 'default' }}
      >
        {Icon && <Icon size={14} className="flex-shrink-0" style={{ color: 'var(--color-primary-600)' }} />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>{name}</code>
            {label && label !== name && (
              <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>“{label}”</span>
            )}
            {required && (
              <span className="text-[9px] px-1.5 py-0.5 rounded font-bold"
                style={{ backgroundColor: 'var(--color-error-50, #fef2f2)', color: 'var(--color-error-700, #b91c1c)' }}>
                REQUIRED
              </span>
            )}
            {type && (
              <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide"
                style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}>
                {type}
              </span>
            )}
          </div>
          {helper && (
            <p className="text-[11px] mt-0.5 leading-snug" style={{ color: 'var(--color-text-secondary)' }}>{helper}</p>
          )}
        </div>
        {hasBody && (
          <ChevronRight
            size={14}
            className="flex-shrink-0"
            style={{ color: 'var(--color-text-tertiary)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}
          />
        )}
      </button>
      {hasBody && open && (
        <div className="px-3 pb-3 pt-1 border-t" style={{ borderColor: 'var(--color-border)' }}>
          {children}
        </div>
      )}
    </div>
  );
};

const BADGE_DOT = {
  success: '#16a34a', error: '#dc2626', warning: '#d97706',
  info: '#2563eb', primary: '#6366f1', secondary: '#6b7280',
};

const OptionRow = ({ value, label, dotColor, effect }) => (
  <div className="flex items-start gap-2.5 py-1.5">
    {dotColor && (
      <span className="inline-block rounded-full flex-shrink-0 mt-1.5"
        style={{ width: 8, height: 8, backgroundColor: dotColor }} />
    )}
    <div className="flex-1 min-w-0">
      <div className="flex items-baseline gap-2 flex-wrap">
        <code className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>{value}</code>
        {label && label !== value && (
          <span className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>“{label}”</span>
        )}
      </div>
      {effect && (
        <p className="text-[11px] mt-0.5 leading-snug" style={{ color: 'var(--color-text-secondary)' }}>{effect}</p>
      )}
    </div>
  </div>
);

const SaleFileRequirementsGuide = ({ reference = { companies: [], closers: [] }, fields = [], formFields = [], phoneKey = null }) => {
  const [showNames, setShowNames] = useState(false);
  const { catalog } = useComplianceStatuses();

  const required = fields.filter(f => f.required);
  const optional = fields.filter(f => !f.required);

  // Status options — driven entirely by the live catalog so new statuses
  // appear here the moment they're enabled in Business Rules.
  const statusOptions = useMemo(
    () =>
      (catalog || [])
        .filter(s => s && s.key && s.enabled !== false)
        .map(s => ({
          value:  s.key,
          label:  s.label,
          dot:    BADGE_DOT[s.badge] || '#6b7280',
          effect: KEY_EFFECT[s.key] || CATEGORY_EFFECT[s.category] || CATEGORY_EFFECT.neutral,
        })),
    [catalog],
  );

  // Aggregate reference lists for the special sale_* dropdown field types.
  // Plans + clients come from the bulk-upload reference endpoint (which
  // pulls sale_configs across every company). Fronters come from
  // reference.companies[].fronters. Grouped by company so the operator
  // can see who's allowed where.
  const plansByCompany = useMemo(() => {
    const map = new Map();
    (reference.plans || []).forEach(p => {
      const key = p.company || 'Global';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(p.value);
    });
    return map;
  }, [reference.plans]);
  const clientsByCompany = useMemo(() => {
    const map = new Map();
    (reference.clients || []).forEach(c => {
      const key = c.company || 'Global';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(c.value);
    });
    return map;
  }, [reference.clients]);
  const frontersByCompany = useMemo(() => {
    const map = new Map();
    (reference.companies || []).forEach(co => {
      if (Array.isArray(co.fronters) && co.fronters.length) {
        map.set(co.name, co.fronters.map(f => f.name));
      }
    });
    return map;
  }, [reference.companies]);
  const closerNames = useMemo(
    () => (reference.closers || []).map(c => c.name).filter(Boolean),
    [reference.closers],
  );
  const companyNames = useMemo(
    () => (reference.companies || []).map(co => co.name).filter(Boolean),
    [reference.companies],
  );

  // Robust options parser — form_fields.options may be a JSON array, a
  // JSON string of one, or a comma-separated string depending on the
  // Form Builder editor used. Normalize to a flat array of strings.
  const parseOptions = (raw) => {
    if (Array.isArray(raw)) return raw;
    if (raw == null) return [];
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) return [];
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
          const parsed = JSON.parse(trimmed);
          return Array.isArray(parsed) ? parsed : [];
        } catch { /* fall through to CSV split */ }
      }
      return trimmed.split(',').map(s => s.trim()).filter(Boolean);
    }
    return [];
  };

  // Per-field rule cards — one per dynamic form field + the upload-only
  // control fields. Every field with a known catalog (status, plan,
  // client, fronter, select-with-options) renders its full value list
  // so the operator can see exactly what to type.
  const dynamicRules = useMemo(() => {
    return (formFields || []).map(f => {
      const type = String(f.field_type || 'text');
      const spec = FORMAT_SPEC[type] || FORMAT_SPEC.text;
      const isSelect = type === 'select';
      const options = parseOptions(f.options);
      return {
        key:       f.name,
        label:     f.label || f.name,
        type,
        required:  !!f.is_required,
        icon:      spec?.icon || FileText,
        helper:    spec?.note,
        isSelect,
        options,
      };
    });
  }, [formFields]);

  const download = () => {
    const blob = new Blob(['﻿' + sampleTemplateCsv(formFields, phoneKey)], { type: 'text/csv;charset=utf-8;' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'bulk_sale_template.csv' });
    a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-4">
      {/* ── Header card with quick required/optional list + template download ── */}
      <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--gradient-sidebar)' }}>
              <FileSpreadsheet size={20} className="text-white" />
            </div>
            <div>
              <h3 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>Before you upload sales</h3>
              <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                Each row is a completed sale. It's matched to an existing transfer by fronter + company + phone, then
                inserted exactly as a closer would, or reviewed as an update if a sale already exists.
              </p>
            </div>
          </div>
          <button onClick={download}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm text-white transition-all hover:scale-[1.02]"
            style={{ background: 'var(--gradient-sidebar)', boxShadow: 'var(--shadow-md)' }}>
            <Download size={16} /> Download sample template
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--color-text-secondary)' }}>Required columns</p>
            <div className="space-y-1.5">
              {required.map(f => (
                <div key={f.key} className="flex items-start gap-2">
                  <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-success-600)' }} />
                  <div><code className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>{f.key}</code>
                    {f.isPhone && <span className="text-[10px] ml-1.5 px-1 py-0.5 rounded font-bold" style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>match</span>}
                    {f.desc && <span className="text-xs ml-1.5" style={{ color: 'var(--color-text-secondary)' }}>— {f.desc}</span>}</div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--color-text-secondary)' }}>Optional columns ({optional.length})</p>
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {optional.map(f => (
                <div key={f.key} className="flex items-start gap-2">
                  <Info size={14} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
                  <div><code className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>{f.key}</code>
                    {f.desc && <span className="text-xs ml-1.5" style={{ color: 'var(--color-text-secondary)' }}>— {f.desc}</span>}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-xl p-3 text-xs flex items-start gap-2" style={{ backgroundColor: 'rgba(59,130,246,0.08)', color: 'var(--color-text-secondary)' }}>
          <ShieldCheck size={14} className="mt-0.5 flex-shrink-0" style={{ color: '#2563eb' }} />
          <span>If a record already exists, uploading it triggers an <strong>update review</strong> — you'll see exactly what changed (yellow = field, purple = status/approval, blue = compliance) before confirming. No compliance status in the file → the sale lands in the compliance queue for review.</span>
        </div>
        <div className="mt-2 rounded-xl p-3 text-xs" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
          <strong>Rules:</strong> CSV or Excel (.xlsx) · up to 2000 rows · no empty rows · no merged cells · fronter/company/closer names must match existing records.
        </div>
      </div>

      {/* ── Field-by-field rules: what each column accepts + what happens for
            every possible value. Status options are pulled live from the
            compliance.status_catalog; select-field options come from the
            form_fields.options array. Nothing here is hardcoded by status
            key — adding a new admin status surfaces here automatically. ── */}
      <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="p-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <p className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <ListChecks size={15} style={{ color: 'var(--color-primary-600)' }} /> Field-by-field rules
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            Every column listed below with its accepted values and what happens when that value lands in the file.
            New statuses or form fields added by an admin show up here automatically — no code change.
          </p>
        </div>

        <div className="p-3 space-y-2">
          {/* ── Control fields ── fronter/company/closer/status/compliance_note.
              Each renders its full valid-value list inline so the operator
              never has to bounce out of this page to know what to type. */}
          {CONTROL_FIELDS.map((cf) => {
            const isStatus    = cf.key === 'status';
            const isCompany   = cf.key === 'company_name';
            const isFronter   = cf.key === 'fronter_name';
            const isCloser    = cf.key === 'closer_name';
            const isNote      = cf.key === 'compliance_note';
            return (
              <FieldRule
                key={cf.key}
                icon={isStatus ? ListChecks : isNote ? FileText : Building2}
                name={cf.key}
                label={cf.label}
                type="control"
                required={cf.required}
                helper={cf.desc}
                defaultOpen={isStatus || isCompany || isFronter || isCloser}
              >
                {isStatus && (
                  <>
                    <p className="text-[11px] mb-2" style={{ color: 'var(--color-text-secondary)' }}>
                      Allowed values come from <strong>Business Rules → Compliance Workflow → Sale status catalog</strong>.
                      Listed live below. Any value not in this list is rejected at validation; blank defaults to
                      <code className="ml-1 px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>pending_review</code>.
                    </p>
                    <div className="rounded-lg p-2.5" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                      {statusOptions.length === 0 ? (
                        <p className="text-[11px] italic" style={{ color: 'var(--color-text-tertiary)' }}>
                          No statuses enabled in the catalog yet.
                        </p>
                      ) : (
                        statusOptions.map((o) => (
                          <OptionRow key={o.value} value={o.value} label={o.label} dotColor={o.dot} effect={o.effect} />
                        ))
                      )}
                    </div>
                  </>
                )}
                {isCompany && (
                  <>
                    <p className="text-[11px] mb-2" style={{ color: 'var(--color-text-secondary)' }}>
                      Must match an existing company name (case-insensitive, spaces and punctuation ignored).
                    </p>
                    <div className="rounded-lg p-2.5 flex flex-wrap gap-1.5" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                      {companyNames.length === 0
                        ? <p className="text-[11px] italic" style={{ color: 'var(--color-text-tertiary)' }}>No active companies.</p>
                        : companyNames.map(n => (
                          <span key={n} className="text-[11px] px-2 py-0.5 rounded font-mono"
                            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>{n}</span>
                        ))}
                    </div>
                  </>
                )}
                {isFronter && (
                  <>
                    <p className="text-[11px] mb-2" style={{ color: 'var(--color-text-secondary)' }}>
                      Must match a fronter active in the row's company. Listed per company below.
                    </p>
                    <div className="rounded-lg p-2.5 space-y-2" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                      {frontersByCompany.size === 0
                        ? <p className="text-[11px] italic" style={{ color: 'var(--color-text-tertiary)' }}>No fronters configured.</p>
                        : [...frontersByCompany.entries()].map(([co, names]) => (
                          <div key={co}>
                            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--color-text-tertiary)' }}>{co}</p>
                            <div className="flex flex-wrap gap-1.5">
                              {names.map(n => (
                                <span key={n} className="text-[11px] px-2 py-0.5 rounded font-mono"
                                  style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>{n}</span>
                              ))}
                            </div>
                          </div>
                        ))}
                    </div>
                  </>
                )}
                {isCloser && (
                  <>
                    <p className="text-[11px] mb-2" style={{ color: 'var(--color-text-secondary)' }}>
                      Optional. Must match a closer when set. Leave blank if unknown — the row still inserts.
                    </p>
                    <div className="rounded-lg p-2.5 flex flex-wrap gap-1.5" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                      {closerNames.length === 0
                        ? <p className="text-[11px] italic" style={{ color: 'var(--color-text-tertiary)' }}>No closers configured.</p>
                        : closerNames.map(n => (
                          <span key={n} className="text-[11px] px-2 py-0.5 rounded font-mono"
                            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>{n}</span>
                        ))}
                    </div>
                  </>
                )}
                {isNote && (
                  <p className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                    Free text. Optional reviewer note attached to the sale. Shown verbatim on the sale drawer.
                  </p>
                )}
              </FieldRule>
            );
          })}

          {/* ── Dynamic form fields ── one row per field. Every field expands
              to show its accepted values: sale_status pulls the compliance
              catalog, sale_plan/sale_client/sale_fronter pull from the
              upload reference endpoint, plain select fields pull from
              form_fields.options. Free-text / format-only fields show the
              FORMAT_SPEC line. ── */}
          {dynamicRules.length === 0 && (
            <p className="text-xs italic px-2 py-3" style={{ color: 'var(--color-text-tertiary)' }}>
              No form fields configured yet. Configure them in Admin → Form Builder.
            </p>
          )}
          {dynamicRules.map((f) => {
            // Auto-open any field that resolves to a concrete value list.
            const isSaleStatus  = f.type === 'sale_status';
            const isSalePlan    = f.type === 'sale_plan';
            const isSaleClient  = f.type === 'sale_client';
            const isSaleFronter = f.type === 'sale_fronter';
            const hasValueList  = isSaleStatus || isSalePlan || isSaleClient || isSaleFronter
                                  || (f.isSelect && f.options.length > 0);
            return (
              <FieldRule
                key={f.key}
                icon={f.icon}
                name={f.key}
                label={f.label}
                type={f.type}
                required={f.required}
                helper={f.helper}
                defaultOpen={hasValueList}
              >
                {/* Format spec line — shown on every field so even a plain
                    text/number/date column has guidance in the body. */}
                {f.helper && (
                  <p className="text-[11px] mb-2" style={{ color: 'var(--color-text-secondary)' }}>
                    <strong>Format:</strong> {f.helper}
                  </p>
                )}

                {isSaleStatus && (
                  <div className="rounded-lg p-2.5" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                    <p className="text-[11px] mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                      Same catalog as the upload <code>status</code> column above.
                    </p>
                    {statusOptions.length === 0
                      ? <p className="text-[11px] italic" style={{ color: 'var(--color-text-tertiary)' }}>No statuses enabled.</p>
                      : statusOptions.map((o) => (
                        <OptionRow key={o.value} value={o.value} label={o.label} dotColor={o.dot} effect={o.effect} />
                      ))}
                  </div>
                )}

                {isSalePlan && (() => {
                  // sale_plan reads its allowed values from TWO places: the
                  // Form Builder field's options JSON (client→plans mapping,
                  // wins when present — matches SaleForm.jsx behavior) and
                  // the global sale_configs.plans fallback.
                  const opts = f.options || [];
                  const mappings = opts.filter(o => o && typeof o === 'object' && o.client);
                  const flatPlans = opts.filter(o => typeof o === 'string' || (o && typeof o === 'object' && (o.value || o.plan) && !o.client));
                  const hasFieldOpts = mappings.length > 0 || flatPlans.length > 0;
                  return (
                    <div className="rounded-lg p-2.5 space-y-2" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                      {hasFieldOpts && (
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
                            From Form Builder · this field's options
                          </p>
                          {mappings.length > 0 ? mappings.map((m, i) => {
                            const plans = Array.isArray(m.plans) ? m.plans : (m.plan ? [m.plan] : []);
                            return (
                              <div key={`${m.client}-${i}`} className="mb-1.5">
                                <p className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                                  Client <code className="px-1 py-0.5 rounded font-mono" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}>{m.client}</code> →
                                </p>
                                <div className="flex flex-wrap gap-1.5 mt-1 ml-2">
                                  {plans.length === 0
                                    ? <span className="text-[11px] italic" style={{ color: 'var(--color-text-tertiary)' }}>no plans set</span>
                                    : plans.map(p => (
                                      <span key={p} className="text-[11px] px-2 py-0.5 rounded font-mono"
                                        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>{p}</span>
                                    ))}
                                </div>
                              </div>
                            );
                          }) : (
                            <div className="flex flex-wrap gap-1.5">
                              {flatPlans.map((p, i) => {
                                const v = typeof p === 'string' ? p : (p.value || p.plan);
                                return (
                                  <span key={`${v}-${i}`} className="text-[11px] px-2 py-0.5 rounded font-mono"
                                    style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>{v}</span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                      {plansByCompany.size > 0 && (
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
                            From Sale Configs · fallback when this field has no options
                          </p>
                          {[...plansByCompany.entries()].map(([co, vals]) => (
                            <div key={co} className="mb-1.5">
                              <p className="text-[10px] font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>{co}</p>
                              <div className="flex flex-wrap gap-1.5 mt-1">
                                {vals.map(v => (
                                  <span key={v} className="text-[11px] px-2 py-0.5 rounded font-mono"
                                    style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>{v}</span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {!hasFieldOpts && plansByCompany.size === 0 && (
                        <p className="text-[11px] italic" style={{ color: 'var(--color-text-tertiary)' }}>
                          No plans configured. Add them either inside the <strong>Form Builder</strong> on this field
                          (Edit → Options → client/plan mapping) or in <strong>Admin → Sale Configs → Plans</strong>.
                        </p>
                      )}
                    </div>
                  );
                })()}

                {isSaleClient && (() => {
                  // sale_client uses sale_configs first (closer's SaleForm
                  // renders from useSaleConfigs.clients), but the Form
                  // Builder field options may also carry clients as plain
                  // strings or { value, label } pairs.
                  const opts = f.options || [];
                  const optClients = opts
                    .map(o => typeof o === 'string' ? o : (o && (o.value || o.client || o.label)))
                    .filter(Boolean);
                  return (
                    <div className="rounded-lg p-2.5 space-y-2" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                      {optClients.length > 0 && (
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
                            From Form Builder · this field's options
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {optClients.map((c, i) => (
                              <span key={`${c}-${i}`} className="text-[11px] px-2 py-0.5 rounded font-mono"
                                style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>{c}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {clientsByCompany.size > 0 && (
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
                            From Sale Configs
                          </p>
                          {[...clientsByCompany.entries()].map(([co, vals]) => (
                            <div key={co} className="mb-1.5">
                              <p className="text-[10px] font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>{co}</p>
                              <div className="flex flex-wrap gap-1.5 mt-1">
                                {vals.map(v => (
                                  <span key={v} className="text-[11px] px-2 py-0.5 rounded font-mono"
                                    style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>{v}</span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {optClients.length === 0 && clientsByCompany.size === 0 && (
                        <p className="text-[11px] italic" style={{ color: 'var(--color-text-tertiary)' }}>
                          No clients configured. Add them either inside the <strong>Form Builder</strong> on this field
                          (Edit → Options) or in <strong>Admin → Sale Configs → Clients</strong>.
                        </p>
                      )}
                    </div>
                  );
                })()}

                {isSaleFronter && (
                  <div className="rounded-lg p-2.5 space-y-2" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                    {frontersByCompany.size === 0 ? (
                      <p className="text-[11px] italic" style={{ color: 'var(--color-text-tertiary)' }}>
                        No fronters configured.
                      </p>
                    ) : (
                      [...frontersByCompany.entries()].map(([co, names]) => (
                        <div key={co}>
                          <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--color-text-tertiary)' }}>{co}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {names.map(n => (
                              <span key={n} className="text-[11px] px-2 py-0.5 rounded font-mono"
                                style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>{n}</span>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {f.isSelect && (
                  f.options.length > 0 ? (
                    <div className="rounded-lg p-2.5" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                      <p className="text-[11px] mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                        Allowed values from Form Builder. Any other value is rejected at validation.
                      </p>
                      {f.options.map((opt, i) => {
                        const isObj = opt && typeof opt === 'object';
                        const value = isObj ? (opt.value ?? opt.client ?? opt.plan ?? '') : String(opt);
                        const label = isObj ? (opt.label || opt.plan || opt.client || value) : value;
                        const effect = isObj && opt.plan
                          ? `Maps to plan "${opt.plan}" for client "${opt.client || ''}".`
                          : null;
                        return <OptionRow key={`${value}-${i}`} value={value} label={label} effect={effect} />;
                      })}
                    </div>
                  ) : (
                    <p className="text-[11px] italic" style={{ color: 'var(--color-text-tertiary)' }}>
                      No options configured for this dropdown. Add options in Form Builder → Edit → Options.
                    </p>
                  )
                )}
              </FieldRule>
            );
          })}
        </div>
      </div>

      {/* ── Valid names reference (companies + closers) ── */}
      <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <button onClick={() => setShowNames(s => !s)} className="w-full flex items-center justify-between p-4">
          <span className="flex items-center gap-2 font-semibold" style={{ color: 'var(--color-text)' }}>
            <Building2 size={16} style={{ color: 'var(--color-primary-600)' }} /> Valid names ({reference.companies.length} companies · {reference.closers.length} closers)
          </span>
          <ChevronDown size={18} className="transition-transform" style={{ color: 'var(--color-text-tertiary)', transform: showNames ? 'rotate(180deg)' : 'none' }} />
        </button>
        {showNames && (
          <div className="px-4 pb-4 space-y-3 max-h-80 overflow-y-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {reference.companies.map(co => (
                <div key={co.id} className="rounded-xl p-3" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                  <p className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>{co.name}</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>{co.fronters.length ? co.fronters.map(f => f.name).join(' · ') : <em>No fronters</em>}</p>
                </div>
              ))}
            </div>
            <div className="rounded-xl p-3" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
              <p className="text-[11px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--color-text-secondary)' }}>Closers</p>
              <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{reference.closers.length ? reference.closers.map(c => c.name).join(' · ') : <em>No closers</em>}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SaleFileRequirementsGuide;
