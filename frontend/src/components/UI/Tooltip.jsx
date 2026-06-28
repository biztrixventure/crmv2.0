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
      <span role="tooltip"
        className={`pointer-events-none absolute ${pos} left-1/2 -translate-x-1/2 px-2 py-1 rounded-md text-[11px] font-medium leading-snug opacity-0 group-hover/tt:opacity-100 transition-opacity duration-150 z-50 shadow-lg`}
        style={{
          backgroundColor: 'var(--color-text)', color: 'var(--color-surface)',
          whiteSpace: 'normal', width: 'max-content', maxWidth, textAlign: 'center',
        }}>
        {text}
      </span>
    </span>
  );
}
