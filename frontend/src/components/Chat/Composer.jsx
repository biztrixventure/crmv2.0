import { useState, useRef, useMemo, useEffect } from 'react';
import {
  Send, Lock, Command, Slash, Bold, Italic, Underline, List, ListOrdered,
  Link2, Image as ImageIcon, Paperclip, X, Loader2, FileText,
} from 'lucide-react';
import { toast } from 'sonner';
import { useMessageTemplates } from '../../hooks/useMessageTemplates';
import { isHtmlEmpty, htmlToText, extractMentions, uploadChatFile } from '../../utils/chatHtml';
import TemplatesModal from './TemplatesModal';
import Avatar from './Avatar';

const ToolBtn = ({ title, onClick, children, active }) => (
  <button type="button" title={title} onMouseDown={e => { e.preventDefault(); onClick(); }}
    className="p-1.5 rounded-lg transition-colors hover:bg-bg-secondary"
    style={{ color: active ? 'var(--color-primary-600)' : 'var(--color-text-secondary)' }}>
    {children}
  </button>
);

// Rich chat composer: contentEditable with formatting toolbar, @mentions, file/
// image attachments (≤10MB), paste-preserves-formatting, and "/" templates.
const Composer = ({ onSend, onTyping, disabled, disabledReason, meId, members = [] }) => {
  const edRef = useRef(null);
  const imgRef = useRef(null);
  const fileRef = useRef(null);
  const lastTypingRef = useRef(0);
  const mentionCtxRef = useRef(null);

  const [htmlEmpty, setHtmlEmpty] = useState(true);
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState([]);   // [{url,name,type,size,kind}]
  const [uploading, setUploading] = useState(0);
  const [mgrOpen, setMgrOpen] = useState(false);

  // Suggestion dropdown: either "/" templates or "@" mentions.
  const [sug, setSug] = useState(null);   // { kind:'template'|'mention', query }
  const [highlight, setHighlight] = useState(0);

  const { templates, addTemplate, updateTemplate, deleteTemplate } = useMessageTemplates(meId);

  const mentionable = useMemo(() => (members || []).filter(m => m.id !== meId && m.name), [members, meId]);

  const matches = useMemo(() => {
    if (!sug) return [];
    const q = sug.query.toLowerCase();
    if (sug.kind === 'template') {
      return templates.filter(t => (t.shortcut || '').toLowerCase().includes(q) || (t.text || '').toLowerCase().includes(q));
    }
    return mentionable.filter(m => m.name.toLowerCase().includes(q)).slice(0, 8);
  }, [sug, templates, mentionable]);

  useEffect(() => { setHighlight(0); }, [sug?.kind, sug?.query, matches.length]);

  const emit = () => setHtmlEmpty(isHtmlEmpty(edRef.current?.innerHTML || ''));
  const focusEd = () => edRef.current?.focus();
  const exec = (cmd, arg = null) => { document.execCommand(cmd, false, arg); focusEd(); emit(); };

  // ── suggestion detection from the caret context ───────────────────────────────
  const detectSuggestion = () => {
    const text = (edRef.current?.textContent || '');
    if (text.startsWith('/')) { setSug({ kind: 'template', query: text.slice(1).trim().toLowerCase() }); return; }

    const sel = window.getSelection();
    if (sel && sel.rangeCount && sel.anchorNode?.nodeType === Node.TEXT_NODE) {
      const offset = sel.anchorOffset;
      const before = sel.anchorNode.textContent.slice(0, offset);
      const m = before.match(/@([\w]*)$/);
      if (m) {
        mentionCtxRef.current = { node: sel.anchorNode, start: offset - m[0].length, end: offset };
        setSug({ kind: 'mention', query: m[1].toLowerCase() });
        return;
      }
    }
    setSug(null);
  };

  const onInput = () => {
    emit();
    detectSuggestion();
    const now = Date.now();
    if (now - lastTypingRef.current > 2500) { lastTypingRef.current = now; onTyping?.(); }
  };

  // ── selecting a suggestion ────────────────────────────────────────────────────
  const pickTemplate = (t) => {
    if (!t || !edRef.current) return;
    edRef.current.innerHTML = '';
    edRef.current.appendChild(document.createTextNode(t.text));
    setSug(null); emit();
    requestAnimationFrame(() => {
      focusEd();
      const r = document.createRange(); r.selectNodeContents(edRef.current); r.collapse(false);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    });
  };

  const pickMention = (member) => {
    const ctx = mentionCtxRef.current;
    const sel = window.getSelection();
    if (!ctx || !sel) return;
    const range = document.createRange();
    try { range.setStart(ctx.node, ctx.start); range.setEnd(ctx.node, ctx.end); }
    catch { setSug(null); return; }
    range.deleteContents();
    const chip = document.createElement('span');
    chip.className = 'bsx-mention';
    chip.setAttribute('data-uid', member.id);
    chip.setAttribute('contenteditable', 'false');
    chip.textContent = `@${member.name}`;
    range.insertNode(chip);
    const space = document.createTextNode(' ');
    chip.after(space);
    const after = document.createRange(); after.setStartAfter(space); after.collapse(true);
    sel.removeAllRanges(); sel.addRange(after);
    setSug(null); emit();
  };

  const choose = (i) => {
    const item = matches[i];
    if (!item) return;
    if (sug.kind === 'template') pickTemplate(item); else pickMention(item);
  };

  // ── attachments ───────────────────────────────────────────────────────────────
  const doUpload = async (file, { inline = false } = {}) => {
    setUploading(n => n + 1);
    try {
      const att = await uploadChatFile(file);
      if (inline && att.kind === 'image') exec('insertImage', att.url);
      else setAttachments(prev => [...prev, att]);
    } catch (e) {
      toast.error(e.response?.data?.error || e.message || 'Upload failed');
    } finally { setUploading(n => n - 1); }
  };

  const onPickImage = (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) doUpload(f, { inline: true }); };
  const onPickFile  = (e) => { [...(e.target.files || [])].forEach(f => doUpload(f)); e.target.value = ''; };
  const removeAttachment = (i) => setAttachments(prev => prev.filter((_, idx) => idx !== i));

  const addLink = () => { const url = window.prompt('Link URL'); if (url) exec('createLink', url); };

  // Paste: image files → attachments; everything else keeps native rich paste.
  const onPaste = (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); files.forEach(f => doUpload(f, { inline: f.type.startsWith('image/') })); }
  };

  // ── send ──────────────────────────────────────────────────────────────────────
  const submit = async () => {
    const html = edRef.current?.innerHTML || '';
    const hasText = !isHtmlEmpty(html);
    if ((!hasText && !attachments.length) || sending || uploading) return;
    const payload = {
      body: htmlToText(html),
      body_html: hasText ? html : null,
      attachments: attachments.length ? attachments : null,
      mentions: extractMentions(html),
    };
    setSending(true);
    try {
      await onSend(payload);
      edRef.current.innerHTML = '';
      setAttachments([]); setSug(null); emit();
    } catch { /* surfaced as failed bubble */ }
    finally { setSending(false); focusEd(); }
  };

  const onKey = (e) => {
    if (sug && matches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => (h + 1) % matches.length); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlight(h => (h - 1 + matches.length) % matches.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(highlight); return; }
      if (e.key === 'Escape')    { e.preventDefault(); setSug(null); return; }
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

  const canSend = (!htmlEmpty || attachments.length > 0) && !sending && uploading === 0;

  return (
    <div className="relative flex-shrink-0" style={{ borderTop: '1px solid var(--color-border)' }}>
      <style>{`
        .bsx-chat-ed:empty:before { content: attr(data-ph); color: var(--color-text-tertiary); }
        .bsx-chat-ed img { max-width: 220px; max-height: 200px; border-radius: 8px; margin: 4px 0; }
        .bsx-chat-ed a { color: var(--color-primary-600); text-decoration: underline; }
        .bsx-chat-ed ul { list-style: disc; padding-left: 1.2rem; }
        .bsx-chat-ed ol { list-style: decimal; padding-left: 1.2rem; }
        .bsx-mention { background: var(--color-primary-100); color: var(--color-primary-700); border-radius: 5px; padding: 0 3px; font-weight: 600; }
      `}</style>

      {/* Suggestion dropdown */}
      {sug && matches.length > 0 && (
        <div className="absolute bottom-full left-3 right-3 mb-2 rounded-xl overflow-hidden z-30 max-h-60 overflow-y-auto"
          style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-lg)' }}>
          <div className="px-3 py-1.5 text-xs font-bold uppercase tracking-wide flex items-center gap-1.5"
            style={{ color: 'var(--color-text-tertiary)', borderBottom: '1px solid var(--color-border)' }}>
            {sug.kind === 'template' ? <><Slash size={11} /> Shortcuts</> : <>@ Mention</>}
          </div>
          {matches.map((it, i) => (
            <button key={it.id} type="button"
              onMouseDown={(e) => { e.preventDefault(); choose(i); }}
              onMouseEnter={() => setHighlight(i)}
              className="w-full text-left px-3 py-2 flex items-center gap-2 transition-colors"
              style={{ backgroundColor: i === highlight ? 'var(--color-primary-50, #f5f3ff)' : 'transparent' }}>
              {sug.kind === 'mention' ? (
                <>
                  <Avatar name={it.name} size={26} />
                  <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{it.name}</span>
                  {it.role && <span className="text-[10px] px-1.5 py-0.5 rounded ml-auto" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}>{it.role}</span>}
                </>
              ) : (
                <>
                  {it.shortcut && <span className="text-xs font-mono font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>/{it.shortcut}</span>}
                  <span className="text-sm truncate" style={{ color: 'var(--color-text)' }}>{it.text.length > 64 ? `${it.text.slice(0, 64)}…` : it.text}</span>
                </>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Attachment chips */}
      {(attachments.length > 0 || uploading > 0) && (
        <div className="flex flex-wrap gap-2 px-3 pt-2.5">
          {attachments.map((a, i) => (
            <div key={i} className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
              {a.kind === 'image'
                ? <img src={a.url} alt={a.name} className="w-9 h-9 rounded object-cover" />
                : <span className="w-9 h-9 rounded flex items-center justify-center" style={{ backgroundColor: 'var(--color-surface)' }}><FileText size={16} style={{ color: 'var(--color-primary-600)' }} /></span>}
              <span className="text-xs max-w-[120px] truncate" style={{ color: 'var(--color-text-secondary)' }}>{a.name}</span>
              <button onClick={() => removeAttachment(i)} className="p-0.5 rounded hover:bg-bg-secondary" style={{ color: 'var(--color-text-tertiary)' }}><X size={13} /></button>
            </div>
          ))}
          {uploading > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}>
              <Loader2 size={13} className="animate-spin" /> Uploading…
            </div>
          )}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-0.5 flex-wrap px-2.5 pt-2">
        <ToolBtn title="Bold" onClick={() => exec('bold')}><Bold size={15} /></ToolBtn>
        <ToolBtn title="Italic" onClick={() => exec('italic')}><Italic size={15} /></ToolBtn>
        <ToolBtn title="Underline" onClick={() => exec('underline')}><Underline size={15} /></ToolBtn>
        <span className="w-px h-5 mx-1" style={{ backgroundColor: 'var(--color-border)' }} />
        <ToolBtn title="Bullet list" onClick={() => exec('insertUnorderedList')}><List size={15} /></ToolBtn>
        <ToolBtn title="Numbered list" onClick={() => exec('insertOrderedList')}><ListOrdered size={15} /></ToolBtn>
        <ToolBtn title="Insert link" onClick={addLink}><Link2 size={15} /></ToolBtn>
        <span className="w-px h-5 mx-1" style={{ backgroundColor: 'var(--color-border)' }} />
        <ToolBtn title="Insert image" onClick={() => imgRef.current?.click()}><ImageIcon size={15} /></ToolBtn>
        <ToolBtn title="Attach file" onClick={() => fileRef.current?.click()}><Paperclip size={15} /></ToolBtn>
        <ToolBtn title="Message shortcuts" onClick={() => setMgrOpen(true)}><Command size={15} /></ToolBtn>
        <input ref={imgRef} type="file" accept="image/*" className="hidden" onChange={onPickImage} />
        <input ref={fileRef} type="file" multiple className="hidden" onChange={onPickFile} />
      </div>

      {/* Editor + send */}
      <div className="flex items-end gap-2 px-3 py-2.5">
        <div
          ref={edRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          data-ph="Type a message…  (/ shortcuts · @ mention)"
          onInput={onInput}
          onKeyDown={onKey}
          onMouseUp={detectSuggestion}
          onPaste={onPaste}
          className="bsx-chat-ed flex-1 resize-none rounded-2xl px-4 py-2.5 text-sm focus:outline-none overflow-y-auto"
          style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text)', minHeight: 42, maxHeight: 180 }}
        />
        <button onClick={submit} disabled={!canSend} title="Send"
          className="w-10 h-10 rounded-full flex items-center justify-center text-white flex-shrink-0 disabled:opacity-40 transition-transform hover:scale-105"
          style={{ background: 'var(--gradient-sidebar)' }}>
          {sending ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
        </button>
      </div>

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
