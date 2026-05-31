import React, { useState, useEffect } from 'react';
import { Button, FormField } from '../../../components/UI';

/**
 * CompanyForm Component
 * Form to create/edit companies
 */
const CompanyForm = ({ company = null, onSubmit, isLoading = false }) => {
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    logo_url: '',
    logo_light_url: '',
    logo_dark_url: '',
    company_type: 'fronter',
  });
  const [errors, setErrors] = useState({});

  // Initialize form with company data if editing
  useEffect(() => {
    if (company) {
      setFormData({
        name:           company.name           || '',
        slug:           company.slug           || '',
        logo_url:       company.logo_url       || '',
        logo_light_url: company.logo_light_url || '',
        logo_dark_url:  company.logo_dark_url  || '',
        company_type:   company.company_type   || 'fronter',
      });
    }
  }, [company]);

  // Validate form
  const validate = () => {
    const newErrors = {};

    if (!formData.name || !formData.name.trim()) {
      newErrors.name = 'Company name is required';
    }

    if (formData.logo_url && !isValidUrl(formData.logo_url)) {
      newErrors.logo_url = 'Must be a valid URL';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Simple URL validation
  const isValidUrl = (string) => {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  };

  // Handle form submission
  const handleSubmit = (e) => {
    e.preventDefault();
    if (validate()) {
      onSubmit(formData);
    }
  };

  // Handle input change
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    // Clear error for this field
    if (errors[name]) {
      setErrors((prev) => ({
        ...prev,
        [name]: '',
      }));
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Company Name */}
      <FormField
        label="Company Name"
        required
        error={errors.name}
      >
        <input
          type="text"
          name="name"
          value={formData.name}
          onChange={handleInputChange}
          placeholder="Acme Corporation"
          className="input"
        />
      </FormField>

      {/* Slug */}
      <FormField
        label="Company Slug"
        hint="Short identifier shown to closers when searching transfers (e.g. 'acme' or 'nyc-team')"
        error={errors.slug}
      >
        <input
          type="text"
          name="slug"
          value={formData.slug}
          onChange={handleInputChange}
          placeholder="acme-corp"
          className="input"
        />
      </FormField>

      {/* Logo URL — universal fallback */}
      <FormField
        label="Default Logo URL"
        error={errors.logo_url}
        hint="Used on both themes if a per-theme variant isn't set. Also drives the loader + 404 brand mark."
      >
        <input
          type="text"
          name="logo_url"
          value={formData.logo_url}
          onChange={handleInputChange}
          placeholder="https://example.com/logo.png"
          className="input"
        />
      </FormField>

      {/* Per-theme overrides — dropped into the BrandedLoader + 404 scene
          when the active theme matches. Optional; both fall back to logo_url. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField
          label="Light Theme Logo"
          hint="Shown when the app is in light mode. Optional."
        >
          <input
            type="text"
            name="logo_light_url"
            value={formData.logo_light_url}
            onChange={handleInputChange}
            placeholder="https://…/logo-dark-on-light.png"
            className="input"
          />
          {formData.logo_light_url && (
            <div className="mt-2 p-2 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#fff', border: '1px solid var(--color-border)' }}>
              <img src={formData.logo_light_url} alt="" className="h-10 object-contain"
                onError={e => { e.target.style.display = 'none'; }} />
            </div>
          )}
        </FormField>
        <FormField
          label="Dark Theme Logo"
          hint="Shown when the app is in dark mode. Optional."
        >
          <input
            type="text"
            name="logo_dark_url"
            value={formData.logo_dark_url}
            onChange={handleInputChange}
            placeholder="https://…/logo-light-on-dark.png"
            className="input"
          />
          {formData.logo_dark_url && (
            <div className="mt-2 p-2 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#0b0b0b', border: '1px solid var(--color-border)' }}>
              <img src={formData.logo_dark_url} alt="" className="h-10 object-contain"
                onError={e => { e.target.style.display = 'none'; }} />
            </div>
          )}
        </FormField>
      </div>

      {/* Company Type */}
      <FormField label="Company Type" hint="Fronter companies create leads; Closer companies close deals.">
        <div className="flex gap-3">
          {[{ value: 'fronter', label: 'Fronter Company' }, { value: 'closer', label: 'Closer Company' }].map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setFormData(p => ({ ...p, company_type: opt.value }))}
              className="flex-1 py-2.5 px-4 rounded-xl border-2 text-sm font-semibold transition-all"
              style={{
                borderColor: formData.company_type === opt.value ? 'var(--color-primary-500)' : 'var(--color-border)',
                background:  formData.company_type === opt.value ? 'var(--color-primary-50)' : 'transparent',
                color:       formData.company_type === opt.value ? 'var(--color-primary-700)' : 'var(--color-text-secondary)',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </FormField>

      {/* Submit Button */}
      <div className="flex justify-end pt-6 border-t border-border">
        <Button
          type="submit"
          variant="primary"
          loading={isLoading}
          disabled={isLoading}
        >
          {isLoading ? 'Saving...' : company ? 'Update Company' : 'Create Company'}
        </Button>
      </div>
    </form>
  );
};

export default CompanyForm;
