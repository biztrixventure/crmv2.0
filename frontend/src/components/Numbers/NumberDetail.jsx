import { useState, useEffect } from 'react';
import {
  ArrowLeft, Phone, UserRound, Headset, ShieldCheck, Clock,
  ArrowRightLeft, FileText, Copy, Check, Building2,
} from 'lucide-react';
import client from '../../api/client';

// Shared, palette-driven detail view for a single assigned number. Fetches the
// lead history for the number's phone (last fronter + last closer via the
// customer-identity model, current policy, and a merged transfer+sale timeline).
//
// Palette-driven so ONE component serves two very different hosts:
//   • the fronter PiP window — pass a hex palette (that document has NO app CSS)
//   • the in-app #Numbers drawer — pass a CSS-variable palette (stays theme-aware)
// Inline styles only, so both hosts render identically.

const fmtDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt) ? '—' : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

// Status → badge colors. Sales use policy statuses, transfers use transfer statuses.
const STATUS_BADGE = {
  closed_won:     { l: 'Closed Won',   c: '#059669', bg: '#d1fae5' },
  pending_review: { l: 'Pending',      c: '#d97706', bg: '#fef3c7' },
  returned:       { l: 'Returned',     c: '#dc2626', bg: '#fee2e2' },
  cancelled:      { l: 'Cancelled',    c: '#6b7280', bg: '#f3f4f6' },
  pending:        { l: 'Pending',      c: '#d97706', bg: '#fef3c7' },
  assigned:       { l: 'Assigned',     c: '#2563eb', bg: '#eff6ff' },
  completed:      { l: 'Completed',    c: '#059669', bg: '#d1fae5' },
  rejected:       { l: 'Rejected',     c: '#dc2626', bg: '#fee2e2' },
};
const badgeFor = (status) => STATUS_BADGE[status] || { l: status || '—', c: '#6b7280', bg: '#f3f4f6' };

export default function NumberDetail({ phone, customerName, palette, onBack, onCopy }) {
  const c = palette;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setErr(false);
    client.get('distribution-batches/number-detail', { params: { phone } })
      .then(r => { if (!cancelled) setData(r.data); })
      .catch(() => { if (!cancelled) setErr(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [phone]);

  const copy = () => {
    const digits = String(phone || '').replace(/\D/g, '');
    (onCopy || ((v) => navigator.clipboard?.writeText(v).catch(() => {})))(digits);
    setCopied(true); setTimeout(() => setCopied(false), 1200);
  };

  const displayName = data?.customer_name || customerName || 'Unknown customer';

  const agentCard = (label, agent, Icon, tint) => (
    <div style={{ flex: 1, minWidth: 0, padding: '8px 10px', borderRadius: 10, border: `1px solid ${c.border}`, background: c.bg }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: c.sub }}>
        <Icon size={12} color={tint} /> {label}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: c.text, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {agent?.name || '—'}
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: c.card, color: c.text, fontFamily: 'system-ui,-apple-system,sans-serif' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: c.head, color: '#fff', flexShrink: 0 }}>
        <button onClick={onBack} title="Back" style={{ border: 'none', background: 'transparent', color: '#fff', padding: 4, borderRadius: 6, cursor: 'pointer', display: 'flex' }}>
          <ArrowLeft size={16} />
        </button>
        <span style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>Lead Detail</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {/* identity */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: c.text }}>{displayName}</div>
          <button onClick={copy} title="Tap to copy"
            style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <Phone size={13} color={c.sub} />
            <span style={{ fontFamily: 'ui-monospace,monospace', fontWeight: 700, fontSize: 14, color: c.text }}>{phone}</span>
            {copied
              ? <span style={{ fontSize: 10, fontWeight: 700, color: '#059669', display: 'flex', alignItems: 'center', gap: 2 }}><Check size={11} /> copied</span>
              : <Copy size={12} color={c.sub} />}
          </button>
        </div>

        {loading ? (
          <p style={{ fontSize: 12, textAlign: 'center', padding: '24px 0', color: c.sub }}>Loading history…</p>
        ) : err ? (
          <p style={{ fontSize: 12, textAlign: 'center', padding: '24px 0', color: '#dc2626' }}>Couldn’t load lead history.</p>
        ) : !data?.found ? (
          <div style={{ padding: '20px 12px', borderRadius: 10, border: `1px dashed ${c.border}`, textAlign: 'center' }}>
            <p style={{ fontSize: 12, color: c.sub, margin: 0 }}>Fresh number — no prior transfer or sale on record.</p>
            <p style={{ fontSize: 11, color: c.sub, margin: '4px 0 0' }}>You’re the first to work this lead.</p>
          </div>
        ) : (
          <>
            {/* last fronter / last closer */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {agentCard('Last Fronter', data.last_fronter, UserRound, '#2563eb')}
              {agentCard('Last Closer', data.last_closer, Headset, '#7c3aed')}
            </div>

            {/* current policy */}
            {data.current_policy && (
              <div style={{ padding: '10px 12px', borderRadius: 10, border: `1px solid ${c.border}`, background: c.bg, marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <ShieldCheck size={14} color="#059669" />
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: c.sub }}>Active Policy</span>
                  <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 999, background: '#d1fae5', color: '#059669' }}>Closed Won</span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: c.text }}>{data.current_policy.plan || 'Policy'}</div>
                <div style={{ fontSize: 11, color: c.sub, marginTop: 1 }}>
                  {data.current_policy.reference_no ? `Ref ${data.current_policy.reference_no} · ` : ''}{fmtDate(data.current_policy.sale_date)}
                </div>
              </div>
            )}

            {/* timeline */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <Clock size={13} color={c.sub} />
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: c.sub }}>History</span>
              <span style={{ fontSize: 11, color: c.sub }}>· {data.counts.transfers} transfer{data.counts.transfers === 1 ? '' : 's'}, {data.counts.sales} sale{data.counts.sales === 1 ? '' : 's'}</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(data.timeline || []).map((e) => {
                const isSale = e.kind === 'sale';
                const b = badgeFor(e.status);
                const Icon = isSale ? FileText : ArrowRightLeft;
                const tint = isSale ? '#059669' : '#2563eb';
                return (
                  <div key={`${e.kind}_${e.id}`} style={{ padding: '8px 10px', borderRadius: 10, border: `1px solid ${c.border}`, background: c.card }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Icon size={13} color={tint} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: c.text }}>{isSale ? 'Sale' : 'Transfer'}</span>
                      {e.plan && <span style={{ fontSize: 11, color: c.sub }}>· {e.plan}</span>}
                      <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 999, background: b.bg, color: b.c }}>{b.l}</span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', marginTop: 4, fontSize: 11, color: c.sub }}>
                      <span>{fmtDate(e.date)}</span>
                      {e.closer_name && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Headset size={10} /> {e.closer_name}</span>}
                      {e.fronter_name && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><UserRound size={10} /> {e.fronter_name}</span>}
                      {e.company_name && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Building2 size={10} /> {e.company_name}</span>}
                    </div>
                    {e.disposition && <div style={{ fontSize: 11, color: c.sub, marginTop: 2, fontStyle: 'italic' }}>“{e.disposition}”</div>}
                    {isSale && e.reference_no && <div style={{ fontSize: 10, color: c.sub, marginTop: 1, fontFamily: 'ui-monospace,monospace' }}>Ref {e.reference_no}</div>}
                  </div>
                );
              })}
              {(!data.timeline || !data.timeline.length) && (
                <p style={{ fontSize: 12, textAlign: 'center', padding: '16px 0', color: c.sub }}>No events.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Ready-made palettes for the two hosts.
export const PIP_PALETTE = { card: '#ffffff', text: '#0f172a', sub: '#64748b', border: '#e2e8f0', head: '#4f46e5', bg: '#f8fafc' };
export const APP_PALETTE = {
  card: 'var(--color-surface)', text: 'var(--color-text)', sub: 'var(--color-text-secondary)',
  border: 'var(--color-border)', head: 'var(--color-primary-600)', bg: 'var(--color-bg-secondary)',
};
