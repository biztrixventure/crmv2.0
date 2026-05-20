import { useEffect, useState, useMemo } from 'react';
import {
  HelpCircle, Plus, Search, Edit2, Trash2, X, ChevronDown, ChevronRight,
  MessageSquareText, Tag, Eye, EyeOff,
} from 'lucide-react';
import { Card, Badge, Button, Alert, AutoResizeTextarea } from '../../UI';
import { useFaqs } from '../../../hooks/useFaqs';

const AUDIENCE_META = {
  closer:  { label: 'Closer',  color: '#7c3aed', bg: 'rgba(124,58,237,0.10)' },
  fronter: { label: 'Fronter', color: '#0891b2', bg: 'rgba(8,145,178,0.10)' },
  both:    { label: 'Both',    color: '#059669', bg: 'rgba(5,150,105,0.10)' },
};

const AudienceBadge = ({ audience }) => {
  const m = AUDIENCE_META[audience] || AUDIENCE_META.both;
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold"
      style={{ backgroundColor: m.bg, color: m.color }}>
      {m.label}
    </span>
  );
};

const splitKeywords = (kw) => (kw || '').split(',').map(k => k.trim()).filter(Boolean);

// ── Create / edit modal ─────────────────────────────────────────────────────
const FAQModal = ({ faq, onClose, onSave }) => {
  const [form, setForm] = useState({
    question: faq?.question || '',
    answer:   faq?.answer   || '',
    script:   faq?.script   || '',
    keywords: faq?.keywords || '',
    audience: faq?.audience || 'both',
    is_active: faq?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.question.trim() || !form.answer.trim()) {
      setErr('Question and answer are required.');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      await onSave(form);
      onClose();
    } catch (er) {
      setErr(er.response?.data?.error || er.response?.data?.details?.[0]?.msg || 'Failed to save FAQ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="relative w-full max-w-2xl my-6 rounded-2xl animate-scale-in"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}>
        <div className="flex items-center justify-between px-6 py-4 rounded-t-2xl" style={{ background: 'var(--gradient-sidebar)' }}>
          <div className="flex items-center gap-2.5">
            <HelpCircle size={20} className="text-white" />
            <h3 className="text-lg font-bold text-white">{faq ? 'Edit FAQ' : 'New FAQ'}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30 transition-colors">
            <X size={18} className="text-white" />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          {err && <Alert type="error" message={err} dismissible onDismiss={() => setErr('')} />}

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>
              Question <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input value={form.question} onChange={e => set('question', e.target.value)}
              placeholder="e.g. How do I respond when the customer says it's too expensive?"
              className="input" />
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>
              Answer / Rebuttal <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <AutoResizeTextarea value={form.answer} onChange={e => set('answer', e.target.value)}
              minRows={3} maxRows={10} placeholder="The detailed answer agents should use…" className="input" />
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--color-text-secondary)' }}>
              <MessageSquareText size={12} /> Script <span className="font-normal normal-case opacity-60">(optional — verbatim wording for calls)</span>
            </label>
            <AutoResizeTextarea value={form.script} onChange={e => set('script', e.target.value)}
              minRows={2} maxRows={8} placeholder={'"I completely understand budget is important. Many of our customers felt the same…"'} className="input" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                <Tag size={12} /> Keywords
              </label>
              <input value={form.keywords} onChange={e => set('keywords', e.target.value)}
                placeholder="price, expensive, budget" className="input" />
              <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>Comma-separated, used for search.</p>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                Category
              </label>
              <select value={form.audience} onChange={e => set('audience', e.target.value)} className="input">
                <option value="both">Both (closers &amp; fronters)</option>
                <option value="closer">Closers only</option>
                <option value="fronter">Fronters only</option>
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} />
            <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Visible to agents</span>
          </label>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
            <Button type="submit" variant="primary" disabled={saving} className="flex-1">
              {saving ? 'Saving…' : faq ? 'Save Changes' : 'Create FAQ'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ── Main manager ────────────────────────────────────────────────────────────
const FAQManager = () => {
  const { faqs, loading, error, fetchFaqs, createFaq, updateFaq, deleteFaq } = useFaqs();
  const [search, setSearch]     = useState('');
  const [audience, setAudience] = useState('');
  const [modal, setModal]       = useState(null);   // { faq } | { faq: null }
  const [expanded, setExpanded] = useState(null);
  const [confirm, setConfirm]   = useState(null);    // faq pending delete

  const load = () => fetchFaqs({
    include_inactive: true,
    audience: audience || undefined,
    q: search.trim() || undefined,
  });

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [audience]);

  const onSearch = (e) => { e.preventDefault(); load(); };

  const counts = useMemo(() => ({
    total:   faqs.length,
    closer:  faqs.filter(f => f.audience === 'closer').length,
    fronter: faqs.filter(f => f.audience === 'fronter').length,
    both:    faqs.filter(f => f.audience === 'both').length,
  }), [faqs]);

  const handleDelete = async (faq) => {
    try { await deleteFaq(faq.id); } catch { /* surfaced via hook error */ }
    setConfirm(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <HelpCircle size={24} style={{ color: 'var(--color-primary-600)' }} /> FAQ Knowledge Base
          </h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            {counts.total} FAQ{counts.total !== 1 ? 's' : ''} · {counts.closer} closer · {counts.fronter} fronter · {counts.both} both
          </p>
        </div>
        <Button variant="primary" onClick={() => setModal({ faq: null })} className="flex items-center gap-1.5">
          <Plus size={16} /> Add FAQ
        </Button>
      </div>

      {error && <Alert type="error" message={error} />}

      {/* Search + audience filter */}
      <div className="flex flex-wrap items-center gap-3">
        <form onSubmit={onSearch} className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search questions, answers, keywords…" className="input pl-9 w-full" />
        </form>
        <div className="flex gap-1 p-1 rounded-xl" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          {[{ k: '', l: 'All' }, { k: 'closer', l: 'Closer' }, { k: 'fronter', l: 'Fronter' }, { k: 'both', l: 'Both' }].map(t => (
            <button key={t.k} onClick={() => setAudience(t.k)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={{
                background: audience === t.k ? 'var(--gradient-sidebar)' : 'transparent',
                color: audience === t.k ? 'white' : 'var(--color-text-secondary)',
              }}>
              {t.l}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>
      ) : faqs.length === 0 ? (
        <Card className="p-12 text-center">
          <HelpCircle size={40} className="mx-auto mb-3" style={{ color: 'var(--color-text-tertiary)', opacity: 0.5 }} />
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>No FAQs yet. Click “Add FAQ” to create one.</p>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {faqs.map(faq => {
            const open = expanded === faq.id;
            return (
              <Card key={faq.id} className={`overflow-hidden transition-all ${faq.is_active ? '' : 'opacity-60'}`}>
                <div className="flex items-start gap-3 p-4 cursor-pointer" onClick={() => setExpanded(open ? null : faq.id)}>
                  <button className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>
                    {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold" style={{ color: 'var(--color-text)' }}>{faq.question}</p>
                      <AudienceBadge audience={faq.audience} />
                      {!faq.is_active && <Badge variant="secondary" size="sm">Hidden</Badge>}
                    </div>
                    {!open && (
                      <p className="text-xs mt-1 line-clamp-1" style={{ color: 'var(--color-text-secondary)' }}>{faq.answer}</p>
                    )}
                    {splitKeywords(faq.keywords).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {splitKeywords(faq.keywords).map(k => (
                          <span key={k} className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                            style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>{k}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                    <button onClick={() => updateFaq(faq.id, { is_active: !faq.is_active })}
                      title={faq.is_active ? 'Hide from agents' : 'Show to agents'}
                      className="p-1.5 rounded hover:bg-bg-secondary transition-colors">
                      {faq.is_active
                        ? <Eye size={15} style={{ color: 'var(--color-success-600)' }} />
                        : <EyeOff size={15} style={{ color: 'var(--color-text-tertiary)' }} />}
                    </button>
                    <button onClick={() => setModal({ faq })} title="Edit"
                      className="p-1.5 rounded hover:bg-bg-secondary transition-colors">
                      <Edit2 size={15} style={{ color: 'var(--color-primary-500)' }} />
                    </button>
                    <button onClick={() => setConfirm(faq)} title="Delete"
                      className="p-1.5 rounded hover:bg-error-50 transition-colors">
                      <Trash2 size={15} style={{ color: 'var(--color-error-500)' }} />
                    </button>
                  </div>
                </div>

                {open && (
                  <div className="px-4 pb-4 pl-12 space-y-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-text-secondary)' }}>Answer</p>
                      <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>{faq.answer}</p>
                    </div>
                    {faq.script && (
                      <div className="rounded-xl p-3" style={{ backgroundColor: 'var(--color-primary-50)', border: '1px solid var(--color-primary-200)' }}>
                        <p className="text-[10px] font-bold uppercase tracking-wide mb-1 flex items-center gap-1" style={{ color: 'var(--color-primary-600)' }}>
                          <MessageSquareText size={11} /> Script
                        </p>
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

      {modal && (
        <FAQModal
          faq={modal.faq}
          onClose={() => setModal(null)}
          onSave={(payload) => modal.faq ? updateFaq(modal.faq.id, payload) : createFaq(payload)}
        />
      )}

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <Card className="w-full max-w-md p-6">
            <h3 className="text-lg font-bold mb-1" style={{ color: 'var(--color-text)' }}>Delete FAQ</h3>
            <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>
              Permanently delete “{confirm.question}”? This cannot be undone.
            </p>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setConfirm(null)} className="flex-1">Cancel</Button>
              <Button variant="danger" onClick={() => handleDelete(confirm)} className="flex-1">Delete</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

export default FAQManager;
