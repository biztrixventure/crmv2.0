import CompanyReports from '../Reports/CompanyReports';

// ============================================================================
// ReportsPanel -- the "Reports" item in the manager and staff shells.
//
// It used to hold its own fronter/closer leaderboards over /stats/leaderboards
// (40k rows paged through PostgREST and tallied in Node, QA from the retiring
// QA1 tables, "converted" meaning still-closed_won). All of that now lives in
// Company Reports (mig 332) -- counted in one SQL function, with the same rules
// on every surface -- so this panel only mounts it on the viewer's company.
// ============================================================================
const ReportsPanel = ({ companyId }) => (
  <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 animate-fade-in">
    <CompanyReports companyId={companyId || null} />
  </div>
);

export default ReportsPanel;
