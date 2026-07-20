import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Inbox, Send, FileText, Trash2, PenSquare, Search, Loader2, RefreshCw,
  Paperclip, ChevronLeft, Reply, ReplyAll, Forward, Users, CornerUpLeft,
  BookTemplate, PenLine, Check, Plus, Download, Mail, ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import RichTextEditor from '../UI/RichTextEditor';
import RichView from '../UI/RichView';

// Internal email panel — inbox/sent/drafts/trash, threads, compose with
// templates + signature + attachments + bulk fan-out. Backend: routes/emails.js
// (migration 164). Live refetch is driven by MailLauncher's realtime tick.
const PAGE = 25;
const FOLDERS = [
  { key: 'inbox',  label: 'Inbox',  Icon: Inbox },
  { key: 'sent',   label: 'Sent',   Icon: Send },
  { key: 'drafts', label: 'Drafts', Icon: FileText },
  { key: 'trash',  label: 'Trash',  Icon: Trash2 },
];
const inp = { background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)', borderRadius: 8, padding: '6px 10px', fontSize: 13 };
const tierColor = { mine: '#059669', company: '#2563eb', global: '#94a3b8' };
const fmtWhen = (d) => {
  if (!d) return '';
  const dt = new Date(d); if (isNaN(dt)) return '';
  const today = new Date(); const sameDay = dt.toDateString() === today.toDateString();
  return sameDay ? dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + (dt.getFullYear() !== today.getFullYear() ? `, ${dt.getFullYear()}` : '');
};
const fmtFull = (d) => { try { return new Date(d).toLocaleString(); } catch { return d || ''; } };
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── recipient chips + directory search (GET /emails/users) ───────────────────
function RecipientField({ label, value, onChange, autoFocus }) {
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState([]);
  const [openList, setOpenList] = useState(false);
  const boxRef = useRef(null);
  useEffect(() => {
    if (!openList) return;
    const t = setTimeout(() => {
      client.get('emails/users', { params: { q } })
        .then(r => setOpts(r.data.users || []))
        .catch(() => setOpts([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, openList]);
  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpenList(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const add = (u) => { if (!value.some(v => v.id === u.id)) onChange([...value, { id: u.id, name: u.name }]); setQ(''); };
  const remove = (id) => onChange(value.filter(v => v.id !== id));
  return (
    <div ref={boxRef} className="relative flex items-start gap-2 py-1.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
      <span className="text-xs font-bold w-8 pt-1.5 flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>{label}</span>
      <div className="flex-1 flex items-center gap-1 flex-wrap min-w-0">
        {value.map(u => (
          <span key={u.id} className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{ background: 'var(--color-primary-100, #e0e7ff)', color: 'var(--color-primary-700, #4338ca)' }}>
            {u.name}
            <button onClick={() => remove(u.id)} className="hover:opacity-70"><X size={11} /></button>
          </span>
        ))}
        <input value={q} autoFocus={autoFocus} onChange={e => { setQ(e.target.value); setOpenList(true); }} onFocus={() => setOpenList(true)}
          placeholder={value.length ? '' : 'Search people…'}
          className="flex-1 min-w-[120px] text-sm py-1 bg-transparent outline-none" style={{ color: 'var(--color-text)' }} />
      </div>
      {openList && (
        <div className="absolute left-8 right-0 top-full z-30 mt-1 rounded-xl overflow-hidden max-h-52 overflow-y-auto"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.15))' }}>
          {opts.filter(u => !value.some(v => v.id === u.id)).map(u => (
            <button key={u.id} onMouseDown={e => { e.preventDefault(); add(u); }}
              className="w-full text-left px-3 py-2 hover:bg-bg-secondary transition-colors">
              <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{u.name}</div>
              <div className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>{u.role || ''}{u.company ? ` · ${u.company}` : ''}</div>
            </button>
          ))}
          {!opts.length && <div className="px-3 py-2 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>No matches</div>}
        </div>
      )}
    </div>
  );
}

// ── compose ───────────────────────────────────────────────────────────────────
function Compose({ me, preset, onClose, onSent }) {
  const [to, setTo]   = useState(preset?.to || []);
  const [cc, setCc]   = useState(preset?.cc || []);
  const [bcc, setBcc] = useState(preset?.bcc || []);
  const [showCc, setShowCc] = useState(!!(preset?.cc?.length || preset?.bcc?.length));
  const [subject, setSubject] = useState(preset?.subject || '');
  const [attachments, setAttachments] = useState(preset?.attachments || []);
  const [bulk, setBulk] = useState(false);
  const [sending, setSending] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftId, setDraftId] = useState(preset?.draft_id || null);
  const [templates, setTemplates] = useState([]);
  const [tplOpen, setTplOpen] = useState(false);
  const [saveTplOpen, setSaveTplOpen] = useState(false);
  const [tplName, setTplName] = useState('');
  const fileRef = useRef(null);
  // body handled by RichTextEditor (uncontrolled-ish; we keep latest html in a ref + state seed)
  const [body, setBody] = useState(preset?.body_html ?? null);   // null → signature not applied yet
  const [seed, setSeed] = useState(preset?.body_html || '');
  const [editorKey, setEditorKey] = useState(0);

  // signature auto-insert on fresh composes (not replies-with-body or reopened drafts)
  useEffect(() => {
    let cancelled = false;
    client.get('emails/templates').then(r => { if (!cancelled) setTemplates(r.data.templates || []); }).catch(() => {});
    if (preset?.body_html == null) {
      client.get('emails/signature').then(r => {
        if (cancelled) return;
        const sig = r.data.signature ? `<br/><br/>${r.data.signature}` : '';
        setSeed(sig); setBody(sig); setEditorKey(k => k + 1);
      }).catch(() => { setSeed(''); setBody(''); });
    }
    return () => { cancelled = true; };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const applyTemplate = (t) => {
    setSubject(s => s || t.subject || '');
    const next = `${t.body_html || ''}${body || ''}`;
    setSeed(next); setBody(next); setEditorKey(k => k + 1); setTplOpen(false);
  };
  const saveMyTemplate = async () => {
    if (!tplName.trim()) return;
    try {
      const r = await client.post('emails/templates/mine', { name: tplName.trim(), subject, body_html: body || '' });
      setTemplates(ts => [r.data.template, ...ts.filter(t => t.id !== r.data.template.id)]);
      setSaveTplOpen(false); setTplName(''); toast.success('Template saved');
    } catch (e) { toast.error(e.response?.data?.error || 'Could not save template'); }
  };
  const deleteMyTemplate = async (t) => {
    try { await client.delete(`emails/templates/mine/${t.id}`); setTemplates(ts => ts.filter(x => x.id !== t.id)); }
    catch (e) { toast.error(e.response?.data?.error || 'Could not delete'); }
  };

  const onPickFiles = async (e) => {
    const files = [...(e.target.files || [])]; e.target.value = '';
    for (const f of files.slice(0, 10 - attachments.length)) {
      if (f.size > 10 * 1024 * 1024) { toast.error(`${f.name} exceeds 10MB`); continue; }
      const data = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
      try {
        const r = await client.post('emails/upload', { name: f.name, type: f.type, data });
        setAttachments(a => [...a, r.data.attachment]);
      } catch (err) { toast.error(err.response?.data?.error || `Upload failed: ${f.name}`); }
    }
  };

  const payload = () => ({
    to: to.map(u => u.id), cc: cc.map(u => u.id), bcc: bcc.map(u => u.id),
    subject, body_html: body || '', attachments,
    thread_id: preset?.thread_id || null, reply_to_email_id: preset?.reply_to_email_id || null,
    is_forward: !!preset?.is_forward,
  });

  const send = async () => {
    if (!to.length && !cc.length && !bcc.length) return toast.error('Add at least one recipient');
    setSending(true);
    try {
      const r = await client.post('emails/send', { ...payload(), bulk, draft_id: draftId });
      toast.success(r.data.bulk ? `Sent individually to ${to.length + cc.length + bcc.length} people` : 'Email sent');
      onSent();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not send'); }
    finally { setSending(false); }
  };
  const saveDraft = async () => {
    setSavingDraft(true);
    try {
      if (draftId) await client.put(`emails/drafts/${draftId}`, payload());
      else { const r = await client.post('emails/drafts', payload()); setDraftId(r.data.draft.id); }
      toast.success('Draft saved');
    } catch (e) { toast.error(e.response?.data?.error || 'Could not save draft'); }
    finally { setSavingDraft(false); }
  };
  const discard = async () => {
    if (draftId) { try { await client.delete(`emails/drafts/${draftId}`); } catch { /* ignore */ } }
    onClose();
  };

  const nRecip = to.length + cc.length + bcc.length;
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <PenSquare size={15} style={{ color: 'var(--color-primary-600)' }} />
        <span className="text-sm font-bold flex-1" style={{ color: 'var(--color-text)' }}>
          {preset?.reply_to_email_id ? 'Reply' : preset?.is_forward ? 'Forward' : draftId ? 'Draft' : 'New email'}
        </span>
        {/* template picker */}
        <div className="relative">
          <button onClick={() => setTplOpen(o => !o)} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg flex items-center gap-1.5"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
            <BookTemplate size={13} /> Templates <ChevronDown size={12} />
          </button>
          {tplOpen && (
            <div className="absolute right-0 top-full z-30 mt-1 w-72 rounded-xl overflow-hidden max-h-64 overflow-y-auto"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.15))' }}>
              {templates.map(t => (
                <div key={t.id} className="flex items-center gap-1 px-1 hover:bg-bg-secondary">
                  <button onClick={() => applyTemplate(t)} className="flex-1 min-w-0 text-left px-2 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{t.name}</span>
                      <span className="text-[9px] font-bold uppercase flex-shrink-0" style={{ color: tierColor[t.tier] }}>{t.tier}</span>
                    </div>
                    {t.subject && <div className="text-[11px] truncate" style={{ color: 'var(--color-text-secondary)' }}>{t.subject}</div>}
                  </button>
                  {t.tier === 'mine' && (
                    <button onClick={() => deleteMyTemplate(t)} title="Delete my template" className="p-1.5 flex-shrink-0" style={{ color: '#ef4444' }}><X size={12} /></button>
                  )}
                </div>
              ))}
              {!templates.length && <div className="px-3 py-3 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>No templates yet</div>}
              <button onClick={() => { setTplOpen(false); setSaveTplOpen(true); }}
                className="w-full text-left px-3 py-2 text-xs font-bold flex items-center gap-1.5"
                style={{ color: 'var(--color-primary-600)', borderTop: '1px solid var(--color-border)' }}>
                <Plus size={12} /> Save current as my template
              </button>
            </div>
          )}
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg" style={{ color: 'var(--color-text-secondary)' }}><X size={16} /></button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 min-h-0">
        <RecipientField label="To" value={to} onChange={setTo} autoFocus={!preset?.to?.length} />
        {showCc ? (
          <>
            <RecipientField label="Cc" value={cc} onChange={setCc} />
            <RecipientField label="Bcc" value={bcc} onChange={setBcc} />
          </>
        ) : (
          <button onClick={() => setShowCc(true)} className="text-[11px] font-semibold py-1" style={{ color: 'var(--color-primary-600)' }}>+ Cc / Bcc</button>
        )}
        <div className="flex items-center gap-2 py-1.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <span className="text-xs font-bold w-8 flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>Subj</span>
          <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject"
            className="flex-1 text-sm py-1 bg-transparent outline-none font-semibold" style={{ color: 'var(--color-text)' }} />
        </div>

        <div className="py-3">
          {body === null
            ? <div className="text-xs py-6 text-center" style={{ color: 'var(--color-text-tertiary)' }}><Loader2 size={14} className="animate-spin inline" /></div>
            : <RichTextEditor key={editorKey} value={seed} onChange={setBody} placeholder="Write your email…" minHeight={180} />}
        </div>

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 pb-2">
            {attachments.map((a, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg"
                style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                <Paperclip size={11} /> {a.name} <span style={{ color: 'var(--color-text-tertiary)' }}>({Math.round((a.size || 0) / 1024)}kb)</span>
                <button onClick={() => setAttachments(list => list.filter((_, j) => j !== i))} style={{ color: '#ef4444' }}><X size={11} /></button>
              </span>
            ))}
          </div>
        )}

        {nRecip > 1 && !preset?.thread_id && (
          <label className="flex items-start gap-2 p-2.5 rounded-xl mb-2 cursor-pointer"
            style={{ background: 'var(--color-bg-secondary)', border: `1px solid ${bulk ? 'var(--color-primary-600)' : 'var(--color-border)'}` }}>
            <input type="checkbox" checked={bulk} onChange={e => setBulk(e.target.checked)} className="mt-0.5" />
            <span className="text-xs" style={{ color: 'var(--color-text)' }}>
              <b>Send individually</b> — creates {nRecip} separate emails; recipients can’t see each other and replies come only to you. Off = one group email, everyone sees the To/Cc list.
            </span>
          </label>
        )}
      </div>

      <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0" style={{ borderTop: '1px solid var(--color-border)' }}>
        <button onClick={send} disabled={sending} className="text-sm font-bold px-5 py-2 rounded-lg flex items-center gap-2 disabled:opacity-50"
          style={{ background: 'var(--gradient-sidebar)', color: 'var(--color-text-inverse)' }}>
          {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Send{bulk && nRecip > 1 ? ` ×${nRecip}` : ''}
        </button>
        <label className="p-2 rounded-lg cursor-pointer" title="Attach files" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
          <Paperclip size={15} />
          <input ref={fileRef} type="file" multiple className="hidden" onChange={onPickFiles} />
        </label>
        <button onClick={saveDraft} disabled={savingDraft} className="text-xs font-semibold px-3 py-2 rounded-lg" style={{ color: 'var(--color-text-secondary)' }}>
          {savingDraft ? 'Saving…' : 'Save draft'}
        </button>
        <button onClick={discard} className="text-xs font-semibold px-3 py-2 rounded-lg ml-auto" style={{ color: '#ef4444' }}>Discard</button>
      </div>

      {saveTplOpen && (
        <div className="absolute inset-0 z-40 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => setSaveTplOpen(false)}>
          <div className="w-72 rounded-2xl p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }} onClick={e => e.stopPropagation()}>
            <div className="text-sm font-bold mb-2" style={{ color: 'var(--color-text)' }}>Save as my template</div>
            <input autoFocus value={tplName} onChange={e => setTplName(e.target.value)} placeholder="Template name" style={{ ...inp, width: '100%' }}
              onKeyDown={e => e.key === 'Enter' && saveMyTemplate()} />
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setSaveTplOpen(false)} className="text-xs font-semibold px-3 py-1.5" style={{ color: 'var(--color-text-secondary)' }}>Cancel</button>
              <button onClick={saveMyTemplate} className="text-xs font-bold px-3 py-1.5 rounded-lg" style={{ background: 'var(--gradient-sidebar)', color: 'var(--color-text-inverse)' }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── thread view ───────────────────────────────────────────────────────────────
function ThreadView({ threadId, meId, onBack, onCompose, refreshUnread }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    client.get(`emails/threads/${threadId}`)
      .then(r => {
        setData(r.data);
        const unreadIds = (r.data.emails || []).filter(e => !e.mine).map(e => e.id);
        if (unreadIds.length) client.patch('emails/read', { email_ids: unreadIds }).then(refreshUnread).catch(() => {});
      })
      .catch(e => toast.error(e.response?.data?.error || 'Could not load thread'))
      .finally(() => setLoading(false));
  }, [threadId, refreshUnread]);
  useEffect(() => { load(); }, [load]);

  const quote = (e) => `<br/><br/><blockquote style="border-left:3px solid var(--color-border,#cbd5e1);padding-left:10px;margin:4px 0 0 4px;color:#64748b">On ${esc(fmtFull(e.sent_at))}, ${esc(e.sender_name)} wrote:<br/>${e.body_html || esc(e.body_text || '')}</blockquote>`;
  const reSubject = (s) => (/^re:/i.test(s || '') ? s : `Re: ${s || ''}`);
  const reply = (e) => onCompose({
    to: e.mine ? e.recipients.filter(r => r.kind !== 'bcc').map(r => ({ id: r.user_id, name: r.name })) : [{ id: e.sender_id, name: e.sender_name }],
    subject: reSubject(data.thread.subject), body_html: quote(e),
    thread_id: threadId, reply_to_email_id: e.id,
  });
  const replyAll = (e) => {
    const ids = new Map();
    if (!e.mine) ids.set(e.sender_id, e.sender_name);
    e.recipients.filter(r => r.kind !== 'bcc' && r.user_id !== meId).forEach(r => ids.set(r.user_id, r.name));
    onCompose({
      to: [...ids.entries()].map(([id, name]) => ({ id, name })),
      subject: reSubject(data.thread.subject), body_html: quote(e),
      thread_id: threadId, reply_to_email_id: e.id,
    });
  };
  const forward = (e) => onCompose({
    to: [], subject: (/^fwd:/i.test(data.thread.subject || '') ? data.thread.subject : `Fwd: ${data.thread.subject || ''}`),
    body_html: quote(e), attachments: e.attachments || [], is_forward: true, reply_to_email_id: e.id,
  });

  if (loading) return <div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin" style={{ color: 'var(--color-text-tertiary)' }} /></div>;
  if (!data) return null;
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <button onClick={onBack} className="p-1.5 rounded-lg" style={{ color: 'var(--color-text-secondary)' }}><ChevronLeft size={16} /></button>
        <span className="text-sm font-bold flex-1 truncate" style={{ color: 'var(--color-text)' }}>{data.thread.subject || '(no subject)'}</span>
        <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{data.emails.length} message{data.emails.length === 1 ? '' : 's'}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {data.emails.map(e => (
          <div key={e.id} className="rounded-xl p-3.5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>{e.mine ? 'You' : e.sender_name}</span>
              {e.is_forward && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>FWD</span>}
              <span className="text-[11px] ml-auto flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>{fmtFull(e.sent_at)}</span>
            </div>
            <div className="text-[11px] mt-0.5 flex items-center gap-1 flex-wrap" style={{ color: 'var(--color-text-secondary)' }}>
              <Users size={10} />
              to {e.recipients.filter(r => r.kind === 'to').map(r => r.user_id === meId ? 'me' : r.name).join(', ') || '—'}
              {e.recipients.some(r => r.kind === 'cc') && <> · cc {e.recipients.filter(r => r.kind === 'cc').map(r => r.user_id === meId ? 'me' : r.name).join(', ')}</>}
              {e.recipients.some(r => r.kind === 'bcc') && <> · bcc {e.recipients.filter(r => r.kind === 'bcc').map(r => r.user_id === meId ? 'me' : r.name).join(', ')}</>}
            </div>
            <div className="mt-2 text-sm" style={{ color: 'var(--color-text)' }}>
              <RichView html={e.body_html || esc(e.body_text || '')} />
            </div>
            {(e.attachments || []).length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {e.attachments.map((a, i) => (
                  <a key={i} href={a.url} target="_blank" rel="noreferrer" download={a.name}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg hover:opacity-80"
                    style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-primary-600)' }}>
                    <Download size={11} /> {a.name}
                  </a>
                ))}
              </div>
            )}
            <div className="flex items-center gap-1.5 mt-2.5">
              <button onClick={() => reply(e)} className="text-[11px] font-bold px-2.5 py-1 rounded-lg flex items-center gap-1" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}><Reply size={11} /> Reply</button>
              {(e.recipients.length > 1 || (e.recipients.length === 1 && !e.mine && e.recipients[0].user_id !== meId)) && (
                <button onClick={() => replyAll(e)} className="text-[11px] font-bold px-2.5 py-1 rounded-lg flex items-center gap-1" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}><ReplyAll size={11} /> Reply all</button>
              )}
              <button onClick={() => forward(e)} className="text-[11px] font-bold px-2.5 py-1 rounded-lg flex items-center gap-1" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}><Forward size={11} /> Forward</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── signature editor (small modal) ───────────────────────────────────────────
function SignatureEditor({ onClose }) {
  const [sig, setSig] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    client.get('emails/signature').then(r => setSig(r.data.signature || '')).catch(() => setSig(''));
  }, []);
  const save = async () => {
    setSaving(true);
    try { await client.put('emails/signature', { body_html: sig || '' }); toast.success('Signature saved'); onClose(); }
    catch (e) { toast.error(e.response?.data?.error || 'Could not save'); }
    finally { setSaving(false); }
  };
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3">
          <PenLine size={15} style={{ color: 'var(--color-primary-600)' }} />
          <span className="text-sm font-bold flex-1" style={{ color: 'var(--color-text)' }}>My signature</span>
          <button onClick={onClose} style={{ color: 'var(--color-text-secondary)' }}><X size={16} /></button>
        </div>
        <p className="text-[11px] mb-2" style={{ color: 'var(--color-text-secondary)' }}>Auto-inserted at the bottom of every new email (editable per-send).</p>
        {sig === null ? <div className="text-center py-6"><Loader2 size={16} className="animate-spin inline" /></div>
          : <RichTextEditor value={sig} onChange={setSig} placeholder="e.g. John Doe — Sales" minHeight={100} />}
        <div className="flex justify-end gap-2 mt-3">
          <button onClick={onClose} className="text-xs font-semibold px-3 py-2" style={{ color: 'var(--color-text-secondary)' }}>Cancel</button>
          <button onClick={save} disabled={saving} className="text-xs font-bold px-4 py-2 rounded-lg flex items-center gap-1.5" style={{ background: 'var(--gradient-sidebar)', color: 'var(--color-text-inverse)' }}>
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── main panel ────────────────────────────────────────────────────────────────
export default function MailPanel({ onClose, meId, liveTick, onUnreadChange }) {
  useAuth();   // panel only renders for authed users (launcher gates)
  const [folder, setFolder] = useState('inbox');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [view, setView] = useState({ kind: 'list' });   // list | thread {threadId} | compose {preset}
  const [sigOpen, setSigOpen] = useState(false);
  const qTimer = useRef(null);
  const [qLive, setQLive] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: PAGE, offset };
      if (q) params.q = q;
      if (unreadOnly && folder === 'inbox') params.unread = '1';
      const r = await client.get(`emails/folders/${folder}`, { params });
      setItems(r.data.items || []);
      setTotal(t => (r.data.total == null ? t : r.data.total));
    } catch (e) { toast.error(e.response?.data?.error || 'Could not load mail'); setItems([]); }
    finally { setLoading(false); }
  }, [folder, offset, q, unreadOnly]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (liveTick > 0 && view.kind === 'list') load(); }, [liveTick]);   // eslint-disable-line react-hooks/exhaustive-deps

  const search = (val) => {
    setQLive(val);
    clearTimeout(qTimer.current);
    qTimer.current = setTimeout(() => { setOffset(0); setQ(val); }, 350);
  };
  const switchFolder = (f) => { setFolder(f); setOffset(0); setQ(''); setQLive(''); setUnreadOnly(false); setView({ kind: 'list' }); };

  const openItem = (it) => {
    if (it.status === 'draft') {
      setView({ kind: 'compose', preset: {
        draft_id: it.id, subject: it.subject, body_html: it.body_html || '',
        to: (it.draft_recipients?.to || []), cc: (it.draft_recipients?.cc || []), bcc: (it.draft_recipients?.bcc || []),
      } });
      return;
    }
    setView({ kind: 'thread', threadId: it.thread_id });
  };
  const trash = async (e, it) => {
    e.stopPropagation();
    try {
      if (it.status === 'draft') await client.delete(`emails/drafts/${it.id}`);
      else await client.patch(`emails/${it.id}/folder`, { folder: folder === 'trash' ? 'inbox' : 'trash' });
      setItems(prev => prev.filter(x => x.id !== it.id));
      onUnreadChange?.();
    } catch (err) { toast.error(err.response?.data?.error || 'Could not move'); }
  };

  // collapse bulk blasts in Sent (one row per bulk_group_id, expandable count)
  const displayItems = (() => {
    if (folder !== 'sent') return items;
    const seen = new Map(); const out = [];
    for (const it of items) {
      if (!it.bulk_group_id) { out.push(it); continue; }
      if (seen.has(it.bulk_group_id)) { seen.get(it.bulk_group_id)._bulkCount++; continue; }
      const row = { ...it, _bulkCount: 1 }; seen.set(it.bulk_group_id, row); out.push(row);
    }
    return out;
  })();

  const listLabel = (it) => {
    if (folder === 'inbox' || folder === 'trash') return it.sender_copy ? `To: ${it.recipients.filter(r => r.kind !== 'bcc').map(r => r.name).join(', ') || '—'}` : it.sender_name;
    if (folder === 'drafts') return `Draft${(it.draft_recipients?.to || []).length ? ` — to ${(it.draft_recipients.to).map(r => r.name).join(', ')}` : ''}`;
    const names = it.recipients.filter(r => r.kind === 'to').map(r => r.name);
    return `To: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}${it._bulkCount > 1 ? ` · bulk ×${it._bulkCount}` : ''}`;
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-stretch justify-center p-0 sm:p-6" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="relative w-full max-w-5xl flex rounded-none sm:rounded-2xl overflow-hidden animate-scale-in"
        style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }} onClick={e => e.stopPropagation()}>

        {/* folder sidebar */}
        <div className="w-44 flex-shrink-0 flex flex-col p-3 gap-1" style={{ background: 'var(--color-surface)', borderRight: '1px solid var(--color-border)' }}>
          <button onClick={() => setView({ kind: 'compose', preset: null })}
            className="flex items-center justify-center gap-2 text-sm font-bold px-3 py-2.5 rounded-xl mb-2"
            style={{ background: 'var(--gradient-sidebar)', color: 'var(--color-text-inverse)' }}>
            <PenSquare size={15} /> Compose
          </button>
          {FOLDERS.map(({ key, label, Icon }) => (
            <button key={key} onClick={() => switchFolder(key)}
              className="flex items-center gap-2.5 text-sm font-semibold px-3 py-2 rounded-xl text-left"
              style={{
                background: folder === key && view.kind === 'list' ? 'var(--color-primary-100, #e0e7ff)' : 'transparent',
                color: folder === key ? 'var(--color-primary-700, #4338ca)' : 'var(--color-text-secondary)',
              }}>
              <Icon size={15} /> {label}
            </button>
          ))}
          <div className="mt-auto pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
            <button onClick={() => setSigOpen(true)} className="flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-xl w-full text-left"
              style={{ color: 'var(--color-text-secondary)' }}>
              <PenLine size={13} /> Signature
            </button>
          </div>
        </div>

        {/* main area */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {view.kind === 'compose' ? (
            <Compose me={meId} preset={view.preset}
              onClose={() => setView({ kind: 'list' })}
              onSent={() => { setView({ kind: 'list' }); switchFolder('sent'); }} />
          ) : view.kind === 'thread' ? (
            <ThreadView threadId={view.threadId} meId={meId}
              onBack={() => { setView({ kind: 'list' }); load(); }}
              onCompose={(preset) => setView({ kind: 'compose', preset })}
              refreshUnread={() => onUnreadChange?.()} />
          ) : (
            <>
              <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
                <Mail size={16} style={{ color: 'var(--color-primary-600)' }} />
                <span className="text-sm font-bold capitalize" style={{ color: 'var(--color-text)' }}>{folder}</span>
                <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{total ? total.toLocaleString() : ''}</span>
                <div className="relative flex-1 max-w-xs ml-2">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
                  <input value={qLive} onChange={e => search(e.target.value)} placeholder="Search subject or body…" style={{ ...inp, paddingLeft: 28, width: '100%' }} />
                </div>
                {folder === 'inbox' && (
                  <button onClick={() => { setUnreadOnly(v => !v); setOffset(0); }}
                    className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg"
                    style={{ border: `1px solid ${unreadOnly ? 'var(--color-primary-600)' : 'var(--color-border)'}`, color: unreadOnly ? 'var(--color-primary-600)' : 'var(--color-text-secondary)' }}>
                    Unread
                  </button>
                )}
                <button onClick={load} className="p-1.5 rounded-lg" title="Refresh" style={{ color: 'var(--color-text-secondary)' }}>
                  <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                </button>
                <button onClick={onClose} className="p-1.5 rounded-lg" style={{ color: 'var(--color-text-secondary)' }}><X size={17} /></button>
              </div>

              <div className="flex-1 overflow-y-auto min-h-0">
                {loading && !items.length ? (
                  <div className="flex justify-center py-14"><Loader2 className="animate-spin" style={{ color: 'var(--color-text-tertiary)' }} /></div>
                ) : displayItems.length === 0 ? (
                  <div className="text-center py-14 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
                    <Mail size={26} className="inline mb-2" /><div>Nothing in {folder}{q ? ' for that search' : ''}.</div>
                  </div>
                ) : displayItems.map(it => (
                  <div key={it.id} onClick={() => openItem(it)}
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-bg-secondary transition-colors group"
                    style={{ borderBottom: '1px solid var(--color-border)', background: (folder === 'inbox' && !it.read) ? 'var(--color-primary-50, rgba(99,102,241,0.05))' : 'transparent' }}>
                    {folder === 'inbox' && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: it.read ? 'transparent' : 'var(--color-primary-600)' }} />}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm truncate ${(folder === 'inbox' && !it.read) ? 'font-bold' : 'font-semibold'}`} style={{ color: 'var(--color-text)' }}>{listLabel(it)}</span>
                        {it.attachments_count > 0 && <Paperclip size={11} style={{ color: 'var(--color-text-tertiary)' }} className="flex-shrink-0" />}
                        {it.sender_copy && <CornerUpLeft size={11} title="Your sent copy" style={{ color: 'var(--color-text-tertiary)' }} className="flex-shrink-0" />}
                        <span className="text-[11px] ml-auto flex-shrink-0 tabular-nums" style={{ color: 'var(--color-text-tertiary)' }}>{fmtWhen(it.sent_at)}</span>
                      </div>
                      <div className="flex items-baseline gap-1.5 min-w-0">
                        <span className={`text-[13px] truncate ${(folder === 'inbox' && !it.read) ? 'font-semibold' : ''}`} style={{ color: 'var(--color-text)' }}>{it.subject || '(no subject)'}</span>
                        <span className="text-xs truncate" style={{ color: 'var(--color-text-tertiary)' }}>— {it.preview}</span>
                      </div>
                    </div>
                    <button onClick={e => trash(e, it)} title={folder === 'trash' ? 'Restore' : 'Trash'}
                      className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      {folder === 'trash' ? <CornerUpLeft size={13} style={{ color: 'var(--color-primary-600)' }} /> : <Trash2 size={13} style={{ color: '#ef4444' }} />}
                    </button>
                  </div>
                ))}
              </div>

              {total > PAGE && (
                <div className="flex items-center justify-between px-4 py-2 text-xs flex-shrink-0" style={{ borderTop: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                  <span>{offset + 1}–{Math.min(offset + PAGE, total)} of {total.toLocaleString()}</span>
                  <div className="flex gap-2">
                    <button disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - PAGE))} className="px-2.5 py-1 rounded-lg disabled:opacity-40" style={{ border: '1px solid var(--color-border)' }}>Prev</button>
                    <button disabled={offset + PAGE >= total} onClick={() => setOffset(o => o + PAGE)} className="px-2.5 py-1 rounded-lg disabled:opacity-40" style={{ border: '1px solid var(--color-border)' }}>Next</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {sigOpen && <SignatureEditor onClose={() => setSigOpen(false)} />}
      </div>
    </div>,
    document.body,
  );
}
