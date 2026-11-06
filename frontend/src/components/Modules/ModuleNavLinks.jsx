// ============================================================================
// ModuleNavLinks -- links out to the company's other apps, dropped into
// whichever shell the person already lives in.
//
// HR and Accounts are not part of the CRM: people, attendance, leave, payroll
// and incentives live in the HR system (hr.vertexpakistan.com). A company that
// turns on the external_hr / external_qa switch (mig 348, Admin -> Connections)
// gets ONE link out for each, shown to everyone in it; the other app decides
// what each person sees there.
//
// Renders NOTHING when neither switch is on.
// ============================================================================
import { IdCard, ClipboardCheck, ExternalLink } from 'lucide-react';
import useExternalModules from '../../hooks/useExternalModules';

export default function ModuleNavLinks({ variant = 'header', className = '' }) {
  const ext = useExternalModules();

  const items = [
    ...(ext.hr ? [{ href: ext.hr, label: 'HR', hint: 'Opens the HR system in a new tab', icon: IdCard }] : []),
    ...(ext.qa ? [{ href: ext.qa, label: 'QA', hint: 'Opens the QA platform in a new tab', icon: ClipboardCheck }] : []),
  ];
  if (!items.length) return null;

  const Item = ({ item, className: cls, style, children }) => (
    <a href={item.href} target="_blank" rel="noopener noreferrer" title={item.hint} className={cls} style={style}>
      {children}<ExternalLink size={11} style={{ opacity: 0.6 }} />
    </a>
  );

  if (variant === 'sidebar') {
    return (
      <div className={className}>
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Item key={item.href} item={item}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-semibold transition-colors"
              style={{ color: 'var(--color-text-secondary)' }}>
              <Icon size={16} />{item.label}
            </Item>
          );
        })}
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 flex-wrap ${className}`}>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Item key={item.href} item={item}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full transition-opacity hover:opacity-80"
            style={{ color: 'var(--color-text)', background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <Icon size={13} style={{ color: 'var(--color-primary-600)' }} />{item.label}
          </Item>
        );
      })}
    </div>
  );
}
