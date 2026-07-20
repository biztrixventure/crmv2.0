import { useState, useEffect, useCallback, useRef } from 'react';
import { Palette, Save, RotateCcw, Loader2, Check, Sun, Moon, Globe, Building2, Eraser, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../../api/client';
import { useAuth } from '../../../contexts/AuthContext';
import { useTheme } from '../../../contexts/ThemeContext';
import { CORE_TOKENS, SEMANTIC_TOKENS, ADVANCED_TOKENS, advancedDefaults, applyTheme, clearTheme } from '../../../utils/themeApply';
import { THEME_PRESETS, DEFAULT_PRESET_ID, themeFromPreset } from '../../../utils/themePresets';
import ThemedSelect from '../../UI/Select';

// ============================================================================
// AppearanceManager — SuperAdmin theme editor.
//
// Pick a preset, tweak the core --color-* tokens live (whole app repaints via
// injected CSS vars — no reload), and save per-company (or global) overrides to
// business_config `theme`. ThemeRuntime re-injects the saved theme for every
// user on load. Edits preview with cache:false so a scoped preview never
// pollutes the editor's own cached theme; on unmount we restore the editor's
// real company theme.
// ============================================================================

const card = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12 };
const inputStyle = { background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' };

// A single core-token swatch: colour picker + hex text, kept in sync.
function Swatch({ label, value, onChange }) {
  return (
    <label className="flex items-center gap-3">
      <input
        type="color"
        value={/^#[0-9a-f]{6}$/i.test(value || '') ? value : '#000000'}
        onChange={(e) => onChange(e.target.value)}
        className="w-9 h-9 rounded-lg flex-shrink-0 cursor-pointer"
        style={{ border: '1px solid var(--color-border)', background: 'transparent' }}
      />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>{label}</div>
        <input
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-2 py-1 text-xs rounded-md font-mono mt-0.5"
          style={inputStyle}
          spellCheck={false}
        />
      </div>
    </label>
  );
}

// Miniature preview of the live theme — reassures before saving. Uses the same
// vars the whole app reads, so it always matches.
function Preview() {
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
      <div className="px-4 py-3 flex items-center justify-between" style={{ background: 'var(--gradient-sidebar)' }}>
        <span className="text-sm font-semibold" style={{ color: '#fff' }}>Sidebar</span>
        <span className="text-xs" style={{ color: 'rgba(255,255,255,.8)' }}>nav</span>
      </div>
      <div className="p-4 space-y-3" style={{ background: 'var(--color-bg)' }}>
        <div className="p-3 rounded-lg" style={card}>
          <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Card title</div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>Muted supporting text on a surface.</div>
          <div className="flex items-center gap-2 mt-3">
            <button className="px-3 py-1.5 text-xs font-semibold rounded-lg text-white" style={{ background: 'var(--color-primary-600)' }}>Primary</button>
            <button className="btn-secondary text-xs" style={{ padding: '6px 12px' }}>Secondary</button>
            <span className="badge" style={{ fontSize: 11 }}>Badge</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="badge badge-success" style={{ fontSize: 11 }}>Won</span>
          <span className="badge badge-warning" style={{ fontSize: 11 }}>Pending</span>
          <span className="badge badge-error" style={{ fontSize: 11 }}>Returned</span>
        </div>
      </div>
    </div>
  );
}

export default function AppearanceManager() {
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();   // 'light' | 'dark'
  const mode = theme === 'dark' ? 'dark' : 'light';

  const [companies, setCompanies] = useState([]);
  const [scope, setScope] = useState('global');   // 'global' | '<companyUuid>'
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Keep the editor's own company id in a ref for the unmount cleanup (which
  // must restore THAT company's theme, not whatever scope was last previewed).
  const ownCompanyRef = useRef(user?.company_id || null);
  ownCompanyRef.current = user?.company_id || null;

  const scopeParams = (s) => (s === 'global' ? undefined : { company_id: s });
  const putScope = (s) => (s === 'global' ? 'global' : `company:${s}`);

  // Load companies once for the scope picker.
  useEffect(() => {
    client.get('companies').then(r => setCompanies(r.data?.companies || r.data || [])).catch(() => {});
  }, []);

  // Load the theme for the active scope. Effective value (company override on
  // top of global) seeds the draft; if nothing is saved anywhere, start from
  // the default preset so the editor always has something to show.
  const load = useCallback(async (s) => {
    setLoading(true);
    try {
      const r = await client.get('business-config', { params: scopeParams(s) });
      const saved = r.data?.config?.theme;
      setDraft(saved && saved.light && saved.dark
        ? { preset: saved.preset || DEFAULT_PRESET_ID, light: { ...saved.light }, dark: { ...saved.dark } }
        : themeFromPreset(DEFAULT_PRESET_ID));
    } catch {
      setDraft(themeFromPreset(DEFAULT_PRESET_ID));
      toast.error('Could not load theme');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(scope); }, [scope, load]);

  // Live preview — reflect the draft into the running document (no cache write,
  // so previewing another scope doesn't overwrite the viewer's own theme).
  useEffect(() => {
    if (draft) applyTheme(draft, { cache: false });
  }, [draft]);

  // On unmount, restore the editor's real company theme (or default) with cache
  // so leaving the page doesn't strand a preview.
  useEffect(() => () => {
    const cid = ownCompanyRef.current;
    client.get('business-config', { params: cid ? { company_id: cid } : undefined })
      .then((r) => {
        const t = r.data?.config?.theme;
        if (t && t.light && t.dark) applyTheme(t); else clearTheme();
      })
      .catch(() => {});
  }, []);

  const setField = (key, val) =>
    setDraft((d) => ({ ...d, [mode]: { ...d[mode], [key]: val } }));

  // Remove an optional (semantic/advanced) override so it falls back to derived.
  const clearField = (key) =>
    setDraft((d) => { const m = { ...d[mode] }; delete m[key]; return { ...d, [mode]: m }; });

  const pickPreset = (id) => setDraft(themeFromPreset(id));

  const save = async () => {
    setSaving(true);
    try {
      await client.put('business-config', { scope: putScope(scope), key: 'theme', value: draft });
      // Persist to the viewer's cache too when saving the scope they belong to
      // (or global), so their next load is instantly correct.
      if (scope === 'global' || scope === ownCompanyRef.current) applyTheme(draft, { cache: true });
      toast.success(scope === 'global' ? 'Global theme saved' : 'Company theme saved');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    } finally { setSaving(false); }
  };

  // Company scope: remove the override so it falls back to global/default.
  const removeOverride = async () => {
    if (scope === 'global') return;
    setSaving(true);
    try {
      await client.delete(`business-config/${encodeURIComponent(putScope(scope))}/theme`);
      toast.success('Override removed — using global default');
      await load(scope);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Remove failed');
    } finally { setSaving(false); }
  };

  const resetToPreset = () => pickPreset(draft?.preset || DEFAULT_PRESET_ID);

  if (loading || !draft) {
    return <div className="p-8 text-center"><Loader2 className="inline animate-spin" size={20} /></div>;
  }

  return (
    <div className="space-y-6 w-full">
      {/* Header + actions */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <Palette size={18} /> Appearance &amp; Theme
          </h2>
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            Pick a preset, tweak the colours, preview live — no reload. Saves to the selected scope.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={resetToPreset} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg" style={card}>
            <RotateCcw size={14} /> Reset preset
          </button>
          {scope !== 'global' && (
            <button onClick={removeOverride} disabled={saving} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg" style={card}>
              <Eraser size={14} /> Remove override
            </button>
          )}
          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg text-white" style={{ background: 'var(--color-primary-600)' }}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
          </button>
        </div>
      </div>

      {/* Scope + mode row */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 px-2 py-1 rounded-lg" style={card}>
          {scope === 'global'
            ? <Globe size={15} style={{ color: 'var(--color-text-secondary)' }} />
            : <Building2 size={15} style={{ color: 'var(--color-text-secondary)' }} />}
          <ThemedSelect value={scope} onChange={(e) => setScope(e.target.value)} className="px-2 py-1.5 text-sm rounded-md bg-transparent" style={{ color: 'var(--color-text)' }}>
            <option value="global">Global (all companies)</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </ThemedSelect>
        </div>

        {/* Mode toggle — flips the real app theme so the preview matches. */}
        <div className="flex items-center rounded-lg overflow-hidden" style={card}>
          <button
            onClick={() => mode !== 'light' && toggleTheme()}
            className="flex items-center gap-1.5 px-3 py-2 text-sm"
            style={mode === 'light' ? { background: 'var(--color-primary-600)', color: '#fff' } : { color: 'var(--color-text-secondary)' }}
          >
            <Sun size={14} /> Light
          </button>
          <button
            onClick={() => mode !== 'dark' && toggleTheme()}
            className="flex items-center gap-1.5 px-3 py-2 text-sm"
            style={mode === 'dark' ? { background: 'var(--color-primary-600)', color: '#fff' } : { color: 'var(--color-text-secondary)' }}
          >
            <Moon size={14} /> Dark
          </button>
        </div>
        <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          Editing <strong style={{ color: 'var(--color-text-secondary)' }}>{mode}</strong> palette
        </span>
      </div>

      {/* Preset cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {THEME_PRESETS.map((p) => {
          const c = p[mode];
          const active = draft.preset === p.id;
          return (
            <button
              key={p.id}
              onClick={() => pickPreset(p.id)}
              className="text-left p-3 rounded-xl transition-all"
              style={{ ...card, outline: active ? '2px solid var(--color-primary-500)' : 'none', outlineOffset: 2 }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{p.name}</span>
                {active && <Check size={14} style={{ color: 'var(--color-primary-600)' }} />}
              </div>
              <div className="flex gap-1 mt-2">
                {[c.bg, c.surface, c.primary, c.accent, c.text].map((col, i) => (
                  <span key={i} className="w-full h-6 rounded" style={{ background: col, border: '1px solid var(--color-border)' }} />
                ))}
              </div>
              <div className="text-[11px] mt-2 leading-snug" style={{ color: 'var(--color-text-tertiary)' }}>{p.desc}</div>
            </button>
          );
        })}
      </div>

      {/* Editor + preview */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="p-4 space-y-5" style={card}>
          {/* Core */}
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--color-text-secondary)' }}>
              Core · {mode}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {CORE_TOKENS.map((t) => (
                <Swatch key={t.key} label={t.label} value={draft[mode]?.[t.key]} onChange={(v) => setField(t.key, v)} />
              ))}
            </div>
            <p className="text-[11px] pt-2" style={{ color: 'var(--color-text-tertiary)' }}>
              Everything else (button shades, tables, scrollbars, gradients) is derived from these.
            </p>
          </div>

          {/* Semantic status colours — optional */}
          <div className="pt-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
            <h3 className="text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>
              Status colours
            </h3>
            <p className="text-[11px] mt-1 mb-3" style={{ color: 'var(--color-text-tertiary)' }}>
              Optional — leave untouched to keep the standard success / warning / error / info.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {SEMANTIC_TOKENS.map((t) => {
                const isSet = draft[mode]?.[t.key] !== undefined;
                return (
                  <div key={t.key} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <Swatch label={t.label} value={draft[mode]?.[t.key] ?? t.def} onChange={(v) => setField(t.key, v)} />
                    </div>
                    {isSet && (
                      <button type="button" onClick={() => clearField(t.key)} title="Reset to default"
                        className="text-[10px] px-1.5 py-1 rounded-md flex-shrink-0" style={{ color: 'var(--color-text-tertiary)', border: '1px solid var(--color-border)' }}>reset</button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Advanced — override normally-derived tokens */}
          <div className="pt-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
            <button type="button" onClick={() => setShowAdvanced((s) => !s)}
              className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>
              <ChevronRight size={14} style={{ transform: showAdvanced ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} /> Advanced
            </button>
            {showAdvanced && (
              <>
                <p className="text-[11px] mt-2 mb-3" style={{ color: 'var(--color-text-tertiary)' }}>
                  Fine-tune tokens normally derived from Core. Reset returns a token to auto.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {ADVANCED_TOKENS.map((t) => {
                    const dflt = advancedDefaults(draft[mode] || {}, mode)[t.key];
                    const isSet = draft[mode]?.[t.key] !== undefined;
                    return (
                      <div key={t.key} className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <Swatch label={t.label} value={draft[mode]?.[t.key] ?? dflt} onChange={(v) => setField(t.key, v)} />
                        </div>
                        {isSet && (
                          <button type="button" onClick={() => clearField(t.key)} title="Reset to auto"
                            className="text-[10px] px-1.5 py-1 rounded-md flex-shrink-0" style={{ color: 'var(--color-text-tertiary)', border: '1px solid var(--color-border)' }}>reset</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>Live preview</h3>
          <Preview />
          <p className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
            The whole app is already previewing this theme. Leaving without saving restores your saved theme.
          </p>
        </div>
      </div>
    </div>
  );
}
