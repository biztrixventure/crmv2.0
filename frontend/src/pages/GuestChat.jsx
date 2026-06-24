import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Send, MessagesSquare, Loader2, Lock, Ban } from 'lucide-react';

// Public, link-only guest chat. No auth, no app shell, no theme dependency —
// explicit colors so it renders the same for any outsider who opens the link.
// Shows ONE group's messages (from when the guest was added) and lets them send
// plain text. Polls every 4s. If the superadmin disables the guest, it locks.
const API = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

const C = {
  bg: '#f1f5f9', card: '#ffffff', border: '#e2e8f0', text: '#0f172a',
  sub: '#64748b', accent: '#4f46e5', accentText: '#ffffff', mineBg: '#4f46e5',
  theirBg: '#f1f5f9', guest: '#0891b2',
};
const fmtTime = (s) => { try { return new Date(s).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };

export default function GuestChat() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [guest, setGuest]     = useState(null);
  const [conv, setConv]       = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText]       = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);
  const lastAt = useRef(null);

  const scrollDown = () => setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 40);
  const mergeIn = (list) => setMessages(prev => {
    const have = new Set(prev.map(m => m.id));
    const add = (list || []).filter(m => !have.has(m.id));
    return add.length ? [...prev, ...add] : prev;
  });

  // Initial load
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`${API}/guest/${token}`);
        const data = await r.json().catch(() => ({}));
        if (!alive) return;
        if (!r.ok) { setError(data.message || (data.error === 'disabled' ? 'This chat link has been disabled.' : 'This link is not valid.')); setLoading(false); return; }
        setGuest(data.guest); setConv(data.conversation); setMessages(data.messages || []);
        lastAt.current = data.messages?.length ? data.messages[data.messages.length - 1].created_at : null;
        setLoading(false); scrollDown();
      } catch { if (alive) { setError('Could not reach the chat. Check your connection.'); setLoading(false); } }
    })();
    return () => { alive = false; };
  }, [token]);

  // Poll for new messages
  useEffect(() => {
    if (loading || error) return;
    const id = setInterval(async () => {
      try {
        const url = `${API}/guest/${token}/poll${lastAt.current ? `?after=${encodeURIComponent(lastAt.current)}` : ''}`;
        const r = await fetch(url);
        if (r.status === 403) { setError('This chat link has been disabled.'); return; }
        const data = await r.json().catch(() => ({}));
        if (data.messages?.length) { mergeIn(data.messages); lastAt.current = data.messages[data.messages.length - 1].created_at; scrollDown(); }
      } catch { /* transient */ }
    }, 4000);
    return () => clearInterval(id);
  }, [loading, error, token]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const r = await fetch(`${API}/guest/${token}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { if (data.error === 'disabled') setError('This chat link has been disabled.'); return; }
      setMessages(prev => [...prev, data.message]); lastAt.current = data.message.created_at;
      setText(''); scrollDown();
    } catch { /* ignore */ } finally { setSending(false); }
  };

  const wrap = { minHeight: '100vh', background: C.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', fontFamily: 'system-ui, -apple-system, sans-serif' };

  if (loading) return (
    <div style={{ ...wrap, justifyContent: 'center' }}><Loader2 size={28} className="animate-spin" style={{ color: C.accent }} /></div>
  );
  if (error) return (
    <div style={{ ...wrap, justifyContent: 'center', padding: 24 }}>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '32px 28px', textAlign: 'center', maxWidth: 380 }}>
        <Ban size={32} style={{ color: '#ef4444', margin: '0 auto 12px' }} />
        <h1 style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: '0 0 6px' }}>Chat unavailable</h1>
        <p style={{ fontSize: 14, color: C.sub, margin: 0 }}>{error}</p>
      </div>
    </div>
  );

  return (
    <div style={wrap}>
      <div style={{ width: '100%', maxWidth: 720, height: '100vh', display: 'flex', flexDirection: 'column', background: C.card, borderLeft: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}` }}>
        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10, background: C.accent, color: C.accentText }}>
          <MessagesSquare size={20} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', gap: 6 }}>
              {conv?.title} {conv?.locked && <Lock size={13} />}
            </div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>You're chatting as {guest?.name}</div>
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {messages.length === 0 && <p style={{ textAlign: 'center', color: C.sub, fontSize: 13, marginTop: 24 }}>No messages yet. Say hello 👋</p>}
          {messages.map(m => {
            const mine = m.is_me;
            return (
              <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start' }}>
                {!mine && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: m.is_guest ? C.guest : C.accent, marginBottom: 2, paddingLeft: 4 }}>
                    {m.sender_name}{m.is_guest ? ' · Guest' : ''}
                  </span>
                )}
                <div style={{ maxWidth: '78%', padding: '8px 12px', borderRadius: 14, fontSize: 14, lineHeight: 1.4,
                  background: mine ? C.mineBg : C.theirBg, color: mine ? '#fff' : C.text, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                  {m.deleted ? <em style={{ opacity: 0.6 }}>message removed</em> : m.body}
                </div>
                <span style={{ fontSize: 10, color: C.sub, marginTop: 2, padding: '0 4px' }}>{fmtTime(m.created_at)}</span>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>

        {/* Composer */}
        <div style={{ padding: 12, borderTop: `1px solid ${C.border}`, display: 'flex', gap: 8 }}>
          <input
            value={text} onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Type a message…" disabled={conv?.locked}
            style={{ flex: 1, padding: '10px 14px', borderRadius: 12, border: `1px solid ${C.border}`, fontSize: 14, outline: 'none', color: C.text, background: conv?.locked ? '#f8fafc' : '#fff' }}
          />
          <button onClick={send} disabled={sending || !text.trim() || conv?.locked}
            style={{ width: 44, borderRadius: 12, border: 'none', background: C.accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', opacity: (sending || !text.trim() || conv?.locked) ? 0.5 : 1 }}>
            {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}
