import { useEffect, useState } from 'react';
import { RefreshCw, AlertTriangle, X, Info, ShieldAlert } from 'lucide-react';
import { Button, AutoResizeTextarea } from '../UI';
import client from '../../api/client';

// ── Default intents — live config overrides these if present ───────────────
const FALLBACK_INTENTS = [
  { key: 'resell',         label: 'Resell (cancel old policy)', emphasis: 'warn'  },
  { key: 'additional_car', label: 'Additional car',             emphasis: 'info'  },
  { key: 'renewal',        label: 'Renewal',                    emphasis: 'info'  },
  { key: 'other',          label: 'Other',                      emphasis: 'muted' },
];

const FALLBACK_PROMPT = 'Are you sure you want to resell this policy? Old policy will be marked compliance_cancelled and a fresh sale will start in pending_review.';

const EMPHASIS_STYLE = {
  warn:  { color: 'var(--color-warning-700, #b45309)', bg: 'var(--color-warning-50, #fffbeb)', border: 'var(--color-warning-300, #fcd34d)' },
  info:  { color: 'var(--color-primary-700, #4338ca)', bg: 'var(--color-primary-50, #eef2ff)', border: 'var(--color-primary-300, #c7d2fe)' },
  muted: { color: 'var(--color-text-secondary)',        bg: 'var(--color-bg-secondary)',         border: 'var(--color-border)' },
};

/* Resell flow modal. Pulls business config on open so closer sees the
   superadmin-configured intent list + confirm copy without a deploy.
   - Step 1: pick intent
   - Step 2: confirm + optional/required reason
   - Submit: POST /sales/:id/resell, returns new sale → onSuccess(newSale).
*/
export default function ResellModal({ isOpen, sale, onClose, onSuccess }) {
  const [config, setConfig] = useState({});
  const [step, setStep]     = useState('intent');   // 'intent' | 'confirm'
  const [intent, setIntent] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy]     = useState(false);
  const [err, setErr]       = useState('');

  // Load config once when opened — small payload, server-cached.
  useEffect(() => {
    if (!isOpen) return;
    setStep('intent'); setIntent(''); setReason(''); setErr('');
    client.get('business-config')
      .then(r => setConfig(r.data?.config || {}))
      .catch(() => setConfig({}));
  }, [isOpen, sale?.id]);

  if (!isOpen || !sale) return null;

  const intents          = config['resell.intents']             || FALLBACK_INTENTS;
  const prompt           = config['resell.confirm_prompt']      || FALLBACK_PROMPT;
  const requireReason    = !!config['resell.require_reason_text'];
  const warningStatuses  = config['resell.warning_statuses']    || [];
  const isWarnStatus     = warningStatuses.includes(sale.status);
  const reasonMandatory  = requireReason || isWarnStatus;

  const selected = intents.find(i => i.key === intent);
  const emphasis = EMPHASIS_STYLE[selected?.emphasis || 'info'];

  const goConfirm = () => {
    if (!intent) { setErr('Choose an intent first.'); return; }
    setErr('');
    setStep('confirm');
  };

  const submit = async () => {
    if (reasonMandatory && !reason.trim()) {
      setErr('A written reason is required for this status.');
      return;
    }
    setBusy(true); setErr('');
    try {
      const { data } = await client.post(`sales/${sale.id}/resell`, {
        intent,
        reason: reason.trim() || undefined,
      });
      onSuccess?.(data.sale, data.old_sale);
      onClose();
    } catch (e) {
      setErr(e.response?.data?.error || e.message || 'Resell failed.');
    } finally { setBusy(false); }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="resell-modal-title"
      className="fixed inset-0 z-50 overflow-y-auto"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          className="w-full max-w-md rounded-2xl shadow-2xl flex flex-col"
          style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', maxHeight: 'calc(100vh - 32px)' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
            style={{ background: 'var(--gradient-sidebar)', borderTopLeftRadius: '1rem', borderTopRightRadius: '1rem' }}>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-white/20">
                <RefreshCw size={16} className="text-white" />
              </div>
              <div>
                <h2 id="resell-modal-title" className="text-base font-bold text-white">
                  {step === 'intent' ? 'New sale on this lead' : 'Confirm resell'}
                </h2>
                <p className="text-xs text-white/75 truncate max-w-[260px]">{sale.customer_name || sale.reference_no || 'Sale'}</p>
              </div>
            </div>
            <button onClick={onClose} aria-label="Close"
              className="p-2 rounded-xl bg-white/20 hover:bg-white/30 transition-colors min-w-[36px] min-h-[36px]">
              <X size={16} className="text-white" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {step === 'intent' ? (
              <>
                <p className="text-sm text-text-secondary mb-4 leading-relaxed">
                  Pick what this new sale represents. Old policy <strong className="font-mono text-text">#{sale.reference_no}</strong> may be marked cancelled depending on the intent.
                </p>
                <fieldset>
                  <legend className="sr-only">Resell intent</legend>
                  <div className="space-y-1.5">
                    {intents.map(i => {
                      const em = EMPHASIS_STYLE[i.emphasis || 'info'];
                      const active = intent === i.key;
                      return (
                        <label
                          key={i.key}
                          className="flex items-start gap-3 py-2.5 px-3 rounded-xl cursor-pointer transition-all"
                          style={{
                            border: '1px solid',
                            borderColor: active ? em.border : 'var(--color-border)',
                            backgroundColor: active ? em.bg : 'transparent',
                            minHeight: 44,
                          }}
                        >
                          <input
                            type="radio"
                            name="resell-intent"
                            checked={active}
                            onChange={() => setIntent(i.key)}
                            className="mt-1 w-4 h-4 flex-shrink-0 cursor-pointer"
                            style={{ accentColor: em.color }}
                          />
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-text">{i.label}</p>
                            {i.key === 'additional_car' && (
                              <p className="text-xs text-text-tertiary mt-0.5">Old policy stays active. Fresh blank vehicle.</p>
                            )}
                            {i.key === 'resell' && (
                              <p className="text-xs text-text-tertiary mt-0.5">Old policy → compliance_cancelled. Car details carry over.</p>
                            )}
                            {i.key === 'renewal' && (
                              <p className="text-xs text-text-tertiary mt-0.5">Old policy → expired. Car details carry over.</p>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                {isWarnStatus && (
                  <div className="mt-4 p-3 rounded-xl flex items-start gap-2"
                    style={{ backgroundColor: 'var(--color-warning-50, #fffbeb)', border: '1px solid var(--color-warning-300, #fcd34d)' }}>
                    <ShieldAlert size={14} style={{ color: 'var(--color-warning-700, #b45309)' }} className="flex-shrink-0 mt-0.5" />
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--color-warning-700, #b45309)' }}>
                      Status <strong>{sale.status}</strong> is flagged risky. A written reason is required on the next step.
                    </p>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="p-4 rounded-xl mb-4 flex items-start gap-2.5"
                  style={{ backgroundColor: emphasis.bg, border: `1px solid ${emphasis.border}` }}>
                  <AlertTriangle size={16} style={{ color: emphasis.color }} className="flex-shrink-0 mt-0.5" />
                  <p className="text-sm leading-relaxed" style={{ color: emphasis.color }}>
                    {prompt}
                  </p>
                </div>

                <div className="mb-3 text-xs">
                  <p className="font-bold uppercase tracking-wide text-text-secondary mb-1.5">Selected intent</p>
                  <p className="text-sm font-semibold text-text">{selected?.label || intent}</p>
                </div>

                <label className="block">
                  <span className="text-xs font-bold uppercase tracking-wide text-text-secondary flex items-center gap-1.5">
                    Reason {reasonMandatory && <span className="text-error-600 normal-case font-semibold">required</span>}
                  </span>
                  <AutoResizeTextarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why is this customer being resold?"
                    minRows={3}
                    className="input mt-1.5 w-full text-sm"
                    aria-required={reasonMandatory}
                  />
                </label>

                <p className="text-xs text-text-tertiary mt-2 flex items-start gap-1.5 leading-relaxed">
                  <Info size={12} className="flex-shrink-0 mt-0.5" />
                  An audit entry will be added to the old sale. A new sale opens for you to fill in fresh policy details.
                </p>
              </>
            )}

            {err && (
              <div role="alert" className="mt-3 p-2.5 rounded-lg text-sm font-semibold"
                style={{ backgroundColor: 'var(--color-error-50)', color: 'var(--color-error-700)', border: '1px solid var(--color-error-200)' }}>
                {err}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center gap-2 px-5 py-3 flex-shrink-0"
            style={{ borderTop: '1px solid var(--color-border)' }}>
            {step === 'confirm' && (
              <Button variant="ghost" onClick={() => setStep('intent')} className="flex-shrink-0">
                Back
              </Button>
            )}
            <div className="flex-1" />
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            {step === 'intent' ? (
              <Button variant="primary" onClick={goConfirm} disabled={!intent}>
                Continue
              </Button>
            ) : (
              <Button variant="primary" onClick={submit} disabled={busy || (reasonMandatory && !reason.trim())}>
                {busy ? 'Reselling…' : 'Confirm resell'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
