import { useState, lazy, Suspense } from 'react';
import { NotebookPen } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

// Header trigger for the private spreadsheet + notepad. Mirrors MailLauncher /
// ChatLauncher so the control cluster reads as one set.
//
// NOTHING LOADS UNTIL IT IS CLICKED. The panel is lazy, and the spreadsheet
// library inside it is lazier still (a dynamic import on the Sheet tab). A
// user who never opens this pays for one 36x36 button and an icon — which is
// the entire point of putting a 1.4 MB editor behind a header button rather
// than on a route everyone's bundle reaches.
//
// NO ACCESS CALL ON MOUNT, deliberately. Asking "may I?" on every page load,
// for every user, to decide whether to draw one icon is a request per session
// per person for almost always the same answer. The icon is always drawn; the
// panel asks once when opened and says so plainly if the answer is no. The
// endpoints enforce it regardless, so the button is never the gate.
const ScratchpadPanel = lazy(() => import('./ScratchpadPanel'));

export default function ScratchpadLauncher() {
  const { user, isReadOnly } = useAuth();
  const [open, setOpen] = useState(false);

  // A read-only admin may look at the CRM, not keep notes in it — the same
  // posture readonlyGuard takes on the route.
  if (!user?.id || isReadOnly) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Scratchpad — your private spreadsheet and notes"
        aria-label="Scratchpad"
        className="w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 hover:scale-105 flex-shrink-0"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}
        onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--color-primary-50, #f5f3ff)'; }}
        onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'var(--color-surface)'; }}
      >
        <NotebookPen size={16} style={{ color: 'var(--color-text-secondary)' }} />
      </button>

      {open && (
        <Suspense fallback={null}>
          <ScratchpadPanel onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
