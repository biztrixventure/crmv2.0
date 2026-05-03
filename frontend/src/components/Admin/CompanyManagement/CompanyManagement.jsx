import React, { useState, useEffect } from 'react';
import { Plus, Search, Filter } from 'lucide-react';
import { Button, Alert } from '../../../components/UI';
import { useCompanies } from '../../../hooks/useCompanies';
import CompanyList from './CompanyList';
import CompanyModal from './CompanyModal';
import CompanyDetail from './CompanyDetail';

const FILTER_BTN = 'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border';

const CompanyManagement = () => {
  const { companies, loading, error, fetchCompanies, createCompany, updateCompany, deleteCompany, activateCompany, hardDeleteCompany } = useCompanies();
  const [showModal, setShowModal]             = useState(false);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [detailCompany, setDetailCompany]     = useState(null);
  const [searchTerm, setSearchTerm]           = useState('');
  const [typeFilter, setTypeFilter]           = useState('all');
  const [statusFilter, setStatusFilter]       = useState('all');

  useEffect(() => { fetchCompanies(); }, []);

  const handleAddCompany    = () => { setSelectedCompany(null); setShowModal(true); };
  const handleEditCompany   = (c) => { setSelectedCompany(c); setShowModal(true); };
  const handleDeleteCompany = async (id) => { try { await deleteCompany(id); } catch {} };
  const handleActivateCompany  = async (id) => { try { await activateCompany(id); } catch {} };
  const handleHardDeleteCompany = async (id) => { try { await hardDeleteCompany(id); } catch {} };

  const handleSaveCompany = async (formData) => {
    try {
      if (selectedCompany) {
        await updateCompany(selectedCompany.id, {
          name: formData.name, slug: formData.slug || null,
          logo_url: formData.logo_url, company_type: formData.company_type,
        });
      } else {
        await createCompany(formData.name, formData.slug, formData.logo_url, formData.company_type);
      }
      setShowModal(false);
      setSelectedCompany(null);
      await fetchCompanies();
    } catch {}
  };

  const filteredCompanies = companies.filter(c => {
    if (searchTerm && !c.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    if (typeFilter !== 'all' && c.company_type !== typeFilter) return false;
    if (statusFilter === 'active'   && !c.is_active) return false;
    if (statusFilter === 'inactive' &&  c.is_active) return false;
    return true;
  });

  const counts = {
    all:      companies.length,
    fronter:  companies.filter(c => c.company_type === 'fronter').length,
    closer:   companies.filter(c => c.company_type === 'closer').length,
    active:   companies.filter(c => c.is_active).length,
    inactive: companies.filter(c => !c.is_active).length,
  };

  const typeBtn = (val, label) => {
    const active = typeFilter === val;
    return (
      <button key={val} onClick={() => setTypeFilter(val)}
        className={FILTER_BTN}
        style={{
          backgroundColor: active ? 'var(--color-primary-600)' : 'var(--color-surface)',
          color: active ? '#fff' : 'var(--color-text-secondary)',
          borderColor: active ? 'var(--color-primary-600)' : 'var(--color-border)',
        }}>
        {label} <span className="ml-1 opacity-70">{counts[val]}</span>
      </button>
    );
  };

  const statusBtn = (val, label) => {
    const active = statusFilter === val;
    return (
      <button key={val} onClick={() => setStatusFilter(val)}
        className={FILTER_BTN}
        style={{
          backgroundColor: active ? 'var(--color-primary-600)' : 'var(--color-surface)',
          color: active ? '#fff' : 'var(--color-text-secondary)',
          borderColor: active ? 'var(--color-primary-600)' : 'var(--color-border)',
        }}>
        {label} {val !== 'all' && <span className="ml-1 opacity-70">{counts[val]}</span>}
      </button>
    );
  };

  if (detailCompany) {
    return <CompanyDetail company={detailCompany} onBack={() => setDetailCompany(null)} />;
  }

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center mb-4 flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-text">Companies</h2>
          <p className="text-xs text-text-secondary mt-0.5">{filteredCompanies.length} of {companies.length} companies</p>
        </div>
        <Button onClick={handleAddCompany} variant="primary" size="sm" className="flex items-center gap-1.5">
          <Plus size={15} /> Add Company
        </Button>
      </div>

      {/* Filters row */}
      <div className="rounded-xl border p-3 mb-4 space-y-2.5"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>

        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none" />
          <input
            type="text"
            placeholder="Search by company name..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-8 pr-3 text-sm rounded-lg border bg-bg text-text placeholder-text-secondary outline-none focus:ring-1"
            style={{ height: 32, borderColor: 'var(--color-border)', focusRingColor: 'var(--color-primary-600)' }}
          />
        </div>

        {/* Type + Status filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-1">
            <Filter size={11} className="text-text-secondary" />
            <span className="text-xs text-text-secondary font-medium">Type:</span>
            <div className="flex gap-1 ml-1">
              {typeBtn('all', 'All')}
              {typeBtn('fronter', 'Fronter')}
              {typeBtn('closer', 'Closer')}
            </div>
          </div>
          <div className="w-px h-4 bg-border hidden sm:block" />
          <div className="flex items-center gap-1">
            <span className="text-xs text-text-secondary font-medium">Status:</span>
            <div className="flex gap-1 ml-1">
              {statusBtn('all', 'All')}
              {statusBtn('active', 'Active')}
              {statusBtn('inactive', 'Inactive')}
            </div>
          </div>
        </div>
      </div>

      {error && <Alert type="error" title="Error" message={error} className="mb-4" />}

      {loading ? (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      ) : (
        <CompanyList
          companies={filteredCompanies}
          onView={setDetailCompany}
          onEdit={handleEditCompany}
          onDeactivate={handleDeleteCompany}
          onActivate={handleActivateCompany}
          onHardDelete={handleHardDeleteCompany}
        />
      )}

      {showModal && (
        <CompanyModal
          company={selectedCompany}
          onClose={() => { setShowModal(false); setSelectedCompany(null); }}
          onSave={handleSaveCompany}
        />
      )}
    </div>
  );
};

export default CompanyManagement;
