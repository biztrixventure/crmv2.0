import { useState, useEffect, useRef } from 'react';
import { CreditCard, Check, X, ShieldCheck, Building2, Globe, Loader2, Eraser } from 'lucide-react';
import client from '../../api/client';
import { validateCard, formatCardNumber, digitsOf } from '../../utils/cardValidate';

// Card validator. Luhn / brand / length / expiry / CVV are checked in the
// browser — the full number never leaves this page. Only the BIN (first 6-8
// digits) is sent to look up the issuing bank. Nothing is stored.
const BRAND_COLOR = { Visa: '#1a1f71', Mastercard: '#eb001b', 'American Express': '#2e77bc', Discover: '#f76b1c', JCB: '#0b4ea2', UnionPay: '#e21836', 'Diners Club': '#0079be', Maestro: '#0099df' };

const Check2 = ({ ok, label, hint }) => (
  <div className="flex items-center gap-2 text-sm">
    <span className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
      style={{ backgroundColor: ok == null ? 'var(--color-bg-secondary)' : ok ? '#16a34a' : '#dc2626', color: '#fff' }}>
      {ok == null ? <span className="text-[10px]">–</span> : ok ? <Check size={13} /> : <X size={13} />}
    </span>
    <span style={{ color: 'var(--color-text)' }}>{label}</span>
    {hint && <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{hint}</span>}
  </div>
);

export default function CardValidator({ compact = false }) {
  const [number, setNumber] = useState('');
  const [exp, setExp]       = useState('');   // MM/YY
  const [cvv, setCvv]       = useState('');
  const [name, setName]     = useState('');
  const [issuer, setIssuer] = useState(null);
  const [binBusy, setBinBusy] = useState(false);
  const binTimer = useRef(null);
  const lastBin = useRef('');

  const [em, ey] = exp.split('/');
  const res = validateCard({ number, expMonth: em, expYear: ey, cvv });

  // Debounced issuer (BIN) lookup — sends ONLY the first 8 digits.
  useEffect(() => {
    const bin = res.digits.slice(0, 8);
    if (bin.length < 6) { setIssuer(null); lastBin.current = ''; return; }
    if (bin === lastBin.current) return;
    clearTimeout(binTimer.current);
    binTimer.current = setTimeout(async () => {
      lastBin.current = bin; setBinBusy(true);
      try { const r = await client.post('card-validator/bin', { bin }); setIssuer(r.data); }
      catch (e) { setIssuer({ error: e.response?.data?.error || 'Issuer lookup failed' }); }
      finally { setBinBusy(false); }
    }, 500);
    return () => clearTimeout(binTimer.current);
  }, [res.digits]);

  const onNumber = (v) => setNumber(formatCardNumber(v));
  const onExp = (v) => {
    let d = digitsOf(v).slice(0, 4);
    if (d.length >= 3) d = `${d.slice(0, 2)}/${d.slice(2)}`;
    else if (d.length === 2 && !v.endsWith('/')) d = `${d}/`;
    setExp(d);
  };
  const clear = () => { setNumber(''); setExp(''); setCvv(''); setName(''); setIssuer(null); lastBin.current = ''; };

  const brandColor = BRAND_COLOR[res.brand] || 'var(--color-primary-600)';

  return (
    <div className={compact ? '' : 'max-w-2xl mx-auto px-4 py-6'}>
      {!compact && (
        <div className="mb-4">
          <h2 className="text-2xl font-extrabold flex items-center gap-2" style={{ color: 'var(--color-text)' }}><CreditCard size={22} style={{ color: 'var(--color-primary-600)' }} /> Card Validator</h2>
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Check a card's number, brand, expiry and issuing bank. Everything is validated in your browser — no card number is stored.</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* inputs */}
        <div className="rounded-2xl border p-4 space-y-3" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-text-secondary)' }}>Card number</label>
            <div className="relative">
              <input value={number} onChange={e => onNumber(e.target.value)} inputMode="numeric" autoComplete="off" placeholder="•••• •••• •••• ••••"
                className="input font-mono text-lg tracking-wider w-full pr-16" />
              {res.brand && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-extrabold" style={{ color: brandColor }}>{res.brand}</span>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-text-secondary)' }}>Expiry (MM/YY)</label>
              <input value={exp} onChange={e => onExp(e.target.value)} inputMode="numeric" placeholder="MM/YY" className="input font-mono w-full" />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-text-secondary)' }}>CVV</label>
              <input value={cvv} onChange={e => setCvv(digitsOf(e.target.value).slice(0, 4))} inputMode="numeric" placeholder={res.cvvExpected === 4 ? '••••' : '•••'} className="input font-mono w-full" />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-text-secondary)' }}>Cardholder (optional)</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Name on card" className="input w-full" />
          </div>
          <button onClick={clear} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border inline-flex items-center gap-1.5" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}><Eraser size={13} /> Clear</button>
          <p className="text-[11px] flex items-start gap-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
            <ShieldCheck size={13} className="mt-0.5 flex-shrink-0" /> Validated in your browser. Only the first 6–8 digits are sent to identify the bank — the full number is never stored.
          </p>
        </div>

        {/* results */}
        <div className="rounded-2xl border p-4 space-y-3" style={{ borderColor: res.digits.length >= 12 ? (res.valid ? '#16a34a55' : '#dc262655') : 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
          {res.digits.length < 12 ? (
            <p className="text-sm text-center py-8" style={{ color: 'var(--color-text-tertiary)' }}>Enter a card number to validate.</p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="text-lg font-extrabold" style={{ color: res.valid ? '#16a34a' : '#dc2626' }}>{res.valid ? 'Looks valid' : 'Not valid'}</span>
                {res.brand && <span className="text-xs font-bold px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: brandColor }}>{res.brand}</span>}
              </div>
              <div className="space-y-1.5">
                <Check2 ok={res.luhn} label="Luhn checksum" />
                <Check2 ok={res.lengthOk} label="Length" hint={`${res.digits.length} digits`} />
                {res.expiry && <Check2 ok={res.expiry.ok} label="Expiry" hint={res.expiry.ok ? 'in date' : res.expiry.reason} />}
                {res.cvvOk != null && <Check2 ok={res.cvvOk} label="CVV format" hint={`${res.cvvExpected} digits`} />}
              </div>

              {/* issuer */}
              <div className="pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
                <div className="text-[11px] font-bold uppercase tracking-wide mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--color-text-tertiary)' }}>Issuer {binBusy && <Loader2 size={11} className="animate-spin" />}</div>
                {!issuer ? <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Looking up…</p>
                  : issuer.error ? <p className="text-xs" style={{ color: '#d97706' }}>{issuer.error}</p>
                  : issuer.unknown ? <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Issuer not found for this BIN.</p>
                  : (
                    <div className="text-sm space-y-1" style={{ color: 'var(--color-text)' }}>
                      {issuer.bank?.name && <div className="flex items-center gap-2"><Building2 size={13} style={{ color: 'var(--color-text-tertiary)' }} /> <span className="font-semibold">{issuer.bank.name}</span></div>}
                      <div className="flex items-center gap-2 flex-wrap text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                        {issuer.type && <span className="px-1.5 py-0.5 rounded-full font-semibold capitalize" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>{issuer.type}</span>}
                        {issuer.scheme && <span className="capitalize">{issuer.scheme}</span>}
                        {issuer.prepaid === true && <span className="px-1.5 py-0.5 rounded-full font-semibold" style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>prepaid</span>}
                      </div>
                      {issuer.country?.name && <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}><Globe size={13} /> {issuer.country.emoji} {issuer.country.name}{issuer.country.currency ? ` · ${issuer.country.currency}` : ''}</div>}
                      {issuer.bank?.phone && <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{issuer.bank.phone}</div>}
                    </div>
                  )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
