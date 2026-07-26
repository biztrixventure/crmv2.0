// GovernanceSection — the readonly-admin governance facets for THIS user:
// tab allowlist, company scope, capability/masking flags, per-area export, and
// vanity display label. Reads the effective values from GET /readonly-admins
// (the list already resolves per-user ← role-default ← parity) and writes each
// facet through its existing PUT /readonly-admins/:userId/* endpoint.
//
// Governance today is keyed to the readonly_admin role. For other roles we show
// a clear note instead of inert controls.
//
// UI from components/UI/kit (docs/ui-design-system.md). `null` still means
// parity/all for nav_allowed and companies — unchanged semantics.
import { useState, useEffect, useCallback } from 'react';
import { Lock, Save } from 'lucide-react';
import client from '../../../api/client';
import { Alert } from '../../../components/UI';
import { RO_ELIGIBLE_TABS } from '../../../config/adminTabs';
import { ADMIN_CONTROLS } from '../../../config/adminControls';
import { Panel, SectionHeader, Loading, EmptyState, CheckRow, useFlash } from '../../UI/kit';

const pretty = (s) => String(s || '').replace(/[._]/g, ' ').replace(/\b\w/g, m => m.toUpperCase());

// Canonical flag catalog (mirrors ReadonlyAdminManager FLAG_CATALOG). Every flag
// except no_copy means "capability granted" when true; no_copy true = BLOCKED.
const FLAG_CATALOG = [
  { key: 'view_financial_data',     label: 'See financial data',       desc: 'Amounts, revenue' },
  { key: 'view_pii',                label: 'See customer PII',         desc: 'Phone, email, etc.' },
  { key: 'view_audit_history',      label: 'See audit history',        desc: 'Expand edit history' },
  { key: 'view_recordings',         label: 'Play call recordings' },
  { key: 'can_export',              label: 'Allow exports',            desc: 'Master export switch' },
  { key: 'show_readonly_badge',     label: 'Show read-only badge' },
  { key: 'show_write_blocked_alert',label: 'Show write-blocked alert' },
  { key: 'no_copy',                 label: 'Block copying',            desc: 'Checked = copying blocked' },
];
const EXPORT_AREA_LABEL = {
  sales: 'Sales', transfers: 'Transfers', callbacks: 'Callbacks', customer_profile: 'Customer Profiles',
  numbers: 'Numbers', data_analyzer: 'Data Analyzer', company_data: 'Company Data', chat: 'Chat Transcripts', reviews: 'QA Reviews',
};
const exportAreaLabel = (a) => EXPORT_AREA_LABEL[a] || pretty(a);
const FLAG_META = Object.fromEntries(FLAG_CATALOG.map(f => [f.key, f]));

export default function GovernanceSection({ account, isReadonlyAdmin }) {
  const userId = account.user_id;
  const [gov, setGov]         = useState(null);   // this user's row from /readonly-admins
  const [meta, setMeta]       = useState({ export_areas: [], flag_keys: [] });
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(null);
  const { msg, flash, clear } = useFlash();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [roRes, coRes] = await Promise.all([
        client.get('readonly-admins'),
        client.get('companies').catch(() => ({ data: { companies: [] } })),
      ]);
      const row = (roRes.data.readonly_admins || []).find(u => u.id === userId) || null;
      setGov(row);
      setMeta({ export_areas: roRes.data.export_areas || [], flag_keys: roRes.data.flag_keys || [] });
      setCompanies(coRes.data.companies || coRes.data || []);
    } catch (e) { flash('error', e.response?.data?.error || 'Failed to load governance.'); }
    finally { setLoading(false); }
  }, [userId, flash]);

  useEffect(() => { if (isReadonlyAdmin) load(); else setLoading(false); }, [isReadonlyAdmin, load]);

  const saveFlags = async (nextFlags) => {
    setBusy('flags');
    try { await client.put(`readonly-admins/${userId}/flags`, { flags: nextFlags }); setGov(g => ({ ...g, flags: nextFlags })); flash('success', 'Flags saved.'); }
    catch (e) { flash('error', e.response?.data?.error || 'Save failed.'); } finally { setBusy(null); }
  };
  const saveExport = async (nextExport) => {
    setBusy('export');
    try { await client.put(`readonly-admins/${userId}/export`, { export: nextExport }); setGov(g => ({ ...g, export: nextExport })); flash('success', 'Export areas saved.'); }
    catch (e) { flash('error', e.response?.data?.error || 'Save failed.'); } finally { setBusy(null); }
  };
  const saveNav = async (nextNav) => {
    setBusy('nav');
    try { await client.put(`readonly-admins/${userId}/nav`, { allowed: nextNav }); setGov(g => ({ ...g, nav_allowed: nextNav })); flash('success', 'Tab allowlist saved.'); }
    catch (e) { flash('error', e.response?.data?.error || 'Save failed.'); } finally { setBusy(null); }
  };
  const saveCompanies = async (next) => {
    setBusy('companies');
    try { await client.put(`readonly-admins/${userId}/companies`, { companies: next }); setGov(g => ({ ...g, companies: next })); flash('success', 'Company scope saved.'); }
    catch (e) { flash('error', e.response?.data?.error || 'Save failed.'); } finally { setBusy(null); }
  };
  const saveLabel = async (label) => {
    setBusy('label');
    try { await client.put(`readonly-admins/${userId}/label`, { display_role_label: label }); setGov(g => ({ ...g, display_role_label: label || null })); flash('success', 'Label saved.'); }
    catch (e) { flash('error', e.response?.data?.error || 'Save failed.'); } finally { setBusy(null); }
  };
  const saveControls = async (nextDisabled) => {
    setBusy('controls');
    try { await client.put(`readonly-admins/${userId}/controls`, { controls: nextDisabled }); setGov(g => ({ ...g, controls: nextDisabled })); flash('success', 'Button controls saved.'); }
    catch (e) { flash('error', e.response?.data?.error || 'Save failed.'); } finally { setBusy(null); }
  };

  if (!isReadonlyAdmin) {
    return (
      <div className="max-w-xl">
        <SectionHeader icon={Lock} title="Governance" />
        <Panel tone="inset" radius="xl" className="text-sm text-text-secondary">
          Governance (tab allowlist, company scope, masking, export allowance, no-copy, display label) currently applies to the <b>readonly_admin</b> role. This user is not a readonly admin, so there is nothing to configure here. Assign the readonly_admin role first (Companies &amp; Role tab), then reload.
        </Panel>
      </div>
    );
  }

  if (loading) return <Loading variant="rows" rows={6} label="Loading governance…" />;
  if (!gov)    return <EmptyState icon={Lock} title="Not a listed readonly admin yet" hint="This user isn’t in the readonly-admin registry." />;

  const flags = gov.flags || {};
  const exp   = gov.export || {};
  const navAllowed = gov.nav_allowed;                 // null = parity (all)
  const compScope  = gov.companies;                   // null = all

  const miniBtn = 'text-xs font-semibold px-2.5 py-1 rounded';
  const miniStyle = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' };

  return (
    <div className="space-y-5 max-w-4xl">
      <SectionHeader icon={Lock} title="Governance · Readonly Admin" />
      {msg && <Alert type={msg.type} onDismiss={clear}>{msg.text}</Alert>}

      {/* Capability / masking flags */}
      <Facet title="Capability & masking flags" busy={busy === 'flags'}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {(meta.flag_keys?.length ? meta.flag_keys : FLAG_CATALOG.map(f => f.key)).map(k => {
            const f = FLAG_META[k] || { label: pretty(k) };
            return (
              <CheckRow key={k} label={f.label} hint={f.desc} checked={!!flags[k]}
                onChange={next => saveFlags({ ...flags, [k]: next })} />
            );
          })}
        </div>
      </Facet>

      {/* Per-area export */}
      <Facet title="Export allowance by area — checked = allowed" busy={busy === 'export'}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {(meta.export_areas || []).map(a => (
            <CheckRow key={a} label={exportAreaLabel(a)} checked={exp[a] !== false} onChange={v => saveExport({ ...exp, [a]: v })} />
          ))}
        </div>
      </Facet>

      {/* Per-button action controls (checked = allowed; unchecked = hidden) */}
      <Facet title="Button controls — checked = allowed" busy={busy === 'controls'}>
        <p className="text-[11px] text-text-secondary mb-3">Uncheck to hide a specific action button inside a tab (the tab stays visible; the button disappears).</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
          {Object.entries(ADMIN_CONTROLS).map(([tabId, ctrls]) => (
            <div key={tabId}>
              <div className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-1">{tabId.replace(/-/g, ' ')}</div>
              {ctrls.map(c => {
                const disabled = Array.isArray(gov.controls) ? gov.controls : [];
                const allowed = !disabled.includes(c.key);
                return (
                  <CheckRow key={c.key} label={c.label} checked={allowed}
                    onChange={v => saveControls(v ? disabled.filter(k => k !== c.key) : [...new Set([...disabled, c.key])])} />
                );
              })}
            </div>
          ))}
        </div>
      </Facet>

      {/* Tab allowlist */}
      <Facet title={`Tab access allowlist ${navAllowed == null ? '(currently: all tabs)' : `(${navAllowed.length} tabs)`}`} busy={busy === 'nav'}>
        <div className="flex items-center gap-2 mb-2">
          <button onClick={() => saveNav(RO_ELIGIBLE_TABS.map(t => t.id))} className={miniBtn} style={miniStyle}>All</button>
          <button onClick={() => saveNav(['dashboard'])} className={miniBtn} style={miniStyle}>Minimal</button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-64 overflow-y-auto">
          {RO_ELIGIBLE_TABS.map(t => {
            const on = navAllowed == null ? true : navAllowed.includes(t.id);
            return (
              <CheckRow key={t.id} label={t.label} checked={on}
                onChange={v => {
                  const base = navAllowed == null ? RO_ELIGIBLE_TABS.map(x => x.id) : navAllowed;
                  const next = v ? [...new Set([...base, t.id])] : base.filter(x => x !== t.id);
                  saveNav(next);
                }} />
            );
          })}
        </div>
      </Facet>

      {/* Company scope */}
      <Facet title={`Company scope ${compScope == null ? '(currently: all companies)' : `(${compScope.length})`}`} busy={busy === 'companies'}>
        <div className="flex items-center gap-2 mb-2">
          <button onClick={() => saveCompanies(null)} className={miniBtn} style={miniStyle}>All companies</button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-64 overflow-y-auto">
          {companies.map(c => {
            const on = compScope == null ? true : compScope.includes(c.id);
            return (
              <CheckRow key={c.id} label={c.name} checked={on}
                onChange={v => {
                  const base = compScope == null ? companies.map(x => x.id) : compScope;
                  const next = v ? [...new Set([...base, c.id])] : base.filter(x => x !== c.id);
                  saveCompanies(next);
                }} />
            );
          })}
        </div>
      </Facet>

      {/* Display label */}
      <Facet title="Display role label (vanity)" busy={busy === 'label'}>
        <LabelEditor value={gov.display_role_label || ''} onSave={saveLabel} />
      </Facet>
    </div>
  );
}

function Facet({ title, busy, children }) {
  return (
    <Panel tone="inset" radius="xl">
      <SectionHeader level="sub" title={title} actions={busy ? <Loading variant="inline" size={13} /> : null} />
      {children}
    </Panel>
  );
}

function LabelEditor({ value, onSave }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  return (
    <div className="flex items-center gap-2">
      <input value={v} onChange={e => setV(e.target.value)} placeholder="e.g. Regional Overseer (blank = real label)" className="input flex-1" />
      <button onClick={() => onSave(v.trim())} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: 'var(--color-primary-600)', color: '#fff' }}>
        <Save size={14} /> Save
      </button>
    </div>
  );
}
