import React from 'react';
import { DollarSign } from 'lucide-react';
import SaleForm from './SaleForm';

/**
 * SaleModal — wraps SaleForm in a full-screen overlay modal.
 * Handles its own scroll since the form is long.
 */
const SaleModal = ({ isOpen, onClose, user, transfer = null, onSubmit, isLoading = false }) => {
  if (!isOpen) return null;

  // Close on backdrop click
  const onBackdrop = e => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={onBackdrop}
    >
      <div
        className="relative w-full max-w-3xl my-6 rounded-2xl animate-scale-in"
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-xl)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-5 rounded-t-2xl"
          style={{ background: 'var(--gradient-sidebar)' }}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl">
              <DollarSign size={22} className="text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">
                {transfer ? 'Convert Transfer to Sale' : 'Create New Sale'}
              </h2>
              {transfer?.form_data?.customer_name && (
                <p className="text-sm text-white/70">
                  Customer: {transfer.form_data.customer_name}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-white/20 hover:bg-white/30 transition-colors"
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Form body */}
        <div className="p-6">
          <SaleForm
            user={user}
            transfer={transfer}
            onSubmit={onSubmit}
            isLoading={isLoading}
          />
        </div>
      </div>
    </div>
  );
};

export default SaleModal;
