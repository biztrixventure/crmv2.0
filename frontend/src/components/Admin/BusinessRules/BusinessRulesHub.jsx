import { useEffect, useState, useCallback } from 'react';
import { Settings2, RefreshCw, Search, BarChart3, ShieldCheck, Bell, Building2 } from 'lucide-react';
import client from '../../../api/client';
import ResellRules from './ResellRules';
import DedupRules from './DedupRules';

// ── Sub-page registry ────────────────────────────────────────────────────────
// Each sub-page receives { config, companies, scope, onSave, onReset } so it
// can render its form without re-fetching. Disabled flag flips a "Coming soon"
// badge for sections not yet shipped — keeps the nav visible so users see the
// roadmap without confusion.
const PAGES = [
  { id: 'resell',       label: 'Resell & Re-engagement', icon: RefreshCw,   Component: ResellRules },
  { id: 'dedup',        label: 'Dedup & Search',         icon: Search,      Component: DedupRules },
  { id: 'kpi',          label: 'Stats & KPIs',           icon: BarChart3,   disabled: true },
  { id: 'compliance',   label: 'Compliance Workflow',    icon: ShieldCheck, disabled: true },
  { id: 'notifications',label: 'Notifications',          icon: Bell,        disabled: true },
];

const BusinessRulesHub = () => {
  const [pageId, setPageId]     = useState('resell');
  const [scope, setScope]       = useState('global');  // 'global' | 'company:<uuid>'
  const [companies, setCompanies] = useState([]);
  const [config, setConfig]     = useState({});
  const [loading, setLoading]   = useState(false);
  const [savingMsg, setSavingMsg] = useState('');

  const companyId = scope.startsWith('company:') ? scope.slice(8) : null;
  const ActivePage = PAGES.find(p => p.id === pageId)?.Component;
  const activeMeta = PAGES.find(p => p.id === pageId);

  // ── Load resolved config (global + company override) ─────────────────────
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const params = companyId ? { company_id: companyId } : {};
      const { data } = await client.get('business-config', { params });
      setConfig(data.config || {});
    } catch (e) {
      console.error('biz-config load', e);
    } finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { reload(); }, [reload]);

  // ── Companies for the override picker (superadmin scope) ─────────────────
  useEffect(() => {
    client.get('companies').then(r => setCompanies(r.data?.companies || r.data || [])).catch(() => {});
  }, []);

  const handleSave = async (key, value) => {
    setSavingMsg('Saving…');
    try {
      await client.put('business-config', { scope, key, value });
      setConfig(c => ({ ...c, [key]: value }));
      setSavingMsg('Saved ✓');
      setTimeout(() => setSavingMsg(''), 1500);
    } catch (e) {
      setSavingMsg(e.response?.data?.error || 'Save failed');
      setTimeout(() => setSavingMsg(''), 3000);
    }
  };

  const handleResetOverride = async (key) => {
    if (scope === 'global') return;
    if (!window.confirm('Reset this setting to global default? The company override will be removed.')) return;
    try {
      await client.delete(`business-config/${scope}/${key}`);
      reload();
    } catch (e) { console.error(e); }
  };

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'var(--gradient-sidebar)' }}>
            <Settings2 size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-text leading-tight" style={{ fontFamily: 'var(--font-display)' }}>
              Business Rules
            </h1>
            <p className="text-sm text-text-secondary">Configure resell, dedup, KPI, and workflow behavior per company or globally.</p>
          </div>
        </div>

        {/* Scope picker — global vs per-company override. Visually flagged so
            a user editing a single company doesn't accidentally think they're
            changing global defaults. */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <label className="flex items-center gap-2 text-xs font-semibold text-text-secondary uppercase tracking-wide">
            <Building2 size={14} /> Scope
          </label>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="input text-sm py-2 min-w-[260px]"
            style={{
              borderColor: scope === 'global' ? 'var(--color-border)' : 'var(--color-warning-400, #facc15)',
              backgroundColor: scope === 'global' ? 'var(--color-surface)' : 'var(--color-warning-50, #fffbeb)',
            }}
          >
            <option value="global">🌐 Global defaults</option>
            <optgroup label="Per-company override">
              {companies.map(c => (
                <option key={c.id} value={`company:${c.id}`}>{c.name}</option>
              ))}
            </optgroup>
          </select>
          {savingMsg && (
            <span aria-live="polite" className="text-xs font-semibold px-2 py-1 rounded"
              style={{
                backgroundColor: savingMsg === 'Saving…' ? 'var(--color-bg-secondary)'
                  : savingMsg.includes('✓') ? 'var(--color-success-100, #d1fae5)'
                  : 'var(--color-error-100, #fee2e2)',
                color: savingMsg.includes('✓') ? 'var(--color-success-700, #047857)'
                  : savingMsg.includes('failed') || savingMsg.includes('Save failed') ? 'var(--color-error-700, #b91c1c)'
                  : 'var(--color-text-secondary)',
              }}>
              {savingMsg}
            </span>
          )}
        </div>
      </div>

      {/* ── Body: sidebar + page ───────────────────────────────────────── */}
      <div className="flex gap-5 flex-1 min-h-0">
        {/* Sub-page sidebar */}
        <nav className="w-64 flex-shrink-0 space-y-1" aria-label="Business Rules sections">
          {PAGES.map(p => {
            const active = pageId === p.id;
            const dis = p.disabled;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => !dis && setPageId(p.id)}
                disabled={dis}
                aria-current={active ? 'page' : undefined}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all"
                style={{
                  background: active ? 'var(--gradient-sidebar)' : 'transparent',
                  color: active ? 'white' : dis ? 'var(--color-text-tertiary)' : 'var(--color-text-secondary)',
                  cursor: dis ? 'not-allowed' : 'pointer',
                  opacity: dis ? 0.55 : 1,
                  border: active ? 'none' : '1px solid transparent',
                }}
                onMouseEnter={e => { if (!active && !dis) e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)'; }}
                onMouseLeave={e => { if (!active && !dis) e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: active ? 'rgba(255,255,255,0.22)' : 'var(--color-bg-secondary)' }}>
                  <p.icon size={15} style={{ color: active ? 'white' : 'var(--color-text-secondary)' }} />
                </div>
                <span className="flex-1 text-left">{p.label}</span>
                {dis && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}>Soon</span>}
              </button>
            );
          })}
        </nav>

        {/* Page content */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
            </div>
          ) : ActivePage ? (
            <ActivePage
              config={config}
              scope={scope}
              companyId={companyId}
              activeMeta={activeMeta}
              onSave={handleSave}
              onResetOverride={handleResetOverride}
            />
          ) : (
            <div className="text-center py-16 text-text-tertiary">Section not available.</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BusinessRulesHub;
