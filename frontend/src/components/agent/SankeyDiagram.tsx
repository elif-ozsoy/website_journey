import { useRef, useEffect, useMemo } from 'react'
import * as d3 from 'd3'
import { sankey as d3Sankey, sankeyLinkHorizontal } from 'd3-sankey'
import type { AgentStep } from './agentTypes'

interface Props {
  agentJourneys: AgentStep[][]
  humanJourneys?: AgentStep[][]
}

const AGENT_COLOR  = '#32494B'
const HUMAN_COLOR  = '#881342'
const BOTH_COLOR   = '#1e293b'
const MARGIN = { top: 28, right: 200, bottom: 20, left: 20 }

function pageLabel(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname.replace(/\/$/, '') || '/'
    const pageId = u.searchParams.get('page_id')
    const suffix = pageId ? `?pid=${pageId}` : ''
    const full = (path === '/' ? '/' : path) + suffix
    return full.length > 36 ? '…' + full.slice(-34) : full
  } catch {
    return url.slice(0, 36)
  }
}

// ─── Loop detection ───────────────────────────────────────────────────────────

interface LoopInfo { page: string; count: number }

function detectLoops(deduped: string[]): LoopInfo[] {
  const counts: Record<string, number> = {}
  for (const p of deduped) counts[p] = (counts[p] ?? 0) + 1
  return Object.entries(counts).filter(([, c]) => c > 1).map(([page, count]) => ({ page, count }))
}

// Compress a journey: collapse 3rd+ visit to the same page into a synthetic ⟳ node
const MAX_VISITS_PER_PAGE = 2

function compressJourney(deduped: string[]): string[] {
  const visits: Record<string, number> = {}
  const out: string[] = []
  for (const p of deduped) {
    visits[p] = (visits[p] ?? 0) + 1
    if (visits[p] <= MAX_VISITS_PER_PAGE) {
      out.push(p)
    } else if (out[out.length - 1] !== `⟳ ${p}`) {
      out.push(`⟳ ${p}`)
    }
  }
  return out
}

// ─── Graph builder ────────────────────────────────────────────────────────────

const MAX_DEPTH = 10

interface RawLink { source: number; target: number; value: number; agentCount: number; humanCount: number }

function buildGraph(agentJourneys: AgentStep[][], humanJourneys: AgentStep[][]) {
  const idx = new Map<string, number>()
  const nodeNames: string[] = []
  const nodeLayers: number[] = []
  const nodeAgentVisits: number[] = []
  const nodeHumanVisits: number[] = []
  const linkMap = new Map<string, { source: number; target: number; agentCount: number; humanCount: number }>()

  function nodeId(label: string, depth: number) {
    const key = `${label}@${depth}`
    if (!idx.has(key)) {
      idx.set(key, nodeNames.length)
      nodeNames.push(label)
      nodeLayers.push(depth)
      nodeAgentVisits.push(0)
      nodeHumanVisits.push(0)
    }
    return idx.get(key)!
  }

  const totalLoops: Array<{ pages: string[]; count: number; kind: 'agent' | 'human' }> = []

  function addJourney(steps: AgentStep[], kind: 'agent' | 'human') {
    const valid = steps.filter(s => s.url?.startsWith('http'))
    const deduped: string[] = []
    for (const s of valid) {
      const lbl = pageLabel(s.url)
      if (deduped[deduped.length - 1] !== lbl) deduped.push(lbl)
    }

    // Record loop metadata before compression
    const loops = detectLoops(deduped)
    if (loops.length > 0) {
      totalLoops.push({ pages: loops.map(l => l.page), count: loops.reduce((a, l) => a + l.count, 0), kind })
    }

    const compressed = compressJourney(deduped).slice(0, MAX_DEPTH + 1)

    for (let i = 0; i < compressed.length - 1; i++) {
      const src = nodeId(compressed[i], i)
      const dst = nodeId(compressed[i + 1], i + 1)
      const key = `${src}→${dst}`
      const existing = linkMap.get(key)
      if (existing) {
        if (kind === 'agent') existing.agentCount++
        else existing.humanCount++
      } else {
        linkMap.set(key, { source: src, target: dst, agentCount: kind === 'agent' ? 1 : 0, humanCount: kind === 'human' ? 1 : 0 })
      }
    }

    // Mark node AI/human visits
    const visitedNodes = new Set<number>()
    for (let i = 0; i < compressed.length; i++) {
      const nid = nodeId(compressed[i], i)
      if (!visitedNodes.has(nid)) {
        visitedNodes.add(nid)
        if (kind === 'agent') nodeAgentVisits[nid]++
        else nodeHumanVisits[nid]++
      }
    }
  }

  agentJourneys.forEach(j => addJourney(j, 'agent'))
  humanJourneys.forEach(j => addJourney(j, 'human'))

  const rawLinks: RawLink[] = Array.from(linkMap.values()).map(l => ({
    ...l,
    value: l.agentCount + l.humanCount,
  }))

  return { nodeNames, nodeLayers, nodeAgentVisits, nodeHumanVisits, rawLinks, totalLoops }
}

// ─── Stats bar ────────────────────────────────────────────────────────────────

interface PageStat {
  page: string
  agentVisits: number
  humanVisits: number
  agentOnly: boolean
  humanOnly: boolean
}

function computePageStats(agentJourneys: AgentStep[][], humanJourneys: AgentStep[][]): PageStat[] {
  const agentPages = new Map<string, number>()
  const humanPages = new Map<string, number>()
  const addPages = (journeys: AgentStep[][], map: Map<string, number>) => {
    for (const j of journeys)
      for (const s of j)
        if (s.url?.startsWith('http')) {
          const p = pageLabel(s.url)
          map.set(p, (map.get(p) ?? 0) + 1)
        }
  }
  addPages(agentJourneys, agentPages)
  addPages(humanJourneys, humanPages)
  const all = new Set([...agentPages.keys(), ...humanPages.keys()])
  return Array.from(all).map(page => ({
    page,
    agentVisits: agentPages.get(page) ?? 0,
    humanVisits: humanPages.get(page) ?? 0,
    agentOnly: !humanPages.has(page),
    humanOnly: !agentPages.has(page),
  })).sort((a, b) => (b.agentVisits + b.humanVisits) - (a.agentVisits + a.humanVisits))
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SankeyDiagram({ agentJourneys, humanJourneys = [] }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const { nodeNames, nodeLayers, nodeAgentVisits, nodeHumanVisits, rawLinks, totalLoops } = useMemo(
    () => buildGraph(agentJourneys, humanJourneys),
    [agentJourneys, humanJourneys],
  )

  const pageStats = useMemo(() => computePageStats(agentJourneys, humanJourneys), [agentJourneys, humanJourneys])
  const hasHuman = humanJourneys.length > 0
  const totalJourneys = agentJourneys.length + humanJourneys.length

  useEffect(() => {
    const svg = d3.select(svgRef.current!)
    svg.selectAll('*').remove()
    if (nodeNames.length === 0 || rawLinks.length === 0) return

    const containerW = containerRef.current?.clientWidth ?? 860
    const W = Math.max(containerW, 400)
    const H = Math.max(380, nodeNames.length * 36)
    const iw = W - MARGIN.left - MARGIN.right
    const ih = H - MARGIN.top - MARGIN.bottom

    svg.attr('viewBox', `0 0 ${W} ${H}`).attr('width', W).attr('height', H)

    const layout = d3Sankey()
      .nodeId((d: any) => d.index)
      .nodeWidth(14)
      .nodePadding(22)
      .extent([[0, 0], [iw, ih]])

    const nodes = nodeNames.map((name, index) => ({ name, index, layer: nodeLayers[index] }))

    let graph: any
    try {
      graph = layout({ nodes: nodes.map(n => ({ ...n })), links: rawLinks.map(l => ({ ...l })) })
    } catch (e) { console.warn('Sankey layout error', e); return }

    const g = svg.append('g').attr('transform', `translate(${MARGIN.left},${MARGIN.top})`)

    // Gradient defs for links
    const defs = svg.append('defs')
    graph.links.forEach((link: any, i: number) => {
      const aCount = rawLinks[i]?.agentCount ?? 0
      const hCount = rawLinks[i]?.humanCount ?? 0
      const fromColor = aCount > 0 && hCount > 0 ? BOTH_COLOR : aCount > 0 ? AGENT_COLOR : HUMAN_COLOR
      const toColor   = aCount > 0 && hCount > 0 ? BOTH_COLOR : aCount > 0 ? AGENT_COLOR : HUMAN_COLOR
      const grad = defs.append('linearGradient')
        .attr('id', `lg-${i}`)
        .attr('gradientUnits', 'userSpaceOnUse')
        .attr('x1', link.source.x1).attr('x2', link.target.x0)
      grad.append('stop').attr('offset', '0%').attr('stop-color', fromColor).attr('stop-opacity', 0.55)
      grad.append('stop').attr('offset', '100%').attr('stop-color', toColor).attr('stop-opacity', 0.25)
    })

    // Links
    g.append('g')
      .attr('fill', 'none')
      .selectAll('path')
      .data(graph.links)
      .join('path')
      .attr('d', sankeyLinkHorizontal() as any)
      .attr('stroke', (_: any, i: number) => `url(#lg-${i})`)
      .attr('stroke-width', (d: any) => Math.max(2, d.width ?? 2))
      .attr('opacity', 0.88)
      .append('title')
      .text((d: any, i: number) => {
        const rl = rawLinks[i]
        const pct = totalJourneys > 0 ? Math.round((d.value / totalJourneys) * 100) : 0
        const parts = [`${d.source.name} → ${d.target.name}`, `${d.value} journey${d.value !== 1 ? 's' : ''} (${pct}% of total)`]
        if (rl?.agentCount > 0) parts.push(`AI: ${rl.agentCount}`)
        if (rl?.humanCount > 0) parts.push(`Human: ${rl.humanCount}`)
        return parts.join('\n')
      })

    // Link % labels on significant links
    graph.links.forEach((link: any, i: number) => {
      if (link.width < 6) return   // only label thick enough links
      const pct = totalJourneys > 0 ? Math.round((link.value / totalJourneys) * 100) : 0
      if (pct < 20) return
      const mx = (link.source.x1 + link.target.x0) / 2
      const my = link.y1 ?? ((link.source.y0 + link.source.y1) / 2)
      g.append('text')
        .attr('x', mx).attr('y', my)
        .attr('text-anchor', 'middle').attr('dy', '0.35em')
        .attr('font-size', 9).attr('font-weight', 700)
        .attr('font-family', 'var(--font-sans)')
        .attr('fill', '#fff').attr('opacity', 0.85)
        .text(`${pct}%`)
    })

    // Node rects — color by AI/human presence
    const nodeG = g.append('g').selectAll('g').data(graph.nodes).join('g')

    nodeG.append('rect')
      .attr('x', (d: any) => d.x0)
      .attr('y', (d: any) => d.y0)
      .attr('width', (d: any) => d.x1 - d.x0)
      .attr('height', (d: any) => Math.max(4, d.y1 - d.y0))
      .attr('rx', 3)
      .attr('fill', (d: any) => {
        const av = nodeAgentVisits[d.index] ?? 0
        const hv = nodeHumanVisits[d.index] ?? 0
        if (av > 0 && hv > 0) return BOTH_COLOR
        if (av > 0) return AGENT_COLOR
        return HUMAN_COLOR
      })
      .append('title')
      .text((d: any) => {
        const av = nodeAgentVisits[d.index] ?? 0
        const hv = nodeHumanVisits[d.index] ?? 0
        const isLoop = d.name.startsWith('⟳')
        return `${d.name}${isLoop ? ' (loop/revisit)' : ''}\nAI visits: ${av}\nHuman visits: ${hv}`
      })

    // Drop-off indicator: nodes with no outgoing links
    graph.nodes.forEach((d: any) => {
      const hasOut = graph.links.some((l: any) => l.source.index === d.index)
      if (!hasOut && d.value > 0) {
        g.append('text')
          .attr('x', d.x0 < iw / 2 ? d.x1 + 8 : d.x0 - 8)
          .attr('y', (d.y0 + d.y1) / 2 + 14)
          .attr('text-anchor', d.x0 < iw / 2 ? 'start' : 'end')
          .attr('font-size', 8).attr('font-weight', 600)
          .attr('font-family', 'var(--font-sans)')
          .attr('fill', '#f59e0b')
          .text('⬛ exit')
      }
    })

    // Node labels
    nodeG.append('text')
      .attr('x', (d: any) => (d.x0 < iw / 2 ? d.x1 + 8 : d.x0 - 8))
      .attr('y', (d: any) => (d.y1 + d.y0) / 2)
      .attr('dy', '-0.25em')
      .attr('text-anchor', (d: any) => (d.x0 < iw / 2 ? 'start' : 'end'))
      .attr('font-size', 10.5)
      .attr('font-family', 'var(--font-sans)')
      .attr('font-weight', 600)
      .attr('fill', (d: any) => {
        const av = nodeAgentVisits[d.index] ?? 0
        const hv = nodeHumanVisits[d.index] ?? 0
        if (av > 0 && hv > 0) return BOTH_COLOR
        if (av > 0) return AGENT_COLOR
        return HUMAN_COLOR
      })
      .text((d: any) => d.name)

    nodeG.append('text')
      .attr('x', (d: any) => (d.x0 < iw / 2 ? d.x1 + 8 : d.x0 - 8))
      .attr('y', (d: any) => (d.y1 + d.y0) / 2)
      .attr('dy', '1em')
      .attr('text-anchor', (d: any) => (d.x0 < iw / 2 ? 'start' : 'end'))
      .attr('font-size', 8.5)
      .attr('font-family', 'var(--font-sans)')
      .attr('fill', '#94a3b8')
      .text((d: any) => {
        const av = nodeAgentVisits[d.index] ?? 0
        const hv = nodeHumanVisits[d.index] ?? 0
        const parts = []
        if (av > 0) parts.push(`AI: ${av}`)
        if (hv > 0) parts.push(`H: ${hv}`)
        return parts.join(' · ')
      })
  }, [nodeNames, nodeLayers, nodeAgentVisits, nodeHumanVisits, rawLinks, totalJourneys])

  const hasData = nodeNames.length > 0 && rawLinks.length > 0
  const agentOnlyPages = pageStats.filter(p => p.agentOnly).length
  const humanOnlyPages = pageStats.filter(p => p.humanOnly).length
  const loopJourneys = totalLoops.filter(l => l.kind === 'agent').length

  return (
    <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12, flexShrink: 0, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#64748b' }}>
            Page navigation flow
          </div>
          {totalJourneys > 0 && (
            <div style={{ fontSize: 'var(--fs-small)', color: '#94a3b8', marginTop: 2 }}>
              {agentJourneys.length} agent · {humanJourneys.length} human · link width = journey count
            </div>
          )}
        </div>

        {/* Insight chips */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {hasHuman && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {([['AI Agent', AGENT_COLOR], ['Human', HUMAN_COLOR], ['Both', BOTH_COLOR]] as const).map(([label, color]) => (
                <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-small)', color, fontWeight: 600 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: color, display: 'inline-block' }} />
                  {label}
                </span>
              ))}
            </div>
          )}
          {agentOnlyPages > 0 && (
            <span style={{ fontSize: 'var(--fs-small)', background: `${AGENT_COLOR}18`, color: AGENT_COLOR, borderRadius: 4, padding: '2px 7px', fontWeight: 600 }}>
              {agentOnlyPages} AI-only page{agentOnlyPages !== 1 ? 's' : ''}
            </span>
          )}
          {humanOnlyPages > 0 && (
            <span style={{ fontSize: 'var(--fs-small)', background: `${HUMAN_COLOR}18`, color: HUMAN_COLOR, borderRadius: 4, padding: '2px 7px', fontWeight: 600 }}>
              {humanOnlyPages} human-only page{humanOnlyPages !== 1 ? 's' : ''}
            </span>
          )}
          {loopJourneys > 0 && (
            <span style={{ fontSize: 'var(--fs-small)', background: '#fef3c7', color: '#b45309', borderRadius: 4, padding: '2px 7px', fontWeight: 600 }}>
              ⟳ {loopJourneys} run{loopJourneys !== 1 ? 's' : ''} looped
            </span>
          )}
        </div>
      </div>

      {hasData ? (
        <div ref={containerRef} style={{ flex: 1, overflow: 'auto' }}>
          <svg ref={svgRef} style={{ display: 'block' }} />
        </div>
      ) : pageStats.length > 0 ? (
        // Single-page / no-navigation case: show page visit table
        <div style={{ flex: 1, overflow: 'auto' }}>
          <div style={{ fontSize: 'var(--fs-small)', color: '#64748b', fontWeight: 600, marginBottom: 10 }}>
            No multi-page navigation recorded — page visit counts:
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pageStats.slice(0, 12).map(ps => (
              <div key={ps.page} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 'var(--fs-small)' }}>
                <div style={{ width: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#334155', fontFamily: 'var(--font-sans)' }} title={ps.page}>{ps.page}</div>
                {ps.agentVisits > 0 && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: AGENT_COLOR }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: AGENT_COLOR, display: 'inline-block' }} />
                    {ps.agentVisits}
                  </span>
                )}
                {ps.humanVisits > 0 && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: HUMAN_COLOR }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: HUMAN_COLOR, display: 'inline-block' }} />
                    {ps.humanVisits}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#94a3b8', gap: 8, fontSize: 'var(--fs-body)' }}>
          <span style={{ fontWeight: 600, color: '#64748b' }}>No navigation data yet</span>
          <span style={{ textAlign: 'center', maxWidth: 320, fontSize: 'var(--fs-body)' }}>
            Run an agent or record a human session to see the flow diagram.
          </span>
        </div>
      )}
    </div>
  )
}
