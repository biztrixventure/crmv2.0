import React, { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { Button, Alert } from '../../../components/UI';
import { useCompanies } from '../../../hooks/useCompanies';
import CompanyList from './CompanyList';
import CompanyModal from './CompanyModal';
import CompanyDetail from './CompanyDetail';

/**
 * CompanyManagement Component
 * Main container for company management features
 * Handles CRUD operations for companies
 */
const CompanyManagement = () => {
  const { companies, loading, error, fetchCompanies, createCompany, updateCompany, deleteCompany } = useCompanies();
  const [showModal, setShowModal]         = useState(false);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [detailCompany, setDetailCompany] = useState(null);
  const [searchTerm, setSearchTerm]       = useState('');

  // Fetch companies on component mount
  useEffect(() => {
    fetchCompanies();
  }, []);

  // Handle add company button click
  const handleAddCompany = () => {
    setSelectedCompany(null);
    setShowModal(true);
  };

  // Handle edit company
  const handleEditCompany = (company) => {
    setSelectedCompany(company);
    setShowModal(true);
  };

  // Handle delete company with confirmation
  const handleDeleteCompany = async (companyId) => {
    try {
      await deleteCompany(companyId);
      // Refetch to update list
      await fetchCompanies();
    } catch (err) {
      // Error handled in hook
    }
  };

  // Handle modal save
  const handleSaveCompany = async (formData) => {
    try {
      if (selectedCompany) {
        // Update existing company
        await updateCompany(selectedCompany.id, {
          name: formData.name,
          logo_url: formData.logo_url,
        });
      } else {
        // Create new company
        await createCompany(
          formData.name,
          formData.logo_url
        );
      }
      setShowModal(false);
      setSelectedCompany(null);
      // Refetch companies list
      await fetchCompanies();
    } catch (err) {
      // Error handled in hook and will be displayed in parent
    }
  };

  // Filter companies based on search term
  const filteredCompanies = companies.filter((c) => {
    const matchesSearch =
      !searchTerm ||
      c.name.toLowerCase().includes(searchTerm.toLowerCase());

    return matchesSearch;
  });

  // Show company detail view when a company is selected
  if (detailCompany) {
    return <CompanyDetail company={detailCompany} onBack={() => setDetailCompany(null)} />;
  }

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center mb-6 flex-wrap gap-4">
        <h2 className="text-3xl font-bold text-text">Companies</h2>
        <Button
          onClick={handleAddCompany}
          variant="primary"
          size="md"
          className="flex items-center gap-2"
        >
          <Plus size={20} />
          <span>Add Company</span>
        </Button>
      </div>

      {/* Search */}
      <div className="flex gap-4 mb-6 flex-wrap items-center">
        <input
          type="text"
          placeholder="Search by company name..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="input flex-1 min-w-64"
        />
      </div>

      {/* Error message */}
      {error && (
        <Alert
          type="error"
          title="Error"
          message={error}
          className="mb-6"
        />
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
        </div>
      )}

      {/* Company list */}
      {!loading && (
        <CompanyList
          companies={filteredCompanies}
          onView={setDetailCompany}
          onEdit={handleEditCompany}
          onDelete={handleDeleteCompany}
        />
      )}

      {/* Company modal */}
      {showModal && (
        <CompanyModal
          company={selectedCompany}
          onClose={() => {
            setShowModal(false);
            setSelectedCompany(null);
          }}
          onSave={handleSaveCompany}
        />
      )}
    </div>
  );
};

export default CompanyManagement;
