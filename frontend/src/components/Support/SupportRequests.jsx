// ============================================================================
// SupportRequests -- the CLOSER's side of a support tag (mig 357).
//
// A support agent working a customer can tag a closer on the policy ("call
// them back about the new payment date"). The closer gets a notification and
// finds the policy here, with the agent's note, until they mark it done.
//
// This is deliberately the CRM's normal look (theme tokens, Card) and NOT the
// classic grey support desk: it lives inside the closer's own dashboard and
// has to read as part of it.
//
// The server only ever returns tags that name the caller
// (GET /support/tags/mine), so there is nothing to scope here.
// ============================================================================
import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Headset, Phone, CheckCircle2, RefreshCw, Car, Clock } from 'lucide-react';
import client from '../../api/client';
import { Card } from '../UI';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';

const ET = 'America/New_York';
const when = (v) => (v ? new Date(v).toLocaleString('en-US', { timeZone: ET, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const dayOf = (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '')); return m ? `${m[2]}/${m[3]}/${m[1]}` : ''; };
const money = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? '' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
const POLICY_STATUS = { closed_won: 'Active', cancelled: 'Cancelled', compliance_cancelled: 'Cancelled' };

export default function SupportRequests({ onCount }) {
  const [filter, setFilter] = useState('open');
  const [tags, setTags] = useState([]);
  const [openCount, setOpenCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [doneFor, setDoneFor] = useState(null);     // tag id whose "done" box is open
  const [note, setNote] = useState('');
  const [result, setResult] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await client.get('support/tags/mine', { params: { status: filter } });
      setTags(r.data.tags || []);
      setOpenCount(r.data.open_count || 0);
      setResults(r.data.results || []);
      onCount?.(r.data.open_count || 0);
    } catch (e) {
      setError(e?.response?.data?.error || 'Could not load your support requests.');
    } finally { setLoading(false); }
  }, [filter, onCount]);

  useEffect(() => { load(); }, [load]);
  // A new tag arrives as a notification: reload the list when one lands.
  useLiveRefresh(['support_tag'], load);

  const finish = async (tag) => {
    setBusy(true);
    try {
      await client.post(`support/tags/${tag.id}/done`, { note, result });
      toast.success('Request closed. Support has been told.');
      setDoneFor(null); setNote(''); setResult('');
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Could not mark it done.');
    } finally { setBusy(false); }
  };

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="flex items-center gap-2">
          <Headset size={18} style={{ color: 'var(--color-primary-600)' }} />
          <h2 className="text-base font-bold" style={{ color: 'var(--color-text)' }}>Support Requests</h2>
          {openCount > 0 && (
            <span className="text-xs font-bold px-2 py-0.5 rounded-full text-white" style={{ background: 'var(--color-error-500)' }}>{openCount} open</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {[['open', 'Open'], ['done', 'Done']].map(([k, label]) => (
            <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors"
              style={filter === k
                ? { background: 'var(--color-primary-600)', color: '#fff', borderColor: 'var(--color-primary-600)' }
                : { background: 'transparent', color: 'var(--color-text-secondary)', borderColor: 'var(--color-border)' }}>
              {label}
            </button>
          ))}
          <button type="button" onClick={load} disabled={loading} aria-label="Refresh"
            className="p-2 rounded-lg border disabled:opacity-50" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <p className="text-xs mb-4" style={{ color: 'var(--color-text-tertiary)' }}>
        Policies the support team needs you on. Read the note, call the customer, then update the status so support knows what happened. You are reminded every 5 minutes while one is open.
      </p>

      {error && (
        <div className="text-sm px-3 py-2 rounded-lg mb-3" role="alert"
          style={{ background: 'color-mix(in srgb, var(--color-error-500) 12%, transparent)', color: 'var(--color-error-600)' }}>
          {error}
        </div>
      )}

      {!loading && !error && tags.length === 0 && (
        <div className="text-center py-10 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
          {filter === 'open' ? 'No open requests. When support tags you on a policy it shows up here.' : 'Nothing marked done yet.'}
        </div>
      )}

      <div className="grid gap-3">
        {tags.map((t) => {
          const s = t.sale;
          const car = s ? [s.car_year, s.car_make, s.car_model].filter(Boolean).join(' ') : '';
          const status = s ? (POLICY_STATUS[s.status] || String(s.status || '').replace(/_/g, ' ')) : 'Removed';
          const cancelled = s && ['cancelled', 'compliance_cancelled'].includes(s.status);
          return (
            <div key={t.id} className="rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>{t.customer_name || s?.customer_name || 'Customer'}</span>
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                      style={cancelled
                        ? { background: 'color-mix(in srgb, var(--color-error-500) 14%, transparent)', color: 'var(--color-error-600)' }
                        : { background: 'color-mix(in srgb, var(--color-success-500) 16%, transparent)', color: 'var(--color-success-600)' }}>
                      {status}
                    </span>
                    {t.client_name && <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{t.client_name}</span>}
                  </div>
                  <div className="flex items-center gap-x-4 gap-y-1 flex-wrap mt-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    {s?.customer_phone && (
                      <a href={`tel:${s.customer_phone}`} className="inline-flex items-center gap-1 font-semibold" style={{ color: 'var(--color-primary-600)' }}>
                        <Phone size={12} /> {s.customer_phone}
                      </a>
                    )}
                    {s?.customer_phone_2 && (
                      <a href={`tel:${s.customer_phone_2}`} className="inline-flex items-center gap-1" style={{ color: 'var(--color-primary-600)' }}>
                        <Phone size={12} /> {s.customer_phone_2}
                      </a>
                    )}
                    {car && <span className="inline-flex items-center gap-1"><Car size={12} /> {car}</span>}
                    {t.reference_no && <span>Policy {t.reference_no}</span>}
                  </div>
                  {s && (
                    <div className="flex items-center gap-x-4 gap-y-1 flex-wrap mt-1 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                      {s.plan && <span>{s.plan}</span>}
                      {s.sale_date && <span>Sold {dayOf(s.sale_date)}</span>}
                      {s.cancellation_date && <span>Cancelled {dayOf(s.cancellation_date)}</span>}
                      {money(s.monthly_payment) && <span>{money(s.monthly_payment)}/mo</span>}
                      {dayOf(s.monthly_date) && <span>Monthly date {dayOf(s.monthly_date)}</span>}
                    </div>
                  )}
                </div>
                <div className="text-xs text-right" style={{ color: 'var(--color-text-tertiary)' }}>
                  <div className="inline-flex items-center gap-1"><Clock size={12} /> {when(t.created_at)} ET</div>
                  <div>from {t.tagged_by_name}</div>
                </div>
              </div>

              <div className="mt-3 text-sm rounded-lg px-3 py-2 whitespace-pre-wrap break-words"
                style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text)' }}>
                {t.note}
              </div>

              {t.status === 'done' ? (
                <div className="mt-3 text-xs" style={{ color: 'var(--color-success-600)' }}>
                  <span className="inline-flex items-center gap-1 font-semibold"><CheckCircle2 size={13} /> Done {when(t.done_at)} ET</span>
                  {t.closer_note && <span style={{ color: 'var(--color-text-secondary)' }}> - {t.closer_note}</span>}
                </div>
              ) : doneFor === t.id ? (
                <div className="mt-3 grid gap-2">
                  <label htmlFor={`sr-result-${t.id}`} className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                    What happened
                  </label>
                  <select id={`sr-result-${t.id}`} className="input text-sm w-full" value={result} onChange={(e) => setResult(e.target.value)}>
                    <option value="">-- pick one --</option>
                    {results.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                  </select>
                  <label htmlFor={`sr-note-${t.id}`} className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                    Notes for support{result === 'other' ? '' : ' (optional)'}
                  </label>
                  <textarea id={`sr-note-${t.id}`} className="input text-sm w-full" rows={2} maxLength={1000} value={note}
                    onChange={(e) => setNote(e.target.value)} placeholder="e.g. Spoke to the customer, payment date moved to the 5th." />
                  <div className="flex items-center gap-2 justify-end">
                    <button type="button" disabled={busy} onClick={() => { setDoneFor(null); setNote(''); setResult(''); }}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                      Cancel
                    </button>
                    <button type="button" disabled={busy || !result || (result === 'other' && note.trim().length < 3)} onClick={() => finish(t)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50" style={{ background: 'var(--color-success-600)' }}>
                      {busy ? 'Saving...' : 'Close request'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex justify-end">
                  <button type="button" onClick={() => { setDoneFor(t.id); setNote(''); setResult(''); }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white" style={{ background: 'var(--color-success-600)' }}>
                    <CheckCircle2 size={13} /> Update status
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
