import confetti from 'canvas-confetti';

/*
 * celebration.js
 *
 * Single shared confetti effect layer. Every named template lives here as a
 * plain function so the admin preview button (Business Rules → Celebrations)
 * and every real trigger point (useNotifications.js today, more event types
 * later) call the EXACT same code — "preview" and "real" always look
 * identical, never two implementations drifting apart.
 *
 * Each template calls the module-level `fire()` helper instead of
 * canvas-confetti directly so disableForReducedMotion is enforced in exactly
 * one place, for every burst, with no way for a new template to forget it.
 * canvas-confetti draws to its own transparent, full-viewport, pointer-events:
 * none canvas — nothing here needs to manage z-index or click-blocking.
 */

function fire(opts) {
  confetti({ disableForReducedMotion: true, ...opts });
}

// Live theme colors (default palette or a superadmin-configured per-company
// theme via ThemeRuntime — both land in these CSS custom properties) so
// "School Pride" always matches whatever brand is actually on screen instead
// of a hardcoded palette.
export function brandColors() {
  if (typeof document === 'undefined') return ['#8B7049', '#C0A682', '#A67720', '#22C55E'];
  const s = getComputedStyle(document.documentElement);
  const pick = (name, fallback) => (s.getPropertyValue(name) || '').trim() || fallback;
  return [
    pick('--color-primary-500', '#8B7049'),
    pick('--color-primary-300', '#C0A682'),
    pick('--color-accent', '#A67720'),
    pick('--color-success-500', '#22C55E'),
  ];
}

function classicBurst() {
  fire({ particleCount: 150, spread: 75, startVelocity: 45, origin: { y: 0.65 } });
}

function fireworks() {
  const end = Date.now() + 2000;
  (function frame() {
    fire({
      particleCount: 4, startVelocity: 30, spread: 360, ticks: 60, zIndex: 9999,
      origin: { x: Math.random(), y: Math.random() * 0.4 },
    });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}

function cannonBlast() {
  fire({ particleCount: 100, angle: 60, spread: 55, origin: { x: 0, y: 0.75 } });
  fire({ particleCount: 100, angle: 120, spread: 55, origin: { x: 1, y: 0.75 } });
}

// Staggered shots of decreasing size/increasing spread — canvas-confetti's
// classic "realistic look" recipe. Gravity + per-shot decay/scalar give it
// natural drift instead of one uniform blast.
function realistic() {
  const shot = (ratio, opts) => fire({ ...opts, particleCount: Math.floor(200 * ratio), origin: { y: 0.7 } });
  shot(0.25, { spread: 26, startVelocity: 55 });
  shot(0.2,  { spread: 60 });
  shot(0.35, { spread: 100, decay: 0.91, scalar: 0.8 });
  shot(0.1,  { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
  shot(0.1,  { spread: 120, startVelocity: 45 });
}

function stars() {
  const colors = ['#FFD700', '#FFA500', '#FFF176'];
  fire({ particleCount: 50, spread: 100, shapes: ['star'], colors, scalar: 1.1, origin: { y: 0.6 } });
  fire({ particleCount: 25, spread: 130, shapes: ['star'], colors, scalar: 0.7, origin: { y: 0.6 } });
}

function emojiRain() {
  const scalar = 2.4;
  const shapes = ['🎉', '💰', '🏆'].map(text => confetti.shapeFromText({ text, scalar }));
  const drop = () => fire({
    shapes, scalar, particleCount: 30, spread: 90, startVelocity: 22, gravity: 0.6, origin: { y: -0.1 },
  });
  drop();
  setTimeout(drop, 250);
}

function schoolPride(opts = {}) {
  const colors = opts.colors || brandColors();
  const end = Date.now() + 1200;
  (function frame() {
    fire({ particleCount: 6, angle: 60, spread: 55, origin: { x: 0 }, colors });
    fire({ particleCount: 6, angle: 120, spread: 55, origin: { x: 1 }, colors });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}

export const CELEBRATION_TEMPLATES = {
  classic:      { label: 'Classic Burst', desc: 'One clean center burst.', run: classicBurst },
  fireworks:    { label: 'Fireworks', desc: 'Random bursts across the sky for ~2s.', run: fireworks },
  cannons:      { label: 'Cannon Blast', desc: 'Two side cannons firing inward.', run: cannonBlast },
  realistic:    { label: 'Realistic', desc: 'Gravity + drift, staggered shots.', run: realistic },
  stars:        { label: 'Stars', desc: 'Gold/silver stars instead of confetti squares.', run: stars },
  emoji:        { label: 'Emoji Rain', desc: '🎉 💰 🏆 falling from the top.', run: emojiRain },
  school_pride: { label: 'School Pride', desc: 'Side cannons in the live brand colors.', run: schoolPride },
};

export const CELEBRATION_TEMPLATE_KEYS = Object.keys(CELEBRATION_TEMPLATES);

// Fires a celebration by template key. Falls back to 'classic' on an unknown
// key (e.g. a template removed after being saved) and never throws — confetti
// is decorative and must never be able to break the caller.
export function fireCelebration(templateKey, opts) {
  const tpl = CELEBRATION_TEMPLATES[templateKey] || CELEBRATION_TEMPLATES.classic;
  try { tpl.run(opts); } catch { /* decorative only */ }
}
