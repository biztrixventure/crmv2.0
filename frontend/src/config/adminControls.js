// ============================================================================
// adminControls.js — catalog of individually-governable ACTION controls per
// AdminPanel tab. The SuperAdmin can turn any of these OFF for a read-only
// admin; when off the button is not rendered at all (the RO's dashboard becomes
// look-only). Governance stores the DISABLED keys per user; absent = allowed
// (full parity). Keys are stable strings `<tabId>.<action>` — never renumber.
//
// Consumed by: contexts/AuthContext (roControlAllowed), the ReadonlyAdminManager
// controls matrix, and each component that gates a button with
// roControlAllowed('<tabId>.<action>').
//
// Scope note: these are ACTION buttons (create / edit / delete / run / send /
// download / manage). Pure view controls (filters, sort, search, pagination,
// refresh) are intentionally NOT gated — they don't mutate or exfiltrate.
// Tab VISIBILITY itself is governed separately (config/adminTabs.js nav list),
// and downloads-by-area separately (export flags). This layer is the buttons
// WITHIN a visible tab.
// ============================================================================

export const ADMIN_CONTROLS = {
  companies: [
    { key: 'companies.add',        label: 'Add company' },
    { key: 'companies.edit',       label: 'Edit company' },
    { key: 'companies.activate',   label: 'Activate / deactivate' },
    { key: 'companies.delete',     label: 'Delete company' },
    { key: 'companies.reorder',    label: 'Reorder (drag)' },
  ],
  'sale-search': [
    { key: 'sale-search.edit',     label: 'Edit lead/sale row' },
    { key: 'sale-search.delete',   label: 'Delete lead/sale row' },
  ],
  'customer-profiles': [
    { key: 'customer-profiles.risk_check',  label: 'Run number risk check' },
    { key: 'customer-profiles.add_note',    label: 'Add note' },
    { key: 'customer-profiles.delete_note', label: 'Delete note' },
  ],
  'data-analyzer': [
    { key: 'data-analyzer.run_query',    label: 'Run query' },
    { key: 'data-analyzer.breakdown',    label: 'Run breakdown' },
    { key: 'data-analyzer.send_batch',   label: 'Send batch' },
    { key: 'data-analyzer.save_preset',  label: 'Save preset' },
    { key: 'data-analyzer.delete_preset',label: 'Delete preset' },
  ],
  'bulk-upload': [
    { key: 'bulk-upload.upload',        label: 'Upload file' },
    { key: 'bulk-upload.apply',         label: 'Apply records' },
    { key: 'bulk-upload.merge',         label: 'Merge duplicates' },
    { key: 'bulk-upload.delete_batch',  label: 'Delete a batch' },
    { key: 'bulk-upload.delete_all',    label: 'Delete all bulk data' },
  ],
  faqs: [
    { key: 'faqs.add',            label: 'Add FAQ' },
    { key: 'faqs.edit',           label: 'Edit FAQ' },
    { key: 'faqs.delete',         label: 'Delete FAQ' },
    { key: 'faqs.categories',     label: 'Manage categories' },
  ],
  scripts: [
    { key: 'scripts.add',         label: 'Add script' },
    { key: 'scripts.edit',        label: 'Edit script' },
    { key: 'scripts.delete',      label: 'Delete script' },
    { key: 'scripts.categories',  label: 'Manage categories' },
  ],
  announcements: [
    { key: 'announcements.add',    label: 'New announcement' },
    { key: 'announcements.edit',   label: 'Edit announcement' },
    { key: 'announcements.delete', label: 'Delete announcement' },
  ],
  marquee: [
    { key: 'marquee.add',    label: 'New marquee' },
    { key: 'marquee.edit',   label: 'Edit marquee' },
    { key: 'marquee.delete', label: 'Delete marquee' },
  ],
  spiff: [
    { key: 'spiff.add',       label: 'New SPIFF' },
    { key: 'spiff.edit',      label: 'Edit SPIFF' },
    { key: 'spiff.delete',    label: 'Delete SPIFF' },
    { key: 'spiff.set_score', label: 'Set participant score' },
  ],
  payments: [
    { key: 'payments.mark_collected', label: 'Mark collected' },
    { key: 'payments.mark_at_risk',   label: 'Mark at risk' },
    { key: 'payments.cancel_policy',  label: 'Cancel policy' },
    { key: 'payments.save_note',      label: 'Save note' },
    { key: 'payments.save_settings',  label: 'Save settings' },
  ],
  chat: [
    { key: 'chat.delete_room',      label: 'Delete room' },
    { key: 'chat.delete_message',   label: 'Delete / edit message' },
    { key: 'chat.remove_member',    label: 'Remove member' },
    { key: 'chat.ban_user',         label: 'Ban / unban user' },
    { key: 'chat.broadcast',        label: 'Send broadcast' },
    { key: 'chat.guest_link',       label: 'Create / delete guest link' },
    { key: 'chat.client_login',     label: 'Manage client logins' },
  ],
  features: [
    { key: 'features.add',    label: 'New flag' },
    { key: 'features.edit',   label: 'Edit flag' },
    { key: 'features.delete', label: 'Delete flag' },
  ],
  'business-rules': [
    { key: 'business-rules.clone_globals', label: 'Clone globals' },
    { key: 'business-rules.reset_all',     label: 'Reset all' },
    { key: 'business-rules.save',          label: 'Save changes' },
  ],
  calendar: [
    { key: 'calendar.new_event',    label: 'New event' },
    { key: 'calendar.edit_event',   label: 'Edit event' },
    { key: 'calendar.delete_event', label: 'Delete event' },
  ],
  // Cross-company compliance tabs (rendered to RO via cc-*): row actions.
  'cc-sales': [
    { key: 'cc-sales.approve',  label: 'Approve sale' },
    { key: 'cc-sales.return',   label: 'Return sale' },
    { key: 'cc-sales.charge',   label: 'Charge → Sale' },
    { key: 'cc-sales.edit',     label: 'Edit sale' },
    { key: 'cc-sales.delete',   label: 'Delete sale' },
  ],
  'cc-transfers': [
    { key: 'cc-transfers.edit',       label: 'Edit lead' },
    { key: 'cc-transfers.reject',     label: 'Reject transfer' },
    { key: 'cc-transfers.set_status', label: 'Set status / delete' },
  ],
  'cc-callbacks': [
    { key: 'cc-callbacks.set_status', label: 'Set status / delete' },
  ],
};

// Flat list for the resolver / manager.
export const ALL_CONTROL_KEYS = Object.values(ADMIN_CONTROLS).flat().map(c => c.key);

// [tabId, controls[]] grouped for the manager UI, ordered by the tab catalog.
export function groupedControls() {
  return Object.entries(ADMIN_CONTROLS);
}
