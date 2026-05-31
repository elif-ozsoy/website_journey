import { useState, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import * as d3 from 'd3'
import type { ActionSample } from './horizonDensity'

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
const POPOVER_W = 280

const STEP_ACTION_COLORS: Record<string, string> = {
  click_element:   '#185FA5',
  input_text:      '#059669',
  go_to_url:       '#d97706',
  scroll:          '#0891b2',
  go_back:         '#f43f5e',
  extract_content: '#7c3aed',
  done:            '#16a34a',
}

export interface ActiveJourney {
  journeyId: string
  label: string
  color: string
  xStart: number
  xEnd: number
  /* Every countable action in the journey, flattened for display. */
  actions: ActionSample[]
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
  /* Screen-space rect of the SVG, so the action popover can be portalled ABOVE
   * the strip (over the flow diagram) and never cover the curve. */
  const [svgRect, setSvgRect] = useState<{ left: number; top: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const chartH = STRIP_TOTAL_H - PAD.top - PAD.bottom

  const geom = useMemo(() => {
    if (!active) return null
    /* Anchor the curve's time axis to the first/last MILESTONE CENTERS rather
     * than the node edges. The milestone marker lines are drawn at node centers,
     * so the start spike (relT 0) and end spike (relT 1) then line up exactly
     * with the start / terminal milestone lines. Falls back to the node-edge
     * extents when no milestones are available. */
    const ms = active.milestones
    const x0 = ms.length ? ms[0].x : active.xStart
    const x1 = ms.length ? ms[ms.length - 1].x : active.xEnd
    const span = Math.max(1, x1 - x0)
    /* Bin the actions over time. Bin count derives from pixel width so bars are
     * a consistent size regardless of how many actions the journey had. */
    const nBins = Math.max(4, Math.min(40, Math.round(span / BIN_PX)))
    const counts = new Array(nBins).fill(0) as number[]
    /* Keep the actions that fall in each bin so we can list them on hover. */
    const binActions: ActionSample[][] = Array.from({ length: nBins }, () => [])
    for (const a of active.actions) {
      const b = Math.min(nBins - 1, Math.max(0, Math.floor(a.relT * nBins)))
      counts[b]++
      binActions[b].push(a)
    }
    const maxCount = Math.max(1, ...counts)
    /* Map bins to evenly-spaced points anchored at both endpoints. */
    const xOf = (i: number) => x0 + (i / (nBins - 1)) * span
    const yOf = (v: number) => chartH - (v / maxCount) * chartH
    const area = (d3.area<number>()
      .x((_, i) => xOf(i)).y0(chartH).y1(v => yOf(v)).curve(d3.curveMonotoneX))(counts) ?? ''
    const line = (d3.line<number>()
      .x((_, i) => xOf(i)).y(v => yOf(v)).curve(d3.curveMonotoneX))(counts) ?? ''
    let peakI = 0, peakV = -Infinity
    counts.forEach((v, i) => { if (v > peakV) { peakV = v; peakI = i } })
    const total = active.actions.length
    return { x0, x1, span, nBins, counts, binActions, maxCount, total, area, line, xOf, yOf, peakX: peakV > 0 ? xOf(peakI) : null }
  }, [active, chartH])

  const effectiveX = localX ?? cursorX
  const clampedX = active && geom && effectiveX !== null
    ? Math.max(geom.x0, Math.min(geom.x1, effectiveX))
    : null
  const pctAtCursor = clampedX !== null && geom
    ? Math.round(((clampedX - geom.x0) / geom.span) * 100)
    : null
  /* Index of the bin under the cursor, plus its count and actions. Uses the
   * same edge-anchored mapping as the curve (round to nearest plotted point)
   * so the popover matches the spike the cursor is over. */
  const binAtCursor = clampedX !== null && geom
    ? Math.min(geom.nBins - 1, Math.max(0,
        Math.round(((clampedX - geom.x0) / geom.span) * (geom.nBins - 1))))
    : null
  const countAtCursor = binAtCursor !== null && geom ? geom.counts[binAtCursor] : null
  const actionsAtCursor = binAtCursor !== null && geom ? geom.binActions[binAtCursor] : []

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

  /* Pixel x of the cursor within the wrapping div (svg coords + marginLeft). */
  const cursorPx = clampedX !== null ? marginLeft + clampedX : null

  /* Anchor the popover in screen coordinates so it can be portalled to <body>
   * and float ABOVE the strip — keeping the curve fully visible. Falls back to
   * the live SVG rect when the cursor is driven by the Sankey hover above. */
  const anchor = svgRect ?? (svgRef.current
    ? (() => { const r = svgRef.current!.getBoundingClientRect(); return { left: r.left, top: r.top } })()
    : null)
  const popoverScreenLeft = anchor && cursorPx !== null
    ? Math.max(8, Math.min(window.innerWidth - POPOVER_W - 8, anchor.left + cursorPx - POPOVER_W / 2))
    : 0
  const showPopover = !!active && cursorPx !== null && actionsAtCursor.length > 0 && !!anchor

  return (
    <div style={{ flexShrink: 0, borderTop: '1px solid #e2e8f0', background: '#fff', position: 'relative' }}>
      {/* Action popover — lists the actions in the time-bin under the cursor,
       *  mirroring the standalone Horizon Graph's slice detail. Portalled to
       *  <body> and floated above the strip so it never covers the curve. */}
      {showPopover && createPortal(
        <div style={{
          position: 'fixed', left: popoverScreenLeft, top: anchor!.top - 10,
          transform: 'translateY(-100%)', width: POPOVER_W,
          background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6,
          boxShadow: '0 8px 28px rgba(15,23,42,0.22)', zIndex: 1000,
          fontFamily: 'Inter, system-ui, sans-serif', overflow: 'hidden',
          pointerEvents: 'none',
        }}>
          <div style={{
            padding: '6px 10px', borderBottom: '1px solid #f1f5f9',
            fontSize: '0.68rem', fontWeight: 700, color: '#334155',
            display: 'flex', justifyContent: 'space-between', gap: 8,
          }}>
            <span>{actionsAtCursor.length} action{actionsAtCursor.length === 1 ? '' : 's'} @ {pctAtCursor}%</span>
            <span style={{ color: TEXT_MUTED, fontWeight: 500 }}>{active!.label}</span>
          </div>
          <div style={{ maxHeight: 150, overflowY: 'auto' }}>
            {actionsAtCursor.slice(0, 6).map((a, i) => {
              const ac = STEP_ACTION_COLORS[a.actionType] ?? '#475569'
              return (
                <div key={i} style={{
                  padding: '6px 10px', borderBottom: '1px solid #f8fafc',
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                }}>
                  <span style={{
                    fontSize: '0.6rem', fontWeight: 700, color: ac, background: `${ac}18`,
                    padding: '2px 5px', borderRadius: 3, textTransform: 'uppercase',
                    letterSpacing: '0.02em', flexShrink: 0, minWidth: 70, textAlign: 'center',
                  }}>{a.actionType.replace(/_/g, ' ')}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.7rem', color: '#334155', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.path}
                    </div>
                    {a.detail && (
                      <div style={{ fontSize: '0.66rem', color: TEXT_MUTED, marginTop: 1, lineHeight: 1.35 }}>
                        {a.detail.slice(0, 90)}{a.detail.length > 90 ? '…' : ''}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
            {actionsAtCursor.length > 6 && (
              <div style={{ padding: '5px 10px', fontSize: '0.64rem', color: TEXT_MUTED, fontStyle: 'italic' }}>
                +{actionsAtCursor.length - 6} more…
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}

      <svg ref={svgRef} width={width} height={STRIP_TOTAL_H} style={{ display: 'block' }}
        onMouseMove={e => {
          const rect = e.currentTarget.getBoundingClientRect()
          setLocalX(e.clientX - rect.left - marginLeft)
          setSvgRect({ left: rect.left, top: rect.top })
        }}
        onMouseLeave={() => { setLocalX(null); setSvgRect(null) }}
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
              <rect x={geom.x0} y={0} width={geom.span} height={chartH}
                fill="#f8fafc" rx={3} />

              {/* ── Y-axis: integer gridlines + labels drawn INSIDE the plot ── */}
              {yTicks.map(t => {
                const y = geom.yOf(t)
                return (
                  <g key={t}>
                    <line x1={geom.x0} x2={geom.x1} y1={y} y2={y}
                      stroke={t === 0 ? '#cbd5e1' : GRID_COLOR} strokeWidth={1}
                      strokeDasharray={t === 0 ? undefined : '3,3'} />
                    {/* Label sits just inside the left edge with a white halo. */}
                    <text x={geom.x0 + 3} y={y - 2}
                      fontSize={8.5} fill={TEXT_MUTED} fontWeight={600}
                      fontFamily="Inter, system-ui, sans-serif"
                      paintOrder="stroke" stroke="#f8fafc" strokeWidth={3}>
                      {t}
                    </text>
                  </g>
                )
              })}
              {/* Y-axis caption */}
              <text x={geom.x0 + 3} y={-3}
                fontSize={8} fill={TEXT_MUTED}
                fontFamily="Inter, system-ui, sans-serif"
                style={{ textTransform: 'uppercase', letterSpacing: '0.04em' } as any}>
                # actions
              </text>

              {/* Connector bracket tying the strip to the flow above */}
              <path
                d={`M${geom.x0},-5 L${geom.x0},2 M${geom.x1},-5 L${geom.x1},2`}
                stroke={active.color} strokeWidth={1.5} strokeOpacity={0.5} fill="none" />
              <line x1={geom.x0} x2={geom.x1} y1={-5} y2={-5}
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
              <text x={geom.x1} y={-14} textAnchor="end"
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
