import { useEffect, useMemo, useState } from 'react';
import { HelpCircle, Search, ChevronDown, ChevronRight, MessageSquareText, Copy, Check, X } from 'lucide-react';
import { Card } from '../UI';
import { useFaqs } from '../../hooks/useFaqs';

const AUDIENCE_LABEL = { closer: 'Closer', fronter: 'Fronter', both: 'General' };

const splitKeywords = (kw) => (kw || '').split(',').map(k => k.trim()).filter(Boolean);

const CopyButton = ({ text }) => {
  const [copied, setCopied] = useState(false);
  const copy = async (e) => {
    e.stopPropagation();
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ }
  };
  return (
    <button onClick={copy}
      className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg transition-colors"
      style={{ color: copied ? 'var(--color-success-600)' : 'var(--color-primary-600)', backgroundColor: 'var(--color-bg-secondary)' }}>
      {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? 'Copied' : 'Copy script'}
    </button>
  );
};

const FAQPanel = () => {
  const { faqs, loading, error, fetchFaqs } = useFaqs();
  const [query, setQuery]       = useState('');
  const [audience, setAudience] = useState('');
  const [expanded, setExpanded] = useState(null);

  useEffect(() => { fetchFaqs(); }, [fetchFaqs]);

  // Audience chips only when the agent actually sees more than one bucket
  const audiences = useMemo(() => {
    const present = [...new Set(faqs.map(f => f.audience))];
    return present.length > 1 ? present : [];
  }, [faqs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return faqs.filter(f => {
      if (audience && f.audience !== audience) return false;
      if (!q) return true;
      return (
        f.question.toLowerCase().includes(q) ||
        f.answer.toLowerCase().includes(q) ||
        (f.keywords || '').toLowerCase().includes(q)
      );
    });
  }, [faqs, query, audience]);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-4">
        <h2 className="text-2xl font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
          <HelpCircle size={24} style={{ color: 'var(--color-primary-600)' }} /> FAQs &amp; Rebuttals
        </h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          Quick answers and scripts to handle customer questions and objections.
        </p>
      </div>

      {/* Sticky search so it stays reachable during a call */}
      <div className="sticky top-0 z-10 py-2 -mx-1 px-1" style={{ backgroundColor: 'var(--color-bg)' }}>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
          <input value={query} onChange={e => setQuery(e.target.value)} autoFocus
            placeholder="Search by keyword, question, or answer…" className="input pl-10 pr-9 w-full" />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--color-text-tertiary)' }}><X size={15} /></button>
          )}
        </div>
        {audiences.length > 0 && (
          <div className="flex gap-1.5 mt-2 flex-wrap">
            <button onClick={() => setAudience('')}
              className="px-3 py-1 rounded-full text-xs font-semibold transition-all"
              style={{ background: audience === '' ? 'var(--gradient-sidebar)' : 'var(--color-bg-secondary)', color: audience === '' ? 'white' : 'var(--color-text-secondary)' }}>
              All
            </button>
            {audiences.map(a => (
              <button key={a} onClick={() => setAudience(a)}
                className="px-3 py-1 rounded-full text-xs font-semibold transition-all"
                style={{ background: audience === a ? 'var(--gradient-sidebar)' : 'var(--color-bg-secondary)', color: audience === a ? 'white' : 'var(--color-text-secondary)' }}>
                {AUDIENCE_LABEL[a] || a}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-sm py-3" style={{ color: 'var(--color-error-600)' }}>{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center mt-3">
          <HelpCircle size={40} className="mx-auto mb-3" style={{ color: 'var(--color-text-tertiary)', opacity: 0.5 }} />
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {query ? `No FAQs match “${query}”.` : 'No FAQs available yet.'}
          </p>
        </Card>
      ) : (
        <div className="space-y-2.5 mt-3">
          {filtered.map(faq => {
            const open = expanded === faq.id;
            return (
              <Card key={faq.id} className="overflow-hidden">
                <button onClick={() => setExpanded(open ? null : faq.id)}
                  className="w-full flex items-start gap-3 p-4 text-left">
                  <span className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>
                    {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold" style={{ color: 'var(--color-text)' }}>{faq.question}</p>
                    {!open && splitKeywords(faq.keywords).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {splitKeywords(faq.keywords).slice(0, 6).map(k => (
                          <span key={k} className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                            style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>{k}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </button>

                {open && (
                  <div className="px-4 pb-4 pl-12 space-y-3">
                    <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>{faq.answer}</p>
                    {faq.script && (
                      <div className="rounded-xl p-3" style={{ backgroundColor: 'var(--color-primary-50)', border: '1px solid var(--color-primary-200)' }}>
                        <div className="flex items-center justify-between mb-1.5">
                          <p className="text-[10px] font-bold uppercase tracking-wide flex items-center gap-1" style={{ color: 'var(--color-primary-600)' }}>
                            <MessageSquareText size={11} /> Script
                          </p>
                          <CopyButton text={faq.script} />
                        </div>
                        <p className="text-sm whitespace-pre-wrap italic" style={{ color: 'var(--color-text)' }}>{faq.script}</p>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default FAQPanel;
