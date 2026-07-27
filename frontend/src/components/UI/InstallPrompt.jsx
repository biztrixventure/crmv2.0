import { useState, useEffect, useCallback } from 'react';
import { Download, X, Smartphone } from 'lucide-react';
import { canInstall, subscribeInstall, promptInstall, isInstallDismissed, dismissInstall, getFlags, loadFlags } from '../../utils/pwa';
import { useBranding } from '../../contexts/BrandingContext';
import { useAuth } from '../../contexts/AuthContext';

// ============================================================================
// InstallPrompt — the app's own install affordance.
//
// It appears only when the browser has already offered one. `beforeinstallprompt`
// fires when the browser has decided the app is installable (manifest, icons,
// a worker, HTTPS, engagement heuristics), so this can never be a button that
// looks available and then does nothing. If the event never fires, nothing
// renders. Already installed, or dismissed within the last month: nothing
// renders either.
//
// Deliberately not a modal. Installing is optional and this is a CRM someone is
// working in; a dialog would interrupt a task to advertise a convenience.
// ============================================================================
export default function InstallPrompt() {
  const { siteName } = useBranding();
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  const role = user?.role;

  const sync = useCallback(() => {
    const flags = getFlags();
    // Until the config lands, show nothing. An affordance that flashes in and
    // then disappears once the answer arrives is worse than one that waits.
    const audienceOk = flags ? (flags.install_audience !== 'superadmin' || role === 'superadmin') : false;
    setVisible(audienceOk && canInstall() && !isInstallDismissed());
  }, [role]);

  useEffect(() => {
    loadFlags().then(sync);
    sync();
    return subscribeInstall(sync);
  }, [sync]);

  if (!visible) return null;

  const install = async () => {
    setBusy(true);
    const outcome = await promptInstall();
    setBusy(false);
    // 'dismissed' is an answer, not a failure — remember it, or the bar returns
    // on the next render and asks again.
    if (outcome !== 'accepted') dismissInstall();
    sync();
  };

  return (
    <div
      className="fixed z-[9998] left-3 right-3 bottom-3 sm:left-auto sm:right-4 sm:bottom-4 sm:w-[340px] rounded-2xl p-3.5"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-lg)',
        // Keeps the bar clear of the home indicator on a phone.
        marginBottom: 'env(safe-area-inset-bottom)',
      }}
      role="dialog"
      aria-label="Install app"
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--gradient-sidebar)' }}>
          <Smartphone size={17} className="text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            Install {siteName || 'the CRM'}
          </div>
          <p className="text-[11px] m-0 mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            Opens in its own window, launches from your home screen, and keeps working through a dropped connection.
          </p>
          <div className="flex items-center gap-2 mt-2.5">
            <button type="button" onClick={install} disabled={busy}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-60"
              style={{ background: 'var(--color-primary-600)' }}>
              <Download size={12} className="inline mr-1" /> {busy ? 'Opening…' : 'Install'}
            </button>
            <button type="button" onClick={() => { dismissInstall(); sync(); }}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={{ color: 'var(--color-text-secondary)' }}>
              Not now
            </button>
          </div>
        </div>
        {/* 44px touch target below sm, per the responsive pass. */}
        <button type="button" aria-label="Dismiss" onClick={() => { dismissInstall(); sync(); }}
          className="w-11 h-11 sm:w-8 sm:h-8 -mt-1.5 -mr-1.5 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ color: 'var(--color-text-tertiary)' }}>
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
