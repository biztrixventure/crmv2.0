import { useEffect, useMemo, useState } from 'react';
import {
  FileText, Search, ChevronDown, X, Tag, LayoutGrid, Copy, Check, MessageSquareText,
} from 'lucide-react';
import { useScripts } from '../../hooks/useScripts';
import { useCategories } from '../Admin/shared/CategorySystem';
import { useSearchTools } from '../../hooks/useSearchTools';
import { rankItems } from '../../utils/smartSearch';
import RichView from '../UI/RichView';

const splitKeywords = (kw) => (kw || '').split(',').map(k => k.trim()).filter(Boolean);

const highlight = (text, q) => {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i === -1) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)', borderRadius: 3, padding: '0 2px' }}>
        {text.slice(i, i + q.length)}
      </mark>
      {text.slice(i + q.length)}
    </>
  );
};

const CopyButton = ({ text }) => {
  const [copied, setCopied] = useState(false);
  const copy = async (e) => {
    e.stopPropagation();
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ }
  };
  return (
    <button onClick={copy}
      className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-all hover:scale-[1.03]"
      style={{ color: copied ? 'var(--color-success-600)' : 'var(--color-primary-600)', backgroundColor: copied ? 'var(--color-success-50)' : 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
    </button>
  );
};

const TopicButton = ({ active, label, count, icon: Icon, onClick }) => (
  <button onClick={onClick}
    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-all text-left"
    style={{ background: active ? 'var(--gradient-sidebar)' : 'transparent', color: active ? 'white' : 'var(--color-text-secondary)' }}
    onMouseEnter={e => { if (!active) e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)'; }}
    onMouseLeave={e => { if (!active) e.currentTarget.style.backgroundColor = 'transparent'; }}>
    {Icon && <Icon size={15} className="flex-shrink-0" />}
    <span className="flex-1 truncate capitalize">{label}</span>
    <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-md flex-shrink-0"
      style={{ backgroundColor: active ? 'rgba(255,255,255,0.22)' : 'var(--color-bg-secondary)', color: active ? 'white' : 'var(--color-text-tertiary)' }}>{count}</span>
  </button>
);

const stripHtml = (h) => (h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const sectionMatches = (sec, q) => {
  const ql = (q || '').trim().toLowerCase();
  if (!ql) return false;
  return `${sec.heading} ${sec.tags} ${stripHtml(sec.content)}`.toLowerCase().includes(ql);
};

const ScriptCard = ({ script, open, onToggle, q }) => {
  const [tagFilter, setTagFilter] = useState('');
  const sections = Array.isArray(script.sections) ? script.sections : [];
  const ql = (q || '').trim().toLowerCase();
  const matched = ql ? sections.filter(s => sectionMatches(s, q)) : [];
  const isOpen  = open || (!!ql && matched.length > 0);   // auto-open on a search hit

  const hasTag = (sec, t) => splitKeywords(sec.tags).some(x => x.toLowerCase() === t);
  // Click a tag → show ONLY that heading's paragraph; else a search shows only
  // matching paragraphs; otherwise the whole script.
  const visible = tagFilter ? sections.filter(s => hasTag(s, tagFilter))
    : (ql && matched.length ? matched : sections);

  return (
  <div className="rounded-2xl overflow-hidden transition-all duration-200"
    style={{ backgroundColor: 'var(--color-surface)', border: `1px solid ${isOpen ? 'var(--color-primary-300)' : 'var(--color-border)'}`, boxShadow: isOpen ? 'var(--shadow-md)' : 'none' }}>
    <button onClick={onToggle} className="w-full flex items-start gap-3 p-4 sm:p-5 text-left">
      <span className="mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-all"
        style={{ backgroundColor: isOpen ? 'var(--color-primary-600)' : 'var(--color-bg-secondary)' }}>
        <MessageSquareText size={15} style={{ color: isOpen ? 'white' : 'var(--color-primary-600)' }} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-semibold leading-snug" style={{ color: 'var(--color-text)' }}>{highlight(script.title, q)}</p>
        {!isOpen && <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--color-text-secondary)' }}>{script.content}</p>}
        {!isOpen && matched.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {matched.slice(0, 4).map((s, i) => (
              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-md font-semibold inline-flex items-center gap-1"
                style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>↳ {s.heading || 'section'}</span>
            ))}
          </div>
        )}
        {splitKeywords(script.keywords).length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {splitKeywords(script.keywords).slice(0, isOpen ? 99 : 6).map(k => (
              <span key={k} className="text-[10px] px-1.5 py-0.5 rounded-md font-medium inline-flex items-center gap-0.5"
                style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}><Tag size={8} /> {k}</span>
            ))}
          </div>
        )}
      </div>
      <ChevronDown size={18} className="flex-shrink-0 mt-1 transition-transform duration-200"
        style={{ color: 'var(--color-text-tertiary)', transform: isOpen ? 'rotate(180deg)' : 'none' }} />
    </button>
    {isOpen && (
      <div className="px-4 sm:px-5 pb-5 pl-[3.75rem] animate-fade-in space-y-3">
        {script.content && (
          <>
            <div className="flex justify-end"><CopyButton text={script.content} /></div>
            <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>{highlight(script.content, q)}</p>
          </>
        )}

        {/* Tag filter bar — set by clicking a heading's tag */}
        {tagFilter && (
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            Showing only headings tagged
            <span className="px-1.5 py-0.5 rounded font-bold" style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>{tagFilter}</span>
            <button onClick={() => setTagFilter('')} className="font-semibold underline">show all</button>
          </div>
        )}

        {visible.map((sec, i) => {
          const hit = sectionMatches(sec, q);
          return (
            <div key={i} className="rounded-xl p-3"
              style={{ backgroundColor: 'var(--color-bg-secondary)', border: `1px solid ${hit ? 'var(--color-primary-400)' : 'var(--color-border)'}`, boxShadow: hit ? '0 0 0 2px var(--color-primary-100)' : 'none' }}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>{highlight(sec.heading || '', q)}</p>
                {sec.content && <CopyButton text={stripHtml(sec.content)} />}
              </div>
              {splitKeywords(sec.tags).length > 0 && (
                <div className="flex flex-wrap gap-1 my-1.5">
                  {splitKeywords(sec.tags).map(t => {
                    const tl = t.toLowerCase();
                    const active = tagFilter === tl;
                    return (
                      <button key={t} onClick={() => setTagFilter(active ? '' : tl)}
                        className="text-[10px] px-1.5 py-0.5 rounded font-medium inline-flex items-center gap-0.5 transition-all hover:scale-105"
                        style={{ backgroundColor: active ? 'var(--color-primary-600)' : 'var(--color-primary-100)', color: active ? '#fff' : 'var(--color-primary-700)' }}
                        title="Show only this heading">
                        <Tag size={8} /> {t}
                      </button>
                    );
                  })}
                </div>
              )}
              <RichView html={sec.content} className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }} />
            </div>
          );
        })}
        {visible.length === 0 && (
          <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>No heading tagged “{tagFilter}”.</p>
        )}
      </div>
    )}
  </div>
  );
};

const ScriptPanel = () => {
  const { scripts, loading, error, fetchScripts } = useScripts();
  const [query, setQuery]     = useState('');
  const [topic, setTopic]     = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [expanded, setExpanded] = useState(null);
  const { synMap, logSearch } = useSearchTools('script');
  const { categories } = useCategories('scripts');

  useEffect(() => { fetchScripts(); }, [fetchScripts]);

  const topics = useMemo(() => {
    const counts = {};
    scripts.forEach(s => splitKeywords(s.keywords).forEach(k => { const key = k.toLowerCase(); counts[key] = (counts[key] || 0) + 1; }));
    return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [scripts]);

  const categoryScoped = useMemo(
    () => (categoryId ? scripts.filter(s => (s.category_ids || []).includes(categoryId)) : scripts),
    [scripts, categoryId],
  );
  const topicScoped = useMemo(
    () => (topic ? categoryScoped.filter(s => splitKeywords(s.keywords).some(k => k.toLowerCase() === topic)) : categoryScoped),
    [categoryScoped, topic],
  );
  const secText = (s, part) => (Array.isArray(s.sections) ? s.sections.map(x => part === 'content' ? stripHtml(x.content) : (x[part] || '')).join('  ') : '');
  const filtered = useMemo(() => rankItems(query, topicScoped, [
    { get: s => s.title,    weight: 5 },
    { get: s => s.keywords, weight: 4 },
    { get: s => `${secText(s, 'heading')}  ${secText(s, 'tags')}`, weight: 4 },  // tagged headings
    { get: s => s.content,  weight: 2 },
    { get: s => secText(s, 'content'), weight: 2 },
  ], synMap), [topicScoped, query, synMap]);

  useEffect(() => { logSearch(query, filtered.length); }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearFilters = () => { setQuery(''); setTopic(''); setCategoryId(''); };
  const hasFilters = query || topic || categoryId;

  return (
    <div className="animate-fade-in">
      <div className="rounded-2xl p-6 sm:p-7 mb-5 relative overflow-hidden" style={{ background: 'var(--gradient-sidebar)' }}>
        <div className="relative z-10">
          <div className="flex items-center gap-2.5 mb-1">
            <FileText size={22} className="text-white" />
            <h2 className="text-2xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>Scripts</h2>
          </div>
          <p className="text-sm text-white/80 max-w-xl">Ready-to-read call scripts. Search or browse, then copy what you need mid-call.</p>
          <div className="relative mt-4 max-w-2xl">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
            <input value={query} onChange={e => setQuery(e.target.value)} autoFocus placeholder="Search scripts by title, content, or keyword…"
              className="w-full pl-11 pr-10 py-3 rounded-xl text-sm font-medium outline-none"
              style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', border: 'none', boxShadow: 'var(--shadow-lg)' }} />
            {query && <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }}><X size={16} /></button>}
          </div>
        </div>
        <div className="absolute -right-12 -top-12 w-48 h-48 rounded-full opacity-20" style={{ background: 'radial-gradient(circle, white, transparent 70%)' }} />
      </div>

      {error && <p className="text-sm mb-3" style={{ color: 'var(--color-error-600)' }}>{error}</p>}

      {topics.length > 0 && (
        <div className="lg:hidden flex gap-1.5 overflow-x-auto pb-2 mb-3 -mx-1 px-1">
          <button onClick={() => setTopic('')} className="px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all"
            style={{ background: topic === '' ? 'var(--gradient-sidebar)' : 'var(--color-bg-secondary)', color: topic === '' ? 'white' : 'var(--color-text-secondary)' }}>All ({scripts.length})</button>
          {topics.map(([t, c]) => (
            <button key={t} onClick={() => setTopic(topic === t ? '' : t)} className="px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap capitalize transition-all"
              style={{ background: topic === t ? 'var(--gradient-sidebar)' : 'var(--color-bg-secondary)', color: topic === t ? 'white' : 'var(--color-text-secondary)' }}>{t} ({c})</button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-5">
        <aside className="hidden lg:block">
          <div className="sticky top-4 space-y-4">
          {categories.length > 0 && (
            <div className="rounded-2xl p-3" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <p className="text-[10px] font-bold uppercase tracking-widest px-2 mb-2" style={{ color: 'var(--color-text-tertiary)' }}>Categories</p>
              <div className="space-y-0.5 max-h-[40vh] overflow-y-auto">
                <TopicButton active={categoryId === ''} label="All categories" count={scripts.length} icon={LayoutGrid} onClick={() => setCategoryId('')} />
                {categories.map(c => (
                  <TopicButton key={c.id} active={categoryId === c.id} label={c.name}
                    count={scripts.filter(s => (s.category_ids || []).includes(c.id)).length} icon={Tag}
                    onClick={() => setCategoryId(categoryId === c.id ? '' : c.id)} />
                ))}
              </div>
            </div>
          )}
          <div className="rounded-2xl p-3" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <p className="text-[10px] font-bold uppercase tracking-widest px-2 mb-2" style={{ color: 'var(--color-text-tertiary)' }}>Browse by Topic</p>
            <div className="space-y-0.5 max-h-[60vh] overflow-y-auto">
              <TopicButton active={topic === ''} label="All Scripts" count={scripts.length} icon={LayoutGrid} onClick={() => setTopic('')} />
              {topics.map(([t, c]) => <TopicButton key={t} active={topic === t} label={t} count={c} icon={Tag} onClick={() => setTopic(topic === t ? '' : t)} />)}
            </div>
          </div>
          </div>
        </aside>

        <main>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              <span className="font-bold" style={{ color: 'var(--color-text)' }}>{filtered.length}</span> script{filtered.length !== 1 ? 's' : ''}
              {topic && <> in <span className="font-semibold capitalize" style={{ color: 'var(--color-primary-600)' }}>{topic}</span></>}
            </p>
            {hasFilters && <button onClick={clearFilters} className="text-xs font-semibold inline-flex items-center gap-1 px-2.5 py-1 rounded-lg transition-colors" style={{ color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-bg-secondary)' }}><X size={12} /> Clear filters</button>}
          </div>

          {loading ? (
            <div className="space-y-2.5">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 rounded-2xl animate-pulse" style={{ backgroundColor: 'var(--color-bg-secondary)' }} />)}</div>
          ) : filtered.length === 0 ? (
            <div className="rounded-2xl p-12 text-center" style={{ backgroundColor: 'var(--color-surface)', border: '1px dashed var(--color-border)' }}>
              <FileText size={44} className="mx-auto mb-3" style={{ color: 'var(--color-text-tertiary)', opacity: 0.5 }} />
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{hasFilters ? 'No scripts match your search.' : 'No scripts available yet.'}</p>
              {hasFilters && <button onClick={clearFilters} className="mt-3 text-sm font-semibold" style={{ color: 'var(--color-primary-600)' }}>Clear filters</button>}
            </div>
          ) : (
            <div className="space-y-2.5">
              {filtered.map(s => <ScriptCard key={s.id} script={s} q={query.trim()} open={expanded === s.id} onToggle={() => setExpanded(expanded === s.id ? null : s.id)} />)}
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default ScriptPanel;
