import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Phone, DollarSign, AlertTriangle, CheckCircle, Clock, XCircle, ChevronDown, MessageSquare, Check, CalendarPlus, Globe, MapPin, RefreshCw } from 'lucide-react';
import { Card, Badge } from '../UI';
import client from '../../api/client';
import { formatForInput, convertToUtc, getTzAbbr, formatInTz, ET_ZONE } from '../../utils/timezone';
import ResellModal from './ResellModal';

const TRANSFER_BADGE = {
  pending:   'warning',
  assigned:  'info',
  completed: 'success',
  cancelled: 'error',
  rejected:  'error',
};

const SALE_CONFIG = {
  open:             { label: 'Sale Open',       color: '#2563eb', bg: '#dbeafe',  icon: Clock        },
  sold:             { label: 'Sold',            color: '#16a34a', bg: '#dcfce7',  icon: CheckCircle  },
  pending_review:   { label: 'In Review',       color: '#d97706', bg: '#fef3c7',  icon: Clock        },
  needs_revision:   { label: 'Needs Revision',  color: '#dc2626', bg: '#fee2e2',  icon: AlertTriangle},
  closed_won:       { label: 'Approved',        color: '#16a34a', bg: '#dcfce7',  icon: CheckCircle  },
  closed_lost:      { label: 'Lost',            color: '#6b7280', bg: '#f3f4f6',  icon: XCircle      },
  follow_up:        { label: 'Follow Up',       color: '#8b5cf6', bg: '#ede9fe',  icon: Clock        },
  cancelled:        { label: 'Cancelled',       color: '#6b7280', bg: '#f3f4f6',  icon: XCircle      },
};

const SaleStatusBadge = ({ status }) => {
  const cfg = SALE_CONFIG[status] || { label: status, color: '#6b7280', bg: '#f3f4f6', icon: Clock };
  const Icon = cfg.icon;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold"
      style={{ backgroundColor: cfg.bg, color: cfg.color }}>
      <Icon size={10} />
      {cfg.label}
    </span>
  );
};

// ── TransferCard ──────────────────────────────────────────────────────────────
const TransferCard = ({ transfer, onCreateSale, onDispositionSubmit, onResell, dispositionConfigs, companyTimezone, resellEligibleStatuses }) => {
  const fd           = transfer.form_data || {};
  const customerName = fd.customer_name
    || (fd.FirstName ? `${fd.FirstName} ${fd.LastName || ''}`.trim() : null)
    || 'Unknown';
  const phone = fd.customer_phone || fd.Phone || '—';

  const skipKeys = new Set(['customer_name', 'customer_phone', 'FirstName', 'LastName', 'Phone']);
  const extraFields = Object.entries(fd)
    .filter(([k, v]) => v && !skipKeys.has(k))
    .slice(0, 4);

  const hasSale      = transfer.has_sale;
  const saleStatus   = transfer.sale_status;
  const isFinalised  = hasSale && ['closed_won', 'sold', 'closed_lost', 'cancelled'].includes(saleStatus);
  const needsRevision= hasSale && saleStatus === 'needs_revision';

  // Existing disposition data
  const latestDispo      = transfer.latest_disposition;     // from disposition_actions
  const saleDispoName    = transfer.sale_closer_disposition; // from sales.closer_disposition
  const existingDispoName = latestDispo?.disposition_name || saleDispoName || null;

  // Disposition dropdown state
  const [dropOpen,        setDropOpen]        = useState(false);
  const [selectedDispo,   setSelectedDispo]   = useState(null); // config requiring note
  const [showCallback,    setShowCallback]    = useState(false); // callback scheduling panel
  const [callbackAt,      setCallbackAt]      = useState('');
  const [noteText,        setNoteText]        = useState('');
  const [submitting,      setSubmitting]      = useState(false);
  const [submitResult,    setSubmitResult]    = useState(null); // { ok, label, color } | null
  const [zipCbInput,      setZipCbInput]      = useState('');
  const [zipCbInfo,       setZipCbInfo]       = useState(null); // { city, state, timezone }
  const [zipCbLoading,    setZipCbLoading]    = useState(false);
  const [zipCbErr,        setZipCbErr]        = useState('');
  const dropRef    = useRef(null);
  const zipCbTimer = useRef(null);

  const fdZip = fd.Zip || fd.zip || fd.ZipCode || fd.zip_code || fd.postal_code || '';

  // Auto-lookup ZIP when callback panel opens
  useEffect(() => {
    if (!showCallback || !fdZip || zipCbInfo) return;
    setZipCbInput(fdZip);
    setZipCbLoading(true);
    client.get(`zipcode/${fdZip}`)
      .then(res => { setZipCbInfo(res.data); setZipCbErr(''); })
      .catch(() => setZipCbErr('ZIP not found'))
      .finally(() => setZipCbLoading(false));
  }, [showCallback]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleZipCbChange = (raw) => {
    // Strip non-digits + cap at 5 in JS (not via HTML maxLength) so a
    // "(845) 587-6504" paste isn't clipped pre-strip to "(845)" → "845".
    const val = String(raw || '').replace(/\D/g, '').slice(0, 5);
    setZipCbInput(val);
    setZipCbErr('');
    clearTimeout(zipCbTimer.current);
    if (val.length < 5) { setZipCbInfo(null); return; }
    zipCbTimer.current = setTimeout(async () => {
      setZipCbLoading(true);
      try {
        const res = await client.get(`zipcode/${val}`);
        setZipCbInfo(res.data);
      } catch { setZipCbErr('ZIP not found'); setZipCbInfo(null); }
      finally { setZipCbLoading(false); }
    }, 500);
  };

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropOpen) return;
    const handler = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target)) setDropOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropOpen]);

  const handleDispoClick = async (cfg) => {
    if (existingDispoName) {
      const confirmed = window.confirm(
        `This transfer already has a disposition: "${existingDispoName}".\n\nOverride with "${cfg.name}"?`
      );
      if (!confirmed) return;
    }
    if (cfg.requires_note) {
      setSelectedDispo(cfg);
      setNoteText('');
      return;
    }
    await submitDispo(cfg, '');
  };

  const submitDispo = async (cfg, note) => {
    setSubmitting(true);
    try {
      await onDispositionSubmit(transfer.id, cfg.id, note);
      setSubmitResult({ ok: true, label: cfg.name, color: cfg.color });
      setDropOpen(false);
      setSelectedDispo(null);
      setTimeout(() => setSubmitResult(null), 4000);
    } catch (err) {
      setSubmitResult({ ok: false, label: err.message || 'Failed', color: '#dc2626' });
      setTimeout(() => setSubmitResult(null), 4000);
    } finally {
      setSubmitting(false);
    }
  };

  const submitCallback = async () => {
    if (!callbackAt) return;
    setSubmitting(true);
    const cbTz = zipCbInfo?.timezone || companyTimezone;
    try {
      await client.post('disposition-configs/submit-callback', {
        transfer_id:       transfer.id,
        callback_at:       cbTz ? convertToUtc(callbackAt, cbTz) : new Date(callbackAt).toISOString(),
        note:              noteText.trim() || undefined,
        customer_timezone: zipCbInfo?.timezone || null,
        customer_state:    zipCbInfo?.state    || null,
        customer_city:     zipCbInfo?.city     || null,
      });
      setSubmitResult({ ok: true, label: 'Callback scheduled', color: '#3b82f6' });
      setDropOpen(false);
      setShowCallback(false);
      setCallbackAt('');
      setNoteText('');
      setZipCbInfo(null);
      setZipCbInput('');
      setTimeout(() => setSubmitResult(null), 4000);
    } catch (err) {
      setSubmitResult({ ok: false, label: err.response?.data?.error || 'Failed', color: '#dc2626' });
      setTimeout(() => setSubmitResult(null), 4000);
    } finally {
      setSubmitting(false);
    }
  };

  const openDrop = () => {
    setDropOpen(v => !v);
    setSelectedDispo(null);
    setShowCallback(false);
    setNoteText('');
    setCallbackAt('');
    setZipCbInfo(null);
    setZipCbInput('');
    setZipCbErr('');
  };

  const dropdownPanel = dropOpen ? (
    <div className="absolute right-0 mt-1.5 rounded-xl shadow-2xl z-50 overflow-hidden min-w-48"
      style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', top: '100%' }}>
      <div className="px-3 py-2 flex items-center gap-1.5"
        style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
        <MessageSquare size={11} style={{ color: 'var(--color-text-tertiary)' }} />
        <span className="text-xs font-bold" style={{ color: 'var(--color-text-secondary)' }}>Log Outcome</span>
      </div>

      {selectedDispo ? (
        <div className="p-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: selectedDispo.color }} />
            <span className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>{selectedDispo.name}</span>
          </div>
          <textarea autoFocus value={noteText} onChange={e => setNoteText(e.target.value)}
            placeholder="Note is required…" rows={2} className="input text-xs w-full resize-none" style={{ fontSize: '11px' }} />
          <div className="flex gap-1.5">
            <button onClick={() => setSelectedDispo(null)}
              className="flex-1 py-1 rounded-lg text-xs font-semibold border"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Back</button>
            <button onClick={() => submitDispo(selectedDispo, noteText)} disabled={submitting || !noteText.trim()}
              className="flex-1 py-1 rounded-lg text-xs font-bold text-white disabled:opacity-50"
              style={{ background: 'var(--gradient-sidebar)' }}>{submitting ? '…' : 'Submit'}</button>
          </div>
        </div>
      ) : showCallback ? (
        <div className="p-3 space-y-2 min-w-56">
          <div className="flex items-center gap-1.5">
            <CalendarPlus size={13} style={{ color: '#3b82f6', flexShrink: 0 }} />
            <span className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>Schedule Callback</span>
          </div>

          {/* ZIP lookup */}
          <div className="relative">
            <input value={zipCbInput} onChange={e => handleZipCbChange(e.target.value)}
              inputMode="numeric"
              className="input text-xs w-full pr-7" placeholder="Customer ZIP…"
              style={{ fontSize: '11px' }} />
            {zipCbLoading && (
              <div className="absolute right-2 top-1/2 -translate-y-1/2">
                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-500" />
              </div>
            )}
          </div>
          {zipCbErr && <p className="text-[10px] text-red-500">{zipCbErr}</p>}
          {zipCbInfo && (
            <div className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
              <Globe size={10} />{zipCbInfo.city}, {zipCbInfo.state} · {getTzAbbr(zipCbInfo.timezone)}
            </div>
          )}

          <input
            type="datetime-local"
            value={callbackAt}
            onChange={e => setCallbackAt(e.target.value)}
            className="input text-xs w-full"
            style={{ fontSize: '11px' }}
          />

          {/* Dual-time preview */}
          {callbackAt && (zipCbInfo?.timezone || companyTimezone) && (() => {
            const cbTz     = zipCbInfo?.timezone || companyTimezone;
            const agentTz  = ET_ZONE;
            const utcIso   = convertToUtc(callbackAt, cbTz);
            const custTime = zipCbInfo?.timezone
              ? `${formatInTz(utcIso, zipCbInfo.timezone, { hour: '2-digit', minute: '2-digit', hour12: true })} ${getTzAbbr(zipCbInfo.timezone)}`
              : null;
            const agentTime = `${formatInTz(utcIso, agentTz, { hour: '2-digit', minute: '2-digit', hour12: true })} ${getTzAbbr(agentTz)}`;
            return (
              <div className="rounded-lg p-2 text-[10px]"
                style={{ backgroundColor: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.18)' }}>
                {custTime && <div><span style={{ color: '#6366f1', fontWeight: 700 }}>Customer:</span> {custTime}</div>}
                <div><span style={{ color: '#10b981', fontWeight: 700 }}>You:</span> {agentTime}</div>
              </div>
            );
          })()}

          <textarea value={noteText} onChange={e => setNoteText(e.target.value)}
            placeholder="Note (optional)…" rows={2} className="input text-xs w-full resize-none" style={{ fontSize: '11px' }} />
          <div className="flex gap-1.5">
            <button onClick={() => setShowCallback(false)}
              className="flex-1 py-1 rounded-lg text-xs font-semibold border"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Back</button>
            <button onClick={submitCallback} disabled={submitting || !callbackAt}
              className="flex-1 py-1 rounded-lg text-xs font-bold text-white disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg,#3b82f6,#2563eb)' }}>{submitting ? '…' : 'Schedule'}</button>
          </div>
        </div>
      ) : (
        <div className="py-1">
          {dispositionConfigs.map(cfg => (
            <button key={cfg.id} onClick={() => handleDispoClick(cfg)} disabled={submitting}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs font-semibold transition-colors hover:bg-bg-secondary disabled:opacity-50"
              style={{ color: 'var(--color-text)' }}>
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: cfg.color }} />
              <span className="flex-1">{cfg.name}</span>
              {cfg.requires_note && <MessageSquare size={9} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />}
            </button>
          ))}
          <div style={{ borderTop: '1px solid var(--color-border)', marginTop: 4, paddingTop: 4 }}>
            <button
              onClick={() => {
                const tz = zipCbInfo?.timezone || companyTimezone;
                setCallbackAt(tz ? formatForInput(Date.now() + 30 * 60000, tz) : '');
                setShowCallback(true);
                setNoteText('');
              }}
              disabled={submitting}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs font-semibold transition-colors hover:bg-bg-secondary disabled:opacity-50"
              style={{ color: '#3b82f6' }}>
              <CalendarPlus size={11} style={{ flexShrink: 0 }} />
              <span className="flex-1">Schedule Callback</span>
            </button>
          </div>
        </div>
      )}
    </div>
  ) : null;

  const resolveSale = () => {
    const resolvedName  = customerName !== 'Unknown' ? customerName
      : (fd.customer_name || fd.Name || fd.name || fd.FullName || fd.fullname
         || Object.values(fd).find(v => typeof v === 'string' && v.length > 1 && !/\d{5,}/.test(v)) || '');
    const resolvedPhone = phone !== '—' ? phone : (fd.customer_phone || fd.Phone || fd.phone || '');
    return { ...transfer, form_data: { ...fd, customer_name: resolvedName, customer_phone: resolvedPhone } };
  };

  return (
    <div className="rounded-xl border px-3 py-2.5 animate-fade-in"
      style={{
        borderColor:     needsRevision ? 'var(--color-error-300)' : hasSale ? 'var(--color-success-300)' : 'var(--color-border)',
        backgroundColor: needsRevision ? 'var(--color-error-50)' : hasSale ? 'var(--color-success-50, #f0fdf4)' : 'var(--color-bg)',
      }}>
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          {/* Company + status row */}
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <span className="px-1.5 py-0 rounded text-xs font-bold uppercase tracking-wider"
              style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)', border: '1px solid var(--color-primary-200)' }}>
              {transfer.company_slug}
            </span>
            {transfer.cross_company && (
              <span title={`Same phone exists in ${transfer.cross_company_count} fronter companies`}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
                style={{ backgroundColor: 'var(--color-warning-100, #fef3c7)', color: 'var(--color-warning-700, #b45309)', border: '1px solid var(--color-warning-300, #fcd34d)' }}>
                <Globe size={9} /> {transfer.cross_company_count} cos
              </span>
            )}
            <Badge variant={TRANSFER_BADGE[transfer.status] || 'secondary'} size="sm">
              {transfer.status}
            </Badge>
            {hasSale && <SaleStatusBadge status={saleStatus} />}
            {hasSale && transfer.sale_is_resell && (
              <span title={`Resell sale on this lead`}
                className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                style={{ backgroundColor: '#ddd6fe', color: '#5b21b6' }}>
                RS
              </span>
            )}
            {latestDispo ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold"
                style={{ backgroundColor: (latestDispo.color || '#6b7280') + '22', color: latestDispo.color || '#6b7280', border: `1px solid ${latestDispo.color || '#6b7280'}44` }}
                title={latestDispo.setter_name ? `Set by ${latestDispo.setter_name}` : undefined}>
                <MessageSquare size={9} />
                {latestDispo.disposition_name}
                {latestDispo.setter_name && <span style={{ opacity: 0.7 }}>· {latestDispo.setter_name}</span>}
              </span>
            ) : saleDispoName ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold"
                style={{ backgroundColor: '#6b728022', color: '#6b7280', border: '1px solid #6b728044' }}>
                <MessageSquare size={9} />
                {saleDispoName}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold"
                style={{ backgroundColor: '#f3f4f6', color: '#9ca3af', border: '1px solid #e5e7eb' }}>
                <Clock size={9} />
                In Progress
              </span>
            )}
            <span className="text-xs ml-auto" style={{ color: 'var(--color-text-tertiary)' }}>
              {new Date(transfer.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          </div>

          {/* Name + phone */}
          <p className="font-semibold text-sm leading-tight" style={{ color: 'var(--color-text)' }}>
            {customerName}
            <span className="font-normal ml-2" style={{ color: 'var(--color-text-secondary)' }}>{phone}</span>
          </p>

          {/* Extra fields */}
          {extraFields.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
              {extraFields.map(([key, val]) => (
                <span key={key} className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                  <span className="capitalize">{key.replace(/_/g, ' ')}</span>:{' '}
                  <span style={{ color: 'var(--color-text-secondary)' }}>{String(val)}</span>
                </span>
              ))}
            </div>
          )}

          {transfer.fronter_name && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
              By: {transfer.fronter_name}
            </p>
          )}

          {hasSale && transfer.sale_reference_no && (
            <p className="text-xs mt-0.5 font-mono" style={{ color: 'var(--color-text-tertiary)' }}>
              Ref: {transfer.sale_reference_no}
              {transfer.sale_closer_name && ` · Closer: ${transfer.sale_closer_name}`}
            </p>
          )}

          {needsRevision && transfer.sale_compliance_note && (
            <div className="mt-1.5 px-2 py-1 rounded-lg flex items-start gap-1.5"
              style={{ backgroundColor: 'var(--color-error-100)', border: '1px solid var(--color-error-200)' }}>
              <AlertTriangle size={11} style={{ color: 'var(--color-error-600)', marginTop: 1, flexShrink: 0 }} />
              <p className="text-xs" style={{ color: 'var(--color-error-700)' }}>
                {transfer.sale_compliance_note}
              </p>
            </div>
          )}

          {/* Disposition result feedback */}
          {submitResult && (
            <div className="mt-1.5 flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-semibold"
              style={{
                backgroundColor: submitResult.ok ? '#f0fdf4' : '#fef2f2',
                border: `1px solid ${submitResult.ok ? '#bbf7d0' : '#fecaca'}`,
                color: submitResult.ok ? '#15803d' : '#dc2626',
              }}>
              {submitResult.ok
                ? <><Check size={11} /> Logged: {submitResult.label}</>
                : <><AlertTriangle size={11} /> {submitResult.label}</>}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex-shrink-0 flex items-center gap-1">
          {hasSale ? (
            <>
              {/* Resell — only when the existing sale's status is eligible per
                  business_config (resell.enabled_statuses). Replaces the dead
                  "Already Sold" pill with a productive action. */}
              {onResell && resellEligibleStatuses?.includes(saleStatus) ? (
                <button
                  type="button"
                  onClick={() => onResell({
                    id:            transfer.sale_id,
                    reference_no:  transfer.sale_reference_no,
                    status:        transfer.sale_status,
                    customer_name: customerName,
                    customer_phone: phone,
                    transfer_id:   transfer.id,
                    is_resell:     !!transfer.sale_is_resell,
                  })}
                  className="flex items-center gap-1.5 py-1.5 px-3 rounded-l-lg font-semibold text-xs text-white hover:scale-[1.03] transition-all"
                  style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', boxShadow: 'var(--shadow-sm)', whiteSpace: 'nowrap', borderRight: '1px solid rgba(255,255,255,0.2)' }}
                  title="Resell, add another car, or renewal"
                  aria-label="Open new sale on this lead"
                >
                  <RefreshCw size={12} /> New on lead
                </button>
              ) : (
                <span className="flex items-center gap-1 py-1.5 px-2.5 rounded-l-lg text-xs font-semibold"
                  style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)', border: '1px solid var(--color-border)', borderRight: 'none' }}>
                  <DollarSign size={11} /> Already Sold
                </span>
              )}
              {/* Disposition dropdown still accessible after sale */}
              <div className="relative" ref={dropRef}>
                <button onClick={openDrop}
                  className={`flex items-center py-1.5 px-1.5 ${onResell && resellEligibleStatuses?.includes(saleStatus) ? 'rounded-r-lg text-white' : 'rounded-r-lg'} font-semibold text-xs hover:scale-[1.03] transition-all`}
                  style={onResell && resellEligibleStatuses?.includes(saleStatus)
                    ? { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', boxShadow: 'var(--shadow-sm)' }
                    : { backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
                  title="Log call outcome">
                  <ChevronDown size={12} />
                </button>
                {dropdownPanel}
              </div>
            </>
          ) : (
            <>
              {/* Sale button */}
              <button
                onClick={() => onCreateSale(resolveSale())}
                className="flex items-center gap-1 py-1.5 px-3 rounded-l-lg font-semibold text-xs text-white hover:scale-[1.03] transition-all"
                style={{ background: 'var(--gradient-sidebar)', boxShadow: 'var(--shadow-sm)', whiteSpace: 'nowrap', borderRight: '1px solid rgba(255,255,255,0.2)' }}
              >
                <DollarSign size={12} /> Sale
              </button>

              {/* Disposition dropdown trigger */}
              <div className="relative" ref={dropRef}>
                <button onClick={openDrop}
                  className="flex items-center py-1.5 px-1.5 rounded-r-lg font-semibold text-xs text-white hover:scale-[1.03] transition-all"
                  style={{ background: 'var(--gradient-sidebar)', boxShadow: 'var(--shadow-sm)' }}
                  title="Log call outcome">
                  <ChevronDown size={12} />
                </button>
                {dropdownPanel}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ── PhoneSearch ───────────────────────────────────────────────────────────────
const PhoneSearch = ({ onCreateSale, companyTimezone, refreshTrigger = 0 }) => {
  const [phone,              setPhone]              = useState('');
  const [results,            setResults]            = useState(null);
  const [loading,            setLoading]            = useState(false);
  const [error,              setError]              = useState('');
  const [resellTarget,       setResellTarget]       = useState(null);   // existing sale-like object
  const [resellStatuses,     setResellStatuses]     = useState(null);

  // Pull eligible statuses once so the "New on lead" button only appears for
  // sales the closer can actually resell per business_config.
  useEffect(() => {
    client.get('business-config')
      .then(r => setResellStatuses(r.data?.config?.['resell.enabled_statuses'] || null))
      .catch(() => setResellStatuses(null));
  }, []);

  const eligibleSet = resellStatuses ?? ['cancelled','compliance_cancelled','closed_won','sold','closed_lost','expired'];
  const [dispositionConfigs, setDispositionConfigs] = useState([]);
  const lastQuery = useRef('');

  useEffect(() => {
    client.get('disposition-configs')
      .then(res => setDispositionConfigs(res.data.configs || []))
      .catch(() => {});
  }, []);

  const runSearch = useCallback(async (q) => {
    if (q.length < 3) return;
    setLoading(true);
    try {
      const res = await client.get('transfers/search-by-phone', { params: { phone: q } });
      setResults(res.data.transfers || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Search failed. Try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Re-run last search when refreshTrigger increments (e.g. after sale created)
  useEffect(() => {
    if (refreshTrigger > 0 && lastQuery.current.length >= 3 && results !== null) {
      runSearch(lastQuery.current);
    }
  }, [refreshTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = async (e) => {
    e.preventDefault();
    const q = phone.trim();
    if (q.length < 3) { setError('Enter at least 3 characters.'); return; }
    lastQuery.current = q;
    setError('');
    setResults(null);
    await runSearch(q);
  };

  const handleDispositionSubmit = async (transferId, configId, note) => {
    const res = await client.post('disposition-configs/submit', {
      transfer_id:           transferId,
      disposition_config_id: configId,
      note:                  note || undefined,
    });
    // Update local results so the badge refreshes immediately without re-search
    const action = res.data.action;
    if (action) {
      setResults(prev => (prev || []).map(t =>
        t.id === transferId
          ? { ...t, latest_disposition: { ...action, setter_name: null } }
          : t
      ));
    }
  };

  const alreadySoldCount = (results || []).filter(t => t.has_sale).length;
  const availableCount   = (results || []).filter(t => !t.has_sale).length;

  return (
    <Card className="p-4">
      {/* Search bar */}
      <form onSubmit={handleSearch} className="flex gap-2 items-center">
        <Search size={15} className="flex-shrink-0" style={{ color: 'var(--color-primary-600)' }} />
        <span className="text-sm font-semibold whitespace-nowrap" style={{ color: 'var(--color-text)' }}>Search Lead</span>
        <div className="flex-1 relative">
          <Phone size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
          <input
            type="tel"
            inputMode="numeric"
            value={phone}
            /* Strip brackets / dashes / spaces on type AND paste so a closer
               can paste "(555) 123-4567" and the field lands as 5551234567.
               10-digit cap matches what the backend normalized_phone index
               stores, so what the user sees == what the search hits. */
            /* No HTML maxLength: it would clip a 14-char paste like
               "(845) 587-6504" to "(845) 587-" before this handler runs,
               and the digit-strip below would then drop to 6 digits. The
               slice(0, 10) on the stripped value is the real cap. */
            onChange={e => setPhone(String(e.target.value).replace(/\D/g, '').slice(0, 10))}
            placeholder="Phone number…"
            className="input pl-8 w-full text-sm h-9"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="flex items-center gap-1.5 py-2 px-4 rounded-lg font-semibold text-sm text-white disabled:opacity-50 hover:scale-[1.02] transition-all flex-shrink-0"
          style={{ background: 'var(--gradient-sidebar)', boxShadow: 'var(--shadow-sm)' }}
        >
          {loading
            ? <div className="w-3.5 h-3.5 border-2 rounded-full animate-spin" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />
            : <Search size={14} />}
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>
      {error && (
        <p className="text-xs mt-2 ml-1" style={{ color: 'var(--color-error-600)' }}>{error}</p>
      )}

      {/* Results */}
      {results !== null && (
        results.length === 0 ? (
          <p className="text-sm text-center mt-3 py-2" style={{ color: 'var(--color-text-secondary)' }}>
            No transfers found for that number.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                {results.length} record{results.length !== 1 ? 's' : ''} found
              </p>
              {alreadySoldCount > 0 && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: '#dcfce7', color: '#15803d' }}>
                  {alreadySoldCount} already sold
                </span>
              )}
              {availableCount > 0 && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: '#dbeafe', color: '#1d4ed8' }}>
                  {availableCount} available
                </span>
              )}
            </div>
            {results.map(t => (
              <TransferCard
                key={t.id}
                transfer={t}
                onCreateSale={onCreateSale}
                onResell={(saleLike) => setResellTarget(saleLike)}
                resellEligibleStatuses={eligibleSet}
                onDispositionSubmit={handleDispositionSubmit}
                dispositionConfigs={dispositionConfigs}
                companyTimezone={companyTimezone}
              />
            ))}
          </div>
        )
      )}

      {/* Resell modal — opens when closer clicks "New on lead" on a card
          whose existing sale is in an eligible status. On success the
          search re-runs so the closer sees the new sale at the top. */}
      <ResellModal
        isOpen={!!resellTarget}
        sale={resellTarget}
        onClose={() => setResellTarget(null)}
        onSuccess={() => { setResellTarget(null); if (phone) runSearch(phone); }}
      />
    </Card>
  );
};

export default PhoneSearch;
