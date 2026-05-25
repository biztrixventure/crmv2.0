import TeamManagementPanel from './TeamManagementPanel';
import RoleManagementPanel from './RoleManagementPanel';
import ReviewsPanel from './ReviewsPanel';
import ReportsPanel from './ReportsPanel';
import FormBuilder from '../Admin/FormBuilder/FormBuilder';
import EventsCalendar from '../Calendar/EventsCalendar';

const CrossRoleContent = ({ section, user }) => {
  const companyId = user?.company_id;

  if (section === 'team')     return <TeamManagementPanel companyId={companyId} />;
  if (section === 'roles')    return <RoleManagementPanel companyId={companyId} />;
  if (section === 'reviews')  return <ReviewsPanel companyId={companyId} />;
  if (section === 'reports')  return <ReportsPanel companyId={companyId} />;
  if (section === 'calendar') return <EventsCalendar canEdit={false} />;
  if (section === 'forms')   return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      <FormBuilder />
    </div>
  );

  return null;
};

export default CrossRoleContent;
