// ============================================================================
// supportColors -- the support desk's list colours, set by a superadmin
// (Support Reports -> Colours) and served with GET /support/me.
//
// The colours are DATA, so they cannot live in support.css. This renders one
// <style> element from them; every screen under .sx then uses plain class
// names and never has to know a hex value:
//
//   sx-oc-<outcome key>   a row / swatch / dropdown for a call outcome
//   cs-<case status>      the status pill and the Retention box
//   sx-tone-saved         a Saved case's row      (lighter mix of its colour)
//   sx-tone-progress      an In Progress row with no outcome colour
//
// Text flips to white on a dark colour, so an admin cannot pick an unreadable
// combination.
// ============================================================================
const HEX = /^#[0-9a-f]{6}$/i;

// Black or white, whichever reads on this background (WCAG relative luminance).
export const inkFor = (hex) => {
  if (!HEX.test(hex || '')) return '#111111';
  const ch = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  return lum > 0.4 ? '#111111' : '#ffffff';
};

export const buildColorCss = (colors) => {
  if (!colors) return '';
  const out = [];
  // Status rows first: an outcome rule has the same specificity and must come
  // LATER to win on an In Progress row (see caseRowTone).
  const row = (cls, c) => HEX.test(c || '') && out.push(`.sx-grid tbody tr.${cls} td{background:color-mix(in srgb,${c} 55%,#fff)}`);
  row('sx-tone-saved', colors.status?.saved);
  row('sx-tone-progress', colors.status?.open);
  Object.entries(colors.outcomes || {}).forEach(([k, c]) => {
    if (!HEX.test(c) || !/^[a-z0-9_]+$/.test(k)) return;
    const ink = inkFor(c);
    out.push(`.sx-grid tbody tr.sx-oc-${k} td{background:${c};color:${ink}}`);
    out.push(`.sx-grid tbody tr.sx-oc-${k} .sx-link{color:${ink}}`);
    out.push(`.sx-swatch i.sx-oc-${k}{background:${c}}`);
    out.push(`.sx select.sx-oc-${k}{background-color:${c};color:${ink}}`);
  });
  Object.entries(colors.status || {}).forEach(([k, c]) => {
    if (!HEX.test(c) || !/^[a-z]+$/.test(k)) return;
    const ink = inkFor(c);
    out.push(`.sx .sx-pill.cs-${k}{background:${c};border-color:color-mix(in srgb,${c} 65%,#000);color:${ink};font-weight:600}`);
    out.push(`.sx .sx-val.cs-${k}{background:${c};border-color:color-mix(in srgb,${c} 65%,#000);color:${ink}}`);
    out.push(`.sx-swatch i.cs-${k}{background:${c}}`);
  });
  return out.join('\n');
};

export default function SupportColorStyle({ colors }) {
  const css = buildColorCss(colors);
  return css ? <style>{css}</style> : null;
}
