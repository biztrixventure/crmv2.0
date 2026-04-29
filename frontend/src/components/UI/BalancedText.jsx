import { useRef, useEffect } from 'react'
import { prepare, layout, measureNaturalWidth } from '@chenglou/pretext'

function resolveLineHeight(el) {
  const cs = window.getComputedStyle(el)
  const lh = cs.lineHeight
  return lh === 'normal' ? parseFloat(cs.fontSize) * 1.5 : parseFloat(lh)
}

/**
 * Balances multiline text so all lines are approximately equal width, eliminating
 * short orphaned last lines. Uses Pretext's layout engine to binary-search the
 * optimal container max-width.
 *
 * Only accepts a `text` string — does not support mixed children.
 */
const BalancedText = ({ text, className = '', style = {} }) => {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !text) return

    const compute = () => {
      const containerW = el.getBoundingClientRect().width
      if (!containerW) return

      const cs = window.getComputedStyle(el)
      const font = cs.font
      const lh = resolveLineHeight(el)

      try {
        const prepared = prepare(text, font)
        const natW = measureNaturalWidth(prepared)

        // Text fits on one line — nothing to balance
        if (natW <= containerW) {
          el.style.maxWidth = ''
          return
        }

        const { lineCount: targetLines } = layout(prepared, containerW, lh)
        if (targetLines <= 1) { el.style.maxWidth = ''; return }

        // Binary search: find the minimum maxWidth that still yields targetLines.
        // This packs each line as full as possible, equalising line lengths.
        let lo = natW / (targetLines + 1)
        let hi = containerW
        for (let i = 0; i < 24; i++) {
          const mid = (lo + hi) / 2
          const { lineCount } = layout(prepared, mid, lh)
          if (lineCount <= targetLines) hi = mid
          else lo = mid
        }

        el.style.maxWidth = `${Math.ceil(hi)}px`
      } catch {
        el.style.maxWidth = ''
      }
    }

    const ro = new ResizeObserver(compute)
    ro.observe(el)
    compute()
    return () => ro.disconnect()
  }, [text])

  return (
    <span ref={ref} className={className} style={{ display: 'block', ...style }}>
      {text}
    </span>
  )
}

export default BalancedText
