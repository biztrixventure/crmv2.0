import React from 'react';
import { DollarSign, AlertTriangle } from 'lucide-react';
import SaleForm from './SaleForm';

/**
 * SaleModal — wraps SaleForm in a full-screen overlay modal.
 * Handles its own scroll since the form is long.
 *
 * `error` — WHY THE SUBMIT WAS REFUSED, shown where the closer is working.
 * This modal is `fixed inset-0 z-50`, and StaffShell rendered its submit error
 * into the My Sales tab body UNDERNEATH it — on a tab a closer who came from a
 * lead or the dialer queue is not even on, so the component holding the message
 * was not mounted. The server's 409s are specific and actionable ("Reference No
 * X already exists on sale Y", "go through the Resell flow"), and every word of
 * that was being thrown away: the closer pressed Submit, saw nothing, and
 * pressed it again. Defaults to '' so every existing caller is unchanged.
 */
const SaleModal = ({ isOpen, onClose, user, transfer = null, existingSale = null, onSubmit, isLoading = false, error = '' }) => {
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
        className="relative w-full max-w-5xl my-6 rounded-2xl animate-scale-in"
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
                {existingSale ? 'Edit Sale' : transfer ? 'Submit Lead to Compliance' : 'Submit to Compliance'}
              </h2>
              {(existingSale?.customer_name || transfer?.form_data?.customer_name) && (
                <p className="text-sm text-white/70">
                  Customer: {existingSale?.customer_name || transfer.form_data.customer_name}
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
          {/* Above the form, inside the card: the reason is next to the thing
              that was refused, and it survives a re-submit because StaffShell
              clears it only when the next attempt starts. */}
          {error && (
            <div role="alert" className="mb-5 rounded-xl px-4 py-3 flex items-start gap-2.5"
              style={{
                backgroundColor: 'var(--color-error-50, #fef2f2)',
                border: '1px solid var(--color-error-300, #fca5a5)',
                color: 'var(--color-error-700, #b91c1c)',
              }}>
              <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
              <div className="text-sm font-semibold leading-relaxed whitespace-pre-wrap">{error}</div>
            </div>
          )}
          <SaleForm
            user={user}
            transfer={transfer}
            existingSale={existingSale}
            onSubmit={onSubmit}
            isLoading={isLoading}
          />
        </div>
      </div>
    </div>
  );
};

export default SaleModal;
