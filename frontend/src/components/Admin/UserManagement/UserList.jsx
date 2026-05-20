import React, { useState } from 'react';
import { toastError } from '../../../utils/toast';
import { Edit2, Trash2, LogIn, Copy, ExternalLink, X, CheckCircle, XCircle } from 'lucide-react';
import { Badge, Button, Card } from '../../../components/UI';
import { Table } from '../../../components/UI';
import { useAuth } from '../../../contexts/AuthContext';
import client from '../../../api/client';

const ImpersonateModal = ({ data, onClose }) => {
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(data.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback for browsers that block clipboard without https
      const el = document.getElementById('impersonate-link-input');
      if (el) { el.select(); document.execCommand('copy'); }
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="rounded-2xl shadow-2xl pointer-events-auto w-full max-w-lg"
          style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 rounded-t-2xl"
            style={{ background: 'var(--gradient-sidebar)' }}>
            <div className="flex items-center gap-2">
              <LogIn size={18} className="text-white" />
              <div>
                <p className="text-sm font-bold text-white">Login as User</p>
                <p className="text-xs text-white/70">{data.email}</p>
              </div>
            </div>
            <button onClick={onClose}
              className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30 transition-colors">
              <X size={15} className="text-white" />
            </button>
          </div>

          <div className="px-5 py-4 space-y-4">
            {/* Warning */}
            <div className="flex items-start gap-2 p-3 rounded-xl"
              style={{ backgroundColor: 'var(--color-warning-50)', border: '1px solid var(--color-warning-200)' }}>
              <span className="text-xs font-semibold mt-0.5 flex-shrink-0" style={{ color: 'var(--color-warning-700)' }}>⚠</span>
              <p className="text-xs" style={{ color: 'var(--color-warning-700)' }}>
                This link is <strong>single-use</strong>. Once opened, it becomes invalid. Generate a new one if needed. Opens in the same browser — log out of your superadmin session first or open in a private/incognito window.
              </p>
            </div>

            {/* Link field */}
            <div>
              <p className="text-xs font-semibold text-text-secondary mb-1.5">One-time login link</p>
              <div className="flex gap-2">
                <input
                  id="impersonate-link-input"
                  readOnly
                  value={data.link}
                  className="flex-1 text-xs rounded-lg px-3 py-2 font-mono truncate"
                  style={{
                    backgroundColor: 'var(--color-bg-secondary)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text-secondary)',
                    outline: 'none',
                  }}
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={handleCopy}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all"
                style={{
                  backgroundColor: copied ? 'var(--color-success-50)' : 'var(--color-bg-secondary)',
                  color: copied ? 'var(--color-success-700)' : 'var(--color-text)',
                  border: `1px solid ${copied ? 'var(--color-success-200)' : 'var(--color-border)'}`,
                }}>
                {copied ? <CheckCircle size={15} /> : <Copy size={15} />}
                {copied ? 'Copied!' : 'Copy Link'}
              </button>
              <a
                href={data.link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
                style={{ background: 'var(--gradient-sidebar)' }}
                onClick={onClose}>
                <ExternalLink size={15} />
                Open in New Tab
              </a>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

const UserList = ({ users, onEdit, onToggleActive, onDelete }) => {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'superadmin';

  const [impersonateData, setImpersonateData] = useState(null);
  const [impersonateLoading, setImpersonateLoading] = useState(null);

  const handleImpersonate = async (row) => {
    setImpersonateLoading(row.user_id);
    try {
      const res = await client.post(`users/${row.user_id}/impersonate`);
      setImpersonateData({ link: res.data.link, email: res.data.email, name: row.name });
    } catch (err) {
      toastError(err, 'Failed to generate login link');
    } finally {
      setImpersonateLoading(null);
    }
  };

  if (users.length === 0) {
    return (
      <Card className="p-8 text-center">
        <p className="text-text-secondary">No users found</p>
      </Card>
    );
  }

  const roleColors = {
    SuperAdmin: 'error',
    'Company Admin': 'primary',
    Manager: 'warning',
    Operations: 'info',
    Fronter: 'success',
    Closer: 'secondary',
  };

  const tableRows = users.map((user) => ({
    id: user.id,
    user_id: user.user_id,
    email: user.email,
    name: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
    role: user.role,
    role_level: user.role_level,
    is_active: user.is_active,
    status: user.is_active ? 'Active' : 'Inactive',
    created: new Date(user.created_at).toLocaleDateString(),
  }));

  const columns = [
    { key: 'email', label: 'Email', width: '200px' },
    { key: 'name',  label: 'Name',  width: '150px' },
    {
      key: 'role',
      label: 'Role',
      width: '120px',
      render: (row) => (
        <Badge variant={roleColors[row.role] || 'secondary'} size="sm">{row.role}</Badge>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      width: '100px',
      render: (row) => (
        <Badge variant={row.status === 'Active' ? 'success' : 'secondary'} size="sm">{row.status}</Badge>
      ),
    },
    { key: 'created', label: 'Created', width: '120px' },
  ];

  const actions = [
    {
      label: 'Edit',
      icon: <Edit2 size={16} />,
      onClick: (row) => onEdit(users.find(u => u.id === row.id) || row),
      variant: 'ghost',
      size: 'sm',
    },
    ...(isSuperAdmin ? [{
      label: 'Login as',
      icon: <LogIn size={16} />,
      onClick: (row) => handleImpersonate(row),
      variant: 'ghost',
      size: 'sm',
      className: 'text-primary-600 hover:text-primary-700',
    }] : []),
    ...(onToggleActive ? [{
      // Status-aware: deactivate an active user, reactivate an inactive one
      label: (row) => (row.is_active ? 'Deactivate' : 'Activate'),
      icon: (row) => (row.is_active
        ? <XCircle size={16} className="text-warning-500" />
        : <CheckCircle size={16} className="text-success-500" />),
      onClick: (row) => onToggleActive(users.find(u => u.id === row.id) || row),
      variant: 'ghost',
      size: 'sm',
    }] : []),
    {
      label: 'Delete',
      icon: <Trash2 size={16} />,
      onClick: (row) => onDelete(row.id),
      variant: 'ghost',
      size: 'sm',
      className: 'text-error-600 hover:text-error-700',
    },
  ];

  return (
    <>
      <Card variant="outlined">
        <Table
          columns={columns}
          data={tableRows}
          rowActions={actions}
          sortable
          hover
          onRowClick={(row) => onEdit(users.find(u => u.id === row.id) || row)}
        />
      </Card>

      {impersonateData && (
        <ImpersonateModal data={impersonateData} onClose={() => setImpersonateData(null)} />
      )}
    </>
  );
};

export default UserList;
