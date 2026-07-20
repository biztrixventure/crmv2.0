import { useState, useEffect, useCallback, useRef } from 'react';
import { Save, Upload, Loader2, Image as ImageIcon, Globe, RefreshCw, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../../api/client';
import { applyBranding } from '../../../utils/branding';
import ThemedSelect from '../../UI/Select';

// White-label branding + SEO + social link-preview (Open Graph) editor.
// Values persist to business_config global `branding`; images upload to the
// public `branding` Supabase Storage bucket. The frontend server injects these
// into served HTML so real link previews work; applyBranding() reflects text
// changes into the current tab immediately after save.
const toDataUrl = (file) => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file);
});

const card = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12 };
const inputStyle = { background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' };

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{label}</span>
      {hint && <span className="block text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>{hint}</span>}
      <div className={hint ? '' : 'mt-1'}>{children}</div>
    </label>
  );
}

function ImageField({ label, hint, kind, value, onChange }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const pick = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('Image must be under 5 MB'); return; }
    setBusy(true);
    try {
      const dataUrl = await toDataUrl(file);
      const r = await client.post('branding/upload', { kind, content_type: file.type, data_base64: dataUrl });
      onChange(r.data.url);
      toast.success(`${label} uploaded`);
    } catch (err) { toast.error(err.response?.data?.error || 'Upload failed'); }
    finally { setBusy(false); if (ref.current) ref.current.value = ''; }
  };
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-3">
        <div className="w-14 h-14 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
          {value ? <img src={value} alt="" className="max-w-full max-h-full object-contain" /> : <ImageIcon size={18} style={{ color: 'var(--color-text-muted)' }} />}
        </div>
        <div className="flex-1 min-w-0">
          <input value={value || ''} onChange={e => onChange(e.target.value)} placeholder="https://…  or upload →"
            className="w-full px-3 py-2 text-sm rounded-lg" style={inputStyle} />
        </div>
        <button type="button" onClick={() => ref.current?.click()} disabled={busy}
          className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg flex-shrink-0" style={card}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Upload
        </button>
        <input ref={ref} type="file" accept="image/png,image/jpeg,image/svg+xml,image/x-icon,image/webp,image/gif" onChange={pick} className="hidden" />
      </div>
    </Field>
  );
}

export default function BrandingManager() {
  const [b, setB] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await client.get('branding'); setB(r.data.branding); }
    catch { toast.error('Could not load branding'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = (k) => (v) => setB(prev => ({ ...prev, [k]: v?.target ? v.target.value : v }));

  const save = async () => {
    setSaving(true);
    try {
      const r = await client.put('branding', b);
      setB(r.data.branding);
      applyBranding(r.data.branding);          // reflect into the current tab now
      toast.success('Branding saved — live within ~60s for shared links');
    } catch (err) { toast.error(err.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  if (loading || !b) return <div className="p-8 text-center"><Loader2 className="inline animate-spin" size={20} /></div>;

  const previewTitle = b.og_title || b.tab_title || b.site_name || 'Your CRM';
  const previewDesc = b.og_description || b.meta_description || '';
  let previewHost = '';
  try { previewHost = b.og_url ? new URL(b.og_url).host : window.location.host; } catch { previewHost = window.location.host; }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}><Globe size={18} /> Branding &amp; SEO</h2>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Name, favicon, meta tags, and the image/title shown when a link to your CRM is shared.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg" style={card}><RefreshCw size={14} /> Reload</button>
          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg text-white" style={{ background: 'var(--color-primary-600, #6E5838)' }}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
          </button>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* ── Identity + SEO ── */}
        <div className="p-4 space-y-4" style={card}>
          <h3 className="text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>Identity &amp; SEO</h3>
          <Field label="Site / Brand name"><input value={b.site_name || ''} onChange={set('site_name')} className="w-full px-3 py-2 text-sm rounded-lg" style={inputStyle} /></Field>
          <Field label="Browser tab title" hint="Shown in the browser tab and as the default page title."><input value={b.tab_title || ''} onChange={set('tab_title')} className="w-full px-3 py-2 text-sm rounded-lg" style={inputStyle} /></Field>
          <Field label="Meta description" hint="Used by search engines and as the fallback link-preview text."><textarea value={b.meta_description || ''} onChange={set('meta_description')} rows={2} className="w-full px-3 py-2 text-sm rounded-lg" style={inputStyle} /></Field>
          <Field label="Meta keywords" hint="Comma-separated (optional)."><input value={b.meta_keywords || ''} onChange={set('meta_keywords')} className="w-full px-3 py-2 text-sm rounded-lg" style={inputStyle} /></Field>
          <Field label="Theme color" hint="Browser UI tint on mobile.">
            <div className="flex items-center gap-2">
              <input type="color" value={b.theme_color || '#6E5838'} onChange={set('theme_color')} className="w-10 h-9 rounded" style={{ border: '1px solid var(--color-border)' }} />
              <input value={b.theme_color || ''} onChange={set('theme_color')} className="flex-1 px-3 py-2 text-sm rounded-lg font-mono" style={inputStyle} />
            </div>
          </Field>
          <ImageField label="Favicon" hint="Tab icon. PNG/SVG/ICO." kind="favicon" value={b.favicon_url} onChange={set('favicon_url')} />
          <ImageField label="Logo" hint="Optional brand logo (used in-app where supported)." kind="logo" value={b.logo_url} onChange={set('logo_url')} />
        </div>

        {/* ── Social preview ── */}
        <div className="space-y-6">
          <div className="p-4 space-y-4" style={card}>
            <h3 className="text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>Social link preview (Open Graph)</h3>
            <ImageField label="Preview image" hint="Shown when a link is shared. 1200×630 recommended." kind="og_image" value={b.og_image_url} onChange={set('og_image_url')} />
            <Field label="Preview title" hint="Falls back to the tab title."><input value={b.og_title || ''} onChange={set('og_title')} className="w-full px-3 py-2 text-sm rounded-lg" style={inputStyle} /></Field>
            <Field label="Preview description" hint="Falls back to the meta description."><textarea value={b.og_description || ''} onChange={set('og_description')} rows={2} className="w-full px-3 py-2 text-sm rounded-lg" style={inputStyle} /></Field>
            <Field label="Canonical URL" hint="e.g. https://crm.yourdomain.com"><input value={b.og_url || ''} onChange={set('og_url')} className="w-full px-3 py-2 text-sm rounded-lg" style={inputStyle} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Twitter card">
                <ThemedSelect value={b.twitter_card || 'summary_large_image'} onChange={set('twitter_card')} className="w-full px-3 py-2 text-sm rounded-lg" style={inputStyle}>
                  <option value="summary_large_image">Large image</option>
                  <option value="summary">Small</option>
                </ThemedSelect>
              </Field>
              <Field label="Twitter @handle"><input value={b.twitter_site || ''} onChange={set('twitter_site')} placeholder="@yourbrand" className="w-full px-3 py-2 text-sm rounded-lg" style={inputStyle} /></Field>
            </div>
          </div>

          {/* Live preview mockup */}
          <div className="p-4" style={card}>
            <h3 className="text-sm font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--color-text-muted)' }}>Preview</h3>
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              <div className="w-full flex items-center justify-center" style={{ aspectRatio: '1200 / 630', background: 'var(--color-bg)' }}>
                {b.og_image_url
                  ? <img src={b.og_image_url} alt="" className="w-full h-full object-cover" />
                  : <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}><ImageIcon size={20} className="inline mr-1" /> No preview image</span>}
              </div>
              <div className="p-3" style={{ background: 'var(--color-surface-hover)' }}>
                <div className="text-[11px] uppercase flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}><Link2 size={10} /> {previewHost}</div>
                <div className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{previewTitle}</div>
                <div className="text-xs line-clamp-2" style={{ color: 'var(--color-text-muted)' }}>{previewDesc}</div>
              </div>
            </div>
            <p className="text-[11px] mt-2" style={{ color: 'var(--color-text-muted)' }}>Approximate — each platform styles previews slightly differently. Cached ~60s after save.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
