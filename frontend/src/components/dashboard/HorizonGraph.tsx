import { useState, useMemo, useRef, useEffect } from 'react'
import * as d3 from 'd3'
import type { AgentStep } from '../agent/agentTypes'
import type { CompareHighlight } from '../../lib/api'
import { SAMPLE_COUNT, KDE_BANDWIDTH, buildJourneySamples, gaussianKDE } from './horizonDensity'

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
const CHART_H   = 190

const TEXT_MUTED = '#94a3b8'
const TEXT_LABEL = '#475569'
const BORDER     = '#e2e8f0'

function averageDensities(densities: number[][]): number[] {
  if (densities.length === 0) return new Array(SAMPLE_COUNT).fill(0)
  const sum = new Array(SAMPLE_COUNT).fill(0) as number[]
  for (const d of densities) for (let i = 0; i < SAMPLE_COUNT; i++) sum[i] += d[i]
  return sum.map(v => v / densities.length)
}

/* Density of a specific subset of action types across multiple journeys. */
function actionTypeDensity(journeySteps: AgentStep[][], types: string[]): number[] {
  const typeSet = new Set(types.map(t => t.toLowerCase()))
  const filtered = journeySteps.map(steps =>
    steps.filter(s => typeSet.has((s.action_type ?? '').toLowerCase()))
  )
  const densities = filtered.map(steps => gaussianKDE(buildJourneySamples(steps), KDE_BANDWIDTH, SAMPLE_COUNT))
  return averageDensities(densities)
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Overlay density chart
 * ────────────────────────────────────────────────────────────────────────── */

function OverlayDensityChart({
  agentDensity, humanDensity, agentCount, humanCount,
  focusKind, actionHighlightDensity, width,
}: {
  agentDensity: number[]
  humanDensity: number[]
  agentCount: number
  humanCount: number
  focusKind: 'agent' | 'human' | null
  actionHighlightDensity: number[] | null
  width: number
}) {
  const [hoverX, setHoverX] = useState<number | null>(null)

  const Y_AXIS_W = 10
  const chartW = Math.max(80, width - CHART_PAD.left - CHART_PAD.right - Y_AXIS_W)
  const chartH = CHART_H - CHART_PAD.top - CHART_PAD.bottom

  const hasAgent = agentDensity.some(v => v > 1e-9)
  const hasHuman = humanDensity.some(v => v > 1e-9)

  const globalMax = Math.max(
    hasAgent ? Math.max(...agentDensity) : 0,
    hasHuman ? Math.max(...humanDensity) : 0,
    1e-9,
  )

  const xOf = (i: number) => (i / (SAMPLE_COUNT - 1)) * chartW
  const yOf = (v: number) => chartH - (v / globalMax) * chartH

  const makeArea = (density: number[]) =>
    (d3.area<number>().x((_, i) => xOf(i)).y0(chartH).y1(v => yOf(v)).curve(d3.curveBasis))(density) ?? ''
  const makeLine = (density: number[]) =>
    (d3.line<number>().x((_, i) => xOf(i)).y(v => yOf(v)).curve(d3.curveBasis))(density) ?? ''

  /* Action-type highlight band — scaled to fill chart height independently */
  const actionHighlightPath = useMemo(() => {
    if (!actionHighlightDensity) return null
    const hlMax = Math.max(...actionHighlightDensity, 1e-9)
    const hlY = (v: number) => chartH - (v / hlMax) * chartH
    return (d3.area<number>().x((_, i) => xOf(i)).y0(chartH).y1(v => hlY(v)).curve(d3.curveBasis))(actionHighlightDensity) ?? ''
  }, [actionHighlightDensity, chartW, chartH])

  const peakOf = (density: number[]) => {
    let maxV = -Infinity, maxI = 0
    for (let i = 0; i < density.length; i++) if (density[i] > maxV) { maxV = density[i]; maxI = i }
    return maxV > 1e-9 ? xOf(maxI) : null
  }
  const agentPeakX = hasAgent ? peakOf(agentDensity) : null
  const humanPeakX = hasHuman ? peakOf(humanDensity) : null

  /* Dim the non-focused curve */
  const agentDim = focusKind === 'human'
  const humanDim = focusKind === 'agent'

  /* y-axis ticks: 0 / 25 / 50 / 75 / 100% */
  const yTicks = [0, 0.25, 0.5, 0.75, 1]

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      {/* Legend */}
      <div style={{
        position: 'absolute', top: CHART_PAD.top + 8, right: CHART_PAD.right + 10,
        display: 'flex', gap: 14, alignItems: 'center', pointerEvents: 'none', zIndex: 1,
      }}>
        {hasAgent && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, opacity: agentDim ? 0.35 : 1, transition: 'opacity 0.2s' }}>
            <span style={{ width: 14, height: 3, background: AGENT_COLOR, borderRadius: 2, display: 'inline-block' }} />
            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: AGENT_COLOR, fontFamily: 'Inter, system-ui, sans-serif' }}>
              AI ({agentCount})
            </span>
          </div>
        )}
        {hasHuman && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, opacity: humanDim ? 0.35 : 1, transition: 'opacity 0.2s' }}>
            <span style={{ width: 14, height: 3, background: HUMAN_COLOR, borderRadius: 2, display: 'inline-block' }} />
            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: HUMAN_COLOR, fontFamily: 'Inter, system-ui, sans-serif' }}>
              Human ({humanCount})
            </span>
          </div>
        )}
      </div>

      <svg width={width} height={CHART_H} style={{ display: 'block' }}>
        <g transform={`translate(${CHART_PAD.left + Y_AXIS_W},${CHART_PAD.top})`}>

          <rect x={0} y={0} width={chartW} height={chartH} fill="#f8fafc" rx={4} />

          {/* Y-axis gridlines + % ticks */}
          {yTicks.map(f => {
            const py = chartH - f * chartH
            return (
              <g key={f}>
                <line x1={0} x2={chartW} y1={py} y2={py} stroke="#e2e8f0" strokeWidth={1} />
                <text x={-4} y={py} textAnchor="end" dominantBaseline="middle"
                  fontSize={8} fill="#94a3b8" fontFamily="Inter, system-ui, sans-serif">
                  {Math.round(f * 100)}%
                </text>
              </g>
            )
          })}

          {/* Vertical guides */}
          {[0.25, 0.5, 0.75].map(p => (
            <line key={p} x1={p * chartW} x2={p * chartW} y1={0} y2={chartH}
              stroke="#e8edf2" strokeWidth={1} strokeDasharray="3,3" />
          ))}

          {/* Action-type highlight band (drawn below the curves) */}
          {actionHighlightPath && (
            <path d={actionHighlightPath} fill="#f59e0b" fillOpacity={0.18} />
          )}

          {/* Human curve */}
          {hasHuman && (
            <g style={{ transition: 'opacity 0.2s' }} opacity={humanDim ? 0.2 : 1}>
              <path d={makeArea(humanDensity)} fill={HUMAN_COLOR} fillOpacity={0.13} />
              <path d={makeLine(humanDensity)} fill="none" stroke={HUMAN_COLOR}
                strokeWidth={humanDim ? 1.2 : 2.2} strokeOpacity={0.85} />
            </g>
          )}

          {/* Agent curve */}
          {hasAgent && (
            <g style={{ transition: 'opacity 0.2s' }} opacity={agentDim ? 0.2 : 1}>
              <path d={makeArea(agentDensity)} fill={AGENT_COLOR} fillOpacity={0.13} />
              <path d={makeLine(agentDensity)} fill="none" stroke={AGENT_COLOR}
                strokeWidth={agentDim ? 1.2 : 2.2} strokeOpacity={0.85} />
            </g>
          )}

          {/* Peak markers */}
          {agentPeakX !== null && !agentDim && (
            <g transform={`translate(${agentPeakX},0)`}>
              <line y1={0} y2={chartH} stroke={AGENT_COLOR} strokeWidth={1} strokeOpacity={0.3} strokeDasharray="2,2" />
              <text y={-6} textAnchor="middle" fontSize={9} fill={AGENT_COLOR}
                fontFamily="Inter, system-ui, sans-serif" fontWeight={700}>
                peak {Math.round((agentPeakX / chartW) * 100)}%
              </text>
            </g>
          )}
          {humanPeakX !== null && !humanDim && agentPeakX !== humanPeakX && (
            <g transform={`translate(${humanPeakX},0)`}>
              <line y1={0} y2={chartH} stroke={HUMAN_COLOR} strokeWidth={1} strokeOpacity={0.3} strokeDasharray="2,2" />
              <text y={-6} textAnchor="middle" fontSize={9} fill={HUMAN_COLOR}
                fontFamily="Inter, system-ui, sans-serif" fontWeight={700}>
                peak {Math.round((humanPeakX / chartW) * 100)}%
              </text>
            </g>
          )}

          {/* X-axis */}
          <line x1={0} x2={chartW} y1={chartH} y2={chartH} stroke="#cbd5e1" strokeWidth={1} />
          {[0, 0.25, 0.5, 0.75, 1].map(p => (
            <g key={p} transform={`translate(${p * chartW},${chartH})`}>
              <line y1={0} y2={5} stroke="#94a3b8" strokeWidth={1} />
              <text y={16} textAnchor={p === 0 ? 'start' : p === 1 ? 'end' : 'middle'}
                fontSize={10} fill="#94a3b8" fontFamily="Inter, system-ui, sans-serif">
                {Math.round(p * 100)}%
              </text>
            </g>
          ))}

          <text x={chartW / 2} y={chartH + 30} textAnchor="middle" fontSize={9} fill="#94a3b8"
            fontFamily="Inter, system-ui, sans-serif"
            style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Journey progress →
          </text>

          <text transform={`translate(${-Y_AXIS_W - 2},${chartH / 2}) rotate(-90)`}
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
              <text x={hoverX} y={chartH + 15} textAnchor="middle" fontSize={9} fill="#fff"
                fontFamily="Inter, system-ui, sans-serif">
                {Math.round((hoverX / chartW) * 100)}%
              </text>
            </g>
          )}

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

  /* Sync kindFilter to highlight.side when a new highlight arrives */
  useEffect(() => {
    if (!highlight?.side || highlight.side === 'both') return
    setKindFilter(highlight.side === 'ai' ? 'agent' : 'human')
  }, [highlight])

  const allAgentSteps = agentJourneys
  const allHumanSteps = humanJourneys

  const agentDensities = useMemo(
    () => allAgentSteps.map(steps => gaussianKDE(buildJourneySamples(steps), KDE_BANDWIDTH, SAMPLE_COUNT)),
    [allAgentSteps],
  )
  const humanDensities = useMemo(
    () => allHumanSteps.map(steps => gaussianKDE(buildJourneySamples(steps), KDE_BANDWIDTH, SAMPLE_COUNT)),
    [allHumanSteps],
  )

  const avgAgentDensity = useMemo(
    () => averageDensities(kindFilter === 'human' ? [] : agentDensities),
    [agentDensities, kindFilter],
  )
  const avgHumanDensity = useMemo(
    () => averageDensities(kindFilter === 'agent' ? [] : humanDensities),
    [humanDensities, kindFilter],
  )

  /* Action-type highlight density — only when highlight.action_types is set */
  const actionHighlightDensity = useMemo(() => {
    const types = highlight?.action_types
    if (!types || types.length === 0) return null
    const journeysToUse = highlight?.side === 'ai' ? allAgentSteps
      : highlight?.side === 'human' ? allHumanSteps
      : [...allAgentSteps, ...allHumanSteps]
    return actionTypeDensity(journeysToUse, types)
  }, [highlight, allAgentSteps, allHumanSteps])

  const focusKind: 'agent' | 'human' | null =
    highlight?.side === 'ai' ? 'agent' : highlight?.side === 'human' ? 'human' : null

  const agentCount = agentJourneys.length
  const humanCount = humanJourneys.length
  const hasData = agentCount + humanCount > 0
  const chartSvgW = Math.max(200, containerW - 40)

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
              Activity density over journey time
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
            {actionHighlightDensity && highlight?.action_types && (
              <span style={{
                fontSize: '0.67rem', fontWeight: 700, padding: '2px 8px', borderRadius: 99,
                background: '#fef3c7', color: '#92400e', border: '1px solid #f59e0b',
              }}>
                {highlight.action_types.map(t => t.replace(/_/g, ' ')).join(', ')} highlighted
              </span>
            )}
          </div>
          <div style={{ fontSize: '0.7rem', color: TEXT_MUTED, marginTop: 2 }}>
            Average action density across all journeys
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

      {/* ── Chart ── */}
      {hasData ? (
        <OverlayDensityChart
          agentDensity={avgAgentDensity}
          humanDensity={avgHumanDensity}
          agentCount={agentCount}
          humanCount={humanCount}
          focusKind={focusKind}
          actionHighlightDensity={actionHighlightDensity}
          width={chartSvgW}
        />
      ) : (
        <div style={{
          height: CHART_H, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#f8fafc', borderRadius: 6, flexShrink: 0,
          color: TEXT_MUTED, fontSize: '0.78rem',
        }}>
          Run an agent or record a human session to see the activity chart.
        </div>
      )}
    </div>
  )
}
