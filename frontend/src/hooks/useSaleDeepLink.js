import { useEffect, useRef } from 'react';
import client from '../api/client';

// ============================================================================
// useSaleDeepLink — turn a focus target carrying `open: 'drawer'` into an
// actually-open sale drawer.
//
// Focus has always stopped one step short: it switches the shell to the right
// tab and rings the row. For a sale awaiting review that is not enough — the
// recipient tapped a notification that said "this needs you", and on a phone
// the ringed row is a two-line sliver they still have to find and tap.
//
// Deliberately a FETCH, not a lookup in whatever list the shell has loaded:
//   • the record may not be on the current page (or inside the current filter)
//     at all, and a deep link that works only when the row happens to be
//     loaded is a deep link that fails exactly when it matters;
//   • GET /sales/:id returns the enriched shape (closer / fronter / company),
//     which the compact view needs and a list row may not carry.
//
// Fires at most once per focus target: `ts` changes only when a NEW
// notification is acted on, so re-renders, tab switches and list refreshes
// cannot re-open a drawer the user just closed.
// ============================================================================
export function useSaleDeepLink(focus, onOpen, enabled = true) {
  const handled = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    if (!focus || focus.kind !== 'sale' || focus.open !== 'drawer' || !focus.id) return undefined;

    const token = `${focus.id}:${focus.ts}`;
    if (handled.current === token) return undefined;
    handled.current = token;

    let cancelled = false;
    client.get(`sales/${focus.id}`)
      .then(r => { if (!cancelled && r.data?.sale) onOpen(r.data.sale); })
      .catch(() => {
        // 403/404 — the notification outlived the record, or this viewer
        // cannot reach it. The shell has already switched to the sales tab, so
        // the user lands somewhere sensible rather than on an error.
      });

    return () => { cancelled = true; };
  }, [focus, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}

export default useSaleDeepLink;
