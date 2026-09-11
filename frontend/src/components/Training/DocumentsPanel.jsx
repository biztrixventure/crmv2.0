// ============================================================================
// DocumentsPanel -- the training PDFs, as product cards.
//
// Cards, not a file list, because that is what was asked for and because it is
// the right read: each one is a thing you pick up and work through, not a row
// in a directory. The cover is generated from the document id rather than
// uploaded -- a manager who has to make a thumbnail for every PDF makes one PDF.
//
// OPENING: in-page first. A viewer that dumps the reader into a new tab loses
// the "mark as read" button and the place they were in the portal. The new-tab
// link stays as the escape hatch, and as the fallback for a browser whose PDF
// plugin is switched off -- which is why it is always visible, not just on
// failure (an <iframe> that renders nothing fires no error to catch).
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen, ExternalLink, X, CheckCircle2, Check, FileText, Search,
} from 'lucide-react';
import client from '../../api/client';
import { EmptyState, Loading, PillTabs, accent } from '../UI/kit';

const bytes = (n) => {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

// A stable colour per document, derived from its id. Deterministic so a card
// does not change colour on every render, and drawn from the semantic accents
// already in the theme so both light and dark stay legible.
const TONES = ['primary', 'info', 'success', 'warn', 'danger'];
const toneFor = (id) => {
  let h = 0;
  const s = String(id);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length];
};

function Reader({ doc, finished, onFinish, onClose }) {
  // Esc closes. Without it the only way out of a full-bleed reader is the X,
  // which is exactly the control a PDF viewer hides behind its own toolbar.
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'rgba(0,0,0,0.72)' }}>
      <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0"
        style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
        <FileText size={17} style={{ color: 'var(--color-primary-600)' }} className="flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold m-0 truncate" style={{ color: 'var(--color-text)' }}>{doc.title}</p>
          {doc.description && (
            <p className="text-[11px] m-0 truncate" style={{ color: 'var(--color-text-secondary)' }}>{doc.description}</p>
          )}
        </div>
        <button onClick={() => onFinish(doc.id)} disabled={finished}
          className="text-xs font-bold px-3 h-9 rounded-lg flex items-center gap-1.5 flex-shrink-0 disabled:opacity-60"
          style={{
            background: finished ? 'color-mix(in srgb, var(--color-success-600) 14%, transparent)' : 'var(--color-success-600)',
            color: finished ? 'var(--color-success-600)' : '#fff',
          }}>
          <Check size={13} /> {finished ? 'Read' : 'Mark as read'}
        </button>
        <a href={doc.file_url} target="_blank" rel="noopener noreferrer"
          className="text-xs font-semibold px-3 h-9 rounded-lg flex items-center gap-1.5 flex-shrink-0"
          style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
          <ExternalLink size={13} /> New tab
        </a>
        <button onClick={onClose} aria-label="Close the reader"
          className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
          <X size={16} />
        </button>
      </div>
      <iframe src={doc.file_url} title={doc.title} className="flex-1 w-full" style={{ border: 0, background: '#fff' }} />
    </div>
  );
}

export default function DocumentsPanel({ companyId, done, onOpen, onFinish }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null);
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');

  useEffect(() => {
    let dead = false;
    setLoading(true);
    const params = companyId ? `?company_id=${companyId}` : '';
    client.get(`training/documents${params}`)
      .then(r => { if (!dead) setDocs(r.data.documents || []); })
      .catch(() => { if (!dead) setDocs([]); })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [companyId]);

  const categories = useMemo(() => {
    const seen = [...new Set(docs.map(d => d.category).filter(Boolean))];
    return seen.length > 1 ? [{ key: 'all', label: 'All' }, ...seen.map(c => ({ key: c, label: c }))] : [];
  }, [docs]);

  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => docs.filter(d =>
    (cat === 'all' || d.category === cat)
    && (!needle || `${d.title} ${d.description || ''}`.toLowerCase().includes(needle))
  ), [docs, cat, needle]);

  const openDoc = (d) => { setOpen(d); onOpen?.(d.id); };

  if (loading) return <Loading variant="cards" cards={6} label="Loading the documents" />;

  return (
    <div className="space-y-4">
      {(categories.length > 0 || docs.length > 6) && (
        <div className="flex flex-wrap items-center gap-3">
          {categories.length > 0 && <PillTabs items={categories} value={cat} onChange={setCat} />}
          {docs.length > 6 && (
            <div className="relative" style={{ maxWidth: 300, flex: 1 }}>
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--color-text-tertiary)' }} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search documents…"
                className="input text-sm py-2 pl-9 w-full" />
            </div>
          )}
        </div>
      )}

      {shown.length === 0 ? (
        <EmptyState icon={BookOpen}
          title={docs.length ? 'Nothing matches that' : 'No documents yet'}
          hint={docs.length
            ? 'Clear the search or pick another category.'
            : 'Your manager uploads the training PDFs under Manage → Documents.'} />
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
          {shown.map(d => {
            const a = accent(toneFor(d.id));
            const finished = done?.has(`document:${d.id}`);
            return (
              <button key={d.id} onClick={() => openDoc(d)}
                className="text-left rounded-2xl overflow-hidden transition-transform hover:-translate-y-0.5"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                {/* The cover. Generated, never uploaded -- see the header. */}
                <div className="relative flex items-center justify-center"
                  style={{ height: 128, background: a.soft }}>
                  <FileText size={38} style={{ color: a.fg }} />
                  {finished && (
                    <span className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center"
                      style={{ background: 'var(--color-success-600)' }}>
                      <CheckCircle2 size={14} color="#fff" />
                    </span>
                  )}
                  {d.category && (
                    <span className="absolute bottom-2 left-2 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                      style={{ background: 'var(--color-surface)', color: a.fg }}>
                      {d.category}
                    </span>
                  )}
                </div>
                <div className="p-3">
                  <p className="text-sm font-bold m-0 leading-snug" style={{ color: 'var(--color-text)' }}>{d.title}</p>
                  {d.description && (
                    <p className="text-[11px] m-0 mt-1 line-clamp-2" style={{ color: 'var(--color-text-secondary)' }}>
                      {d.description}
                    </p>
                  )}
                  <p className="text-[10px] m-0 mt-2" style={{ color: 'var(--color-text-tertiary)' }}>
                    PDF{d.file_size ? ` · ${bytes(d.file_size)}` : ''}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {open && (
        <Reader doc={open} finished={done?.has(`document:${open.id}`)}
          onFinish={(id) => onFinish?.(id)} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}
