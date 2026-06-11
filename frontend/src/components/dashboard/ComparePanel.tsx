import { useRef, useEffect, useMemo, useState, type ReactNode } from 'react'
import * as d3 from 'd3'
import type { AgentStep } from '../agent/agentTypes'
import type { JourneyResponse, CompareHighlight } from '../../lib/api'

// ── UserSelection type ────────────────────────────────────────────────────────

type UserSelection =
  | { kind: 'page';    page: string;    side: 'ai' | 'human' }
  | { kind: 'action';  type: string;    side: 'ai' | 'human' }
  | { kind: 'stat';    metric: string;  side: 'ai' | 'human' }
  | { kind: 'section'; section: string; side?: 'ai' | 'human' }
  | null

// ── Action type glyphs ────────────────────────────────────────────────────────

function ActionGlyph({ type, size = 11 }: { type: string; size?: number }) {
  const s: React.CSSProperties = { display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, color: 'inherit' }
  switch (type) {
    case 'click_element':
      return <svg width={size} height={size} viewBox="0 0 10 10" fill="currentColor" style={s}>
        <path d="M1.5 0.5 L1.5 7.5 L3.5 5.5 L4.8 8.2 L6 7.7 L4.8 5 L7.5 5 Z" />
      </svg>
    case 'input_text':
      return <svg width={size} height={size} viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" fill="none" style={s}>
        <path d="M3 2h4M5 2v6M3 8h4" strokeLinecap="round" />
      </svg>
    case 'scroll':
      return <svg width={size} height={size} viewBox="0 0 10 10" fill="currentColor" style={s}>
        <path d="M5 1 L3 3.5 h4 Z M5 9 L3 6.5 h4 Z" />
        <rect x="4.3" y="3.4" width="1.4" height="3.2" />
      </svg>
    case 'navigate':
      return <svg width={size} height={size} viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" fill="none" style={s}>
        <path d="M1.5 5 h7 M6 2.5 l2.5 2.5 -2.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    case 'extract_content':
      return <svg width={size} height={size} viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.2" fill="none" style={s}>
        <rect x="1" y="3" width="6" height="6.5" rx="1" />
        <path d="M3.5 1 h4.5 a1 1 0 0 1 1 1 v4.5" strokeLinecap="round" />
      </svg>
    default:
      return <svg width={size} height={size} viewBox="0 0 10 10" fill="currentColor" style={s}>
        <circle cx="2" cy="5" r="1.3" /><circle cx="5" cy="5" r="1.3" /><circle cx="8" cy="5" r="1.3" />
      </svg>
  }
}

function BoldText({ text }: { text: string }) {
  const parts = text.split(/\*\*/)
  return <>{parts.map((part, i) => i % 2 === 1 ? <strong key={i}>{part}</strong> : part)}</>
}

function SideLabel({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: 'var(--fs-small)', fontWeight: 700, color: 'var(--gray400)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{children}</span>
}

function Collapse({ label, children, defaultOpen = true }: { label: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button onClick={() => setOpen(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%', background: 'none', border: 'none', padding: '0 0 4px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit' }}>
        <SideLabel>{label}</SideLabel>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--gray400)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0, transition: 'transform 0.15s', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
          <path d="M2 3.5l3 3 3-3"/>
        </svg>
      </button>
      {open && children}
    </div>
  )
}

const AI_COLOR      = '#32494B'
const HUMAN_COLOR   = '#881342'
const AI_PALETTE    = ['#32494B','#3d5b5d','#496e70','#558183','#619496','#6da7a9']
const HUMAN_PALETTE = ['#881342','#9e1852','#b41e62','#ca2472','#e02a82','#f63092']
const ACTION_TYPES  = ['click_element','input_text','scroll','navigate','extract_content','other']

function getPath(url: string) {
  try { return new URL(url).pathname.replace(/\/$/, '') || '/' } catch { return url.slice(0, 40) }
}

/** Count distinct sequential visits to each page (a new visit = page changes then returns). */
function countPageVisits(steps: AgentStep[]): Map<string, number> {
  const visits = new Map<string, number>()
  let prevPage = ''
  for (const s of steps) {
    const p = getPath(s.url)
    if (p !== prevPage) {
      visits.set(p, (visits.get(p) ?? 0) + 1)
      prevPage = p
    }
  }
  return visits
}
// Agent steps use time.time() (Unix seconds ~1.75e9).
// Human steps use browser timestamps (Unix milliseconds ~1.75e12).
// Normalise to milliseconds before computing durations.
function toMs(ts: number): number {
  return ts < 1e11 ? ts * 1000 : ts
}
function median(arr: number[]): number | null {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}
function avg(arr: number[]): number | null {
  if (!arr.length) return null
  return arr.reduce((a, b) => a + b, 0) / arr.length
}
function fmt(n: number | null, decimals = 1): string {
  if (n === null) return '—'
  return n % 1 === 0 ? String(n) : n.toFixed(decimals)
}

// ── Primitives ────────────────────────────────────────────────────────────────

// ── Stats grid ────────────────────────────────────────────────────────────────

const METRIC_LABEL_MAP: Record<string, string> = {
  median_steps: 'Median steps',
  unique_pages: 'Unique pages',
  click_rate: 'Click rate',
  scroll_rate: 'Scroll rate',
  avg_duration: 'Avg duration',
  total_steps: 'Total steps',
  avg_steps: 'Avg steps',
  shared_pages: 'Shared pages',
}

function StatsGrid({ items, color, highlightMetrics, onSelectMetric, selectedMetric, hasAnyHighlight }: {
  items: Array<{ label: string; value: string }>
  color: string
  highlightMetrics?: string[]
  onSelectMetric?: (label: string, side: 'ai' | 'human') => void
  selectedMetric?: string
  hasAnyHighlight?: boolean
}) {
  const hlLabels = highlightMetrics?.map(m => METRIC_LABEL_MAP[m]).filter(Boolean) ?? []
  const hasHl = hlLabels.length > 0
  const hasSel = !!selectedMetric
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, background: 'var(--gray100)', border: '1px solid var(--gray100)', borderRadius: 7, overflow: 'hidden' }}>
      {items.map((item, i) => {
        const isHl = hlLabels.includes(item.label)
        const isSel = selectedMetric === item.label
        const active = isHl || isSel
        const faded = (hasHl || hasSel || hasAnyHighlight) && !active
        return (
          <div
            key={i}
            onClick={() => onSelectMetric?.(item.label, color === AI_COLOR ? 'ai' : 'human')}
            className={isSel ? 'compare-sel-row' : undefined}
            style={{
              background: 'var(--white)',
              padding: '8px 8px',
              textAlign: 'center',
              cursor: onSelectMetric ? 'pointer' : undefined,
              opacity: faded ? 0.22 : 1,
              transition: 'opacity 0.2s',
              fontWeight: isHl ? 800 : undefined,
            }}
          >
            <div style={{ fontSize: isSel || isHl ? 'calc(var(--fs-body) * 1.15)' : 'var(--fs-body)', fontWeight: isSel || isHl ? 800 : 700, color, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{item.value}</div>
            <div style={{ fontSize: 'var(--fs-small)', color: 'var(--gray400)', marginTop: 3, fontWeight: isSel || isHl ? 800 : 500 }}>{item.label}</div>
          </div>
        )
      })}
    </div>
  )
}

// ── Donut ─────────────────────────────────────────────────────────────────────

function DonutChart({ steps, color, palette, label, highlightTypes, onSelectType, selectedType }: {
  steps: AgentStep[]
  color: string
  palette: string[]
  label: string
  highlightTypes?: string[]
  onSelectType?: (type: string | null) => void
  selectedType?: string
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    steps.forEach(s => { const t = ACTION_TYPES.includes(s.action_type) ? s.action_type : 'other'; m[t] = (m[t] ?? 0) + 1 })
    return ACTION_TYPES.map(t => ({ name: t.replace(/_/g, ' '), value: m[t] ?? 0, type: t })).filter(d => d.value > 0)
  }, [steps])

  useEffect(() => {
    const svg = d3.select(svgRef.current!)
    svg.selectAll('*').remove()
    if (!counts.length) return
    const hasHl = !!highlightTypes?.length
    const hasSel = !!selectedType
    const W = 260, H = 195, R = 48, R_HL = 56, r = 28
    svg.attr('viewBox', `0 0 ${W} ${H}`)
    const g = svg.append('g').attr('transform', `translate(${W / 2},${(H - 52) / 2})`)
    const pie = d3.pie<typeof counts[0]>().value(d => d.value).sort(null)
    const arcNormal = d3.arc<d3.PieArcDatum<typeof counts[0]>>().innerRadius(r).outerRadius(R)
    const arcHL = d3.arc<d3.PieArcDatum<typeof counts[0]>>().innerRadius(r).outerRadius(R_HL)
    const total = counts.reduce((s, d) => s + d.value, 0)
    const pieData = pie(counts)

    g.selectAll('path').data(pieData).join('path')
      .attr('d', d => {
        const isHl = hasHl && highlightTypes!.includes(d.data.type)
        const isSel = hasSel && d.data.type === selectedType
        return (isHl || isSel ? arcHL : arcNormal)(d) as string
      })
      .attr('class', d => hasSel && d.data.type === selectedType ? 'bar3d-sel' : '')
      .attr('fill', (_d, i) => palette[i % palette.length])
      .attr('opacity', d => {
        const active = hasHl || hasSel
        if (!active) return 1
        const isHl = hasHl && highlightTypes!.includes(d.data.type)
        const isSel = hasSel && d.data.type === selectedType
        return isHl || isSel ? 1 : 0.18
      })
      .attr('stroke', '#fff')
      .attr('stroke-width', d => {
        const isHl = hasHl && highlightTypes!.includes(d.data.type)
        const isSel = hasSel && d.data.type === selectedType
        return isHl || isSel ? 2.5 : 1.2
      })
      .style('cursor', 'pointer')
      .on('click', (_, d) => { onSelectType?.(selectedType === d.data.type ? null : d.data.type) })
      .append('title').text(d => `${d.data.name}: ${d.data.value}`)

    // Percentage labels on each segment
    const arcCentroid = d3.arc<d3.PieArcDatum<typeof counts[0]>>()
      .innerRadius((r + R) / 2)
      .outerRadius((r + R) / 2)
    pieData.forEach((d, i) => {
      const pct = total > 0 ? Math.round((d.data.value / total) * 100) : 0
      if (pct < 5) return
      const isHl = hasHl && highlightTypes!.includes(d.data.type)
      const isSel = hasSel && d.data.type === selectedType
      const active = isHl || isSel
      // hide % on faded segments — white text on near-transparent segment = white on white
      if ((hasHl || hasSel) && !active) return
      const [cx, cy] = arcCentroid.centroid(d)
      g.append('text')
        .attr('x', cx).attr('y', cy)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .style('font-size', active ? '9px' : '7.5px')
        .style('font-weight', '800')
        .style('fill', () => {
          const segColor = palette[i % palette.length]
          return d3.hsl(segColor).l > 0.52 ? '#1a2b42' : '#ffffff'
        })
        .attr('pointer-events', 'none')
        .text(`${pct}%`)
    })

    g.append('text').attr('text-anchor', 'middle').attr('dy', '-0.1em')
      .style('font', `bold 10px Inter, sans-serif`).style('fill', color).text(label)
    g.append('text').attr('text-anchor', 'middle').attr('dy', '1.1em')
      .style('font', `8.5px Inter, sans-serif`).style('fill', '#94a3b8').text(`${steps.length} steps`)

    const GLYPH: Record<string, string> = {
      click_element: '↗', input_text: 'T|', scroll: '⇅', navigate: '→', extract_content: '⊞', other: '…'
    }

    // Legend: all items, 2 columns up to 4 rows (12px each), 3 columns if > 4 items
    const legend = svg.append('g').attr('transform', `translate(2,${H - 50})`)
    counts.forEach((d, i) => {
      const isHl = hasHl && highlightTypes!.includes(d.type)
      const isSel = selectedType === d.type
      const pct = total > 0 ? Math.round((d.value / total) * 100) : 0

      let col: number, row: number, lx: number
      if (counts.length > 4) {
        col = Math.floor(i / 3)
        row = i % 3
        lx = col * (W / 3)
      } else {
        col = i < 2 ? 0 : 1
        row = i % 2
        lx = col * (W / 2)
      }
      const ly = row * 12

      legend.append('rect').attr('x', lx).attr('y', ly).attr('width', 6).attr('height', 6).attr('rx', 1)
        .attr('fill', palette[i % palette.length]).attr('opacity', hasHl ? (isHl ? 1 : 0.25) : 1)
      // glyph
      legend.append('text').attr('x', lx + 9).attr('y', ly + 5.5)
        .style('font-size', '7.5px').style('fill', '#94a3b8')
        .text(GLYPH[d.type] ?? '·')
      // label with percentage, no truncation
      legend.append('text').attr('x', lx + 18).attr('y', ly + 5.5)
        .style('font-size', isSel || isHl ? '8px' : '7.5px')
        .style('font-weight', isSel || isHl ? '800' : '400')
        .style('fill', (hasHl || hasSel) && !isHl && !isSel ? '#cbd5e1' : '#64748b')
        .text(`${d.name} ${pct}%`)
    })
  }, [counts, color, palette, label, highlightTypes, selectedType, onSelectType, steps.length])

  if (!counts.length) return <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 'var(--fs-small)' }}>No data</div>
  return <svg ref={svgRef} style={{ width: '100%', height: 'auto', display: 'block' }} />
}

// ── Session variance box plot ─────────────────────────────────────────────────

function BoxPlot({ counts, color, maxVal, selected, onClick }: {
  counts: number[]; color: string; maxVal?: number
  selected?: boolean; onClick?: () => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const svg = d3.select(svgRef.current!)
    svg.selectAll('*').remove()
    if (!counts.length) return

    const s = [...counts].sort((a, b) => a - b)
    const q1 = s[Math.floor(s.length * 0.25)]
    const med = s[Math.floor(s.length * 0.5)]
    const q3 = s[Math.floor(s.length * 0.75)]
    const iqr = q3 - q1
    const lo = Math.max(s[0], q1 - 1.5 * iqr)
    const hi = Math.min(s[s.length - 1], q3 + 1.5 * iqr)
    const outliers = s.filter(v => v < lo || v > hi)

    const W = 260, H = 70, m = { left: 8, right: 8, top: 10, bottom: 22 }
    const iw = W - m.left - m.right, ih = H - m.top - m.bottom
    svg.attr('viewBox', `0 0 ${W} ${H}`)

    const x = d3.scaleLinear().domain([0, (maxVal ?? (d3.max(counts) ?? 1)) * 1.1]).range([0, iw]).nice()
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`)

    g.append('g').attr('transform', `translate(0,${ih})`).call(d3.axisBottom(x).ticks(5).tickSize(3))
      .call(gg => gg.select('.domain').remove())
      .call(gg => gg.selectAll('text').style('font-size', '7.5px').style('fill', '#94a3b8'))

    const cy = ih / 2, bh = 16
    // whisker line
    g.append('line').attr('x1', x(lo)).attr('x2', x(hi)).attr('y1', cy).attr('y2', cy)
      .attr('stroke', color).attr('stroke-width', 1.2).attr('opacity', 0.55)
    // whisker caps
    ;[lo, hi].forEach(v => {
      g.append('line').attr('x1', x(v)).attr('x2', x(v)).attr('y1', cy - 5).attr('y2', cy + 5)
        .attr('stroke', color).attr('stroke-width', 1.2).attr('opacity', 0.55)
    })
    // IQR box fill
    g.append('rect').attr('x', x(q1)).attr('y', cy - bh / 2)
      .attr('width', Math.max(1, x(q3) - x(q1))).attr('height', bh)
      .attr('fill', color).attr('opacity', 0.15).attr('rx', 2)
    // IQR box border
    g.append('rect').attr('x', x(q1)).attr('y', cy - bh / 2)
      .attr('width', Math.max(1, x(q3) - x(q1))).attr('height', bh)
      .attr('fill', 'none').attr('stroke', color).attr('stroke-width', 1.3).attr('rx', 2)
    // median line
    g.append('line').attr('x1', x(med)).attr('x2', x(med)).attr('y1', cy - bh / 2).attr('y2', cy + bh / 2)
      .attr('stroke', color).attr('stroke-width', 2.2)
    // outliers
    outliers.forEach(v => {
      g.append('circle').attr('cx', x(v)).attr('cy', cy).attr('r', 3.5)
        .attr('fill', 'none').attr('stroke', color).attr('stroke-width', 1.3).attr('opacity', 0.7)
    })
    // legend: Q1 / med / Q3 labels — stagger vertically when values are close
    const rawLabels = [
      { v: q1, label: `Q1 ${q1}` },
      { v: med, label: `med ${med}` },
      { v: q3, label: `Q3 ${q3}` },
    ]
    // Deduplicate identical positions so we don't render 3 overlapping labels
    const seen = new Set<number>()
    const deduped: { v: number; label: string }[] = []
    for (const item of rawLabels) {
      const key = Math.round(x(item.v))
      if (!seen.has(key)) { seen.add(key); deduped.push(item) }
      else {
        // Merge label text onto the existing entry
        const existing = deduped.find(d => Math.round(x(d.v)) === key)
        if (existing && !existing.label.includes(item.label.split(' ')[0]))
          existing.label += ` / ${item.label}`
      }
    }
    // Stagger: if pixel distance < 32px between adjacent labels, alternate y offset
    deduped.sort((a, b) => x(a.v) - x(b.v))
    deduped.forEach((item, i) => {
      const prevX = i > 0 ? x(deduped[i - 1].v) : -999
      const yOff = (x(item.v) - prevX < 32 && i % 2 === 1) ? -11 : -2
      g.append('text').attr('x', x(item.v)).attr('y', yOff).attr('text-anchor', 'middle')
        .style('font-size', '7px').style('fill', color).style('opacity', '0.8').text(item.label)
    })
  }, [counts, color, maxVal])

  if (!counts.length)
    return <div style={{ height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 'var(--fs-small)' }}>No data</div>

  return (
    <div
      onClick={onClick}
      className={selected ? 'compare-sel-row' : undefined}
      style={{
        cursor: onClick ? 'pointer' : undefined,
        borderRadius: 4,
      }}
    >
      <svg ref={svgRef} style={{ width: '100%', height: 'auto', display: 'block' }} />
    </div>
  )
}

// ── Time per action bars ─────────────────────────────────────────────────────

function fmtSecs(secs: number): string {
  if (secs < 60) return `${Math.round(secs)}s`
  const m = Math.floor(secs / 60), s = Math.round(secs % 60)
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

function TimeActionBars({ steps, color, sessionCounts, highlightTypes, onSelectType, selectedType }: {
  steps: AgentStep[]
  color: string
  sessionCounts?: number[]
  highlightTypes?: string[]
  onSelectType?: (type: string | null) => void
  selectedType?: string
}) {
  const data = useMemo(() => {
    const timeByAction: Record<string, number> = {}
    const sessions = sessionCounts
      ? (() => {
          const out: AgentStep[][] = []
          let off = 0
          for (const c of sessionCounts) { out.push(steps.slice(off, off + c)); off += c }
          return out
        })()
      : [steps]

    for (const sess of sessions) {
      for (let i = 0; i < sess.length - 1; i++) {
        const dt = (toMs(sess[i + 1].timestamp) - toMs(sess[i].timestamp)) / 1000
        if (dt <= 0 || dt > 120) continue
        const type = ACTION_TYPES.includes(sess[i].action_type) ? sess[i].action_type : 'other'
        timeByAction[type] = (timeByAction[type] ?? 0) + dt
      }
    }

    return ACTION_TYPES
      .map(t => ({ type: t, name: t.replace(/_/g, ' '), secs: timeByAction[t] ?? 0 }))
      .filter(d => d.secs > 0)
      .sort((a, b) => b.secs - a.secs)
  }, [steps, sessionCounts])

  const max = Math.max(...data.map(d => d.secs), 1)
  if (!data.length) return <div style={{ height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 'var(--fs-small)' }}>No data</div>

  const hasHl = !!highlightTypes?.length
  const hasSel = !!selectedType

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {data.map(r => {
        const isHl = highlightTypes?.includes(r.type)
        const isSel = selectedType === r.type
        const faded = (hasHl || hasSel) && !isHl && !isSel
        return (
        <div
          key={r.type}
          className={isSel ? 'compare-sel-row' : undefined}
          onClick={() => onSelectType?.(isSel ? null : r.type)}
          style={{
            display: 'flex', alignItems: 'center', gap: 7,
            cursor: onSelectType ? 'pointer' : undefined,
            opacity: faded ? 0.18 : 1,
            transition: 'opacity 0.2s',
            borderLeft: isHl ? '3px solid var(--brand)' : undefined,
            paddingLeft: isHl ? 5 : undefined,
          }}
        >
          <div style={{ width: 86, fontSize: isHl ? 'calc(var(--fs-small) * 1.1)' : 'var(--fs-small)', color: 'var(--gray500)', flexShrink: 0, fontWeight: isSel || isHl ? 800 : undefined, display: 'flex', alignItems: 'center', gap: 4 }}>
            <ActionGlyph type={r.type} size={10} />
            {r.name}
          </div>
          <div style={{ flex: 1, height: isSel || isHl ? 8 : 5, background: 'var(--gray100)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${(r.secs / max) * 100}%`, height: '100%', background: color, borderRadius: 3 }} />
          </div>
          <div style={{ fontSize: isHl ? 'calc(var(--fs-small) * 1.1)' : 'var(--fs-small)', fontWeight: isSel || isHl ? 800 : 600, color: 'var(--gray500)', minWidth: 36, textAlign: 'right' }}>{fmtSecs(r.secs)}</div>
        </div>
        )
      })}
    </div>
  )
}

// ── Section divider row ───────────────────────────────────────────────────────

function SectionRow({ label, highlighted }: { label: string; highlighted?: boolean }) {
  const hl = highlighted
  const base: React.CSSProperties = {
    padding: '9px 20px 5px',
    fontSize: hl ? 'calc(var(--fs-small) * 1.15)' : 'var(--fs-small)',
    textTransform: 'uppercase', letterSpacing: '0.08em',
    color: hl ? 'var(--gray700)' : 'var(--gray500)',
    background: '#f8fafc',
    borderTop: '1px solid var(--gray100)',
    display: 'flex', alignItems: 'center', gap: 6,
    fontWeight: hl ? 800 : 700,
    textDecoration: hl ? 'underline' : undefined,
    textUnderlineOffset: hl ? '3px' : undefined,
    textDecorationThickness: hl ? '2px' : undefined,
  }
  return (
    <>
      <div style={base}>{label}</div>
      <div style={{ background: 'var(--gray150, #e8eaf0)', borderTop: '1px solid var(--gray100)' }} />
      <div style={base}>{label}</div>
    </>
  )
}

// ── Screenshot popup ─────────────────────────────────────────────────────────

interface PopupShot {
  url: string
  path: string
  step_number: number
  action_type: string
}

function ScreenshotPopup({ shots, initialIndex, onClose }: {
  shots: PopupShot[]
  initialIndex: number
  onClose: () => void
}) {
  const [idx, setIdx] = useState(initialIndex)
  const shot = shots[idx]

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft')  setIdx(i => Math.max(0, i - 1))
      if (e.key === 'ArrowRight') setIdx(i => Math.min(shots.length - 1, i + 1))
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [shots.length, onClose])

  const navBtn = (disabled: boolean): React.CSSProperties => ({
    background: disabled ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.1)',
    border: 'none', borderRadius: 8, width: 38, height: 38,
    cursor: disabled ? 'default' : 'pointer',
    color: disabled ? '#334155' : '#cbd5e1',
    fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  })

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(8,14,28,0.9)', backdropFilter: 'blur(10px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={onClose}
    >
      <div
        style={{ background: '#0d1829', borderRadius: 18, overflow: 'hidden', width: '100%', maxWidth: 860, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 48px 120px rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.07)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '11px 18px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(0,0,0,0.2)' }}>
          <span style={{ fontSize: 11, color: '#475569', fontVariantNumeric: 'tabular-nums', minWidth: 36 }}>{idx + 1} / {shots.length}</span>
          <span style={{ flex: 1, color: '#94a3b8', fontWeight: 600, fontSize: 'var(--fs-small)', fontFamily: 'monospace', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shot.path}</span>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.07)', border: 'none', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', color: '#94a3b8', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✕</button>
        </div>

        {/* Screenshot */}
        <div style={{ flex: 1, overflow: 'hidden', background: '#020810', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0 }}>
          <img src={shot.url} alt={shot.path} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }} />
        </div>

        {/* Footer nav + metadata */}
        <div style={{ padding: '10px 18px', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: 'rgba(0,0,0,0.25)' }}>
          <button disabled={idx === 0} onClick={() => setIdx(i => i - 1)} style={navBtn(idx === 0)}>←</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#475569', fontSize: 11 }}>
            <ActionGlyph type={shot.action_type} size={11} />
            <span style={{ color: '#64748b' }}>{shot.action_type.replace(/_/g, ' ')}</span>
            <span>·</span>
            <span style={{ color: '#64748b' }}>step {shot.step_number}</span>
          </div>
          <button disabled={idx === shots.length - 1} onClick={() => setIdx(i => i + 1)} style={navBtn(idx === shots.length - 1)}>→</button>
        </div>

        {/* Filmstrip */}
        {shots.length > 1 && (
          <div style={{ display: 'flex', gap: 5, padding: '8px 18px', background: '#06101e', overflowX: 'auto' }}>
            {shots.map((s, i) => (
              <div
                key={i}
                onClick={() => setIdx(i)}
                style={{ width: 72, height: 46, borderRadius: 5, overflow: 'hidden', flexShrink: 0, cursor: 'pointer', border: i === idx ? '2px solid #e2e8f0' : '2px solid rgba(255,255,255,0.06)', opacity: i === idx ? 1 : 0.45, transition: 'opacity 0.15s, border-color 0.15s' }}
              >
                <img src={s.url} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Screenshot strip (thumbnail row) ─────────────────────────────────────────

function ScreenshotStrip({ steps, filterFn, max = 6, onOpen }: {
  steps: AgentStep[]
  filterFn: (s: AgentStep) => boolean
  max?: number
  onOpen: (shots: PopupShot[], idx: number) => void
}) {
  const withScreenshot = (s: AgentStep) => !!(s.screenshot_url || s.screenshot_base64)
  const toShot = (s: AgentStep): PopupShot => ({
    url: s.screenshot_url ?? `data:image/png;base64,${s.screenshot_base64}`,
    path: getPath(s.url),
    step_number: s.step_number,
    action_type: s.action_type,
  })

  // Try filtered first; fall back to any steps with screenshots so we always show something
  let filtered = steps.filter(filterFn).filter(withScreenshot)
  if (!filtered.length) filtered = steps.filter(withScreenshot)
  const shots: PopupShot[] = filtered.slice(0, max).map(toShot)

  if (!shots.length) return <div style={{ fontSize: 11, color: 'var(--gray400)', fontStyle: 'italic' }}>No screenshots available</div>

  return (
    <div style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 2 }}>
      {shots.map((s, i) => (
        <div
          key={i}
          onClick={() => onOpen(shots, i)}
          style={{ width: 96, flexShrink: 0, cursor: 'pointer', borderRadius: 7, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--surface)', transition: 'transform 0.12s, box-shadow 0.12s' }}
          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.04)'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.18)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ''; (e.currentTarget as HTMLDivElement).style.boxShadow = '' }}
        >
          <div style={{ height: 62, overflow: 'hidden', background: '#0f172a' }}>
            <img src={s.url} alt={s.path} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          </div>
          <div style={{ padding: '3px 5px 4px', display: 'flex', alignItems: 'center', gap: 3 }}>
            <ActionGlyph type={s.action_type} size={8} />
            <span style={{ fontSize: 9, color: 'var(--gray400)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.path}</span>
          </div>
        </div>
      ))}
      {shots.length === max && (
        <div style={{ width: 96, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--gray400)' }}>+ more</div>
      )}
    </div>
  )
}

// ── BarChart (2D) ─────────────────────────────────────────────────────────────

function Bar3DChart({ data, color, maxVal, highlightValues, selectedValue, onSelect }: {
  data: Array<{ label: string; value: number; fullLabel?: string }>
  color: string
  maxVal?: number
  highlightValues?: string[]
  selectedValue?: string
  onSelect?: (label: string | null) => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const svg = d3.select(svgRef.current!)
    svg.selectAll('*').remove()
    if (!data.length) return

    const W = 260, H = 150
    const ml = 24, mr = 6, mt = 16, mb = 38
    const iw = W - ml - mr, ih = H - mt - mb
    svg.attr('viewBox', `0 0 ${W} ${H}`)
    const g = svg.append('g').attr('transform', `translate(${ml},${mt})`)

    const maxV = maxVal ?? Math.max(...data.map(d => d.value), 1)
    const n = data.length
    const bw = Math.min(28, Math.floor((iw / n) * 0.6))
    const totalBarW = bw * n
    const gapUnit = (iw - totalBarW) / (n + 1)
    const baseline = ih

    // Grid lines
    const yTicks = [0.25, 0.5, 0.75, 1.0].map(f => Math.round(maxV * f))
    yTicks.forEach(t => {
      const y = baseline - (t / maxV) * ih
      g.append('line').attr('x1', 0).attr('x2', iw).attr('y1', y).attr('y2', y)
        .attr('stroke', '#e2e8f0').attr('stroke-width', 0.6).attr('stroke-dasharray', '3,2')
      g.append('text').attr('x', -4).attr('y', y)
        .attr('text-anchor', 'end').attr('dominant-baseline', 'middle')
        .style('font-size', '6.5px').style('fill', '#9ca3af').text(t)
    })

    // Baseline
    g.append('line').attr('x1', 0).attr('x2', iw).attr('y1', baseline).attr('y2', baseline)
      .attr('stroke', '#d1d5db').attr('stroke-width', 0.8)

    const hasActive = !!(highlightValues?.length || selectedValue)

    data.forEach((d, i) => {
      const isHl = !!(highlightValues?.some(p => d.label === p || d.label.startsWith(p)))
      const isSel = selectedValue === d.label
      const active = isHl || isSel
      const opacity = hasActive && !active ? 0.1 : 1

      const x0 = gapUnit * (i + 1) + bw * i
      const bh = Math.max(1, (d.value / maxV) * ih)
      const y0 = baseline - bh
      const fill = active ? d3.rgb(color).brighter(0.25).formatHex() : color

      const barG = g.append('g')
        .attr('class', isSel ? 'bar3d-sel' : '')
        .attr('opacity', opacity)
        .style('cursor', onSelect ? 'pointer' : 'default')
        .on('click', () => onSelect?.(isSel ? null : d.label))

      barG.append('rect')
        .attr('x', x0).attr('y', y0).attr('width', bw).attr('height', bh)
        .attr('fill', fill).attr('rx', 2)

      if (d.value > 0) {
        g.append('text')
          .attr('x', x0 + bw / 2).attr('y', y0 - 3)
          .attr('text-anchor', 'middle')
          .style('font-size', '7.5px').style('font-weight', active ? '800' : '500')
          .style('fill', active ? d3.rgb(color).darker(0.15).formatHex() : '#94a3b8')
          .style('opacity', hasActive && !active ? 0.3 : 1)
          .attr('pointer-events', 'none')
          .text(d.value)
      }

      const shortLabel = d.label === '/' ? '/' : d.label.split('/').filter(Boolean).pop()?.slice(0, 12) ?? d.label
      g.append('text')
        .attr('x', x0 + bw / 2).attr('y', baseline + 8)
        .attr('text-anchor', 'middle')
        .attr('transform', `rotate(-22, ${x0 + bw / 2}, ${baseline + 8})`)
        .style('font-size', '7.5px').style('font-weight', active ? '800' : '500')
        .style('fill', active ? d3.rgb(color).darker(0.1).formatHex() : '#4b5563')
        .style('opacity', hasActive && !active ? 0.4 : 1)
        .style('cursor', onSelect ? 'pointer' : 'default')
        .on('click', () => onSelect?.(isSel ? null : d.label))
        .text(shortLabel)
    })
  }, [data, color, maxVal, highlightValues, selectedValue, onSelect])

  if (!data.length) return <div style={{ height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 'var(--fs-small)' }}>No data</div>
  return <svg ref={svgRef} style={{ width: '100%', height: 'auto', display: 'block' }} />
}

// ── Main ──────────────────────────────────────────────────────────────────────

const SECTION_LABELS: Record<string, string> = {
  stats: 'Summary Stats',
  action_breakdown: 'Action Breakdown',
  action_mix: 'Action Mix',
  steps_per_page: 'Steps per Page',
  page_revisits: 'Page Revisits',
  session_variance: 'Session Variance',
  time_per_action: 'Time per Action',
}

interface Props {
  agentSteps: AgentStep[]
  humanSteps: AgentStep[]
  agentJourneys: JourneyResponse[]
  humanSessionStepCounts: number[]
  humanSessionCount: number
  actionContext?: { highlight?: CompareHighlight; actionPointText?: string; taskTitle?: string; evidence?: string; explanation?: string } | null
  onClearActionContext?: () => void
  leftLabel?: string
  rightLabel?: string
  topBar?: ReactNode
}

export default function ComparePanel({ agentSteps, humanSteps, agentJourneys, humanSessionStepCounts, humanSessionCount, actionContext, topBar }: Props) {
  const [splitPct, setSplitPct] = useState(80)
  const [userSelection, setUserSelection] = useState<UserSelection>(null)
  const [popup, setPopup] = useState<{ shots: PopupShot[]; idx: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  function startDrag(e: React.MouseEvent) {
    e.preventDefault()
    const container = containerRef.current
    if (!container) return
    const onMove = (mv: MouseEvent) => {
      const rect = container.getBoundingClientRect()
      const pct = Math.min(80, Math.max(20, ((mv.clientX - rect.left) / rect.width) * 100))
      setSplitPct(pct)
    }
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // ── Selection helpers ────────────────────────────────────────────────────────
  function handleSelectPage(page: string | null, side: 'ai' | 'human') {
    if (!page) { setUserSelection(null); return }
    setUserSelection(prev =>
      prev && prev.kind === 'page' && prev.page === page && prev.side === side ? null : { kind: 'page', page, side }
    )
  }
  function handleSelectAction(type: string | null, side: 'ai' | 'human') {
    if (!type) { setUserSelection(null); return }
    setUserSelection(prev =>
      prev && prev.kind === 'action' && prev.type === type && prev.side === side ? null : { kind: 'action', type, side }
    )
  }
  function handleSelectMetric(label: string, side: 'ai' | 'human') {
    setUserSelection(prev =>
      prev && prev.kind === 'stat' && prev.metric === label && prev.side === side ? null : { kind: 'stat', metric: label, side }
    )
  }

  function handleSelectSection(section: string, side?: 'ai' | 'human') {
    setUserSelection(prev =>
      prev?.kind === 'section' && prev.section === section && prev.side === side ? null : { kind: 'section', section, side }
    )
  }

  const selPage    = userSelection?.kind === 'page'    ? userSelection.page    : undefined
  const selAction  = userSelection?.kind === 'action'  ? userSelection.type    : undefined
  const selMetric  = userSelection?.kind === 'stat'    ? userSelection.metric  : undefined
  const selSection = userSelection?.kind === 'section' ? userSelection.section : undefined
  const selSide    = userSelection?.side

  const stats = useMemo(() => {
    const aiCounts = agentJourneys.map(j => j.total_steps)
    const aiPages = new Set(agentSteps.map(s => getPath(s.url)))
    const humanPages = new Set(humanSteps.map(s => getPath(s.url)))
    const sharedPages = new Set([...aiPages].filter(p => humanPages.has(p)))
    const aiActions: Record<string, number> = {}, humanActions: Record<string, number> = {}
    agentSteps.forEach(s => { aiActions[s.action_type] = (aiActions[s.action_type] ?? 0) + 1 })
    humanSteps.forEach(s => { humanActions[s.action_type] = (humanActions[s.action_type] ?? 0) + 1 })
    const aiDurations = agentJourneys.map(j => {
      const steps = j.steps as AgentStep[]
      if (steps.length < 2) return null
      return (toMs(steps[steps.length - 1].timestamp) - toMs(steps[0].timestamp)) / 1000
    }).filter((d): d is number => d !== null)
    return {
      aiMedian: median(aiCounts), humanMedian: median(humanSessionStepCounts),
      aiAvg: avg(aiCounts), humanAvg: avg(humanSessionStepCounts),
      aiPages: aiPages.size, humanPages: humanPages.size, sharedPages: sharedPages.size,
      aiJourneys: agentJourneys.length, humanSessions: humanSessionCount,
      aiClickPct: agentSteps.length > 0 ? Math.round(((aiActions['click_element'] ?? 0) / agentSteps.length) * 100) : null,
      humanClickPct: humanSteps.length > 0 ? Math.round(((humanActions['click_element'] ?? 0) / humanSteps.length) * 100) : null,
      aiScrollPct: agentSteps.length > 0 ? Math.round(((aiActions['scroll'] ?? 0) / agentSteps.length) * 100) : null,
      humanScrollPct: humanSteps.length > 0 ? Math.round(((humanActions['scroll'] ?? 0) / humanSteps.length) * 100) : null,
      aiAvgDuration: avg(aiDurations),
      aiSteps: agentSteps.length, humanStepsTotal: humanSteps.length,
      aiIQR: (() => { const s = [...aiCounts].sort((a,b)=>a-b); return s.length >= 4 ? s[Math.floor(s.length*0.75)] - s[Math.floor(s.length*0.25)] : null })(),
      humanIQR: (() => { const s = [...humanSessionStepCounts].sort((a,b)=>a-b); return s.length >= 4 ? s[Math.floor(s.length*0.75)] - s[Math.floor(s.length*0.25)] : null })(),
      aiTotalSecs: aiDurations.length > 0 ? aiDurations.reduce((a, b) => a + b, 0) : null,
      humanTotalSecs: (() => {
        let total = 0, off = 0
        for (const c of humanSessionStepCounts) {
          const seg = humanSteps.slice(off, off + c)
          if (seg.length >= 2) { const d = (toMs(seg[seg.length - 1].timestamp) - toMs(seg[0].timestamp)) / 1000; if (d > 0) total += d }
          off += c
        }
        return total > 0 ? total : null
      })(),
    }
  }, [agentSteps, humanSteps, agentJourneys, humanSessionStepCounts, humanSessionCount])

  // ── Highlight helpers ────────────────────────────────────────────────────────
  const hl = actionContext?.highlight ?? null
  const isHL = (section: string) => !!(hl?.sections?.includes(section as never))
  const sideMatch = (side: 'ai' | 'human') => !hl?.side || hl.side === 'both' || hl.side === side
  const cellBg = (_section: string, _side: 'ai' | 'human'): React.CSSProperties => ({})
  const hlTypes = (section: string, side: 'ai' | 'human') =>
    isHL(section) && sideMatch(side) ? hl?.action_types : undefined
  const hlPages = (section: string, side: 'ai' | 'human') =>
    isHL(section) && sideMatch(side) ? hl?.pages : undefined
  const hlMetrics = (side: 'ai' | 'human') =>
    isHL('stats') && sideMatch(side) ? hl?.metrics : undefined

  const anyHl = !!(hl?.sections?.length || hl?.action_types?.length || hl?.pages?.length || hl?.metrics?.length)
  // Don't dim sections when the user has made a manual selection (action-point highlighting is secondary)
  const dimSection = (section: string) => anyHl && !isHL(section) && userSelection === null

  const aiWins = stats.aiMedian !== null && stats.humanMedian !== null && stats.aiMedian <= stats.humanMedian
  const agentStepCounts = agentJourneys.map(j => j.total_steps)

  // Shared scales so left and right charts are directly comparable
  const sharedPageMax = useMemo(() => {
    const countPages = (steps: AgentStep[]) => {
      const m = new Map<string, number>()
      steps.forEach(s => { const p = getPath(s.url); m.set(p, (m.get(p) ?? 0) + 1) })
      return Math.max(...Array.from(m.values()), 0)
    }
    return Math.max(countPages(agentSteps), countPages(humanSteps), 1)
  }, [agentSteps, humanSteps])

  const sharedRevisitMax = useMemo(() => {
    const maxRevisit = (steps: AgentStep[]) => {
      const visits = countPageVisits(steps)
      return Math.max(...Array.from(visits.values()).filter(v => v > 1), 0)
    }
    return Math.max(maxRevisit(agentSteps), maxRevisit(humanSteps), 1)
  }, [agentSteps, humanSteps])

  const sharedStepMax = Math.max(...agentStepCounts, ...humanSessionStepCounts, 1)

  // ── Page data for Bar3DChart ──────────────────────────────────────────────────
  const aiPageData = useMemo(() => {
    const m = new Map<string, number>()
    agentSteps.forEach(s => { const p = getPath(s.url); m.set(p, (m.get(p) ?? 0) + 1) })
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value }))
  }, [agentSteps])

  const humanPageData = useMemo(() => {
    const m = new Map<string, number>()
    humanSteps.forEach(s => { const p = getPath(s.url); m.set(p, (m.get(p) ?? 0) + 1) })
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value }))
  }, [humanSteps])

  const aiRevisitData = useMemo(() => {
    const visits = countPageVisits(agentSteps)
    return Array.from(visits.entries())
      .filter(([, c]) => c > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([label, value]) => ({ label, value }))
  }, [agentSteps])

  const humanRevisitData = useMemo(() => {
    const visits = countPageVisits(humanSteps)
    return Array.from(visits.entries())
      .filter(([, c]) => c > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([label, value]) => ({ label, value }))
  }, [humanSteps])

  // Early return must come AFTER all hooks — a conditional hook count crashes
  // React when data arrives after an empty first render.
  if (agentSteps.length === 0 && humanSteps.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8', fontSize: 'var(--fs-body)' }}>
        No data yet — run an agent or record a human session.
      </div>
    )
  }

  const aiAdvantages = [
    `Covers ${stats.aiPages} unique pages systematically — no exploratory detours`,
    `Scrolls ${stats.aiScrollPct ?? '—'}% of the time; reads the full page before acting`,
    stats.aiAvgDuration !== null ? `Completes runs in ~${fmt(stats.aiAvgDuration, 0)}s with no scheduling overhead` : 'Runs headlessly at browser speed with no overhead',
    `Consistent strategy every run — regressions are easy to catch`,
    aiWins ? `More direct path: median ${fmt(stats.aiMedian, 0)} steps vs ${fmt(stats.humanMedian, 0)} human` : `Structured traversal surfaces dead-ends humans skip past`,
  ]
  const aiLimitations = [
    'Backtracks on vague nav labels (e.g. "Solutions" vs "Products")',
    'Cannot perceive visual hierarchy or trust signals from design emphasis',
    'Misses emotional friction — cluttered and clean pages look the same structurally',
  ]
  const humanAdvantages = [
    'Registers immediately when a page feels cluttered, slow, or untrustworthy',
    'Applies prior knowledge and domain shortcuts unavailable to the agent',
    `Click-dominant pattern (${stats.humanClickPct ?? '—'}%) reflects real user behaviour`,
    'Catches perceptual and emotional friction that drives real drop-off',
    !aiWins ? `More efficient path: median ${fmt(stats.humanMedian, 0)} steps vs ${fmt(stats.aiMedian, 0)} AI` : `Confirms primary task path is usable for real users`,
  ]
  const humanLimitations = [
    'High variance across sessions — hard to reproduce failures consistently',
    'Frequently misses CTAs placed below the fold',
    `Only ${stats.humanSessions} session${stats.humanSessions !== 1 ? 's' : ''} — small sample limits confidence`,
    'Fatigue and scheduling overhead degrade quality in longer runs',
  ]

  const insights: Array<{ title: string; text: string; tag?: string }> = []

  if (stats.aiMedian !== null || stats.humanMedian !== null) {
    const ai = fmt(stats.aiMedian, 0), hu = fmt(stats.humanMedian, 0)
    insights.push({
      title: 'Efficiency',
      tag: aiWins ? 'AI faster' : 'Human faster',
      text: aiWins
        ? `The AI agent completes tasks in a median of **${ai} steps**, versus **${hu}** for human testers. The agent follows a more direct path with less exploration.`
        : `Human testers complete tasks in a median of **${hu} steps**, versus **${ai}** for the AI agent. Humans apply prior knowledge and shortcuts the agent cannot replicate.`,
    })
  }

  if (stats.aiClickPct !== null || stats.humanClickPct !== null) {
    const aiC = stats.aiClickPct ?? 0, huC = stats.humanClickPct ?? 0
    insights.push({
      title: 'Interaction style',
      text: huC > aiC
        ? `Humans are more click-dominant (**${huC}%** of actions) compared to the AI (**${aiC}%**). The agent spends more time reading and scrolling before acting, which reflects its inability to infer context visually.`
        : `The AI and humans have similar click rates (AI **${aiC}%** vs Human **${huC}%**). Their interaction patterns are broadly aligned on this site.`,
    })
  }

  if (stats.sharedPages > 0) {
    const overlap = stats.aiPages > 0 ? Math.round((stats.sharedPages / stats.aiPages) * 100) : 0
    insights.push({
      title: 'Page coverage',
      text: `Both visited **${stats.sharedPages}** of the same pages (**${overlap}%** overlap with the AI's path). The AI reached **${stats.aiPages}** unique pages; humans reached **${stats.humanPages > 0 ? stats.humanPages : '—'}**. Pages visited by one but not the other may reveal navigation gaps.`,
    })
  }

  if (stats.aiScrollPct !== null) {
    insights.push({
      title: 'Scroll behaviour',
      text: `The AI scrolls on **${stats.aiScrollPct}%** of steps — it reads the full page before deciding. Humans scroll **${stats.humanScrollPct ?? '—'}%** of steps. A large gap here means the agent is reading content humans skip, potentially surfacing hidden issues.`,
    })
  }

  if (stats.aiAvgDuration !== null) {
    insights.push({
      title: 'Session length',
      text: `Average AI run duration is **~${fmt(stats.aiAvgDuration, 0)}s**. The agent runs headlessly with no setup overhead, making it fast to rerun after changes. Human sessions require scheduling and briefing.`,
    })
  }

  if (stats.aiIQR !== null || stats.humanIQR !== null) {
    const aiIqr = stats.aiIQR !== null ? `AI IQR: **${fmt(stats.aiIQR, 0)} steps**` : null
    const huIqr = stats.humanIQR !== null ? `Human IQR: **${fmt(stats.humanIQR, 0)} steps**` : null
    const consistent = (stats.aiIQR ?? Infinity) < (stats.humanIQR ?? Infinity)
    insights.push({
      title: 'Session variance',
      tag: consistent ? 'AI more consistent' : 'Human more consistent',
      text: [aiIqr, huIqr].filter(Boolean).join(' · ') + `. The box plot shows the interquartile range (Q1–Q3) for each side. A narrow box means runs are predictable; a wide box or outliers (open circles) indicate sessions that deviate significantly from the norm and may be worth investigating individually.`,
    })
  }

  insights.push({
    title: 'AI strengths',
    text: aiAdvantages.join(' · '),
  })
  insights.push({
    title: 'AI limitations',
    text: aiLimitations.join(' · '),
  })
  insights.push({
    title: 'Human strengths',
    text: humanAdvantages.join(' · '),
  })
  insights.push({
    title: 'Human limitations',
    text: humanLimitations.join(' · '),
  })

  // ── Selection detail block ────────────────────────────────────────────────────
  const stepsForSide = selSide === 'ai' ? agentSteps : humanSteps
  const sideLabel = selSide === 'ai' ? 'AI Agent' : 'Human'

  function SelectionDetail() {
    if (!userSelection) return null
    const { kind } = userSelection

    let headerText = ''
    let bodyContent: ReactNode = null

    if (kind === 'page') {
      const { page } = userSelection
      const stepsOnPage = stepsForSide.filter(s => getPath(s.url) === page)
      const totalCount = stepsOnPage.length
      // Count distinct journeys/sessions that visited this page
      const sessionIds = new Set(stepsOnPage.map(s => (s as AgentStep & { session_id?: string; journey_id?: string }).session_id ?? (s as AgentStep & { journey_id?: string }).journey_id ?? '').filter(Boolean))
      headerText = `${sideLabel}: ${page}`
      bodyContent = (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, fontSize: 11, color: 'var(--gray500)' }}>
            <span><strong style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{totalCount}</strong> steps</span>
            {sessionIds.size > 0 && <><span>·</span><span><strong style={{ color: 'var(--text-primary)' }}>{sessionIds.size}</strong> sessions</span></>}
          </div>
          <ScreenshotStrip steps={agentSteps} filterFn={s => getPath(s.url) === page} onOpen={(shots, i) => setPopup({ shots, idx: i })} />
        </>
      )
    } else if (kind === 'action') {
      const { type } = userSelection
      const matchingSteps = stepsForSide.filter(s => {
        const t = ACTION_TYPES.includes(s.action_type) ? s.action_type : 'other'
        return t === type
      })
      const count = matchingSteps.length
      const total = stepsForSide.length || 1
      const pct = Math.round((count / total) * 100)
      headerText = `${sideLabel}: ${type.replace(/_/g, ' ')}`
      bodyContent = (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, fontSize: 11, color: 'var(--gray500)' }}>
            <span><strong style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{count}</strong> occurrences</span>
            <span>·</span>
            <span><strong style={{ color: 'var(--text-primary)' }}>{pct}%</strong> of steps</span>
          </div>
          <ScreenshotStrip steps={agentSteps} filterFn={s => {
            const t = ACTION_TYPES.includes(s.action_type) ? s.action_type : 'other'
            return t === type
          }} onOpen={(shots, i) => setPopup({ shots, idx: i })} />
        </>
      )
    } else if (kind === 'section') {
      const { section } = userSelection
      headerText = `${sideLabel}: ${SECTION_LABELS[section] ?? section}`
      const sectionSteps = stepsForSide
      bodyContent = (
        <>
          <div style={{ fontSize: 'var(--fs-small)', color: 'var(--gray500)', marginBottom: 8, lineHeight: 1.6 }}>
            {section === 'session_variance'
              ? `Session step counts: ${sectionSteps.length} total steps across ${agentJourneys.length} run${agentJourneys.length !== 1 ? 's' : ''}`
              : `${sectionSteps.length} steps on the ${sideLabel} side`}
          </div>
          <ScreenshotStrip
            steps={agentSteps}
            filterFn={() => true}
            onOpen={(shots, i) => setPopup({ shots, idx: i })}
          />
        </>
      )
    } else if (kind === 'stat') {
      const { metric } = userSelection
      // Find the value from stats grid items
      const aiItems = [
        { label: 'Median steps', value: fmt(stats.aiMedian, 0) },
        { label: 'Unique pages', value: String(stats.aiPages) },
        { label: 'Click rate', value: stats.aiClickPct !== null ? `${stats.aiClickPct}%` : '—' },
        { label: 'Scroll rate', value: stats.aiScrollPct !== null ? `${stats.aiScrollPct}%` : '—' },
        { label: 'Avg duration', value: stats.aiAvgDuration !== null ? `${fmt(stats.aiAvgDuration, 0)}s` : '—' },
        { label: 'Total steps', value: String(stats.aiSteps) },
      ]
      const humanItems = [
        { label: 'Median steps', value: fmt(stats.humanMedian, 0) },
        { label: 'Unique pages', value: stats.humanPages > 0 ? String(stats.humanPages) : '—' },
        { label: 'Click rate', value: stats.humanClickPct !== null ? `${stats.humanClickPct}%` : '—' },
        { label: 'Scroll rate', value: stats.humanScrollPct !== null ? `${stats.humanScrollPct}%` : '—' },
        { label: 'Avg steps', value: fmt(stats.humanAvg) },
        { label: 'Shared pages', value: String(stats.sharedPages) },
      ]
      const items = selSide === 'ai' ? aiItems : humanItems
      const item = items.find(it => it.label === metric)
      const metricExplanations: Record<string, string> = {
        'Median steps': 'The midpoint number of steps across all sessions/runs. Half of sessions used fewer steps, half used more.',
        'Unique pages': 'The number of distinct URL paths visited across all sessions/runs.',
        'Click rate': 'Percentage of all steps that are click actions.',
        'Scroll rate': 'Percentage of all steps that are scroll actions.',
        'Avg duration': 'Average total time per session/run, measured from the first to last step.',
        'Total steps': 'Total number of recorded steps across all sessions/runs.',
        'Avg steps': 'Average number of steps per session.',
        'Shared pages': 'Number of pages visited by both the AI and at least one human session.',
      }
      headerText = `${sideLabel}: ${metric}`
      bodyContent = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{item?.value ?? '—'}</div>
            <div style={{ fontSize: 'var(--fs-small)', color: 'var(--gray400)', marginTop: 2 }}>{metric}</div>
          </div>
          {metricExplanations[metric] && (
            <p style={{ margin: 0, fontSize: 'var(--fs-body)', color: 'var(--gray600)', lineHeight: 1.6 }}>{metricExplanations[metric]}</p>
          )}
        </div>
      )
    }

    return (
      <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--white)', flexShrink: 0 }}>
        {/* Card header */}
        <div style={{ padding: '9px 14px', background: 'var(--gray50, #f8fafc)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 'var(--fs-body)', color: 'var(--text-primary)', minWidth: 0 }}>
            {kind === 'action' && userSelection.kind === 'action' && <ActionGlyph type={userSelection.type} size={13} />}
            <span style={{ fontFamily: kind === 'page' ? 'monospace' : undefined, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{headerText}</span>
          </div>
          <button onClick={() => setUserSelection(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray400)', fontSize: 15, lineHeight: 1, padding: '0 2px', flexShrink: 0 }} title="Clear">×</button>
        </div>
        {/* Card body */}
        <div style={{ padding: '10px 14px' }}>
          {bodyContent}
        </div>
      </div>
    )
  }

  return (
    <>
    <div ref={containerRef} style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── LEFT: charts ── */}
      <div style={{ flex: `0 0 ${splitPct}%`, minWidth: 0, overflowY: 'auto', background: '#fff' }}>
        {topBar && (
          <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
            {topBar}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1px 1fr', background: '#fff' }}>


          {/* Stats */}
          <div style={{ padding: '0 20px 14px', ...cellBg('stats', 'ai'), opacity: dimSection('stats') ? 0.25 : 1, transition: 'opacity 0.2s' }}>
            <StatsGrid items={[
              { label: 'Median steps', value: fmt(stats.aiMedian, 0) },
              { label: 'Unique pages', value: String(stats.aiPages) },
              { label: 'Click rate', value: stats.aiClickPct !== null ? `${stats.aiClickPct}%` : '—' },
              { label: 'Scroll rate', value: stats.aiScrollPct !== null ? `${stats.aiScrollPct}%` : '—' },
              { label: 'Avg duration', value: stats.aiAvgDuration !== null ? `${fmt(stats.aiAvgDuration, 0)}s` : '—' },
              { label: 'Total steps', value: String(stats.aiSteps) },
            ]} color={AI_COLOR} highlightMetrics={hlMetrics('ai')}
              onSelectMetric={(label) => handleSelectMetric(label, 'ai')}
              selectedMetric={selSide === 'ai' ? selMetric : undefined}
              hasAnyHighlight={anyHl && !isHL('stats')}
            />
          </div>
          <div style={{ background: 'var(--border)' }} />
          <div style={{ padding: '0 20px 14px', ...cellBg('stats', 'human'), opacity: dimSection('stats') ? 0.25 : 1, transition: 'opacity 0.2s' }}>
            <StatsGrid items={[
              { label: 'Median steps', value: fmt(stats.humanMedian, 0) },
              { label: 'Unique pages', value: stats.humanPages > 0 ? String(stats.humanPages) : '—' },
              { label: 'Click rate', value: stats.humanClickPct !== null ? `${stats.humanClickPct}%` : '—' },
              { label: 'Scroll rate', value: stats.humanScrollPct !== null ? `${stats.humanScrollPct}%` : '—' },
              { label: 'Avg steps', value: fmt(stats.humanAvg) },
              { label: 'Shared pages', value: String(stats.sharedPages) },
            ]} color={HUMAN_COLOR} highlightMetrics={hlMetrics('human')}
              onSelectMetric={(label) => handleSelectMetric(label, 'human')}
              selectedMetric={selSide === 'human' ? selMetric : undefined}
              hasAnyHighlight={anyHl && !isHL('stats')}
            />
          </div>

          <SectionRow label="Action breakdown" highlighted={isHL('action_breakdown')} />
          <div style={{ padding: '8px 20px 14px', opacity: dimSection('action_breakdown') ? 0.25 : 1, transition: 'opacity 0.2s' }}>
            <DonutChart steps={agentSteps} color={AI_COLOR} palette={AI_PALETTE} label="AI"
              highlightTypes={hlTypes('action_breakdown', 'ai')}
              onSelectType={(t) => handleSelectAction(t, 'ai')}
              selectedType={selSide === 'ai' ? selAction : undefined}
            />
          </div>
          <div style={{ background: 'var(--border)' }} />
          <div style={{ padding: '8px 20px 14px', opacity: dimSection('action_breakdown') ? 0.25 : 1, transition: 'opacity 0.2s' }}>
            <DonutChart steps={humanSteps} color={HUMAN_COLOR} palette={HUMAN_PALETTE} label="Human"
              highlightTypes={hlTypes('action_breakdown', 'human')}
              onSelectType={(t) => handleSelectAction(t, 'human')}
              selectedType={selSide === 'human' ? selAction : undefined}
            />
          </div>

          <SectionRow label="Steps per page" highlighted={isHL('steps_per_page')} />
          <div style={{ padding: '8px 20px 14px', opacity: dimSection('steps_per_page') ? 0.25 : 1, transition: 'opacity 0.2s' }}>
            <Bar3DChart data={aiPageData} color={AI_COLOR} maxVal={sharedPageMax}
              highlightValues={hlPages('steps_per_page', 'ai')}
              selectedValue={selSide === 'ai' ? selPage : undefined}
              onSelect={p => handleSelectPage(p, 'ai')} />
          </div>
          <div style={{ background: 'var(--border)' }} />
          <div style={{ padding: '8px 20px 14px', opacity: dimSection('steps_per_page') ? 0.25 : 1, transition: 'opacity 0.2s' }}>
            <Bar3DChart data={humanPageData} color={HUMAN_COLOR} maxVal={sharedPageMax}
              highlightValues={hlPages('steps_per_page', 'human')}
              selectedValue={selSide === 'human' ? selPage : undefined}
              onSelect={p => handleSelectPage(p, 'human')} />
          </div>

          <SectionRow label="Page revisits" highlighted={isHL('page_revisits')} />
          <div style={{ padding: '8px 20px 14px', opacity: dimSection('page_revisits') ? 0.25 : 1, transition: 'opacity 0.2s' }}>
            <Bar3DChart data={aiRevisitData} color={AI_COLOR} maxVal={sharedRevisitMax}
              highlightValues={hlPages('page_revisits', 'ai')}
              selectedValue={selSide === 'ai' ? selPage : undefined}
              onSelect={p => handleSelectPage(p, 'ai')} />
          </div>
          <div style={{ background: 'var(--border)' }} />
          <div style={{ padding: '8px 20px 14px', opacity: dimSection('page_revisits') ? 0.25 : 1, transition: 'opacity 0.2s' }}>
            <Bar3DChart data={humanRevisitData} color={HUMAN_COLOR} maxVal={sharedRevisitMax}
              highlightValues={hlPages('page_revisits', 'human')}
              selectedValue={selSide === 'human' ? selPage : undefined}
              onSelect={p => handleSelectPage(p, 'human')} />
          </div>

          <SectionRow label="Session variance" highlighted={isHL('session_variance')} />
          <div style={{ padding: '8px 20px 14px', opacity: dimSection('session_variance') ? 0.25 : 1, transition: 'opacity 0.2s' }}>
            <BoxPlot counts={agentStepCounts} color={AI_COLOR} maxVal={sharedStepMax}
              selected={selSection === 'session_variance' && selSide === 'ai'}
              onClick={() => handleSelectSection('session_variance', 'ai')} />
          </div>
          <div style={{ background: 'var(--border)' }} />
          <div style={{ padding: '8px 20px 14px', opacity: dimSection('session_variance') ? 0.25 : 1, transition: 'opacity 0.2s' }}>
            <BoxPlot counts={humanSessionStepCounts} color={HUMAN_COLOR} maxVal={sharedStepMax}
              selected={selSection === 'session_variance' && selSide === 'human'}
              onClick={() => handleSelectSection('session_variance', 'human')} />
          </div>

          <SectionRow label="Time per action" highlighted={isHL('time_per_action')} />
          <div style={{ padding: '8px 20px 14px', display: 'flex', flexDirection: 'column', gap: 8, ...cellBg('time_per_action', 'ai'), opacity: dimSection('time_per_action') ? 0.25 : 1, transition: 'opacity 0.2s' }}>
            <StatsGrid items={[{ label: 'Total time', value: stats.aiTotalSecs !== null ? fmtSecs(stats.aiTotalSecs) : '—' }]} color={AI_COLOR} />
            <TimeActionBars steps={agentSteps} color={AI_COLOR} sessionCounts={agentJourneys.map(j => (j.steps as AgentStep[]).length)} highlightTypes={hlTypes('time_per_action', 'ai')}
              onSelectType={(t) => handleSelectAction(t, 'ai')}
              selectedType={selSide === 'ai' ? selAction : undefined}
            />
          </div>
          <div style={{ background: 'var(--border)' }} />
          <div style={{ padding: '8px 20px 14px', display: 'flex', flexDirection: 'column', gap: 8, ...cellBg('time_per_action', 'human'), opacity: dimSection('time_per_action') ? 0.25 : 1, transition: 'opacity 0.2s' }}>
            <StatsGrid items={[{ label: 'Total time', value: stats.humanTotalSecs !== null ? fmtSecs(stats.humanTotalSecs) : '—' }]} color={HUMAN_COLOR} />
            <TimeActionBars steps={humanSteps} color={HUMAN_COLOR} sessionCounts={humanSessionStepCounts} highlightTypes={hlTypes('time_per_action', 'human')}
              onSelectType={(t) => handleSelectAction(t, 'human')}
              selectedType={selSide === 'human' ? selAction : undefined}
            />
          </div>

        </div>
      </div>

      {/* ── Draggable divider ── */}
      <div
        onMouseDown={startDrag}
        style={{ width: 5, flexShrink: 0, cursor: 'col-resize', background: 'var(--border)', transition: 'background 0.15s' }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'var(--border)')}
      />

      {/* ── RIGHT: action-point context or generic insights ── */}
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', background: 'var(--surface)', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Selection detail block — shown above existing content when a selection exists */}
        {SelectionDetail()}

        {actionContext ? (
          <>
            {/* Task */}
            {actionContext.taskTitle && (
              <div style={{ borderBottom: '1.5px solid var(--border)', paddingBottom: 8 }}>
                <span style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--text-primary)', flexShrink: 0 }}>Task: </span>
                <span style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--text-primary)' }}>{actionContext.taskTitle}</span>
              </div>
            )}

            {/* Action point */}
            {actionContext.actionPointText && (
              <Collapse label="Action Point">
                <p style={{ margin: 0, fontSize: 'var(--fs-body)', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.6 }}>{actionContext.actionPointText}</p>
              </Collapse>
            )}

            {/* Evidence */}
            {actionContext.evidence && (
              <Collapse label="Evidence">
                <p style={{ margin: 0, fontSize: 'var(--fs-body)', color: 'var(--gray600)', lineHeight: 1.6 }}>{actionContext.evidence}</p>
              </Collapse>
            )}

            {/* How this connects */}
            {actionContext.explanation && (
              <Collapse label="How this connects">
                <p style={{ margin: 0, fontSize: 'var(--fs-body)', color: 'var(--gray600)', lineHeight: 1.6 }}>{actionContext.explanation}</p>
              </Collapse>
            )}

            {/* Highlighted */}
            {hl && (hl.sections?.length || hl.action_types?.length || hl.pages?.length || hl.metrics?.length) ? (
              <Collapse label="Highlighted">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {hl.side && hl.side !== 'both' && (
                    <p style={{ margin: 0, fontSize: 'var(--fs-body)', color: 'var(--gray600)' }}>
                      Focus: <strong>{hl.side === 'ai' ? 'AI Agent' : 'Human'}</strong>
                    </p>
                  )}
                  {[
                    { label: 'Sections', items: hl.sections?.map(s => SECTION_LABELS[s] ?? s) },
                    { label: 'Actions',  items: hl.action_types?.map(a => a.replace(/_/g, ' ')) },
                    { label: 'Pages',    items: hl.pages },
                    { label: 'Metrics',  items: hl.metrics?.map(m => METRIC_LABEL_MAP[m] ?? m) },
                  ].filter(g => g.items?.length).map(g => (
                    <div key={g.label} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <SideLabel>{g.label}</SideLabel>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {g.items!.map(item => (
                          <span key={item} style={{ fontSize: 'var(--fs-small)', fontWeight: 600, padding: '2px 7px', borderRadius: 5, border: '1px solid var(--gray200)', color: 'var(--gray700)', background: 'var(--gray100)' }}>
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Collapse>
            ) : null}
          </>
        ) : (
          <>
            <div style={{ borderBottom: '1.5px solid var(--border)', paddingBottom: 8 }}>
              <span style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--text-primary)' }}>What the charts show</span>
            </div>
            {insights.map((ins, i) => (
              <Collapse key={i} label={ins.title}>
                <p style={{ margin: 0, fontSize: 'var(--fs-body)', color: 'var(--gray600)', lineHeight: 1.6 }}><BoldText text={ins.text} /></p>
              </Collapse>
            ))}
          </>
        )}
      </div>

    </div>

    {popup && (
      <ScreenshotPopup shots={popup.shots} initialIndex={popup.idx} onClose={() => setPopup(null)} />
    )}
    </>
  )
}
