import { useState, useRef, useMemo, useEffect } from 'react';
import { Send, Lock, Command, Slash } from 'lucide-react';
import { useMessageTemplates } from '../../hooks/useMessageTemplates';
import TemplatesModal from './TemplatesModal';

// Auto-growing message box. Enter sends, Shift+Enter newlines. Broadcasts a
// throttled typing ping while the user types. Typing "/keyword" opens a local
// message-template picker (stored per-user in localStorage).
const Composer = ({ onSend, onTyping, disabled, disabledReason, meId }) => {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [mgrOpen, setMgrOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [dismissed, setDismissed] = useState(false);   // Esc-dismiss until text changes
  const taRef = useRef(null);
  const lastTypingRef = useRef(0);

  const { templates, addTemplate, updateTemplate, deleteTemplate } = useMessageTemplates(meId);

  // Suggestions are active while the message starts with "/" and wasn't dismissed.
  const query = text.startsWith('/') ? text.slice(1).trim().toLowerCase() : null;
  const matches = useMemo(() => {
    if (query === null) return [];
    return templates.filter(t =>
      (t.shortcut || '').toLowerCase().includes(query) || (t.text || '').toLowerCase().includes(query));
  }, [query, templates]);
  const sugOpen = query !== null && !dismissed && matches.length > 0;

  useEffect(() => { setHighlight(0); }, [query, matches.length]);

  const grow = (el) => { if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 140) + 'px'; } };

  const applyTemplate = (t) => {
    if (!t) return;
    setText(t.text);
    setDismissed(true);
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (el) { el.focus(); el.setSelectionRange(t.text.length, t.text.length); grow(el); }
    });
  };

  const submit = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await onSend(body);
      setText('');
      setDismissed(false);
      if (taRef.current) taRef.current.style.height = 'auto';
    } catch { /* error surfaced as failed bubble */ }
    finally { setSending(false); taRef.current?.focus(); }
  };

  const onChange = (e) => {
    setText(e.target.value);
    setDismissed(false);
    grow(e.target);
    const now = Date.now();
    if (now - lastTypingRef.current > 2500) { lastTypingRef.current = now; onTyping?.(); }
  };

  const onKey = (e) => {
    if (sugOpen) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => (h + 1) % matches.length); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlight(h => (h - 1 + matches.length) % matches.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); applyTemplate(matches[highlight]); return; }
      if (e.key === 'Escape')    { e.preventDefault(); setDismissed(true); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  if (disabled) {
    return (
      <div className="flex items-center justify-center gap-2 px-4 py-4 flex-shrink-0" style={{ borderTop: '1px solid var(--color-border)', color: 'var(--color-text-tertiary)' }}>
        <Lock size={15} /><span className="text-sm">{disabledReason || 'You cannot send messages here'}</span>
      </div>
    );
  }

  return (
    <div className="relative flex items-end gap-2 px-3 py-3 flex-shrink-0" style={{ borderTop: '1px solid var(--color-border)' }}>
      {/* Template suggestions */}
      {sugOpen && (
        <div className="absolute bottom-full left-3 right-3 mb-2 rounded-xl overflow-hidden z-30 max-h-60 overflow-y-auto"
          style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-lg)' }}>
          <div className="px-3 py-1.5 text-xs font-bold uppercase tracking-wide flex items-center gap-1.5"
            style={{ color: 'var(--color-text-tertiary)', borderBottom: '1px solid var(--color-border)' }}>
            <Slash size={11} /> Shortcuts
          </div>
          {matches.map((t, i) => (
            <button key={t.id} type="button"
              onMouseDown={(e) => { e.preventDefault(); applyTemplate(t); }}
              onMouseEnter={() => setHighlight(i)}
              className="w-full text-left px-3 py-2 transition-colors"
              style={{ backgroundColor: i === highlight ? 'var(--color-primary-50, #f5f3ff)' : 'transparent' }}>
              {t.shortcut && (
                <span className="inline-block text-xs font-mono font-bold mr-2 px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>/{t.shortcut}</span>
              )}
              <span className="text-sm" style={{ color: 'var(--color-text)' }}>
                {t.text.length > 70 ? `${t.text.slice(0, 70)}…` : t.text}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Manage shortcuts */}
      <button onClick={() => setMgrOpen(true)} title="Message shortcuts" type="button"
        className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-colors"
        style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
        <Command size={17} />
      </button>

      <textarea
        ref={taRef} rows={1} value={text} onChange={onChange} onKeyDown={onKey}
        placeholder="Type a message…  (/ for shortcuts)"
        className="flex-1 resize-none rounded-2xl px-4 py-2.5 text-sm focus:outline-none"
        style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text)', maxHeight: 140 }}
      />
      <button onClick={submit} disabled={!text.trim() || sending} title="Send"
        className="w-10 h-10 rounded-full flex items-center justify-center text-white flex-shrink-0 disabled:opacity-40 transition-transform hover:scale-105"
        style={{ background: 'var(--gradient-sidebar)' }}>
        <Send size={17} />
      </button>

      <TemplatesModal
        open={mgrOpen}
        onClose={() => setMgrOpen(false)}
        templates={templates}
        onAdd={addTemplate}
        onUpdate={updateTemplate}
        onDelete={deleteTemplate}
      />
    </div>
  );
};

export default Composer;
