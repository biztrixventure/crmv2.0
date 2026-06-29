import { useState, useEffect, useCallback } from 'react';
import { Shield, PlusCircle, Edit2, Trash2 } from 'lucide-react';
import { Card, Badge, Button } from '../UI';
import RoleModal from '../Admin/RoleManagement/RoleModal';
import { useAuth } from '../../contexts/AuthContext';
import client from '../../api/client';

const LEVEL_COLORS = {
  fronter: 'success', closer: 'info', manager: 'warning',
  fronter_manager: 'primary', closer_manager: 'primary',
  operations_manager: 'info', company_admin: 'error',
};

const RoleManagementPanel = ({ companyId }) => {
  const { hasPermission, user } = useAuth();
  const isSuper   = user?.role === 'superadmin';
  const canCreate = isSuper || hasPermission('create_role') || hasPermission('manage_roles');
  const canUpdate = isSuper || hasPermission('update_role') || hasPermission('manage_roles');
  const canDelete = isSuper || hasPermission('delete_role') || hasPermission('manage_roles');
  const [roles, setRoles]           = useState([]);
  const [loading, setLoading]       = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editRole, setEditRole]     = useState(null);
  const [seeding, setSeeding]       = useState(false);
  const [actionErr, setActionErr]   = useState('');

  const load = useCallback(() => {
    if (!companyId) return;
    setLoading(true);
    client.get('roles', { params: { company_id: companyId } })
      .then(r => setRoles(r.data.roles || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const seedDefaults = async () => {
    setSeeding(true);
    setActionErr('');
    try {
      await client.post('roles/seed-defaults', { company_id: companyId });
      load();
    } catch (err) { setActionErr(err.response?.data?.error || 'Seeding failed'); }
    finally { setSeeding(false); }
  };

  const handleCreateRole = async (formData) => {
    await client.post('roles', { ...formData, company_id: companyId });
    load();
    setShowCreate(false);
  };

  const handleEditRole = async (formData) => {
    await client.put(`roles/${editRole.id}`, { description: formData.description, permissions: formData.permissions });
    load();
    setEditRole(null);
  };

  const deleteRole = async (id) => {
    setActionErr('');
    try {
      await client.delete(`roles/${id}`);
      load();
    } catch (err) { setActionErr(err.response?.data?.error || 'Delete failed'); }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-text flex items-center gap-2">
            <Shield size={22} style={{ color: 'var(--color-primary-600)' }} />
            Role Management
          </h2>
          <p className="text-text-secondary text-sm mt-0.5">{roles.length} role{roles.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex gap-2">
          {isSuper && (
            <Button variant="secondary" size="sm" onClick={seedDefaults} loading={seeding} disabled={seeding}>
              Seed Defaults
            </Button>
          )}
          {canCreate && (
            <Button variant="primary" size="sm" onClick={() => setShowCreate(true)} className="flex items-center gap-1.5">
              <PlusCircle size={15} /> Add Role
            </Button>
          )}
        </div>
      </div>

      {actionErr && <p className="text-sm text-error-600">{actionErr}</p>}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      ) : roles.length === 0 ? (
        <Card className="p-16 text-center">
          <Shield size={48} className="mx-auto mb-4 text-text-tertiary" />
          <p className="text-text-secondary mb-4">No roles yet.{isSuper ? ' Seed defaults or add one manually.' : ''}</p>
          {isSuper && <Button variant="primary" onClick={seedDefaults} loading={seeding}>Seed Defaults</Button>}
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {roles.map(r => (
            <Card key={r.id} onClick={() => setEditRole(r)}
              className="p-4 cursor-pointer hover:shadow-md transition-all hover:-translate-y-0.5">
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-text truncate">{r.name}</p>
                  <div className="mt-1">
                    <Badge variant={LEVEL_COLORS[r.level] || 'secondary'} size="sm">
                      {r.level?.replace(/_/g, ' ')}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                  {canUpdate && (
                    <button onClick={e => { e.stopPropagation(); setEditRole(r); }} title="Edit"
                      className="p-1 rounded hover:bg-bg-secondary transition-colors">
                      <Edit2 size={14} style={{ color: 'var(--color-primary-500)' }} />
                    </button>
                  )}
                  {canDelete && (
                    <button onClick={e => { e.stopPropagation(); deleteRole(r.id); }} title="Delete"
                      className="p-1 rounded hover:bg-error-50 dark:hover:bg-error-900 transition-colors">
                      <Trash2 size={14} className="text-error-500" />
                    </button>
                  )}
                </div>
              </div>
              {r.description && <p className="text-xs text-text-secondary mb-2">{r.description}</p>}
              <div className="flex items-center justify-between mt-3 pt-2"
                style={{ borderTop: '1px solid var(--color-border)' }}>
                <p className="text-xs text-text-tertiary">{(r.permissions || []).length} permissions</p>
                <span className="text-xs font-semibold" style={{ color: 'var(--color-primary-600)' }}>
                  View &amp; Edit →
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {showCreate && (
        <RoleModal role={null} onClose={() => setShowCreate(false)} onSave={handleCreateRole} />
      )}
      {editRole && (
        <RoleModal role={editRole} onClose={() => setEditRole(null)} onSave={handleEditRole} />
      )}
    </div>
  );
};

export default RoleManagementPanel;
