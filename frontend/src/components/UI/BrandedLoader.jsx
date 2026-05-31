import { useEffect, useState } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';

// BrandedLoader — full-page splash with the active company's logo at center,
// wrapped by orbiting particles + a counter-rotating ring. The logo picks
// up the per-theme variant when the company has one configured (light_logo
// in light mode, dark_logo in dark mode) and falls back to the default
// logo_url so older companies still see a brand mark instead of nothing.
//
// Used as the Suspense fallback in App.jsx so the loader appears on every
// lazy-loaded shell load + the post-login redirect.
const BrandedLoader = ({ message = 'Loading…' }) => {
  const { theme } = useTheme();
  const { user }  = useAuth();
  const isDark    = theme === 'dark';

  // Pick the logo per theme. /auth/me flattens these fields, so they sit on
  // user directly. On first paint (before /auth/me lands) we fall through
  // gracefully to a generic 'B' wordmark.
  const logo = (isDark
    ? user?.company_logo_dark_url
    : user?.company_logo_light_url)
    || user?.company_logo_url
    || null;

  // Orbit particles — fixed count + per-particle phase so the rotation
  // looks organic, not metronome-uniform.
  const particles = Array.from({ length: 8 }, (_, i) => ({
    i,
    angle: (i / 8) * 360,
    delay: (i / 8) * 1.5,
  }));

  // Slight delay before fading in so a sub-100ms route swap doesn't flash
  // the loader at all (avoids the "loader flicker" anti-pattern on a snappy
  // navigation).
  const [show, setShow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setShow(true), 90);
    return () => clearTimeout(id);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center transition-opacity"
      style={{
        background: isDark
          ? 'radial-gradient(circle at 50% 50%, #1a1f3a 0%, #050818 100%)'
          : 'radial-gradient(circle at 50% 50%, #ffffff 0%, #e9f5ff 100%)',
        opacity: show ? 1 : 0,
      }}>

      <div className="relative" style={{ width: 220, height: 220 }}>

        {/* Counter-rotating outer ring */}
        <svg className="absolute inset-0" viewBox="0 0 220 220" aria-hidden="true">
          <defs>
            <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%"   stopColor={isDark ? '#7b6cff' : '#6b48ff'} stopOpacity="0.9" />
              <stop offset="50%"  stopColor={isDark ? '#ff8a5b' : '#ff7043'} stopOpacity="0.7" />
              <stop offset="100%" stopColor={isDark ? '#7b6cff' : '#6b48ff'} stopOpacity="0.9" />
            </linearGradient>
          </defs>
          <circle cx="110" cy="110" r="100"
            fill="none" stroke="url(#ringGrad)" strokeWidth="2"
            strokeDasharray="180 100"
            style={{ transformOrigin: '110px 110px', animation: 'bl-spin-cw 4s linear infinite' }} />
          <circle cx="110" cy="110" r="85"
            fill="none" stroke={isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'} strokeWidth="1" strokeDasharray="4 6" />
        </svg>

        {/* Inner counter-rotating dashed arc */}
        <svg className="absolute inset-0" viewBox="0 0 220 220" aria-hidden="true">
          <circle cx="110" cy="110" r="70"
            fill="none"
            stroke={isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.3)'}
            strokeWidth="1.5" strokeDasharray="2 10"
            style={{ transformOrigin: '110px 110px', animation: 'bl-spin-ccw 6s linear infinite' }} />
        </svg>

        {/* Orbiting particles — each rotates around the logo at the same radius
            but with a different starting angle, so the ring looks continuous. */}
        {particles.map(p => (
          <div key={p.i} className="absolute"
            style={{
              left: '50%', top: '50%',
              width: 8, height: 8,
              marginLeft: -4, marginTop: -4,
              transformOrigin: '0 0',
              animation: `bl-orbit 3s linear infinite`,
              animationDelay: `${-p.delay}s`,
            }}>
            <span className="block w-full h-full rounded-full"
              style={{
                background: isDark
                  ? 'radial-gradient(circle, #ff8a5b 0%, transparent 70%)'
                  : 'radial-gradient(circle, #6b48ff 0%, transparent 70%)',
                boxShadow: isDark ? '0 0 8px #ff8a5b' : '0 0 8px #6b48ff',
              }} />
          </div>
        ))}

        {/* Logo plate — soft glass card so the logo reads against either theme.
            Subtle parallax: card breathes on the same period as the inner ring. */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center rounded-2xl"
          style={{
            width: 120, height: 120,
            backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.7)',
            backdropFilter: 'blur(12px)',
            border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)'}`,
            boxShadow: isDark
              ? '0 8px 32px rgba(123,108,255,0.3), inset 0 0 24px rgba(255,138,91,0.1)'
              : '0 8px 32px rgba(107,72,255,0.18), inset 0 0 24px rgba(255,112,67,0.06)',
            animation: 'bl-breathe 3s ease-in-out infinite',
          }}>
          {logo ? (
            <img src={logo} alt="" className="max-w-[78%] max-h-[78%] object-contain"
              onError={e => { e.target.style.display = 'none'; }} />
          ) : (
            // Fallback wordmark — matches the AdminSidebar footer brand block.
            <span style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 800, fontSize: 48,
              background: 'var(--gradient-sidebar)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>B</span>
          )}
        </div>
      </div>

      {/* Status line */}
      <p className="absolute" style={{
        bottom: '20%',
        fontSize: 13, fontWeight: 500,
        color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)',
        letterSpacing: '0.15em', textTransform: 'uppercase',
      }}>
        {message}
      </p>

      <style>{`
        @keyframes bl-spin-cw  { to { transform: rotate(360deg); } }
        @keyframes bl-spin-ccw { to { transform: rotate(-360deg); } }
        @keyframes bl-orbit {
          0%   { transform: rotate(0deg)   translateX(98px) rotate(0deg); }
          100% { transform: rotate(360deg) translateX(98px) rotate(-360deg); }
        }
        @keyframes bl-breathe {
          0%, 100% { transform: translate(-50%, -50%) scale(1);    }
          50%      { transform: translate(-50%, -50%) scale(1.04); }
        }
      `}</style>
    </div>
  );
};

export default BrandedLoader;
