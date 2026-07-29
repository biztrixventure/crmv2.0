import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Maximize2, Minimize2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useCopyGuard } from '../../hooks/useCopyGuard';
import { roBeacon } from '../../utils/roActivityBeacon';

// ============================================================================
// DrawerShell — the CHROME every detail drawer shares: scrim, sliding panel,
// header, the essentials toggle, and the scroll container.
//
// WHY A SHELL AND NOT SIX FIXES. There are six detail drawers. They had drifted
// into two different geometries (`min(480px,100vw)` vs `w-full max-w-lg`), two
// different close behaviours (only two animated out), and six copies of the
// same Esc-to-close effect. The essentials icon and the 390px header fix both
// belong in the header — so doing them per file meant six headers that agree
// today and drift again the moment a seventh drawer is added.
//
// This owns chrome ONLY. Every drawer keeps its own body markup verbatim; no
// drawer had its content rewritten to adopt this.
//
// WHAT IT DELIBERATELY DOES NOT DO: push history entries. `useHistoryTab`
// already owns the installed-PWA back-swipe contract by pushing `?t=` entries;
// a drawer adding its own would put a phantom step between the user and the
// tab they came from. Esc and the scrim close it; back still leaves the tab.
// ============================================================================

// Nested drawers are real here (a sale drawer can open a sibling sale), so the
// body scroll-lock is refcounted. A plain set/restore would unlock the page as
// soon as the INNER drawer closed, while the outer one was still open.
let scrollLockCount = 0;
function lockBodyScroll() {
  if (scrollLockCount === 0) document.body.style.overflow = 'hidden';
  scrollLockCount += 1;
}
function unlockBodyScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) document.body.style.overflow = '';
}

export default function DrawerShell({
  icon,                    // node — the small glyph in the header puck
  title,                   // string — record name
  subtitle,                // string — e.g. "Sale Details"
  onClose,
  headerActions = null,    // node — e.g. the copy bar, rendered before the X
  chrome = null,           // node — fixed strips under the header (status, tabs, banners)
  children,                // node — the scrollable full-view body
  essentials = null,       // node — the compact view; when null the toggle hides
  defaultEssentials = false,
  recordKey,               // changes when a NEW record opens → reset transient state
  width = 480,             // desktop max width in px
  labelledById = undefined,
  // 'brand' = the gradient header the sale/transfer/callback drawers have
  // always had. 'plain' = the surface-coloured header the admin user drawer
  // has always had. A tone rather than a rewrite: adopting the shell must not
  // silently restyle a drawer, so each keeps the look it shipped with.
  headerTone = 'brand',
  // Some bodies (the callback history/number timelines) pad their own rows
  // edge-to-edge, so the shell adding gutters would double them. Opt-out
  // rather than opt-in: the padded case is the common one.
  bodyPadded = true,
}) {
  const [closing, setClosing] = useState(false);
  const [compact, setCompact] = useState(!!defaultEssentials);
  const panelRef = useRef(null);
  const bodyRef  = useRef(null);
  const { roNoCopy } = useAuth();

  // The drawer stays mounted between records, so both the close animation and
  // the view mode reset when a different record opens — otherwise the next
  // record would either stay slid-out or inherit the previous one's view.
  useEffect(() => { setClosing(false); setCompact(!!defaultEssentials); }, [recordKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const requestClose = () => {
    if (closing) return;
    setClosing(true);
    // Matches the slide-out animation; the small margin keeps the panel from
    // unmounting on the last frame of its own transition.
    setTimeout(() => onClose?.(), 220);
  };

  // Esc closes. Every drawer had its own copy of this; now there is one.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The page behind a full-bleed drawer must not scroll. On a phone this is the
  // difference between "scrolling the record" and "scrolling the list you left".
  useEffect(() => { lockBodyScroll(); return unlockBodyScroll; }, []);

  // Switching view resets scroll. Going compact and back should not drop the
  // reader at the old offset of a body that is no longer on screen.
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [compact]);

  // readonly_admin copy-lock. The drawers render through a PORTAL to
  // document.body, which puts them OUTSIDE the AdminPanel root that
  // useCopyGuard was scoped to — so an RO under `no_copy` could select and copy
  // straight out of a drawer. Guarding the panel itself closes that for all six
  // at once, and means the compact view cannot become an easier way in.
  useCopyGuard(roNoCopy, panelRef, (kind) => roBeacon.copyBlocked(kind));

  const showToggle = !!essentials;
  const brand = headerTone !== 'plain';
  // One place decides how the header paints, so the two tones cannot drift into
  // "the plain one forgot the safe-area inset" the way six hand-written
  // headers already had.
  const headerStyle = brand
    ? { background: 'var(--gradient-sidebar)' }
    : { backgroundColor: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' };
  const titleClass  = brand ? 'text-white'   : 'text-text';
  const subClass    = brand ? 'text-white/70' : '';
  const subStyle    = brand ? undefined : { color: 'var(--color-text-secondary)' };
  const btnClass    = brand
    ? 'bg-white/20 hover:bg-white/30'
    : 'hover:bg-bg-secondary';
  const btnIconCls  = brand ? 'text-white' : '';
  const btnIconStyle = brand ? undefined : { color: 'var(--color-text-secondary)' };

  return createPortal(
    <>
      <div className={`fixed inset-0 z-[60] ${closing ? 'bsx-scrim-out' : 'bsx-scrim'}`}
        style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
        onClick={requestClose} />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledById}
        className={`fixed right-0 top-0 z-[61] flex flex-col shadow-2xl${roNoCopy ? ' copy-locked' : ''} ${closing ? 'animate-slide-out-right' : 'animate-slide-in-right'}`}
        style={{
          width: `min(${width}px, 100vw)`,
          // dvh, not vh: on iOS Safari `100vh` is the height WITHOUT the
          // collapsing address bar, so the bottom of a 100vh panel sits under
          // the browser chrome and the last action row is unreachable.
          height: '100dvh',
          maxHeight: '100dvh',
          backgroundColor: 'var(--color-surface)',
          borderLeft: '1px solid var(--color-border)',
        }}>

        {/* ── Header ──────────────────────────────────────────────────────
            The old header truncated the title at a hardcoded max-w-[260px],
            which on a 390px phone clipped the name while empty space sat
            beside it. It flexes now: min-w-0 is what lets the flex child
            actually shrink — without it `truncate` never engages in a flex row. */}
        <div className="flex items-center justify-between gap-2 px-3 sm:px-5 py-3 sm:py-4 flex-shrink-0"
          style={{ ...headerStyle, paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0px))' }}>
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            {icon && (
              <div className={`flex-shrink-0${brand ? ' p-1.5 sm:p-2 rounded-xl bg-white/20' : ''}`}>{icon}</div>
            )}
            <div className="min-w-0">
              <h2 id={labelledById} className={`text-sm sm:text-base font-bold truncate ${titleClass}`}>
                {title}
              </h2>
              {subtitle && (
                <p className={`text-[11px] sm:text-xs m-0 truncate ${subClass}`} style={subStyle}>{subtitle}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            {/* Header actions are the first thing worth moving at phone widths —
                the copy bar is a convenience, the close button is not. They are
                not dropped, only relocated to their own row below. */}
            {headerActions && <div className="hidden sm:flex items-center gap-2">{headerActions}</div>}

            {showToggle && (
              <button
                type="button"
                onClick={() => setCompact(c => !c)}
                aria-pressed={compact}
                title={compact ? 'Show the full record' : 'Show only the essentials'}
                aria-label={compact ? 'Show the full record' : 'Show only the essentials'}
                className={`p-2 rounded-xl transition-colors ${btnClass}`}
                style={{ minWidth: 36, minHeight: 36 }}>
                {compact
                  ? <Maximize2 size={16} className={btnIconCls} style={btnIconStyle} />
                  : <Minimize2 size={16} className={btnIconCls} style={btnIconStyle} />}
              </button>
            )}

            <button onClick={requestClose} aria-label="Close"
              className={`p-2 rounded-xl transition-colors ${btnClass}`}
              style={{ minWidth: 36, minHeight: 36 }}>
              <X size={16} className={btnIconCls} style={btnIconStyle} />
            </button>
          </div>
        </div>

        {/* The relocated header actions. Hidden above at phone widths, they
            come back as their own row rather than disappearing — the copy bar
            is how staff get a record into a spreadsheet, so it must not become
            a desktop-only feature. */}
        {headerActions && (
          <div className="flex sm:hidden items-center gap-2 px-3 py-2 flex-shrink-0 overflow-x-auto"
            style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
            {headerActions}
          </div>
        )}

        {/* Fixed strips (status bar, record tabs, banners) belong to the FULL
            view: the compact view is defined as "these fields and nothing
            else", so a status bar above it would contradict its own promise. */}
        {!compact && chrome}

        <div ref={bodyRef}
          className={`flex-1 overflow-y-auto overscroll-contain${bodyPadded ? ' px-3 sm:px-5 py-3 sm:py-4' : ''}`}
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}>
          {compact ? essentials : children}
        </div>
      </div>
    </>,
    document.body,
  );
}
