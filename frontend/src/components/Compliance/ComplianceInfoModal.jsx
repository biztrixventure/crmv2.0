import { createPortal } from 'react-dom';
import { X, Info, CheckCircle, RotateCcw, Trash2, Layers, Clock } from 'lucide-react';

// Superadmin-only explainer for the compliance numbers. Manual deletions /
// approvals change live totals, which causes confusion — this spells out exactly
// what each figure means and why it moves.
const Row = ({ icon: Icon, color, title, children }) => (
  <div className="flex items-start gap-3">
    <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
      style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
      <Icon size={15} style={{ color }} />
    </span>
    <div>
      <p className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>{title}</p>
      <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{children}</p>
    </div>
  </div>
);

const Pill = ({ children, bg, fg }) => (
  <span className="text-[11px] font-bold px-1.5 py-0.5 rounded mx-0.5" style={{ backgroundColor: bg, color: fg }}>{children}</span>
);

const ComplianceInfoModal = ({ onClose }) => createPortal(
  <div className="fixed inset-0 z-[2147483647] flex items-center justify-center p-4"
    style={{ backgroundColor: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(2px)' }}
    onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="w-full max-w-lg rounded-2xl overflow-hidden flex flex-col max-h-[88vh]"
      style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}>

      <div className="flex items-center justify-between px-5 py-4 flex-shrink-0" style={{ background: 'var(--gradient-sidebar)' }}>
        <span className="flex items-center gap-2 font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>
          <Info size={18} /> What these numbers mean
        </span>
        <button onClick={onClose} className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30"><X size={18} className="text-white" /></button>
      </div>

      <div className="p-5 space-y-4 overflow-y-auto">
        <p className="text-xs rounded-xl p-3" style={{ backgroundColor: 'rgba(59,130,246,0.08)', color: 'var(--color-text-secondary)' }}>
          Every count here is <strong>live from the database</strong> — it updates the instant a sale is approved, returned, or deleted. So a total dropping isn't a glitch; it reflects a real action.
        </p>

        <Row icon={Clock} color="#d97706" title="Review Queue">
          Sales waiting for compliance, i.e. status <Pill bg="#fef3c7" fg="#92400e">pending_review</Pill>. This is the only tab that <em>shrinks</em> as you work: approving or returning a sale removes it from the queue.
        </Row>

        <Row icon={CheckCircle} color="#16a34a" title="Approve → closed_won">
          Approving a sale sets it to <Pill bg="#dcfce7" fg="#15803d">closed_won</Pill>. It leaves the Review Queue and appears under All Sales / Approved. The Review Queue count goes down by one; approved goes up by one.
        </Row>

        <Row icon={RotateCcw} color="#b45309" title="Return → needs_revision">
          Returning sends it back to the closer as <Pill bg="#fee2e2" fg="#b91c1c">needs_revision</Pill> with your note. It also leaves the queue (it's no longer pending) but is <em>not</em> approved — so queue drops without approved rising.
        </Row>

        <Row icon={Layers} color="#2563eb" title="All Sales statuses">
          <Pill bg="#dbeafe" fg="#1e40af">open</Pill><Pill bg="#fef3c7" fg="#92400e">pending_review</Pill><Pill bg="#fee2e2" fg="#b91c1c">needs_revision</Pill><Pill bg="#dcfce7" fg="#15803d">closed_won</Pill><Pill bg="#f3f4f6" fg="#374151">closed_lost / cancelled</Pill> — All Sales shows every status; filter by status to reconcile a total. "Total Sales" counts them all regardless of status.
        </Row>

        <Row icon={Trash2} color="#dc2626" title="Why a number drops after a manual delete">
          Deleting a <strong>sale</strong> permanently removes it, so every total it counted toward drops. Deleting a <strong>transfer</strong> cascades — its linked sales are removed too. Bulk-uploaded sales are tagged to an upload batch; deleting that batch removes exactly those rows (manual sales are never touched). This is usually the cause of "the number changed."
        </Row>

        <Row icon={Info} color="var(--color-primary-600)" title="Transfers: pending vs completed">
          A transfer is <Pill bg="#fef3c7" fg="#92400e">pending</Pill> until a closer logs a sale on it, then it's <Pill bg="#dcfce7" fg="#15803d">completed</Pill>. A high pending count just means many imported leads haven't been worked yet — it's not an error.
        </Row>

        <Row icon={Info} color="var(--color-text-tertiary)" title="If a tab total looks off">
          Tab tables honour the date-range + filters you set, while top-level cards are all-time. And if you're comparing to the Supabase dashboard, make sure it's the same project the app uses — counts won't match across projects.
        </Row>
      </div>

      <div className="px-5 py-3 flex justify-end flex-shrink-0" style={{ borderTop: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
        <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-bold text-white" style={{ background: 'var(--gradient-sidebar)' }}>Got it</button>
      </div>
    </div>
  </div>,
  document.body,
);

export default ComplianceInfoModal;
