import { useState, useMemo } from 'react'
import * as d3 from 'd3'

/* ────────────────────────────────────────────────────────────────────────────
 *  LinkedHorizonStrip
 *
 *  A horizon strip docked beneath the Flow diagram. It shares the Sankey's
 *  horizontal coordinate system so the time axis lines up pixel-for-pixel with
 *  the hovered/pinned journey's flow above.
 *
 *  Y-axis: raw COUNT of actions per time-bin (integer scale), not a percentage —
 *  this directly answers "how many actions happened around this point in time".
 *  Axis labels are drawn INSIDE the plot area so they never clip at the edge.
 *
 *  Milestone markers (labelled verticals at each Sankey column x) explain
 *  low-activity gaps by relating the curve to the actual page transitions.
 * ────────────────────────────────────────────────────────────────────────── */

const STRIP_TOTAL_H = 150
const PAD = { top: 28, bottom: 34 }
const TEXT_MUTED = '#94a3b8'
const GRID_COLOR = '#e8edf2'
const BIN_PX = 22   // target pixel width per action-count bin

export interface ActiveJourney {
  journeyId: string
  label: string
  color: string
  xStart: number
  xEnd: number
  /* Relative-time (0..1) of every countable action in the journey. */
  actionTimes: number[]
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

function shortenLabel(s: string, maxLen = 12): string {
  return s.length <= maxLen ? s : s.slice(0, maxLen - 1) + '…'
}

export default function LinkedHorizonStrip({ width, marginLeft, active, cursorX }: Props) {
  const [localX, setLocalX] = useState<number | null>(null)

  const chartH = STRIP_TOTAL_H - PAD.top - PAD.bottom

  const geom = useMemo(() => {
    if (!active) return null
    const span = Math.max(1, active.xEnd - active.xStart)
    /* Bin the actions over time. Bin count derives from pixel width so bars are
     * a consistent size regardless of how many actions the journey had. */
    const nBins = Math.max(4, Math.min(40, Math.round(span / BIN_PX)))
    const counts = new Array(nBins).fill(0) as number[]
    for (const t of active.actionTimes) {
      const b = Math.min(nBins - 1, Math.max(0, Math.floor(t * nBins)))
      counts[b]++
    }
    const maxCount = Math.max(1, ...counts)
    /* Sample the step curve at bin centers; map across the pixel span. */
    const xOf = (i: number) => active.xStart + ((i + 0.5) / nBins) * span
    const yOf = (v: number) => chartH - (v / maxCount) * chartH
    const area = (d3.area<number>()
      .x((_, i) => xOf(i)).y0(chartH).y1(v => yOf(v)).curve(d3.curveMonotoneX))(counts) ?? ''
    const line = (d3.line<number>()
      .x((_, i) => xOf(i)).y(v => yOf(v)).curve(d3.curveMonotoneX))(counts) ?? ''
    let peakI = 0, peakV = -Infinity
    counts.forEach((v, i) => { if (v > peakV) { peakV = v; peakI = i } })
    const total = active.actionTimes.length
    return { span, nBins, counts, maxCount, total, area, line, xOf, yOf, peakX: peakV > 0 ? xOf(peakI) : null }
  }, [active, chartH])

  const effectiveX = localX ?? cursorX
  const clampedX = active && effectiveX !== null
    ? Math.max(active.xStart, Math.min(active.xEnd, effectiveX))
    : null
  const pctAtCursor = active && clampedX !== null && geom
    ? Math.round(((clampedX - active.xStart) / geom.span) * 100)
    : null
  /* Action count in the bin under the cursor. */
  const countAtCursor = active && clampedX !== null && geom
    ? geom.counts[Math.min(geom.nBins - 1, Math.max(0,
        Math.floor(((clampedX - active.xStart) / geom.span) * geom.nBins)))]
    : null

  const dedupedMilestones = useMemo(() => {
    if (!active) return []
    const result: Array<{ x: number; label: string }> = []
    for (const m of active.milestones) {
      if (!result.some(r => Math.abs(r.x - m.x) < 8)) result.push(m)
    }
    return result
  }, [active])

  /* Integer y-axis ticks: every count up to max when small, else 0/mid/max. */
  const yTicks = useMemo(() => {
    if (!geom) return [] as number[]
    const m = geom.maxCount
    if (m <= 4) return d3.range(0, m + 1)
    return [0, Math.round(m / 2), m]
  }, [geom])

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
            Actions over time
          </text>

          {!active || !geom ? (
            <text x={0} y={chartH / 2} fontSize={12} fill={TEXT_MUTED}
              fontFamily="Inter, system-ui, sans-serif">
              Hover a flow above to see its activity timeline · click to pin · double-click to inspect
            </text>
          ) : (
            <>
              {/* Strip background */}
              <rect x={active.xStart} y={0} width={geom.span} height={chartH}
                fill="#f8fafc" rx={3} />

              {/* ── Y-axis: integer gridlines + labels drawn INSIDE the plot ── */}
              {yTicks.map(t => {
                const y = geom.yOf(t)
                return (
                  <g key={t}>
                    <line x1={active.xStart} x2={active.xEnd} y1={y} y2={y}
                      stroke={t === 0 ? '#cbd5e1' : GRID_COLOR} strokeWidth={1}
                      strokeDasharray={t === 0 ? undefined : '3,3'} />
                    {/* Label sits just inside the left edge with a white halo. */}
                    <text x={active.xStart + 3} y={y - 2}
                      fontSize={8.5} fill={TEXT_MUTED} fontWeight={600}
                      fontFamily="Inter, system-ui, sans-serif"
                      paintOrder="stroke" stroke="#f8fafc" strokeWidth={3}>
                      {t}
                    </text>
                  </g>
                )
              })}
              {/* Y-axis caption */}
              <text x={active.xStart + 3} y={-3}
                fontSize={8} fill={TEXT_MUTED}
                fontFamily="Inter, system-ui, sans-serif"
                style={{ textTransform: 'uppercase', letterSpacing: '0.04em' } as any}>
                # actions
              </text>

              {/* Connector bracket tying the strip to the flow above */}
              <path
                d={`M${active.xStart},-5 L${active.xStart},2 M${active.xEnd},-5 L${active.xEnd},2`}
                stroke={active.color} strokeWidth={1.5} strokeOpacity={0.5} fill="none" />
              <line x1={active.xStart} x2={active.xEnd} y1={-5} y2={-5}
                stroke={active.color} strokeWidth={1.5} strokeOpacity={0.5} />

              {/* Action-count area + line */}
              <path d={geom.area} fill={active.color} fillOpacity={0.16} />
              <path d={geom.line} fill="none" stroke={active.color} strokeWidth={2.2} strokeOpacity={0.9} />

              {/* Peak marker */}
              {geom.peakX !== null && geom.maxCount > 1 && (
                <g transform={`translate(${geom.peakX},0)`} pointerEvents="none">
                  <line y1={0} y2={chartH} stroke={active.color} strokeWidth={1}
                    strokeOpacity={0.3} strokeDasharray="2,2" />
                  <text y={-7} textAnchor="middle" fontSize={9} fill={active.color}
                    fontFamily="Inter, system-ui, sans-serif" fontWeight={700}>
                    peak {geom.maxCount}
                  </text>
                </g>
              )}

              {/* Milestone markers */}
              {dedupedMilestones.map((m, i) => (
                <g key={i} transform={`translate(${m.x},0)`} pointerEvents="none">
                  <line y1={0} y2={chartH}
                    stroke="#94a3b8" strokeWidth={1} strokeOpacity={0.35} strokeDasharray="2,3" />
                  <circle cx={0} cy={chartH} r={2.5} fill="#94a3b8" fillOpacity={0.6} />
                  <text y={chartH + 13} textAnchor="middle" fontSize={8} fill="#64748b"
                    fontFamily="Inter, system-ui, sans-serif">
                    {shortenLabel(m.label)}
                  </text>
                </g>
              ))}

              {/* Synced cursor */}
              {clampedX !== null && (
                <g pointerEvents="none">
                  <line x1={clampedX} x2={clampedX} y1={0} y2={chartH}
                    stroke="#1e293b" strokeWidth={1} strokeOpacity={0.4} />
                  <rect x={clampedX - 22} y={chartH + 1} width={44} height={26} rx={3}
                    fill="#1e293b" fillOpacity={0.85} />
                  <text x={clampedX} y={chartH + 11} textAnchor="middle" fontSize={8.5} fill="#fff"
                    fontFamily="Inter, system-ui, sans-serif" fontWeight={600}>
                    {countAtCursor} action{countAtCursor === 1 ? '' : 's'}
                  </text>
                  <text x={clampedX} y={chartH + 22} textAnchor="middle" fontSize={8} fill="#cbd5e1"
                    fontFamily="Inter, system-ui, sans-serif">
                    @ {pctAtCursor}%
                  </text>
                </g>
              )}

              {/* Journey label / pinned badge + total action count */}
              <text x={active.xEnd} y={-14} textAnchor="end"
                fontSize={10} fontWeight={700} fill={active.color}
                fontFamily="Inter, system-ui, sans-serif">
                {active.label} · {geom.total} actions{active.pinned ? ' · pinned' : ''}
              </text>
            </>
          )}
        </g>
      </svg>
    </div>
  )
}
