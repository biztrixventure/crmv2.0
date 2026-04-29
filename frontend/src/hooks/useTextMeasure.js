import { useRef, useState, useLayoutEffect, useCallback } from 'react'
import { prepare, layout } from '@chenglou/pretext'

function resolveLineHeight(el) {
  const cs = window.getComputedStyle(el)
  const lh = cs.lineHeight
  return lh === 'normal' ? parseFloat(cs.fontSize) * 1.5 : parseFloat(lh)
}

export function useTextMeasure({ text = '', maxLines = 3 } = {}) {
  const ref = useRef(null)
  const [state, setState] = useState({ lineCount: 0, height: 0, needsClamp: false })

  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    if (!text) {
      setState({ lineCount: 0, height: 0, needsClamp: false })
      return
    }

    const width = el.getBoundingClientRect().width
    if (!width || width < 4) return

    const font = window.getComputedStyle(el).font
    const lh = resolveLineHeight(el)

    try {
      const prepared = prepare(text, font)
      const { lineCount, height } = layout(prepared, width, lh)
      setState(prev =>
        prev.lineCount === lineCount && prev.height === height
          ? prev
          : { lineCount, height, needsClamp: lineCount > maxLines }
      )
    } catch {
      // Pretext can fail on certain font/text edge cases — silently skip
    }
  }, [text, maxLines])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [measure])

  return { ref, ...state }
}
