import { useRef, useState } from 'react';
import { Upload, Image as ImageIcon, Smartphone, Info } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../../api/client';
import { Panel, SectionHeader, Field, Loading } from '../../UI/kit';
import ThemedSelect from '../../UI/Select';

// ============================================================================
// Install & Manifest — everything the browser reads when someone installs the
// app. Every field is optional: an empty value falls back to Branding & SEO
// server-side, which is why the preview computes the SAME fallbacks instead of
// showing a blank. One place to rename the product, not two.
//
// The fallback rules below MIRROR publicManifest() in backend/routes/pwa.js.
// If that changes, change this — a preview that disagrees with the artefact is
// worse than no preview at all.
// ============================================================================

const DISPLAY = [
  { v: 'standalone', label: 'Standalone — own window, no browser UI' },
  { v: 'fullscreen', label: 'Fullscreen — no OS chrome either' },
  { v: 'minimal-ui', label: 'Minimal UI — a thin back/reload bar' },
  { v: 'browser',    label: 'Browser — opens as a normal tab' },
];

const ORIENTATION = [
  { v: 'any',               label: 'Any — follow the device' },
  { v: 'portrait',          label: 'Portrait' },
  { v: 'landscape',         label: 'Landscape' },
  { v: 'portrait-primary',  label: 'Portrait (primary only)' },
  { v: 'landscape-primary', label: 'Landscape (primary only)' },
];

const inputStyle = { background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' };
const INPUT = 'w-full min-w-0 px-3 py-2 text-sm rounded-lg';

const toDataUrl = (file) => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file);
});

// Icon upload goes through the EXISTING branding upload endpoint and its public
// bucket, because a manifest icon must be fetchable before anyone signs in —
// exactly like the favicon. A second storage path would buy nothing.
function IconField({ label, hint, kind, value, onChange, size }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);

  const pick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('Image must be under 5 MB'); return; }
    setBusy(true);
    try {
      const dataUrl = await toDataUrl(file);
      const r = await client.post('branding/upload', { kind, content_type: file.type, data_base64: dataUrl });
      onChange(r.data.url);
      toast.success(`${label} uploaded`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Upload failed');
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = '';
    }
  };

  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center overflow-hidden flex-shrink-0"
          style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
          {value
            ? <img src={value} alt="" className="max-w-full max-h-full object-contain" />
            : <ImageIcon size={16} style={{ color: 'var(--color-text-muted)' }} />}
        </div>
        {/* min-w-0 on the input ITSELF: an <input> keeps an intrinsic ~20ch
            minimum that w-full does not override — the exact thing that pushed
            the Branding panel past a 390px viewport. */}
        <div className="flex-1 min-w-0">
          <input value={value || ''} onChange={e => onChange(e.target.value)}
            placeholder={`https://…  ${size} PNG`} className={INPUT} style={inputStyle} />
        </div>
        <button type="button" onClick={() => ref.current?.click()} disabled={busy}
          className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg flex-shrink-0"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
          {busy ? <Loading variant="inline" size={14} /> : <Upload size={14} />} Upload
        </button>
        <input ref={ref} type="file" accept="image/png,image/svg+xml,image/webp" onChange={pick} className="hidden" />
      </div>
    </Field>
  );
}

export default function InstallSection({ install, branding = {}, onChange }) {
  const set = (k) => (e) => onChange(k, e?.target ? e.target.value : e);

  // Same resolution order as publicManifest().
  const siteName   = branding.site_name || 'BizTrix CRM';
  const name       = install.name || siteName;
  const shortName  = install.short_name || (branding.site_name || 'BizTrix').split(' ')[0];
  const desc       = install.description || branding.meta_description || '';
  const themeColor = install.theme_color || branding.theme_color || '#6E5838';
  const icon       = install.icon_512 || install.icon_192 || install.icon_maskable || branding.favicon_url || '/favicon.svg';

  let host = '';
  try { host = window.location.host; } catch { host = ''; }

  const usingFallback = !install.name || !install.short_name || !install.theme_color;

  return (
    <div className="grid lg:grid-cols-2 gap-5 items-start">
      {/* ── Identity ─────────────────────────────────────────────────────── */}
      <div className="space-y-5 min-w-0">
        <Panel pad="lg">
          <SectionHeader icon={Smartphone} title="App identity"
            subtitle="Leave a field empty to inherit it from Branding & SEO." />
          <div className="space-y-4">
            <Field label="App name" hint={`Full name on the install prompt. Empty → “${siteName}”.`}>
              <input value={install.name || ''} onChange={set('name')} placeholder={siteName}
                className={INPUT} style={inputStyle} />
            </Field>
            <Field label="Short name" hint={`Under the home-screen icon — about 12 characters before it truncates. Empty → “${shortName}”.`}>
              <input value={install.short_name || ''} onChange={set('short_name')} placeholder={shortName}
                className={INPUT} style={inputStyle} />
            </Field>
            <Field label="Description" hint="Shown by some install sheets and app listings.">
              <textarea value={install.description || ''} onChange={set('description')} rows={2}
                placeholder={branding.meta_description || ''} className={INPUT} style={inputStyle} />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Theme colour" hint="Tints the title bar of the installed window.">
                <div className="flex items-center gap-2">
                  <input type="color" value={themeColor} onChange={set('theme_color')}
                    className="w-10 h-9 rounded flex-shrink-0" style={{ border: '1px solid var(--color-border)' }} />
                  <input value={install.theme_color || ''} onChange={set('theme_color')} placeholder={branding.theme_color || 'inherit'}
                    className={`${INPUT} font-mono`} style={inputStyle} />
                </div>
              </Field>
              <Field label="Background colour" hint="The splash screen while the app boots.">
                <div className="flex items-center gap-2">
                  <input type="color" value={install.background_color || '#0B1F1A'} onChange={set('background_color')}
                    className="w-10 h-9 rounded flex-shrink-0" style={{ border: '1px solid var(--color-border)' }} />
                  <input value={install.background_color || ''} onChange={set('background_color')}
                    className={`${INPUT} font-mono`} style={inputStyle} />
                </div>
              </Field>
            </div>
          </div>
        </Panel>

        <Panel pad="lg">
          <SectionHeader icon={Info} title="Window & entry point" />
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Display mode">
                <ThemedSelect value={install.display || 'standalone'} onChange={set('display')}
                  className={INPUT} style={inputStyle}>
                  {DISPLAY.map(d => <option key={d.v} value={d.v}>{d.label}</option>)}
                </ThemedSelect>
              </Field>
              <Field label="Orientation">
                <ThemedSelect value={install.orientation || 'any'} onChange={set('orientation')}
                  className={INPUT} style={inputStyle}>
                  {ORIENTATION.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                </ThemedSelect>
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Start URL" hint="Where a tap on the icon lands. /dashboard redirects by role.">
                <input value={install.start_url || ''} onChange={set('start_url')} placeholder="/dashboard"
                  className={`${INPUT} font-mono`} style={inputStyle} />
              </Field>
              <Field label="Scope" hint="The paths the installed app owns. Keep it / unless you know why not.">
                <input value={install.scope || ''} onChange={set('scope')} placeholder="/"
                  className={`${INPUT} font-mono`} style={inputStyle} />
              </Field>
            </div>
          </div>
        </Panel>

        <Panel pad="lg">
          <SectionHeader icon={ImageIcon} title="Icons"
            subtitle="Square PNG. Without at least one, a browser will not offer to install." />
          <div className="space-y-4">
            <IconField label="Icon 192" size="192×192" kind="pwa_192"
              hint="The everyday icon — home screen, task switcher."
              value={install.icon_192} onChange={v => onChange('icon_192', v)} />
            <IconField label="Icon 512" size="512×512" kind="pwa_512"
              hint="Splash screen and high-density displays."
              value={install.icon_512} onChange={v => onChange('icon_512', v)} />
            <IconField label="Maskable icon" size="512×512" kind="pwa_maskable"
              hint="Android crops this to its own shape — keep the artwork inside the middle 80%, on a filled background."
              value={install.icon_maskable} onChange={v => onChange('icon_maskable', v)} />
          </div>
        </Panel>
      </div>

      {/* ── Live preview ─────────────────────────────────────────────────── */}
      {/* min-w-0 on the column: the mocks contain truncating text, whose
          min-content is the whole string, so without it the grid track refuses
          to narrow and takes the page with it. */}
      <div className="min-w-0 lg:sticky lg:top-4 space-y-5">
        <Panel pad="lg">
          <SectionHeader icon={Smartphone} title="Install preview"
            subtitle="How the app is offered, and how it lands on a home screen." />

          {/* The browser install sheet */}
          <div className="rounded-2xl overflow-hidden mb-5"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-md)' }}>
            <div className="px-4 py-3 flex items-center gap-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <div className="w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                <img src={icon} alt="" className="max-w-full max-h-full object-contain" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>
                  Install {name}?
                </div>
                <div className="text-[11px] truncate leading-none mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                  {host}
                </div>
              </div>
            </div>
            <div className="px-4 py-3">
              <p className="text-xs m-0 line-clamp-2" style={{ color: 'var(--color-text-secondary)' }}>
                {desc || 'No description set — the sheet shows only the name and the origin.'}
              </p>
              <div className="flex items-center justify-end gap-2 mt-3">
                <span className="text-xs font-semibold px-3 py-1.5 rounded-lg"
                  style={{ color: 'var(--color-text-secondary)' }}>Cancel</span>
                <span className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white"
                  style={{ background: 'var(--color-primary-600)' }}>Install</span>
              </div>
            </div>
          </div>

          {/* Home screen + splash */}
          <div className="grid grid-cols-2 gap-4">
            <div className="min-w-0">
              <div className="text-[11px] sm:text-[10px] font-bold uppercase tracking-wider leading-none mb-2"
                style={{ color: 'var(--color-text-secondary)' }}>Home screen</div>
              <div className="rounded-2xl p-4 flex flex-col items-center justify-center gap-2"
                style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', minHeight: 118 }}>
                <div className="w-14 h-14 rounded-2xl overflow-hidden flex items-center justify-center"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
                  <img src={icon} alt="" className="max-w-full max-h-full object-contain" />
                </div>
                <span className="text-[11px] leading-none text-center max-w-full truncate"
                  style={{ color: 'var(--color-text)' }}>{shortName}</span>
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-[11px] sm:text-[10px] font-bold uppercase tracking-wider leading-none mb-2"
                style={{ color: 'var(--color-text-secondary)' }}>Splash</div>
              {/* The one place a literal colour is correct: these two values ARE
                  the configured ones, and the point of the swatch is to show
                  them as the OS will paint them, not as the theme would. */}
              <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--color-border)', minHeight: 118 }}>
                <div style={{ background: themeColor, height: 18 }} />
                <div className="flex flex-col items-center justify-center gap-2 py-4"
                  style={{ background: install.background_color || '#0B1F1A', minHeight: 98 }}>
                  <div className="w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center">
                    <img src={icon} alt="" className="max-w-full max-h-full object-contain" />
                  </div>
                  <span className="text-[11px] leading-none truncate max-w-full px-2"
                    style={{ color: '#FFFFFF', opacity: 0.85 }}>{name}</span>
                </div>
              </div>
            </div>
          </div>

          {usingFallback && (
            <p className="text-[11px] m-0 mt-4" style={{ color: 'var(--color-text-tertiary)' }}>
              Anything you left blank is shown here inherited from Branding &amp; SEO — which is exactly what the
              served manifest does.
            </p>
          )}
          <p className="text-[11px] m-0 mt-2" style={{ color: 'var(--color-text-tertiary)' }}>
            Approximate — every browser styles its install prompt differently. The live manifest is at{' '}
            <a href="/manifest.webmanifest" target="_blank" rel="noreferrer" className="font-mono"
              style={{ color: 'var(--color-primary-600)' }}>/manifest.webmanifest</a>{' '}
            and changes the moment you save.
          </p>
        </Panel>
      </div>
    </div>
  );
}
