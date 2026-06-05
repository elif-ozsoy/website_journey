import { useState, useMemo, useRef, useEffect } from 'react'
import * as d3 from 'd3'
import type { AgentStep } from '../agent/agentTypes'

/* ────────────────────────────────────────────────────────────────────────────
 *  Horizon Graph (continuous)
 *
 *  One horizontal strip per journey. X = relative time (0–100% of the
 *  journey's duration). Y = action density (clicks + scrolls + inputs + nav),
 *  estimated as a kernel-density curve so the result is smooth and wavy
 *  rather than a histogram of bars.
 *
 *  Horizon-graph technique:
 *    - The continuous density curve f(t) is split into B horizontal bands of
 *      equal value height (bandSize = globalMax / B).
 *    - For band k (0 = lightest, B-1 = darkest), the visible curve is
 *      clamp(f(t) − k·bandSize, 0, bandSize). Each band is rendered at the
 *      same y position as a filled SVG path; darker bands draw on top.
 *    - The overall height of a strip stays ~50px no matter how spiky the
 *      data — darkness encodes intensity instead of vertical space.
 *
 *  Clicking a position on a strip opens a modal with all steps whose relative
 *  time falls within ±5 % of the click.
 * ────────────────────────────────────────────────────────────────────────── */

interface Props {
  agentJourneys: AgentStep[][]
  humanJourneys?: AgentStep[][]
  agentLabels?: string[]
  humanLabels?: string[]
}

const AGENT_PALETTE = [
  '#4f46e5', '#2563eb', '#7c3aed', '#1d4ed8', '#a855f7', '#0ea5e9',
]
const HUMAN_PALETTE = [
  '#10b981', '#059669', '#14b8a6', '#0d9488', '#22c55e', '#047857',
]
function colorForJourney(kind: 'agent' | 'human', index: number): string {
  const palette = kind === 'agent' ? AGENT_PALETTE : HUMAN_PALETTE
  return palette[index % palette.length]
}

/* Visual constants */
const STRIP_HEIGHT  = 50
const STRIP_LABEL_W = 170
const STRIP_GAP     = 6
const NUM_BANDS     = 3
const SAMPLE_COUNT  = 240   // x-resolution of the smooth curve
const KDE_BANDWIDTH = 0.05  // ~5% of journey duration; medium smoothness
const CLICK_TOL     = 0.05  // ±5% of journey duration for click selection

const TEXT_DARK  = '#334155'
const TEXT_MUTED = '#94a3b8'
const TEXT_LABEL = '#475569'
const BORDER     = '#e2e8f0'

const STEP_ACTION_COLORS: Record<string, string> = {
  click_element:   '#4f46e5',  // indigo — primary interaction (agent palette)
  input_text:      '#0d9488',  // teal — data entry (human palette)
  go_to_url:       '#0284c7',  // sky — navigation
  scroll:          '#64748b',  // slate — passive movement
  go_back:         '#e11d48',  // rose — backward/undo
  extract_content: '#7c3aed',  // violet — AI extraction (agent palette)
  done:            '#16a34a',  // green — success
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Step classification — what counts toward "activity"?
 *  Everything that's a real user action: clicks, scrolls, inputs, navigation.
 *  Skip 'unknown', 'wait', 'extract' (passive reads).
 * ────────────────────────────────────────────────────────────────────────── */

function isCountableAction(s: AgentStep): boolean {
  const a = (s.action_type ?? '').toLowerCase()
  if (!a || a === 'unknown' || a === 'wait' || a === 'extract_content') return false
  return true
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Build the (relativeTime, originalStep) sample set for one journey.
 *  Returns the relative-time of each countable action in [0, 1] along with
 *  the underlying step (kept so click-detail can pull them back later).
 * ────────────────────────────────────────────────────────────────────────── */

interface JourneySample {
  relT: number       // relative time in [0, 1]
  step: AgentStep
  stepIdx: number    // index in the original steps array
}

function buildJourneySamples(steps: AgentStep[]): JourneySample[] {
  if (steps.length === 0) return []

  // Prefer real timestamps when available so a journey's PACE is reflected.
  const tsSteps = steps.filter(s => typeof (s as any).timestamp === 'number')
  let useTimestamps = false
  let t0 = 0, t1 = 0
  if (tsSteps.length >= 2) {
    t0 = (tsSteps[0] as any).timestamp
    t1 = (tsSteps[tsSteps.length - 1] as any).timestamp
    if (t1 > t0) useTimestamps = true
  }

  const samples: JourneySample[] = []
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]
    if (!isCountableAction(s)) continue
    let relT: number
    if (useTimestamps && typeof (s as any).timestamp === 'number') {
      relT = ((s as any).timestamp - t0) / (t1 - t0)
    } else {
      relT = steps.length > 1 ? i / (steps.length - 1) : 0
    }
    if (relT < 0) relT = 0
    if (relT > 1) relT = 1
    samples.push({ relT, step: s, stepIdx: i })
  }
  return samples
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Kernel density estimation. Sum a Gaussian per sample, evaluate over a
 *  uniform grid in [0, 1]. The y-values represent action density per unit of
 *  relative time and are NOT counts in a bucket — they're a smooth profile.
 *
 *  We use a fixed Gaussian kernel (no reflection at boundaries; we accept
 *  some edge-roll-off because it makes the visual look natural rather than
 *  jamming activity into the endpoints).
 * ────────────────────────────────────────────────────────────────────────── */

function gaussianKDE(samples: JourneySample[], bandwidth: number, nGrid: number): number[] {
  const out = new Array(nGrid).fill(0) as number[]
  if (samples.length === 0) return out
  const inv2bw2 = 1 / (2 * bandwidth * bandwidth)
  const norm = 1 / (bandwidth * Math.sqrt(2 * Math.PI))
  for (let g = 0; g < nGrid; g++) {
    const t = g / (nGrid - 1)
    let sum = 0
    for (const s of samples) {
      const d = t - s.relT
      sum += norm * Math.exp(-d * d * inv2bw2)
    }
    out[g] = sum
  }
  return out
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Hex shading — darken `hex` toward black by `t` ∈ [0, 1].
 * ────────────────────────────────────────────────────────────────────────── */

function shadeHex(hex: string, t: number): string {
  const m = hex.replace('#', '')
  const r = parseInt(m.slice(0, 2), 16)
  const g = parseInt(m.slice(2, 4), 16)
  const b = parseInt(m.slice(4, 6), 16)
  const mix = (c: number) => Math.round(c * (1 - t))
  const toHex = (c: number) => c.toString(16).padStart(2, '0')
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Journey metadata
 * ────────────────────────────────────────────────────────────────────────── */

interface Journey {
  id: string
  kind: 'agent' | 'human'
  index: number
  label: string
  steps: AgentStep[]
  color: string
  samples: JourneySample[]
  density: number[]   // length SAMPLE_COUNT, KDE y-values
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
  const [selection, setSelection] = useState<
    | { journeyId: string; relT: number }
    | null
  >(null)

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

  /* Build journey metadata + density profiles. Memoised on inputs. */
  const journeys = useMemo<Journey[]>(() => {
    const out: Journey[] = []
    const make = (steps: AgentStep[], kind: 'agent' | 'human', i: number, labelOverride?: string) => {
      const samples = buildJourneySamples(steps)
      const density = gaussianKDE(samples, KDE_BANDWIDTH, SAMPLE_COUNT)
      out.push({
        id: `${kind}-${i}`, kind, index: i,
        label: labelOverride ?? (kind === 'agent' ? `AI Run #${i + 1}` : `User #${i + 1}`),
        steps, color: colorForJourney(kind, i),
        samples, density,
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

  /* Global scale across all visible density curves so strips are comparable. */
  const globalMax = useMemo(() => {
    let m = 0
    for (const j of visibleJourneys) {
      for (const v of j.density) if (v > m) m = v
    }
    return Math.max(1e-9, m)
  }, [visibleJourneys])

  const bandSize = globalMax / NUM_BANDS

  /* Layout */
  const stripW = Math.max(220, containerW - STRIP_LABEL_W - 32)
  const hasData = visibleJourneys.length > 0 && globalMax > 1e-6

  return (
    <div ref={containerRef} style={{
      padding: '16px 20px', display: 'flex', flexDirection: 'column',
      height: '100%', overflow: 'hidden', position: 'relative',
      fontFamily: 'Inter, system-ui, sans-serif', gap: 12,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        flexShrink: 0, flexWrap: 'wrap', gap: 10,
      }}>
        <div>
          <div style={{
            fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.07em', color: '#64748b',
          }}>
            Activity over journey time
          </div>
          <div style={{ fontSize: '0.72rem', color: TEXT_MUTED, marginTop: 2 }}>
            {visibleJourneys.length} journey{visibleJourneys.length !== 1 ? 's' : ''} ·
            {' '}smooth density (clicks + scrolls + inputs + nav) · darker = more intense ·
            {' '}click a position to see steps near that time
          </div>
        </div>

        {/* Kind filter */}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {(['both', 'agent', 'human'] as KindFilter[]).map(k => {
            const active = kindFilter === k
            const lbl = k === 'both' ? 'All' : k === 'agent' ? 'AI only' : 'Humans only'
            const baseColor = k === 'agent' ? AGENT_PALETTE[0]
                            : k === 'human' ? HUMAN_PALETTE[0]
                            : '#475569'
            return (
              <button
                key={k}
                onClick={() => setKindFilter(k)}
                style={{
                  padding: '4px 10px', borderRadius: 4, fontFamily: 'inherit',
                  fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer',
                  border: `1px solid ${active ? baseColor : BORDER}`,
                  background: active ? baseColor : '#fff',
                  color: active ? '#fff' : TEXT_LABEL,
                }}
              >{lbl}</button>
            )
          })}
        </div>
      </div>

      {/* Strips */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', paddingRight: 4 }}>
        {!hasData ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: 240, color: TEXT_MUTED, gap: 8,
          }}>
            <span style={{ fontWeight: 600, color: '#64748b' }}>No journeys to display</span>
            <span style={{ textAlign: 'center', maxWidth: 320, fontSize: '0.78rem' }}>
              {journeys.length === 0
                ? 'Run an agent or record a human session to see the activity profile.'
                : 'No journeys match the current filter.'}
            </span>
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
                onClickAt={(relT) => setSelection({ journeyId: j.id, relT })}
              />
            ))}
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selection && (() => {
        const j = visibleJourneys.find(x => x.id === selection.journeyId)
        if (!j) return null
        const stepsNear = j.samples
          .filter(s => Math.abs(s.relT - selection.relT) <= CLICK_TOL)
          .map(s => s.step)
        const fromPct = Math.max(0, Math.round((selection.relT - CLICK_TOL) * 100))
        const toPct   = Math.min(100, Math.round((selection.relT + CLICK_TOL) * 100))
        return (
          <BucketDetailModal
            journey={j}
            fromPct={fromPct}
            toPct={toPct}
            atPct={Math.round(selection.relT * 100)}
            steps={stepsNear}
            onClose={() => setSelection(null)}
          />
        )
      })()}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Single strip — renders the journey's density curve as N stacked horizon
 *  bands. Click target spans the full strip; we compute relT from the click.
 * ────────────────────────────────────────────────────────────────────────── */

function JourneyStrip({
  journey, bandSize, stripW,
  isHovered, isDimmed,
  onHover, onLeave, onClickAt,
}: {
  journey: Journey
  bandSize: number
  stripW: number
  isHovered: boolean
  isDimmed: boolean
  onHover: () => void
  onLeave: () => void
  onClickAt: (relT: number) => void
}) {
  const totalActions = journey.samples.length

  /* Pre-compute band paths. Each band path is a closed area filled with that
   * band's shade. We use d3's area generator with curveBasis for medium
   * smoothness. */
  const bandPaths = useMemo(() => {
    const xs = journey.density.map((_, i) => (i / (SAMPLE_COUNT - 1)) * stripW)
    const paths: string[] = []
    for (let b = 0; b < NUM_BANDS; b++) {
      const lo = b * bandSize
      const hi = (b + 1) * bandSize
      // For band b, the "visible" value at each x is clamp(density - lo, 0, hi-lo)
      const points = journey.density.map((v, i) => {
        const visible = Math.max(0, Math.min(hi - lo, v - lo))
        // Scale the visible portion to the full strip height (so each band
        // re-uses the full vertical space; that's the horizon trick).
        const yFrac = bandSize > 0 ? visible / bandSize : 0
        const y = STRIP_HEIGHT - yFrac * STRIP_HEIGHT
        return { x: xs[i], y }
      })
      const area = d3.area<{ x: number; y: number }>()
        .x(p => p.x)
        .y0(STRIP_HEIGHT)
        .y1(p => p.y)
        .curve(d3.curveBasis)
      const d = area(points) ?? ''
      paths.push(d)
    }
    return paths
  }, [journey.density, bandSize, stripW])

  const bandShades = useMemo(
    () => Array.from({ length: NUM_BANDS }, (_, i) =>
      shadeHex(journey.color, 0.05 + (i / Math.max(1, NUM_BANDS - 1)) * 0.55)
    ),
    [journey.color],
  )

  /* Click → relative time */
  function handleClick(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const relT = Math.max(0, Math.min(1, x / rect.width))
    onClickAt(relT)
  }

  return (
    <div
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      style={{
        display: 'flex', alignItems: 'stretch', gap: 8,
        opacity: isDimmed ? 0.35 : 1,
        transition: 'opacity 0.15s',
      }}
    >
      {/* Label */}
      <div style={{
        width: STRIP_LABEL_W, flexShrink: 0,
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: '0 8px',
        borderLeft: `3px solid ${journey.color}`,
        background: isHovered ? `${journey.color}10` : 'transparent',
        transition: 'background 0.15s',
      }}>
        <div style={{
          fontSize: '0.78rem', fontWeight: 700, color: journey.color,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {journey.label}
        </div>
        <div style={{ fontSize: '0.65rem', color: TEXT_MUTED, marginTop: 1 }}>
          {totalActions} action{totalActions !== 1 ? 's' : ''} · {journey.steps.length} steps
        </div>
      </div>

      {/* Strip */}
      <svg
        width={stripW}
        height={STRIP_HEIGHT}
        onClick={handleClick}
        style={{
          display: 'block', flexShrink: 0,
          background: '#fafbfc', borderRadius: 3,
          cursor: 'crosshair',
        }}
      >
        {/* Subtle vertical grid */}
        {[0.25, 0.5, 0.75].map(p => (
          <line key={p}
            x1={p * stripW} x2={p * stripW}
            y1={0} y2={STRIP_HEIGHT}
            stroke="#e8edf2" strokeWidth={1} strokeDasharray="2,3"
          />
        ))}

        {/* Bands, lightest first (drawn at bottom); darker bands on top */}
        {bandPaths.map((d, b) => (
          <path key={b}
            d={d}
            fill={bandShades[b]}
            // Slight opacity so overlapping bands give a richer feel
            fillOpacity={0.95}
          />
        ))}

        {/* Hover overlay: a faint cursor line that follows the mouse for orientation */}
        <CursorLine stripW={stripW} />
      </svg>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
 *  CursorLine — a thin vertical guide that tracks the mouse position over
 *  the SVG for visual orientation. Pure presentational helper.
 * ────────────────────────────────────────────────────────────────────────── */

function CursorLine({ stripW }: { stripW: number }) {
  const [x, setX] = useState<number | null>(null)
  return (
    <g>
      <rect
        x={0} y={0} width={stripW} height={STRIP_HEIGHT}
        fill="transparent"
        onMouseMove={(e) => {
          const target = e.currentTarget
          const rect = target.getBoundingClientRect()
          setX(e.clientX - rect.left)
        }}
        onMouseLeave={() => setX(null)}
      />
      {x !== null && (
        <line
          x1={x} x2={x} y1={0} y2={STRIP_HEIGHT}
          stroke="#1e293b" strokeWidth={1} strokeOpacity={0.18}
          pointerEvents="none"
        />
      )}
    </g>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Detail modal — same shape as the bucket modal but driven by the click
 *  position and the ±5 % tolerance.
 * ────────────────────────────────────────────────────────────────────────── */

function BucketDetailModal({
  journey, fromPct, toPct, atPct, steps, onClose,
}: {
  journey: Journey
  fromPct: number
  toPct: number
  atPct: number
  steps: AgentStep[]
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(15,23,42,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 8,
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
          width: 'min(720px, 96vw)',
          maxHeight: '85vh',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '14px 18px',
          borderBottom: `1px solid ${BORDER}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
            <span style={{
              width: 12, height: 12, borderRadius: '50%',
              background: journey.color, flexShrink: 0,
            }} />
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontWeight: 700, color: TEXT_DARK, fontSize: '0.9rem',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {journey.label}
              </div>
              <div style={{ fontSize: '0.72rem', color: TEXT_MUTED, marginTop: 2 }}>
                around {atPct}% ({fromPct}–{toPct}%) ·
                {' '}{steps.length} action{steps.length !== 1 ? 's' : ''}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: TEXT_LABEL,
              fontSize: '1.2rem', cursor: 'pointer', padding: '0 4px',
              lineHeight: 1, fontFamily: 'inherit',
            }}
            title="Close (Esc)"
          >✕</button>
        </div>

        {/* Step list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {steps.length === 0 ? (
            <div style={{ padding: 24, fontSize: '0.85rem', color: TEXT_MUTED, fontStyle: 'italic', textAlign: 'center' }}>
              No actions in this slice.
            </div>
          ) : (
            steps.map((s, i) => {
              const at = s.action_type ?? 'step'
              const ac = STEP_ACTION_COLORS[at] ?? '#475569'
              let path = s.url
              try { path = new URL(s.url).pathname || '/' } catch { /* keep */ }
              const det = (s as any).action_details ?? {}
              const detailStr = typeof det === 'object' && det !== null
                ? (det.text ?? det.value ?? det.url ?? det.element_text ?? '')
                : ''
              return (
                <div
                  key={i}
                  style={{
                    padding: '10px 18px',
                    borderBottom: '1px solid #f1f5f9',
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                  }}
                >
                  <span style={{
                    fontSize: '0.66rem', fontWeight: 700, color: ac,
                    background: `${ac}18`, padding: '2px 6px', borderRadius: 3,
                    textTransform: 'uppercase', letterSpacing: '0.02em',
                    flexShrink: 0, minWidth: 84, textAlign: 'center',
                  }}>{at.replace(/_/g, ' ')}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: '0.78rem', color: TEXT_DARK, fontFamily: 'monospace',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{path}</div>
                    {detailStr && (
                      <div style={{
                        fontSize: '0.72rem', color: TEXT_MUTED, marginTop: 2,
                        lineHeight: 1.4,
                      }}>
                        {String(detailStr).slice(0, 120)}{String(detailStr).length > 120 ? '…' : ''}
                      </div>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}