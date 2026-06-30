import { useState } from 'react';
import { Shield, ShieldAlert, ShieldCheck, Loader2 } from 'lucide-react';
import client from '../../api/client';
import { useFeatureFlags } from '../../contexts/FeatureFlagsContext';
import { useAuth } from '../../contexts/AuthContext';

// On-demand DNC / blacklist check for a single number (Blacklist Alliance).
// Renders a small "Check DNC" button; on click shows a Good / Blacklisted badge
// with the matched codes. Informational only — never blocks. Hidden unless the
// tool_blacklist_lookup feature is on for the user (superadmin always sees it).
const CODE_LABEL = {
  'federal-dnc': 'Federal DNC', 'colorado-dnc': 'CO DNC', 'florida-dnc': 'FL DNC',
  'indiana-dnc': 'IN DNC', 'pennsylvania-dnc': 'PA DNC', 'texas-dnc': 'TX DNC', 'wyoming-dnc': 'WY DNC',
  'attorney-primary': 'Attorney', 'attorney-secondary': 'Attorney (2nd)',
  'plaintiff-primary': 'Plaintiff', 'plaintiff-secondary': 'Plaintiff (2nd)',
  'prelitigation1': 'Pre-litigation', 'prelitigation2': 'Pre-litigation (2)',
  'anti-telemarketing': 'Anti-telemarketing', 'gov': 'Government',
};
const pretty = (c) => CODE_LABEL[c] || c;

export default function NumberRiskCheck({ phone, className = '' }) {
  const { isEnabledStrict } = useFeatureFlags();
  const { user } = useAuth();
  const [state, setState] = useState(null);   // null | {loading} | {error} | result

  const show = user?.role === 'superadmin' || isEnabledStrict('tool_blacklist_lookup');
  const digits = String(phone || '').replace(/\D/g, '').slice(-10);
  if (!show || digits.length !== 10) return null;

  const check = async () => {
    setState({ loading: true });
    try { const r = await client.get(`blacklist/lookup/${digits}`); setState(r.data); }
    catch (e) { setState({ error: e.response?.data?.error || 'Lookup failed' }); }
  };

  const pillBase = 'inline-flex items-center gap-1 text-[11px] font-bold px-1.5 py-0.5 rounded-md transition-colors';

  if (!state) return (
    <button type="button" onClick={check} title="Check this number against the DNC / litigation blacklist"
      className={`${pillBase} ${className}`}
      style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
      <Shield size={12} /> Check DNC
    </button>
  );
  if (state.loading) return (
    <span className={`${pillBase} ${className}`} style={{ color: 'var(--color-text-secondary)' }}>
      <Loader2 size={12} className="animate-spin" /> Checking…
    </span>
  );
  if (state.error) return (
    <button type="button" onClick={check} className={`${pillBase} ${className}`} style={{ color: '#d97706', border: '1px solid #fcd34d' }} title="Tap to retry">
      <ShieldAlert size={12} /> {state.error} · retry
    </button>
  );

  const bad = state.blacklisted;
  const color = bad ? '#dc2626' : '#16a34a';
  const codeStr = (state.codes || []).map(pretty).join(', ');
  const carrier = state.carrier ? `${state.carrier.name || ''}${state.wireless ? ' · wireless' : ''}`.trim() : (state.wireless ? 'wireless' : '');
  const title = [
    `${state.message}${codeStr ? ` — ${codeStr}` : ''}`,
    carrier && `Carrier: ${carrier}`,
    state.checked_at && `Checked ${new Date(state.checked_at).toLocaleString()}${state.cached ? ' (cached)' : ''}`,
  ].filter(Boolean).join('\n');

  return (
    <button type="button" onClick={check} title={`${title}\n\nTap to re-check`}
      className={`${pillBase} ${className}`}
      style={{ color, backgroundColor: `${color}14`, border: `1px solid ${color}44` }}>
      {bad ? <ShieldAlert size={12} /> : <ShieldCheck size={12} />}
      {state.message}{codeStr ? ` · ${codeStr}` : ''}
    </button>
  );
}
