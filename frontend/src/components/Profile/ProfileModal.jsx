import { useState } from 'react';
import { User, Lock, Save, Eye, EyeOff, Building2, Shield } from 'lucide-react';
import Modal from '../UI/Modal';
import Button from '../UI/Button';
import client from '../../api/client';

const ROLE_COLORS = {
  superadmin:         '#6366f1',
  company_admin:      '#8b5cf6',
  operations_manager: '#3b82f6',
  closer_manager:     '#8b5cf6',
  manager:            '#f59e0b',
  closer:             '#6366f1',
  fronter:            '#10b981',
  operations:         '#6b7280',
};

const Avatar = ({ firstName, lastName, size = 'lg' }) => {
  const initials = [firstName, lastName].filter(Boolean).map(n => n[0].toUpperCase()).join('') || '?';
  const s = size === 'lg' ? 'w-20 h-20 text-2xl' : 'w-10 h-10 text-sm';
  return (
    <div className={`${s} rounded-full flex items-center justify-center font-bold text-white flex-shrink-0`}
      style={{ background: 'var(--gradient-sidebar)' }}>
      {initials}
    </div>
  );
};

const ProfileModal = ({ isOpen, onClose, user, onUpdateUser }) => {
  // Profile edit
  const [firstName, setFirstName] = useState(user?.first_name || '');
  const [lastName, setLastName]   = useState(user?.last_name  || '');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileErr, setProfileErr]       = useState('');
  const [profileOk, setProfileOk]         = useState(false);

  // Password change
  const [currentPw,  setCurrentPw]  = useState('');
  const [newPw,      setNewPw]      = useState('');
  const [confirmPw,  setConfirmPw]  = useState('');
  const [showCurr,   setShowCurr]   = useState(false);
  const [showNew,    setShowNew]    = useState(false);
  const [pwSaving,   setPwSaving]   = useState(false);
  const [pwErr,      setPwErr]      = useState('');
  const [pwOk,       setPwOk]       = useState(false);

  const resetAll = () => {
    setFirstName(user?.first_name || '');
    setLastName(user?.last_name   || '');
    setProfileErr(''); setProfileOk(false);
    setCurrentPw(''); setNewPw(''); setConfirmPw('');
    setPwErr(''); setPwOk(false);
  };

  const handleClose = () => { resetAll(); onClose(); };

  const saveProfile = async (e) => {
    e.preventDefault();
    setProfileErr(''); setProfileOk(false);
    if (!firstName.trim()) { setProfileErr('First name required'); return; }
    setProfileSaving(true);
    try {
      await client.put('auth/me/profile', { first_name: firstName.trim(), last_name: lastName.trim() });
      onUpdateUser?.({ first_name: firstName.trim(), last_name: lastName.trim() });
      setProfileOk(true);
      setTimeout(() => setProfileOk(false), 3000);
    } catch (err) {
      setProfileErr(err.response?.data?.error || 'Failed to update profile');
    } finally {
      setProfileSaving(false);
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setPwErr(''); setPwOk(false);
    if (newPw !== confirmPw) { setPwErr('New passwords do not match'); return; }
    if (newPw.length < 8) { setPwErr('Password must be at least 8 characters'); return; }
    setPwSaving(true);
    try {
      await client.put('auth/me/password', { current_password: currentPw, new_password: newPw });
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
      setPwOk(true);
      setTimeout(() => setPwOk(false), 4000);
    } catch (err) {
      setPwErr(err.response?.data?.error || 'Failed to change password');
    } finally {
      setPwSaving(false);
    }
  };

  const roleColor = ROLE_COLORS[user?.role] || '#6366f1';

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="My Profile" size="lg">
      <div className="space-y-6">

        {/* ── Identity card ── */}
        <div className="flex items-center gap-4 p-4 rounded-xl"
          style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          <Avatar firstName={user?.first_name} lastName={user?.last_name} />
          <div className="flex-1 min-w-0">
            <p className="text-xl font-bold text-text truncate">
              {[user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.email}
            </p>
            <p className="text-sm text-text-secondary truncate">{user?.email}</p>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {user?.role_name && (
                <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold"
                  style={{ backgroundColor: `${roleColor}18`, color: roleColor, border: `1px solid ${roleColor}30` }}>
                  <Shield size={11} /> {user.role_name}
                </span>
              )}
              {user?.company_name && (
                <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium text-text-secondary"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                  <Building2 size={11} /> {user.company_name}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── Edit name ── */}
        <div className="rounded-xl border overflow-hidden"
          style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-2 px-4 py-3"
            style={{ background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)' }}>
            <User size={15} style={{ color: 'var(--color-primary-600)' }} />
            <span className="font-bold text-sm text-text">Edit Profile</span>
          </div>
          <form onSubmit={saveProfile} className="p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">First Name</label>
                <input className="input" value={firstName} onChange={e => setFirstName(e.target.value)} required placeholder="John" />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Last Name</label>
                <input className="input" value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Doe" />
              </div>
            </div>
            {profileErr && <p className="text-xs text-error-600">{profileErr}</p>}
            {profileOk  && <p className="text-xs text-success-600">Profile updated.</p>}
            <Button type="submit" variant="primary" size="sm" loading={profileSaving} disabled={profileSaving} className="flex items-center gap-1.5">
              <Save size={14} /> Save Name
            </Button>
          </form>
        </div>

        {/* ── Change password ── */}
        <div className="rounded-xl border overflow-hidden"
          style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-2 px-4 py-3"
            style={{ background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)' }}>
            <Lock size={15} style={{ color: 'var(--color-primary-600)' }} />
            <span className="font-bold text-sm text-text">Change Password</span>
          </div>
          <form onSubmit={changePassword} className="p-4 space-y-3">
            {/* Current password */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Current Password</label>
              <div className="relative">
                <input className="input pr-9" type={showCurr ? 'text' : 'password'}
                  value={currentPw} onChange={e => setCurrentPw(e.target.value)} required placeholder="Enter current password" />
                <button type="button" onClick={() => setShowCurr(s => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text">
                  {showCurr ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
            {/* New password */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">New Password</label>
              <div className="relative">
                <input className="input pr-9" type={showNew ? 'text' : 'password'}
                  value={newPw} onChange={e => setNewPw(e.target.value)} required minLength={8} placeholder="Min. 8 characters" />
                <button type="button" onClick={() => setShowNew(s => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text">
                  {showNew ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
            {/* Confirm */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Confirm New Password</label>
              <input className="input" type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                required minLength={8} placeholder="Repeat new password" />
            </div>
            {pwErr && <p className="text-xs text-error-600">{pwErr}</p>}
            {pwOk  && <p className="text-xs text-success-600">Password changed successfully.</p>}
            <Button type="submit" variant="primary" size="sm" loading={pwSaving} disabled={pwSaving} className="flex items-center gap-1.5">
              <Lock size={14} /> Change Password
            </Button>
          </form>
        </div>

      </div>
    </Modal>
  );
};

export default ProfileModal;
