// Maps transfer.status + transfer.sale_status → display label + badge variant.
// Used in every view that shows a transfer row: fronter My Leads, ManagerShell,
// TransferDetailDrawer, ComplianceShell TransfersTab.

const BARE = {
  pending:   { label: 'Open',      variant: 'info'    },
  assigned:  { label: 'Open',      variant: 'info'    },
  completed: { label: 'Completed', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'error'   },
  rejected:  { label: 'Rejected',  variant: 'error'   },
};

// Compliance lifecycle overlay — only applied when transfer.status === 'completed'
const COMPLIANCE = {
  open:           { label: 'In Progress',         variant: 'info'    },
  follow_up:      { label: 'In Progress',         variant: 'info'    },
  pending_review: { label: 'Awaiting Compliance', variant: 'warning' },
  needs_revision: { label: 'Needs Revision',      variant: 'error'   },
  closed_won:     { label: 'Sale Approved',        variant: 'success' },
  sold:           { label: 'Sale Approved',        variant: 'success' },
  closed_lost:    { label: 'Sale Rejected',        variant: 'error'   },
  cancelled:      { label: 'Sale Cancelled',       variant: 'error'   },
};

export function getTransferDisplayStatus(transfer) {
  if (transfer.status === 'completed' && transfer.sale_status) {
    return COMPLIANCE[transfer.sale_status] || { label: 'Completed', variant: 'success' };
  }
  return BARE[transfer.status] || { label: transfer.status || '—', variant: 'secondary' };
}
