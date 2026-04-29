import { useState } from 'react'
import { useTextMeasure } from '../../hooks/useTextMeasure'

const CLAMP = (n) => ({
  display: '-webkit-box',
  WebkitLineClamp: n,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
})

/**
 * Renders text with Pretext-powered line counting. When the text exceeds
 * maxLines, shows a "Show more / Show less" toggle. Uses CSS line-clamp for
 * the visual cutoff; Pretext decides whether the toggle is needed at all —
 * avoiding the DOM-reflow approach of comparing scrollHeight vs clientHeight.
 */
const SmartText = ({ text, maxLines = 3, className = '', style }) => {
  const [expanded, setExpanded] = useState(false)
  const { ref, needsClamp } = useTextMeasure({ text: text || '', maxLines })

  return (
    <div ref={ref} className={className} style={style}>
      <span style={!expanded && needsClamp ? CLAMP(maxLines) : undefined}>
        {text || '—'}
      </span>
      {needsClamp && (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
          className="block mt-0.5 text-xs font-semibold"
          style={{ color: 'var(--color-primary-600)' }}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}

export default SmartText
