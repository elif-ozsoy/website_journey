import { useState, useMemo, useRef, useEffect } from 'react'
import * as d3 from 'd3'
import type { AgentStep } from '../agent/agentTypes'
import type { CompareHighlight } from '../../lib/api'
import {
  SAMPLE_COUNT, buildJourneySamples,
  type JourneySample,
} from './horizonDensity'

interface Props {
  agentJourneys: AgentStep[][]
  humanJourneys?: AgentStep[][]
  agentLabels?: string[]
  humanLabels?: string[]
  highlight?: CompareHighlight
}

const AGENT_COLOR = '#32494B'
const HUMAN_COLOR = '#881342'

/* ── Overlay chart constants ── */
const CHART_PAD = { top: 22, right: 20, bottom: 34, left: 16 }
const CHART_H   = 190   // total SVG height

const TEXT_MUTED = '#94a3b8'
const TEXT_LABEL = '#475569'
const BORDER     = '#e2e8f0'

/* ── Step helpers ──
 * isCountableAction / buildJourneySamples / gaussianKDE / JourneySample live in
 * ./horizonDensity so the linked Flow + Horizon view shares the exact same math. */

/* Build a raw action-count histogram over `nBins` evenly-spaced time bins.
 * Each bin counts how many countable actions from these journeys fell in it.
 * Returns average counts per journey so the axis is "actions per journey". */
function avgCountHistogram(journeySteps: AgentStep[][], nBins: number): number[] {
  if (journeySteps.length === 0) return new Array(nBins).fill(0)
  const totals = new Array(nBins).fill(0) as number[]
  for (const steps of journeySteps) {
    const samples = buildJourneySamples(steps)
    for (const { relT } of samples) {
      const bin = Math.min(nBins - 1, Math.floor(relT * nBins))
      totals[bin]++
    }
  }
  return totals.map(v => v / journeySteps.length)
}

interface Journey {
  id: string
  kind: 'agent' | 'human'
  index: number
  label: string
  steps: AgentStep[]
  samples: JourneySample[]
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Overlay density chart — the primary view
 * ────────────────────────────────────────────────────────────────────────── */

const HIST_BINS = SAMPLE_COUNT

function OverlayDensityChart({
  agentCounts, humanCounts, agentCount, humanCount, width,
}: {
  agentCounts: number[]
  humanCounts: number[]
  agentCount: number
  humanCount: number
  width: number
}) {
  const [hoverX, setHoverX] = useState<number | null>(null)

  const Y_AXIS_W = 32
  const chartW = Math.max(80, width - CHART_PAD.left - CHART_PAD.right - Y_AXIS_W)
  const chartH = CHART_H - CHART_PAD.top - CHART_PAD.bottom

  const hasAgent = agentCounts.some(v => v > 1e-9)
  const hasHuman = humanCounts.some(v => v > 1e-9)

  const rawMax = Math.max(
    hasAgent ? Math.max(...agentCounts) : 0,
    hasHuman ? Math.max(...humanCounts) : 0,
    0,
  )
  /* Normalize so the busiest time slice reads 100%. */
  const niceMax = rawMax <= 0 ? 1 : rawMax

  const xOf = (i: number) => (i / (HIST_BINS - 1)) * chartW
  const yOf = (v: number) => chartH - (v / niceMax) * chartH

  const makeArea = (counts: number[]) =>
    (d3.area<number>().x((_, i) => xOf(i)).y0(chartH).y1(v => yOf(v)).curve(d3.curveBasis))(counts) ?? ''

  const makeLine = (counts: number[]) =>
    (d3.line<number>().x((_, i) => xOf(i)).y(v => yOf(v)).curve(d3.curveBasis))(counts) ?? ''

  /* Peak positions */
  const peakOf = (counts: number[]) => {
    let maxV = -Infinity, maxI = 0
    for (let i = 0; i < counts.length; i++) if (counts[i] > maxV) { maxV = counts[i]; maxI = i }
    return maxV > 1e-9 ? xOf(maxI) : null
  }
  const agentPeakX = hasAgent ? peakOf(agentCounts) : null
  const humanPeakX = hasHuman ? peakOf(humanCounts) : null

  /* Percentage y-axis ticks (fraction of the busiest slice). */
  const yTicks = [0, 0.25, 0.5, 0.75, 1]

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      {/* Legend */}
      <div style={{
        position: 'absolute',
        top: CHART_PAD.top + 8,
        right: CHART_PAD.right + 10,
        display: 'flex', gap: 14, alignItems: 'center',
        pointerEvents: 'none', zIndex: 1,
      }}>
        {hasAgent && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 14, height: 3, background: AGENT_COLOR, borderRadius: 2, display: 'inline-block' }} />
            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: AGENT_COLOR, fontFamily: 'Inter, system-ui, sans-serif' }}>
              AI ({agentCount})
            </span>
          </div>
        )}
        {hasHuman && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 14, height: 3, background: HUMAN_COLOR, borderRadius: 2, display: 'inline-block' }} />
            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: HUMAN_COLOR, fontFamily: 'Inter, system-ui, sans-serif' }}>
              Human ({humanCount})
            </span>
          </div>
        )}
      </div>

      <svg width={width} height={CHART_H} style={{ display: 'block' }}>
        <g transform={`translate(${CHART_PAD.left + Y_AXIS_W},${CHART_PAD.top})`}>

          {/* Chart background */}
          <rect x={0} y={0} width={chartW} height={chartH} fill="#f8fafc" rx={4} />

          {/* Y-axis gridlines + tick labels */}
          {yTicks.map(f => {
            const py = chartH - f * chartH
            return (
              <g key={f}>
                <line x1={0} x2={chartW} y1={py} y2={py} stroke="#e2e8f0" strokeWidth={1} />
                <text x={-6} y={py} textAnchor="end" dominantBaseline="middle"
                  fontSize={9} fill="#94a3b8" fontFamily="Inter, system-ui, sans-serif">
                  {Math.round(f * 100)}%
                </text>
              </g>
            )
          })}

          {/* Vertical guides */}
          {[0.25, 0.5, 0.75].map(p => (
            <line key={p}
              x1={p * chartW} x2={p * chartW} y1={0} y2={chartH}
              stroke="#e8edf2" strokeWidth={1} strokeDasharray="3,3"
            />
          ))}

          {/* Human area + line */}
          {hasHuman && (
            <>
              <path d={makeArea(humanCounts)} fill={HUMAN_COLOR} fillOpacity={0.13} />
              <path d={makeLine(humanCounts)} fill="none" stroke={HUMAN_COLOR} strokeWidth={2.2} strokeOpacity={0.85} />
            </>
          )}

          {/* Agent area + line */}
          {hasAgent && (
            <>
              <path d={makeArea(agentCounts)} fill={AGENT_COLOR} fillOpacity={0.13} />
              <path d={makeLine(agentCounts)} fill="none" stroke={AGENT_COLOR} strokeWidth={2.2} strokeOpacity={0.85} />
            </>
          )}

          {/* Peak markers */}
          {agentPeakX !== null && (
            <g transform={`translate(${agentPeakX},0)`}>
              <line y1={0} y2={chartH} stroke={AGENT_COLOR} strokeWidth={1} strokeOpacity={0.3} strokeDasharray="2,2" />
              <text y={-6} textAnchor="middle" fontSize={9} fill={AGENT_COLOR}
                fontFamily="Inter, system-ui, sans-serif" fontWeight={700}>
                peak {Math.round((agentPeakX / chartW) * 100)}%
              </text>
            </g>
          )}
          {humanPeakX !== null && agentPeakX !== humanPeakX && (
            <g transform={`translate(${humanPeakX},0)`}>
              <line y1={0} y2={chartH} stroke={HUMAN_COLOR} strokeWidth={1} strokeOpacity={0.3} strokeDasharray="2,2" />
              <text y={-6} textAnchor="middle" fontSize={9} fill={HUMAN_COLOR}
                fontFamily="Inter, system-ui, sans-serif" fontWeight={700}>
                peak {Math.round((humanPeakX / chartW) * 100)}%
              </text>
            </g>
          )}

          {/* X-axis baseline */}
          <line x1={0} x2={chartW} y1={chartH} y2={chartH} stroke="#cbd5e1" strokeWidth={1} />

          {/* X-axis ticks + labels */}
          {[0, 0.25, 0.5, 0.75, 1].map(p => (
            <g key={p} transform={`translate(${p * chartW},${chartH})`}>
              <line y1={0} y2={5} stroke="#94a3b8" strokeWidth={1} />
              <text y={16}
                textAnchor={p === 0 ? 'start' : p === 1 ? 'end' : 'middle'}
                fontSize={10} fill="#94a3b8"
                fontFamily="Inter, system-ui, sans-serif">
                {Math.round(p * 100)}%
              </text>
            </g>
          ))}

          {/* X-axis label */}
          <text x={chartW / 2} y={chartH + 30}
            textAnchor="middle" fontSize={9} fill="#94a3b8"
            fontFamily="Inter, system-ui, sans-serif"
            style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Journey progress →
          </text>

          {/* Y-axis label (rotated) */}
          <text
            transform={`translate(${-Y_AXIS_W + 4},${chartH / 2}) rotate(-90)`}
            textAnchor="middle" fontSize={9} fill="#94a3b8"
            fontFamily="Inter, system-ui, sans-serif"
            style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Activity
          </text>

          {/* Hover cursor */}
          {hoverX !== null && (
            <g pointerEvents="none">
              <line x1={hoverX} x2={hoverX} y1={0} y2={chartH}
                stroke="#1e293b" strokeWidth={1} strokeOpacity={0.2} />
              <rect x={hoverX - 16} y={chartH + 5} width={32} height={14} rx={2} fill="#1e293b" fillOpacity={0.7} />
              <text x={hoverX} y={chartH + 15}
                textAnchor="middle" fontSize={9} fill="#fff"
                fontFamily="Inter, system-ui, sans-serif">
                {Math.round((hoverX / chartW) * 100)}%
              </text>
            </g>
          )}

          {/* Mouse tracker */}
          <rect x={0} y={0} width={chartW} height={chartH} fill="transparent"
            onMouseMove={e => {
              const rect = e.currentTarget.getBoundingClientRect()
              setHoverX(Math.max(0, Math.min(chartW, e.clientX - rect.left)))
            }}
            onMouseLeave={() => setHoverX(null)}
          />
        </g>
      </svg>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Main component
 * ────────────────────────────────────────────────────────────────────────── */

export default function HorizonGraph({
  agentJourneys, humanJourneys = [], agentLabels, humanLabels, highlight,
}: Props) {
  type KindFilter = 'both' | 'agent' | 'human'
  const [kindFilter, setKindFilter] = useState<KindFilter>('both')

  const containerRef = useRef<HTMLDivElement>(null)
  const [containerW, setContainerW] = useState(800)
  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setContainerW(el.clientWidth))
    ro.observe(el)
    setContainerW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const journeys = useMemo<Journey[]>(() => {
    const out: Journey[] = []
    const make = (steps: AgentStep[], kind: 'agent' | 'human', i: number, label?: string) => {
      const samples = buildJourneySamples(steps)
      out.push({
        id: `${kind}-${i}`, kind, index: i,
        label: label ?? (kind === 'agent' ? `AI Run #${i + 1}` : `User #${i + 1}`),
        steps, samples,
      })
    }
    agentJourneys.forEach((s, i) => make(s, 'agent', i, agentLabels?.[i]))
    humanJourneys.forEach((s, i) => make(s, 'human', i, humanLabels?.[i]))
    return out
  }, [agentJourneys, humanJourneys, agentLabels, humanLabels])

  /* Count histograms for overlay chart */
  const agentCountHist = useMemo(
    () => avgCountHistogram(
      (kindFilter === 'human' ? [] : journeys.filter(j => j.kind === 'agent')).map(j => j.steps),
      HIST_BINS,
    ),
    [journeys, kindFilter],
  )
  const humanCountHist = useMemo(
    () => avgCountHistogram(
      (kindFilter === 'agent' ? [] : journeys.filter(j => j.kind === 'human')).map(j => j.steps),
      HIST_BINS,
    ),
    [journeys, kindFilter],
  )

  const agentCount = journeys.filter(j => j.kind === 'agent').length
  const humanCount = journeys.filter(j => j.kind === 'human').length

  const chartSvgW = Math.max(200, containerW - 40)
  const hasData = journeys.length > 0

  const focusKind: 'agent' | 'human' | null =
    highlight?.side === 'ai' ? 'agent' : highlight?.side === 'human' ? 'human' : null

  return (
    <div ref={containerRef} style={{
      padding: '16px 20px', display: 'flex', flexDirection: 'column',
      height: '100%', overflow: 'hidden', position: 'relative',
      fontFamily: 'Inter, system-ui, sans-serif', gap: 0,
    }}>

      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0, flexWrap: 'wrap', gap: 8, marginBottom: 12,
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#64748b' }}>
              Activity over journey time
            </div>
            {focusKind && (
              <span style={{
                fontSize: '0.67rem', fontWeight: 700, padding: '2px 8px', borderRadius: 99,
                background: focusKind === 'agent' ? `${AGENT_COLOR}18` : `${HUMAN_COLOR}18`,
                color: focusKind === 'agent' ? AGENT_COLOR : HUMAN_COLOR,
                border: `1px solid ${focusKind === 'agent' ? AGENT_COLOR : HUMAN_COLOR}`,
              }}>
                {focusKind === 'agent' ? 'AI journeys highlighted' : 'Human journeys highlighted'}
              </span>
            )}
          </div>
          <div style={{ fontSize: '0.7rem', color: TEXT_MUTED, marginTop: 2 }}>
            Share of activity across journey time (relative to the busiest slice)
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['both', 'agent', 'human'] as KindFilter[]).map(k => {
            const active = kindFilter === k
            const lbl = k === 'both' ? 'All' : k === 'agent' ? 'AI only' : 'Humans only'
            const col = k === 'agent' ? AGENT_COLOR : k === 'human' ? HUMAN_COLOR : '#475569'
            return (
              <button key={k} onClick={() => setKindFilter(k)} style={{
                padding: '4px 10px', borderRadius: 4, fontFamily: 'inherit',
                fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${active ? col : BORDER}`,
                background: active ? col : '#fff',
                color: active ? '#fff' : TEXT_LABEL,
              }}>{lbl}</button>
            )
          })}
        </div>
      </div>

      {/* ── Overlay chart ── */}
      {hasData ? (
        <OverlayDensityChart
          agentCounts={agentCountHist}
          humanCounts={humanCountHist}
          agentCount={agentCount}
          humanCount={humanCount}
          width={chartSvgW}
        />
      ) : (
        <div style={{
          height: CHART_H, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#f8fafc', borderRadius: 6, flexShrink: 0,
          color: TEXT_MUTED, fontSize: '0.78rem', gap: 8,
        }}>
          Run an agent or record a human session to see the activity chart.
        </div>
      )}
    </div>
  )
}

