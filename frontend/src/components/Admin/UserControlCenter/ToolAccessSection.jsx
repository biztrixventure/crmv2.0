// ToolAccessSection -- which optional TOOLS this one person may open.
//
// The DNC / blacklist check, the card validator and the delegated admin tools
// are feature flags, and a flag could already be set per person (mig 122) --
// but only from the per-COMPANY override editor. So handing the DNC check to
// one fronter meant knowing which company row to open, and a person in two
// companies needed two edits that could disagree with each other. This page is
// about the PERSON: one switch each, whatever company they sit in.
//
// Three states, not two. INHERIT means nobody has decided for this person, so
// their company's setting (or the tool's own default) answers -- shown on the
// row, so it never has to be guessed. ON and OFF are decisions about them and
// beat the company either way. Collapsing OFF into INHERIT would silently hand
// the tool back the next time a company override changed.
//
// Nobody loses a tool by opening this page: a switch only writes when it is
// clicked, and it writes for that one tool.
import { useState, useEffect, useCallback } from 'react';
import {
  Wrench, ShieldAlert, CreditCard, Users, BarChart3, MessagesSquare, ClipboardCheck,
  SlidersHorizontal, Flag, Building2, LayoutGrid, Check, X, CornerDownRight,
} from 'lucide-react';
import client from '../../../api/client';
import { Panel, SectionHeader, Loading, EmptyState, useFlash } from '../../UI/kit';

// A tool the whole floor asks about deserves a recognisable icon; anything new
// in the catalog still renders, with the generic one.
const ICONS = {
  tool_blacklist_lookup:  ShieldAlert,
  tool_card_validator:    CreditCard,
  tool_customer_profiles: Users,
  tool_data_analyzer:     BarChart3,
  tool_chat_control:      MessagesSquare,
  tool_compliance_review: ClipboardCheck,
  tool_business_rules:    SlidersHorizontal,
  tool_feature_admin:     Flag,
  tool_company_admin:     Building2,
  custom_workspace:       LayoutGrid,
};

// What each switch actually opens, in the words of the person using it. The
// catalog's own description is used for anything not listed here.
const NOTES = {
  tool_blacklist_lookup:
    'The DNC / blacklist check: type a number and see what the Blacklist Alliance says about it (Good, Suppressed, Blacklisted, and the lists behind it) before dialling. Also puts the Check DNC badge on lead and sale records. Read-only -- it never blocks a call.',
  tool_card_validator:
    'The card checker: brand, Luhn and expiry are worked out in the browser, and only the first six digits ever leave it, to name the issuing bank.',
};

const STATES = [
  { key: 'on',      label: 'On',      icon: Check,           hint: 'This person can use it, whatever their company is set to.' },
  { key: 'inherit', label: 'Inherit', icon: CornerDownRight, hint: 'Follow the company setting, or the tool default.' },
  { key: 'off',     label: 'Off',     icon: X,               hint: 'Hidden for this person, even if their company has it on.' },
];

const TONE = { on: 'var(--color-success-600)', off: 'var(--color-error-600)', inherit: 'var(--color-text-secondary)' };

function StateSwitch({ value, busy, onPick }) {
  return (
    <div className="inline-flex rounded-xl overflow-hidden flex-shrink-0"
      style={{ border: '1px solid var(--color-border)', opacity: busy ? 0.6 : 1 }}>
      {STATES.map(s => {
        const active = value === s.key;
        const Icon = s.icon;
        return (
          <button key={s.key} type="button" disabled={busy} title={s.hint}
            onClick={() => !active && onPick(s.key)}
            className="px-2.5 py-1.5 text-xs font-bold inline-flex items-center gap-1 transition-colors"
            style={{
              backgroundColor: active ? `${TONE[s.key]}1a` : 'transparent',
              color: active ? TONE[s.key] : 'var(--color-text-tertiary)',
              borderLeft: s.key === 'on' ? 'none' : '1px solid var(--color-border)',
            }}>
            <Icon size={12} /> {s.label}
          </button>
        );
      })}
    </div>
  );
}

export default function ToolAccessSection({ account }) {
  const userId = account?.user_id;
  const [tools, setTools] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(true);
  const [busy, setBusy] = useState(null);
  const { msg, flash, clear } = useFlash();

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const r = await client.get(`users/tool-access/${userId}`);
      setTools(r.data.tools || []);
      setCompanies(r.data.companies || []);
      setAllowed(true);
    } catch (e) {
      // 403 = the viewer is not a superadmin. Hide the switches rather than
      // rendering controls that cannot work.
      if (e.response?.status === 403) setAllowed(false);
      setTools([]);
    } finally { setLoading(false); }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const save = async (tool, state) => {
    setBusy(tool.key);
    clear();
    try {
      await client.put(`users/tool-access/${userId}`, { feature_key: tool.key, state });
      setTools(list => list.map(t => (t.key === tool.key ? { ...t, state, scoped_to_company: false } : t)));
      const name = tool.label || tool.key;
      flash('success', state === 'inherit'
        ? `${name} now follows their company setting (${tool.inherit_enabled ? 'on' : 'off'} today).`
        : state === 'on'
          ? `${name} is on for this person. It shows up the next time their screen loads.`
          : `${name} is off for this person, even where their company has it on.`);
    } catch (e) {
      flash('error', e.response?.data?.error || 'Save failed.');
    } finally { setBusy(null); }
  };

  if (!userId) return <EmptyState icon={Wrench} title="No user selected" />;
  if (loading) return <Loading />;
  if (!allowed) return <EmptyState icon={Wrench} title="Superadmin only" hint="Tool access is set by a superadmin." />;

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Wrench}
        title="Tools"
        subtitle="Hand an optional tool to this one person -- any role, any company. On and Off are decisions about them and beat the company setting; Inherit follows it."
      />
      {msg && (
        <div className="rounded-xl px-3 py-2 text-sm font-semibold"
          style={{
            backgroundColor: msg.type === 'error' ? 'var(--color-error-50)' : 'var(--color-success-50)',
            color: msg.type === 'error' ? 'var(--color-error-600)' : 'var(--color-success-600)',
            border: `1px solid ${msg.type === 'error' ? 'var(--color-error-600)' : 'var(--color-success-600)'}33`,
          }}>{msg.text}</div>
      )}

      {!tools.length && (
        <EmptyState icon={Wrench} title="No tools in the catalog" hint="Tools show up here once they exist as feature flags." />
      )}

      <div className="flex flex-col gap-2">
        {tools.map(t => {
          const Icon = ICONS[t.key] || Wrench;
          const effective = t.state === 'inherit' ? t.inherit_enabled : t.state === 'on';
          const onCount = (t.companies || []).filter(c => c.enabled).length;
          return (
            <Panel key={t.key} pad="md">
              <div className="flex items-start gap-3">
                <span className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{
                    backgroundColor: effective ? 'var(--color-primary-100)' : 'var(--color-bg-secondary)',
                    color: effective ? 'var(--color-primary-600)' : 'var(--color-text-tertiary)',
                  }}>
                  <Icon size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>{t.label || t.key}</span>
                    <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-md"
                      style={{
                        backgroundColor: effective ? 'var(--color-success-50)' : 'var(--color-bg-secondary)',
                        color: effective ? 'var(--color-success-600)' : 'var(--color-text-tertiary)',
                      }}>
                      {effective ? 'can use it' : 'cannot use it'}
                    </span>
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{NOTES[t.key] || t.description || ''}</p>
                  <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                    {t.state === 'inherit'
                      ? `Following their company: ${t.inherit_enabled ? 'on' : 'off'}${companies.length > 1 ? ` (${onCount} of ${companies.length} companies have it on)` : ''}`
                      : `Set for this person${t.scoped_to_company ? ' - an older company-scoped grant, which saving here replaces' : ''}. Their company setting is ${t.inherit_enabled ? 'on' : 'off'}.`}
                  </p>
                </div>
                <StateSwitch value={t.state} busy={busy === t.key} onPick={(s) => save(t, s)} />
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
