import { useRef, useEffect } from 'react';
import { Bold, Italic, Underline, List, ListOrdered, Link2, Image as ImageIcon, Upload, Eraser } from 'lucide-react';

// Dependency-free rich text editor (contentEditable + execCommand). Emits HTML
// via onChange. Supports bold/italic/underline, lists, links, and images
// (by URL or small file → base64). execCommand is deprecated but universally
// supported and avoids adding an editor package.
const MAX_IMG_BYTES = 1.5 * 1024 * 1024;

const Btn = ({ title, onClick, children }) => (
  <button type="button" title={title} onMouseDown={e => { e.preventDefault(); onClick(); }}
    className="p-1.5 rounded-lg transition-colors hover:bg-bg-secondary" style={{ color: 'var(--color-text-secondary)' }}>
    {children}
  </button>
);

const RichTextEditor = ({ value, onChange, placeholder = 'Write your announcement…', minHeight = 140 }) => {
  const ref = useRef(null);
  const fileRef = useRef(null);

  // Seed initial HTML once (uncontrolled thereafter to preserve the caret).
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== (value || '')) ref.current.innerHTML = value || '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = () => onChange(ref.current?.innerHTML || '');
  const exec = (cmd, arg = null) => { document.execCommand(cmd, false, arg); ref.current?.focus(); emit(); };

  const addLink = () => { const url = window.prompt('Link URL'); if (url) exec('createLink', url); };
  const addImageUrl = () => { const url = window.prompt('Image URL'); if (url) exec('insertImage', url); };
  const onPickFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_IMG_BYTES) { window.alert('Image too large (max ~1.5 MB). Use an image URL instead.'); return; }
    const reader = new FileReader();
    reader.onload = () => exec('insertImage', reader.result);
    reader.readAsDataURL(file);
  };

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
      <div className="flex items-center gap-0.5 flex-wrap px-2 py-1.5" style={{ backgroundColor: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)' }}>
        <Btn title="Bold" onClick={() => exec('bold')}><Bold size={15} /></Btn>
        <Btn title="Italic" onClick={() => exec('italic')}><Italic size={15} /></Btn>
        <Btn title="Underline" onClick={() => exec('underline')}><Underline size={15} /></Btn>
        <span className="w-px h-5 mx-1" style={{ backgroundColor: 'var(--color-border)' }} />
        <Btn title="Bullet list" onClick={() => exec('insertUnorderedList')}><List size={15} /></Btn>
        <Btn title="Numbered list" onClick={() => exec('insertOrderedList')}><ListOrdered size={15} /></Btn>
        <span className="w-px h-5 mx-1" style={{ backgroundColor: 'var(--color-border)' }} />
        <Btn title="Insert link" onClick={addLink}><Link2 size={15} /></Btn>
        <Btn title="Insert image by URL" onClick={addImageUrl}><ImageIcon size={15} /></Btn>
        <Btn title="Upload image" onClick={() => fileRef.current?.click()}><Upload size={15} /></Btn>
        <span className="w-px h-5 mx-1" style={{ backgroundColor: 'var(--color-border)' }} />
        <Btn title="Clear formatting" onClick={() => exec('removeFormat')}><Eraser size={15} /></Btn>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickFile} />
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        data-placeholder={placeholder}
        className="bsx-rte px-3 py-2.5 text-sm outline-none overflow-y-auto"
        style={{ minHeight, maxHeight: 320, color: 'var(--color-text)', backgroundColor: 'var(--color-surface)' }}
      />
      <style>{`
        .bsx-rte:empty:before { content: attr(data-placeholder); color: var(--color-text-tertiary); }
        .bsx-rte img { max-width: 100%; height: auto; border-radius: 8px; margin: 4px 0; }
        .bsx-rte a { color: var(--color-primary-600); text-decoration: underline; }
        .bsx-rte ul { list-style: disc; padding-left: 1.25rem; }
        .bsx-rte ol { list-style: decimal; padding-left: 1.25rem; }
      `}</style>
    </div>
  );
};

export default RichTextEditor;
