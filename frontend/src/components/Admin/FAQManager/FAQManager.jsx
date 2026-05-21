import { useEffect, useState } from 'react';
import {
  HelpCircle, Plus, Search, Edit2, Trash2, X, ChevronDown,
  MessageSquareText, Tag, Eye, EyeOff, BookOpen, Users, Headphones, PhoneOutgoing,
} from 'lucide-react';
import { Button, Alert, AutoResizeTextarea } from '../../UI';
import { useFaqs } from '../../../hooks/useFaqs';

const AUDIENCE_META = {
  closer:  { label: 'Closer',  color: '#7c3aed', bg: 'rgba(124,58,237,0.12)', icon: Headphones },
  fronter: { label: 'Fronter', color: '#0891b2', bg: 'rgba(8,145,178,0.12)',  icon: PhoneOutgoing },
  both:    { label: 'Both',    color: '#059669', bg: 'rgba(5,150,105,0.12)',  icon: Users },
};

const ROLE_OPTS = [
  { v: 'both', l: 'Both roles' },
  { v: 'fronter', l: 'Fronter' },
  { v: 'closer', l: 'Closer' },
];

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

const ModalShell = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto"
    style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
    onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="relative w-full max-w-2xl my-6 rounded-2xl animate-scale-in"
      style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}>
      <div className="flex items-center justify-between px-6 py-4 rounded-t-2xl" style={{ background: 'var(--gradient-sidebar)' }}>
        <div className="flex items-center gap-2.5">{title}</div>
        <button onClick={onClose} className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30 transition-colors">
          <X size={18} className="text-white" />
        </button>
      </div>
      {children}
    </div>
  </div>
);

const Label = ({ children, icon: Icon }) => (
  <label className="text-[11px] font-bold uppercase tracking-wide mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--color-text-secondary)' }}>
    {Icon && <Icon size={12} />} {children}
  </label>
);

// ── FAQ modal (FAQ fields only — no scripts) ────────────────────────────────
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
    <ModalShell onClose={onClose} title={<><HelpCircle size={20} className="text-white" /><h3 className="text-lg font-bold text-white">{faq ? 'Edit FAQ' : 'New FAQ'}</h3></>}>
      <form onSubmit={submit} className="p-6 space-y-4">
        {err && <Alert type="error" message={err} dismissible onDismiss={() => setErr('')} />}
        <div>
          <Label>Question <span style={{ color: '#ef4444' }}>*</span></Label>
          <input value={form.question} onChange={e => set('question', e.target.value)}
            placeholder="e.g. How do I respond when the customer says it's too expensive?" className="input" />
        </div>
        <div>
          <Label>Answer / Rebuttal <span style={{ color: '#ef4444' }}>*</span></Label>
          <AutoResizeTextarea value={form.answer} onChange={e => set('answer', e.target.value)}
            minRows={3} maxRows={10} placeholder="The detailed answer agents should use…" className="input" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label icon={Tag}>Keywords</Label>
            <input value={form.keywords} onChange={e => set('keywords', e.target.value)} placeholder="price, expensive, budget" className="input" />
            <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>Comma-separated — power agent topic browsing.</p>
          </div>
          <div>
            <Label>Category</Label>
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
        <p className="text-[11px] -mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
          Add scripts to this FAQ from the <strong>Add Script</strong> button.
        </p>
        <div className="flex gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving} className="flex-1">{saving ? 'Saving…' : faq ? 'Save Changes' : 'Create FAQ'}</Button>
        </div>
      </form>
    </ModalShell>
  );
};

// ── Script modal (attach/edit a single script on an FAQ) ─────────────────────
const ScriptModal = ({ script, faqs, defaultFaqId, onClose, onSave }) => {
  const editing = !!script;
  const [faqId, setFaqId]   = useState(script?.faq_id || defaultFaqId || faqs[0]?.id || '');
  const [form, setForm]     = useState({ label: script?.label || '', role: script?.role || 'both', content: script?.content || '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!faqId) { setErr('Pick the FAQ this script belongs to.'); return; }
    if (!form.content.trim()) { setErr('Script content is required.'); return; }
    setSaving(true); setErr('');
    try { await onSave({ faqId, scriptId: script?.id, ...form }); onClose(); }
    catch (er) { setErr(er.response?.data?.error || er.response?.data?.details?.[0]?.msg || 'Failed to save script'); }
    finally { setSaving(false); }
  };

  return (
    <ModalShell onClose={onClose} title={<><MessageSquareText size={20} className="text-white" /><h3 className="text-lg font-bold text-white">{editing ? 'Edit Script' : 'New Script'}</h3></>}>
      <form onSubmit={submit} className="p-6 space-y-4">
        {err && <Alert type="error" message={err} dismissible onDismiss={() => setErr('')} />}
        <div>
          <Label icon={HelpCircle}>FAQ</Label>
          <select value={faqId} onChange={e => setFaqId(e.target.value)} disabled={editing} className="input disabled:opacity-70">
            {faqs.map(f => <option key={f.id} value={f.id}>{f.question}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label>Script label</Label>
            <input value={form.label} onChange={e => set('label', e.target.value)} placeholder="Script 1" className="input" />
          </div>
          <div>
            <Label>For role</Label>
            <select value={form.role} onChange={e => set('role', e.target.value)} className="input">
              {ROLE_OPTS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </div>
        </div>
        <div>
          <Label icon={MessageSquareText}>Script content <span style={{ color: '#ef4444' }}>*</span></Label>
          <AutoResizeTextarea value={form.content} onChange={e => set('content', e.target.value)}
            minRows={3} maxRows={10} placeholder={'"I completely understand budget is important. Many of our customers felt the same…"'} className="input" />
        </div>
        <p className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
          Only agents of the selected role see this script. Use “Both roles” for general scripts.
        </p>
        <div className="flex gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving} className="flex-1">{saving ? 'Saving…' : editing ? 'Save Script' : 'Add Script'}</Button>
        </div>
      </form>
    </ModalShell>
  );
};

const StatTile = ({ label, value, color, active, onClick }) => (
  <button onClick={onClick}
    className="flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all hover:scale-[1.02]"
    style={{ backgroundColor: active ? color : 'var(--color-surface)', border: `1px solid ${active ? color : 'var(--color-border)'}`, boxShadow: active ? 'var(--shadow-md)' : 'none' }}>
    <span className="text-2xl font-bold" style={{ color: active ? 'white' : 'var(--color-text)' }}>{value}</span>
    <span className="text-xs font-semibold uppercase tracking-wide text-left leading-tight" style={{ color: active ? 'rgba(255,255,255,0.85)' : 'var(--color-text-secondary)' }}>{label}</span>
  </button>
);

// ── Main manager ────────────────────────────────────────────────────────────
const FAQManager = () => {
  const { faqs, loading, error, fetchFaqs, createFaq, updateFaq, deleteFaq, addScript, updateScript, deleteScript } = useFaqs();
  const [search, setSearch]       = useState('');
  const [audience, setAudience]   = useState('');
  const [faqModal, setFaqModal]   = useState(null);    // { faq } | { faq:null }
  const [scriptModal, setScriptModal] = useState(null);// { script } | { script:null, faqId }
  const [expanded, setExpanded]   = useState(null);
  const [confirm, setConfirm]     = useState(null);    // faq pending delete
  const [confirmScript, setConfirmScript] = useState(null);

  const load = () => fetchFaqs({ include_inactive: true, audience: audience || undefined, q: search.trim() || undefined });
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [audience]);
  const onSearch = (e) => { e.preventDefault(); load(); };

  const counts = {
    total: faqs.length,
    closer: faqs.filter(f => f.audience === 'closer').length,
    fronter: faqs.filter(f => f.audience === 'fronter').length,
    both: faqs.filter(f => f.audience === 'both').length,
  };

  const saveScript = async ({ faqId, scriptId, label, role, content }) => {
    if (scriptId) await updateScript(scriptId, { label, role, content });
    else          await addScript(faqId, { label, role, content });
    load();
  };

  const handleDeleteFaq = async (faq) => { try { await deleteFaq(faq.id); } catch { /* hook error */ } setConfirm(null); };
  const handleDeleteScript = async (s) => { try { await deleteScript(s.id); load(); } catch { /* hook error */ } setConfirmScript(null); };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Hero with two separate actions */}
      <div className="rounded-2xl p-6 relative overflow-hidden" style={{ background: 'var(--gradient-sidebar)' }}>
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <BookOpen size={22} className="text-white" />
              <h2 className="text-2xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>FAQ Knowledge Base</h2>
            </div>
            <p className="text-sm text-white/80 max-w-lg">Add FAQs and attach role-specific scripts separately.</p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <Button variant="primary" onClick={() => setFaqModal({ faq: null })} className="flex items-center gap-1.5">
              <Plus size={16} /> Add FAQ
            </Button>
            <button onClick={() => faqs.length && setScriptModal({ script: null })}
              disabled={!faqs.length} title={faqs.length ? 'Add a script to an FAQ' : 'Create an FAQ first'}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl font-bold text-sm transition-all hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: 'rgba(255,255,255,0.18)', color: 'white', border: '1px solid rgba(255,255,255,0.35)' }}>
              <MessageSquareText size={16} /> Add Script
            </button>
          </div>
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
        {search && (
          <button type="button" onClick={() => { setSearch(''); fetchFaqs({ include_inactive: true, audience: audience || undefined }); }}
            className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }}><X size={15} /></button>
        )}
      </form>

      {loading ? (
        <div className="space-y-2.5">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 rounded-2xl animate-pulse" style={{ backgroundColor: 'var(--color-bg-secondary)' }} />)}
        </div>
      ) : faqs.length === 0 ? (
        <div className="rounded-2xl p-12 text-center" style={{ backgroundColor: 'var(--color-surface)', border: '1px dashed var(--color-border)' }}>
          <HelpCircle size={44} className="mx-auto mb-3" style={{ color: 'var(--color-text-tertiary)', opacity: 0.5 }} />
          <p className="text-sm font-medium mb-3" style={{ color: 'var(--color-text)' }}>No FAQs yet.</p>
          <Button variant="primary" onClick={() => setFaqModal({ faq: null })} className="inline-flex items-center gap-1.5"><Plus size={15} /> Create your first FAQ</Button>
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
                      {(faq.scripts?.length > 0) && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
                          {faq.scripts.length} script{faq.scripts.length !== 1 ? 's' : ''}
                        </span>
                      )}
                      {!faq.is_active && <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}>HIDDEN</span>}
                    </div>
                    {!open && <p className="text-xs mt-1 line-clamp-1" style={{ color: 'var(--color-text-secondary)' }}>{faq.answer}</p>}
                    {splitKeywords(faq.keywords).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {splitKeywords(faq.keywords).map(k => (
                          <span key={k} className="text-[10px] px-1.5 py-0.5 rounded-md font-medium inline-flex items-center gap-0.5" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
                            <Tag size={8} /> {k}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                    <button onClick={() => updateFaq(faq.id, { is_active: !faq.is_active })} title={faq.is_active ? 'Hide from agents' : 'Show to agents'} className="p-1.5 rounded-lg hover:bg-bg-secondary transition-colors">
                      {faq.is_active ? <Eye size={15} style={{ color: 'var(--color-success-600)' }} /> : <EyeOff size={15} style={{ color: 'var(--color-text-tertiary)' }} />}
                    </button>
                    <button onClick={() => setFaqModal({ faq })} title="Edit FAQ" className="p-1.5 rounded-lg hover:bg-bg-secondary transition-colors"><Edit2 size={15} style={{ color: 'var(--color-primary-500)' }} /></button>
                    <button onClick={() => setConfirm(faq)} title="Delete FAQ" className="p-1.5 rounded-lg hover:bg-error-50 transition-colors"><Trash2 size={15} style={{ color: 'var(--color-error-500)' }} /></button>
                  </div>
                </div>

                {open && (
                  <div className="px-4 pb-4 pl-[2.85rem] space-y-3 animate-fade-in">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--color-text-secondary)' }}>Answer</p>
                      <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>{faq.answer}</p>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-secondary)' }}>Scripts</p>
                      <button onClick={() => setScriptModal({ script: null, faqId: faq.id })}
                        className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg transition-colors" style={{ color: 'var(--color-primary-600)', backgroundColor: 'var(--color-primary-50)' }}>
                        <Plus size={12} /> Add script
                      </button>
                    </div>
                    {(faq.scripts || []).length === 0 ? (
                      <p className="text-xs italic" style={{ color: 'var(--color-text-tertiary)' }}>No scripts yet.</p>
                    ) : (faq.scripts || []).map((s, i) => (
                      <div key={s.id || i} className="rounded-xl p-3.5" style={{ backgroundColor: 'var(--color-primary-50)', border: '1px solid var(--color-primary-200)' }}>
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5" style={{ color: 'var(--color-primary-600)' }}>
                            <MessageSquareText size={12} /> {s.label || `Script ${i + 1}`}
                          </p>
                          <AudienceBadge audience={s.role} />
                          <div className="ml-auto flex items-center gap-1">
                            <button onClick={() => setScriptModal({ script: s })} title="Edit script" className="p-1 rounded hover:bg-white/60 transition-colors"><Edit2 size={13} style={{ color: 'var(--color-primary-600)' }} /></button>
                            <button onClick={() => setConfirmScript(s)} title="Delete script" className="p-1 rounded hover:bg-error-50 transition-colors"><Trash2 size={13} style={{ color: 'var(--color-error-500)' }} /></button>
                          </div>
                        </div>
                        <p className="text-sm leading-relaxed whitespace-pre-wrap italic" style={{ color: 'var(--color-text)' }}>{s.content}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {faqModal && (
        <FAQModal faq={faqModal.faq} onClose={() => setFaqModal(null)}
          onSave={(payload) => faqModal.faq ? updateFaq(faqModal.faq.id, payload) : createFaq(payload)} />
      )}

      {scriptModal && (
        <ScriptModal script={scriptModal.script} faqs={faqs} defaultFaqId={scriptModal.faqId}
          onClose={() => setScriptModal(null)} onSave={saveScript} />
      )}

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-md p-6 rounded-2xl animate-scale-in" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}>
            <h3 className="text-lg font-bold mb-1" style={{ color: 'var(--color-text)' }}>Delete FAQ</h3>
            <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>Permanently delete “{confirm.question}” and its scripts? This cannot be undone.</p>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setConfirm(null)} className="flex-1">Cancel</Button>
              <Button variant="danger" onClick={() => handleDeleteFaq(confirm)} className="flex-1">Delete</Button>
            </div>
          </div>
        </div>
      )}

      {confirmScript && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-md p-6 rounded-2xl animate-scale-in" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}>
            <h3 className="text-lg font-bold mb-1" style={{ color: 'var(--color-text)' }}>Delete Script</h3>
            <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>Delete “{confirmScript.label || 'this script'}”? This cannot be undone.</p>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setConfirmScript(null)} className="flex-1">Cancel</Button>
              <Button variant="danger" onClick={() => handleDeleteScript(confirmScript)} className="flex-1">Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FAQManager;
