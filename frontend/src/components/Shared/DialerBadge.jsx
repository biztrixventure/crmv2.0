import { useEffect, useState } from 'react';
import { Radio } from 'lucide-react';
import client from '../../api/client';

// ============================================================================
// DialerBadge — which dialer did this record come from?
//
// With one dialer the answer was implicit and nobody had to ask. With two it
// is the first question anyone asks of a number that looks wrong: is this a
// CallTools transfer or a VICIdial one? So every record that came from a
// dialer says so, in the same place, in the same shape.
//
// The names come from /api/dialers/labels — id, name and provider only, no
// tokens or URLs, so a closer or a QA reviewer can read the badge without
// being a superadmin. They are fetched ONCE per page load and shared by every
// badge on it: a transfer list renders hundreds of these, and a request each
// would be absurd.
//
// A record with no account is pre-migration-320 data, which is VICIdial by
// definition — not badged by default, because a badge on every historical row
// is noise, and "unbadged means the old dialer" is learned in one glance. The
// drawer passes showLegacy, because there detail IS the point.
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
      // A badge is decoration on top of the record — if the lookup fails the
      // row still renders, just without a name.
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

// Resolve a record to { label, title, provider } or null when there is nothing
// to say.
export function dialerLabelFor(record, labels) {
  if (!record) return null;
  const provider = record.dialer_provider || null;
  const accountId = record.dialer_account_id || null;
  if (!provider && !accountId) return null;

  const account = accountId ? (labels.accounts || []).find(a => a.id === accountId) : null;
  // The ACCOUNT name wins: two CallTools tenants are two different floors, and
  // "CallTools" on both would answer the wrong question.
  const label = account?.name || labels.providers?.[provider] || provider;
  const title = account
    ? `Came from ${account.name} (${labels.providers?.[account.provider] || account.provider})`
    : `Came from ${label}`;
  return { label, title, provider: account?.provider || provider };
}

export default function DialerBadge({ record, showLegacy = false, className = '', compact = false }) {
  const labels = useDialerLabels();
  const info = dialerLabelFor(record, labels);
  if (!info) return null;
  if (!showLegacy && info.provider === 'vicidial' && !record.dialer_account_id) return null;

  return (
    <span
      title={info.title}
      className={`inline-flex items-center gap-1 rounded-full ${compact ? 'px-1.5 py-0' : 'px-2 py-0.5'} ${className}`}
      style={{
        background: 'var(--color-bg-tertiary)',
        color: 'var(--color-text-secondary)',
        fontSize: compact ? 10 : 11,
        lineHeight: compact ? '15px' : '17px',
        whiteSpace: 'nowrap',
      }}
    >
      <Radio size={compact ? 9 : 11} style={{ flexShrink: 0 }} />
      {info.label}
    </span>
  );
}
