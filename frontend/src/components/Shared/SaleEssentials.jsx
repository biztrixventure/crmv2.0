import { Lock } from 'lucide-react';
import { FIELD_BY_KEY } from '../../utils/saleCopyFields';
import { transferPhone } from '../../utils/phone';

// ============================================================================
// SaleEssentials — the compact lens on a sale: eight fields, nothing else.
//
// WHY A FIXED SET AND NOT ANOTHER CONFIGURABLE PRESET. Two configurable field
// systems already exist on this record — drawer sections (DrawerLayoutRules →
// useDrawerLayout) and copy presets (business_config `copy_presets.sale`). A
// third would be the same decision asked a third way. More importantly this
// view has to survive those systems: if a SuperAdmin hides the "People"
// section, the compact view must STILL show closer and fronter, because the
// point of it is "the eight things you need to identify this policy while
// you are on the phone", not "a shorter version of whatever is configured".
// So it is deliberately NOT filtered by useDrawerLayout.
//
// It is not a second field REGISTRY either: every accessor below comes from
// saleCopyFields.js, the catalog the copy button already uses. One definition
// of "where does the policy number live", shared by both.
//
// MASKING. Nothing is unmasked here. PII/financial redaction happens server
// side (readonlyDataGuard on /api/sales, maskForReadonly in compliance) before
// the row reaches this component, and the money row additionally honours the
// same `canFinancial` gate the full drawer applies. A compact view must not be
// an easier way to see something — only a faster way to see the same thing.
// ============================================================================

const get = (key, sale, fd) => {
  const f = FIELD_BY_KEY[key];
  if (!f) return '';
  try { return String(f.get(sale, fd) ?? '').trim(); } catch { return ''; }
};

// A masked phone ("•••-••21") must not become a tel: link — it would dial
// nothing. Only linkify when there are enough real digits to be a number.
const dialable = (v) => (String(v).match(/\d/g) || []).length >= 7;

const Cell = ({ label, value, mono = false, href = null, locked = false, strong = false }) => (
  <div className="rounded-xl px-3 py-2.5"
    style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
    <p className="text-[11px] font-bold uppercase tracking-wide m-0"
      style={{ color: 'var(--color-text-tertiary)' }}>{label}</p>
    {locked ? (
      <p className="text-sm m-0 mt-1 inline-flex items-center gap-1.5"
        style={{ color: 'var(--color-text-tertiary)' }}>
        <Lock size={12} /> Hidden
      </p>
    ) : href ? (
      <a href={href}
        className={`text-[15px] m-0 mt-1 block break-words underline decoration-dotted underline-offset-2 ${mono ? 'font-mono' : ''}`}
        style={{ color: 'var(--color-primary-600)', fontWeight: 600 }}>{value}</a>
    ) : (
      <p className={`text-[15px] m-0 mt-1 break-words ${mono ? 'font-mono' : ''}`}
        style={{ color: value ? 'var(--color-text)' : 'var(--color-text-tertiary)', fontWeight: strong ? 700 : 500 }}>
        {value || '—'}
      </p>
    )}
  </div>
);

export default function SaleEssentials({ sale, canFinancial = false }) {
  if (!sale) return null;
  const fd = sale.form_data || {};

  // Phone: the catalog getter covers the typed column and the form_data keys;
  // transferPhone additionally covers `normalized_phone`, which is where
  // VICIDIAL-sourced rows keep the number and where the catalog stops.
  const phone = get('cli', sale, fd) || transferPhone(sale);

  // Policy number: `sales.policy_number` is a GENERATED column reading
  // form_data PolicyNumber/policy_no/… (mig 080) and is NULL on effectively
  // every real row, because nobody enters those keys — the identifier staff
  // actually quote is reference_no. The catalog's `ref` getter already tries
  // policy_number first and falls back to reference_no, which is the order
  // wanted here; this is why it reuses `ref` rather than reading a column.
  const policy = get('ref', sale, fd);

  const down = get('down', sale, fd);
  const downLabel = down !== '' && !Number.isNaN(Number(down))
    ? `$${Number(down).toLocaleString()}`
    : down;

  return (
    <div className="space-y-2">
      <Cell label="Customer"      value={get('name', sale, fd)} strong />
      <Cell label="Phone"         value={phone} mono
        href={phone && dialable(phone) ? `tel:${String(phone).replace(/[^\d+]/g, '')}` : null} />
      <Cell label="Policy Number" value={policy ? policy.toUpperCase() : ''} mono strong />
      <Cell label="Client"        value={get('client', sale, fd)} />
      <Cell label="Company"       value={get('company', sale, fd)} />
      <Cell label="Fronter"       value={get('fronter', sale, fd)} />
      <Cell label="Closer"        value={get('closer', sale, fd)} />
      {/* Locked, not omitted: a viewer without financial access should see
          that a down payment exists and is withheld, rather than a gap they
          could read as "no down payment was taken". */}
      <Cell label="Down Payment"  value={downLabel} locked={!canFinancial} strong />
    </div>
  );
}
