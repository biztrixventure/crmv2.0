// ============================================================================
// ModuleUI -- the three primitives the Accounting and HR pages repeat.
//
// These are NOT new design language. Btn wraps the button styling the admin
// surfaces already use, StatusPill reads its color from the shared STATUS_TONE
// map in utils/money.js, and ModuleModal is the one overlay shape. They exist
// so eleven pages cannot each invent a slightly different primary button.
//
// Anything richer belongs in components/UI/kit -- see docs/ui-design-system.md.
// ============================================================================
import { X } from 'lucide-react';
import { Panel, SectionHeader, IconButton } from '../UI/kit';
import { STATUS_TONE, prettyStatus } from '../../utils/money';

const TONE_VAR = {
  primary: 'var(--color-primary-600)',
  success: 'var(--color-success-600)',
  error:   'var(--color-error-600)',
  warning: 'var(--color-warning-600)',
  info:    'var(--color-info-600)',
  muted:   'var(--color-text-secondary)',
};

// variant: 'primary' (filled) | 'secondary' (bordered) | 'danger'
export function Btn({
  children, onClick, type = 'button', variant = 'secondary', tone = 'primary',
  disabled = false, busy = false, icon: Icon, size = 'md', className = '', ...rest
}) {
  const off = disabled || busy;
  const pad = size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-sm';
  const filled = variant === 'primary' || variant === 'danger';
  const color = variant === 'danger' ? TONE_VAR.error : TONE_VAR[tone] || TONE_VAR.primary;

  return (
    <button type={type} onClick={onClick} disabled={off}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-opacity ${pad} ${className}`}
      style={{
        background: filled ? color : 'var(--color-surface)',
        border: filled ? '1px solid transparent' : '1px solid var(--color-border)',
        color: filled ? '#fff' : (variant === 'danger' ? TONE_VAR.error : 'var(--color-text)'),
        opacity: off ? 0.55 : 1,
        cursor: off ? 'not-allowed' : 'pointer',
      }}
      {...rest}>
      {Icon && <Icon size={size === 'sm' ? 13 : 14} />}
      {busy ? 'Working...' : children}
    </button>
  );
}

// One vocabulary of status colors across invoices, expenses, leave, payroll and
// reviews. An unknown status still renders -- greyed and readable -- rather than
// disappearing, because a status the UI has not been taught about is exactly
// the thing someone needs to see.
export function StatusPill({ status, className = '' }) {
  const tone = STATUS_TONE[status] || 'muted';
  const color = TONE_VAR[tone] || TONE_VAR.muted;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize whitespace-nowrap ${className}`}
      style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color, border: `1px solid color-mix(in srgb, ${color} 30%, transparent)` }}>
      {prettyStatus(status) || 'unknown'}
    </span>
  );
}

// Click-outside and Escape both close. `wide` for the editors that carry a line
// table (invoice, payroll entry) rather than a short form.
export function ModuleModal({ title, subtitle, onClose, children, wide = false, footer }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-auto"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={onClose}
      onKeyDown={e => { if (e.key === 'Escape') onClose?.(); }}
      role="presentation">
      <Panel className={`w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} my-auto`} onClick={e => e.stopPropagation()}>
        <SectionHeader title={title} subtitle={subtitle}
          actions={<IconButton label="Close" variant="ghost" onClick={onClose}><X size={16} /></IconButton>} />
        {children}
        {footer && <div className="flex items-center justify-end gap-2 pt-3 mt-3"
          style={{ borderTop: '1px solid var(--color-border)' }}>{footer}</div>}
      </Panel>
    </div>
  );
}

export default { Btn, StatusPill, ModuleModal };
