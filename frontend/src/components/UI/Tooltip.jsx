/**
 * Tooltip — lightweight CSS-only hover tooltip. No dependencies, no portal.
 *
 * Wrap anything; a dark bubble explains it / reveals full text on hover. Uses a
 * named group (group/tt) so nested tooltips never trigger each other. Reusable
 * across every shell — the one place to make "hover → info" consistent.
 *
 *   <Tooltip text="Approved policies still in force">{children}</Tooltip>
 */
export default function Tooltip({ text, children, side = 'top', className = '', maxWidth = 220 }) {
  if (text == null || text === '') return children;
  const pos = side === 'bottom'
    ? 'top-full mt-1.5'
    : 'bottom-full mb-1.5';
  return (
    <span className={`relative group/tt inline-flex items-center ${className}`}>
      {children}
      {/* `hidden`, not `opacity-0`: an opacity-0 box is still laid out, and an
          absolutely-positioned one centred on a trigger near the right edge
          extends the document's scrollable overflow. Measured live at 390: ten
          of these bubbles reached 548–553px against a 490px client width, which
          is what made the whole page scroll sideways — the tab strip was never
          the culprit. display:none generates no box, so it cannot. */}
      <span role="tooltip"
        className={`pointer-events-none absolute ${pos} left-1/2 -translate-x-1/2 px-2 py-1 rounded-md text-[11px] font-medium leading-snug hidden group-hover/tt:block z-[200] shadow-lg`}
        style={{
          backgroundColor: 'var(--color-text)', color: 'var(--color-surface)',
          whiteSpace: 'normal', width: 'max-content', maxWidth, textAlign: 'center',
        }}>
        {text}
      </span>
    </span>
  );
}
