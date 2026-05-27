/**
 * rules — the mascot's rule-based "intelligence" (no AI).
 *   id / priority / kind('alert'|'tip'|'happy') / cond(d) / message / action?
 * `d` includes role + page so guidance is tailored per user type.
 *
 * Two layers:
 *   RULES   — auto-fire (idle, missed callbacks, per-role welcome). Evaluated by priority.
 *   helpFor — on-demand "how do I use this?" for the current role + page (mascot click).
 */
const isManager = (r) => ['closer_manager', 'fronter_manager', 'operations_manager', 'company_admin'].includes(r);
const isAdmin   = (r) => ['superadmin', 'readonly_admin'].includes(r);

export const RULES = [
  // ── behavioural alerts (role-agnostic) ──────────────────────────────────────
  { id: 'idle_long', priority: 95, kind: 'alert', cond: (d) => d.idleTime > 600,
    message: "Still there? I'll take a nap 😴 (mute me anytime)." },
  { id: 'missed_callbacks', priority: 90, kind: 'alert', cond: (d) => d.missedCallbacks > 3,
    message: "👀 You're ignoring callbacks… they miss you too.", action: { label: 'Open callbacks', target: '[data-assistant="callbacks"]' } },
  { id: 'idle_mid', priority: 60, kind: 'tip', cond: (d) => d.idleTime > 180 && d.idleTime <= 600,
    message: "You there? The CRM is getting lonely 😄" },
  { id: 'productive', priority: 40, kind: 'happy', cond: (d) => d.eventsToday >= 40 && d.idleTime < 60,
    message: "You're on fire today 🚀 keep it rolling." },

  // ── per-role welcome (once per session, first dashboard visit) ──────────────
  { id: 'welcome_fronter', priority: 30, kind: 'tip',
    cond: (d) => d.role === 'fronter' && d.page === 'dashboard',
    message: "Hey, I'm Trix 🐾 Fronter HQ: create a transfer to hand a lead to a closer. Click me anytime for a how-to.",
    action: { label: 'Show create', target: '[data-assistant="create-transfer"]' } },
  { id: 'welcome_closer', priority: 30, kind: 'tip',
    cond: (d) => d.role === 'closer' && d.page === 'dashboard',
    message: "Hey, I'm Trix 🐾 Closer mode: work 'Assigned Transfers', then log the deal in 'My Sales'. Click me for help on any screen.",
    action: { label: 'Got it' } },
  { id: 'welcome_manager', priority: 30, kind: 'tip',
    cond: (d) => isManager(d.role) && d.page === 'dashboard',
    message: "Hi, I'm Trix 🐾 Manager view: team transfers, sales, reviews, reports + Export up top. Click me to learn any tab.",
    action: { label: 'Got it' } },
  { id: 'welcome_compliance', priority: 30, kind: 'tip',
    cond: (d) => d.role === 'compliance_manager' && (d.page === 'compliance' || d.page === 'dashboard'),
    message: "Hi, I'm Trix 🐾 Compliance: the Review Queue holds pending sales — Approve or Return with a note. Click me for details.",
    action: { label: 'Got it' } },
  { id: 'welcome_admin', priority: 30, kind: 'tip',
    cond: (d) => isAdmin(d.role) && (d.page === 'admin' || d.page === 'dashboard'),
    message: "Hey, I'm Trix 🐾 Superadmin: I can explain Companies, Users, Form Builder, Bulk Upload, Features & Chat. Click me on any screen.",
    action: { label: 'Got it' } },
];

const DAY = 24 * 60 * 60 * 1000;

export function pickTip(data, { now = Date.now(), minGapMs = 30000, sessionShown = new Set() } = {}) {
  if (now - (data.lastTipAt || 0) < minGapMs) return null;
  const candidates = RULES
    .filter(r => {
      if (typeof r.cond !== 'function' || !r.cond(data)) return false;
      const ignoredAt = data.ignoredTips?.[r.id];
      if (ignoredAt && now - ignoredAt < DAY) return false;
      if (r.id === data.lastTipId) return false;
      if (sessionShown.has(r.id) && r.kind !== 'alert') return false;
      return true;
    })
    .sort((a, b) => b.priority - a.priority);
  return candidates[0] || null;
}

// ── On-demand contextual help (mascot click) ───────────────────────────────────
// Page-level "how do I use this?" tailored to role. Always available; ignores
// cooldown because the user explicitly asked.
const PAGE_HELP = {
  dashboard: {
    fronter:    "This is your dashboard. Hit ‘Create Transfer’ to send a lead to a closer, then track it under ‘My Leads’. Each transfer needs a phone + customer + car.",
    closer:     "Two tabs: ‘Assigned Transfers’ (leads to work) and ‘My Sales’ (deals you closed). Open a transfer, set a disposition, then add the sale.",
    _manager:   "Tabs across the top: Overview, Team Transfers, Team Sales, Callbacks, Reviews, Reports. ‘Export’ downloads any of them (date range + filters).",
    compliance_manager: "Tabs: Companies, Review Queue, All Sales, Transfers, Callbacks, Reviews, Numbers. Review Queue = sales awaiting your approval.",
    _admin:     "Use the left sidebar: Dashboard, Calendar, Companies, Users, Form Builder, Bulk Upload, FAQs, Features, Chat Control. Ask me on any of them.",
  },
  transfers: {
    _any: "Transfers = leads handed from fronter to closer. Filter by status/date, click a row for full detail. Duplicate same-number leads can be merged in the cleanup tool.",
    fronter: "Create a transfer with the customer + car + phone. Re-touching the same lead within 30 days updates the existing one; older = a new transfer.",
  },
  sales: {
    closer: "Add a sale from a worked transfer: plan, down/monthly payment, reference. On submit it goes to Compliance as ‘pending review’.",
    _any: "Sales are closed deals linked to a transfer. Status flows pending_review → closed_won (approved) or needs_revision (returned).",
  },
  callbacks: { _any: "Scheduled callbacks. Times are stored in your local zone. Mark done when handled — ignoring them piles up and I’ll nag you 😄." },
  compliance: { _any: "Review Queue = pending sales. ‘Approve’ → closed_won; ‘Return’ sends it back to the closer with your note. All Sales lets you edit any status." },
  chat: { _any: "Global chat. DMs appear after the first message. Groups are invite-only — admins invite, you accept. Type ‘/’ for saved replies, ‘@’ to mention." },
  admin: { _admin: "Sidebar sections: Companies (+users/roles), Form Builder (the transfer/sale fields), Bulk Upload (CSV import), Features (toggle modules — including me), Chat Control." },
  manager: { _any: "Manager tabs cover your whole team. ‘Export’ pulls Sales/Transfers/Callbacks/Users with date + status + agent filters, no row cap." },
  leads: { _any: "Open a lead to see detail; add a note so the next person has context. Don’t forget to set a disposition." },
};

// Fine-grained help for each sidebar SECTION (admin/manager/compliance/staff
// tabs). Keyed by the tab key the shells report via window.crmAssistant.setSection.
// Section content is the same whatever the role — the section defines the task.
const SECTION_HELP = {
  // shared / staff + manager
  overview:    "Team overview: KPI cards (transfers, sales, approved, pending) + leaderboards. Set the date range top-right and everything recalculates. Use the tabs to drill in.",
  dashboard:   "Your home base. Move around with the sidebar/tabs — click me on any section for specifics about it.",
  calendar:    "Company event calendar. Superadmins create & drag events; everyone else sees them. Switch Month / Week / Day / List with the buttons top-right.",
  transfers:   "Transfers = leads a fronter hands to a closer. Filter by status / date / agent; click a row for full detail. Duplicate same-number leads can be merged in the cleanup tool.",
  team_sales:  "Team Sales: every deal your team closed. Filter by status / agent / date, click a row for detail, and use Export to download (no row cap).",
  my_sales:    "My Sales: deals you closed. Add a new one from a worked transfer; track its approval status (pending → approved/returned) here.",
  callbacks:   "Callbacks: scheduled follow-ups. Pick a date & time (saved in your timezone), attach the number + a note, and mark Done when handled. Missed callbacks pile up — clear them daily or I'll nag 😄.",
  reports:     "Reports: fronter/closer performance + company totals over the date range you pick. Great for spotting who needs coaching.",
  reviews:     "Call Reviews: quality ratings on calls. Filter by agent; open one to see the score, notes, and the linked transfer.",
  team:        "Team: your company's users. Create accounts, edit details, activate/deactivate, and assign each person a role.",
  roles:       "Roles: define what each role can do via permission toggles. Editing a role changes it for everyone who has it — change carefully.",
  forms:       "Form Builder: the fields fronters fill (transfer) and closers fill (sale). Drag to reorder, mark required, set the type. Changes apply across the app instantly.",
  numbers:     "Callback Numbers: phone lists assigned to agents with call history + ownership. Upload a list, reassign numbers, and track attempts.",
  search:      "Search sales by customer, phone, reference, or VIN (type 2+ characters). Fast lookups + audits.",
  'sale-search': "Lead/Sale search across all companies — by name, phone, reference, or VIN. Handy for audits and quick lookups.",
  activity_log:"Activity Log: a timeline of team actions (transfers, sales, dispositions). Filter by agent to audit who did what.",
  faqs:        "FAQs: the help articles your team sees. Add / edit Q&A here; they appear in the staff help panels.",
  scripts:     "Scripts: call scripts for agents. Create and categorize them; agents open them from their script panel.",
  // superadmin
  companies:   "Companies + their users & roles. Expand a company to see members, add users, assign roles, and toggle features per company.",
  'bulk-upload': "Bulk Upload: import transfers or sales from CSV/Excel. Download the template, map columns, review the matches, then confirm. Read the best-practices panel first — I'll guide each step.",
  announcements:"Announcements: broadcast a banner/message to chosen roles or companies. Rich text + priority; controls who sees it and when it reshows.",
  marquee:     "Marquee: the scrolling ticker atop dashboards. Add lines and choose who sees them.",
  spiff:       "SPIFF: sales incentives/contests. Set a target + reward; agents get a live progress widget.",
  chat:        "Chat Control: moderate the global chat — ban/mute users, lock rooms, and review the moderation audit log.",
  features:    "Feature Flags: turn modules on/off globally (the default) or per company. This is also where you enable/disable me — the CRM Assistant.",
  // compliance
  queue:       "Review Queue: sales awaiting your approval, oldest first. Approve → closed_won, or Return with a note to send it back to the closer.",
  sales:       "All Sales: full sale management across every company. Search/filter, edit a status with a reason, and export.",
};

export function helpFor(role, page, section) {
  if (section && SECTION_HELP[section]) {
    return { id: `help_sec_${section}`, kind: 'tip', message: SECTION_HELP[section], action: { label: 'Thanks!' } };
  }
  const bucket = PAGE_HELP[page] || PAGE_HELP.dashboard;
  const msg =
    bucket[role] ||
    (isManager(role) && bucket._manager) ||
    (isAdmin(role) && bucket._admin) ||
    bucket._any ||
    bucket.closer || bucket.fronter ||
    "Drag me anywhere. I’ll nudge you when something needs attention — click me on any screen for tips.";
  return { id: `help_${page}_${role}`, kind: 'tip', message: msg, action: { label: 'Thanks!' } };
}
