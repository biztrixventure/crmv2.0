import { useEffect } from 'react';

// useCopyGuard — JS defense-in-depth layer for readonly_admin copy-protection.
//
// When `enabled`, blocks copy/cut/contextmenu/selectstart/dragstart (and
// Ctrl/Cmd+C/X) inside `rootRef`. The VISIBLE lock is done by the caller adding
// a `copy-locked` class to the same root (CSS user-select:none), which is what
// guarantees no-flash — the class is present on the first paint from the
// synchronously-resolved user.governance, so text is never selectable, and this
// hook attaching one tick later in an effect is harmless.
//
// Scoped to rootRef (NOT document) so only the AdminPanel shell is affected;
// superadmins and every other shell are untouched. `onBlockedCopy` fires when a
// copy/cut/contextmenu is blocked, so the caller can report it to the audit
// beacon. This is a DETERRENT, not a security boundary — screenshots, DevTools,
// and reading Network responses cannot be prevented; real protection is the
// server-side PII/financial masking + export gates layered underneath.
export function useCopyGuard(enabled, rootRef, onBlockedCopy) {
  useEffect(() => {
    const root = rootRef?.current;
    if (!enabled || !root) return;

    const report = (e) => { try { onBlockedCopy?.(e?.type || 'copy'); } catch { /* never throw from a handler */ } };
    const block = (e) => { e.preventDefault(); e.stopPropagation(); return false; };
    const blockAndReport = (e) => { report(e); return block(e); };

    // copy/cut/contextmenu are user-intent copy attempts → block + report.
    const reportEvts = ['copy', 'cut', 'contextmenu'];
    // selectstart/dragstart just prevent selection/drag extraction (no report).
    const silentEvts = ['selectstart', 'dragstart'];
    reportEvts.forEach(t => root.addEventListener(t, blockAndReport, { capture: true }));
    silentEvts.forEach(t => root.addEventListener(t, block, { capture: true }));

    // Belt-and-suspenders: stomp Ctrl/Cmd+C / +X at keydown too.
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && ['c', 'x'].includes((e.key || '').toLowerCase())) blockAndReport(e);
    };
    root.addEventListener('keydown', onKey, { capture: true });

    return () => {
      reportEvts.forEach(t => root.removeEventListener(t, blockAndReport, { capture: true }));
      silentEvts.forEach(t => root.removeEventListener(t, block, { capture: true }));
      root.removeEventListener('keydown', onKey, { capture: true });
    };
  }, [enabled, rootRef, onBlockedCopy]);
}
