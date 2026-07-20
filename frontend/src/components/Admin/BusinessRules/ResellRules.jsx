import { useState } from 'react';
import ThemedSelect from '../../UI/Select';
import {
  RefreshCw, Plus, Trash2, Info, AlertTriangle, RotateCcw, X,
  ShieldCheck, ShieldAlert, Eye, EyeOff, Lightbulb, Clock,
  Users, UserCheck, Split, Ban, MessageSquare, Type, HelpCircle, CheckCircle2, XCircle,
} from 'lucide-react';

// ── Reference data ──────────────────────────────────────────────────────────
const ALL_SALE_STATUSES = [
  { key: 'cancelled',            label: 'Cancelled',            danger: false, desc: 'Closer cancelled before submitting'  },
  { key: 'compliance_cancelled', label: 'Compliance Cancelled', danger: false, desc: 'Compliance rejected outright'        },
  { key: 'closed_won',           label: 'Closed Won (Sold)',    danger: false, desc: 'Customer has an active policy'       },
  { key: 'sold',                 label: 'Sold (legacy)',        danger: false, desc: 'Legacy status — pre-compliance flow' },
  { key: 'closed_lost',          label: 'Closed Lost',          danger: false, desc: 'Customer decided not to buy'         },
  { key: 'expired',              label: 'Expired',              danger: false, desc: 'Policy ran out — renewal candidate'  },
  { key: 'chargeback',           label: 'Chargeback',           danger: true,  desc: 'Bank reversed payment — risky'       },
  { key: 'dispute',              label: 'Dispute',              danger: true,  desc: 'Customer escalated a complaint'      },
];

const ATTRIBUTION_OPTS = [
  { key: 'closer',
    label: 'Closer keeps full credit',
    detail: 'Original fronter still owns the lead, but the resell sale counts toward the closer.',
    icon: UserCheck,
    impact: 'Closer dashboard +1 sale · Fronter dashboard unchanged' },
  { key: 'fronter',
    label: 'Fronter retains credit',
    detail: 'Fronter gets credit for every sale on their lead, even resells. Closer logged only as the actor.',
    icon: Users,
    impact: 'Closer dashboard +1 sale · Fronter dashboard +1 sale' },
  { key: 'split',
    label: 'Split 50/50',
    detail: 'Both fronter and closer get half a sale on the report. Useful for shared-bonus models.',
    icon: Split,
    impact: 'Closer dashboard +0.5 · Fronter dashboard +0.5' },
];

const INTENT_EMPHASIS = [
  { key: 'warn',  label: 'Warning (amber)',  desc: 'Used for resells that cancel the old policy.' },
  { key: 'info',  label: 'Info (neutral)',   desc: 'Default — neutral business action.'           },
  { key: 'muted', label: 'Muted (grey)',     desc: 'Background catch-all option.'                 },
];

const EMPHASIS_DOT = { warn: '#d97706', info: '#2563eb', muted: '#6b7280' };
const EMPHASIS_BG  = { warn: '#fffbeb', info: '#eff6ff', muted: '#f3f4f6' };

// ── Helpers ─────────────────────────────────────────────────────────────────
const cfg = (config, key, fallback) => (config?.[key] !== undefined ? config[key] : fallback);

// ── Mini sub-components ─────────────────────────────────────────────────────

/* Section card — title + desc + optional "Learn more" expandable hint. */
const Section = ({ title, icon: Icon, desc, accent = 'primary', helpTitle, helpBody, children }) => {
  const [help, setHelp] = useState(false);
  return (
    <section
      className="rounded-2xl mb-4 overflow-hidden"
      style={{
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderTop: `3px solid var(--color-${accent}-500, #6366f1)`,
      }}
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-base font-bold text-text flex items-center gap-2">
            {Icon && <Icon size={16} className={`text-${accent}-600`} />}
            {title}
          </h2>
          {(helpTitle || helpBody) && (
            <button type="button" onClick={() => setHelp(h => !h)}
              className="text-[11px] font-semibold inline-flex items-center gap-1 px-2 py-1 rounded-md flex-shrink-0"
              style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}
              aria-expanded={help}>
              <HelpCircle size={11} /> {help ? 'Hide info' : 'What does this do?'}
            </button>
          )}
        </div>
        {desc && <p className="text-xs text-text-secondary mb-3 max-w-2xl leading-relaxed">{desc}</p>}
        {help && (helpTitle || helpBody) && (
          <div className="rounded-xl p-3 mb-4 flex items-start gap-2"
            style={{ backgroundColor: 'var(--color-primary-50, #eef2ff)', border: '1px solid var(--color-primary-200, #c7d2fe)' }}>
            <Lightbulb size={14} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-primary-700, #4338ca)' }} />
            <div className="text-xs leading-relaxed" style={{ color: 'var(--color-primary-700, #4338ca)' }}>
              {helpTitle && <p className="font-bold mb-0.5">{helpTitle}</p>}
              {helpBody}
            </div>
          </div>
        )}
        {children}
      </div>
    </section>
  );
};

/* Inline impact tag — small "What happens" pill with semantics-aware color. */
const ImpactPill = ({ icon: Icon = Info, color = '#4338ca', bg = '#eef2ff', children }) => (
  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold"
    style={{ backgroundColor: bg, color }}>
    <Icon size={10} /> {children}
  </span>
);

/* Checkbox row — meets 44pt + optional impact line. */
const CheckboxRow = ({ checked, onChange, label, sub, danger, impactOn, impactOff }) => (
  <label
    className="flex items-start gap-3 py-2 px-3 rounded-lg cursor-pointer hover:bg-bg-secondary transition-colors min-h-[44px]"
    style={{ border: '1px solid', borderColor: checked ? 'var(--color-primary-200, #c7d2fe)' : 'var(--color-border)' }}
  >
    <input
      type="checkbox" checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="mt-1 w-4 h-4 flex-shrink-0 cursor-pointer"
      style={{ accentColor: danger ? 'var(--color-error-600)' : 'var(--color-primary-600)' }}
      aria-label={label}
    />
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold text-text">{label}</span>
        {danger && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
            style={{ backgroundColor: 'var(--color-warning-100, #fef3c7)', color: 'var(--color-warning-700, #b45309)' }}>
            Risky
          </span>
        )}
      </div>
      {sub && <p className="text-xs text-text-tertiary mt-0.5">{sub}</p>}
      {(impactOn || impactOff) && (
        <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
          {checked ? (impactOn || null) : (impactOff || null)}
        </p>
      )}
    </div>
  </label>
);

/* Radio card — pick from a list of mutually exclusive options. */
const RadioCard = ({ value, onChange, options, name }) => (
  <div role="radiogroup" aria-label={name} className="space-y-1.5">
    {options.map(opt => {
      const active = value === opt.key;
      const OptIcon = opt.icon || RefreshCw;
      return (
        <label key={opt.key}
          className="flex items-start gap-3 py-3 px-3 rounded-xl cursor-pointer transition-all"
          style={{
            border: '1px solid', minHeight: 44,
            borderColor:     active ? 'var(--color-primary-400, #818cf8)' : 'var(--color-border)',
            backgroundColor: active ? 'var(--color-primary-50, #eef2ff)' : 'transparent',
            boxShadow: active ? '0 1px 0 rgba(99,102,241,0.06)' : 'none',
          }}>
          <input type="radio" name={name} checked={active} onChange={() => onChange(opt.key)}
            className="mt-1 w-4 h-4 flex-shrink-0 cursor-pointer"
            style={{ accentColor: 'var(--color-primary-600)' }} />
          <div className="rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ width: 32, height: 32, backgroundColor: active ? 'var(--color-primary-100, #e0e7ff)' : 'var(--color-bg-secondary)' }}>
            <OptIcon size={15} style={{ color: active ? 'var(--color-primary-700, #4338ca)' : 'var(--color-text-secondary)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-text">{opt.label}</p>
            {opt.detail && <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">{opt.detail}</p>}
            {opt.impact && (
              <div className="mt-1.5">
                <ImpactPill icon={CheckCircle2}>{opt.impact}</ImpactPill>
              </div>
            )}
          </div>
        </label>
      );
    })}
  </div>
);

/* Numeric input w/ unit + plus/minus steppers for touch-friendly tweaks. */
const NumberStepper = ({ value, onChange, unit, min = 0, max = 999, step = 1, helper }) => {
  const dec = () => onChange(Math.max(min, value - step));
  const inc = () => onChange(Math.min(max, value + step));
  return (
    <div>
      <div className="inline-flex items-stretch rounded-lg overflow-hidden"
        style={{ border: '1px solid var(--color-border)' }}>
        <button type="button" onClick={dec} aria-label="Decrease" disabled={value <= min}
          className="px-3 hover:bg-bg-secondary disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ minHeight: 40 }}>
          –
        </button>
        <input type="number" value={value}
          onChange={(e) => onChange(Math.max(min, Math.min(max, parseInt(e.target.value, 10) || 0)))}
          min={min} max={max}
          className="w-20 text-center text-sm tabular-nums focus:outline-none"
          style={{ fontVariantNumeric: 'tabular-nums', border: 'none', backgroundColor: 'var(--color-surface)' }} />
        <button type="button" onClick={inc} aria-label="Increase" disabled={value >= max}
          className="px-3 hover:bg-bg-secondary disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ minHeight: 40 }}>
          +
        </button>
        <div className="px-3 flex items-center text-xs text-text-secondary"
          style={{ borderLeft: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
          {unit}
        </div>
      </div>
      {helper && <p className="text-xs text-text-tertiary mt-2 max-w-md leading-relaxed">{helper}</p>}
    </div>
  );
};

/* Confirm dialog — used by intent removal so a slip-click can't wipe a row. */
const ConfirmDialog = ({ open, title, body, confirmLabel = 'Remove', onConfirm, onCancel, danger }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="w-full max-w-md rounded-2xl shadow-2xl"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-start gap-3 p-5">
          <div className="rounded-xl p-2 flex-shrink-0"
            style={{ backgroundColor: danger ? '#fee2e2' : 'var(--color-warning-100, #fef3c7)' }}>
            <AlertTriangle size={18} style={{ color: danger ? '#dc2626' : 'var(--color-warning-700, #b45309)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-text mb-1">{title}</h3>
            <div className="text-sm text-text-secondary leading-relaxed">{body}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 px-5 py-3"
          style={{ borderTop: '1px solid var(--color-border)' }}>
          <div className="flex-1" />
          <button type="button" onClick={onCancel}
            className="px-3 py-2 rounded-lg text-sm font-semibold"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', minHeight: 36 }}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm}
            className="px-3 py-2 rounded-lg text-sm font-bold text-white inline-flex items-center gap-1.5"
            style={{ backgroundColor: danger ? '#dc2626' : 'var(--color-warning-600, #d97706)', minHeight: 36 }}>
            <Trash2 size={12} /> {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Main page ────────────────────────────────────────────────────────────────
const ResellRules = ({ config, scope, onSave }) => {
  const enabledStatuses = cfg(config, 'resell.enabled_statuses', []);
  const warningStatuses = cfg(config, 'resell.warning_statuses', []);
  const intents         = cfg(config, 'resell.intents', []);
  const confirmPrompt   = cfg(config, 'resell.confirm_prompt', '');
  const cooldownDays    = cfg(config, 'resell.cooldown_days', 7);
  const hideFronter     = cfg(config, 'resell.hide_from_fronter', true);
  const hideFrManager   = cfg(config, 'resell.hide_from_fronter_manager', true);
  const hideCompliance  = cfg(config, 'resell.hide_from_compliance', false);
  const attribution     = cfg(config, 'resell.attribution', 'closer');
  const autoBlockCb     = cfg(config, 'resell.auto_block_after_chargebacks', 2);
  const requireReason   = cfg(config, 'resell.require_reason_text', false);

  const [newIntent, setNewIntent]   = useState('');
  const [removeIdx, setRemoveIdx]   = useState(null);

  const toggleStatus = (which, statusKey) => {
    const set = which === 'enabled' ? [...enabledStatuses] : [...warningStatuses];
    const i = set.indexOf(statusKey);
    if (i >= 0) set.splice(i, 1); else set.push(statusKey);
    onSave(`resell.${which}_statuses`, set);
  };
  const updateIntent = (idx, patch) => {
    const next = [...intents];
    next[idx] = { ...next[idx], ...patch };
    onSave('resell.intents', next);
  };
  const confirmRemoveIntent = () => {
    if (removeIdx == null) return;
    onSave('resell.intents', intents.filter((_, i) => i !== removeIdx));
    setRemoveIdx(null);
  };
  const addIntent = () => {
    const label = newIntent.trim();
    if (!label) return;
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 32);
    if (!key || intents.some(i => i.key === key)) return;
    onSave('resell.intents', [...intents, { key, label, emphasis: 'info' }]);
    setNewIntent('');
  };

  // Derived stats for the hero summary.
  const eligibleCount   = enabledStatuses.length;
  const riskyCount      = warningStatuses.length;
  const intentCount     = intents.length;
  const privacyHidden   = [hideFronter && 'fronters', hideFrManager && 'fronter managers', hideCompliance && 'compliance']
    .filter(Boolean).join(', ');

  return (
    <div className="max-w-3xl pb-8">
      {/* ── Hero summary banner ──────────────────────────────────────── */}
      <div className="rounded-2xl p-5 mb-5 flex items-start gap-4 flex-wrap"
        style={{
          background: 'linear-gradient(135deg, var(--color-primary-50, #eef2ff) 0%, var(--color-surface) 70%)',
          border: '1px solid var(--color-primary-200, #c7d2fe)',
        }}>
        <div className="rounded-xl p-3 flex-shrink-0"
          style={{ backgroundColor: 'var(--color-primary-100, #e0e7ff)' }}>
          <RefreshCw size={22} style={{ color: 'var(--color-primary-700, #4338ca)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-text mb-1"
            style={{ fontFamily: 'var(--font-display)' }}>
            Resell &amp; Re-engagement
          </h1>
          <p className="text-sm text-text-secondary leading-relaxed max-w-2xl">
            A <strong>resell</strong> is a brand-new sale created on a customer who already exists in the system — same transfer, fresh policy. Use this page to control <strong>when</strong>, <strong>how</strong>, and <strong>by whom</strong> resells can happen, plus what each role sees afterwards.
          </p>
          {/* Live summary chips */}
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <ImpactPill icon={CheckCircle2}>{eligibleCount} eligible statuses</ImpactPill>
            {riskyCount > 0 && <ImpactPill icon={AlertTriangle} color="#b45309" bg="#fef3c7">{riskyCount} risky · reason required</ImpactPill>}
            <ImpactPill icon={Type} color="#1d4ed8" bg="#dbeafe">{intentCount} intent option{intentCount !== 1 ? 's' : ''}</ImpactPill>
            <ImpactPill icon={Clock} color="#b45309" bg="#fef3c7">{cooldownDays}d cooldown</ImpactPill>
            {privacyHidden && <ImpactPill icon={EyeOff} color="#6b7280" bg="#f3f4f6">hidden from {privacyHidden}</ImpactPill>}
          </div>
        </div>
      </div>

      {/* Per-company override banner */}
      {scope !== 'global' && (
        <div className="rounded-2xl p-4 mb-4 flex items-start gap-3"
          style={{ backgroundColor: 'var(--color-warning-50, #fffbeb)', border: '1px solid var(--color-warning-300, #fcd34d)' }}>
          <AlertTriangle size={18} style={{ color: 'var(--color-warning-700, #b45309)' }} className="flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-bold mb-0.5" style={{ color: 'var(--color-warning-800, #92400e)' }}>Per-company override active</p>
            <p style={{ color: 'var(--color-warning-700, #b45309)' }}>
              Changes here apply only to the selected company. Anything you leave unchanged falls back to the global defaults — so removing an item here just restores the global value, never a true delete.
            </p>
          </div>
        </div>
      )}

      {/* ── 1. Eligibility ─────────────────────────────────────────────── */}
      <Section
        accent="primary"
        icon={ShieldCheck}
        title="When can closers resell?"
        desc="The Resell button appears on a sale only when its status is in this list. Statuses marked Risky add a mandatory written reason."
        helpTitle="Why this exists"
        helpBody={
          <span>
            Resells should only happen when there's a real customer relationship to revisit — a closed sale, a cancelled one, an expired policy. Letting closers resell during compliance review or before any sale exists would inflate counts and produce duplicate work.<br/><br/>
            <strong>If you uncheck everything here</strong>, the Resell button never appears anywhere. Existing resells in the database stay intact — this is a forward-only toggle.
          </span>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {ALL_SALE_STATUSES.map(s => (
            <CheckboxRow
              key={s.key}
              checked={enabledStatuses.includes(s.key)}
              onChange={() => toggleStatus('enabled', s.key)}
              label={s.label}
              danger={s.danger}
              sub={s.desc}
            />
          ))}
        </div>

        <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
          <p className="text-xs font-bold uppercase tracking-wide text-text-secondary mb-2 flex items-center gap-1.5">
            <ShieldAlert size={12} /> Reason required for these statuses
          </p>
          <p className="text-[11px] text-text-tertiary mb-2 leading-relaxed">
            Customers with chargebacks or disputes need extra paperwork. Checking a status here forces the closer to type a reason on the resell modal — and the reason lands in the audit log.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {ALL_SALE_STATUSES.filter(s => s.danger).map(s => (
              <CheckboxRow
                key={s.key}
                checked={warningStatuses.includes(s.key)}
                onChange={() => toggleStatus('warning', s.key)}
                label={s.label}
                danger
                sub={s.desc}
              />
            ))}
          </div>
        </div>
      </Section>

      {/* ── 2. Intents ─────────────────────────────────────────────────── */}
      <Section
        accent="info"
        icon={Type}
        title="Resell intent options"
        desc="The dropdown closers pick from on the confirm modal. Each entry tags the new sale for reporting — 'Resell', 'Additional car', 'Renewal', or anything you invent."
        helpTitle="What is an intent?"
        helpBody={
          <span>
            Intent answers <em>why</em> a sale is being created. Two policies on one customer could mean very different things — a renewal after expiry vs. an extra car added vs. a customer-replacement after a cancel. Tagging each new sale lets reports separate them.<br/><br/>
            <strong>If you remove an intent</strong>, old sales tagged with it keep their label in their drawer + audit log; they just don't render the deleted intent in the dropdown anymore. Safe to remove.
          </span>
        }
      >
        <div className="space-y-2">
          {intents.length === 0 && (
            <div className="rounded-xl p-3 text-xs leading-relaxed"
              style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)', border: '1px dashed var(--color-border)' }}>
              No intents yet. Add at least one below — closers can't resell without picking an intent.
            </div>
          )}
          {intents.map((intent, idx) => (
            <div key={intent.key + idx}
              className="rounded-xl p-2.5 flex flex-wrap items-center gap-2"
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderLeft: `3px solid ${EMPHASIS_DOT[intent.emphasis || 'info']}`,
              }}>
              <span className="text-[10px] font-mono px-1.5 py-1 rounded font-bold flex-shrink-0"
                style={{ backgroundColor: EMPHASIS_BG[intent.emphasis || 'info'], color: EMPHASIS_DOT[intent.emphasis || 'info'] }}>
                {intent.key}
              </span>
              <input
                type="text" value={intent.label}
                onChange={(e) => updateIntent(idx, { label: e.target.value })}
                className="input text-sm py-1.5 flex-1 min-w-[140px]"
                aria-label={`Intent label for ${intent.key}`}
                placeholder="Display label"
              />
              <ThemedSelect
                value={intent.emphasis || 'info'}
                onChange={(e) => updateIntent(idx, { emphasis: e.target.value })}
                className="input text-xs py-1.5"
                style={{ minWidth: 140 }}
                aria-label={`Emphasis for ${intent.key}`}>
                {INTENT_EMPHASIS.map(e => <option key={e.key} value={e.key}>{e.label}</option>)}
              </ThemedSelect>
              <button type="button" onClick={() => setRemoveIdx(idx)}
                className="p-2 rounded-lg hover:bg-error-50 transition-colors flex-shrink-0"
                aria-label={`Remove intent ${intent.label}`}
                style={{ minWidth: 36, minHeight: 36, border: '1px solid #fecaca' }}>
                <Trash2 size={13} style={{ color: '#dc2626' }} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <input
            type="text" value={newIntent}
            onChange={(e) => setNewIntent(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addIntent(); }}
            placeholder="New intent label (e.g. Coverage upgrade)"
            className="input text-sm py-2 flex-1 min-w-[180px]" />
          <span className="text-[10px] font-mono px-2 py-1 rounded whitespace-nowrap"
            style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}>
            key: <strong>{newIntent.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 32) || '—'}</strong>
          </span>
          <button type="button" onClick={addIntent}
            disabled={!newIntent.trim() || intents.some(i => i.key === newIntent.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 32))}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: 'var(--gradient-sidebar)', minHeight: 40 }}>
            <Plus size={14} /> Add intent
          </button>
        </div>
      </Section>

      {/* ── 3. Confirm prompt ──────────────────────────────────────────── */}
      <Section
        accent="warning"
        icon={MessageSquare}
        title="Confirmation prompt"
        desc="Text the closer sees on the resell modal right before they commit. Mandatory failsafe — there's no way to bypass."
        helpTitle="Why a mandatory prompt"
        helpBody={
          <span>
            The closer is about to mark an existing sale as cancelled (sometimes) and start a fresh one. That's a big workflow event. The prompt is the last chance to back out, so the wording should be clear about <em>what changes for the old policy</em> and <em>what happens next</em>.
          </span>
        }>
        <textarea
          value={confirmPrompt}
          onChange={(e) => onSave('resell.confirm_prompt', e.target.value)}
          rows={3}
          className="input text-sm py-2 w-full font-mono leading-relaxed"
          placeholder="Are you sure you want to resell this policy? …"
        />
        <p className="text-xs text-text-tertiary mt-2 leading-relaxed flex items-start gap-1.5">
          <Info size={12} className="flex-shrink-0 mt-0.5" />
          Tip: name the old reference number and what its status will become. Empty prompt falls back to the system default.
        </p>
      </Section>

      {/* ── 4. Cooldown ────────────────────────────────────────────────── */}
      <Section
        accent="warning"
        icon={Clock}
        title="Cooldown between resells"
        desc="Minimum days between resells on the same sale. Prevents accidental double-clicks and a single closer racking up resells in minutes."
        helpTitle="What this enforces"
        helpBody={<span>The backend checks the original sale's <code>last_resold_at</code>. If the gap is shorter than this number, the resell request is rejected with a clear error. Closers can still resell other customers freely.</span>}
      >
        <NumberStepper
          value={cooldownDays}
          onChange={(v) => onSave('resell.cooldown_days', v)}
          unit="days" min={0} max={365}
          helper="0 = no cooldown (anyone can resell anytime). 7 days is a comfortable default for warranty workflows."
        />
      </Section>

      {/* ── 5. Privacy ─────────────────────────────────────────────────── */}
      <Section
        accent="error"
        icon={EyeOff}
        title="Privacy — who sees resells?"
        desc="Fronters earn credit for the original lead, not the resell. Hiding resells from fronter views keeps their KPI clean and avoids surprise attribution disputes."
        helpTitle="What 'hidden' means"
        helpBody={
          <span>
            Hiding flags the resell as invisible to that role in dashboards, sales lists, drawers, and CSV exports. The row still exists in the database and is fully visible to compliance + superadmin. The toggles here just gate what each role's queries return.<br/><br/>
            <strong>If you uncheck all three</strong>, every role sees every resell — useful for shops that want full transparency.
          </span>
        }
      >
        <div className="space-y-1.5">
          <CheckboxRow checked={hideFronter}
            onChange={(v) => onSave('resell.hide_from_fronter', v)}
            label="Hide resells from fronters"
            sub="The original fronter sees only their first sale on the lead"
            impactOn="Fronter dashboard count stays at 1 sale per lead." />
          <CheckboxRow checked={hideFrManager}
            onChange={(v) => onSave('resell.hide_from_fronter_manager', v)}
            label="Hide resells from fronter managers"
            sub="The fronter company's manager dashboard excludes resells"
            impactOn="Fronter co. team report excludes resells from totals." />
          <CheckboxRow checked={hideCompliance}
            onChange={(v) => onSave('resell.hide_from_compliance', v)}
            label="Hide resells from compliance"
            sub="Compliance needs the full audit picture — disable cautiously"
            impactOn="Compliance reports omit resells. Not recommended."
            danger />
        </div>
      </Section>

      {/* ── 6. Attribution ─────────────────────────────────────────────── */}
      <Section
        accent="success"
        icon={UserCheck}
        title="Attribution model"
        desc="Who gets the sale count credit when a resell closes. Affects every dashboard + conversion-rate calculation."
        helpTitle="Pick what matches your bonus model"
        helpBody={<span>If commission is per closer, leave on <em>Closer keeps full credit</em>. If fronters get a renewal trail, switch to <em>Fronter retains</em>. <em>Split</em> is for shops with a shared-bonus structure.</span>}
      >
        <RadioCard name="attribution"
          value={attribution}
          onChange={(v) => onSave('resell.attribution', v)}
          options={ATTRIBUTION_OPTS} />
      </Section>

      {/* ── 7. Auto-block ──────────────────────────────────────────────── */}
      <Section
        accent="error"
        icon={Ban}
        title="Auto-block after repeated chargebacks"
        desc="Stops endless resell loops on customers who keep disputing charges. After N chargebacks the customer becomes resell-blocked and only a manager can override."
        helpTitle="Safety net"
        helpBody={<span>The backend counts chargebacks on the customer's CLI across every policy they've held. If the count reaches this number, every resell request returns 403 with an explanation. Managers can override per-case from the drawer.</span>}>
        <NumberStepper value={autoBlockCb}
          onChange={(v) => onSave('resell.auto_block_after_chargebacks', v)}
          unit="chargebacks" min={0} max={20}
          helper="0 = never auto-block. 2 is a common threshold." />
      </Section>

      {/* ── 8. Reason required ─────────────────────────────────────────── */}
      <Section
        accent="primary"
        icon={Type}
        title="Always require a reason"
        desc="Force closers to type a short explanation alongside the intent on every resell — even for non-risky statuses."
        helpTitle="Audit quality vs. friction"
        helpBody={<span>Mandatory reasons make the audit log far easier to scan months later. The trade-off is the extra type for the closer. Most ops shops leave this OFF and rely on the per-status 'Reason required' list above.</span>}>
        <CheckboxRow checked={requireReason}
          onChange={(v) => onSave('resell.require_reason_text', v)}
          label="Always require a reason on resell"
          sub="If off, only risky statuses prompt for a reason"
          impactOn="Every resell shows a required text box on the confirm modal."
          impactOff="Reasons stay optional except for risky statuses." />
      </Section>

      {/* Remove intent confirmation */}
      <ConfirmDialog
        open={removeIdx != null}
        title={removeIdx != null ? `Remove intent "${intents[removeIdx]?.label}"?` : ''}
        body={
          <div>
            <p>This option will disappear from the resell dropdown immediately.</p>
            <ul className="mt-2 list-disc list-inside space-y-1 text-[12px]">
              <li>Existing sales already tagged with this intent keep the tag in their drawer + audit log.</li>
              <li>You can re-add the same label anytime — it stores under the same key.</li>
              {scope !== 'global' && <li>This is a per-company override — removing it falls back to the global default, not a true delete.</li>}
            </ul>
          </div>
        }
        confirmLabel="Remove intent"
        danger
        onConfirm={confirmRemoveIntent}
        onCancel={() => setRemoveIdx(null)}
      />
    </div>
  );
};

export default ResellRules;
