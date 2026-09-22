import { useEffect, useState } from 'react';
import client from '../../api/client';

// ============================================================================
// DialerBadge — which dialer did this record come from?
//
// With one dialer the answer was implicit and nobody had to ask. With two it is
// the first question anyone asks of a record that looks odd, so EVERY record
// that came from a dialer carries the tag, on every screen: the fronter's card,
// the closer's and manager's lists, compliance, and QA beside the recording.
//
// BOTH dialers are named. An earlier version stayed silent for VICIdial on the
// theory that a badge on every row is noise — but silence is only readable if
// you already know the convention, and "no tag" and "not loaded yet" look
// identical. Naming both costs one small pill and removes the guess.
//
// The ACCOUNT name wins over the product name where there is room: two
// CallTools tenants are two different floors, and "CallTools" on both would
// answer the wrong question. In dense tables `short` shows the product and
// keeps the account name in the tooltip.
//
// Names come from /api/dialers/labels — id, name and provider only, no tokens —
// so a closer or a QA reviewer can read the tag without being a superadmin.
// Fetched ONCE per page and shared by every badge on it: a transfer list
// renders hundreds of these and a request each would be absurd.
// ============================================================================

let cache = null;          // { accounts: [...], providers: {...} }
let inflight = null;
const listeners = new Set();

function loadLabels() {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = client.get('dialers/labels')
    .then(r => {
      cache = { accounts: r.data?.accounts || [], providers: r.data?.providers || {} };
      listeners.forEach(fn => fn(cache));
      return cache;
    })
    .catch(() => {
      // The tag sits on top of the record — if the lookup fails the row still
      // renders, just with the product's name instead of the account's.
      cache = { accounts: [], providers: {} };
      return cache;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

export function useDialerLabels() {
  const [labels, setLabels] = useState(cache);
  useEffect(() => {
    let alive = true;
    const onChange = (v) => { if (alive) setLabels(v); };
    listeners.add(onChange);
    loadLabels().then(onChange);
    return () => { alive = false; listeners.delete(onChange); };
  }, []);
  return labels || { accounts: [], providers: {} };
}

// One colour per dialer so a list is scannable without reading it: the
// long-standing one stays neutral, anything newer gets its own accent.
const TONES = {
  vicidial:  { bg: 'var(--color-bg-tertiary)',          fg: 'var(--color-text-secondary)',        dot: 'var(--color-text-tertiary)' },
  calltools: { bg: 'var(--color-primary-50, #eef2ff)',  fg: 'var(--color-primary-700, #4338ca)',  dot: 'var(--color-primary-500, #6366f1)' },
  generic:   { bg: 'var(--color-warning-50, #fffbeb)',  fg: 'var(--color-warning-700, #b45309)',  dot: 'var(--color-warning-500, #f59e0b)' },
};

const FALLBACK_NAMES = { vicidial: 'VICIdial', calltools: 'CallTools', generic: 'Dialer' };

// Resolve a record to { label, short, title, provider } — or null when the
// record did not come from a dialer at all.
export function dialerLabelFor(record, labels) {
  if (!record) return null;
  const accountId = record.dialer_account_id || null;
  const account = accountId ? (labels.accounts || []).find(a => a.id === accountId) : null;
  const provider = account?.provider || record.dialer_provider || null;
  if (!provider && !account) return null;

  const productName = labels.providers?.[provider] || FALLBACK_NAMES[provider] || provider;
  const label = account?.name || productName;
  return {
    provider,
    label,
    short: productName,
    title: account ? `Came from ${account.name} (${productName})` : `Came from ${productName}`,
  };
}

export default function DialerBadge({ record, compact = false, short = false, className = '', style }) {
  const labels = useDialerLabels();
  const info = dialerLabelFor(record, labels);
  if (!info) return null;

  const tone = TONES[info.provider] || TONES.generic;
  const text = short ? info.short : info.label;

  return (
    <span
      title={info.title}
      className={`inline-flex items-center gap-1 rounded-full font-medium ${compact ? 'px-1.5' : 'px-2 py-0.5'} ${className}`}
      style={{
        background: tone.bg,
        color: tone.fg,
        fontSize: compact ? 10 : 11,
        lineHeight: compact ? '15px' : '17px',
        whiteSpace: 'nowrap',
        maxWidth: compact ? 150 : 220,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        ...style,
      }}
    >
      <span style={{
        width: compact ? 5 : 6, height: compact ? 5 : 6, borderRadius: 999,
        background: tone.dot, flexShrink: 0,
      }} />
      {text}
    </span>
  );
}
