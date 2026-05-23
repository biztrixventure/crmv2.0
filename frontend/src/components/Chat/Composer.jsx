import { useState, useRef } from 'react';
import { Send, Lock } from 'lucide-react';

// Auto-growing message box. Enter sends, Shift+Enter newlines. Broadcasts a
// throttled typing ping while the user types.
const Composer = ({ onSend, onTyping, disabled, disabledReason }) => {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const taRef = useRef(null);
  const lastTypingRef = useRef(0);

  const grow = (el) => { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 140) + 'px'; };

  const submit = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await onSend(body);
      setText('');
      if (taRef.current) taRef.current.style.height = 'auto';
    } catch { /* error surfaced as failed bubble */ }
    finally { setSending(false); taRef.current?.focus(); }
  };

  const onChange = (e) => {
    setText(e.target.value);
    grow(e.target);
    const now = Date.now();
    if (now - lastTypingRef.current > 2500) { lastTypingRef.current = now; onTyping?.(); }
  };

  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } };

  if (disabled) {
    return (
      <div className="flex items-center justify-center gap-2 px-4 py-4 flex-shrink-0" style={{ borderTop: '1px solid var(--color-border)', color: 'var(--color-text-tertiary)' }}>
        <Lock size={15} /><span className="text-sm">{disabledReason || 'You cannot send messages here'}</span>
      </div>
    );
  }

  return (
    <div className="flex items-end gap-2 px-3 py-3 flex-shrink-0" style={{ borderTop: '1px solid var(--color-border)' }}>
      <textarea
        ref={taRef} rows={1} value={text} onChange={onChange} onKeyDown={onKey}
        placeholder="Type a message…"
        className="flex-1 resize-none rounded-2xl px-4 py-2.5 text-sm focus:outline-none"
        style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text)', maxHeight: 140 }}
      />
      <button onClick={submit} disabled={!text.trim() || sending} title="Send"
        className="w-10 h-10 rounded-full flex items-center justify-center text-white flex-shrink-0 disabled:opacity-40 transition-transform hover:scale-105"
        style={{ background: 'var(--gradient-sidebar)' }}>
        <Send size={17} />
      </button>
    </div>
  );
};

export default Composer;
