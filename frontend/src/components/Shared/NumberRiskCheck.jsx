import { useState } from 'react';
import { Shield, ShieldAlert, ShieldCheck, Loader2 } from 'lucide-react';
import client from '../../api/client';
import { useFeatureFlags } from '../../contexts/FeatureFlagsContext';
import { useAuth } from '../../contexts/AuthContext';
import { verdictOf, statusText, codeShort, codeLabel } from '../../utils/dncStatus';

// On-demand DNC / blacklist check for a single number (Blacklist Alliance).
// Renders a small "Check DNC" button; on click shows a Good / Blacklisted badge
// with the matched codes. Informational only — never blocks. Hidden unless the
// tool_blacklist_lookup feature is on for the user (superadmin always sees it).
// The badge shows the Alliance's OWN status (Good / Suppressed / Blacklisted /
// anything new it starts sending), not a good-or-bad boolean: a suppressed
// number is a different rule from a litigator and must not read the same.
// Names, colours and code labels live in utils/dncStatus so this badge and the
// lookup page can never disagree -- each used to keep half a list of codes, and
// neither knew 'suppression' or 'screamer'.

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

  const v = verdictOf(state);
  const clean = v.tone === 'safe';
  const color = v.color;
  const codes = state.codes || [];
  const codeStr = codes.map(codeShort).join(', ');
  const carrier = state.carrier ? `${state.carrier.name || ''}${state.wireless ? ' · wireless' : ''}`.trim() : (state.wireless ? 'wireless' : '');
  const title = [
    `${statusText(state)}${codeStr ? ` — ${codeStr}` : ''}`,
    codes.length ? `Lists: ${codes.map(codeLabel).join(', ')}` : null,
    v.note,
    carrier && `Carrier: ${carrier}`,
    state.checked_at && `Checked ${new Date(state.checked_at).toLocaleString()}${state.cached ? ' (cached)' : ' (live)'}`,
  ].filter(Boolean).join('\n');

  return (
    <button type="button" onClick={check} title={`${title}\n\nTap to re-check`}
      className={`${pillBase} ${className}`}
      style={{ color, backgroundColor: `${color}14`, border: `1px solid ${color}44` }}>
      {clean ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
      {statusText(state)}{codeStr ? ` · ${codeStr}` : ''}
    </button>
  );
}
