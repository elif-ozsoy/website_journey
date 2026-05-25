import { useRef, useEffect, useMemo, useState } from 'react'
import * as d3 from 'd3'
import type { AgentStep } from '../agent/agentTypes'
import type { JourneyResponse, CompareHighlight } from '../../lib/api'

const AI_COLOR      = '#32494B'
const HUMAN_COLOR   = '#881342'
const AI_PALE       = '#e0ecee'
const HUMAN_PALE    = '#f7d5e2'
const AI_PALETTE    = ['#32494B','#3d5b5d','#496e70','#558183','#619496','#6da7a9']
const HUMAN_PALETTE = ['#881342','#9e1852','#b41e62','#ca2472','#e02a82','#f63092']
const ACTION_TYPES  = ['click_element','input_text','scroll','navigate','extract_content','other']

function getPath(url: string) {
  try { return new URL(url).pathname.replace(/\/$/, '') || '/' } catch { return url.slice(0, 40) }
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

function StatsGrid({ items, color, highlightMetrics }: { items: Array<{ label: string; value: string }>; color: string; highlightMetrics?: string[] }) {
  const hlLabels = highlightMetrics?.map(m => METRIC_LABEL_MAP[m]).filter(Boolean) ?? []
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, background: 'var(--gray100)', border: '1px solid var(--gray100)', borderRadius: 7, overflow: 'hidden' }}>
      {items.map((item, i) => {
        const isHl = hlLabels.includes(item.label)
        return (
          <div key={i} style={{ background: isHl ? 'rgba(37,99,235,0.07)' : 'var(--white)', padding: '8px 8px', textAlign: 'center', boxShadow: isHl ? 'inset 0 0 0 1.5px rgba(37,99,235,0.3)' : undefined }}>
            <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{item.value}</div>
            <div style={{ fontSize: 'var(--fs-small)', color: isHl ? 'var(--brand)' : 'var(--gray400)', marginTop: 3, fontWeight: isHl ? 700 : 500 }}>{item.label}</div>
          </div>
        )
      })}
    </div>
  )
}

// ── Donut ─────────────────────────────────────────────────────────────────────

function DonutChart({ steps, color, palette, label }: { steps: AgentStep[]; color: string; palette: string[]; label: string }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    steps.forEach(s => { const t = ACTION_TYPES.includes(s.action_type) ? s.action_type : 'other'; m[t] = (m[t] ?? 0) + 1 })
    return ACTION_TYPES.map(t => ({ name: t.replace(/_/g, ' '), value: m[t] ?? 0 })).filter(d => d.value > 0)
  }, [steps])

  useEffect(() => {
    const svg = d3.select(svgRef.current!)
    svg.selectAll('*').remove()
    if (!counts.length) return
    const W = 260, H = 150, R = 48, r = 28
    svg.attr('viewBox', `0 0 ${W} ${H}`)
    const g = svg.append('g').attr('transform', `translate(${W / 2},${H / 2 - 8})`)
    const pie = d3.pie<{ name: string; value: number }>().value(d => d.value).sort(null)
    const arc = d3.arc<d3.PieArcDatum<{ name: string; value: number }>>().innerRadius(r).outerRadius(R)
    g.selectAll('path').data(pie(counts)).join('path')
      .attr('d', arc).attr('fill', (_, i) => palette[i % palette.length])
      .attr('stroke', '#fff').attr('stroke-width', 1.5)
      .append('title').text(d => `${d.data.name}: ${d.data.value}`)
    g.append('text').attr('text-anchor', 'middle').attr('dy', '-0.1em')
      .style('font', `bold 10px Inter, sans-serif`).style('fill', color).text(label)
    g.append('text').attr('text-anchor', 'middle').attr('dy', '1.1em')
      .style('font', `8.5px Inter, sans-serif`).style('fill', '#94a3b8').text(`${steps.length} steps`)
    const legend = svg.append('g').attr('transform', `translate(4,${H - 26})`)
    counts.slice(0, 4).forEach((d, i) => {
      const col = i < 2 ? 0 : 1, row = i % 2
      const lx = col * (W / 2), ly = row * 13
      legend.append('rect').attr('x', lx).attr('y', ly).attr('width', 6).attr('height', 6).attr('rx', 1).attr('fill', palette[i % palette.length])
      legend.append('text').attr('x', lx + 9).attr('y', ly + 5.5).style('font-size', '7.5px').style('fill', '#64748b').text(d.name.slice(0, 14))
    })
  }, [counts, color, palette, label, steps.length])

  if (!counts.length) return <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 'var(--fs-small)' }}>No data</div>
  return <svg ref={svgRef} style={{ width: '100%', height: 'auto', display: 'block' }} />
}

// ── Page bars ─────────────────────────────────────────────────────────────────

function PageBarsChart({ steps, color, topN = 6, maxVal, highlightPages }: { steps: AgentStep[]; color: string; topN?: number; maxVal?: number; highlightPages?: string[] }) {
  const data = useMemo(() => {
    const m = new Map<string, number>()
    steps.forEach(s => { const p = getPath(s.url); m.set(p, (m.get(p) ?? 0) + 1) })
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, topN)
  }, [steps, topN])
  const max = maxVal ?? Math.max(...data.map(d => d[1]), 1)
  if (!data.length) return <div style={{ height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 'var(--fs-small)' }}>No data</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {data.map(([page, count]) => {
        const isHl = highlightPages?.some(p => page === p || page.startsWith(p))
        return (
          <div key={page} style={{ display: 'flex', alignItems: 'center', gap: 7, ...(isHl ? { background: 'rgba(37,99,235,0.07)', borderRadius: 4, margin: '0 -4px', padding: '2px 4px' } : {}) }}>
            <div style={{ width: 70, fontSize: 'var(--fs-small)', color: isHl ? 'var(--brand)' : 'var(--gray500)', fontFamily: 'var(--font-sans)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0, fontWeight: isHl ? 700 : undefined }} title={page}>{page}</div>
            <div style={{ flex: 1, height: 5, background: 'var(--gray100)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${(count / max) * 100}%`, height: '100%', background: color, borderRadius: 3 }} />
            </div>
            <div style={{ fontSize: 'var(--fs-small)', fontWeight: 600, color: 'var(--gray600)', minWidth: 18, textAlign: 'right' }}>{count}</div>
          </div>
        )
      })}
    </div>
  )
}

// ── Re-visit rate ─────────────────────────────────────────────────────────────

function RevisitChart({ steps, color, maxVal, highlightPages }: { steps: AgentStep[]; color: string; maxVal?: number; highlightPages?: string[] }) {
  const data = useMemo(() => {
    const m = new Map<string, number>()
    steps.forEach(s => { const p = getPath(s.url); m.set(p, (m.get(p) ?? 0) + 1) })
    return Array.from(m.entries()).filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [steps])
  if (!data.length) return <div style={{ fontSize: 'var(--fs-small)', color: 'var(--gray400)' }}>No page revisits recorded</div>
  const max = maxVal ?? Math.max(...data.map(d => d[1]), 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {data.map(([page, count]) => {
        const isHl = highlightPages?.some(p => page === p || page.startsWith(p))
        return (
          <div key={page} style={{ display: 'flex', alignItems: 'center', gap: 7, ...(isHl ? { background: 'rgba(37,99,235,0.07)', borderRadius: 4, margin: '0 -4px', padding: '2px 4px' } : {}) }}>
            <div style={{ width: 70, fontSize: 'var(--fs-small)', color: isHl ? 'var(--brand)' : 'var(--gray500)', fontFamily: 'var(--font-sans)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0, fontWeight: isHl ? 700 : undefined }} title={page}>{page}</div>
            <div style={{ flex: 1, height: 5, background: 'var(--gray100)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${(count / max) * 100}%`, height: '100%', background: color, opacity: 0.75, borderRadius: 3 }} />
            </div>
            <div style={{ fontSize: 'var(--fs-small)', fontWeight: 600, color, minWidth: 24, textAlign: 'right' }}>{count}×</div>
          </div>
        )
      })}
    </div>
  )
}

// ── Step distribution (per side) ──────────────────────────────────────────────

// ── Action mix (per side) ─────────────────────────────────────────────────────

function ActionMixBars({ steps, color, highlightTypes }: { steps: AgentStep[]; color: string; highlightTypes?: string[] }) {
  const rows = useMemo(() => {
    const totals: Record<string, number> = {}
    steps.forEach(s => { const t = ACTION_TYPES.includes(s.action_type) ? s.action_type : 'other'; totals[t] = (totals[t] ?? 0) + 1 })
    const total = steps.length || 1
    return ACTION_TYPES
      .map(t => ({ type: t, name: t.replace(/_/g, ' '), pct: steps.length ? Math.round((totals[t] ?? 0) / total * 100) : 0, count: totals[t] ?? 0 }))
      .filter(r => r.count > 0)
      .sort((a, b) => b.pct - a.pct)
  }, [steps])

  if (!rows.length) return <div style={{ height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 'var(--fs-small)' }}>No data</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {rows.map(r => {
        const isHl = highlightTypes?.includes(r.type)
        return (
          <div key={r.type} style={{ display: 'flex', alignItems: 'center', gap: 7, ...(isHl ? { background: 'rgba(37,99,235,0.07)', borderRadius: 4, margin: '0 -4px', padding: '2px 4px' } : {}) }}>
            <div style={{ width: 80, fontSize: 'var(--fs-small)', color: isHl ? 'var(--brand)' : 'var(--gray500)', flexShrink: 0, fontWeight: isHl ? 700 : undefined }}>{r.name}</div>
            <div style={{ flex: 1, height: 5, background: 'var(--gray100)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${r.pct}%`, height: '100%', background: color, borderRadius: 3 }} />
            </div>
            <div style={{ fontSize: 'var(--fs-small)', fontWeight: 600, color: 'var(--gray500)', minWidth: 28, textAlign: 'right' }}>{r.pct}%</div>
          </div>
        )
      })}
    </div>
  )
}

// ── Session variance box plot ─────────────────────────────────────────────────

function BoxPlot({ counts, color, maxVal }: { counts: number[]; color: string; maxVal?: number }) {
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

  return <svg ref={svgRef} style={{ width: '100%', height: 'auto', display: 'block' }} />
}

// ── Time per action bars ─────────────────────────────────────────────────────

function fmtSecs(secs: number): string {
  if (secs < 60) return `${Math.round(secs)}s`
  const m = Math.floor(secs / 60), s = Math.round(secs % 60)
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

function TimeActionBars({ steps, color, sessionCounts, highlightTypes }: {
  steps: AgentStep[]
  color: string
  sessionCounts?: number[]
  highlightTypes?: string[]
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {data.map(r => {
        const isHl = highlightTypes?.includes(r.type)
        return (
        <div key={r.type} style={{ display: 'flex', alignItems: 'center', gap: 7, ...(isHl ? { background: 'rgba(37,99,235,0.07)', borderRadius: 4, margin: '0 -4px', padding: '2px 4px' } : {}) }}>
          <div style={{ width: 80, fontSize: 'var(--fs-small)', color: isHl ? 'var(--brand)' : 'var(--gray500)', flexShrink: 0, fontWeight: isHl ? 700 : undefined }}>{r.name}</div>
          <div style={{ flex: 1, height: 5, background: 'var(--gray100)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${(r.secs / max) * 100}%`, height: '100%', background: color, borderRadius: 3 }} />
          </div>
          <div style={{ fontSize: 'var(--fs-small)', fontWeight: 600, color: 'var(--gray500)', minWidth: 36, textAlign: 'right' }}>{fmtSecs(r.secs)}</div>
        </div>
        )
      })}
    </div>
  )
}

// ── Section divider row ───────────────────────────────────────────────────────

function SectionRow({ label, highlighted }: { label: string; highlighted?: boolean }) {
  const hl = highlighted
  const borderTop = hl ? '1.5px solid rgba(37,99,235,0.25)' : '1px solid var(--gray100)'
  const bg = hl ? 'rgba(37,99,235,0.04)' : undefined
  const color = hl ? 'var(--brand)' : 'var(--gray400)'
  return (
    <>
      <div style={{ padding: '10px 20px 5px', fontSize: 'var(--fs-small)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color, borderTop, background: bg, display: 'flex', alignItems: 'center', gap: 6 }}>
        {hl && <span style={{ width: 3, height: 13, background: 'var(--brand)', borderRadius: 2, flexShrink: 0, display: 'inline-block' }} />}
        {label}
      </div>
      <div style={{ background: hl ? 'rgba(37,99,235,0.06)' : 'var(--gray150, #e8eaf0)', borderTop }} />
      <div style={{ padding: '10px 20px 5px', fontSize: 'var(--fs-small)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color, borderTop, background: bg, display: 'flex', alignItems: 'center', gap: 6 }}>
        {hl && <span style={{ width: 3, height: 13, background: 'var(--brand)', borderRadius: 2, flexShrink: 0, display: 'inline-block' }} />}
        {label}
      </div>
    </>
  )
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
  actionContext?: { highlight?: CompareHighlight; note?: string; explanation?: string } | null
  onClearActionContext?: () => void
}

export default function ComparePanel({ agentSteps, humanSteps, agentJourneys, humanSessionStepCounts, humanSessionCount, actionContext, onClearActionContext }: Props) {
  const [splitPct, setSplitPct] = useState(80)
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
  const cellBg = (section: string, side: 'ai' | 'human'): React.CSSProperties =>
    isHL(section) && sideMatch(side) ? { background: 'rgba(37,99,235,0.04)' } : {}
  const hlTypes = (section: string, side: 'ai' | 'human') =>
    isHL(section) && sideMatch(side) ? hl?.action_types : undefined
  const hlPages = (section: string, side: 'ai' | 'human') =>
    isHL(section) && sideMatch(side) ? hl?.pages : undefined
  const hlMetrics = (side: 'ai' | 'human') =>
    isHL('stats') && sideMatch(side) ? hl?.metrics : undefined

  if (agentSteps.length === 0 && humanSteps.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8', fontSize: 'var(--fs-body)' }}>
        No data yet — run an agent or record a human session.
      </div>
    )
  }

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
      const m = new Map<string, number>()
      steps.forEach(s => { const p = getPath(s.url); m.set(p, (m.get(p) ?? 0) + 1) })
      return Math.max(...Array.from(m.values()).filter(v => v > 1), 0)
    }
    return Math.max(maxRevisit(agentSteps), maxRevisit(humanSteps), 1)
  }, [agentSteps, humanSteps])

  const sharedStepMax = Math.max(...agentStepCounts, ...humanSessionStepCounts, 1)

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
        ? `The AI agent completes tasks in a median of ${ai} steps, versus ${hu} for human testers. The agent follows a more direct path with less exploration.`
        : `Human testers complete tasks in a median of ${hu} steps, versus ${ai} for the AI agent. Humans apply prior knowledge and shortcuts the agent cannot replicate.`,
    })
  }

  if (stats.aiClickPct !== null || stats.humanClickPct !== null) {
    const aiC = stats.aiClickPct ?? 0, huC = stats.humanClickPct ?? 0
    insights.push({
      title: 'Interaction style',
      text: huC > aiC
        ? `Humans are more click-dominant (${huC}% of actions) compared to the AI (${aiC}%). The agent spends more time reading and scrolling before acting, which reflects its inability to infer context visually.`
        : `The AI and humans have similar click rates (AI ${aiC}% vs Human ${huC}%). Their interaction patterns are broadly aligned on this site.`,
    })
  }

  if (stats.sharedPages > 0) {
    const overlap = stats.aiPages > 0 ? Math.round((stats.sharedPages / stats.aiPages) * 100) : 0
    insights.push({
      title: 'Page coverage',
      text: `Both visited ${stats.sharedPages} of the same pages (${overlap}% overlap with the AI's path). The AI reached ${stats.aiPages} unique pages; humans reached ${stats.humanPages > 0 ? stats.humanPages : '—'}. Pages visited by one but not the other may reveal navigation gaps.`,
    })
  }

  if (stats.aiScrollPct !== null) {
    insights.push({
      title: 'Scroll behaviour',
      text: `The AI scrolls on ${stats.aiScrollPct}% of steps — it reads the full page before deciding. Humans scroll ${stats.humanScrollPct ?? '—'}% of steps. A large gap here means the agent is reading content humans skip, potentially surfacing hidden issues.`,
    })
  }

  if (stats.aiAvgDuration !== null) {
    insights.push({
      title: 'Session length',
      text: `Average AI run duration is ~${fmt(stats.aiAvgDuration, 0)}s. The agent runs headlessly with no setup overhead, making it fast to rerun after changes. Human sessions require scheduling and briefing.`,
    })
  }

  if (stats.aiIQR !== null || stats.humanIQR !== null) {
    const aiIqr = stats.aiIQR !== null ? `AI IQR: ${fmt(stats.aiIQR, 0)} steps` : null
    const huIqr = stats.humanIQR !== null ? `Human IQR: ${fmt(stats.humanIQR, 0)} steps` : null
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

  return (
    <div ref={containerRef} style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── LEFT: charts ── */}
      <div style={{ flex: `0 0 ${splitPct}%`, minWidth: 0, overflowY: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1px 1fr' }}>

          {/* Column headers */}
          <div style={{ padding: '16px 20px 10px' }}>
            <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: AI_COLOR }}>AI Agent</div>
            <div style={{ fontSize: 'var(--fs-small)', color: 'var(--gray400)', marginTop: 2 }}>{stats.aiJourneys} {stats.aiJourneys === 1 ? 'run' : 'runs'} · {stats.aiSteps} steps</div>
          </div>
          <div style={{ background: 'var(--border)' }} />
          <div style={{ padding: '16px 20px 10px' }}>
            <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: HUMAN_COLOR }}>Human Tester</div>
            <div style={{ fontSize: 'var(--fs-small)', color: 'var(--gray400)', marginTop: 2 }}>{stats.humanSessions} {stats.humanSessions === 1 ? 'session' : 'sessions'} · {stats.humanStepsTotal} steps</div>
          </div>

          {/* Stats */}
          <div style={{ padding: '0 20px 14px', ...cellBg('stats', 'ai') }}>
            <StatsGrid items={[
              { label: 'Median steps', value: fmt(stats.aiMedian, 0) },
              { label: 'Unique pages', value: String(stats.aiPages) },
              { label: 'Click rate', value: stats.aiClickPct !== null ? `${stats.aiClickPct}%` : '—' },
              { label: 'Scroll rate', value: stats.aiScrollPct !== null ? `${stats.aiScrollPct}%` : '—' },
              { label: 'Avg duration', value: stats.aiAvgDuration !== null ? `${fmt(stats.aiAvgDuration, 0)}s` : '—' },
              { label: 'Total steps', value: String(stats.aiSteps) },
            ]} color={AI_COLOR} highlightMetrics={hlMetrics('ai')} />
          </div>
          <div style={{ background: 'var(--border)' }} />
          <div style={{ padding: '0 20px 14px', ...cellBg('stats', 'human') }}>
            <StatsGrid items={[
              { label: 'Median steps', value: fmt(stats.humanMedian, 0) },
              { label: 'Unique pages', value: stats.humanPages > 0 ? String(stats.humanPages) : '—' },
              { label: 'Click rate', value: stats.humanClickPct !== null ? `${stats.humanClickPct}%` : '—' },
              { label: 'Scroll rate', value: stats.humanScrollPct !== null ? `${stats.humanScrollPct}%` : '—' },
              { label: 'Avg steps', value: fmt(stats.humanAvg) },
              { label: 'Shared pages', value: String(stats.sharedPages) },
            ]} color={HUMAN_COLOR} highlightMetrics={hlMetrics('human')} />
          </div>

          <SectionRow label="Action breakdown" highlighted={isHL('action_breakdown')} />
          <div style={{ padding: '8px 20px 14px', ...cellBg('action_breakdown', 'ai') }}><DonutChart steps={agentSteps} color={AI_COLOR} palette={AI_PALETTE} label="AI" /></div>
          <div style={{ background: 'var(--border)' }} />
          <div style={{ padding: '8px 20px 14px', ...cellBg('action_breakdown', 'human') }}><DonutChart steps={humanSteps} color={HUMAN_COLOR} palette={HUMAN_PALETTE} label="Human" /></div>

          <SectionRow label="Action mix" highlighted={isHL('action_mix')} />
          <div style={{ padding: '8px 20px 14px', ...cellBg('action_mix', 'ai') }}><ActionMixBars steps={agentSteps} color={AI_COLOR} highlightTypes={hlTypes('action_mix', 'ai')} /></div>
          <div style={{ background: 'var(--border)' }} />
          <div style={{ padding: '8px 20px 14px', ...cellBg('action_mix', 'human') }}><ActionMixBars steps={humanSteps} color={HUMAN_COLOR} highlightTypes={hlTypes('action_mix', 'human')} /></div>

          <SectionRow label="Steps per page" highlighted={isHL('steps_per_page')} />
          <div style={{ padding: '8px 20px 14px', ...cellBg('steps_per_page', 'ai') }}><PageBarsChart steps={agentSteps} color={AI_COLOR} maxVal={sharedPageMax} highlightPages={hlPages('steps_per_page', 'ai')} /></div>
          <div style={{ background: 'var(--border)' }} />
          <div style={{ padding: '8px 20px 14px', ...cellBg('steps_per_page', 'human') }}><PageBarsChart steps={humanSteps} color={HUMAN_COLOR} maxVal={sharedPageMax} highlightPages={hlPages('steps_per_page', 'human')} /></div>

          <SectionRow label="Page revisits — potential confusion" highlighted={isHL('page_revisits')} />
          <div style={{ padding: '8px 20px 14px', ...cellBg('page_revisits', 'ai') }}><RevisitChart steps={agentSteps} color={AI_COLOR} maxVal={sharedRevisitMax} highlightPages={hlPages('page_revisits', 'ai')} /></div>
          <div style={{ background: 'var(--border)' }} />
          <div style={{ padding: '8px 20px 14px', ...cellBg('page_revisits', 'human') }}><RevisitChart steps={humanSteps} color={HUMAN_COLOR} maxVal={sharedRevisitMax} highlightPages={hlPages('page_revisits', 'human')} /></div>

          <SectionRow label="Session variance" highlighted={isHL('session_variance')} />
          <div style={{ padding: '8px 20px 14px', ...cellBg('session_variance', 'ai') }}><BoxPlot counts={agentStepCounts} color={AI_COLOR} maxVal={sharedStepMax} /></div>
          <div style={{ background: 'var(--border)' }} />
          <div style={{ padding: '8px 20px 14px', ...cellBg('session_variance', 'human') }}><BoxPlot counts={humanSessionStepCounts} color={HUMAN_COLOR} maxVal={sharedStepMax} /></div>

          <SectionRow label="Time per action" highlighted={isHL('time_per_action')} />
          <div style={{ padding: '8px 20px 14px', display: 'flex', flexDirection: 'column', gap: 8, ...cellBg('time_per_action', 'ai') }}>
            <StatsGrid items={[{ label: 'Total time', value: stats.aiTotalSecs !== null ? fmtSecs(stats.aiTotalSecs) : '—' }]} color={AI_COLOR} />
            <TimeActionBars steps={agentSteps} color={AI_COLOR} sessionCounts={agentJourneys.map(j => (j.steps as AgentStep[]).length)} highlightTypes={hlTypes('time_per_action', 'ai')} />
          </div>
          <div style={{ background: 'var(--border)' }} />
          <div style={{ padding: '8px 20px 14px', display: 'flex', flexDirection: 'column', gap: 8, ...cellBg('time_per_action', 'human') }}>
            <StatsGrid items={[{ label: 'Total time', value: stats.humanTotalSecs !== null ? fmtSecs(stats.humanTotalSecs) : '—' }]} color={HUMAN_COLOR} />
            <TimeActionBars steps={humanSteps} color={HUMAN_COLOR} sessionCounts={humanSessionStepCounts} highlightTypes={hlTypes('time_per_action', 'human')} />
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
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', background: 'var(--bg)', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {actionContext ? (
          <>
            {/* back button */}
            <button
              onClick={onClearActionContext}
              style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--fs-small)', color: 'var(--gray500)', fontWeight: 600, padding: '2px 0', marginBottom: 2 }}
            >
              ← All insights
            </button>

            {/* action point text */}
            {actionContext.note && (
              <div style={{ background: 'var(--surface)', border: '1.5px solid var(--brand)', borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ fontSize: 'var(--fs-small)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--brand)', marginBottom: 8 }}>Action Point</div>
                <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--text-secondary)', lineHeight: 1.65 }}>{actionContext.note}</p>
              </div>
            )}

            {/* diagram explanation */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ fontSize: 'var(--fs-small)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-primary)', marginBottom: 8 }}>How this diagram connects</div>
              {actionContext.explanation
                ? <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--text-secondary)', lineHeight: 1.65 }}>{actionContext.explanation}</p>
                : <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--gray400)', fontStyle: 'italic', lineHeight: 1.65 }}>Look at the highlighted sections in the chart to see the evidence for this action point.</p>
              }
            </div>

            {/* what's highlighted */}
            {hl && (hl.sections?.length || hl.action_types?.length || hl.pages?.length || hl.metrics?.length) ? (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 'var(--fs-small)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-primary)' }}>What's highlighted</div>
                {hl.side && hl.side !== 'both' && (
                  <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--gray500)' }}>
                    Focus: <strong>{hl.side === 'ai' ? 'AI Agent' : 'Human'}</strong> column
                  </p>
                )}
                {hl.sections?.length ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    <span style={{ fontSize: 'var(--fs-small)', color: 'var(--gray500)', alignSelf: 'center' }}>Sections:</span>
                    {hl.sections.map(s => (
                      <span key={s} style={{ fontSize: 'var(--fs-small)', fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: 'rgba(37,99,235,0.1)', color: 'var(--brand)' }}>
                        {SECTION_LABELS[s] ?? s}
                      </span>
                    ))}
                  </div>
                ) : null}
                {hl.action_types?.length ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    <span style={{ fontSize: 'var(--fs-small)', color: 'var(--gray500)', alignSelf: 'center' }}>Actions:</span>
                    {hl.action_types.map(a => (
                      <span key={a} style={{ fontSize: 'var(--fs-small)', fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: 'var(--gray100)', color: 'var(--gray700)' }}>
                        {a.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                ) : null}
                {hl.pages?.length ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    <span style={{ fontSize: 'var(--fs-small)', color: 'var(--gray500)', alignSelf: 'center' }}>Pages:</span>
                    {hl.pages.map(p => (
                      <span key={p} style={{ fontSize: 'var(--fs-small)', fontWeight: 600, fontFamily: 'monospace', padding: '2px 7px', borderRadius: 4, background: 'var(--gray100)', color: 'var(--gray700)' }}>
                        {p}
                      </span>
                    ))}
                  </div>
                ) : null}
                {hl.metrics?.length ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    <span style={{ fontSize: 'var(--fs-small)', color: 'var(--gray500)', alignSelf: 'center' }}>Metrics:</span>
                    {hl.metrics.map(m => (
                      <span key={m} style={{ fontSize: 'var(--fs-small)', fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: 'var(--gray100)', color: 'var(--gray700)' }}>
                        {METRIC_LABEL_MAP[m] ?? m}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div style={{ fontSize: 'var(--fs-small)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray400)', marginBottom: 4 }}>
              What the charts show
            </div>
            {insights.map((ins, i) => (
              <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--text-primary)' }}>{ins.title}</span>
                  {ins.tag && (
                    <span style={{ fontSize: 'var(--fs-small)', fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                      {ins.tag}
                    </span>
                  )}
                </div>
                <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--text-secondary)', lineHeight: 1.65 }}>{ins.text}</p>
              </div>
            ))}
          </>
        )}
      </div>

    </div>
  )
}
