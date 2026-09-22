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

let cache = null;          // { accounts: [...], providers: {...}, boxes: [...] }
let inflight = null;
const listeners = new Set();

function loadLabels() {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = client.get('dialers/labels')
    .then(r => {
      cache = {
        accounts: r.data?.accounts || [],
        providers: r.data?.providers || {},
        boxes: r.data?.boxes || [],
      };
      listeners.forEach(fn => fn(cache));
      return cache;
    })
    .catch(() => {
      // The tag sits on top of the record — if the lookup fails the row still
      // renders, just with the product's name instead of the account's.
      cache = { accounts: [], providers: {}, boxes: [] };
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
  return labels || { accounts: [], providers: {}, boxes: [] };
}

// Options for the Dialer column's filter tick-list, newest-and-biggest first.
//
// The record count rides along in the label because the question behind the
// filter is usually "how many came from each dialer", and answering it in the
// list itself saves ticking each box in turn to read the pagination total.
export function useDialerBoxOptions() {
  const { boxes } = useDialerLabels();
  return (boxes || []).map(b => ({
    value: b.box,
    label: b.records != null ? `${b.box} (${Number(b.records).toLocaleString()})` : b.box,
  }));
}

// One colour per dialer so a list is scannable without reading it: the
// long-standing one stays neutral, anything newer gets its own accent.
const TONES = {
  vicidial:  { bg: 'var(--color-bg-tertiary)',          fg: 'var(--color-text-secondary)',        dot: 'var(--color-text-tertiary)' },
  calltools: { bg: 'var(--color-primary-50, #eef2ff)',  fg: 'var(--color-primary-700, #4338ca)',  dot: 'var(--color-primary-500, #6366f1)' },
  generic:   { bg: 'var(--color-warning-50, #fffbeb)',  fg: 'var(--color-warning-700, #b45309)',  dot: 'var(--color-warning-500, #f59e0b)' },
  // No dialer at all — typed in by a person. Deliberately the quietest of the
  // three: it is the most common answer on sales and must not shout.
  manual:    { bg: 'transparent',                       fg: 'var(--color-text-tertiary)',         dot: 'var(--color-border)' },
};

const FALLBACK_NAMES = { vicidial: 'VICIdial', calltools: 'CallTools', generic: 'Dialer' };

// Resolve a record to { label, short, title, provider } — or null when the
// record carries no origin information at all.
//
// THE THREE STATES ARE DELIBERATELY DIFFERENT, and the difference is null vs
// undefined. A record whose dialer field is EXPLICITLY null came from no
// dialer — someone typed it into the CRM — and saying so is useful. A record
// with no such field simply was not fetched with it, and inventing "Manual"
// there would be a lie about 92,000 rows.
export function dialerLabelFor(record, labels) {
  if (!record) return null;

  const knowsOrigin = 'dialer_provider' in record || 'dialer_account_id' in record || 'dialer_box' in record;
  const accountId = record.dialer_account_id || null;
  const account = accountId ? (labels.accounts || []).find(a => a.id === accountId) : null;
  const provider = account?.provider || record.dialer_provider || null;

  if (!provider && !account) {
    if (!knowsOrigin) return null;                       // not fetched — say nothing
    return { provider: 'manual', label: 'Manual', short: 'Manual',
             title: 'Typed into the CRM — not from a dialer' };
  }

  const productName = labels.providers?.[provider] || FALLBACK_NAMES[provider] || provider;
  // The BOX is the sharper answer — "WTI" says more than "VICIdial" when every
  // row is VICIdial. It is the connected account's name for a provider, and
  // the vendor-code prefix for VICIdial (mig 325).
  const box = record.dialer_box || account?.name || null;
  const boxAddsSomething = box && box !== productName && !box.startsWith(productName);

  return {
    provider,
    // Lists: the box alone, which is what distinguishes one row from the next.
    short: box || productName,
    // Detail: the product AND the box, so it reads as a sentence.
    label: boxAddsSomething ? `${productName} · ${box}` : (box || productName),
    title: boxAddsSomething ? `Came from ${productName}, box ${box}` : `Came from ${box || productName}`,
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
