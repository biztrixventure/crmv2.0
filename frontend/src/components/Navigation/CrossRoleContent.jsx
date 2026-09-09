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
const CardValidator         = lazy(() => import('../Shared/CardValidator'));
const CustomerLookupPanel   = lazy(() => import('../Shared/CustomerLookupPanel'));
const MyScoresPanel         = lazy(() => import('../QA2/MyScoresPanel'));
const QuizManager           = lazy(() => import('../Quiz/QuizManager'));
const MyQuizzes             = lazy(() => import('../Quiz/MyQuizzes'));
// Read-only quiz results, for a viewer who oversees quizzes without building
// them. QuizManager filters every read on `created_by === me`, so pointing an
// operations_manager at it shows an empty list however many quizzes QA has run.
const QuizOversight         = lazy(() => import('../Quiz/QuizOversight'));
// Engagement: company-wide incentive programmes. SPIFF Campaigns moved here
// from the manager shell's Team tab group -- an incentive programme is
// engagement, not team structure.
const SpiffManager          = lazy(() => import('../Admin/Engagement/SpiffManager'));

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
  if (section === 'card_validator')          return <Suspense fallback={<ToolFallback />}><CardValidator /></Suspense>;
  if (section === 'customer_lookup')         return <Suspense fallback={<ToolFallback />}><CustomerLookupPanel /></Suspense>;
  if (section === 'qa2_scores')              return <Suspense fallback={<ToolFallback />}><MyScoresPanel /></Suspense>;
  // Quiz builders get the manage surface; everyone else who can reach this
  // section gets read-only results. The test mirrors the backend's own
  // canManageQuizzes (permission, plus compliance_manager and superadmin
  // unconditionally) so the UI and the API agree on which one you are —
  // rendering QuizManager to a viewer the API refuses shows a broken panel.
  if (section === 'quizzes') {
    const canBuildQuizzes = user?.role === 'superadmin'
      || user?.role === 'compliance_manager'
      || (Array.isArray(user?.permissions) && user.permissions.includes('quiz.manage'));
    return (
      <Suspense fallback={<ToolFallback />}>
        {canBuildQuizzes ? <QuizManager /> : <QuizOversight />}
      </Suspense>
    );
  }
  if (section === 'my_quizzes')              return <Suspense fallback={<ToolFallback />}><MyQuizzes /></Suspense>;
  if (section === 'engagement')              return <Suspense fallback={<ToolFallback />}><SpiffManager /></Suspense>;

  return null;
};

export default CrossRoleContent;
