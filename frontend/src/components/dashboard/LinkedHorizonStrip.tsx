import { useState, useMemo } from 'react'
import * as d3 from 'd3'
import { SAMPLE_COUNT } from './horizonDensity'

/* ────────────────────────────────────────────────────────────────────────────
 *  LinkedHorizonStrip
 *
 *  A horizon (activity-density) strip docked beneath the Flow diagram.
 *  It shares the Sankey's horizontal coordinate system so the time axis lines
 *  up pixel-for-pixel with the hovered/pinned journey's flow above.
 *
 *  Two issues addressed compared to the initial version:
 *
 *  1. Y-axis  — gridlines + rotated "Activity" label + tick values.
 *
 *  2. Milestone markers  — The density curve is mapped linearly (step 0..N maps
 *     to relative time 0..1) but Sankey nodes are placed by milestone depth, not
 *     elapsed time.  To make the strip readable we draw a thin labelled vertical
 *     at each milestone's column x-position so the reader can see exactly which
 *     part of the timeline corresponds to each page transition.
 * ────────────────────────────────────────────────────────────────────────── */

const STRIP_TOTAL_H = 148
const PAD = { top: 28, bottom: 32, left: 36 }   // left pad accommodates y-axis
const TEXT_MUTED = '#94a3b8'
const GRID_COLOR = '#e8edf2'

export interface ActiveJourney {
  journeyId: string
  label: string
  color: string
  xStart: number
  xEnd: number
  density: number[]
  /* Ordered milestone positions (Sankey inner coords) for the journey. */
  milestones: Array<{ x: number; label: string }>
  pinned: boolean
}

interface Props {
  width: number
  marginLeft: number
  active: ActiveJourney | null
  cursorX: number | null
}

/* Shorten a milestone label so it fits under the marker without overlap. */
function shortenLabel(s: string, maxLen = 12): string {
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen - 1) + '…'
}

export default function LinkedHorizonStrip({ width, marginLeft, active, cursorX }: Props) {
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
    let peakI = 0, peakV = -Infinity
    active.density.forEach((v, i) => { if (v > peakV) { peakV = v; peakI = i } })
    return { span, maxV, area, line, peakX: peakV > 1e-9 ? xOf(peakI) : null }
  }, [active, chartH])

  const effectiveX = localX ?? cursorX
  const clampedX = active && effectiveX !== null
    ? Math.max(active.xStart, Math.min(active.xEnd, effectiveX))
    : null
  const pctAtCursor = active && clampedX !== null && geom
    ? Math.round(((clampedX - active.xStart) / geom.span) * 100)
    : null

  /* Activity value at cursor, normalised 0..100 */
  const activityAtCursor = active && clampedX !== null && geom
    ? (() => {
        const relT = (clampedX - active.xStart) / geom.span
        const idx = Math.round(relT * (SAMPLE_COUNT - 1))
        const clamped = Math.max(0, Math.min(SAMPLE_COUNT - 1, idx))
        return Math.round((active.density[clamped] / geom.maxV) * 100)
      })()
    : null

  /* De-duplicate milestone markers that are too close together (<8 px) to
   * avoid label collisions. Keep the first occurrence of each x bucket. */
  const dedupedMilestones = useMemo(() => {
    if (!active) return []
    const result: Array<{ x: number; label: string }> = []
    for (const m of active.milestones) {
      if (!result.some(r => Math.abs(r.x - m.x) < 8)) result.push(m)
    }
    return result
  }, [active])

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
          <text x={0} y={-14} fontSize={11} fontWeight={700} fill="#64748b"
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
              {/* ── Strip background ────────────────────────────────────── */}
              <rect x={active.xStart} y={0} width={geom!.span} height={chartH}
                fill="#f8fafc" rx={3} />

              {/* ── Y-axis: gridlines + label ────────────────────────────
               *  Three horizontal bands: 0 (baseline), 50%, 100% of max.
               *  Label "Activity" runs vertically to the left of the strip. */}
              {[0, 0.5, 1].map(p => (
                <line key={p}
                  x1={active.xStart} x2={active.xEnd}
                  y1={chartH * (1 - p)} y2={chartH * (1 - p)}
                  stroke={p === 0 ? '#cbd5e1' : GRID_COLOR}
                  strokeWidth={p === 0 ? 1 : 1}
                  strokeDasharray={p === 0 ? undefined : '3,3'}
                />
              ))}
              {/* Y-axis tick labels at left edge of strip */}
              {[0, 0.5, 1].map(p => (
                <text key={p}
                  x={active.xStart - 5}
                  y={chartH * (1 - p) + (p === 0 ? 0 : 4)}
                  textAnchor="end" fontSize={8} fill={TEXT_MUTED}
                  fontFamily="Inter, system-ui, sans-serif">
                  {p === 0 ? '' : p === 0.5 ? '50%' : '100%'}
                </text>
              ))}
              {/* Rotated "Activity" label */}
              <text
                transform={`translate(${active.xStart - 20},${chartH / 2}) rotate(-90)`}
                textAnchor="middle" fontSize={8} fill={TEXT_MUTED}
                fontFamily="Inter, system-ui, sans-serif"
                style={{ textTransform: 'uppercase', letterSpacing: '0.05em' } as any}>
                Activity
              </text>

              {/* ── Connector bracket ────────────────────────────────────── */}
              <path
                d={`M${active.xStart},-5 L${active.xStart},2 M${active.xEnd},-5 L${active.xEnd},2`}
                stroke={active.color} strokeWidth={1.5} strokeOpacity={0.5} fill="none" />
              <line x1={active.xStart} x2={active.xEnd} y1={-5} y2={-5}
                stroke={active.color} strokeWidth={1.5} strokeOpacity={0.5} />

              {/* ── Density area + line ──────────────────────────────────── */}
              <path d={geom!.area} fill={active.color} fillOpacity={0.16} />
              <path d={geom!.line} fill="none" stroke={active.color} strokeWidth={2.2} strokeOpacity={0.9} />

              {/* ── Peak marker ──────────────────────────────────────────── */}
              {geom!.peakX !== null && (
                <g transform={`translate(${geom!.peakX},0)`} pointerEvents="none">
                  <line y1={0} y2={chartH} stroke={active.color} strokeWidth={1}
                    strokeOpacity={0.3} strokeDasharray="2,2" />
                  <text y={-7} textAnchor="middle" fontSize={9} fill={active.color}
                    fontFamily="Inter, system-ui, sans-serif" fontWeight={700}>peak</text>
                </g>
              )}

              {/* ── Milestone markers ────────────────────────────────────────
               *  Each marker is a thin vertical at a Sankey node's column
               *  x-center, with the milestone name below the baseline.
               *  This lets the reader relate the density shape to the actual
               *  page transitions — and explains low-activity gaps. */}
              {dedupedMilestones.map((m, i) => (
                <g key={i} transform={`translate(${m.x},0)`} pointerEvents="none">
                  <line y1={0} y2={chartH}
                    stroke="#94a3b8" strokeWidth={1} strokeOpacity={0.35} strokeDasharray="2,3" />
                  {/* Small dot on baseline */}
                  <circle cx={0} cy={chartH} r={2.5} fill="#94a3b8" fillOpacity={0.6} />
                  {/* Label below baseline */}
                  <text y={chartH + 12} textAnchor="middle" fontSize={8} fill="#64748b"
                    fontFamily="Inter, system-ui, sans-serif">
                    {shortenLabel(m.label)}
                  </text>
                </g>
              ))}

              {/* ── Synced cursor ────────────────────────────────────────── */}
              {clampedX !== null && (
                <g pointerEvents="none">
                  <line x1={clampedX} x2={clampedX} y1={0} y2={chartH}
                    stroke="#1e293b" strokeWidth={1} strokeOpacity={0.4} />
                  {/* Tooltip bubble: shows journey progress % + activity % */}
                  <rect x={clampedX - 20} y={chartH + 2} width={40} height={26} rx={3}
                    fill="#1e293b" fillOpacity={0.85} />
                  <text x={clampedX} y={chartH + 12} textAnchor="middle" fontSize={8.5} fill="#fff"
                    fontFamily="Inter, system-ui, sans-serif" fontWeight={600}>
                    {pctAtCursor}% time
                  </text>
                  <text x={clampedX} y={chartH + 23} textAnchor="middle" fontSize={8} fill="#cbd5e1"
                    fontFamily="Inter, system-ui, sans-serif">
                    {activityAtCursor}% act.
                  </text>
                </g>
              )}

              {/* ── Journey label / pinned badge ─────────────────────────── */}
              <text x={active.xEnd} y={-14} textAnchor="end"
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
