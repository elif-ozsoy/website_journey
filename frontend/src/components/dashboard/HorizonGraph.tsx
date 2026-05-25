import { useState, useMemo, useRef, useEffect } from 'react'
import * as d3 from 'd3'
import type { AgentStep } from '../agent/agentTypes'

interface Props {
  agentJourneys: AgentStep[][]
  humanJourneys?: AgentStep[][]
  agentLabels?: string[]
  humanLabels?: string[]
}

const AGENT_COLOR = '#32494B'
const HUMAN_COLOR = '#881342'

const AGENT_PALETTE = [
  '#32494B', '#3d5b5d', '#496e70', '#558183', '#619496', '#6da7a9',
]
const HUMAN_PALETTE = [
  '#881342', '#9e1852', '#b41e62', '#ca2472', '#e02a82', '#f63092',
]
function colorForJourney(kind: 'agent' | 'human', index: number): string {
  return (kind === 'agent' ? AGENT_PALETTE : HUMAN_PALETTE)[index % 6]
}

/* ── Strip constants (for the per-journey detail section) ── */
const STRIP_HEIGHT  = 44
const STRIP_LABEL_W = 160
const STRIP_GAP     = 5
const NUM_BANDS     = 3
const SAMPLE_COUNT  = 240
const KDE_BANDWIDTH = 0.05
const CLICK_TOL     = 0.05

/* ── Overlay chart constants ── */
const CHART_PAD = { top: 22, right: 20, bottom: 34, left: 16 }
const CHART_H   = 190   // total SVG height

const TEXT_DARK  = '#334155'
const TEXT_MUTED = '#94a3b8'
const TEXT_LABEL = '#475569'
const BORDER     = '#e2e8f0'

const STEP_ACTION_COLORS: Record<string, string> = {
  click_element:   '#185FA5',
  input_text:      '#059669',
  go_to_url:       '#d97706',
  scroll:          '#0891b2',
  go_back:         '#f43f5e',
  extract_content: '#7c3aed',
  done:            '#16a34a',
}

/* ── Step helpers ── */

function isCountableAction(s: AgentStep): boolean {
  const a = (s.action_type ?? '').toLowerCase()
  return !(!a || a === 'unknown' || a === 'wait' || a === 'extract_content')
}

interface JourneySample {
  relT: number
  step: AgentStep
  stepIdx: number
}

function buildJourneySamples(steps: AgentStep[]): JourneySample[] {
  if (steps.length === 0) return []
  const tsSteps = steps.filter(s => typeof (s as any).timestamp === 'number')
  let useTs = false, t0 = 0, t1 = 0
  if (tsSteps.length >= 2) {
    t0 = (tsSteps[0] as any).timestamp
    t1 = (tsSteps[tsSteps.length - 1] as any).timestamp
    if (t1 > t0) useTs = true
  }
  const out: JourneySample[] = []
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]
    if (!isCountableAction(s)) continue
    let relT = steps.length > 1 ? i / (steps.length - 1) : 0
    if (useTs && typeof (s as any).timestamp === 'number') {
      relT = ((s as any).timestamp - t0) / (t1 - t0)
    }
    out.push({ relT: Math.max(0, Math.min(1, relT)), step: s, stepIdx: i })
  }
  return out
}

function gaussianKDE(samples: JourneySample[], bw: number, n: number): number[] {
  const out = new Array(n).fill(0) as number[]
  if (samples.length === 0) return out
  const inv2 = 1 / (2 * bw * bw)
  const norm = 1 / (bw * Math.sqrt(2 * Math.PI))
  for (let g = 0; g < n; g++) {
    const t = g / (n - 1)
    let s = 0
    for (const p of samples) { const d = t - p.relT; s += norm * Math.exp(-d * d * inv2) }
    out[g] = s
  }
  return out
}

function shadeHex(hex: string, t: number): string {
  const m = hex.replace('#', '')
  const r = parseInt(m.slice(0, 2), 16)
  const g = parseInt(m.slice(2, 4), 16)
  const b = parseInt(m.slice(4, 6), 16)
  const mix = (c: number) => Math.round(c * (1 - t))
  const h = (c: number) => c.toString(16).padStart(2, '0')
  return `#${h(mix(r))}${h(mix(g))}${h(mix(b))}`
}

function averageDensities(densities: number[][]): number[] {
  if (densities.length === 0) return new Array(SAMPLE_COUNT).fill(0)
  const sum = new Array(SAMPLE_COUNT).fill(0) as number[]
  for (const d of densities) for (let i = 0; i < SAMPLE_COUNT; i++) sum[i] += d[i]
  return sum.map(v => v / densities.length)
}

interface Journey {
  id: string
  kind: 'agent' | 'human'
  index: number
  label: string
  steps: AgentStep[]
  color: string
  samples: JourneySample[]
  density: number[]
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Overlay density chart — the primary view
 * ────────────────────────────────────────────────────────────────────────── */

function OverlayDensityChart({
  agentDensity, humanDensity, agentCount, humanCount, width,
}: {
  agentDensity: number[]
  humanDensity: number[]
  agentCount: number
  humanCount: number
  width: number
}) {
  const [hoverX, setHoverX] = useState<number | null>(null)

  const chartW = Math.max(80, width - CHART_PAD.left - CHART_PAD.right)
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

  /* Peak positions */
  const peakOf = (density: number[]) => {
    let maxV = -Infinity, maxI = 0
    for (let i = 0; i < density.length; i++) if (density[i] > maxV) { maxV = density[i]; maxI = i }
    return maxV > 1e-9 ? xOf(maxI) : null
  }
  const agentPeakX = hasAgent ? peakOf(agentDensity) : null
  const humanPeakX = hasHuman ? peakOf(humanDensity) : null

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      {/* Legend — positioned over the chart */}
      <div style={{
        position: 'absolute',
        top: CHART_PAD.top + 8,
        right: CHART_PAD.right + 10,
        display: 'flex', gap: 14, alignItems: 'center',
        pointerEvents: 'none',
        zIndex: 1,
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
        <g transform={`translate(${CHART_PAD.left},${CHART_PAD.top})`}>

          {/* Chart background */}
          <rect x={0} y={0} width={chartW} height={chartH} fill="#f8fafc" rx={4} />

          {/* Horizontal grid */}
          {[0.33, 0.66, 1].map(p => (
            <line key={p}
              x1={0} x2={chartW} y1={chartH * (1 - p)} y2={chartH * (1 - p)}
              stroke="#e2e8f0" strokeWidth={1}
            />
          ))}

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
              <path d={makeArea(humanDensity)} fill={HUMAN_COLOR} fillOpacity={0.13} />
              <path d={makeLine(humanDensity)} fill="none" stroke={HUMAN_COLOR} strokeWidth={2.2} strokeOpacity={0.85} />
            </>
          )}

          {/* Agent area + line */}
          {hasAgent && (
            <>
              <path d={makeArea(agentDensity)} fill={AGENT_COLOR} fillOpacity={0.13} />
              <path d={makeLine(agentDensity)} fill="none" stroke={AGENT_COLOR} strokeWidth={2.2} strokeOpacity={0.85} />
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
            transform={`translate(${-10},${chartH / 2}) rotate(-90)`}
            textAnchor="middle" fontSize={9} fill="#94a3b8"
            fontFamily="Inter, system-ui, sans-serif"
            style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Activity
          </text>

          {/* Hover cursor line + label */}
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

          {/* Mouse tracker (invisible, spans chart area) */}
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
  agentJourneys, humanJourneys = [], agentLabels, humanLabels,
}: Props) {
  type KindFilter = 'both' | 'agent' | 'human'
  const [kindFilter, setKindFilter] = useState<KindFilter>('both')
  const [hoverJourneyId, setHoverJourneyId] = useState<string | null>(null)
  const [selection, setSelection] = useState<{ journeyId: string; relT: number } | null>(null)

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
        steps, color: colorForJourney(kind, i), samples,
        density: gaussianKDE(samples, KDE_BANDWIDTH, SAMPLE_COUNT),
      })
    }
    agentJourneys.forEach((s, i) => make(s, 'agent', i, agentLabels?.[i]))
    humanJourneys.forEach((s, i) => make(s, 'human', i, humanLabels?.[i]))
    return out
  }, [agentJourneys, humanJourneys, agentLabels, humanLabels])

  const visibleJourneys = useMemo(
    () => journeys.filter(j => kindFilter === 'both' || j.kind === kindFilter),
    [journeys, kindFilter],
  )

  /* Averaged densities for the overlay chart */
  const avgAgentDensity = useMemo(
    () => averageDensities(
      (kindFilter === 'human' ? [] : journeys.filter(j => j.kind === 'agent')).map(j => j.density)
    ),
    [journeys, kindFilter],
  )
  const avgHumanDensity = useMemo(
    () => averageDensities(
      (kindFilter === 'agent' ? [] : journeys.filter(j => j.kind === 'human')).map(j => j.density)
    ),
    [journeys, kindFilter],
  )

  const agentCount = journeys.filter(j => j.kind === 'agent').length
  const humanCount = journeys.filter(j => j.kind === 'human').length

  /* Scale for strips */
  const globalMax = useMemo(() => {
    let m = 0
    for (const j of visibleJourneys) for (const v of j.density) if (v > m) m = v
    return Math.max(1e-9, m)
  }, [visibleJourneys])
  const bandSize = globalMax / NUM_BANDS

  const chartSvgW = Math.max(200, containerW - 40)
  const stripW = Math.max(160, containerW - STRIP_LABEL_W - 32)
  const hasData = journeys.length > 0

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
          <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#64748b' }}>
            Activity density over journey time
          </div>
          <div style={{ fontSize: '0.7rem', color: TEXT_MUTED, marginTop: 2 }}>
            Average action density across all journeys · click a strip below to inspect steps
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

      {/* ── Overlay density chart ── */}
      {hasData ? (
        <OverlayDensityChart
          agentDensity={avgAgentDensity}
          humanDensity={avgHumanDensity}
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

      {/* ── Per-journey detail ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        marginTop: 18, marginBottom: 8, flexShrink: 0,
      }}>
        <span style={{
          fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.08em', color: '#94a3b8',
        }}>
          Per-journey detail
        </span>
        <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
        <span style={{ fontSize: '0.66rem', color: '#94a3b8' }}>
          click a strip to inspect steps
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', paddingRight: 4 }}>
        {visibleJourneys.length === 0 ? (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: 80, color: TEXT_MUTED, fontSize: '0.78rem',
          }}>
            {journeys.length === 0 ? 'No journeys yet.' : 'No journeys match the current filter.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: STRIP_GAP }}>
            {visibleJourneys.map(j => (
              <JourneyStrip
                key={j.id}
                journey={j}
                bandSize={bandSize}
                stripW={stripW}
                isHovered={hoverJourneyId === j.id}
                isDimmed={hoverJourneyId !== null && hoverJourneyId !== j.id}
                onHover={() => setHoverJourneyId(j.id)}
                onLeave={() => setHoverJourneyId(null)}
                onClickAt={relT => setSelection({ journeyId: j.id, relT })}
              />
            ))}
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selection && (() => {
        const j = visibleJourneys.find(x => x.id === selection.journeyId)
        if (!j) return null
        const stepsNear = j.samples.filter(s => Math.abs(s.relT - selection.relT) <= CLICK_TOL).map(s => s.step)
        const fromPct = Math.max(0, Math.round((selection.relT - CLICK_TOL) * 100))
        const toPct   = Math.min(100, Math.round((selection.relT + CLICK_TOL) * 100))
        return (
          <BucketDetailModal
            journey={j} fromPct={fromPct} toPct={toPct}
            atPct={Math.round(selection.relT * 100)} steps={stepsNear}
            onClose={() => setSelection(null)}
          />
        )
      })()}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Single journey strip (horizon bands)
 * ────────────────────────────────────────────────────────────────────────── */

function JourneyStrip({
  journey, bandSize, stripW, isHovered, isDimmed, onHover, onLeave, onClickAt,
}: {
  journey: Journey; bandSize: number; stripW: number
  isHovered: boolean; isDimmed: boolean
  onHover: () => void; onLeave: () => void; onClickAt: (relT: number) => void
}) {
  const totalActions = journey.samples.length

  const bandPaths = useMemo(() => {
    const xs = journey.density.map((_, i) => (i / (SAMPLE_COUNT - 1)) * stripW)
    return Array.from({ length: NUM_BANDS }, (_, b) => {
      const lo = b * bandSize, hi = (b + 1) * bandSize
      const pts = journey.density.map((v, i) => {
        const vis = Math.max(0, Math.min(hi - lo, v - lo))
        return { x: xs[i], y: STRIP_HEIGHT - (bandSize > 0 ? vis / bandSize : 0) * STRIP_HEIGHT }
      })
      return d3.area<{ x: number; y: number }>()
        .x(p => p.x).y0(STRIP_HEIGHT).y1(p => p.y).curve(d3.curveBasis)(pts) ?? ''
    })
  }, [journey.density, bandSize, stripW])

  const bandShades = useMemo(
    () => Array.from({ length: NUM_BANDS }, (_, i) =>
      shadeHex(journey.color, 0.05 + (i / Math.max(1, NUM_BANDS - 1)) * 0.55)
    ),
    [journey.color],
  )

  return (
    <div onMouseEnter={onHover} onMouseLeave={onLeave}
      style={{ display: 'flex', alignItems: 'stretch', gap: 8, opacity: isDimmed ? 0.35 : 1, transition: 'opacity 0.15s' }}>
      <div style={{
        width: STRIP_LABEL_W, flexShrink: 0,
        display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 8px',
        borderLeft: `3px solid ${journey.color}`,
        background: isHovered ? `${journey.color}12` : 'transparent',
        transition: 'background 0.15s',
      }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: journey.color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {journey.label}
        </div>
        <div style={{ fontSize: '0.63rem', color: TEXT_MUTED, marginTop: 1 }}>
          {totalActions} action{totalActions !== 1 ? 's' : ''} · {journey.steps.length} steps
        </div>
      </div>

      <svg width={stripW} height={STRIP_HEIGHT}
        onClick={e => {
          const rect = e.currentTarget.getBoundingClientRect()
          onClickAt(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)))
        }}
        style={{ display: 'block', flexShrink: 0, background: '#fafbfc', borderRadius: 3, cursor: 'crosshair' }}>
        {[0.25, 0.5, 0.75].map(p => (
          <line key={p} x1={p * stripW} x2={p * stripW} y1={0} y2={STRIP_HEIGHT}
            stroke="#e8edf2" strokeWidth={1} strokeDasharray="2,3" />
        ))}
        {bandPaths.map((d, b) => (
          <path key={b} d={d} fill={bandShades[b]} fillOpacity={0.95} />
        ))}
        <CursorLine stripW={stripW} />
      </svg>
    </div>
  )
}

function CursorLine({ stripW }: { stripW: number }) {
  const [x, setX] = useState<number | null>(null)
  return (
    <g>
      <rect x={0} y={0} width={stripW} height={STRIP_HEIGHT} fill="transparent"
        onMouseMove={e => setX(e.clientX - e.currentTarget.getBoundingClientRect().left)}
        onMouseLeave={() => setX(null)} />
      {x !== null && (
        <line x1={x} x2={x} y1={0} y2={STRIP_HEIGHT}
          stroke="#1e293b" strokeWidth={1} strokeOpacity={0.18} pointerEvents="none" />
      )}
    </g>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Detail modal
 * ────────────────────────────────────────────────────────────────────────── */

function BucketDetailModal({
  journey, fromPct, toPct, atPct, steps, onClose,
}: {
  journey: Journey; fromPct: number; toPct: number; atPct: number; steps: AgentStep[]; onClose: () => void
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(15,23,42,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 8, boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
        width: 'min(720px, 96vw)', maxHeight: '85vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}>
        <div style={{
          padding: '14px 18px', borderBottom: `1px solid ${BORDER}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: journey.color, flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: TEXT_DARK, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {journey.label}
              </div>
              <div style={{ fontSize: '0.72rem', color: TEXT_MUTED, marginTop: 2 }}>
                around {atPct}% ({fromPct}–{toPct}%) · {steps.length} action{steps.length !== 1 ? 's' : ''}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: TEXT_LABEL, fontSize: '1.2rem',
            cursor: 'pointer', padding: '0 4px', lineHeight: 1,
          }} title="Close (Esc)">✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {steps.length === 0 ? (
            <div style={{ padding: 24, fontSize: '0.85rem', color: TEXT_MUTED, fontStyle: 'italic', textAlign: 'center' }}>
              No actions in this slice.
            </div>
          ) : steps.map((s, i) => {
            const at = s.action_type ?? 'step'
            const ac = STEP_ACTION_COLORS[at] ?? '#475569'
            let path = s.url
            try { path = new URL(s.url).pathname || '/' } catch { /* keep */ }
            const det = (s as any).action_details ?? {}
            const detailStr = typeof det === 'object' && det !== null
              ? (det.text ?? det.value ?? det.url ?? det.element_text ?? '') : ''
            return (
              <div key={i} style={{
                padding: '10px 18px', borderBottom: '1px solid #f1f5f9',
                display: 'flex', alignItems: 'flex-start', gap: 10,
              }}>
                <span style={{
                  fontSize: '0.66rem', fontWeight: 700, color: ac, background: `${ac}18`,
                  padding: '2px 6px', borderRadius: 3, textTransform: 'uppercase',
                  letterSpacing: '0.02em', flexShrink: 0, minWidth: 84, textAlign: 'center',
                }}>{at.replace(/_/g, ' ')}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.78rem', color: TEXT_DARK, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {path}
                  </div>
                  {detailStr && (
                    <div style={{ fontSize: '0.72rem', color: TEXT_MUTED, marginTop: 2, lineHeight: 1.4 }}>
                      {String(detailStr).slice(0, 120)}{String(detailStr).length > 120 ? '…' : ''}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}