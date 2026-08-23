// ============================================================================
// ModuleNavLinks -- the Accounting / People entry points, dropped into whichever
// shell the person already lives in.
//
// It ASKS rather than guesses. Reach into these modules can come from a role
// permission OR from a superadmin designation (mig 290, module_designations),
// and a designation is not in the permissions array from /auth/me -- so a
// client-side hasPermission() check would hide the link from exactly the people
// the designation was created for. One cheap call to each /my-scope answers it
// honestly, and `has_any` is the same flag the shells themselves gate on.
//
// Renders NOTHING when neither module is reachable, so dropping it into a shell
// costs nothing for the people it does not apply to.
// ============================================================================
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Scale, IdCard } from 'lucide-react';
import client from '../../api/client';

export default function ModuleNavLinks({ variant = 'header', className = '' }) {
  const [modules, setModules] = useState(null);

  useEffect(() => {
    let dead = false;
    Promise.allSettled([
      client.get('accounting/my-scope'),
      client.get('hr/my-scope'),
    ]).then(([acc, hr]) => {
      if (dead) return;
      setModules({
        accounting: acc.status === 'fulfilled' && !!acc.value.data?.has_any,
        hr: hr.status === 'fulfilled' && !!hr.value.data?.has_any,
      });
    });
    return () => { dead = true; };
  }, []);

  if (!modules || (!modules.accounting && !modules.hr)) return null;

  const items = [
    { to: '/accounting', label: 'Accounting', icon: Scale,  show: modules.accounting },
    { to: '/hr',         label: 'People',     icon: IdCard, show: modules.hr },
  ].filter(i => i.show);

  if (variant === 'sidebar') {
    return (
      <div className={className}>
        {items.map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-semibold transition-colors"
            style={{ color: 'var(--color-text-secondary)' }}>
            <Icon size={16} />{label}
          </Link>
        ))}
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {items.map(({ to, label, icon: Icon }) => (
        <Link key={to} to={to} className="flex items-center gap-1.5 text-xs font-semibold"
          style={{ color: 'var(--color-text-secondary)' }}>
          <Icon size={14} />{label}
        </Link>
      ))}
    </div>
  );
}
