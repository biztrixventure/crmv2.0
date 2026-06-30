import { lazy, Suspense } from 'react';
import TeamManagementPanel from './TeamManagementPanel';
import RoleManagementPanel from './RoleManagementPanel';
import ReviewsPanel from './ReviewsPanel';
import ReportsPanel from './ReportsPanel';
import FormBuilder from '../Admin/FormBuilder/FormBuilder';
import EventsCalendar from '../Calendar/EventsCalendar';

// Delegated superadmin tools — only reachable when their nav item is shown
// (strict feature-flag gate in the shell). Lazy so they never weigh down staff.
const CustomerProfile = lazy(() => import('../Admin/CustomerProfile/CustomerProfile'));
const DataAnalyzer    = lazy(() => import('../Admin/DataAnalyzer/DataAnalyzer'));
const ChatAdmin       = lazy(() => import('../Admin/Chat/ChatAdmin'));
const PaymentRemindersPanel = lazy(() => import('../Payments/PaymentRemindersPanel'));
const DncLookupPanel        = lazy(() => import('../Shared/DncLookupPanel'));

const ToolFallback = () => (
  <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>
);

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
  if (section === 'tool_customer_profiles') return <Suspense fallback={<ToolFallback />}><CustomerProfile /></Suspense>;
  if (section === 'tool_data_analyzer')     return <Suspense fallback={<ToolFallback />}><DataAnalyzer /></Suspense>;
  if (section === 'tool_chat_control')      return <Suspense fallback={<ToolFallback />}><ChatAdmin /></Suspense>;
  if (section === 'payments')               return <Suspense fallback={<ToolFallback />}><PaymentRemindersPanel /></Suspense>;
  if (section === 'dnc')                     return <Suspense fallback={<ToolFallback />}><DncLookupPanel /></Suspense>;

  return null;
};

export default CrossRoleContent;
