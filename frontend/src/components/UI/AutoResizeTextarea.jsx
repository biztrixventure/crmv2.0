import { useRef, useLayoutEffect, forwardRef } from 'react'
import { prepare, layout } from '@chenglou/pretext'

function resolveLineHeight(el) {
  const cs = window.getComputedStyle(el)
  const lh = cs.lineHeight
  return lh === 'normal' ? parseFloat(cs.fontSize) * 1.5 : parseFloat(lh)
}

/**
 * Drop-in textarea replacement that auto-grows with content using Pretext for
 * height prediction — no DOM reflow required. Falls back to the scrollHeight
 * approach if Pretext measurement fails (e.g. unresolved system fonts).
 *
 * Props mirror <textarea>; add minRows / maxRows for growth bounds.
 */
const AutoResizeTextarea = forwardRef(({
  value = '',
  minRows = 2,
  maxRows = 8,
  className = '',
  style = {},
  ...props
}, forwardedRef) => {
  const innerRef = useRef(null)

  // Sync forwarded ref
  useLayoutEffect(() => {
    if (!forwardedRef) return
    if (typeof forwardedRef === 'function') forwardedRef(innerRef.current)
    else forwardedRef.current = innerRef.current
  })

  useLayoutEffect(() => {
    const el = innerRef.current
    if (!el) return

    const resize = () => {
      const totalW = el.getBoundingClientRect().width
      if (!totalW) return

      const cs = window.getComputedStyle(el)
      const font = cs.font
      const lh = resolveLineHeight(el)
      const pl = parseFloat(cs.paddingLeft) || 0
      const pr = parseFloat(cs.paddingRight) || 0
      const pt = parseFloat(cs.paddingTop) || 0
      const pb = parseFloat(cs.paddingBottom) || 0
      const contentW = Math.max(totalW - pl - pr, 10)

      try {
        const prepared = prepare(value || ' ', font)
        const { lineCount } = layout(prepared, contentW, lh)
        const rows = Math.max(minRows, Math.min(maxRows, lineCount))
        el.style.height = `${rows * lh + pt + pb}px`
        el.style.overflowY = lineCount > maxRows ? 'auto' : 'hidden'
      } catch {
        el.style.height = 'auto'
        el.style.height = `${el.scrollHeight}px`
      }
    }

    const ro = new ResizeObserver(resize)
    ro.observe(el)
    resize()
    return () => ro.disconnect()
  }, [value, minRows, maxRows])

  return (
    <textarea
      ref={innerRef}
      value={value}
      className={className}
      style={{ resize: 'none', ...style }}
      {...props}
    />
  )
})

AutoResizeTextarea.displayName = 'AutoResizeTextarea'
export default AutoResizeTextarea
