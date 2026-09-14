// ============================================================================
// HR -> Home. The first screen, in plain words: how many people, what changed,
// and what is waiting for a decision.
//
// Reads GET /hr/people/summary (routes/hr/people.js). Every tile that points
// at work links straight to the tab where that work is done -- a home page
// that only reports numbers makes people hunt for the button.
// ============================================================================
import { useEffect, useState } from 'react';
import { Home, Users, UserPlus, UserMinus, LogIn, CalendarCheck, DoorOpen, ArrowRight } from 'lucide-react';
import client from '../../api/client';
import { Panel, SectionHeader, Loading, EmptyState, KpiTile } from '../../components/UI/kit';
import { Btn } from '../../components/Modules/ModuleUI';

export default function HRHome({ scope, goTo }) {
  const companyId = scope?.company_id || null;
  const [s, setS] = useState(null);
  const [error, setError] = useState(null);
  const p = scope?.permissions || {};

  useEffect(() => {
    let alive = true;
    client.get('hr/people/summary', { params: { company_id: companyId || undefined } })
      .then(r => { if (alive) setS(r.data); })
      .catch(e => { if (alive) setError(e.response?.data?.error || 'Could not load the HR summary'); });
    return () => { alive = false; };
  }, [companyId]);

  if (error) return <EmptyState icon={Home} title="HR home is unavailable" hint={error} />;
  if (!s) return <Loading variant="cards" cards={4} />;

  const waiting = [
    s.open_exits > 0 && {
      key: 'exits', icon: DoorOpen, tone: 'warning',
      text: `${s.open_exits} ${s.open_exits === 1 ? 'person has' : 'people have'} left the CRM -- confirm whether they resigned or were let go.`,
      action: 'Review leavers', tab: 'people',
    },
    s.pending_leave > 0 && {
      key: 'leave', icon: CalendarCheck, tone: 'info',
      text: `${s.pending_leave} leave ${s.pending_leave === 1 ? 'request is' : 'requests are'} waiting for approval.`,
      action: 'Open leave', tab: 'time',
    },
    s.crm_members_not_in_hr > 0 && {
      key: 'sync', icon: LogIn, tone: 'primary',
      text: `${s.crm_members_not_in_hr} CRM ${s.crm_members_not_in_hr === 1 ? 'login has' : 'logins have'} no HR record yet (automatic adding is off, or their role is not included).`,
      action: 'Open settings', tab: 'settings',
    },
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      <SectionHeader level="page" icon={Home} title="HR"
        subtitle={scope?.company_name ? `${scope.company_name} -- people, time, pay and reviews` : 'People, time, pay and reviews'} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile icon={Users} label="Working here" value={s.employees.active} tone="primary"
          onClick={p['hr.employees.view'] ? () => goTo?.('people') : undefined} />
        <KpiTile icon={UserPlus} label="Added from the CRM" value={s.employees.from_crm} tone="info"
          sub="Created automatically from their login" />
        <KpiTile icon={CalendarCheck} label="On leave" value={s.employees.on_leave} tone="warning" />
        <KpiTile icon={UserMinus} label="Have left" value={s.employees.left} tone="error" />
      </div>

      <Panel>
        <SectionHeader title="Waiting for you" subtitle={waiting.length ? 'Things that need a decision' : undefined} />
        {waiting.length === 0 ? (
          <EmptyState compact icon={CalendarCheck} title="Nothing waiting" hint="New leavers and leave requests will show up here." />
        ) : (
          <ul className="m-0 p-0 list-none space-y-2">
            {waiting.map(w => {
              const Icon = w.icon;
              return (
                <li key={w.key} className="flex items-center gap-3 p-3 rounded-xl flex-wrap"
                  style={{ background: `color-mix(in srgb, var(--color-${w.tone}-600) 8%, transparent)`, border: '1px solid var(--color-border)' }}>
                  <Icon size={18} style={{ color: `var(--color-${w.tone}-600)` }} />
                  <span className="text-sm flex-1 min-w-[200px]" style={{ color: 'var(--color-text)' }}>{w.text}</span>
                  <Btn size="sm" icon={ArrowRight} onClick={() => goTo?.(w.tab)}>{w.action}</Btn>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel>
        <SectionHeader title="How HR stays up to date" />
        <ul className="m-0 pl-5 space-y-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          <li>Anyone given a CRM login here gets an HR record automatically, with their start date.</li>
          <li>A role change in the CRM (for example Trainee to Fronter) is recorded in their history.</li>
          <li>When a login is switched off, they appear under "Waiting for you" -- nobody is marked as leaving until you confirm it.</li>
          <li>Every change is kept with who made it and why. See the Change log tab.</li>
        </ul>
      </Panel>
    </div>
  );
}
