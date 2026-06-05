import { useState } from 'react';
import { User, Building2, Shield, Mail, Hash, Briefcase, Lock, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import Modal from '../UI/Modal';
import client from '../../api/client';

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

const InfoRow = ({ icon: Icon, label, value }) => {
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
        <p className="text-sm font-medium break-all" style={{ color: 'var(--color-text)' }}>{value}</p>
      </div>
    </div>
  );
};

// Self-service password change. Hits PUT /auth/me/password which verifies
// the current password by attempting a Supabase sign-in, then updates via
// the admin API. Available to every logged-in user (including superadmin /
// readonly_admin) since the endpoint is in the auth router, not the user
// management router that readonlyGuard would block.
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
            <InfoRow icon={Hash}     label="User ID"     value={user?.id} />
          </div>
        </div>

        {/* ── Password change ── */}
        <PasswordSection user={user} />

      </div>
    </Modal>
  );
};

export default ProfileModal;
