import { Filter, Loader2 } from 'lucide-react';

// Compact dry-run rule preview for the send / sub-batch modals.
const REASON = {
  already_assigned: 'already assigned to them',
  transferred_by_you: 'they already transferred',
  transferred_by_anyone: 'already transferred (any fronter)',
};

export default function RulePreview({ preview, previewing, recipientName }) {
  if (previewing) return (
    <div className="text-xs flex items-center gap-1.5 mt-2" style={{ color: 'var(--color-text-tertiary)' }}>
      <Loader2 size={12} className="animate-spin" /> Checking rules…
    </div>
  );
  if (!preview) return null;
  const r = preview.rules || {};
  const anyOn = r.block_reassign_same_person || r.skip_if_transferred_by_recipient || r.skip_if_transferred_by_anyone;
  if (!anyOn) return <div className="text-xs mt-2" style={{ color: 'var(--color-text-tertiary)' }}>No skip rules active — all {preview.total} numbers will be sent.</div>;
  if (!preview.excluded) return <div className="text-xs mt-2" style={{ color: 'var(--color-success-600)' }}>Rules active — none of the {preview.total} numbers are excluded.</div>;

  const who = preview.recipient_is_dialer ? (recipientName ? ` for ${recipientName}` : '') : ' when this reaches a fronter';
  const parts = Object.entries(preview.by_reason || {}).map(([k, v]) => `${v} ${REASON[k] || k}`);
  return (
    <div className="text-xs mt-2 p-2 rounded-lg flex items-start gap-2" style={{ background: 'var(--color-warning-50, rgba(217,119,6,0.08))', border: '1px solid var(--color-warning-200, rgba(217,119,6,0.25))', color: 'var(--color-text-secondary)' }}>
      <Filter size={13} style={{ color: 'var(--color-warning-600)' }} className="mt-0.5 flex-shrink-0" />
      <div>
        <b>~{preview.excluded}</b> of {preview.total} would be excluded{who}, <b>{preview.included}</b> sent.
        {parts.length > 0 && <span> ({parts.join(', ')})</span>}
      </div>
    </div>
  );
}
