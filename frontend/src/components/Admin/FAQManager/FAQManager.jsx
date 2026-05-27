import { useEffect, useState } from 'react';
import {
  HelpCircle, Plus, Search, Edit2, Trash2, X, ChevronDown,
  Tag, Eye, EyeOff, BookOpen, Users, Headphones, PhoneOutgoing, SlidersHorizontal,
} from 'lucide-react';
import { Button, Alert, AutoResizeTextarea } from '../../UI';
import { useFaqs } from '../../../hooks/useFaqs';
import SearchSettings from '../SearchSettings';

const AUDIENCE_META = {
  closer:  { label: 'Closer',  color: '#7c3aed', bg: 'rgba(124,58,237,0.12)', icon: Headphones },
  fronter: { label: 'Fronter', color: '#0891b2', bg: 'rgba(8,145,178,0.12)',  icon: PhoneOutgoing },
  both:    { label: 'Both',    color: '#059669', bg: 'rgba(5,150,105,0.12)',  icon: Users },
};

const AudienceBadge = ({ audience }) => {
  const m = AUDIENCE_META[audience] || AUDIENCE_META.both;
  const Icon = m.icon;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold"
      style={{ backgroundColor: m.bg, color: m.color }}>
      <Icon size={10} /> {m.label}
    </span>
  );
};

const splitKeywords = (kw) => (kw || '').split(',').map(k => k.trim()).filter(Boolean);

// ── Create / edit modal ─────────────────────────────────────────────────────
const FAQModal = ({ faq, onClose, onSave }) => {
  const [form, setForm] = useState({
    question: faq?.question || '',
    answer:   faq?.answer   || '',
    keywords: faq?.keywords || '',
    audience: faq?.audience || 'both',
    is_active: faq?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.question.trim() || !form.answer.trim()) { setErr('Question and answer are required.'); return; }
    setSaving(true); setErr('');
    try { await onSave(form); onClose(); }
    catch (er) { setErr(er.response?.data?.error || er.response?.data?.details?.[0]?.msg || 'Failed to save FAQ'); }
    finally { setSaving(false); }
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
          <button onClick={onClose} className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30 transition-colors"><X size={18} className="text-white" /></button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {err && <Alert type="error" message={err} dismissible onDismiss={() => setErr('')} />}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Question <span style={{ color: '#ef4444' }}>*</span></label>
            <input value={form.question} onChange={e => set('question', e.target.value)} placeholder="e.g. What warranty options are available?" className="input" />
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Answer <span style={{ color: '#ef4444' }}>*</span></label>
            <AutoResizeTextarea value={form.answer} onChange={e => set('answer', e.target.value)} minRows={3} maxRows={10} placeholder="The answer agents should give…" className="input" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wide mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--color-text-secondary)' }}><Tag size={12} /> Keywords</label>
              <input value={form.keywords} onChange={e => set('keywords', e.target.value)} placeholder="warranty, coverage, price" className="input" />
              <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>Comma-separated — used for search.</p>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Category</label>
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
            <Button type="submit" variant="primary" disabled={saving} className="flex-1">{saving ? 'Saving…' : faq ? 'Save Changes' : 'Create FAQ'}</Button>
          </div>
        </form>
      </div>
    </div>
  );
};

const StatTile = ({ label, value, color, active, onClick }) => (
  <button onClick={onClick} className="flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all hover:scale-[1.02]"
    style={{ backgroundColor: active ? color : 'var(--color-surface)', border: `1px solid ${active ? color : 'var(--color-border)'}`, boxShadow: active ? 'var(--shadow-md)' : 'none' }}>
    <span className="text-2xl font-bold" style={{ color: active ? 'white' : 'var(--color-text)' }}>{value}</span>
    <span className="text-xs font-semibold uppercase tracking-wide text-left leading-tight" style={{ color: active ? 'rgba(255,255,255,0.85)' : 'var(--color-text-secondary)' }}>{label}</span>
  </button>
);

// ── Main manager (FAQs only) ─────────────────────────────────────────────────
const FAQManager = () => {
  const { faqs, loading, error, fetchFaqs, createFaq, updateFaq, deleteFaq } = useFaqs();
  const [search, setSearch]     = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [audience, setAudience] = useState('');
  const [modal, setModal]       = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [confirm, setConfirm]   = useState(null);

  const load = () => fetchFaqs({ include_inactive: true, audience: audience || undefined, q: search.trim() || undefined });
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [audience]);
  const onSearch = (e) => { e.preventDefault(); load(); };

  const counts = {
    total: faqs.length,
    closer: faqs.filter(f => f.audience === 'closer').length,
    fronter: faqs.filter(f => f.audience === 'fronter').length,
    both: faqs.filter(f => f.audience === 'both').length,
  };

  const handleDelete = async (faq) => { try { await deleteFaq(faq.id); } catch { /* hook error */ } setConfirm(null); };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="rounded-2xl p-6 relative overflow-hidden" style={{ background: 'var(--gradient-sidebar)' }}>
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <BookOpen size={22} className="text-white" />
              <h2 className="text-2xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>FAQs</h2>
            </div>
            <p className="text-sm text-white/80 max-w-lg">Questions, answers, and keywords agents search during calls.</p>
          </div>
          <Button variant="primary" onClick={() => setModal({ faq: null })} className="flex items-center gap-1.5 flex-shrink-0 self-start lg:self-auto">
            <Plus size={16} /> Add FAQ
          </Button>
        </div>
        <div className="absolute -right-10 -top-10 w-44 h-44 rounded-full opacity-20" style={{ background: 'radial-gradient(circle, white, transparent 70%)' }} />
      </div>

      {error && <Alert type="error" message={error} />}

      <div className="flex flex-wrap gap-2.5">
        <StatTile label="Total FAQs" value={counts.total} color="var(--color-primary-600)" active={audience === ''} onClick={() => setAudience('')} />
        <StatTile label="Closers"  value={counts.closer}  color={AUDIENCE_META.closer.color}  active={audience === 'closer'}  onClick={() => setAudience('closer')} />
        <StatTile label="Fronters" value={counts.fronter} color={AUDIENCE_META.fronter.color} active={audience === 'fronter'} onClick={() => setAudience('fronter')} />
        <StatTile label="Both"     value={counts.both}    color={AUDIENCE_META.both.color}    active={audience === 'both'}    onClick={() => setAudience('both')} />
      </div>

      <form onSubmit={onSearch} className="relative">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search questions, answers, keywords…" className="input pl-10 pr-9 w-full" />
        {search && <button type="button" onClick={() => { setSearch(''); fetchFaqs({ include_inactive: true, audience: audience || undefined }); }} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }}><X size={15} /></button>}
      </form>

      {/* Search settings live here (no separate tab): synonyms + analytics */}
      <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <button onClick={() => setShowSearch(v => !v)} className="w-full flex items-center justify-between p-4">
          <span className="flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--color-text)' }}>
            <SlidersHorizontal size={16} style={{ color: 'var(--color-primary-600)' }} /> Search settings — synonyms &amp; analytics
          </span>
          <ChevronDown size={18} className="transition-transform" style={{ color: 'var(--color-text-tertiary)', transform: showSearch ? 'rotate(180deg)' : 'none' }} />
        </button>
        {showSearch && <div className="px-4 pb-4"><SearchSettings embedded /></div>}
      </div>

      {loading ? (
        <div className="space-y-2.5">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 rounded-2xl animate-pulse" style={{ backgroundColor: 'var(--color-bg-secondary)' }} />)}</div>
      ) : faqs.length === 0 ? (
        <div className="rounded-2xl p-12 text-center" style={{ backgroundColor: 'var(--color-surface)', border: '1px dashed var(--color-border)' }}>
          <HelpCircle size={44} className="mx-auto mb-3" style={{ color: 'var(--color-text-tertiary)', opacity: 0.5 }} />
          <p className="text-sm font-medium mb-3" style={{ color: 'var(--color-text)' }}>No FAQs yet.</p>
          <Button variant="primary" onClick={() => setModal({ faq: null })} className="inline-flex items-center gap-1.5"><Plus size={15} /> Create your first FAQ</Button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {faqs.map(faq => {
            const open = expanded === faq.id;
            const m = AUDIENCE_META[faq.audience] || AUDIENCE_META.both;
            return (
              <div key={faq.id} className={`rounded-2xl overflow-hidden transition-all duration-200 ${faq.is_active ? '' : 'opacity-60'}`}
                style={{ backgroundColor: 'var(--color-surface)', border: `1px solid ${open ? 'var(--color-primary-300)' : 'var(--color-border)'}`, borderLeft: `3px solid ${m.color}`, boxShadow: open ? 'var(--shadow-md)' : 'none' }}>
                <div className="flex items-start gap-3 p-4 cursor-pointer" onClick={() => setExpanded(open ? null : faq.id)}>
                  <ChevronDown size={18} className="mt-0.5 flex-shrink-0 transition-transform duration-200" style={{ color: 'var(--color-text-tertiary)', transform: open ? 'none' : 'rotate(-90deg)' }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold" style={{ color: 'var(--color-text)' }}>{faq.question}</p>
                      <AudienceBadge audience={faq.audience} />
                      {!faq.is_active && <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}>HIDDEN</span>}
                    </div>
                    {!open && <p className="text-xs mt-1 line-clamp-1" style={{ color: 'var(--color-text-secondary)' }}>{faq.answer}</p>}
                    {splitKeywords(faq.keywords).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {splitKeywords(faq.keywords).map(k => <span key={k} className="text-[10px] px-1.5 py-0.5 rounded-md font-medium inline-flex items-center gap-0.5" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}><Tag size={8} /> {k}</span>)}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                    <button onClick={() => updateFaq(faq.id, { is_active: !faq.is_active })} title={faq.is_active ? 'Hide from agents' : 'Show to agents'} className="p-1.5 rounded-lg hover:bg-bg-secondary transition-colors">{faq.is_active ? <Eye size={15} style={{ color: 'var(--color-success-600)' }} /> : <EyeOff size={15} style={{ color: 'var(--color-text-tertiary)' }} />}</button>
                    <button onClick={() => setModal({ faq })} title="Edit" className="p-1.5 rounded-lg hover:bg-bg-secondary transition-colors"><Edit2 size={15} style={{ color: 'var(--color-primary-500)' }} /></button>
                    <button onClick={() => setConfirm(faq)} title="Delete" className="p-1.5 rounded-lg hover:bg-error-50 transition-colors"><Trash2 size={15} style={{ color: 'var(--color-error-500)' }} /></button>
                  </div>
                </div>
                {open && (
                  <div className="px-4 pb-4 pl-[2.85rem] animate-fade-in">
                    <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--color-text-secondary)' }}>Answer</p>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>{faq.answer}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {modal && <FAQModal faq={modal.faq} onClose={() => setModal(null)} onSave={(payload) => modal.faq ? updateFaq(modal.faq.id, payload) : createFaq(payload)} />}

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-md p-6 rounded-2xl animate-scale-in" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}>
            <h3 className="text-lg font-bold mb-1" style={{ color: 'var(--color-text)' }}>Delete FAQ</h3>
            <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>Permanently delete “{confirm.question}”? This cannot be undone.</p>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setConfirm(null)} className="flex-1">Cancel</Button>
              <Button variant="danger" onClick={() => handleDelete(confirm)} className="flex-1">Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FAQManager;
