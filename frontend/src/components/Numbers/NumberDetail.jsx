import { useState, useEffect } from 'react';
import {
  ArrowLeft, Phone, PhoneCall, Mail, MapPin, Car, Copy, Check,
  ClipboardList, StickyNote, Loader2, UserRound,
} from 'lucide-react';
import client from '../../api/client';

// Shared, palette-driven detail view for a single assigned number. Shows:
//   1. Assignment Details — the transfer-form fields attached when the number
//      was assigned (name, car make/model/year, mileage, …), from mapped_data.
//   2. Notes — editable inline; the save routes to the row's own source so the
//      note reflects on BOTH the PIP and the #Numbers page (same DB row).
//   3. Customer — who the customer is: alt phone, email, address + their
//      vehicle(s). NO lead history (no fronter/closer/who/when/why).
//
// Palette-driven so ONE component serves two hosts:
//   • the fronter PiP window — pass a hex palette (that document has NO app CSS)
//   • the in-app #Numbers drawer — pass a CSS-variable palette (stays theme-aware)
// Inline styles only, so both hosts render identically.

// mapped_data keys are the transfer form field names (snake/camel) — prettify to
// a human label without needing the form config in the PiP window.
const prettyLabel = (k) => String(k || '')
  .replace(/[_-]+/g, ' ')
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .replace(/\b\w/g, (ch) => ch.toUpperCase())
  .trim();

// keys already shown at the top (identity) — don't repeat them in the grid.
const SKIP_KEYS = new Set(['phone_number', 'phone', 'customer_name', 'name', 'notes']);

const vehicleLabel = (v) => [v.year, v.make, v.model].filter(Boolean).join(' ').trim() || 'Vehicle';

export default function NumberDetail({ number, palette, onBack, onCopy, onSaveNote }) {
  const c = palette;
  const phone = number?.phone_number || '';
  const mapped = (number?.mapped_data && typeof number.mapped_data === 'object') ? number.mapped_data : null;
  const assignEntries = mapped
    ? Object.entries(mapped).filter(([k, v]) => !SKIP_KEYS.has(k) && v != null && String(v).trim() !== '')
    : [];

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);
  const [copied, setCopied] = useState(false);

  // notes
  const [noteVal, setNoteVal] = useState(number?.notes || '');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  useEffect(() => { setNoteVal(number?.notes || ''); setNoteSaved(false); }, [number?.id]);
  const noteDirty = (noteVal || '') !== (number?.notes || '');
  const saveNote = async () => {
    if (!onSaveNote || !noteDirty) return;
    setNoteSaving(true);
    try { await onSaveNote(number, noteVal); setNoteSaved(true); setTimeout(() => setNoteSaved(false), 1500); }
    finally { setNoteSaving(false); }
  };

  useEffect(() => {
    if (!phone) { setLoading(false); return; }
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

  const cust = data?.customer || {};
  const vehicles = data?.vehicles || [];
  const displayName = cust.name || number?.customer_name || 'Unknown customer';
  const hasContact = cust.email || cust.phone_2 || cust.address;

  const sectionHead = (Icon, tint, text, extra) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
      <Icon size={13} color={tint} />
      <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: c.sub }}>{text}</span>
      {extra}
    </div>
  );

  const contactRow = (Icon, value) => value ? (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0' }}>
      <Icon size={13} color={c.sub} style={{ marginTop: 2, flexShrink: 0 }} />
      <span style={{ fontSize: 13, color: c.text, wordBreak: 'break-word' }}>{value}</span>
    </div>
  ) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: c.card, color: c.text, fontFamily: 'system-ui,-apple-system,sans-serif' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: c.head, color: '#fff', flexShrink: 0 }}>
        <button onClick={onBack} title="Back" style={{ border: 'none', background: 'transparent', color: '#fff', padding: 4, borderRadius: 6, cursor: 'pointer', display: 'flex' }}>
          <ArrowLeft size={16} />
        </button>
        <span style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>Number Detail</span>
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

        {/* 1. assignment details (mapped transfer fields) */}
        {assignEntries.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            {sectionHead(ClipboardList, '#7c3aed', 'Assignment Details')}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {assignEntries.map(([k, v]) => (
                <div key={k} style={{ padding: '7px 9px', borderRadius: 9, border: `1px solid ${c.border}`, background: c.bg, minWidth: 0 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: c.sub }}>{prettyLabel(k)}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: c.text, marginTop: 1, wordBreak: 'break-word' }}>{String(v)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 2. notes (editable, reflects on both PIP and #Numbers) */}
        {onSaveNote && (
          <div style={{ marginBottom: 14 }}>
            {sectionHead(StickyNote, '#4f46e5', 'Notes', noteSaved
              ? <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, color: '#059669', display: 'flex', alignItems: 'center', gap: 2 }}><Check size={11} /> saved</span>
              : null)}
            <textarea value={noteVal} onChange={(e) => setNoteVal(e.target.value)} rows={3}
              placeholder="Add a note about this lead…"
              style={{ width: '100%', fontSize: 13, padding: '8px 10px', borderRadius: 9, border: `1px solid ${c.border}`, background: c.card, color: c.text, resize: 'vertical', outline: 'none', fontFamily: 'inherit' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
              <button onClick={saveNote} disabled={!noteDirty || noteSaving}
                style={{ border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 700, color: '#fff', background: c.head, cursor: (!noteDirty || noteSaving) ? 'default' : 'pointer', opacity: (!noteDirty || noteSaving) ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                {noteSaving ? <Loader2 size={12} className="animate-spin" /> : null} Save note
              </button>
            </div>
          </div>
        )}

        {/* 3. customer details + vehicles (NO lead history) */}
        {sectionHead(UserRound, '#2563eb', 'Customer')}
        {loading ? (
          <p style={{ fontSize: 12, textAlign: 'center', padding: '16px 0', color: c.sub }}>Loading customer…</p>
        ) : err ? (
          <p style={{ fontSize: 12, textAlign: 'center', padding: '16px 0', color: '#dc2626' }}>Couldn’t load customer details.</p>
        ) : !data?.found ? (
          <div style={{ padding: '16px 12px', borderRadius: 10, border: `1px dashed ${c.border}`, textAlign: 'center' }}>
            <p style={{ fontSize: 12, color: c.sub, margin: 0 }}>Fresh number — no customer record yet.</p>
          </div>
        ) : (
          <>
            {hasContact ? (
              <div style={{ padding: '4px 12px', borderRadius: 10, border: `1px solid ${c.border}`, background: c.bg, marginBottom: 12 }}>
                {contactRow(PhoneCall, cust.phone_2)}
                {contactRow(Mail, cust.email)}
                {contactRow(MapPin, cust.address)}
              </div>
            ) : (
              <p style={{ fontSize: 12, color: c.sub, margin: '0 0 12px' }}>No extra contact details on record.</p>
            )}

            {vehicles.length > 0 && (
              <>
                {sectionHead(Car, '#059669', vehicles.length === 1 ? 'Vehicle' : `Vehicles (${vehicles.length})`)}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {vehicles.map((v, i) => (
                    <div key={i} style={{ padding: '8px 10px', borderRadius: 10, border: `1px solid ${c.border}`, background: c.card }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Car size={13} color="#059669" />
                        <span style={{ fontSize: 13, fontWeight: 700, color: c.text }}>{vehicleLabel(v)}</span>
                        {v.miles && <span style={{ marginLeft: 'auto', fontSize: 11, color: c.sub }}>{Number(String(v.miles).replace(/\D/g, '')).toLocaleString()} mi</span>}
                      </div>
                      {v.vin && <div style={{ fontSize: 11, marginTop: 2, fontFamily: 'ui-monospace,monospace', color: c.sub }}>VIN {v.vin}</div>}
                    </div>
                  ))}
                </div>
              </>
            )}
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
