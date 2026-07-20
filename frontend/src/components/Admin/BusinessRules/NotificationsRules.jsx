import { Bell, AlertTriangle, Info } from 'lucide-react';

const cfg = (config, key, fallback) => (config?.[key] !== undefined ? config[key] : fallback);

const Section = ({ title, desc, accent = 'primary', children }) => (
  <section className="rounded-2xl mb-4 overflow-hidden"
    style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)',
             borderTop: `3px solid var(--color-${accent}-500, #6366f1)` }}>
    <div className="p-5">
      <h2 className="text-base font-bold text-text mb-1">{title}</h2>
      {desc && <p className="text-xs text-text-secondary mb-4 max-w-2xl leading-relaxed">{desc}</p>}
      {children}
    </div>
  </section>
);

const RadioGroup = ({ value, onChange, options, name }) => (
  <div role="radiogroup" aria-label={name} className="space-y-1.5">
    {options.map(opt => (
      <label key={opt.key}
        className="flex items-start gap-3 py-2 px-3 rounded-lg cursor-pointer hover:bg-bg-secondary transition-colors min-h-[44px]"
        style={{
          border: '1px solid',
          borderColor: value === opt.key ? 'var(--color-primary-400, #818cf8)' : 'var(--color-border)',
          backgroundColor: value === opt.key ? 'var(--color-primary-50, #eef2ff)' : 'transparent',
        }}>
        <input type="radio" name={name} checked={value === opt.key} onChange={() => onChange(opt.key)}
          className="mt-1 w-4 h-4 flex-shrink-0 cursor-pointer" style={{ accentColor: 'var(--color-primary-600)' }} />
        <div className="flex-1">
          <p className="text-sm font-semibold text-text">{opt.label}</p>
          {opt.detail && <p className="text-xs text-text-tertiary mt-0.5">{opt.detail}</p>}
        </div>
      </label>
    ))}
  </div>
);

const CheckboxRow = ({ checked, onChange, label, sub }) => (
  <label className="flex items-start gap-3 py-2 px-3 rounded-lg cursor-pointer hover:bg-bg-secondary transition-colors min-h-[44px]">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
      className="mt-1 w-4 h-4 flex-shrink-0 cursor-pointer"
      style={{ accentColor: 'var(--color-primary-600)' }} aria-label={label} />
    <div className="flex-1">
      <span className="text-sm font-semibold text-text">{label}</span>
      {sub && <p className="text-xs text-text-tertiary mt-0.5">{sub}</p>}
    </div>
  </label>
);

const RESELL_NOTIFY = [
  { key: 'never',    label: 'Never (privacy mode)', detail: 'Recommended — preserves fronter blindness to resells' },
  { key: 'manager',  label: 'Manager only',         detail: 'Fronter manager pinged for audit awareness' },
  { key: 'everyone', label: 'Everyone',             detail: 'Original fronter + their manager both pinged — kills privacy' },
];

const NotificationsRules = ({ config, scope, onSave }) => {
  const onResellFronter   = cfg(config, 'notifications.resell_notify_fronter', 'never');
  const notifyCloserBulk  = cfg(config, 'notifications.bulk_update_notify_closer', true);
  const notifyComplResell = cfg(config, 'notifications.resell_notify_compliance', true);
  const notifyFronterReject = cfg(config, 'notifications.transfer_reject_notify_fronter', true);
  const notifyCloserAssign = cfg(config, 'notifications.transfer_assigned_notify_closer', true);

  return (
    <div className="w-full pb-8">
      {scope !== 'global' && (
        <div className="rounded-2xl p-4 mb-4 flex items-start gap-3"
          style={{ backgroundColor: 'var(--color-warning-50, #fffbeb)', border: '1px solid var(--color-warning-300, #fcd34d)' }}>
          <AlertTriangle size={18} style={{ color: 'var(--color-warning-700, #b45309)' }} className="flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-bold mb-0.5" style={{ color: 'var(--color-warning-800, #92400e)' }}>Per-company override active</p>
            <p style={{ color: 'var(--color-warning-700, #b45309)' }}>Changes here apply only to the selected company.</p>
          </div>
        </div>
      )}

      <div className="mb-6">
        <h2 className="text-xl font-bold text-text mb-1 flex items-center gap-2" style={{ fontFamily: 'var(--font-display)' }}>
          <Bell size={20} className="text-primary-600" /> Notifications
        </h2>
        <p className="text-sm text-text-secondary max-w-2xl leading-relaxed">
          Controls who gets pinged on key workflow events. Resell-related notifications interact with the privacy settings on the Resell page — keep them aligned.
        </p>
      </div>

      <Section accent="error" title="Resell — notify fronter?"
        desc="Whether the original fronter (or their manager) gets a push when their lead is resold. The Resell page's privacy flags should match — if you hide resells from fronters but ping them on resell, they'll know something happened without seeing what.">
        <RadioGroup name="resell-notify" value={onResellFronter}
          onChange={(v) => onSave('notifications.resell_notify_fronter', v)} options={RESELL_NOTIFY} />
      </Section>

      <Section accent="info" title="Compliance ping on resell"
        desc="Resells create a new sale that lands in compliance review. Optional ping so compliance sees it without polling the queue.">
        <CheckboxRow checked={notifyComplResell}
          onChange={(v) => onSave('notifications.resell_notify_compliance', v)}
          label="Ping compliance when a resell is created"
          sub="Recommended — adds the new sale to their queue visibility" />
      </Section>

      <Section accent="primary" title="Bulk update — closer notification"
        desc="When a superadmin bulk-updates a closer's sale through the bulk uploader, the closer can be pinged so they're aware their record changed.">
        <CheckboxRow checked={notifyCloserBulk}
          onChange={(v) => onSave('notifications.bulk_update_notify_closer', v)}
          label="Notify closer when their sale is bulk-updated"
          sub="Pings only on actual changes — no-op updates don't fire" />
      </Section>

      <Section accent="warning" title="Transfer reject — fronter notification"
        desc="Fronter gets a push when their assigned transfer is rejected by closer or compliance.">
        <CheckboxRow checked={notifyFronterReject}
          onChange={(v) => onSave('notifications.transfer_reject_notify_fronter', v)}
          label="Notify fronter on transfer rejection"
          sub="Disabling makes rejections silent — fronter only sees them on next dashboard load" />
      </Section>

      <Section accent="success" title="Transfer assigned — closer notification"
        desc="Closer gets a push when a new transfer is assigned to them.">
        <CheckboxRow checked={notifyCloserAssign}
          onChange={(v) => onSave('notifications.transfer_assigned_notify_closer', v)}
          label="Notify closer on assignment"
          sub="Standard workflow signal — turn off if your team uses a different tool" />
      </Section>

      <p className="text-xs text-text-tertiary mt-4 flex items-start gap-1.5 max-w-2xl leading-relaxed">
        <Info size={12} className="flex-shrink-0 mt-0.5" />
        Push delivery still depends on the user having enabled notifications in their browser and subscribed to web-push. These flags control whether the server attempts delivery at all.
      </p>
    </div>
  );
};

export default NotificationsRules;
