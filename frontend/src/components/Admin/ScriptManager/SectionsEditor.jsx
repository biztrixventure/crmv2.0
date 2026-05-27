import { useRef, useState } from 'react';
import { GripVertical, Plus, Trash2, X, Tag } from 'lucide-react';
import RichTextEditor from '../../UI/RichTextEditor';

const splitTags = (s) => (s || '').split(',').map(t => t.trim()).filter(Boolean);

// Chip-style tag editor with drag-to-reorder. Serializes back to a comma string
// so it stays compatible with the existing `tags` storage.
const TagChips = ({ value, onChange }) => {
  const tags = splitTags(value);
  const [input, setInput] = useState('');
  const dragIdx = useRef(null);

  const commit = (next) => onChange(next.join(', '));
  const add = (raw) => {
    const t = raw.trim().replace(/,/g, '');
    if (!t || tags.some(x => x.toLowerCase() === t.toLowerCase())) { setInput(''); return; }
    commit([...tags, t]); setInput('');
  };
  const remove = (i) => commit(tags.filter((_, idx) => idx !== i));
  const onDrop = (i) => {
    const from = dragIdx.current;
    if (from == null || from === i) return;
    const next = [...tags]; const [m] = next.splice(from, 1); next.splice(i, 0, m);
    commit(next); dragIdx.current = null;
  };

  return (
    <div className="flex flex-wrap gap-1.5 items-center p-2 rounded-lg" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <Tag size={13} style={{ color: 'var(--color-text-tertiary)' }} />
      {tags.map((t, i) => (
        <span key={t} draggable
          onDragStart={() => { dragIdx.current = i; }}
          onDragOver={e => e.preventDefault()}
          onDrop={() => onDrop(i)}
          className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-md cursor-grab select-none"
          style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>
          <GripVertical size={10} className="opacity-60" />
          {t}
          <button type="button" onClick={() => remove(i)} className="hover:opacity-70"><X size={11} /></button>
        </span>
      ))}
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(input); } else if (e.key === 'Backspace' && !input && tags.length) { remove(tags.length - 1); } }}
        onBlur={() => add(input)}
        placeholder={tags.length ? 'add tag…' : 'Add tags (Enter or comma) — these surface this paragraph'}
        className="text-xs bg-transparent outline-none flex-1 min-w-[120px]"
        style={{ color: 'var(--color-text)' }}
      />
    </div>
  );
};

// Drag-reorderable list of tagged, rich-text script headings.
// sections = [{ heading, content (HTML), tags (comma string) }]
const SectionsEditor = ({ sections = [], onChange }) => {
  const dragIdx = useRef(null);
  const update = (i, k, v) => onChange(sections.map((s, idx) => idx === i ? { ...s, [k]: v } : s));
  const add    = () => onChange([...sections, { heading: '', tags: '', content: '' }]);
  const remove = (i) => onChange(sections.filter((_, idx) => idx !== i));
  const onDrop = (i) => {
    const from = dragIdx.current;
    if (from == null || from === i) return;
    const next = [...sections]; const [m] = next.splice(from, 1); next.splice(i, 0, m);
    onChange(next); dragIdx.current = null;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[11px] font-bold uppercase tracking-wide flex items-center gap-1.5" style={{ color: 'var(--color-text-secondary)' }}>
          <Tag size={12} /> Tagged headings (rich text)
        </label>
        <button type="button" onClick={add} className="text-xs font-semibold flex items-center gap-1" style={{ color: 'var(--color-primary-600)' }}>
          <Plus size={13} /> Add heading
        </button>
      </div>
      <p className="text-[11px] mb-2" style={{ color: 'var(--color-text-tertiary)' }}>
        Each heading has its own tags + formatted paragraph. When an agent clicks/searches a tag, only that paragraph is shown. Drag the handle to reorder headings; drag chips to reorder tags.
      </p>

      <div className="space-y-2.5">
        {sections.map((sec, i) => (
          <div key={i}
            onDragOver={e => e.preventDefault()}
            onDrop={() => onDrop(i)}
            className="rounded-xl p-3 space-y-2"
            style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center gap-2">
              <span draggable onDragStart={() => { dragIdx.current = i; }}
                className="cursor-grab p-1 rounded" title="Drag to reorder" style={{ color: 'var(--color-text-tertiary)' }}>
                <GripVertical size={16} />
              </span>
              <input value={sec.heading} onChange={e => update(i, 'heading', e.target.value)}
                placeholder="Heading (e.g. Price Objection)" className="input flex-1" />
              <button type="button" onClick={() => remove(i)} className="p-1.5 rounded-lg flex-shrink-0" style={{ color: '#ef4444' }} title="Remove heading"><Trash2 size={14} /></button>
            </div>
            <TagChips value={sec.tags} onChange={v => update(i, 'tags', v)} />
            <RichTextEditor value={sec.content} onChange={html => update(i, 'content', html)}
              placeholder="The formatted paragraph agents read for this heading…" minHeight={90} />
          </div>
        ))}
        {sections.length === 0 && (
          <button type="button" onClick={add}
            className="w-full py-3 rounded-xl text-sm font-semibold border-2 border-dashed transition-colors"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-tertiary)' }}>
            <Plus size={14} className="inline mr-1" /> Add a tagged heading
          </button>
        )}
      </div>
    </div>
  );
};

export default SectionsEditor;
