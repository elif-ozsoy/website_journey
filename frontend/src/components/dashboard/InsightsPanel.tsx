import { useRef, useEffect, useMemo, useState } from 'react'
import * as d3 from 'd3'
import type { AgentStep } from '../agent/agentTypes'
import type { JourneyResponse } from '../../lib/api'

const AGENT_COLOR = '#185FA5'
const HUMAN_COLOR = '#0d9488'
const AGENT_PALETTE = ['#185FA5', '#378ADD', '#6BA8D4', '#9EC5E3', '#BEDAF2', '#DCEBFA']
const HUMAN_PALETTE = ['#0d9488', '#14b8a6', '#2dd4bf', '#5eead4', '#99f6e4', '#ccfbf1']

const ACTION_TYPES = ['click_element', 'input_text', 'scroll', 'navigate', 'extract_content', 'other']

function getPath(url: string) {
  try { return new URL(url).pathname.replace(/\/$/, '') || '/' } catch { return url.slice(0, 40) }
}

// ─── Shared chart card wrapper ────────────────────────────────────────────────

function ChartCard({ title, sub, children, onExpand }: { title: string; sub: string; children: React.ReactNode; onExpand?: () => void }) {
  return (
    <div style={{ background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--border)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <div style={{ fontSize: 'var(--fs-small)', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</div>
          <div style={{ fontSize: 'var(--fs-small)', color: 'var(--gray500)', marginTop: 2 }}>{sub}</div>
        </div>
        {onExpand && (
          <button
            onClick={onExpand}
            title="View full screen"
            style={{ flexShrink: 0, background: 'var(--gray100)', border: 'none', borderRadius: 6, width: 26, height: 26, cursor: 'pointer', fontSize: 'var(--fs-body)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray500)' }}
          >⛶</button>
        )}
      </div>
      {children}
    </div>
  )
}

function EmptyChart({ msg }: { msg: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 220, color: '#94a3b8', fontSize: 'var(--fs-body)' }}>{msg}</div>
  )
}

// ─── Chart A: Steps per Page (grouped bar) ────────────────────────────────────

function StepsPerPageChart({ agentSteps, humanSteps }: { agentSteps: AgentStep[]; humanSteps: AgentStep[] }) {
  const svgRef = useRef<SVGSVGElement>(null)

  const data = useMemo(() => {
    const agentCounts = new Map<string, number>()
    const humanCounts = new Map<string, number>()
    agentSteps.forEach(s => { const p = getPath(s.url); agentCounts.set(p, (agentCounts.get(p) ?? 0) + 1) })
    humanSteps.forEach(s => { const p = getPath(s.url); humanCounts.set(p, (humanCounts.get(p) ?? 0) + 1) })
    const pages = Array.from(new Set([...agentCounts.keys(), ...humanCounts.keys()])).sort()
    return pages.map(p => ({ page: p, agent: agentCounts.get(p) ?? 0, human: humanCounts.get(p) ?? 0 }))
  }, [agentSteps, humanSteps])

  useEffect(() => {
    const svg = d3.select(svgRef.current!)
    svg.selectAll('*').remove()
    if (data.length === 0) return

    const W = 560, H = 240
    const m = { top: 16, right: 16, bottom: 72, left: 40 }
    const iw = W - m.left - m.right
    const ih = H - m.top - m.bottom

    svg.attr('viewBox', `0 0 ${W} ${H}`)
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`)

    const x0 = d3.scaleBand().domain(data.map(d => d.page)).range([0, iw]).paddingInner(0.25)
    const x1 = d3.scaleBand().domain(['agent', 'human']).range([0, x0.bandwidth()]).padding(0.08)
    const y = d3.scaleLinear().domain([0, d3.max(data, d => Math.max(d.agent, d.human)) ?? 1]).nice().range([ih, 0])

    // Gridlines
    g.append('g').attr('class', 'grid')
      .call(d3.axisLeft(y).tickSize(-iw).tickFormat(() => ''))
      .call(gg => gg.select('.domain').remove())
      .call(gg => gg.selectAll('line').attr('stroke', '#e2e8f0').attr('stroke-dasharray', '3,3'))

    // Bars
    const bar = g.append('g').selectAll('g').data(data).join('g')
      .attr('transform', d => `translate(${x0(d.page)},0)`)

    bar.selectAll('.b-agent').data(d => [d]).join('rect').attr('class', 'b-agent')
      .attr('x', () => x1('agent') ?? 0).attr('y', d => y(d.agent)).attr('width', x1.bandwidth())
      .attr('height', d => ih - y(d.agent)).attr('fill', AGENT_COLOR).attr('rx', 2)
      .append('title').text(d => `Agent: ${d.agent} steps on ${d.page}`)

    bar.selectAll('.b-human').data(d => [d]).join('rect').attr('class', 'b-human')
      .attr('x', () => x1('human') ?? 0).attr('y', d => y(d.human)).attr('width', x1.bandwidth())
      .attr('height', d => ih - y(d.human)).attr('fill', HUMAN_COLOR).attr('rx', 2)
      .append('title').text(d => `Human: ${d.human} steps on ${d.page}`)

    // Axes
    g.append('g').attr('transform', `translate(0,${ih})`).call(d3.axisBottom(x0).tickSize(0))
      .call(gg => gg.select('.domain').remove())
      .call(gg => gg.selectAll('text').attr('transform', 'rotate(-35)').style('text-anchor', 'end').attr('dy', '0.35em').attr('dx', '-0.5em').style('font-size', '9px').style('fill', '#64748b'))

    g.append('g').call(d3.axisLeft(y).ticks(4).tickSize(0))
      .call(gg => gg.select('.domain').remove())
      .call(gg => gg.selectAll('text').style('font-size', '9px').style('fill', '#64748b'))
  }, [data])

  if (data.length === 0) return <EmptyChart msg="No page data yet." />

  return <svg ref={svgRef} style={{ width: '100%', height: 'auto', display: 'block' }} />
}

// ─── Chart B: Action type donuts ──────────────────────────────────────────────

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
    if (counts.length === 0) return

    const W = 260, H = 220
    const R = 80, r = 46
    svg.attr('viewBox', `0 0 ${W} ${H}`)

    const g = svg.append('g').attr('transform', `translate(${W / 2},${H / 2 - 10})`)

    const pie = d3.pie<{ name: string; value: number }>().value(d => d.value).sort(null)
    const arc = d3.arc<d3.PieArcDatum<{ name: string; value: number }>>().innerRadius(r).outerRadius(R)

    g.selectAll('path').data(pie(counts)).join('path')
      .attr('d', arc)
      .attr('fill', (_, i) => palette[i % palette.length])
      .attr('stroke', '#fff')
      .attr('stroke-width', 1.5)
      .append('title').text(d => `${d.data.name}: ${d.data.value}`)

    g.append('text').attr('text-anchor', 'middle').attr('dy', '0.3em')
      .style('font', `bold 11px Inter, sans-serif`).style('fill', color).text(label)

    // Legend below
    const legend = svg.append('g').attr('transform', `translate(0,${H - 36})`)
    counts.slice(0, 3).forEach((d, i) => {
      const lx = (i % 3) * (W / 3) + 6
      legend.append('rect').attr('x', lx).attr('y', 0).attr('width', 8).attr('height', 8).attr('rx', 2).attr('fill', palette[i % palette.length])
      legend.append('text').attr('x', lx + 11).attr('y', 7).style('font-size', '8px').style('fill', '#64748b').text(d.name.slice(0, 12))
    })
  }, [counts, color, palette, label])

  if (counts.length === 0) return <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 'var(--fs-body)' }}>No data</div>
  return <svg ref={svgRef} style={{ width: '100%', height: 'auto', display: 'block' }} />
}

function ActionBreakdownChart({ agentSteps, humanSteps }: { agentSteps: AgentStep[]; humanSteps: AgentStep[] }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <div style={{ flex: 1 }}>
        <DonutChart steps={agentSteps} color={AGENT_COLOR} palette={AGENT_PALETTE} label="Agent" />
      </div>
      <div style={{ flex: 1 }}>
        <DonutChart steps={humanSteps} color={HUMAN_COLOR} palette={HUMAN_PALETTE} label="Human" />
      </div>
    </div>
  )
}

// ─── Chart C: Page Reach (horizontal grouped bar) ────────────────────────────

function PageReachChart({ agentSteps, humanSteps, agentJourneys, humanSessionCount }: {
  agentSteps: AgentStep[]
  humanSteps: AgentStep[]
  agentJourneys: JourneyResponse[]
  humanSessionCount: number
}) {
  const svgRef = useRef<SVGSVGElement>(null)

  const data = useMemo(() => {
    const freq = new Map<string, number>()
    ;[...agentSteps, ...humanSteps].forEach(s => { const p = getPath(s.url); freq.set(p, (freq.get(p) ?? 0) + 1) })
    const top = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 7).map(e => e[0])
    const nAgent = Math.max(agentJourneys.length, 1)
    const nHuman = Math.max(humanSessionCount, 1)
    return top.map(page => {
      const agentVisited = agentJourneys.filter(j => (j.steps as AgentStep[]).some(s => getPath(s.url) === page)).length
      const humanVisited = humanSteps.some(s => getPath(s.url) === page) ? humanSessionCount : 0
      return { page, agent: Math.round((agentVisited / nAgent) * 100), human: Math.round((humanVisited / nHuman) * 100) }
    })
  }, [agentSteps, humanSteps, agentJourneys, humanSessionCount])

  useEffect(() => {
    const svg = d3.select(svgRef.current!)
    svg.selectAll('*').remove()
    if (data.length === 0) return

    const W = 560, H = 240
    const m = { top: 16, right: 16, bottom: 32, left: 130 }
    const iw = W - m.left - m.right
    const ih = H - m.top - m.bottom

    svg.attr('viewBox', `0 0 ${W} ${H}`)
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`)

    const y0 = d3.scaleBand().domain(data.map(d => d.page)).range([0, ih]).paddingInner(0.25)
    const y1 = d3.scaleBand().domain(['agent', 'human']).range([0, y0.bandwidth()]).padding(0.08)
    const x = d3.scaleLinear().domain([0, 100]).range([0, iw])

    g.append('g').attr('class', 'grid')
      .call(d3.axisTop(x).ticks(5).tickSize(-ih).tickFormat(() => ''))
      .call(gg => gg.select('.domain').remove())
      .call(gg => gg.selectAll('line').attr('stroke', '#e2e8f0').attr('stroke-dasharray', '3,3'))

    const row = g.append('g').selectAll('g').data(data).join('g')
      .attr('transform', d => `translate(0,${y0(d.page)})`)

    row.selectAll('.b-a').data(d => [d]).join('rect').attr('class', 'b-a')
      .attr('y', () => y1('agent') ?? 0).attr('x', 0).attr('height', y1.bandwidth())
      .attr('width', d => x(d.agent)).attr('fill', AGENT_COLOR).attr('rx', 2)
      .append('title').text(d => `Agent: ${d.agent}% of runs visited ${d.page}`)

    row.selectAll('.b-h').data(d => [d]).join('rect').attr('class', 'b-h')
      .attr('y', () => y1('human') ?? 0).attr('x', 0).attr('height', y1.bandwidth())
      .attr('width', d => x(d.human)).attr('fill', HUMAN_COLOR).attr('rx', 2)
      .append('title').text(d => `Human: ${d.human}% of sessions visited ${d.page}`)

    g.append('g').call(d3.axisLeft(y0).tickSize(0))
      .call(gg => gg.select('.domain').remove())
      .call(gg => gg.selectAll('text').style('font-size', '9px').style('fill', '#64748b'))

    g.append('g').attr('transform', `translate(0,${ih})`).call(d3.axisBottom(x).ticks(5).tickFormat(v => `${v}%`).tickSize(0))
      .call(gg => gg.select('.domain').remove())
      .call(gg => gg.selectAll('text').style('font-size', '9px').style('fill', '#64748b'))
  }, [data])

  if (data.length === 0) return <EmptyChart msg="No page data yet." />
  return <svg ref={svgRef} style={{ width: '100%', height: 'auto', display: 'block' }} />
}

// ─── Chart D: Journey complexity scatter ──────────────────────────────────────

function ComplexityChart({ agentJourneys, humanSessionStepCounts }: {
  agentJourneys: JourneyResponse[]
  humanSessionStepCounts: number[]
}) {
  const svgRef = useRef<SVGSVGElement>(null)

  const agentPts = agentJourneys.map((j, i) => ({ x: i + 1, y: j.total_steps }))
  const humanPts = humanSessionStepCounts.map((y, i) => ({ x: i + 1, y }))

  const agentMedian = useMemo(() => {
    if (agentPts.length === 0) return null
    const s = [...agentPts].map(p => p.y).sort((a, b) => a - b)
    return s[Math.floor(s.length / 2)]
  }, [agentPts])

  const humanMedian = useMemo(() => {
    if (humanPts.length === 0) return null
    const s = [...humanPts].map(p => p.y).sort((a, b) => a - b)
    return s[Math.floor(s.length / 2)]
  }, [humanPts])

  useEffect(() => {
    const svg = d3.select(svgRef.current!)
    svg.selectAll('*').remove()
    if (agentPts.length === 0 && humanPts.length === 0) return

    const W = 560, H = 240
    const m = { top: 16, right: 16, bottom: 36, left: 44 }
    const iw = W - m.left - m.right
    const ih = H - m.top - m.bottom

    svg.attr('viewBox', `0 0 ${W} ${H}`)
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`)

    const allX = [...agentPts, ...humanPts].map(p => p.x)
    const allY = [...agentPts, ...humanPts].map(p => p.y)
    const x = d3.scaleLinear().domain([0, (d3.max(allX) ?? 1) + 0.5]).range([0, iw])
    const y = d3.scaleLinear().domain([0, (d3.max(allY) ?? 1) * 1.1]).nice().range([ih, 0])

    g.append('g').attr('class', 'grid')
      .call(d3.axisLeft(y).ticks(4).tickSize(-iw).tickFormat(() => ''))
      .call(gg => gg.select('.domain').remove())
      .call(gg => gg.selectAll('line').attr('stroke', '#e2e8f0').attr('stroke-dasharray', '3,3'))

    // Median lines
    if (agentMedian != null) {
      g.append('line').attr('x1', 0).attr('x2', iw).attr('y1', y(agentMedian)).attr('y2', y(agentMedian))
        .attr('stroke', AGENT_COLOR).attr('stroke-width', 1.5).attr('stroke-dasharray', '6,4').attr('opacity', 0.7)
    }
    if (humanMedian != null) {
      g.append('line').attr('x1', 0).attr('x2', iw).attr('y1', y(humanMedian)).attr('y2', y(humanMedian))
        .attr('stroke', HUMAN_COLOR).attr('stroke-width', 1.5).attr('stroke-dasharray', '6,4').attr('opacity', 0.7)
    }

    // Agent dots
    g.selectAll('.ag').data(agentPts).join('circle').attr('class', 'ag')
      .attr('cx', d => x(d.x)).attr('cy', d => y(d.y)).attr('r', 6)
      .attr('fill', AGENT_COLOR).attr('opacity', 0.85)
      .append('title').text(d => `Agent run ${d.x}: ${d.y} steps`)

    // Human diamonds (rotated squares)
    g.selectAll('.hm').data(humanPts).join('path').attr('class', 'hm')
      .attr('d', d3.symbol().type(d3.symbolDiamond).size(80) as any)
      .attr('transform', d => `translate(${x(d.x)},${y(d.y)})`)
      .attr('fill', HUMAN_COLOR).attr('opacity', 0.85)
      .append('title').text(d => `Human session ${d.x}: ${d.y} steps`)

    g.append('g').attr('transform', `translate(0,${ih})`)
      .call(d3.axisBottom(x).ticks(Math.min(agentPts.length + humanPts.length, 8)).tickFormat(v => `#${v}`).tickSize(0))
      .call(gg => gg.select('.domain').remove())
      .call(gg => gg.selectAll('text').style('font-size', '9px').style('fill', '#64748b'))

    g.append('g').call(d3.axisLeft(y).ticks(4).tickSize(0))
      .call(gg => gg.select('.domain').remove())
      .call(gg => gg.selectAll('text').style('font-size', '9px').style('fill', '#64748b'))
  }, [agentPts, humanPts, agentMedian, humanMedian])

  if (agentPts.length === 0 && humanPts.length === 0) return <EmptyChart msg="No journey data yet." />
  return <svg ref={svgRef} style={{ width: '100%', height: 'auto', display: 'block' }} />
}

// ─── Legend chip ──────────────────────────────────────────────────────────────

function LegendRow() {
  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'center', padding: '0 4px 12px', flexWrap: 'wrap' }}>
      {[['AI Agent', AGENT_COLOR], ['Human', HUMAN_COLOR]].map(([label, color]) => (
        <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-small)', color, fontWeight: 600 }}>
          <span style={{ width: 14, height: 4, borderRadius: 2, background: color, display: 'inline-block' }} />
          {label}
        </span>
      ))}
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

interface Props {
  agentSteps: AgentStep[]
  humanSteps: AgentStep[]
  agentJourneys: JourneyResponse[]
  humanSessionStepCounts: number[]
  humanSessionCount: number
}

type ChartKey = 'steps' | 'actions' | 'reach' | 'complexity'

const CHART_META: Record<ChartKey, { title: string; sub: string }> = {
  steps: { title: 'Steps per Page', sub: 'How many interactions each page required' },
  actions: { title: 'Action Breakdown', sub: 'Behavioural differences: what each actor does' },
  reach: { title: 'Page Reach', sub: '% of journeys that visited each page' },
  complexity: { title: 'Journey Complexity', sub: 'Step count per run — is AI consistently more efficient?' },
}

export default function InsightsPanel({ agentSteps, humanSteps, agentJourneys, humanSessionStepCounts, humanSessionCount }: Props) {
  const [expanded, setExpanded] = useState<ChartKey | null>(null)

  if (agentSteps.length === 0 && humanSteps.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8', gap: 8, fontSize: 'var(--fs-body)' }}>
        <span style={{ fontSize: 'var(--fs-headline)' }}>📊</span>
        No data yet — run an agent or record a human session to see comparison charts.
      </div>
    )
  }

  function renderChart(key: ChartKey) {
    if (key === 'steps') return <StepsPerPageChart agentSteps={agentSteps} humanSteps={humanSteps} />
    if (key === 'actions') return <ActionBreakdownChart agentSteps={agentSteps} humanSteps={humanSteps} />
    if (key === 'reach') return <PageReachChart agentSteps={agentSteps} humanSteps={humanSteps} agentJourneys={agentJourneys} humanSessionCount={humanSessionCount} />
    return <ComplexityChart agentJourneys={agentJourneys} humanSessionStepCounts={humanSessionStepCounts} />
  }

  return (
    <div style={{ padding: '12px 16px', overflowY: 'auto', height: '100%' }}>
      <LegendRow />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        {(Object.keys(CHART_META) as ChartKey[]).map(key => (
          <ChartCard key={key} title={CHART_META[key].title} sub={CHART_META[key].sub} onExpand={() => setExpanded(key)}>
            {renderChart(key)}
          </ChartCard>
        ))}
      </div>

      {/* Fullscreen overlay */}
      {expanded && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => setExpanded(null)}
        >
          <div
            style={{ background: '#fff', borderRadius: 14, padding: '20px 28px', width: '85vw', maxWidth: 1100, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.3)' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--gray700)' }}>{CHART_META[expanded].title}</div>
                <div style={{ fontSize: 'var(--fs-small)', color: 'var(--gray500)', marginTop: 2 }}>{CHART_META[expanded].sub}</div>
              </div>
              <button
                onClick={() => setExpanded(null)}
                style={{ background: 'var(--gray100)', border: 'none', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 'var(--fs-body)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
              >✕</button>
            </div>
            <LegendRow />
            {renderChart(expanded)}
          </div>
        </div>
      )}
    </div>
  )
}
