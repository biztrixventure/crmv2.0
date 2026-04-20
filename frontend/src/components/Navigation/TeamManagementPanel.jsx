import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Users, PlusCircle, Trash2, XCircle, CheckCircle, Edit2 } from 'lucide-react';
import { Card, Badge, Button } from '../UI';
import Modal from '../UI/Modal';
import CreateUserModal from '../Admin/UserManagement/CreateUserModal';
import UserModal from '../Admin/UserManagement/UserModal';
import client from '../../api/client';

const TeamManagementPanel = ({ companyId }) => {
  const { hasPermission } = useAuth();
  const [members, setMembers]   = useState([]);
  const [loading, setLoading]   = useState(false);
  const [showAdd, setShowAdd]   = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [confirm, setConfirm]   = useState(null);
  const [actionErr, setActionErr] = useState('');

  const load = useCallback(() => {
    if (!companyId) return;
    setLoading(true);
    client.get('users', { params: { company_id: companyId } })
      .then(r => setMembers(r.data.users || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const toggleActive = async (u) => {
    setActionErr('');
    try {
      await client.put(`users/${u.id}`, { is_active: !u.is_active });
      load();
    } catch (err) { setActionErr(err.response?.data?.error || 'Action failed'); }
  };

  const handleSaveUser = async (formData) => {
    await client.put(`users/${editUser.id}`, formData);
    load();
  };

  const deleteUser = async (id) => {
    setActionErr('');
    try {
      await client.delete(`users/${id}`);
      load();
    } catch (err) { setActionErr(err.response?.data?.error || 'Delete failed'); }
    setConfirm(null);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-text flex items-center gap-2">
            <Users size={22} style={{ color: 'var(--color-primary-600)' }} />
            Team Management
          </h2>
          <p className="text-text-secondary text-sm mt-0.5">{members.length} member{members.length !== 1 ? 's' : ''}</p>
        </div>
        {hasPermission('create_user') && (
          <Button variant="primary" size="sm" onClick={() => setShowAdd(true)} className="flex items-center gap-1.5">
            <PlusCircle size={15} /> Add Member
          </Button>
        )}
      </div>

      {actionErr && <p className="text-sm text-error-600">{actionErr}</p>}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      ) : members.length === 0 ? (
        <Card className="p-16 text-center">
          <Users size={48} className="mx-auto mb-4 text-text-tertiary" />
          <p className="text-text-secondary mb-4">No team members yet.</p>
          {hasPermission('create_user') && (
            <Button variant="primary" onClick={() => setShowAdd(true)}>Add First Member</Button>
          )}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                  {['Name', 'Email', 'Role', 'Level', 'Status', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-bold text-text-secondary uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.map(u => (
                  <tr key={u.id} className="hover:bg-bg-secondary" style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td className="px-4 py-3 font-semibold text-text">
                      {[u.first_name, u.last_name].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-text-secondary">{u.email || '—'}</td>
                    <td className="px-4 py-3 text-xs text-text-secondary">{u.role || '—'}</td>
                    <td className="px-4 py-3 text-xs text-text-secondary capitalize">
                      {u.role_level?.replace(/_/g, ' ') || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={u.is_active ? 'success' : 'secondary'} size="sm">
                        {u.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {hasPermission('edit_user') && (
                          <>
                            <button onClick={() => setEditUser(u)} title="Edit"
                              className="p-1 rounded hover:bg-bg-secondary transition-colors">
                              <Edit2 size={15} style={{ color: 'var(--color-primary-500)' }} />
                            </button>
                            <button onClick={() => toggleActive(u)} title={u.is_active ? 'Deactivate' : 'Activate'}
                              className="p-1 rounded hover:bg-bg-secondary transition-colors">
                              {u.is_active
                                ? <XCircle size={15} className="text-warning-500" />
                                : <CheckCircle size={15} className="text-success-500" />}
                            </button>
                          </>
                        )}
                        {hasPermission('delete_user') && (
                          <button
                            onClick={() => setConfirm({ id: u.id, name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email })}
                            title="Delete"
                            className="p-1 rounded hover:bg-error-50 dark:hover:bg-error-900 transition-colors">
                            <Trash2 size={15} className="text-error-500" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <CreateUserModal
        isOpen={showAdd}
        onClose={() => setShowAdd(false)}
        companyId={companyId}
        onCreated={load}
      />

      {editUser && (
        <UserModal
          user={editUser}
          onClose={() => setEditUser(null)}
          onSave={handleSaveUser}
        />
      )}

      {confirm && (
        <Modal isOpen title="Delete Member" onClose={() => setConfirm(null)} size="sm">
          <p className="text-text-secondary text-sm mb-6">
            Permanently delete <strong>{confirm.name}</strong>? This cannot be undone.
          </p>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => deleteUser(confirm.id)}>Delete</Button>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default TeamManagementPanel;
