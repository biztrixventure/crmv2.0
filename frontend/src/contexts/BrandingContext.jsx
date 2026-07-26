// ============================================================================
// BrandingContext — the ONE source of the CRM's name and logo in the UI.
//
// Branding was already configurable (Admin → Branding & SEO writes site_name,
// logo_url, tab_title, …) but utils/branding.js only pushed it into the browser
// tab title and <meta>. Every in-app surface still said "BizTrix CRM" as a
// string literal, so renaming the product in the admin changed the tab and
// nothing the user actually looks at.
//
// This fetches the PUBLIC /api/branding once and exposes it app-wide, so the
// header, the sidebar, and the signed-out pages (login, forgot/reset password,
// accept invite) all render the configured name. `refresh()` lets the Branding
// editor re-read after a save so the rename lands without a reload.
//
// Fails soft on purpose: if the request fails, `siteName` falls back to the
// default so the shell never renders a blank brand.
// ============================================================================
import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { fetchBranding, applyBranding } from '../utils/branding';

const DEFAULT_NAME = 'BizTrix CRM';

const BrandingContext = createContext({
  branding: null,
  siteName: DEFAULT_NAME,
  logoUrl: null,
  loading: true,
  refresh: () => {},
});

export function BrandingProvider({ children }) {
  const [branding, setBranding] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const b = await fetchBranding();
      setBranding(b);
      applyBranding(b);          // keep tab title / favicon / meta in sync too
    } catch {
      /* public endpoint, but never let branding break the app shell */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const value = useMemo(() => ({
    branding,
    // site_name is the "Site / Brand name" field in Branding & SEO.
    siteName: (branding?.site_name || '').trim() || DEFAULT_NAME,
    logoUrl: branding?.logo_url || null,
    loading,
    refresh: load,
  }), [branding, loading, load]);

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding() {
  return useContext(BrandingContext);
}

// Split a brand name into [head, tail] so the signed-out pages can keep their
// two-tone wordmark ("BizTrix" + accented "CRM") with a configurable name.
// A single-word name returns an empty tail and simply renders plain — the
// accent is a nicety, not something worth mangling someone's brand over.
export function splitBrandName(name) {
  const parts = String(name || '').trim().split(/\s+/);
  if (parts.length < 2) return [parts[0] || '', ''];
  return [parts.slice(0, -1).join(' '), parts[parts.length - 1]];
}

export default BrandingContext;
