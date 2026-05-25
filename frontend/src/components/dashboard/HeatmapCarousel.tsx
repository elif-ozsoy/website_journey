import { useMemo, useState, useRef, useEffect } from 'react'
import type { AgentStep } from '../agent/agentTypes'
import type { JourneyResponse } from '../../lib/api'
import type { Task } from '../../lib/types'
import { HeatmapCanvas } from './ScreenshotCarousel'
import { getAggregatedScreenshots, type HumanTaskJourney } from './screenshotData'

interface Props {
  agentJourneys: JourneyResponse[]
  humanJourneysBySession: Map<string, HumanTaskJourney[]>
  loading: boolean
  tasks?: Task[]
}

const CHEVRON_SVG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%236b7280' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`

export default function HeatmapCarousel({ agentJourneys, humanJourneysBySession, loading, tasks = [] }: Props) {
  const [pageIdx, setPageIdx] = useState(0)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [vpSize, setVpSize] = useState({ w: 0, h: 0, scrollH: 0 })

  // Task filter — defaults to first task once tasks load
  const [taskFilter, setTaskFilter] = useState<number | null>(null)
  useEffect(() => {
    if (tasks.length > 0 && taskFilter === null) setTaskFilter(tasks[0].id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks])

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
      ? agentJourneys.filter(j => j.task_id === taskFilter)
      : agentJourneys
  }, [agentJourneys, taskFilter])

  // Human steps filtered by task (global sessionFilter already applied upstream)
  const filteredHumanSteps = useMemo(() => {
    const selectedTask = tasks.find(t => t.id === taskFilter)
    const result = new Map<string, AgentStep[]>()

    for (const [sessionId, journeys] of humanJourneysBySession) {
      const matched = journeys.filter(tj => {
        if (taskFilter === null) return true
        if (tj.taskId !== null) return Number(tj.taskId) === taskFilter
        return selectedTask ? tj.taskTitle === selectedTask.title : false
      })
      const steps = matched.flatMap(tj => tj.steps)
      if (steps.length > 0) result.set(sessionId, steps)
    }

    return result
  }, [humanJourneysBySession, taskFilter, tasks])

  const pages = useMemo(() => {
    const agentStepArrays = taskAgentJourneys.map(j => j.steps as AgentStep[])
    const humanStepArrays = Array.from(filteredHumanSteps.values())
    return getAggregatedScreenshots(agentStepArrays, humanStepArrays)
  }, [taskAgentJourneys, filteredHumanSteps])

  // Reset page index when pages change
  useEffect(() => {
    setPageIdx(p => Math.min(p, Math.max(0, pages.length - 1)))
  }, [pages.length])

  const page = pages[Math.min(pageIdx, pages.length - 1)]

  const hasAgent = page?.heatmapDots?.some(d => d.kind === 'agent') ?? false
  const hasHuman = page?.heatmapDots?.some(d => d.kind === 'human') ?? false
  const hasAttention = page?.heatmapDots?.some(d => d.kind === 'attention') ?? false
  const colorMode = (hasAgent && hasHuman) || hasAttention ? 'split' : 'unified'

  // ── Shared task dropdown ────────────────────────────────────────────────────
  const taskDropdown = tasks.length > 0 ? (
    <div style={{ padding: '6px 16px', borderBottom: '1px solid var(--gray100)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 'var(--fs-small)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--gray400)', flexShrink: 0 }}>Task</span>
      <select
        value={taskFilter ?? ''}
        onChange={e => setTaskFilter(e.target.value === '' ? null : Number(e.target.value))}
        style={{
          fontSize: 'var(--fs-small)', fontWeight: 500, fontFamily: 'var(--font-sans)',
          padding: '4px 28px 4px 10px', borderRadius: 6, border: '1px solid var(--border)',
          background: 'var(--surface)', color: 'var(--text-primary)', cursor: 'pointer',
          appearance: 'none', backgroundImage: CHEVRON_SVG,
          backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center',
          minWidth: 160, maxWidth: 300,
        }}
      >
        {tasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
      </select>
    </div>
  ) : null

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
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
        {taskDropdown}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 8, color: 'var(--gray400)', fontSize: 'var(--fs-body)' }}>
          <span style={{ fontSize: 'var(--fs-headline)' }}>🗺</span>
          No journey data for this task.
        </div>
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

      {/* Task filter dropdown */}
      {taskDropdown}

      {/* Legend */}
      <div style={{ display: 'flex', gap: 12, padding: '6px 16px', alignItems: 'center', flexShrink: 0, borderBottom: '1px solid var(--gray100)' }}>
        <span style={{ fontSize: 'var(--fs-small)', color: 'var(--gray400)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Heatmap:</span>
        {agentDotCount > 0 && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-small)', color: '#32494B' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(50,73,75,0.5)', border: '1.5px solid #32494B', display: 'inline-block' }} />
            Agent clicks ({agentDotCount})
          </span>
        )}
        {humanDotCount > 0 && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-small)', color: '#881342' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(136,19,66,0.5)', border: '1.5px solid #881342', display: 'inline-block' }} />
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
