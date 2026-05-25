import { useMemo, useState, useRef, useEffect } from 'react'
import type { AgentStep } from '../agent/agentTypes'
import type { JourneyResponse } from '../../lib/api'
import type { Task } from '../../lib/types'
import { HeatmapCanvas } from './ScreenshotCarousel'
import { getAggregatedScreenshots } from './screenshotData'

interface Props {
  agentJourneys: JourneyResponse[]
  humanSessionSteps: Map<string, AgentStep[]>
  loading: boolean
  tasks?: Task[]
}

function shortenUrl(url: string): string {
  try {
    const u = new URL(url)
    const path = (u.pathname || '/').replace(/\/$/, '') || '/'
    return path.length > 35 ? path.slice(0, 35) + '…' : path
  } catch {
    return url.slice(0, 35)
  }
}

function FilterPill({ label, active, color, onClick }: { label: string; active: boolean; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '3px 9px', borderRadius: 999, cursor: 'pointer', border: 'none',
        fontSize: 'var(--fs-small)', fontWeight: 600, fontFamily: 'var(--font-sans)',
        background: active ? color : 'var(--gray100)',
        color: active ? '#fff' : 'var(--text-secondary)',
        transition: 'background 0.13s, color 0.13s',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {label}
    </button>
  )
}

export default function HeatmapCarousel({ agentJourneys, humanSessionSteps, loading, tasks = [] }: Props) {
  const [pageIdx, setPageIdx] = useState(0)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [vpSize, setVpSize] = useState({ w: 0, h: 0 })

  // Journey selection state: null = all selected
  const [agentFilter, setAgentFilter] = useState<Set<number> | null>(null)
  const [humanFilter, setHumanFilter] = useState<Set<string> | null>(null)
  const [taskFilter, setTaskFilter] = useState<number | null>(null)

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setVpSize({ w: Math.round(width), h: Math.round(height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const filteredAgentJourneys = useMemo(() => {
    let result = agentJourneys
    if (taskFilter !== null) result = result.filter(j => j.task_id === taskFilter)
    if (agentFilter !== null) result = result.filter(j => agentFilter.has(j.id))
    return result
  }, [agentJourneys, agentFilter, taskFilter])

  const filteredHumanSteps = useMemo(() => {
    if (humanFilter === null) return humanSessionSteps
    const filtered = new Map<string, AgentStep[]>()
    for (const [id, steps] of humanSessionSteps) {
      if (humanFilter.has(id)) filtered.set(id, steps)
    }
    return filtered
  }, [humanSessionSteps, humanFilter])

  const pages = useMemo(() => {
    const agentStepArrays = filteredAgentJourneys.map(j => j.steps as AgentStep[])
    const humanStepArrays = Array.from(filteredHumanSteps.values())
    return getAggregatedScreenshots(agentStepArrays, humanStepArrays)
  }, [filteredAgentJourneys, filteredHumanSteps])

  // Reset page index when pages change
  useEffect(() => {
    setPageIdx(p => Math.min(p, Math.max(0, pages.length - 1)))
  }, [pages.length])

  const page = pages[Math.min(pageIdx, pages.length - 1)]

  const humanSessionIds = Array.from(humanSessionSteps.keys())

  function toggleAgent(id: number) {
    setAgentFilter(prev => {
      const allIds = agentJourneys.map(j => j.id)
      const current = prev === null ? new Set(allIds) : new Set(prev)
      if (current.has(id)) { current.delete(id) } else { current.add(id) }
      if (current.size === allIds.length) return null
      return current
    })
  }

  function toggleHuman(id: string) {
    setHumanFilter(prev => {
      const allIds = humanSessionIds
      const current = prev === null ? new Set(allIds) : new Set(prev)
      if (current.has(id)) { current.delete(id) } else { current.add(id) }
      if (current.size === allIds.length) return null
      return current
    })
  }

  const hasAgent = page?.heatmapDots?.some(d => d.kind === 'agent') ?? false
  const hasHuman = page?.heatmapDots?.some(d => d.kind === 'human') ?? false
  const hasAttention = page?.heatmapDots?.some(d => d.kind === 'attention') ?? false
  const colorMode = (hasAgent && hasHuman) || hasAttention ? 'split' : 'unified'

  if (loading && pages.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 8, color: 'var(--gray400)', fontSize: 'var(--fs-body)' }}>
        <span style={{ animation: 'pulse-dot 1.4s ease-in-out infinite', width: 7, height: 7, borderRadius: '50%', background: 'var(--brand)', display: 'inline-block' }} />
        Loading session data…
      </div>
    )
  }

  if (pages.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 8, color: 'var(--gray400)', fontSize: 'var(--fs-body)' }}>
        <span style={{ fontSize: 'var(--fs-headline)' }}>🗺</span>
        No journey data to display.
      </div>
    )
  }

  const safePageIdx = Math.min(pageIdx, pages.length - 1)
  const agentDotCount = page?.heatmapDots?.filter(d => d.kind === 'agent').length ?? 0
  const humanDotCount = page?.heatmapDots?.filter(d => d.kind === 'human').length ?? 0
  const attentionDotCount = page?.heatmapDots?.filter(d => d.kind === 'attention').length ?? 0

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
      {/* Header */}
      <div className="sc-header" style={{ padding: '8px 16px', marginBottom: 0, borderBottom: '1px solid var(--gray100)', flexShrink: 0 }}>
        <div className="sc-header-left">
          <span className="sc-page-label">{page?.pageLabel}</span>
          <span className="sc-page-url">{page?.pageUrl}</span>
        </div>
        <div className="sc-nav">
          <button className="sc-arrow" disabled={safePageIdx === 0} onClick={() => setPageIdx(p => p - 1)}>←</button>
          <div className="sc-dots">
            {pages.map((p, i) => (
              <button key={i} className={`sc-dot${i === safePageIdx ? ' active' : ''}`} onClick={() => setPageIdx(i)} title={p.pageLabel} />
            ))}
          </div>
          <button className="sc-arrow" disabled={safePageIdx === pages.length - 1} onClick={() => setPageIdx(p => p + 1)}>→</button>
        </div>
      </div>

      {/* Task filter */}
      {tasks.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 16px', borderBottom: '1px solid var(--gray100)', flexShrink: 0, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 'var(--fs-small)', color: 'var(--gray400)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Task</span>
          <FilterPill label="All" active={taskFilter === null} color="var(--gray500)" onClick={() => setTaskFilter(null)} />
          {tasks.map(t => (
            <FilterPill key={t.id} label={t.title.length > 40 ? t.title.slice(0, 39) + '…' : t.title} active={taskFilter === t.id} color="var(--accent)" onClick={() => setTaskFilter(taskFilter === t.id ? null : t.id)} />
          ))}
        </div>
      )}

      {/* Journey selection + legend row */}
      <div style={{ display: 'flex', gap: 10, padding: '6px 16px', alignItems: 'center', borderBottom: '1px solid var(--gray100)', flexWrap: 'wrap', flexShrink: 0 }}>
        {agentJourneys.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
            <span style={{ fontSize: 'var(--fs-small)', color: 'var(--gray400)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Agent</span>
            <FilterPill label="All" active={agentFilter === null} color="#185FA5" onClick={() => setAgentFilter(null)} />
            {agentJourneys.map((j, i) => (
              <FilterPill
                key={j.id}
                label={`Run #${i + 1}`}
                active={agentFilter === null || agentFilter.has(j.id)}
                color="#185FA5"
                onClick={() => toggleAgent(j.id)}
              />
            ))}
          </div>
        )}
        {humanSessionIds.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
            <span style={{ fontSize: 'var(--fs-small)', color: 'var(--gray400)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Human</span>
            <FilterPill label="All" active={humanFilter === null} color="#b45309" onClick={() => setHumanFilter(null)} />
            {humanSessionIds.map((id, i) => (
              <FilterPill
                key={id}
                label={`User ${i + 1}`}
                active={humanFilter === null || humanFilter.has(id)}
                color="#b45309"
                onClick={() => toggleHuman(id)}
              />
            ))}
          </div>
        )}
        {loading && (
          <span style={{ fontSize: 'var(--fs-small)', color: 'var(--gray400)', marginLeft: 'auto' }}>
            <span style={{ animation: 'pulse-dot 1.4s ease-in-out infinite', width: 5, height: 5, borderRadius: '50%', background: 'var(--gray400)', display: 'inline-block', marginRight: 4 }} />
            loading sessions…
          </span>
        )}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 12, padding: '6px 16px', alignItems: 'center', flexShrink: 0, borderBottom: '1px solid var(--gray100)' }}>
        <span style={{ fontSize: 'var(--fs-small)', color: 'var(--gray400)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Heatmap:</span>
        {agentDotCount > 0 && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-small)', color: '#185FA5' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(0,0,255,0.5)', border: '1.5px solid rgba(24,95,165,0.8)', display: 'inline-block' }} />
            Agent clicks ({agentDotCount})
          </span>
        )}
        {humanDotCount > 0 && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-small)', color: '#b45309' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(255,100,0,0.5)', border: '1.5px solid rgba(180,83,9,0.8)', display: 'inline-block' }} />
            Human clicks ({humanDotCount})
          </span>
        )}
        {attentionDotCount > 0 && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-small)', color: '#15803d' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(0,200,80,0.5)', border: '1.5px solid rgba(21,128,61,0.8)', display: 'inline-block' }} />
            Agent attention ({attentionDotCount})
          </span>
        )}
        {hasAgent && hasHuman && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-small)', color: '#7c3aed' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(124,58,237,0.5)', border: '1.5px solid rgba(124,58,237,0.8)', display: 'inline-block' }} />
            Overlap
          </span>
        )}
      </div>

      {/* Browser mock + heatmap */}
      <div className="sc-stage" style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRadius: 0, border: 'none', boxShadow: 'none', overflow: 'hidden', minHeight: 0 }}>
        <div className="sc-chrome" style={{ flexShrink: 0 }}>
          <div className="sc-chrome-dots"><span /><span /><span /></div>
          <div className="sc-chrome-bar">{page?.pageUrl || '—'}</div>
        </div>

        <div className="sc-viewport" ref={viewportRef} style={{ position: 'relative', flex: 1, overflow: 'auto', minHeight: 0 }}>
          {page?.screenshotUrl ? (
            <img src={page.screenshotUrl} className="sc-real-screenshot" alt={page.pageLabel} />
          ) : (
            <>
              <div className="sc-section" style={{ top: '0%', left: '0%', width: '100%', height: '9%', background: '#e8eaf0' }}>
                <span className="sc-section-label">Nav</span>
              </div>
              <div className="sc-section" style={{ top: '10%', left: '0%', width: '100%', height: '70%', background: '#f8f9fc' }}>
                <span className="sc-section-label">Content</span>
              </div>
              <div className="sc-section" style={{ top: '82%', left: '0%', width: '100%', height: '18%', background: '#eef0f5' }}>
                <span className="sc-section-label">Footer</span>
              </div>
            </>
          )}

          {page?.heatmapDots && page.heatmapDots.length > 0 && vpSize.w > 0 && (
            <HeatmapCanvas
              dots={page.heatmapDots}
              width={vpSize.w}
              height={vpSize.h}
              colorMode={colorMode}
            />
          )}
        </div>
      </div>

      {/* Summary strip */}
      <div style={{ padding: '8px 16px', display: 'flex', gap: 16, fontSize: 'var(--fs-small)', color: 'var(--gray400)', borderTop: '1px solid var(--gray100)', flexShrink: 0 }}>
        <span>{agentDotCount} agent click{agentDotCount !== 1 ? 's' : ''}</span>
        <span>{humanDotCount} human click{humanDotCount !== 1 ? 's' : ''}</span>
        {attentionDotCount > 0 && <span>{attentionDotCount} attention</span>}
        <span style={{ marginLeft: 'auto' }}>{pages.length} page{pages.length !== 1 ? 's' : ''} total</span>
      </div>
    </div>
  )
}
