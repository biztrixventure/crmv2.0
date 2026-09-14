// ============================================================================
// AskDialog -- "are you sure?" and "say why", in the app's own look.
//
// Replaces window.confirm / window.prompt in the HR and Accounts pages. Those
// browser pop-ups look like an error from another website, cannot be styled
// for dark mode, and are blocked outright inside some installed-app contexts.
//
//   <AskDialog title message confirmLabel reason onConfirm(reason) onClose danger />
//
// reason: 'required' | 'optional' | undefined (no box)
// ============================================================================
import { useEffect, useRef, useState } from 'react';
import { Field } from '../UI/kit';
import { Btn, ModuleModal } from './ModuleUI';

export default function AskDialog({
  title, message, confirmLabel = 'Confirm', reason, reasonLabel = 'Reason', reasonHint,
  danger = false, onConfirm, onClose,
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  useEffect(() => { if (reason) setTimeout(() => ref.current?.focus(), 30); }, [reason]);

  const blocked = reason === 'required' && !text.trim();
  const go = async () => {
    if (blocked) return;
    setBusy(true);
    try { await onConfirm?.(text.trim()); } finally { setBusy(false); }
  };

  return (
    <ModuleModal title={title} subtitle={message} onClose={onClose}
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant={danger ? 'danger' : 'primary'} busy={busy} disabled={blocked} onClick={go}>{confirmLabel}</Btn>
      </>}>
      {reason ? (
        <Field label={reasonLabel + (reason === 'required' ? '' : ' (optional)')} hint={reasonHint || 'Kept in the record history.'}>
          <textarea ref={ref} className="input w-full" rows={3} maxLength={1000} value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) go(); }} />
        </Field>
      ) : null}
    </ModuleModal>
  );
}
