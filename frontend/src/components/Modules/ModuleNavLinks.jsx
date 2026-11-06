// ============================================================================
// ModuleNavLinks -- the HR / Accounts entry points, dropped into whichever
// shell the person already lives in.
//
// It ASKS rather than guesses. Reach into these modules can come from a role
// permission OR from a superadmin designation (mig 290, module_designations),
// and a designation is not in the permissions array from /auth/me -- so a
// client-side hasPermission() check would hide the link from exactly the people
// the designation was created for. One cheap call to each /my-scope answers it
// honestly.
//
// Shown only to people who can do MORE than look after themselves. Everyone's
// own payslips, leave, attendance and expense claims live in the "My HR" tab of
// their own shell (components/Modules/MyHR.jsx); sending a fronter into the HR
// module to find their payslip was the old, confusing way in.
//
// Renders NOTHING when neither module offers that person anything extra, so
// dropping it into a shell costs nothing for the people it does not apply to.
// ============================================================================
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Scale, IdCard, ClipboardCheck, ExternalLink } from 'lucide-react';
import client from '../../api/client';
import useExternalModules from '../../hooks/useExternalModules';

// Self-service keys -- the ones My HR already covers.
const SELF_ONLY = new Set([
  'hr.attendance.view_own', 'hr.leave.request', 'hr.payroll.view_own', 'hr.reviews.participate',
  'accounting.expenses.submit',
]);
const beyondSelf = (perms) => Object.entries(perms || {}).some(([k, v]) => v && !SELF_ONLY.has(k));

export default function ModuleNavLinks({ variant = 'header', className = '' }) {
  const [modules, setModules] = useState(null);
  // Connections (mig 348): a company that runs HR / QA in its own app gets ONE
  // link out for each, shown to everyone in it (the other app decides what
  // each person sees there). Both flags off = exactly the old links.
  const ext = useExternalModules();

  useEffect(() => {
    let dead = false;
    Promise.allSettled([
      client.get('accounting/my-scope'),
      client.get('hr/my-scope'),
    ]).then(([acc, hr]) => {
      if (dead) return;
      setModules({
        accounting: acc.status === 'fulfilled' && beyondSelf(acc.value.data?.permissions),
        hr: hr.status === 'fulfilled' && beyondSelf(hr.value.data?.permissions),
      });
    });
    return () => { dead = true; };
  }, []);

  const hasExternal = !!(ext.hr || ext.qa);
  if (!hasExternal && (!modules || (!modules.accounting && !modules.hr))) return null;

  const items = [
    ext.hr
      ? { href: ext.hr, label: 'HR', hint: 'Opens the HR system in a new tab', icon: IdCard, show: true }
      : { to: '/hr',    label: 'HR', hint: 'People, attendance, leave, payroll', icon: IdCard, show: !!modules?.hr },
    { to: '/accounting', label: 'Accounts', hint: 'Money in, money out, reports',       icon: Scale,  show: !!modules?.accounting },
    ...(ext.qa ? [{ href: ext.qa, label: 'QA', hint: 'Opens the QA platform in a new tab', icon: ClipboardCheck, show: true }] : []),
  ].filter(i => i.show);
  if (!items.length) return null;

  // An external entry is a plain new-tab anchor; an internal one stays a Link.
  const Item = ({ item, className: cls, style, children }) => (item.href
    ? <a href={item.href} target="_blank" rel="noopener noreferrer" title={item.hint} className={cls} style={style}>{children}<ExternalLink size={11} style={{ opacity: 0.6 }} /></a>
    : <Link to={item.to} title={item.hint} className={cls} style={style}>{children}</Link>);

  if (variant === 'sidebar') {
    return (
      <div className={className}>
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Item key={item.href || item.to} item={item}
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
          <Item key={item.href || item.to} item={item}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full transition-opacity hover:opacity-80"
            style={{ color: 'var(--color-text)', background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <Icon size={13} style={{ color: 'var(--color-primary-600)' }} />{item.label}
          </Item>
        );
      })}
    </div>
  );
}
