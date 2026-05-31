import { useState, useMemo } from 'react'
import * as d3 from 'd3'
import { SAMPLE_COUNT } from './horizonDensity'

/* ────────────────────────────────────────────────────────────────────────────
 *  LinkedHorizonStrip
 *
 *  A horizon (activity-density) strip docked directly beneath the Flow diagram.
 *  It shares the Sankey's horizontal coordinate system: `marginLeft` matches the
 *  Sankey's left margin and `width` matches the Sankey SVG width, so the strip's
 *  time axis lines up pixel-for-pixel with the hovered/pinned journey's path.
 *
 *  When a journey is active, its density curve is drawn across exactly the
 *  pixel span [xStart, xEnd] that the journey occupies in the Sankey above.
 *  A synced vertical cursor (driven by the Sankey hover, or by hovering the
 *  strip itself) reports the activity percentage at that point in time.
 * ────────────────────────────────────────────────────────────────────────── */

const STRIP_TOTAL_H = 132
const PAD = { top: 26, bottom: 30 }
const TEXT_MUTED = '#94a3b8'

export interface ActiveJourney {
  journeyId: string
  label: string
  color: string
  /* Pixel span (in Sankey inner coords) the journey occupies. */
  xStart: number
  xEnd: number
  /* Activity density curve, SAMPLE_COUNT samples across relative time 0..1. */
  density: number[]
  pinned: boolean
}

interface Props {
  width: number
  marginLeft: number
  active: ActiveJourney | null
  /* Cursor X in Sankey inner coords (mouse position on the hovered flow). */
  cursorX: number | null
}

export default function LinkedHorizonStrip({ width, marginLeft, active, cursorX }: Props) {
  /* Local hover lets the user scrub the strip directly to read activity %. */
  const [localX, setLocalX] = useState<number | null>(null)

  const chartH = STRIP_TOTAL_H - PAD.top - PAD.bottom

  const geom = useMemo(() => {
    if (!active) return null
    const span = Math.max(1, active.xEnd - active.xStart)
    const maxV = Math.max(...active.density, 1e-9)
    const xOf = (i: number) => active.xStart + (i / (SAMPLE_COUNT - 1)) * span
    const yOf = (v: number) => chartH - (v / maxV) * chartH
    const area = (d3.area<number>()
      .x((_, i) => xOf(i)).y0(chartH).y1(v => yOf(v)).curve(d3.curveBasis))(active.density) ?? ''
    const line = (d3.line<number>()
      .x((_, i) => xOf(i)).y(v => yOf(v)).curve(d3.curveBasis))(active.density) ?? ''
    /* Peak time. */
    let peakI = 0, peakV = -Infinity
    active.density.forEach((v, i) => { if (v > peakV) { peakV = v; peakI = i } })
    return { span, area, line, peakX: peakV > 1e-9 ? xOf(peakI) : null }
  }, [active, chartH])

  /* Which cursor wins: a local scrub overrides the Sankey-driven one. */
  const effectiveX = localX ?? cursorX
  const clampedX = active && effectiveX !== null
    ? Math.max(active.xStart, Math.min(active.xEnd, effectiveX))
    : null
  const pctAtCursor = active && clampedX !== null && geom
    ? Math.round(((clampedX - active.xStart) / geom.span) * 100)
    : null

  return (
    <div style={{ flexShrink: 0, borderTop: '1px solid #e2e8f0', background: '#fff' }}>
      <svg width={width} height={STRIP_TOTAL_H} style={{ display: 'block' }}
        onMouseMove={e => {
          const rect = e.currentTarget.getBoundingClientRect()
          setLocalX(e.clientX - rect.left - marginLeft)
        }}
        onMouseLeave={() => setLocalX(null)}
      >
        <g transform={`translate(${marginLeft},${PAD.top})`}>
          {/* Section title */}
          <text x={0} y={-12} fontSize={11} fontWeight={700} fill="#64748b"
            fontFamily="Inter, system-ui, sans-serif"
            style={{ textTransform: 'uppercase', letterSpacing: '0.06em' } as any}>
            Activity over time
          </text>

          {!active ? (
            <text x={0} y={chartH / 2} fontSize={12} fill={TEXT_MUTED}
              fontFamily="Inter, system-ui, sans-serif">
              Hover a flow above to see its activity timeline · click to pin · double-click to inspect
            </text>
          ) : (
            <>
              {/* Strip background, aligned to the journey's span in the Sankey */}
              <rect x={active.xStart} y={0} width={geom!.span} height={chartH}
                fill="#f8fafc" rx={4} />

              {/* Connector bracket tying the strip to the flow above */}
              <path
                d={`M${active.xStart},-4 L${active.xStart},2 M${active.xEnd},-4 L${active.xEnd},2`}
                stroke={active.color} strokeWidth={1.5} strokeOpacity={0.5} fill="none" />
              <line x1={active.xStart} x2={active.xEnd} y1={-4} y2={-4}
                stroke={active.color} strokeWidth={1.5} strokeOpacity={0.5} />

              {/* Density area + line */}
              <path d={geom!.area} fill={active.color} fillOpacity={0.16} />
              <path d={geom!.line} fill="none" stroke={active.color} strokeWidth={2.2} strokeOpacity={0.9} />

              {/* Peak marker */}
              {geom!.peakX !== null && (
                <g transform={`translate(${geom!.peakX},0)`}>
                  <line y1={0} y2={chartH} stroke={active.color} strokeWidth={1}
                    strokeOpacity={0.3} strokeDasharray="2,2" />
                  <text y={-6} textAnchor="middle" fontSize={9} fill={active.color}
                    fontFamily="Inter, system-ui, sans-serif" fontWeight={700}>peak</text>
                </g>
              )}

              {/* Baseline */}
              <line x1={active.xStart} x2={active.xEnd} y1={chartH} y2={chartH}
                stroke="#cbd5e1" strokeWidth={1} />

              {/* Time axis labels (start / mid / end) */}
              {[0, 0.5, 1].map(p => {
                const x = active.xStart + p * geom!.span
                return (
                  <g key={p} transform={`translate(${x},${chartH})`}>
                    <line y1={0} y2={4} stroke="#94a3b8" strokeWidth={1} />
                    <text y={15} textAnchor={p === 0 ? 'start' : p === 1 ? 'end' : 'middle'}
                      fontSize={9} fill="#94a3b8" fontFamily="Inter, system-ui, sans-serif">
                      {p === 0 ? 'start' : p === 1 ? 'end' : `${Math.round(p * 100)}%`}
                    </text>
                  </g>
                )
              })}

              {/* Synced cursor */}
              {clampedX !== null && (
                <g pointerEvents="none">
                  <line x1={clampedX} x2={clampedX} y1={0} y2={chartH}
                    stroke="#1e293b" strokeWidth={1} strokeOpacity={0.35} />
                  <rect x={clampedX - 17} y={chartH + 4} width={34} height={14} rx={2}
                    fill="#1e293b" fillOpacity={0.8} />
                  <text x={clampedX} y={chartH + 14} textAnchor="middle" fontSize={9} fill="#fff"
                    fontFamily="Inter, system-ui, sans-serif">{pctAtCursor}%</text>
                </g>
              )}

              {/* Pinned badge */}
              <text x={geom!.span + active.xStart} y={-12} textAnchor="end"
                fontSize={10} fontWeight={700} fill={active.color}
                fontFamily="Inter, system-ui, sans-serif">
                {active.label}{active.pinned ? ' · pinned' : ''}
              </text>
            </>
          )}
        </g>
      </svg>
    </div>
  )
}
