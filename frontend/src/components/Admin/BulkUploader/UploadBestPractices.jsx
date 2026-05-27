import { useState } from 'react';
import {
  BookOpen, ChevronDown, FileSpreadsheet, Columns3, Type, ShieldAlert,
  Users2, Copy, ListChecks, CheckCircle2, Info, AlertTriangle,
} from 'lucide-react';

// Human-readable formatting rule per form-field type. Derived live from the form
// config so the guidance always matches the actual columns being uploaded.
const TYPE_RULES = {
  text:                 'Plain text. Trim leading/trailing spaces.',
  textarea:             'Plain text (notes).',
  email:                'A valid email, e.g. name@example.com.',
  number:               'Digits only — no “$” or thousands commas (use 1500, not $1,500).',
  zip:                  '5-digit ZIP code.',
  phone:                'Any format accepted; matched on the LAST 10 digits.',
  tel:                  'Any format accepted; matched on the LAST 10 digits.',
  date:                 'Prefer YYYY-MM-DD (e.g. 2026-05-20). DD/MM & MM/DD are auto-detected, but ISO is safest.',
  sale_date:            'Prefer YYYY-MM-DD (e.g. 2026-05-20).',
  select:               'Must exactly match one of the configured dropdown options.',
  checkbox:             'true / false (or yes / no).',
  sale_plan:            'Plan name text.',
  sale_down_payment:    'Numeric amount — digits only (e.g. 500).',
  sale_monthly_payment: 'Numeric amount — digits only (e.g. 150).',
  sale_payment_due_note:'Free-text note.',
  sale_reference_no:    'Unique deal reference (letters/numbers).',
  sale_client:          'Client name text.',
  sale_fronter:         'Fronter name (must match an existing fronter).',
  sale_status:          'Sale status text.',
  sale_disposition:     'Closer disposition text.',
  sale_call_review:     'Must match one of the configured values.',
};
const ruleFor = (ft) => TYPE_RULES[ft] || 'Plain text.';

const Section = ({ icon: Icon, title, defaultOpen = false, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderTop: '1px solid var(--color-border)' }}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <span className="flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--color-text)' }}>
          <Icon size={15} style={{ color: 'var(--color-primary-600)' }} /> {title}
        </span>
        <ChevronDown size={16} className="transition-transform flex-shrink-0" style={{ color: 'var(--color-text-tertiary)', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && <div className="px-4 pb-4 text-sm" style={{ color: 'var(--color-text-secondary)' }}>{children}</div>}
    </div>
  );
};

const Li = ({ children, tone = 'normal' }) => {
  const Icon = tone === 'warn' ? AlertTriangle : tone === 'ok' ? CheckCircle2 : Info;
  const color = tone === 'warn' ? '#d97706' : tone === 'ok' ? 'var(--color-success-600)' : 'var(--color-text-tertiary)';
  return (
    <div className="flex items-start gap-2 mb-1.5">
      <Icon size={13} className="mt-0.5 flex-shrink-0" style={{ color }} />
      <span>{children}</span>
    </div>
  );
};

const Code = ({ children }) => (
  <code className="text-xs font-bold px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text)' }}>{children}</code>
);

// Comprehensive, collapsible upload best-practices for the transfer & sale bulk
// uploaders. `kind` = 'transfer' | 'sale'. `fields` is the live mappable field
// list (each { key, label, required, field_type, isPhone }), so the per-field
// rules table always reflects the current form configuration.
const UploadBestPractices = ({ kind = 'transfer', fields = [], startOpen = false }) => {
  const [open, setOpen] = useState(startOpen);
  const isSale = kind === 'sale';
  const required = fields.filter(f => f.required);

  return (
    <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      {/* Header toggle */}
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between p-4">
        <span className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--gradient-sidebar)' }}>
            <BookOpen size={17} className="text-white" />
          </span>
          <span className="text-left">
            <span className="block text-sm font-bold" style={{ color: 'var(--color-text)' }}>How to prepare your file (best practices)</span>
            <span className="block text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Read this to avoid the most common upload errors.</span>
          </span>
        </span>
        <ChevronDown size={18} className="transition-transform flex-shrink-0" style={{ color: 'var(--color-text-tertiary)', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>

      {/* Always-visible quick rules */}
      <div className="px-4 pb-3 flex flex-wrap gap-2">
        {['CSV or Excel (.xlsx)', 'Max 10 MB', 'Up to 2000 rows', 'One header row', 'UTF-8 encoding'].map(t => (
          <span key={t} className="text-[11px] font-semibold px-2 py-1 rounded-lg" style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>{t}</span>
        ))}
      </div>

      {open && (
        <div>
          <Section icon={FileSpreadsheet} title="1. File format & limits" defaultOpen>
            <Li tone="ok">Save as <Code>.csv</Code> (UTF-8) or <Code>.xlsx</Code>. CSV is the most reliable.</Li>
            <Li tone="ok">Max file size <strong>10 MB</strong>; max <strong>2000 rows</strong> per file — split larger exports.</Li>
            <Li>The <strong>first row must be the column headers</strong>; data starts on row 2.</Li>
            <Li tone="warn">One sheet only. Extra sheets/tabs are ignored — keep the data on the first sheet.</Li>
          </Section>

          <Section icon={Columns3} title="2. Columns — required vs optional">
            <Li>Header names should match the template; you can also remap them on the next screen.</Li>
            <Li tone="ok">Required: {required.length
              ? required.map((f, i) => <span key={f.key}>{i ? ', ' : ''}<Code>{f.key}</Code></span>)
              : <em>none</em>}.</Li>
            <Li>Optional columns can be left out entirely or left blank per row.</Li>
            <Li tone="warn">Don’t rename a column to something ambiguous — keep one column per field.</Li>
          </Section>

          <Section icon={Type} title="3. Data formatting">
            <Li><strong>Phone:</strong> any format works (<Code>(555) 123-4567</Code>, <Code>555-123-4567</Code>); matched on the last 10 digits.</Li>
            <Li><strong>Dates:</strong> prefer <Code>YYYY-MM-DD</Code> (e.g. <Code>2026-05-20</Code>). Mixed DD/MM and MM/DD are auto-detected per column, but ISO removes all doubt.</Li>
            <Li><strong>Names:</strong> full names, normal spacing. Matching ignores case and extra spaces.</Li>
            <Li><strong>Money/numbers:</strong> digits only — no <Code>$</Code>, no thousands commas (<Code>1500</Code>, not <Code>$1,500</Code>).</Li>
            <Li><strong>Emails:</strong> a single valid address per cell.</Li>
          </Section>

          <Section icon={ShieldAlert} title="4. Error prevention">
            <Li tone="warn">No fully blank rows between records (they’re skipped, but keep it clean).</Li>
            <Li tone="warn">No merged cells — each value in its own cell.</Li>
            <Li tone="warn">No formulas — paste <strong>values only</strong> (Excel: Paste Special → Values).</Li>
            <Li tone="warn">Avoid stray special characters (<Code>" , ; \\ tabs</Code>) inside cells.</Li>
            <Li>Keep leading zeros (ZIPs/phones) by formatting those columns as <strong>Text</strong> before entering data.</Li>
          </Section>

          <Section icon={Users2} title="5. Matching company / user names">
            <Li tone="ok">Company, fronter{isSale ? ' and closer' : ''} names must match existing records (case &amp; spacing ignored).</Li>
            <Li>Use the <strong>“Valid names”</strong> list on this screen — copy names from there to avoid typos.</Li>
            <Li tone="warn">A misspelled or unknown name sends the row to <strong>Unmatched</strong> — it won’t import until fixed.</Li>
            {isSale && <Li>Closer is optional; if blank the sale imports without a closer assigned.</Li>}
          </Section>

          <Section icon={Copy} title="6. Duplicates & conflicts">
            {isSale ? (
              <>
                <Li>Each sale is matched to a transfer by <strong>company + fronter + phone</strong>.</Li>
                <Li>If several transfers share that phone, the best is auto-picked (VIN/car match, else the most recent transfer on/before the sale date) — and you can change it per row on the review screen.</Li>
                <Li tone="ok">Re-uploading an existing sale triggers an <strong>update review</strong> (you see exactly what changed) — it won’t duplicate.</Li>
                <Li tone="warn">Tip: run the <strong>Duplicate Transfer cleanup</strong> first so each lead has one transfer — that makes sale matching unambiguous.</Li>
              </>
            ) : (
              <>
                <Li tone="ok"><strong>Same phone + same fronter + same company</strong> = duplicate → auto-skipped.</Li>
                <Li>Same phone under a <strong>different fronter/company</strong> = conflict → you choose include/exclude per row.</Li>
                <Li tone="warn">Tip: use the <strong>Duplicate Transfer cleanup</strong> tool below to merge accidental repeats.</Li>
              </>
            )}
          </Section>

          <Section icon={ListChecks} title="7. Field-by-field rules">
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              {fields.length === 0 ? (
                <p className="p-3 text-xs">Field list loads from the form configuration.</p>
              ) : fields.map((f, i) => (
                <div key={f.key} className="flex items-start gap-2 px-3 py-2"
                  style={{ borderTop: i ? '1px solid var(--color-border)' : 'none', backgroundColor: i % 2 ? 'var(--color-bg-secondary)' : 'transparent' }}>
                  <div className="flex-shrink-0" style={{ minWidth: 150 }}>
                    <Code>{f.key}</Code>
                    {f.required
                      ? <span className="text-[9px] ml-1.5 px-1 py-0.5 rounded font-bold" style={{ backgroundColor: 'var(--color-success-100,#dcfce7)', color: 'var(--color-success-700,#15803d)' }}>REQUIRED</span>
                      : <span className="text-[9px] ml-1.5" style={{ color: 'var(--color-text-tertiary)' }}>optional</span>}
                    {f.isPhone && <span className="text-[9px] ml-1 px-1 py-0.5 rounded font-bold" style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>match key</span>}
                  </div>
                  <span className="text-xs">{ruleFor(f.field_type)}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] mt-2" style={{ color: 'var(--color-text-tertiary)' }}>
              Rules reflect your current form configuration, so they stay accurate as fields change.
            </p>
          </Section>
        </div>
      )}
    </div>
  );
};

export default UploadBestPractices;
