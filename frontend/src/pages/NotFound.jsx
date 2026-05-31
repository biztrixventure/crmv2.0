import React, { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { Home, ArrowLeft } from "lucide-react";
import DevCredit from "../components/DevCredit";
import { useTheme } from "../contexts/ThemeContext";

// 404 — animated scene with a UFO abducting the second "0", a parallax tree
// silhouette, lightning flashes, twinkling stars, and a moon-or-sun in the
// sky depending on the active theme. All effects are CSS-driven so there's
// no JS animation loop running on mount; the page stays cheap even left open.
const NotFound = () => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  // Render 60 stars at stable positions per mount. Twinkle delays are
  // randomized once and memoized so re-renders don't kick the animation.
  const stars = useMemo(() => Array.from({ length: 60 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: Math.random() * 65,                // keep them in the upper sky band
    size: Math.random() < 0.85 ? 1.5 : 2.5,
    delay: Math.random() * 4,
    duration: 2 + Math.random() * 3,
  })), []);

  // Trees scattered across the foreground at stable horizontal positions and
  // depths. `z` drives both horizontal sway speed and apparent scale, giving
  // a faint parallax feel without a true scroll listener.
  const trees = useMemo(() => [
    { x: 4,  z: 0.5, h: 70 }, { x: 12, z: 0.7, h: 95 },
    { x: 22, z: 0.9, h: 120 }, { x: 35, z: 0.6, h: 80 },
    { x: 58, z: 0.8, h: 105 }, { x: 70, z: 1.0, h: 130 },
    { x: 84, z: 0.7, h: 90 },  { x: 94, z: 0.5, h: 65 },
  ], []);

  // Lightning fires at 8s + 11s offsets so the two bolts don't ever overlap.
  const [bolt, setBolt] = useState(false);
  useEffect(() => {
    let n = 0;
    const tick = () => {
      n++;
      setBolt(true);
      setTimeout(() => setBolt(false), 220);
    };
    const id = setInterval(tick, 8500);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="min-h-screen relative overflow-hidden flex flex-col items-center justify-center px-4"
      style={{
        background: isDark
          ? 'linear-gradient(180deg, #050818 0%, #0d1330 55%, #1a1245 100%)'
          : 'linear-gradient(180deg, #b9e3ff 0%, #e9f5ff 55%, #ffd8b9 100%)',
        color: isDark ? '#e9ecf8' : '#1a1f3a',
      }}>

      {/* Twinkling stars (only meaningful at night, but kept faint by day so the
          dawn gradient gets a touch of sparkle near the horizon). */}
      <div className="absolute inset-0 pointer-events-none">
        {stars.map(s => (
          <span key={s.id} className="absolute rounded-full"
            style={{
              left: `${s.x}%`,
              top: `${s.y}%`,
              width: s.size,
              height: s.size,
              backgroundColor: isDark ? '#ffffff' : '#ffd166',
              opacity: isDark ? 0.9 : 0.5,
              animation: `nf-twinkle ${s.duration}s ease-in-out ${s.delay}s infinite`,
            }} />
        ))}
      </div>

      {/* Moon (dark) OR Sun (light). Both use the same anchor so the layout
          doesn't shift when theme flips. */}
      <div className="absolute" style={{ top: '8%', right: '10%' }}>
        {isDark ? (
          <svg width="90" height="90" viewBox="0 0 90 90" aria-hidden="true">
            <defs>
              <radialGradient id="moonGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%"  stopColor="#fffceb" stopOpacity="0.95" />
                <stop offset="60%" stopColor="#fff4c2" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#fff4c2" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx="45" cy="45" r="42" fill="url(#moonGlow)" />
            <circle cx="45" cy="45" r="28" fill="#f3eecf" style={{ animation: 'nf-float 8s ease-in-out infinite' }} />
            <circle cx="36" cy="40" r="4"  fill="#d9d3b3" opacity="0.6" />
            <circle cx="54" cy="52" r="3"  fill="#d9d3b3" opacity="0.5" />
            <circle cx="48" cy="34" r="2.5" fill="#d9d3b3" opacity="0.4" />
          </svg>
        ) : (
          <svg width="120" height="120" viewBox="0 0 120 120" aria-hidden="true">
            <defs>
              <radialGradient id="sunGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%"  stopColor="#fff4b0" stopOpacity="1" />
                <stop offset="60%" stopColor="#ffd370" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#ffb070" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx="60" cy="60" r="55" fill="url(#sunGlow)" />
            <circle cx="60" cy="60" r="28" fill="#ffd166"
              style={{ animation: 'nf-pulse 4s ease-in-out infinite' }} />
            {/* Rays — rotated children animated as a group */}
            <g style={{ transformOrigin: '60px 60px', animation: 'nf-spin 30s linear infinite' }}>
              {Array.from({ length: 12 }).map((_, i) => (
                <rect key={i} x="58" y="6" width="4" height="14" rx="2" fill="#ffb347"
                  transform={`rotate(${i * 30} 60 60)`} />
              ))}
            </g>
          </svg>
        )}
      </div>

      {/* Lightning bolts — two staggered flashes during a strike. SVG path so
          the bolt has a real silhouette instead of a rectangle. */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d="M22 0 L18 22 L28 22 L20 50 L36 24 L26 24 L32 0 Z"
            fill={isDark ? '#fff4a8' : '#ffd166'}
            style={{ opacity: bolt ? 0.95 : 0, transition: 'opacity 0.08s', filter: 'drop-shadow(0 0 6px #fff4a8)' }} />
          <path d="M78 8 L74 30 L84 30 L76 60 L92 32 L82 32 L88 8 Z"
            fill={isDark ? '#fff4a8' : '#ffd166'}
            style={{ opacity: bolt ? 0.7 : 0, transition: 'opacity 0.12s 0.06s', filter: 'drop-shadow(0 0 6px #fff4a8)' }} />
        </svg>
        {/* Sky flash overlay — brief brightening behind the bolt */}
        <div className="absolute inset-0"
          style={{
            backgroundColor: isDark ? '#ffffff' : '#fff8d2',
            opacity: bolt ? 0.18 : 0,
            transition: 'opacity 0.12s',
          }} />
      </div>

      {/* Main composition — 404 with the middle zero being abducted by the UFO */}
      <div className="relative z-10 text-center select-none">
        <div className="flex items-end justify-center gap-2" style={{ lineHeight: 1 }}>
          <span style={{ fontSize: 'clamp(8rem, 22vw, 18rem)', fontWeight: 900, letterSpacing: '-0.05em',
            color: isDark ? '#f5f7ff' : '#2a2a4a', textShadow: isDark ? '0 0 30px rgba(255,255,255,0.15)' : 'none' }}>4</span>

          {/* Zero + UFO group — UFO floats above, beam connects to zero */}
          <div className="relative" style={{ width: 'clamp(6rem, 14vw, 12rem)', height: 'clamp(10rem, 28vw, 22rem)' }}>
            {/* UFO at the top, gently bobbing */}
            <svg className="absolute left-1/2 -translate-x-1/2"
              style={{ top: 0, width: '100%', animation: 'nf-ufo 4s ease-in-out infinite' }}
              viewBox="0 0 120 60" aria-hidden="true">
              <defs>
                <linearGradient id="ufoBody" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={isDark ? '#9aa4d4' : '#6b7299'} />
                  <stop offset="100%" stopColor={isDark ? '#5a629c' : '#3a4078'} />
                </linearGradient>
                <radialGradient id="ufoDome" cx="50%" cy="40%" r="50%">
                  <stop offset="0%"  stopColor={isDark ? '#a3e9ff' : '#bbdfff'} />
                  <stop offset="100%" stopColor={isDark ? '#3d7ea8' : '#5a8ec7'} />
                </radialGradient>
              </defs>
              {/* Saucer body */}
              <ellipse cx="60" cy="38" rx="55" ry="10" fill="url(#ufoBody)" />
              {/* Dome */}
              <path d="M30 38 Q60 0 90 38 Z" fill="url(#ufoDome)" />
              {/* Lights along the rim — pulse staggered */}
              {[20, 35, 50, 65, 80, 95].map((cx, i) => (
                <circle key={cx} cx={cx} cy="42" r="2.4" fill="#ffd166"
                  style={{ animation: `nf-light 1.4s ease-in-out ${i * 0.18}s infinite` }} />
              ))}
            </svg>

            {/* Tractor beam — soft cone descending from the UFO */}
            <div className="absolute left-1/2 -translate-x-1/2"
              style={{
                top: '20%', width: '75%', height: '45%',
                background: `linear-gradient(180deg, ${isDark ? 'rgba(255,244,168,0.55)' : 'rgba(255,209,102,0.55)'} 0%, transparent 100%)`,
                clipPath: 'polygon(35% 0, 65% 0, 100% 100%, 0 100%)',
                animation: 'nf-beam 2.4s ease-in-out infinite',
              }} />

            {/* The abducted zero — floats inside the beam */}
            <span className="absolute left-1/2 -translate-x-1/2"
              style={{
                bottom: 0, fontSize: 'clamp(8rem, 22vw, 18rem)', fontWeight: 900, lineHeight: 1, letterSpacing: '-0.05em',
                color: isDark ? '#f5f7ff' : '#2a2a4a',
                animation: 'nf-abduct 3s ease-in-out infinite',
                textShadow: isDark ? '0 0 30px rgba(255,244,168,0.6)' : '0 0 30px rgba(255,209,102,0.5)',
              }}>0</span>
          </div>

          <span style={{ fontSize: 'clamp(8rem, 22vw, 18rem)', fontWeight: 900, letterSpacing: '-0.05em',
            color: isDark ? '#f5f7ff' : '#2a2a4a', textShadow: isDark ? '0 0 30px rgba(255,255,255,0.15)' : 'none' }}>4</span>
        </div>

        <h2 className="mt-6 text-2xl sm:text-3xl font-bold" style={{ color: isDark ? '#f5f7ff' : '#2a2a4a' }}>
          Page lost in space
        </h2>
        <p className="mt-2 max-w-md mx-auto text-sm sm:text-base" style={{ color: isDark ? '#a3a9c9' : '#5a607a' }}>
          The page you're looking for got beamed up. Let's get you back to safer orbit.
        </p>

        <div className="mt-8 flex items-center justify-center gap-3">
          <button onClick={() => window.history.back()}
            className="px-5 py-2.5 rounded-xl font-semibold transition-all flex items-center gap-2 hover:scale-105"
            style={{
              backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
              border: `1px solid ${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)'}`,
              color: isDark ? '#f5f7ff' : '#2a2a4a',
              backdropFilter: 'blur(8px)',
            }}>
            <ArrowLeft size={16} /> Go Back
          </button>
          <Link to="/"
            className="px-5 py-2.5 rounded-xl font-semibold text-white transition-all flex items-center gap-2 hover:scale-105"
            style={{ background: 'var(--gradient-sidebar)', boxShadow: '0 8px 24px rgba(0,0,0,0.25)' }}>
            <Home size={16} /> Home
          </Link>
        </div>
      </div>

      {/* Tree silhouettes — bottom layer, swaying slowly. Inline SVG so the
          color follows the theme and we get a real organic shape. */}
      <div className="absolute left-0 right-0 bottom-0 pointer-events-none" style={{ height: '40%' }}>
        {trees.map((t, i) => (
          <svg key={i} className="absolute"
            style={{
              bottom: 0,
              left: `${t.x}%`,
              width: `${t.h * 0.7}px`,
              height: `${t.h}px`,
              transform: `translateX(-50%)`,
              transformOrigin: 'bottom center',
              animation: `nf-sway ${5 + t.z * 3}s ease-in-out ${i * 0.4}s infinite`,
              opacity: 0.55 + t.z * 0.45,
              filter: `blur(${(1 - t.z) * 1.2}px)`,
            }}
            viewBox="0 0 60 100" aria-hidden="true">
            <path d="M30 5 L18 35 L24 35 L12 60 L20 60 L8 90 L52 90 L40 60 L48 60 L36 35 L42 35 Z"
              fill={isDark ? '#0a0e22' : '#3a5a3a'} />
            <rect x="27" y="88" width="6" height="10" fill={isDark ? '#1a1d35' : '#5a4030'} />
          </svg>
        ))}
        {/* Ground plane */}
        <div className="absolute left-0 right-0 bottom-0" style={{
          height: '8%',
          background: isDark
            ? 'linear-gradient(180deg, transparent, #050818)'
            : 'linear-gradient(180deg, transparent, #7fa67f)',
        }} />
      </div>

      <DevCredit />

      {/* Animation keyframes — co-located so the file is self-contained. */}
      <style>{`
        @keyframes nf-twinkle {
          0%, 100% { opacity: 0.15; transform: scale(0.8); }
          50%      { opacity: 1;    transform: scale(1.2); }
        }
        @keyframes nf-float {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-3px); }
        }
        @keyframes nf-pulse {
          0%, 100% { transform: scale(1);   opacity: 1; }
          50%      { transform: scale(1.04); opacity: 0.9; }
        }
        @keyframes nf-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes nf-ufo {
          0%, 100% { transform: translateX(-50%) translateY(0)   rotate(-2deg); }
          50%      { transform: translateX(-50%) translateY(-8px) rotate( 2deg); }
        }
        @keyframes nf-beam {
          0%, 100% { opacity: 0.45; }
          50%      { opacity: 0.85; }
        }
        @keyframes nf-abduct {
          0%, 100% { transform: translateX(-50%) translateY(0)    scale(1);    }
          50%      { transform: translateX(-50%) translateY(-12px) scale(0.97); }
        }
        @keyframes nf-sway {
          0%, 100% { transform: translateX(-50%) rotate(-1deg); }
          50%      { transform: translateX(-50%) rotate( 1deg); }
        }
        @keyframes nf-light {
          0%, 100% { opacity: 0.3; }
          50%      { opacity: 1;   }
        }
      `}</style>
    </div>
  );
};

export default NotFound;
