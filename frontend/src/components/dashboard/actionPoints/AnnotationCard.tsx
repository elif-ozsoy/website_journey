import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const CARD_W = 270
const GAP = 14   // distance between dot and card
const PAD = 8    // minimum distance to the viewport edge

/**
 * Label popup for an annotation dot, rendered in a portal to document.body.
 *
 * Positioned from the dot's screen coordinates and clamped to the viewport,
 * so no ancestor overflow:hidden can ever cut the text off. Opens on
 * whichever side of the dot has more room; if the text is taller than the
 * available space it scrolls instead of being clipped.
 */
export function AnnotationCard({ anchor, label, onClose, interactive = true }: {
  anchor: HTMLElement
  label: string
  onClose: () => void
  /** false = transient hover card that must not steal mouse events */
  interactive?: boolean
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null)

  useLayoutEffect(() => {
    function place() {
      const card = cardRef.current
      if (!card) return
      const r = anchor.getBoundingClientRect()
      const cardH = card.scrollHeight
      const spaceAbove = r.top - GAP - PAD
      const spaceBelow = window.innerHeight - r.bottom - GAP - PAD
      const above = cardH <= spaceAbove || spaceAbove > spaceBelow
      const maxHeight = Math.max(60, above ? spaceAbove : spaceBelow)
      const height = Math.min(cardH, maxHeight)
      const top = above ? r.top - GAP - height : r.bottom + GAP
      const left = Math.max(PAD, Math.min(r.left + r.width / 2 - CARD_W / 2, window.innerWidth - CARD_W - PAD))
      setPos({ left, top, maxHeight })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [anchor, label])

  return createPortal(
    <div
      ref={cardRef}
      onClick={e => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: pos?.left ?? -9999,
        top: pos?.top ?? 0,
        width: CARD_W,
        maxHeight: pos?.maxHeight,
        overflowY: 'auto',
        visibility: pos ? 'visible' : 'hidden',
        background: '#fff',
        borderRadius: 10,
        border: '1px solid rgba(0,0,0,0.08)',
        boxShadow: '0 12px 32px rgba(0,0,0,0.16), 0 2px 8px rgba(0,0,0,0.08)',
        fontFamily: 'var(--font-sans)',
        zIndex: 1000,
        pointerEvents: interactive ? 'auto' : 'none',
        animation: 'dotCardIn 0.15s ease-out',
      }}
    >
      <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <p style={{
          margin: 0, flex: 1,
          fontSize: '12.5px', lineHeight: 1.6, fontWeight: 500,
          color: '#1e293b', whiteSpace: 'normal',
          wordBreak: 'break-word', overflowWrap: 'anywhere',
        }}>
          {label}
        </p>
        {interactive && (
          <button
            onClick={e => { e.stopPropagation(); onClose() }}
            style={{
              flexShrink: 0, width: 20, height: 20, borderRadius: 5,
              border: 'none', background: '#f1f5f9', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#94a3b8', transition: 'background 0.12s', marginTop: 1,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#e2e8f0' }}
            onMouseLeave={e => { e.currentTarget.style.background = '#f1f5f9' }}
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M1 1l6 6M7 1l-6 6"/>
            </svg>
          </button>
        )}
      </div>
    </div>,
    document.body,
  )
}
