import { ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { IconButton } from './kit';
import { useStandalone, useCanGoBack } from '../../hooks/useHistoryTab';

/**
 * The back control an installed PWA does not otherwise have.
 *
 * An iOS home-screen app renders with NO browser chrome: no address bar, no
 * back button, nothing. The only "back" is the edge swipe, which is invisible,
 * undiscoverable, and — before useHistoryTab — exited the app. Giving the tab
 * stack real history entries fixes the swipe; this gives the same action
 * something visible to tap, which is what makes it discoverable.
 *
 * Deliberately renders NOTHING in two cases:
 *   • not standalone — a normal browser tab already has a back button, and a
 *     second one beside it is noise.
 *   • nothing to go back to (router idx === 0) — a back button that dismisses
 *     the app is the exact bug this whole change exists to fix.
 */
export default function BackButton({ className = '' }) {
  const standalone = useStandalone();
  const canGoBack  = useCanGoBack();
  const navigate   = useNavigate();

  if (!standalone || !canGoBack) return null;

  return (
    <IconButton
      label="Go back"
      variant="surface"
      className={className}
      onClick={() => navigate(-1)}
    >
      <ChevronLeft size={18} style={{ color: 'var(--color-text-secondary)' }} />
    </IconButton>
  );
}
