// Presentational scrolling marquee strip (CSS-only, no extra package).
// Used by the superadmin manager preview and the live MarqueeBanner.
const SPEED_SECONDS = { slow: 30, normal: 18, fast: 10 };

// Inject the keyframes once.
if (typeof document !== 'undefined' && !document.getElementById('bsx-marquee-kf')) {
  const s = document.createElement('style');
  s.id = 'bsx-marquee-kf';
  s.textContent = '@keyframes bsx-marquee{0%{transform:translateX(0)}100%{transform:translateX(-100%)}}';
  document.head.appendChild(s);
}

const MarqueeStrip = ({ item }) => {
  if (!item) return null;
  const dur = SPEED_SECONDS[item.speed] || 18;
  return (
    <div className="flex items-center gap-3 px-4 py-1.5 overflow-hidden" style={{ backgroundColor: item.bg_color || '#1e40af', color: item.text_color || '#ffffff' }}>
      <span className="font-extrabold text-sm whitespace-nowrap flex-shrink-0 tracking-wide">{item.byline}</span>
      <div className="relative flex-1 overflow-hidden">
        <div className="text-sm font-medium" style={{ display: 'inline-block', whiteSpace: 'nowrap', paddingLeft: '100%', animation: `bsx-marquee ${dur}s linear infinite` }}>
          {item.content}
        </div>
      </div>
    </div>
  );
};

export default MarqueeStrip;
