import React from 'react'

const GLYPH_COLOR = '#185FA5'

const GLYPH_CONFIG = {
  // Circle with × — broken element, wrong link, layout bug
  error: {
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="8" r="6.5"/>
        <path d="M5.5 5.5l5 5M10.5 5.5l-5 5"/>
      </svg>
    ),
  },
  // Triangle with ! — misleading label, confusing copy, wrong destination
  warning: {
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 2L1.3 13.5h13.4L8 2z"/>
        <line x1="8" y1="7" x2="8" y2="10.5"/>
        <circle cx="8" cy="12.5" r="0.8" fill="white" stroke="none"/>
      </svg>
    ),
  },
  // Magnifying glass — element exists but is buried or hard to find
  friction: {
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="6.5" cy="6.5" r="4.5"/>
        <line x1="10" y1="10" x2="14" y2="14"/>
      </svg>
    ),
  },
  // Plus — needed element is absent; dot marks where it should go
  missing: {
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round">
        <line x1="8" y1="2" x2="8" y2="14"/>
        <line x1="2" y1="8" x2="14" y2="8"/>
      </svg>
    ),
  },
  // Trending-up — works but could be significantly better
  improve: {
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12l4-4 3 3 5-6"/>
        <path d="M11 5h3v3"/>
      </svg>
    ),
  },
} as const

type GlyphType = keyof typeof GLYPH_CONFIG

export function GlyphDot({ glyph, open = false, onClick, onMouseEnter, onMouseLeave, animationDelay = '0s' }: {
  glyph?: string; open?: boolean
  onClick?: () => void; onMouseEnter?: () => void; onMouseLeave?: () => void
  animationDelay?: string
}) {
  const cfg = GLYPH_CONFIG[(glyph as GlyphType) in GLYPH_CONFIG ? (glyph as GlyphType) : 'warning']
  return (
    <div
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        width: 32, height: 32, borderRadius: '50%',
        background: GLYPH_COLOR,
        border: '3px solid rgba(255,255,255,0.9)',
        boxShadow: open
          ? `0 0 0 4px rgba(255,255,255,.9), 0 0 0 7px ${GLYPH_COLOR}44`
          : `0 0 0 3px rgba(255,255,255,.85), 0 2px 8px rgba(0,0,0,.25)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative', cursor: 'pointer',
        animation: `sc-dot-pop 0.4s cubic-bezier(.34,1.56,.64,1) ${animationDelay} both`,
        transition: 'box-shadow 0.15s',
      }}
    >
      {cfg.icon}
      <div style={{
        position: 'absolute', inset: -3, borderRadius: '50%',
        border: `2px solid ${GLYPH_COLOR}`,
        animation: `sc-pulse 2s ease-out infinite`,
        animationDelay,
        pointerEvents: 'none',
      }} />
    </div>
  )
}
