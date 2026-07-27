import { useState, useEffect, useRef } from 'react';
import { User, Building2, Shield, Mail, Hash, Briefcase, Lock, CheckCircle2, AlertTriangle, Loader2, Headphones, Palette, Sun, Moon, Save, RotateCcw } from 'lucide-react';
import Modal from '../UI/Modal';
import client from '../../api/client';
import { CORE_TOKENS, getCachedTheme } from '../../utils/themeApply';
import { THEME_PRESETS, themeFromPreset, DEFAULT_PRESET_ID } from '../../utils/themePresets';
import { getUserTheme, applyUserTheme, clearUserTheme, reconcileUserTheme } from '../../utils/userTheme';

const ROLE_COLORS = {
  superadmin:         '#6366f1',
  readonly_admin:     '#8b5cf6',
  compliance_manager: '#ec4899',
  company_admin:      '#8b5cf6',
  operations_manager: '#3b82f6',
  closer_manager:     '#8b5cf6',
  fronter_manager:    '#10b981',
  manager:            '#f59e0b',
  closer:             '#6366f1',
  fronter:            '#10b981',
  operations:         '#6b7280',
};

const Avatar = ({ firstName, lastName }) => {
  const initials = [firstName, lastName].filter(Boolean).map(n => n[0].toUpperCase()).join('') || '?';
  return (
    <div className="w-20 h-20 rounded-full flex items-center justify-center font-bold text-white text-2xl flex-shrink-0"
      style={{ background: 'var(--gradient-sidebar)' }}>
      {initials}
    </div>
  );
};

const InfoRow = ({ icon: Icon, label, value, muted }) => {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 py-3"
      style={{ borderBottom: '1px solid var(--color-border)' }}>
      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
        <Icon size={14} style={{ color: 'var(--color-primary-600)' }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide mb-0.5"
          style={{ color: 'var(--color-text-tertiary)' }}>{label}</p>
        <p className="text-sm font-medium break-all" style={{ color: muted ? 'var(--color-text-tertiary)' : 'var(--color-text)' }}>{value}</p>
      </div>
    </div>
  );
};

// ── Self-service password change (unchanged) ────────────────────────────────
const PasswordSection = ({ user }) => {
  const [show, setShow]     = useState(false);
  const [cur, setCur]       = useState('');
  const [next, setNext]     = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy]     = useState(false);
  const [msg, setMsg]       = useState('');
  const [ok, setOk]         = useState(false);

  const reset = () => { setCur(''); setNext(''); setConfirm(''); setMsg(''); setOk(false); };

  const submit = async (e) => {
    e.preventDefault();
    setMsg(''); setOk(false);
    if (!cur || !next) { setMsg('Both fields are required.'); return; }
    if (next.length < 8) { setMsg('New password must be at least 8 characters.'); return; }
    if (next !== confirm) { setMsg('Confirmation does not match.'); return; }
    if (next === cur)    { setMsg('New password must be different from the current one.'); return; }
    setBusy(true);
    try {
      await client.put('auth/me/password', { current_password: cur, new_password: next });
      setOk(true); setMsg('Password updated.');
      setCur(''); setNext(''); setConfirm('');
      setTimeout(() => { setOk(false); setMsg(''); setShow(false); }, 1500);
    } catch (e) {
      setMsg(e.response?.data?.error || 'Update failed.');
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
      <button onClick={() => { if (show) reset(); setShow(s => !s); }}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-bg-secondary transition-colors"
        style={{ background: 'var(--color-bg-secondary)', borderBottom: show ? '1px solid var(--color-border)' : 'none' }}>
        <span className="flex items-center gap-2 font-bold text-sm" style={{ color: 'var(--color-text)' }}>
          <Lock size={15} style={{ color: 'var(--color-primary-600)' }} />
          Change password
        </span>
        <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{show ? 'Cancel' : 'Open'}</span>
      </button>
      {show && (
        <form onSubmit={submit} className="px-4 py-4 space-y-3">
          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest mb-1 block" style={{ color: 'var(--color-text-secondary)' }}>Current password</label>
            <input type="password" value={cur} onChange={e => setCur(e.target.value)} className="input text-sm w-full" autoComplete="current-password" required />
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest mb-1 block" style={{ color: 'var(--color-text-secondary)' }}>New password</label>
            <input type="password" value={next} onChange={e => setNext(e.target.value)} className="input text-sm w-full" autoComplete="new-password" minLength={8} required />
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest mb-1 block" style={{ color: 'var(--color-text-secondary)' }}>Confirm new password</label>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} className="input text-sm w-full" autoComplete="new-password" minLength={8} required />
          </div>
          {msg && (
            <p className="text-xs flex items-center gap-1.5"
              style={{ color: ok ? 'var(--color-success-700, #047857)' : 'var(--color-error-600, #dc2626)' }}>
              {ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />} {msg}
            </p>
          )}
          <button type="submit" disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-40"
            style={{ background: 'var(--gradient-sidebar)' }}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />} Update password
          </button>
        </form>
      )}
    </div>
  );
};

// ── Personal theme (localStorage; layered over the company theme) ───────────
const OBSIDIAN = themeFromPreset(DEFAULT_PRESET_ID);
const normalize = (t) => {
  const base = t || getCachedTheme() || OBSIDIAN;
  return {
    preset: base.preset || null,
    borders: base.borders || 'normal',
    light: { ...OBSIDIAN.light, ...(base.light || {}) },
    dark:  { ...OBSIDIAN.dark,  ...(base.dark  || {}) },
  };
};

const ThemeSection = ({ uid }) => {
  const [open, setOpen]   = useState(false);
  const [theme, setTheme] = useState(() => normalize(getUserTheme(uid)));
  const [mode, setMode]   = useState(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'));
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(!!getUserTheme(uid));
  const hadTheme = useRef(!!getUserTheme(uid));

  // Live-preview any in-progress edit (no cache); on unmount revert to persisted.
  useEffect(() => {
    if (!open) return;
    applyUserTheme(theme, uid, { cache: false });
  }, [theme, open, uid]);
  useEffect(() => () => { reconcileUserTheme(uid); }, [uid]);   // drop unsaved preview when modal closes

  const setToken = (key, value) => {
    setTheme(t => ({ ...t, preset: null, [mode]: { ...t[mode], [key]: value } }));
    setDirty(true);
  };
  const pickPreset = (id) => { setTheme(normalize(themeFromPreset(id))); setDirty(true); };
  const save = () => { applyUserTheme(theme, uid); setSaved(true); setDirty(false); hadTheme.current = true; };
  const reset = () => { clearUserTheme(uid); hadTheme.current = false; setSaved(false); setDirty(false); setTheme(normalize(getCachedTheme())); };

  const core = theme[mode];

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-bg-secondary transition-colors"
        style={{ background: 'var(--color-bg-secondary)', borderBottom: open ? '1px solid var(--color-border)' : 'none' }}>
        <span className="flex items-center gap-2 font-bold text-sm" style={{ color: 'var(--color-text)' }}>
          <Palette size={15} style={{ color: 'var(--color-primary-600)' }} />
          My colours {saved && <span className="text-[11px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'var(--color-primary-600)', color: '#fff' }}>Custom</span>}
        </span>
        <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{open ? 'Close' : 'Personalise'}</span>
      </button>

      {open && (
        <div className="px-4 py-4 space-y-4">
          <p className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
            Saved only on <b>this device / browser</b> — it personalises your view without changing anyone else’s. Light and dark are edited separately.
          </p>

          {/* Light / dark editor toggle */}
          <div className="inline-flex rounded-lg p-0.5" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            {[{ k: 'light', I: Sun }, { k: 'dark', I: Moon }].map(({ k, I }) => (
              <button key={k} onClick={() => setMode(k)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold capitalize transition-colors"
                style={{ background: mode === k ? 'var(--color-surface)' : 'transparent', color: mode === k ? 'var(--color-primary-600)' : 'var(--color-text-secondary)' }}>
                <I size={13} /> {k}
              </button>
            ))}
          </div>

          {/* Preset quick-picks */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Start from a preset</p>
            <div className="flex flex-wrap gap-2">
              {THEME_PRESETS.map(p => (
                <button key={p.id} onClick={() => pickPreset(p.id)} title={p.desc}
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-semibold"
                  style={{ background: 'var(--color-surface)', border: `1px solid ${theme.preset === p.id ? 'var(--color-primary-600)' : 'var(--color-border)'}`, color: 'var(--color-text)' }}>
                  <span className="w-3.5 h-3.5 rounded-full" style={{ background: p[mode].primary }} />
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          {/* Core token pickers */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Fine-tune ({mode})</p>
            <div className="grid grid-cols-2 gap-2">
              {CORE_TOKENS.map(tok => (
                <label key={tok.key} className="flex items-center gap-2 rounded-lg px-2 py-1.5" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                  <input type="color" value={core[tok.key] || '#000000'} onChange={e => setToken(tok.key, e.target.value)}
                    className="w-7 h-7 rounded cursor-pointer flex-shrink-0 bg-transparent" style={{ border: 'none', padding: 0 }} />
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold truncate" style={{ color: 'var(--color-text)' }}>{tok.label}</span>
                    <span className="block text-[11px] sm:text-[10px] font-mono" style={{ color: 'var(--color-text-tertiary)' }}>{core[tok.key]}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Live preview mini */}
          <div className="rounded-lg p-3" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <p className="text-[11px] font-bold mb-2" style={{ color: 'var(--color-text-secondary)' }}>Live preview</p>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-3 py-1.5 rounded-lg text-xs font-bold text-white" style={{ background: 'var(--color-primary-600)' }}>Primary</span>
              <span className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>Surface</span>
              <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Muted text</span>
              <a className="text-xs font-semibold" style={{ color: 'var(--color-link)' }}>Link</a>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button onClick={save} disabled={!dirty}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-40"
              style={{ background: 'var(--gradient-sidebar)' }}>
              <Save size={14} /> Save my colours
            </button>
            {(saved || hadTheme.current) && (
              <button onClick={reset}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                <RotateCcw size={14} /> Reset to default
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const ProfileModal = ({ isOpen, onClose, user }) => {
  const roleColor = ROLE_COLORS[user?.role] || '#6366f1';
  const fullName  = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="My Profile" size="md">
      <div className="space-y-5">

        {/* ── Avatar + identity ── */}
        <div className="flex items-center gap-4 p-4 rounded-xl"
          style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          <Avatar firstName={user?.first_name} lastName={user?.last_name} />
          <div className="flex-1 min-w-0">
            <p className="text-xl font-bold truncate" style={{ color: 'var(--color-text)' }}>
              {fullName || user?.email || '—'}
            </p>
            <p className="text-sm truncate mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
              {user?.email}
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {user?.role_name && (
                <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold"
                  style={{ backgroundColor: `${roleColor}18`, color: roleColor, border: `1px solid ${roleColor}30` }}>
                  <Shield size={11} /> {user.role_name}
                </span>
              )}
              {user?.company_name && (
                <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium"
                  style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                  <Building2 size={11} /> {user.company_name}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── Info fields ── */}
        <div className="rounded-xl overflow-hidden"
          style={{ border: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-2 px-4 py-3"
            style={{ background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)' }}>
            <User size={15} style={{ color: 'var(--color-primary-600)' }} />
            <span className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>Account Details</span>
          </div>
          <div className="px-4 [&>*:last-child]:border-b-0">
            <InfoRow icon={User}     label="Full Name"   value={fullName} />
            <InfoRow icon={Mail}     label="Email"       value={user?.email} />
            <InfoRow icon={Shield}   label="Role"        value={user?.role_name} />
            <InfoRow icon={Building2} label="Company"    value={user?.company_name} />
            <InfoRow icon={Briefcase} label="Department" value={user?.department || null} />
            {/* Dialer id — read-only for the user; managers assign it. */}
            <InfoRow icon={Headphones} label="VICIdial ID"
              value={user?.vicidial_agent_id || 'Not set — contact your manager to add your dialer ID.'}
              muted={!user?.vicidial_agent_id} />
            <InfoRow icon={Hash}     label="User ID"     value={user?.id} />
          </div>
        </div>

        {/* ── Personal colours ── */}
        <ThemeSection uid={user?.id} />

        {/* ── Password change ── */}
        <PasswordSection user={user} />

      </div>
    </Modal>
  );
};

export default ProfileModal;
