import { useState, useEffect, useRef, useCallback } from 'react'
import clsx from 'clsx'

interface Annotation {
  x: number
  y: number
  label: string
  type: 'error' | 'warning' | 'info'
  arrowDir: 'left' | 'right' | 'up' | 'down'
}

interface PlaceholderSection {
  label: string
  top: number
  left: number
  width: number
  height: number
  color: string
}

export interface HeatmapDot {
  x: number
  y: number
  kind: 'agent' | 'human' | 'attention'
}

export interface ScreenshotData {
  id: number
  pageLabel: string
  pageUrl: string
  annotations: Annotation[]
  placeholderSections: PlaceholderSection[]
  screenshotUrl?: string
  screenshotUrls?: string[]   // ranked list; [0] mirrors screenshotUrl
  heatmapDots?: HeatmapDot[]
}

interface Props {
  screenshots: ScreenshotData[]
  activeAnnotation: number | null
  onAnnotationClick: (idx: number) => void
  activePageIndex: number
  onPageChange: (idx: number) => void
  layout?: 'stacked' | 'wide'
  showHeatmap?: boolean
}

const TYPE_COLOR: Record<Annotation['type'], string> = {
  error: 'var(--red)',
  warning: 'var(--amber)',
  info: 'var(--brand)',
}
const TYPE_BG: Record<Annotation['type'], string> = {
  error: '#fff1f1',
  warning: '#fff9ed',
  info: '#f0eeff',
}

function interpolateStops(t: number, stops: Array<[number, number, number]>, maxAlpha = 200): [number, number, number, number] {
  if (t <= 0) return [0, 0, 0, 0]
  const alpha = Math.min(maxAlpha, Math.round((t / 0.15) * maxAlpha))
  const seg = t * (stops.length - 1)
  const lo = Math.floor(seg)
  const hi = Math.min(stops.length - 1, lo + 1)
  const frac = seg - lo
  const r = Math.round(stops[lo][0] + frac * (stops[hi][0] - stops[lo][0]))
  const g = Math.round(stops[lo][1] + frac * (stops[hi][1] - stops[lo][1]))
  const b = Math.round(stops[lo][2] + frac * (stops[hi][2] - stops[lo][2]))
  return [r, g, b, alpha]
}

// Cool blue gradient: transparent → blue → cyan → green → yellow → red
// Agent heatmap: blue (#0072B2) family, cold→hot
function intensityToRgba(t: number): [number, number, number, number] {
  return interpolateStops(t, [
    [20, 40, 42],
    [50, 73, 75],
    [0, 130, 140],
    [0, 210, 225],
    [180, 255, 255],
  ])
}

// Human heatmap: orange (#E69F00) family, cold→hot
function intensityToRgbaWarm(t: number): [number, number, number, number] {
  return interpolateStops(t, [
    [80, 10, 40],
    [136, 19, 66],
    [200, 40, 100],
    [255, 80, 140],
    [255, 190, 215],
  ])
}

// Green gradient: transparent → dark-green → bright-green → yellow-green
function intensityToRgbaGreen(t: number): [number, number, number, number] {
  return interpolateStops(t, [
    [0, 120, 0],
    [0, 200, 80],
    [100, 255, 0],
    [220, 255, 0],
  ])
}

function renderHeatLayer(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  dots: HeatmapDot[],
  width: number,
  height: number,
  radius: number,
) {
  for (const dot of dots) {
    const cx = (dot.x / 100) * width
    const cy = (dot.y / 100) * height
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
    grad.addColorStop(0, 'rgba(255,255,255,0.35)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.fill()
  }
}

function colorizeLayer(
  offData: ImageData,
  outData: ImageData,
  colorFn: (t: number) => [number, number, number, number],
  existingData?: ImageData,
) {
  let maxA = 0
  for (let i = 3; i < offData.data.length; i += 4) {
    if (offData.data[i] > maxA) maxA = offData.data[i]
  }
  if (maxA === 0) return

  for (let i = 0; i < offData.data.length; i += 4) {
    const t = offData.data[i + 3] / maxA
    const [r, g, b, a] = colorFn(t)
    if (a === 0) continue

    if (existingData && existingData.data[i + 3] > 0) {
      // Blend on top of existing pixel (screen-like blend for overlap visibility)
      const ea = existingData.data[i + 3] / 255
      const na = a / 255
      const blendA = Math.min(255, Math.round((ea + na * (1 - ea)) * 255))
      outData.data[i]     = Math.min(255, Math.round((existingData.data[i] * ea + r * na * (1 - ea)) / (ea + na * (1 - ea))))
      outData.data[i + 1] = Math.min(255, Math.round((existingData.data[i + 1] * ea + g * na * (1 - ea)) / (ea + na * (1 - ea))))
      outData.data[i + 2] = Math.min(255, Math.round((existingData.data[i + 2] * ea + b * na * (1 - ea)) / (ea + na * (1 - ea))))
      outData.data[i + 3] = blendA
    } else {
      outData.data[i] = r
      outData.data[i + 1] = g
      outData.data[i + 2] = b
      outData.data[i + 3] = a
    }
  }
}

export function HeatmapCanvas({ dots, width, height, colorMode = 'unified', fitToContent = false }: {
  dots: HeatmapDot[]
  width: number
  height: number
  colorMode?: 'unified' | 'split'
  /** When true the canvas fills the full scrollable content height instead of the visible viewport */
  fitToContent?: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || dots.length === 0 || width === 0 || height === 0) return
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, width, height)

    const radius = Math.max(width, height) * 0.06

    if (colorMode === 'split') {
      const agentDots = dots.filter(d => d.kind === 'agent')
      const humanDots = dots.filter(d => d.kind === 'human')
      const outData = ctx.createImageData(width, height)

      if (agentDots.length > 0) {
        const off = document.createElement('canvas')
        off.width = width; off.height = height
        const offCtx = off.getContext('2d')!
        renderHeatLayer(offCtx, agentDots, width, height, radius)
        colorizeLayer(offCtx.getImageData(0, 0, width, height), outData, intensityToRgba)
      }

      if (humanDots.length > 0) {
        const off2 = document.createElement('canvas')
        off2.width = width; off2.height = height
        const offCtx2 = off2.getContext('2d')!
        renderHeatLayer(offCtx2, humanDots, width, height, radius)
        const snapshot = new ImageData(new Uint8ClampedArray(outData.data), width, height)
        colorizeLayer(offCtx2.getImageData(0, 0, width, height), outData, intensityToRgbaWarm, snapshot)
      }

      const attentionDots = dots.filter(d => d.kind === 'attention')
      if (attentionDots.length > 0) {
        const off3 = document.createElement('canvas')
        off3.width = width; off3.height = height
        const offCtx3 = off3.getContext('2d')!
        renderHeatLayer(offCtx3, attentionDots, width, height, radius)
        const snapshot2 = new ImageData(new Uint8ClampedArray(outData.data), width, height)
        colorizeLayer(offCtx3.getImageData(0, 0, width, height), outData, intensityToRgbaGreen, snapshot2)
      }

      ctx.putImageData(outData, 0, 0)
    } else {
      const off = document.createElement('canvas')
      off.width = width; off.height = height
      const offCtx = off.getContext('2d')!
      renderHeatLayer(offCtx, dots, width, height, radius)
      const offData = offCtx.getImageData(0, 0, width, height)
      const outData = ctx.createImageData(width, height)
      colorizeLayer(offData, outData, intensityToRgba)
      ctx.putImageData(outData, 0, 0)
    }
  }, [dots, width, height, colorMode])

  useEffect(() => { draw() }, [draw])

  return (
    <canvas
      ref={canvasRef}
      style={fitToContent
        ? { position: 'absolute', top: 0, left: 0, width: '100%', height: `${height}px`, pointerEvents: 'none', zIndex: 1 }
        : { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }
      }
    />
  )
}

export default function ScreenshotCarousel({
  screenshots,
  activeAnnotation,
  onAnnotationClick,
  activePageIndex,
  layout = 'stacked',
  showHeatmap = true,
}: Props) {
  const [hoveredAnnotation, setHoveredAnnotation] = useState<number | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [vpSize, setVpSize] = useState({ w: 0, h: 0 })
  const shot = screenshots[activePageIndex] ?? screenshots[0]

  useEffect(() => { setHoveredAnnotation(null) }, [activePageIndex])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setVpSize({ w: Math.round(width), h: Math.round(height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  if (!shot) return null

  const highlighted = activeAnnotation !== null ? activeAnnotation : hoveredAnnotation

  const isWide = layout === 'wide'

  const stage = (
    <div className="sc-stage" style={isWide ? { flex: 1, minWidth: 0 } : undefined}>
      <div className="sc-chrome">
        <div className="sc-chrome-dots"><span /><span /><span /></div>
        <div className="sc-chrome-bar">{shot.pageUrl || '—'}</div>
      </div>

      <div className="sc-viewport" ref={viewportRef} style={isWide ? { height: '100%', minHeight: 400 } : undefined}>
        {shot.screenshotUrl ? (
          <img src={shot.screenshotUrl} className="sc-real-screenshot" alt={shot.pageLabel} />
        ) : (
          shot.placeholderSections.map((s, i) => (
            <div key={i} className="sc-section" style={{ top: `${s.top}%`, left: `${s.left}%`, width: `${s.width}%`, height: `${s.height}%`, background: s.color }}>
              <span className="sc-section-label">{s.label}</span>
            </div>
          ))
        )}

        {/* Canvas-based click heatmap — density drives color intensity */}
        {showHeatmap && shot.heatmapDots && shot.heatmapDots.length > 0 && vpSize.w > 0 && (
          <HeatmapCanvas dots={shot.heatmapDots} width={vpSize.w} height={vpSize.h} />
        )}

        {/* Annotation dots */}
        {shot.annotations.map((ann, i) => (
          <div
            key={i}
            className={clsx('sc-ann-group', highlighted === i && 'sc-ann-active')}
            style={{ left: `${ann.x}%`, top: `${ann.y}%`, zIndex: 2 }}
            onMouseEnter={() => setHoveredAnnotation(i)}
            onMouseLeave={() => setHoveredAnnotation(null)}
            onClick={() => onAnnotationClick(i)}
          >
            <div className="sc-ann-dot" style={{ background: TYPE_COLOR[ann.type], animationDelay: `${i * 0.12}s` }}>
              <div className="sc-ann-pulse" style={{ borderColor: TYPE_COLOR[ann.type], animationDelay: `${i * 0.4}s` }} />
            </div>
            <div
              className={clsx('sc-ann-tooltip', `sc-ann-${ann.arrowDir}`, highlighted === i && 'visible')}
              style={{ background: TYPE_BG[ann.type], borderColor: TYPE_COLOR[ann.type] }}
            >
              <span className="sc-ann-type" style={{ color: TYPE_COLOR[ann.type] }}>
                {ann.type === 'error' ? '⚠ Issue' : ann.type === 'warning' ? '⚡ Warning' : 'ℹ Insight'}
              </span>
              {ann.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  const annList = shot.annotations.length > 0 && (
    <div className={isWide ? 'sc-ann-list sc-ann-list--wide' : 'sc-ann-list'}>
      {shot.annotations.map((ann, i) => (
        <div
          key={i}
          className={clsx('sc-ann-row', highlighted === i && 'highlighted')}
          onMouseEnter={() => setHoveredAnnotation(i)}
          onMouseLeave={() => setHoveredAnnotation(null)}
          onClick={() => onAnnotationClick(i)}
        >
          <span className="sc-ann-badge" style={{ background: TYPE_BG[ann.type], color: TYPE_COLOR[ann.type] }}>
            {ann.type === 'error' ? '⚠' : ann.type === 'warning' ? '⚡' : 'ℹ'}
          </span>
          <span className="sc-ann-text">{ann.label}</span>
        </div>
      ))}
    </div>
  )

  if (isWide) {
    return (
      <div className="sc-carousel sc-carousel--wide">
        {stage}
        {annList}
      </div>
    )
  }

  return (
    <div className="sc-carousel">
      {stage}
      {annList}
    </div>
  )
}
