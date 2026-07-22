// ============================================================================
// adminTabs.js — SINGLE SOURCE OF TRUTH for the AdminPanel sidebar tab catalog.
//
// Both pages/AdminPanel.jsx (what a user actually sees) and the SuperAdmin
// ReadonlyAdminManager (the governance matrix) import this so they can never
// drift. Historically the manager kept a hand-copied TAB_CATALOG that fell out
// of sync (18 of 33 tabs) — this file kills that.
//
// Each entry:
//   id            — the activeTab id used across AdminPanel
//   label         — sidebar label
//   group         — UI grouping for the governance matrix
//   roEligible    — can a readonly_admin EVER see this tab? (false = superadmin
//                   only; never offered in the RO governance matrix)
//   defaultForRo  — preselected when creating/parity-resetting a readonly_admin
//   gate          — extra runtime gate beyond role (permission key or feature
//                   flag) that AdminPanel already applies; informational here
// ============================================================================

export const ADMIN_TAB_GROUPS = {
  overview:      'Overview',
  cross_company: 'Cross-Company',
  admin:         'Admin',
  tools:         'Tools',
  content:       'Content',
  engagement:    'Engagement',
  superadmin:    'SuperAdmin only',
};

// Full catalog — mirrors the navItems array in pages/AdminPanel.jsx. Keep the
// ids identical. roEligible:false entries are the superadmin-exclusive tabs
// (never shown to a readonly_admin regardless of governance config).
export const ADMIN_TAB_CATALOG = [
  // Overview — always visible
  { id: 'dashboard',        label: 'Dashboard',            group: 'overview',      roEligible: true,  defaultForRo: true,  gate: null },
  { id: 'calendar',         label: 'Calendar',             group: 'overview',      roEligible: true,  defaultForRo: true,  gate: null },

  // Cross-company (→ ComplianceShell lists)
  { id: 'cc-sales',         label: 'All Sales',            group: 'cross_company', roEligible: true,  defaultForRo: true,  gate: null },
  { id: 'cc-transfers',     label: 'All Transfers',        group: 'cross_company', roEligible: true,  defaultForRo: true,  gate: null },
  { id: 'cc-callbacks',     label: 'All Callbacks',        group: 'cross_company', roEligible: true,  defaultForRo: true,  gate: null },

  // Admin surfaces
  { id: 'companies',        label: 'Companies',            group: 'admin',         roEligible: true,  defaultForRo: true,  gate: null },
  { id: 'forms',            label: 'Form Builder',         group: 'admin',         roEligible: true,  defaultForRo: false, gate: 'manage_forms' },
  { id: 'bulk-upload',      label: 'Bulk Upload',          group: 'admin',         roEligible: true,  defaultForRo: false, gate: null },
  { id: 'chat',             label: 'Chat Control',         group: 'admin',         roEligible: true,  defaultForRo: false, gate: null },
  { id: 'features',         label: 'Features',             group: 'admin',         roEligible: true,  defaultForRo: false, gate: null },
  { id: 'business-rules',   label: 'Business Rules',       group: 'admin',         roEligible: true,  defaultForRo: false, gate: null },

  // Tools / intelligence
  { id: 'sale-search',      label: 'Lead Search',          group: 'tools',         roEligible: true,  defaultForRo: true,  gate: 'search_sales' },
  { id: 'customer-profiles',label: 'Customer Profiles',    group: 'tools',         roEligible: true,  defaultForRo: true,  gate: null },
  { id: 'numbers',          label: 'Numbers Intelligence', group: 'tools',         roEligible: true,  defaultForRo: false, gate: null },
  { id: 'data-analyzer',    label: 'Data Analyzer',        group: 'tools',         roEligible: true,  defaultForRo: true,  gate: null },
  { id: 'number-lists',     label: 'Number Assignment',    group: 'tools',         roEligible: true,  defaultForRo: false, gate: 'feature:number_assignment' },

  // Content
  { id: 'faqs',             label: 'FAQs',                 group: 'content',       roEligible: true,  defaultForRo: false, gate: 'manage_faqs' },
  { id: 'scripts',          label: 'Scripts',              group: 'content',       roEligible: true,  defaultForRo: false, gate: 'manage_faqs' },

  // Engagement
  { id: 'announcements',    label: 'Announcements',        group: 'engagement',    roEligible: true,  defaultForRo: false, gate: null },
  { id: 'marquee',          label: 'Marquee',              group: 'engagement',    roEligible: true,  defaultForRo: false, gate: null },
  { id: 'spiff',            label: 'SPIFF',                group: 'engagement',    roEligible: true,  defaultForRo: false, gate: null },
  { id: 'payments',         label: 'Payment Reminders',    group: 'engagement',    roEligible: true,  defaultForRo: false, gate: null },

  // SuperAdmin-only — NEVER a readonly_admin (roEligible:false)
  { id: 'batches',          label: 'Batches',              group: 'superadmin',    roEligible: false, defaultForRo: false, gate: null },
  { id: 'roster',           label: 'Assigned Numbers',     group: 'superadmin',    roEligible: false, defaultForRo: false, gate: null },
  { id: 'note-shortcodes',  label: 'Note Shortcuts',       group: 'superadmin',    roEligible: false, defaultForRo: false, gate: null },
  { id: 'data-cleanup',     label: 'Data Cleanup',         group: 'superadmin',    roEligible: false, defaultForRo: false, gate: null },
  { id: 'vicidial',         label: 'VICIdial',             group: 'superadmin',    roEligible: false, defaultForRo: false, gate: null },
  { id: 'task-boards',      label: 'Task Boards',          group: 'superadmin',    roEligible: false, defaultForRo: false, gate: null },
  { id: 'blacklist',        label: 'Blacklist / DNC',      group: 'superadmin',    roEligible: false, defaultForRo: false, gate: null },
  { id: 'egress',           label: 'Data Egress',          group: 'superadmin',    roEligible: false, defaultForRo: false, gate: null },
  { id: 'branding',         label: 'Branding & SEO',       group: 'superadmin',    roEligible: false, defaultForRo: false, gate: null },
  { id: 'appearance',       label: 'Appearance',           group: 'superadmin',    roEligible: false, defaultForRo: false, gate: null },
  { id: 'readonly-admins',  label: 'Readonly Admins',      group: 'superadmin',    roEligible: false, defaultForRo: false, gate: null },
];

// The tabs a readonly_admin can ever be granted (the governance matrix domain).
export const RO_ELIGIBLE_TABS = ADMIN_TAB_CATALOG.filter(t => t.roEligible);

// Parity default: every RO-eligible tab (the "full SuperAdmin parity" baseline).
export const RO_PARITY_TAB_IDS = RO_ELIGIBLE_TABS.map(t => t.id);

// The lighter "defaults" preset used when creating a new RO.
export const RO_DEFAULT_TAB_IDS = RO_ELIGIBLE_TABS.filter(t => t.defaultForRo).map(t => t.id);

// Dashboard is never stripped — a RO must always land somewhere.
export const RO_MIN_TAB_IDS = ['dashboard'];

// Grouped view for rendering the governance matrix.
export function groupedRoTabs() {
  const m = new Map();
  for (const t of RO_ELIGIBLE_TABS) {
    if (!m.has(t.group)) m.set(t.group, []);
    m.get(t.group).push(t);
  }
  return [...m.entries()];
}
