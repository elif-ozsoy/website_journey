import { Component, useEffect, useMemo, useState, type ReactNode } from 'react'
import Plot from 'react-plotly.js'
import type { Data } from 'plotly.js'
import * as api from '../../lib/api'
import type { PagePolicy } from '../../lib/api'

interface Props {
  siteId: string
  taskId?: number
}

class HumanAggregateErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: 320, color: 'var(--red)', fontSize: 'var(--fs-body)', textAlign: 'center', padding: 24 }}>
          Human aggregate could not be rendered. Reload the dashboard, or try again after more human sessions have been collected.
        </div>
      )
    }
    return this.props.children
  }
}

// Map frequency → edge colour (green = common, red = rare)
function freqColor(freq: number, alpha = '99'): string {
  if (freq >= 0.5) return `#16a34a${alpha}` // green
  if (freq >= 0.2) return `#d97706${alpha}` // amber
  return `#dc2626${alpha}` // red
}

function buildSankey(policy: Record<string, PagePolicy>) {
  const nodeLabels: string[] = []
  const nodeColors: string[] = []
  const linkSource: number[] = []
  const linkTarget: number[] = []
  const linkValues: number[] = []
  const linkColors: string[] = []
  const linkLabels: string[] = []
  const nodeIndex = new Map<string, number>()

  function getOrAdd(label: string, color: string): number {
    if (!nodeIndex.has(label)) {
      nodeIndex.set(label, nodeLabels.length)
      nodeLabels.push(label.length > 30 ? label.slice(0, 30) + '…' : label)
      nodeColors.push(color)
    }
    return nodeIndex.get(label)!
  }

  for (const [path, pagePol] of Object.entries(policy)) {
    const srcIdx = getOrAdd(path, '#1e293b')
    const n = pagePol.n_sessions

    for (const action of pagePol.action_distribution) {
      const href = String(action.href || '')
      const label = action.text || href || action.selector || '?'
      const count = action.count
      const freq = action.frequency

      // Derive destination path from href
      let destPath = '?'
      try {
        const u = new URL(href)
        destPath = u.pathname + (u.search || '')
      } catch {
        if (href.startsWith('/')) destPath = href
      }

      const destIdx = getOrAdd(destPath, '#334155')
      const edgeColor = freqColor(freq)

      linkSource.push(srcIdx)
      linkTarget.push(destIdx)
      linkValues.push(count)
      linkColors.push(edgeColor)
      linkLabels.push(`"${label.slice(0, 40)}" — ${Math.round(freq * 100)}% of ${n} sessions`)
    }

    // Bounce node
    if (pagePol.bounce_rate > 0) {
      const bounceIdx = getOrAdd('(bounce)', '#64748b')
      const count = Math.round(pagePol.bounce_rate * n)
      linkSource.push(srcIdx)
      linkTarget.push(bounceIdx)
      linkValues.push(Math.max(count, 1))
      linkColors.push('#94a3b855')
      linkLabels.push(`${Math.round(pagePol.bounce_rate * 100)}% left without clicking`)
    }
  }

  return { nodeLabels, nodeColors, linkSource, linkTarget, linkValues, linkColors, linkLabels }
}

function HumanAggregateFlowContent({ siteId, taskId }: Props) {
  const [data, setData] = useState<api.SitePolicy | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api.getSitePolicy(siteId, taskId)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [siteId, taskId])

  const sankeyData = useMemo(() => {
    if (!data || data.n_pages === 0) return null
    return buildSankey(data.policy)
  }, [data])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--gray400)', fontSize: 'var(--fs-body)', flexDirection: 'column', gap: 8 }}>
        <div className="spinner" />
        Building human journey aggregate…
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--red)', fontSize: 'var(--fs-body)' }}>
        Failed to load policy: {error}
      </div>
    )
  }

  if (!sankeyData || !data || data.n_pages === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--gray400)', fontSize: 'var(--fs-body)', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 'var(--fs-headline)' }}>👥</span>
        No human session data yet — share the tester link to collect journeys.
      </div>
    )
  }

  const totalSessions = Math.max(...Object.values(data.policy).map(p => p.n_sessions))

  const plotData: Data[] = [{
    type: 'sankey',
    orientation: 'h',
    arrangement: 'perpendicular',
    node: {
      pad: 20,
      thickness: 16,
      line: { color: '#ffffff', width: 1.5 },
      label: sankeyData.nodeLabels,
      color: sankeyData.nodeColors,
    },
    link: {
      source: sankeyData.linkSource,
      target: sankeyData.linkTarget,
      value: sankeyData.linkValues,
      color: sankeyData.linkColors,
      customdata: sankeyData.linkLabels,
      hovertemplate: '%{customdata}<extra></extra>',
    },
  }]

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16, flex: 1, overflow: 'auto' }}>
      <div>
        <div style={{ fontSize: 'var(--fs-small)', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--gray400)', textTransform: 'uppercase', marginBottom: 4 }}>
          User Journey Aggregate
        </div>
        <p style={{ fontSize: 'var(--fs-body)', color: 'var(--gray600)', lineHeight: 1.5 }}>
          {data.n_pages} pages · {totalSessions} peak sessions · paths sized by click count, coloured by frequency
        </p>

        <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
          {[
            { color: '#16a34a', label: '≥50% of users' },
            { color: '#d97706', label: '20–49% of users' },
            { color: '#dc2626', label: '<20% of users' },
            { color: '#64748b', label: 'Bounce / no action' },
          ].map(({ color, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
              <span style={{ fontSize: 'var(--fs-small)', fontWeight: 600, color: 'var(--gray500)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 400 }}>
        <Plot
          data={plotData}
          layout={{
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            font: { color: '#475569', family: 'Inter, sans-serif' },
            margin: { l: 0, r: 0, t: 0, b: 0 },
            height: 480,
            autosize: true,
          }}
          config={{ displayModeBar: false, responsive: true }}
          style={{ width: '100%', height: '100%' }}
        />
      </div>

      {/* Page-level stats table */}
      <div style={{ borderTop: '1px solid var(--gray100)', paddingTop: 16 }}>
        <div style={{ fontSize: 'var(--fs-small)', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--gray400)', textTransform: 'uppercase', marginBottom: 10 }}>
          Page breakdown
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto auto', gap: '6px 16px', alignItems: 'center' }}>
          {['Page', 'Sessions', 'Top action', 'Bounce %', 'Avg time'].map(h => (
            <span key={h} style={{ fontSize: 'var(--fs-small)', fontWeight: 700, color: 'var(--gray400)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</span>
          ))}
          {Object.entries(data.policy).sort(([, a], [, b]) => b.n_sessions - a.n_sessions).map(([path, pol]) => {
            const top = pol.action_distribution[0]
            return [
              <span key={`${path}-p`} style={{ fontSize: 'var(--fs-body)', color: 'var(--gray700)', fontFamily: 'var(--font-sans)' }}>{path.length > 35 ? path.slice(0, 35) + '…' : path}</span>,
              <span key={`${path}-n`} style={{ fontSize: 'var(--fs-body)', color: 'var(--gray600)', textAlign: 'right' }}>{pol.n_sessions}</span>,
              <span key={`${path}-a`} style={{ fontSize: 'var(--fs-body)', color: 'var(--gray700)' }}>{top ? `"${(top.text || top.href || '').slice(0, 28)}" (${Math.round(top.frequency * 100)}%)` : '—'}</span>,
              <span key={`${path}-b`} style={{ fontSize: 'var(--fs-body)', color: pol.bounce_rate > 0.3 ? 'var(--red)' : 'var(--gray600)', textAlign: 'right' }}>{Math.round(pol.bounce_rate * 100)}%</span>,
              <span key={`${path}-t`} style={{ fontSize: 'var(--fs-body)', color: 'var(--gray600)', textAlign: 'right' }}>{pol.avg_time_on_page_ms != null ? `${(pol.avg_time_on_page_ms / 1000).toFixed(1)}s` : '—'}</span>,
            ]
          })}
        </div>
      </div>
    </div>
  )
}

export default function HumanAggregateFlow(props: Props) {
  return (
    <HumanAggregateErrorBoundary>
      <HumanAggregateFlowContent {...props} />
    </HumanAggregateErrorBoundary>
  )
}
