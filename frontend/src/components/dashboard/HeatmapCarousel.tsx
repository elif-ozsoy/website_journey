import { useMemo, useState, useRef, useEffect, type ReactNode } from 'react'
import type { AgentStep } from '../agent/agentTypes'
import type { JourneyResponse, ScreenshotMeta } from '../../lib/api'
import * as api from '../../lib/api'
import type { Task } from '../../lib/types'
import { HeatmapCanvas } from './ScreenshotCarousel'
import { getAggregatedScreenshots, type HumanTaskJourney } from './screenshotData'

interface Props {
  agentJourneys: JourneyResponse[]
  humanJourneysBySession: Map<string, HumanTaskJourney[]>
  loading: boolean
  tasks?: Task[]
  taskFilter?: Set<number> | null
  onTaskChange?: (taskId: number | null) => void
  rightControl?: ReactNode
}

export default function HeatmapCarousel({ agentJourneys, humanJourneysBySession, loading, tasks = [], taskFilter = null, onTaskChange, rightControl }: Props) {
  const [pageIdx, setPageIdx] = useState(0)
  const [shotIdx, setShotIdx] = useState(0)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [vpSize, setVpSize] = useState({ w: 0, h: 0, scrollH: 0 })

  // Notify parent only when a single task is selected (used by insights panel title).
  useEffect(() => {
    if (!taskFilter || taskFilter.size !== 1) {
      onTaskChange?.(null)
      return
    }
    onTaskChange?.(Array.from(taskFilter)[0])
  }, [taskFilter, onTaskChange])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const update = () => {
      const { width, height } = el.getBoundingClientRect()
      const scrollH = el.scrollHeight
      setVpSize({ w: Math.round(width), h: Math.round(height), scrollH: Math.round(scrollH) })
    }
    const ro = new ResizeObserver(update)
    ro.observe(el)
    el.addEventListener('load', update, true)
    return () => { ro.disconnect(); el.removeEventListener('load', update, true) }
  }, [])

  // Agent journeys for the selected task only (global agentFilter already applied upstream)
  const taskAgentJourneys = useMemo(() => {
    return taskFilter !== null
      ? agentJourneys.filter(j => j.task_id !== null && taskFilter.has(Number(j.task_id)))
      : agentJourneys
  }, [agentJourneys, taskFilter])

  // Fetch all screenshots for agent journeys — same approach as ActionPointsList.
  // These include every step's screenshot_base64-derived image and let us prefer
  // click-trigger screenshots (showing dropdowns open, menus visible, etc.)
  const [journeyScreenshots, setJourneyScreenshots] = useState<ScreenshotMeta[]>([])
  const journeyIdsKey = taskAgentJourneys.map(j => j.id).join(',')
  useEffect(() => {
    if (taskAgentJourneys.length === 0) { setJourneyScreenshots([]); return }
    Promise.all(taskAgentJourneys.map(j => api.listJourneyScreenshots(j.id)))
      .then(results => setJourneyScreenshots(results.flat()))
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journeyIdsKey])

  // Human steps filtered by task (global sessionFilter already applied upstream)
  const filteredHumanSteps = useMemo(() => {
    const selectedTaskTitles = taskFilter === null
      ? null
      : new Set(tasks.filter(t => taskFilter.has(t.id)).map(t => t.title))
    const result = new Map<string, AgentStep[]>()

    for (const [sessionId, journeys] of humanJourneysBySession) {
      const matched = journeys.filter(tj => {
        if (taskFilter === null) return true
        if (tj.taskId !== null) return taskFilter.has(Number(tj.taskId))
        return selectedTaskTitles ? selectedTaskTitles.has(tj.taskTitle) : false
      })
      const steps = matched.flatMap(tj => tj.steps)
      if (steps.length > 0) result.set(sessionId, steps)
    }

    return result
  }, [humanJourneysBySession, taskFilter, tasks])

  const pages = useMemo(() => {
    const agentStepArrays = taskAgentJourneys.map(j => j.steps as AgentStep[])
    const humanStepArrays = Array.from(filteredHumanSteps.values())
    return getAggregatedScreenshots(agentStepArrays, humanStepArrays, journeyScreenshots)
  }, [taskAgentJourneys, filteredHumanSteps, journeyScreenshots])

  // Reset page index when pages change
  useEffect(() => {
    setPageIdx(p => Math.min(p, Math.max(0, pages.length - 1)))
  }, [pages.length])

  // Reset shot index when page changes
  useEffect(() => { setShotIdx(0) }, [pageIdx])

  const page = pages[Math.min(pageIdx, pages.length - 1)]

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
        No journey data for selected task filters.
      </div>
    )
  }

  const safePageIdx = Math.min(pageIdx, pages.length - 1)
  const agentDotCount = page?.heatmapDots?.filter(d => d.kind === 'agent').length ?? 0
  const humanDotCount = page?.heatmapDots?.filter(d => d.kind === 'human').length ?? 0
  const attentionDotCount = page?.heatmapDots?.filter(d => d.kind === 'attention').length ?? 0

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
      {/* Combined controls bar: page nav + legend + screenshot cycling */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--gray100)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {/* Page navigation */}
        <button className="sc-arrow" style={{ fontSize: 13 }} disabled={safePageIdx === 0} onClick={() => setPageIdx(p => p - 1)}>←</button>
        <div className="sc-dots" style={{ gap: 3 }}>
          {pages.map((p, i) => (
            <button key={i} className={`sc-dot${i === safePageIdx ? ' active' : ''}`} onClick={() => setPageIdx(i)} title={p.pageLabel} />
          ))}
        </div>
        <button className="sc-arrow" style={{ fontSize: 13 }} disabled={safePageIdx === pages.length - 1} onClick={() => setPageIdx(p => p + 1)}>→</button>

        {/* Divider */}
        <span style={{ width: 1, height: 14, background: 'var(--gray200)', flexShrink: 0 }} />

        {/* Legend */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-small)', fontWeight: 700, color: agentDotCount > 0 ? '#32494B' : 'var(--gray300)', flexShrink: 0 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#32494B', display: 'inline-block', flexShrink: 0 }} />
          Agent
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-small)', fontWeight: 700, color: humanDotCount > 0 ? '#881342' : 'var(--gray300)', flexShrink: 0 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#881342', display: 'inline-block', flexShrink: 0 }} />
          Human
        </span>

        {/* Screenshot cycling */}
        {page?.screenshotUrls && page.screenshotUrls.length > 1 && (
          <>
            <span style={{ width: 1, height: 14, background: 'var(--gray200)', flexShrink: 0 }} />
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-small)', color: 'var(--gray400)', flexShrink: 0 }}>
              <button
                onClick={() => setShotIdx(i => Math.max(0, i - 1))}
                disabled={shotIdx === 0}
                style={{ background: 'none', border: 'none', cursor: shotIdx === 0 ? 'default' : 'pointer', color: shotIdx === 0 ? 'var(--gray200)' : 'var(--gray500)', fontSize: 11, padding: '0 1px', lineHeight: 1 }}
              >◀</button>
              Shot {Math.min(shotIdx, page.screenshotUrls.length - 1) + 1}/{page.screenshotUrls.length}
              <button
                onClick={() => setShotIdx(i => Math.min(page.screenshotUrls!.length - 1, i + 1))}
                disabled={shotIdx >= page.screenshotUrls.length - 1}
                style={{ background: 'none', border: 'none', cursor: shotIdx >= page.screenshotUrls.length - 1 ? 'default' : 'pointer', color: shotIdx >= page.screenshotUrls.length - 1 ? 'var(--gray200)' : 'var(--gray500)', fontSize: 11, padding: '0 1px', lineHeight: 1 }}
              >▶</button>
            </span>
          </>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>{rightControl}</div>
      </div>

      {/* Browser mock + heatmap */}
      <div className="sc-stage" style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRadius: 0, border: 'none', boxShadow: 'none', overflow: 'hidden', minHeight: 0 }}>
        <div className="sc-chrome" style={{ flexShrink: 0 }}>
          <div className="sc-chrome-dots"><span /><span /><span /></div>
          <div className="sc-chrome-bar">{page?.pageUrl || '—'}</div>
        </div>

        <div className="sc-viewport" ref={viewportRef} style={{ position: 'relative', flex: 1, overflow: 'auto', minHeight: 0 }}>
          {page?.screenshotUrls && page.screenshotUrls.length > 0 ? (
            <img
              src={page.screenshotUrls[Math.min(shotIdx, page.screenshotUrls.length - 1)]}
              className="sc-real-screenshot"
              alt={page.pageLabel}
              onLoad={() => {
                const el = viewportRef.current
                if (!el) return
                const { width, height } = el.getBoundingClientRect()
                setVpSize({ w: Math.round(width), h: Math.round(height), scrollH: Math.round(el.scrollHeight) })
              }}
            />
          ) : page?.screenshotUrl ? (
            <img
              src={page.screenshotUrl}
              className="sc-real-screenshot"
              alt={page.pageLabel}
              onLoad={() => {
                const el = viewportRef.current
                if (!el) return
                const { width, height } = el.getBoundingClientRect()
                setVpSize({ w: Math.round(width), h: Math.round(height), scrollH: Math.round(el.scrollHeight) })
              }}
            />
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

          {page?.heatmapDots && page.heatmapDots.length > 0 && vpSize.w > 0 && vpSize.h > 0 && (
            <HeatmapCanvas
              dots={page.heatmapDots}
              width={vpSize.w}
              height={vpSize.scrollH > vpSize.h ? vpSize.scrollH : vpSize.h}
              colorMode={colorMode}
              fitToContent
            />
          )}
        </div>
      </div>

    </div>
  )
}
