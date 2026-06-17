import { useEffect, useMemo, useState } from 'react';
import {
  HelpCircle, Search, ChevronDown, X, Tag, LayoutGrid, BookOpen,
} from 'lucide-react';
import { useFaqs } from '../../hooks/useFaqs';
import { useCategories } from '../Admin/shared/CategorySystem';
import { useSearchTools } from '../../hooks/useSearchTools';
import { rankItems } from '../../utils/smartSearch';

const AUDIENCE_LABEL = { closer: 'Closer', fronter: 'Fronter', both: 'General' };

const splitKeywords = (kw) => (kw || '').split(',').map(k => k.trim()).filter(Boolean);

// Highlight search matches inside a string
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

// ── FAQ accordion card ──────────────────────────────────────────────────────
const FAQCard = ({ faq, open, onToggle, q }) => (
  <div className="rounded-2xl overflow-hidden transition-all duration-200"
    style={{
      backgroundColor: 'var(--color-surface)',
      border: `1px solid ${open ? 'var(--color-primary-300)' : 'var(--color-border)'}`,
      boxShadow: open ? 'var(--shadow-md)' : 'none',
    }}>
    <button onClick={onToggle} className="w-full flex items-start gap-3 p-4 sm:p-5 text-left group">
      <span className="mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-all"
        style={{ backgroundColor: open ? 'var(--color-primary-600)' : 'var(--color-bg-secondary)' }}>
        <HelpCircle size={15} style={{ color: open ? 'white' : 'var(--color-primary-600)' }} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-semibold leading-snug" style={{ color: 'var(--color-text)' }}>
          {highlight(faq.question, q)}
        </p>
        {!open && (
          <p className="text-xs mt-1 line-clamp-1" style={{ color: 'var(--color-text-secondary)' }}>{faq.answer}</p>
        )}
        {splitKeywords(faq.keywords).length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {splitKeywords(faq.keywords).slice(0, open ? 99 : 5).map(k => (
              <span key={k} className="text-[10px] px-1.5 py-0.5 rounded-md font-medium inline-flex items-center gap-0.5"
                style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
                <Tag size={8} /> {k}
              </span>
            ))}
          </div>
        )}
      </div>
      <ChevronDown size={18} className="flex-shrink-0 mt-1 transition-transform duration-200"
        style={{ color: 'var(--color-text-tertiary)', transform: open ? 'rotate(180deg)' : 'none' }} />
    </button>

    {open && (
      <div className="px-4 sm:px-5 pb-5 pl-[3.75rem] animate-fade-in">
        <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Answer</p>
        <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>{faq.answer}</p>
      </div>
    )}
  </div>
);

// ── Topic sidebar button ────────────────────────────────────────────────────
const TopicButton = ({ active, label, count, icon: Icon, onClick }) => (
  <button onClick={onClick}
    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-all text-left"
    style={{
      background: active ? 'var(--gradient-sidebar)' : 'transparent',
      color: active ? 'white' : 'var(--color-text-secondary)',
    }}
    onMouseEnter={e => { if (!active) e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)'; }}
    onMouseLeave={e => { if (!active) e.currentTarget.style.backgroundColor = 'transparent'; }}>
    {Icon && <Icon size={15} className="flex-shrink-0" />}
    <span className="flex-1 truncate capitalize">{label}</span>
    <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-md flex-shrink-0"
      style={{ backgroundColor: active ? 'rgba(255,255,255,0.22)' : 'var(--color-bg-secondary)', color: active ? 'white' : 'var(--color-text-tertiary)' }}>
      {count}
    </span>
  </button>
);

const FAQPanel = () => {
  const { faqs, loading, error, fetchFaqs } = useFaqs();
  const [query, setQuery]       = useState('');
  const [audience, setAudience] = useState('');
  const [topic, setTopic]       = useState('');     // selected keyword/topic
  const [categoryId, setCategoryId] = useState(''); // selected category
  const [expanded, setExpanded] = useState(null);
  const { categories } = useCategories('faqs');
  const { synMap, logSearch }   = useSearchTools('faq');

  useEffect(() => { fetchFaqs(); }, [fetchFaqs]);

  // Audience segmented control only when the agent sees more than one bucket
  const audiences = useMemo(() => {
    const present = [...new Set(faqs.map(f => f.audience))];
    return present.length > 1 ? present : [];
  }, [faqs]);

  // Topics = keyword tags ranked by frequency (respecting the audience filter)
  const audienceScoped = useMemo(
    () => faqs.filter(f => !audience || f.audience === audience),
    [faqs, audience],
  );

  const topics = useMemo(() => {
    const counts = {};
    audienceScoped.forEach(f => splitKeywords(f.keywords).forEach(k => {
      const key = k.toLowerCase();
      counts[key] = (counts[key] || 0) + 1;
    }));
    return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [audienceScoped]);

  // Category filter, then topic, then ranked search.
  const categoryScoped = useMemo(
    () => (categoryId ? audienceScoped.filter(f => (f.category_ids || []).includes(categoryId)) : audienceScoped),
    [audienceScoped, categoryId],
  );
  const topicScoped = useMemo(
    () => (topic ? categoryScoped.filter(f => splitKeywords(f.keywords).some(k => k.toLowerCase() === topic)) : categoryScoped),
    [categoryScoped, topic],
  );
  const filtered = useMemo(() => rankItems(query, topicScoped, [
    { get: f => f.question, weight: 5 },
    { get: f => f.keywords, weight: 4 },
    { get: f => f.answer,   weight: 2 },
  ], synMap), [topicScoped, query, synMap]);

  // Track searches for the superadmin analytics (debounced inside the hook).
  useEffect(() => { logSearch(query, filtered.length); }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearFilters = () => { setQuery(''); setTopic(''); setCategoryId(''); };
  const hasFilters = query || topic || categoryId;

  return (
    <div className="animate-fade-in">
      {/* Hero header */}
      <div className="rounded-2xl p-6 sm:p-7 mb-5 relative overflow-hidden"
        style={{ background: 'var(--gradient-sidebar)' }}>
        <div className="relative z-10">
          <div className="flex items-center gap-2.5 mb-1">
            <BookOpen size={22} className="text-white" />
            <h2 className="text-2xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>Knowledge Base</h2>
          </div>
          <p className="text-sm text-white/80 max-w-xl">
            Search answers, rebuttals, and ready-to-use call scripts to handle customer questions and objections in seconds.
          </p>
          {/* Prominent search */}
          <div className="relative mt-4 max-w-2xl">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
            <input value={query} onChange={e => setQuery(e.target.value)} autoFocus
              placeholder="Search by keyword, question, or answer…"
              className="w-full pl-11 pr-10 py-3 rounded-xl text-sm font-medium outline-none"
              style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', border: 'none', boxShadow: 'var(--shadow-lg)' }} />
            {query && (
              <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--color-text-tertiary)' }}><X size={16} /></button>
            )}
          </div>
        </div>
        {/* decorative glow */}
        <div className="absolute -right-12 -top-12 w-48 h-48 rounded-full opacity-20"
          style={{ background: 'radial-gradient(circle, white, transparent 70%)' }} />
      </div>

      {error && <p className="text-sm mb-3" style={{ color: 'var(--color-error-600)' }}>{error}</p>}

      {/* Mobile topic chips */}
      {topics.length > 0 && (
        <div className="lg:hidden flex gap-1.5 overflow-x-auto pb-2 mb-3 -mx-1 px-1">
          <button onClick={() => setTopic('')}
            className="px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all"
            style={{ background: topic === '' ? 'var(--gradient-sidebar)' : 'var(--color-bg-secondary)', color: topic === '' ? 'white' : 'var(--color-text-secondary)' }}>
            All ({audienceScoped.length})
          </button>
          {topics.map(([t, c]) => (
            <button key={t} onClick={() => setTopic(topic === t ? '' : t)}
              className="px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap capitalize transition-all"
              style={{ background: topic === t ? 'var(--gradient-sidebar)' : 'var(--color-bg-secondary)', color: topic === t ? 'white' : 'var(--color-text-secondary)' }}>
              {t} ({c})
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-5">
        {/* Sidebar (desktop) */}
        <aside className="hidden lg:block">
          <div className="sticky top-4 space-y-4">
            {audiences.length > 0 && (
              <div className="rounded-2xl p-3" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <p className="text-[10px] font-bold uppercase tracking-widest px-2 mb-2" style={{ color: 'var(--color-text-tertiary)' }}>Audience</p>
                <div className="space-y-0.5">
                  <TopicButton active={audience === ''} label="Everyone" count={faqs.length} onClick={() => { setAudience(''); setTopic(''); }} />
                  {audiences.map(a => (
                    <TopicButton key={a} active={audience === a} label={AUDIENCE_LABEL[a] || a}
                      count={faqs.filter(f => f.audience === a).length} onClick={() => { setAudience(a); setTopic(''); }} />
                  ))}
                </div>
              </div>
            )}

            {categories.length > 0 && (
              <div className="rounded-2xl p-3" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <p className="text-[10px] font-bold uppercase tracking-widest px-2 mb-2" style={{ color: 'var(--color-text-tertiary)' }}>Categories</p>
                <div className="space-y-0.5 max-h-[40vh] overflow-y-auto">
                  <TopicButton active={categoryId === ''} label="All categories" count={audienceScoped.length} icon={LayoutGrid} onClick={() => setCategoryId('')} />
                  {categories.map(c => (
                    <TopicButton key={c.id} active={categoryId === c.id} label={c.name}
                      count={audienceScoped.filter(f => (f.category_ids || []).includes(c.id)).length} icon={Tag}
                      onClick={() => setCategoryId(categoryId === c.id ? '' : c.id)} />
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-2xl p-3" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <p className="text-[10px] font-bold uppercase tracking-widest px-2 mb-2" style={{ color: 'var(--color-text-tertiary)' }}>Browse by Topic</p>
              <div className="space-y-0.5 max-h-[60vh] overflow-y-auto">
                <TopicButton active={topic === ''} label="All FAQs" count={audienceScoped.length} icon={LayoutGrid} onClick={() => setTopic('')} />
                {topics.map(([t, c]) => (
                  <TopicButton key={t} active={topic === t} label={t} count={c} icon={Tag} onClick={() => setTopic(topic === t ? '' : t)} />
                ))}
              </div>
            </div>
          </div>
        </aside>

        {/* Main list */}
        <main>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              <span className="font-bold" style={{ color: 'var(--color-text)' }}>{filtered.length}</span> result{filtered.length !== 1 ? 's' : ''}
              {topic && <> in <span className="font-semibold capitalize" style={{ color: 'var(--color-primary-600)' }}>{topic}</span></>}
            </p>
            {hasFilters && (
              <button onClick={clearFilters}
                className="text-xs font-semibold inline-flex items-center gap-1 px-2.5 py-1 rounded-lg transition-colors"
                style={{ color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-bg-secondary)' }}>
                <X size={12} /> Clear filters
              </button>
            )}
          </div>

          {loading ? (
            <div className="space-y-2.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-16 rounded-2xl animate-pulse" style={{ backgroundColor: 'var(--color-bg-secondary)' }} />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-2xl p-12 text-center" style={{ backgroundColor: 'var(--color-surface)', border: '1px dashed var(--color-border)' }}>
              <HelpCircle size={44} className="mx-auto mb-3" style={{ color: 'var(--color-text-tertiary)', opacity: 0.5 }} />
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                {hasFilters ? 'No FAQs match your search.' : 'No FAQs available yet.'}
              </p>
              {hasFilters && (
                <button onClick={clearFilters} className="mt-3 text-sm font-semibold" style={{ color: 'var(--color-primary-600)' }}>
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2.5">
              {filtered.map(faq => (
                <FAQCard key={faq.id} faq={faq} q={query.trim()}
                  open={expanded === faq.id}
                  onToggle={() => setExpanded(expanded === faq.id ? null : faq.id)} />
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default FAQPanel;
