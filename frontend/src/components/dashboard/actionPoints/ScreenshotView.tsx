import { useRef, useState } from 'react'
import type { ScreenshotMeta, AnnotateResult, AnnotationPoint } from '../../../lib/api'
import * as api from '../../../lib/api'
import { AnnotationCard } from './AnnotationCard'
import { GlyphDot } from './GlyphDot'
import { Spinner } from './ui'

function AnnotationDot({ point, dotIndex = 0 }: { point: AnnotationPoint; dotIndex?: number }) {
  const [open, setOpen] = useState(false)
  const dotRef = useRef<HTMLDivElement>(null)

  return (
    <div ref={dotRef} style={{ position: 'absolute', left: `${point.x}%`, top: `${point.y}%`, transform: 'translate(-50%,-50%)', zIndex: open ? 30 : 10 }}>
      <GlyphDot
        glyph={point.glyph}
        open={open}
        onClick={() => setOpen(v => !v)}
        animationDelay={`${dotIndex * 0.12}s`}
      />
      {open && dotRef.current && (
        <AnnotationCard anchor={dotRef.current} label={point.label} onClose={() => setOpen(false)} />
      )}
    </div>
  )
}

export function ScreenshotView({ screenshot, annotation, pending }: {
  screenshot: ScreenshotMeta
  annotation: AnnotateResult | null
  pending: boolean
}) {
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <img
        src={api.screenshotImageUrl(screenshot.id)}
        alt=""
        style={{ width: '100%', height: 'auto', display: 'block', opacity: 0.9 }}
      />

      {pending && (
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'linear-gradient(135deg, transparent 40%, rgba(37,99,235,0.05) 60%, transparent 80%)',
          backgroundSize: '200% 200%', animation: 'scan 1.6s linear infinite',
        }} />
      )}

      {annotation?.found && annotation.points.map((pt, i) => (
        <AnnotationDot key={i} point={pt} dotIndex={i} />
      ))}

      <div style={{ position: 'absolute', bottom: 8, left: 8, right: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', pointerEvents: 'none' }}>
        {screenshot.path && (
          <div style={{ background: 'rgba(15,23,42,0.72)', color: '#94a3b8', fontSize: 'var(--fs-small)', fontFamily: 'var(--font-sans)', padding: '2px 7px', borderRadius: 5 }}>
            {screenshot.path}
          </div>
        )}
        {pending && (
          <div style={{ background: 'rgba(15,23,42,0.72)', color: '#94a3b8', fontSize: 'var(--fs-small)', padding: '3px 8px', borderRadius: 5, display: 'flex', alignItems: 'center', gap: 5 }}>
            <Spinner size={8} /> Locating…
          </div>
        )}
      </div>
    </div>
  )
}
