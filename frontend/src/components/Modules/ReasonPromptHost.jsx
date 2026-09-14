// ============================================================================
// ReasonPromptHost -- the one "please say why" dialog.
//
// Mounted once per shell. When the server refuses a change with
// needs_reason (see utils/reasonPrompt.js and api/client.js) this opens, the
// person types why, and the original request is resent with the reason. The
// reason is stored next to the change in the record history (mig 313).
// Cancelling leaves the change unmade -- nothing is saved without its "why".
// ============================================================================
import { useEffect, useRef, useState } from 'react';
import { MessageSquareText } from 'lucide-react';
import { registerReasonHost } from '../../utils/reasonPrompt';
import { Field } from '../UI/kit';
import { Btn, ModuleModal } from './ModuleUI';

export default function ReasonPromptHost() {
  const [ask, setAsk] = useState(null);          // { message, resolve }
  const [text, setText] = useState('');
  const inputRef = useRef(null);

  useEffect(() => registerReasonHost((message) => new Promise((resolve) => {
    setText('');
    setAsk({ message, resolve });
  })), []);

  useEffect(() => { if (ask) setTimeout(() => inputRef.current?.focus(), 30); }, [ask]);

  if (!ask) return null;

  const close = (value) => {
    ask.resolve(value);
    setAsk(null);
  };
  const submit = () => { if (text.trim()) close(text.trim()); };

  return (
    <ModuleModal
      title="Please say why"
      subtitle={ask.message || 'This change is kept in the record history with your reason.'}
      onClose={() => close(null)}
      footer={
        <>
          <Btn onClick={() => close(null)}>Cancel</Btn>
          <Btn variant="primary" icon={MessageSquareText} disabled={!text.trim()} onClick={submit}>Save with reason</Btn>
        </>
      }>
      <Field label="Reason" hint="Short and specific is best, e.g. “Annual raise approved by Ali” or “Marked absent by mistake”.">
        <textarea ref={inputRef} className="input w-full" rows={3} maxLength={1000}
          value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); }} />
      </Field>
    </ModuleModal>
  );
}
