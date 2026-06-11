import { debug } from '../lib/debug'
import { storageKeys } from '../lib/storage'
import { useComparativeAnalysis } from '../hooks/useComparativeAnalysis'
import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'

import { useProjectContext } from '../context/ProjectContext'
import { useAgentRun } from '../context/AgentRunContext'
import type { Project } from '../lib/types'
import { PROJECTS_STORAGE_KEY } from '../lib/types'
import * as api from '../lib/api'

import SankeyDiagram, { type NodeDivergence } from '../components/dashboard/SankeyDiagram'

import HorizonGraph from '../components/dashboard/HorizonGraph'
import HorizonInsightsPanel from '../components/dashboard/HorizonInsightsPanel'
// ─── Re-evaluate modal ────────────────────────────────────────────────────────

function ReEvalModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: (changes: string) => void }) {
  const [text, setText] = useState('')
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Iterate</span>
          <button className="modal-close-btn" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '20px 28px' }}>
          <p style={{ fontSize: 'var(--fs-body)', color: 'var(--gray600)', marginBottom: 14, lineHeight: 1.6 }}>
            Describe the changes you made since the last evaluation and which issues you addressed.
          </p>
          <textarea
            className="input input-textarea"
            rows={5}
            placeholder="e.g. Clarified the nav label 'Solutions' → 'Products', moved the CTA above the fold…"
            value={text}
            onChange={e => setText(e.target.value)}
            autoFocus
          />
        </div>
        <div style={{ padding: '0 28px 24px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" disabled={!text.trim()} onClick={() => onConfirm(text.trim())}>
            Iterate
          </button>
        </div>
      </div>
    </div>
  )
}

import AggregateFlowView from '../components/dashboard/AggregateFlowView'
import ActionPointsList, { GlyphDot } from '../components/dashboard/ActionPointsList'
import { AnnotationCard } from '../components/dashboard/actionPoints/AnnotationCard'
import HeatmapCarousel from '../components/dashboard/HeatmapCarousel'
import HeatmapInsightsPanel from '../components/dashboard/HeatmapInsightsPanel'
import ComparePanel from '../components/dashboard/ComparePanel'
import SankeyInsightsPanel from '../components/dashboard/SankeyInsightsPanel'
import AggregateInsightsPanel from '../components/dashboard/AggregateInsightsPanel'

import {
  getStepsFromSessionEvents,
  getTaskJourneysFromSessionEvents,
  loadAgentSteps,
  type HumanTaskJourney,
} from '../components/dashboard/screenshotData'
import type { Session } from '../lib/types'
import { ANALYSIS_STORAGE_KEY, VERSIONS_KEY, VersionEntry, getVersions } from './EvaluationPage'
import type { AgentStep } from '../components/agent/agentTypes'
import type { CompareHighlight, DiagramRef } from '../lib/api'

// ─── Shared types ─────────────────────────────────────────────────────────────

interface SelectOption { id: string; name: string; meta?: string }

type ActiveView = 'overview' | 'aggregate' | 'heatmap' | 'human_vs_ai' | 'horizon_graph' | 'linked_flow'// ─── Nav item icons ───────────────────────────────────────────────────────────

// ─── Filter pills ─────────────────────────────────────────────────────────────

function FilterPill({ label, active, color, onClick }: { label: string; active: boolean; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '4px 10px', borderRadius: 999, cursor: 'pointer', border: 'none',
        fontSize: 'var(--fs-small)', fontWeight: 600, fontFamily: 'var(--font-sans)',
        background: active ? color : 'var(--gray100)',
        color: active ? '#fff' : 'var(--text-secondary)',
        transition: 'background 0.13s, color 0.13s',
        whiteSpace: 'nowrap',
      }}
    >
      {active && (
        <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M1.5 5l2.5 2.5 5-5"/>
        </svg>
      )}
      {label}
    </button>
  )
}


function SettingsPanel({
  agentOptions, sessionOptions,
  agentFilter, sessionFilter,
  taskOptions,
  taskFilterMode,
  aggregateTaskId,
  heatmapTaskFilter,
  aggTrajectories,
  prevVersionLabel,
  onToggleAgent, onSelectAllAgents,
  onToggleSession, onSelectAllSessions,
  onSelectAggregateTask,
  onToggleHeatmapTask,
  onSelectAllHeatmapTasks,
  onToggleAggTrajectory,
}: {
  agentOptions: SelectOption[]
  sessionOptions: SelectOption[]
  agentFilter: Set<string> | null
  sessionFilter: Set<string> | null
  taskOptions: SelectOption[]
  taskFilterMode: 'none' | 'single' | 'multi'
  aggregateTaskId: number | null
  heatmapTaskFilter: Set<number> | null
  aggTrajectories?: { showHuman: boolean; showAi: boolean; showPrev: boolean } | null
  prevVersionLabel?: string
  onToggleAgent: (id: string) => void
  onSelectAllAgents: () => void
  onToggleSession: (id: string) => void
  onSelectAllSessions: () => void
  onSelectAggregateTask: (id: number | null) => void
  onToggleHeatmapTask: (id: number) => void
  onSelectAllHeatmapTasks: () => void
  onToggleAggTrajectory?: (which: 'human' | 'ai' | 'prev') => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function out(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', out)
    return () => document.removeEventListener('mousedown', out)
  }, [])

  const agentAllSelected = agentFilter === null
  const sessionAllSelected = sessionFilter === null

  const activeFilters = [
    !agentAllSelected && agentFilter!.size < agentOptions.length,
    !sessionAllSelected && sessionFilter!.size < sessionOptions.length,
    taskFilterMode === 'single' && aggregateTaskId !== null,
    taskFilterMode === 'multi' && heatmapTaskFilter !== null && heatmapTaskFilter.size < taskOptions.length,
    aggTrajectories && (!aggTrajectories.showHuman || !aggTrajectories.showAi || !aggTrajectories.showPrev),
  ].filter(Boolean).length

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        className="btn btn-outline btn-sm"
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: open ? 'var(--accent-soft)' : undefined,
          borderColor: open ? 'var(--accent)' : undefined,
          color: open ? 'var(--accent)' : undefined,
        }}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 4h12M4 8h8M6 12h4"/>
        </svg>
        Filters
        {activeFilters > 0 && (
          <span style={{
            background: 'var(--accent)', color: '#fff', borderRadius: 999,
            fontSize: 'var(--fs-small)', fontWeight: 700, padding: '1px 6px', lineHeight: 1.5, marginLeft: 'auto',
          }}>{activeFilters}</span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 14, boxShadow: '0 12px 40px rgba(26,43,66,0.14)',
          zIndex: 200,
          fontFamily: 'var(--font-sans)',
          overflow: 'hidden',
        }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 'var(--fs-small)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 9 }}>AI Agents</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <FilterPill label="All" active={agentAllSelected} color="#0072B2" onClick={onSelectAllAgents} />
              {agentOptions.map(o => (
                <FilterPill key={o.id} label={o.name} active={agentAllSelected || agentFilter!.has(o.id)} color="#0072B2" onClick={() => onToggleAgent(o.id)} />
              ))}
              {agentOptions.length === 0 && <span style={{ fontSize: 'var(--fs-small)', color: 'var(--text-muted)' }}>No agents run yet</span>}
            </div>
          </div>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 'var(--fs-small)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 9 }}>Human Sessions</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <FilterPill label="All" active={sessionAllSelected} color="#E69F00" onClick={onSelectAllSessions} />
              {sessionOptions.map((o, i) => (
                <FilterPill key={o.id} label={`User ${i + 1}`} active={sessionAllSelected || sessionFilter!.has(o.id)} color="#E69F00" onClick={() => onToggleSession(o.id)} />
              ))}
              {sessionOptions.length === 0 && <span style={{ fontSize: 'var(--fs-small)', color: 'var(--text-muted)' }}>No sessions yet</span>}
            </div>
          </div>
          {aggTrajectories && onToggleAggTrajectory && (
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 'var(--fs-small)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 9 }}>Trajectories</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <FilterPill label="Human (steered AI)" active={aggTrajectories.showHuman} color="#E69F00" onClick={() => onToggleAggTrajectory('human')} />
                <FilterPill label="AI" active={aggTrajectories.showAi} color="#0072B2" onClick={() => onToggleAggTrajectory('ai')} />
                {prevVersionLabel && (
                  <FilterPill label={prevVersionLabel} active={aggTrajectories.showPrev} color="#6b7280" onClick={() => onToggleAggTrajectory('prev')} />
                )}
              </div>
            </div>
          )}
          {taskFilterMode !== 'none' && (
            <div style={{ padding: '14px 16px' }}>
              <div style={{ fontSize: 'var(--fs-small)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 9 }}>
                {taskFilterMode === 'single' ? 'Task' : 'Tasks'}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {taskFilterMode === 'single' ? (
                  <>
                    {taskOptions.map(o => (
                      <FilterPill key={o.id} label={o.name} active={aggregateTaskId === Number(o.id)} color="#3c1580" onClick={() => onSelectAggregateTask(Number(o.id))} />
                    ))}
                  </>
                ) : (
                  <>
                    <FilterPill label="All" active={heatmapTaskFilter === null} color="#3c1580" onClick={onSelectAllHeatmapTasks} />
                    {taskOptions.map(o => (
                      <FilterPill
                        key={o.id}
                        label={o.name}
                        active={heatmapTaskFilter === null || heatmapTaskFilter.has(Number(o.id))}
                        color="#3c1580"
                        onClick={() => onToggleHeatmapTask(Number(o.id))}
                      />
                    ))}
                  </>
                )}
                {taskOptions.length === 0 && <span style={{ fontSize: 'var(--fs-small)', color: 'var(--text-muted)' }}>No tasks available</span>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Trajectory view ──────────────────────────────────────────────────────────


// ─── Main dashboard ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { siteId } = useParams<{ siteId: string }>()
  const navigate = useNavigate()
  const { tasks: contextTasks, agents, sessions: allSessions, journeys: allJourneys, testerLink, siteUrl, refreshJourneys, refreshSessions } = useProjectContext()

  // Refresh journey + session counts on every dashboard mount so the cache
  // invalidation logic sees the latest data and re-runs analysis when needed.
  useEffect(() => {
    refreshJourneys()
    refreshSessions()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { runState, currentTaskIdx, totalTasks, runningTaskTitle, statusMsg, progress, runningSiteId, startRun } = useAgentRun()
  const agentIsRunning = runState === 'running' && runningSiteId === siteId

  // Refresh journeys when an agent run for this site completes so the
  // dashboard picks up the newly-saved journey without requiring a full reload.
  const prevRunStateRef = useRef(runState)
  useEffect(() => {
    if (prevRunStateRef.current === 'running' && runState !== 'running' && runningSiteId === siteId) {
      refreshJourneys()
    }
    prevRunStateRef.current = runState
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runState])

  const projects: Project[] = JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY) ?? '[]')
  const project = projects.find(p => p.siteId === siteId)
  const hostname = (() => { try { return new URL(project?.url ?? '').hostname } catch { return project?.url ?? '' } })()
  const faviconUrl = hostname ? `https://www.google.com/s2/favicons?domain=${hostname}&sz=128` : null

  const _versions = getVersions(siteId!, testerLink)

  // Per-action-point screenshot from ActionPointsList (compact mode)
  const [actionScreenshot, setActionScreenshot] = useState<import('../lib/api').ScreenshotMeta | null>(null)
  const [actionAnnotation, setActionAnnotation] = useState<import('../lib/api').AnnotateResult | null>(null)
  const [actionPending, setActionPending] = useState(false)
  const [overviewHoveredDot, setOverviewHoveredDot] = useState<number | null>(null)
  const [overviewPinnedDot, setOverviewPinnedDot] = useState<number | null>(null)
  const overviewDotRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    const ann = actionAnnotation
    debug(
      `[CC:dash] annotation state changed | sc: ${actionScreenshot?.id ?? 'null'} | pending: ${actionPending} | ann: ${
        ann
          ? `found=${ann.found} pts=${ann.points.length}` + (ann.points[0] ? ` first=(${ann.points[0].x.toFixed(0)},${ann.points[0].y.toFixed(0)}) "${ann.points[0].label.slice(0, 40)}"` : '')
          : 'null'
      }`
    )
  }, [actionScreenshot, actionAnnotation, actionPending])

  const [compareContext, setCompareContext] = useState<{
    highlight?: CompareHighlight
    actionPointText?: string
    taskTitle?: string
    evidence?: string
    explanation?: string
    targetView: ActiveView
  } | null>(null)
  const [heatmapHighlightText, setHeatmapHighlightText] = useState<string | null>(null)
  const [heatmapActiveTaskId, setHeatmapActiveTaskId] = useState<number | null>(null)

  const [agentFilter, setAgentFilter] = useState<Set<string> | null>(null)
  const [sessionFilter, setSessionFilter] = useState<Set<string> | null>(null)
  const [sankeyDivergences, setSankeyDivergences] = useState<NodeDivergence[]>([])
  const [aggShowHuman, setAggShowHuman] = useState(true)
  const [aggShowAi, setAggShowAi] = useState(true)
  const [aggShowPrev, setAggShowPrev] = useState(true)


  const [searchParams, setSearchParams] = useSearchParams()
  const navigatingViaLinkRef = useRef(false)
  const urlView = searchParams.get('view') ?? 'overview'
  const activeView: ActiveView = (['overview', 'aggregate', 'heatmap', 'human_vs_ai', 'horizon_graph', 'linked_flow'] as ActiveView[]).includes(urlView as ActiveView)
    ? (urlView as ActiveView)
    : 'overview'

  // Only expose context when the user is on the view it was set for (must be after activeView)
  const activeCompareContext = compareContext?.targetView === activeView ? compareContext : null

  // Clear highlight when navigating directly (sidebar/URL) rather than via an action-point link
  useEffect(() => {
    if (navigatingViaLinkRef.current) {
      navigatingViaLinkRef.current = false
    } else {
      setCompareContext(null)
    }
   
  }, [activeView])

  const DIAGRAM_VIEW_MAP: Partial<Record<string, ActiveView>> = {
    compare: 'human_vs_ai',
    sankey: 'linked_flow',
    horizon: 'horizon_graph',
    linked_flow: 'linked_flow',
    heatmap: 'heatmap',
    multiflow: 'aggregate',
    human_agg: 'aggregate',
    similarity: 'aggregate',
    comparative: 'overview',
    insights: 'aggregate',
    policy: 'aggregate',
  }

  function setActiveView(view: ActiveView) {
    setSearchParams((prev: URLSearchParams) => {
      const p = new URLSearchParams(prev)
      p.set('view', view)
      return p
    }, { replace: true })
  }

  function handleNavigateTo(_tab: string, view?: string, noteCtx?: { actionPointText: string; taskTitle: string; evidence: string }, diagramRef?: DiagramRef, pointText?: string) {
    const target = (view ? DIAGRAM_VIEW_MAP[view] : undefined) ?? 'aggregate'
    const HIGHLIGHT_VIEWS: ActiveView[] = ['human_vs_ai', 'horizon_graph', 'linked_flow', 'aggregate']
    navigatingViaLinkRef.current = true
    if (HIGHLIGHT_VIEWS.includes(target) && diagramRef) {
      setCompareContext({ highlight: diagramRef.highlight, ...noteCtx, explanation: diagramRef.diagram_explanation, targetView: target })
    } else {
      setCompareContext(null)
    }
    if (target === 'heatmap') {
      setHeatmapHighlightText(pointText ?? null)
    } else {
      setHeatmapHighlightText(null)
    }
    if (target === 'aggregate' && noteCtx?.taskTitle) {
      const match = tasks.find(t => t.title === noteCtx.taskTitle)
      if (match) setAggregateTaskId(match.id)
    }
    setActiveView(target)
  }

  const [aggregateTaskId, setAggregateTaskId] = useState<number | null>(null)
  const [heatmapTaskFilter, setHeatmapTaskFilter] = useState<Set<number> | null>(null)
  const [overviewSplitPct, setOverviewSplitPct] = useState(68)
  const overviewContainerRef = useRef<HTMLDivElement>(null)

  const [rightPanelW, setRightPanelW] = useState(320)
  const rightPanelContainerRef = useRef<HTMLDivElement>(null)

  function startRightPanelDrag(e: React.MouseEvent) {
    e.preventDefault()
    const container = rightPanelContainerRef.current
    if (!container) return
    const onMove = (mv: MouseEvent) => {
      const rect = container.getBoundingClientRect()
      const w = Math.min(600, Math.max(180, rect.right - mv.clientX))
      setRightPanelW(w)
    }
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function startOverviewDrag(e: React.MouseEvent) {
    e.preventDefault()
    const container = overviewContainerRef.current
    if (!container) return
    const onMove = (mv: MouseEvent) => {
      const rect = container.getBoundingClientRect()
      const pct = Math.min(80, Math.max(20, ((mv.clientX - rect.left) / rect.width) * 100))
      setOverviewSplitPct(pct)
    }
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const [compareMode, setCompareMode] = useState<'ai_vs_human' | 'old_vs_new'>('ai_vs_human')
  const [ratingsSummary, setRatingsSummary] = useState<api.RatingsSummary | null>(null)
  const [reEvalOpen, setReEvalOpen] = useState(false)

  const versions = _versions
  const latestVersionId = versions[versions.length - 1]?.id ?? 'v1'
  const VERSION_STORAGE_KEY = storageKeys.lastVersion(siteId!)
  const savedVersion = localStorage.getItem(VERSION_STORAGE_KEY) ?? latestVersionId
  const selectedVersion = searchParams.get('version') ?? savedVersion

  useEffect(() => {
    if (selectedVersion) localStorage.setItem(VERSION_STORAGE_KEY, selectedVersion)
  }, [selectedVersion, VERSION_STORAGE_KEY])

  const activeVersionIdx = versions.findIndex(v => v.id === selectedVersion)
  const activeVersionId = versions[activeVersionIdx !== -1 ? activeVersionIdx : versions.length - 1]?.id ?? latestVersionId
  const versionFrom = activeVersionIdx > 0 ? (versions[activeVersionIdx]?.createdAt ?? null) : null
  const versionTo = versions[activeVersionIdx + 1]?.createdAt ?? null
  const sessions = useMemo(
    () => allSessions.filter((s: Session) =>
      (!versionFrom || s.startedAt >= versionFrom) && (!versionTo || s.startedAt < versionTo)
    ),
    [allSessions, versionFrom, versionTo],
  )
  const journeys = useMemo(
    () => allJourneys.filter((j: api.JourneyResponse) =>
      (!versionFrom || j.completed_at >= versionFrom) && (!versionTo || j.completed_at < versionTo)
    ),
    [allJourneys, versionFrom, versionTo],
  )

  const activeVersionEntry = versions[activeVersionIdx]
  const tasks = (activeVersionEntry?.tasks && activeVersionEntry.tasks.length > 0)
    ? activeVersionEntry.tasks
    : contextTasks

  // Previous version data for "Old vs New Version" comparison
  const hasPrevVersion = activeVersionIdx > 0
  const prevVersionIdx = activeVersionIdx - 1
  const prevVersionFrom = prevVersionIdx > 0 ? (versions[prevVersionIdx]?.createdAt ?? null) : null
  const prevVersionTo = versionFrom  // prev version ends where current begins

  const prevVersionJourneys = useMemo(
    () => !hasPrevVersion ? [] : allJourneys.filter((j: api.JourneyResponse) =>
      (!prevVersionFrom || j.completed_at >= prevVersionFrom) && (!prevVersionTo || j.completed_at < prevVersionTo)
    ),
    [allJourneys, hasPrevVersion, prevVersionFrom, prevVersionTo],
  )
  const prevVersionAgentJourneys = useMemo(
    () => prevVersionJourneys.filter(j => j.is_agent !== false),
    [prevVersionJourneys],
  )
  const prevVersionAgentSteps = useMemo<import('../components/agent/agentTypes').AgentStep[]>(
    () => prevVersionAgentJourneys.flatMap(j => j.steps as import('../components/agent/agentTypes').AgentStep[]),
    [prevVersionAgentJourneys],
  )
  const prevVersionLabel = versions[prevVersionIdx]?.label
    ? `Human from ${versions[prevVersionIdx]!.label.toLowerCase()}`
    : 'Human from previous version'

  const journeyAgentMeta = useMemo(() => {
    const byPrompt = new Map<string, { id: string; name: string; model?: string }>()
    agents.forEach(a => {
      const prompt = (a.prompt ?? '').trim()
      if (prompt) byPrompt.set(prompt, { id: a.id, name: a.name, model: a.model })
    })

    function parsePersona(taskTitle: string | null | undefined): string | null {
      if (!taskTitle) return null
      const m = taskTitle.match(/^\[Persona:\s*([\s\S]*?)\]\s*/)
      return m?.[1]?.trim() || null
    }

    function optionForJourney(j: api.JourneyResponse): SelectOption {
      const persona = parsePersona(j.task_title)
      if (persona) {
        const mapped = byPrompt.get(persona)
        if (mapped) {
          return {
            id: `agent:${mapped.id}`,
            name: mapped.name,
            meta: mapped.model,
          }
        }
        const shortPersona = persona.length > 28 ? `${persona.slice(0, 27)}…` : persona
        return {
          id: `persona:${persona}`,
          name: shortPersona,
          meta: 'persona run',
        }
      }

      if (j.source) {
        return {
          id: `source:${j.source}`,
          name: j.source === 'agent' ? 'Agent' : j.source,
          meta: undefined,
        }
      }

      return {
        id: `journey:${j.id}`,
        name: `AI Run #${j.id}`,
        meta: undefined,
      }
    }

    return {
      optionForJourney,
    }
  }, [agents])

  const agentJourneyCount = journeys.filter(j => j.is_agent !== false).length
  const humanJourneyCount = journeys.filter(j => j.is_agent === false).length

  const {
    compareAnalysis, compareLoading, compareError, analysisRunId,
    runComparative: handleRunComparative, rerunComparative: handleRerunComparative,
  } = useComparativeAnalysis(siteId!, activeVersionId, agentJourneyCount, humanJourneyCount)

  async function handleReEvaluate(changes: string) {
    const projs: Project[] = JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY) ?? '[]')
    const proj = projs.find(p => p.siteId === siteId)
    const newTesterLink = proj?.testerLink ?? testerLink
    const newVersionId = `v${versions.length + 1}`
    const newEntry: VersionEntry = {
      id: newVersionId,
      label: `Version ${versions.length + 1}.0`,
      changes,
      createdAt: new Date().toISOString(),
      testerLink: newTesterLink,
      tasks: contextTasks,
    }
    const updated = [...versions, newEntry]
    localStorage.setItem(VERSIONS_KEY(siteId!), JSON.stringify(updated))
    localStorage.setItem(VERSION_STORAGE_KEY, newVersionId)
    localStorage.removeItem(ANALYSIS_STORAGE_KEY(siteId!, newVersionId))
    localStorage.removeItem(storageKeys.agentRun(siteId!))
    setReEvalOpen(false)

    // Auto-start agent runs for the new version in background
    const selectedAgentsForRun = agents.filter(a => a.selected)
    startRun(siteId!, siteUrl, contextTasks, newVersionId, selectedAgentsForRun.length > 0 ? selectedAgentsForRun : undefined)

    // Flag the aggregate view to auto-run the prev policy when it next mounts
    if (versionFrom) {
      localStorage.setItem(storageKeys.prevPolicyFlag(siteId!), JSON.stringify({ prevVersionEndsAt: versionFrom }))
    }

    // Navigate to comparison view with new version selected, defaulting to old vs new
    setCompareMode('old_vs_new')
    setSearchParams(prev => {
      const p = new URLSearchParams(prev)
      p.set('view', 'human_vs_ai')
      p.set('version', newVersionId)
      return p
    }, { replace: true })
  }

  const allAgentJourneys = useMemo(() => {
    const all = journeys.filter(j => j.is_agent !== false)
    if (all.length === 0) {
      const local = loadAgentSteps(siteId!, activeVersionId)
      if (local && local.length > 0) {
        return [{ id: -1, site_id: siteId!, task_id: null, user_id: null, task_title: '', total_steps: local.length, steps: local, completed_at: '', updated_at: '', llm_analysis: null, is_agent: true, embedding: null, source: 'local' }]
      }
    }
    return all
  }, [journeys, siteId, activeVersionId])

  const agentOptions = useMemo<SelectOption[]>(() => {
    const out = new Map<string, SelectOption>()
    for (const j of allAgentJourneys) {
      const opt = journeyAgentMeta.optionForJourney(j)
      if (!out.has(opt.id)) out.set(opt.id, opt)
    }
    return Array.from(out.values())
  }, [allAgentJourneys, journeyAgentMeta])

  const agentOptionIds = useMemo(() => agentOptions.map(o => o.id), [agentOptions])

  const agentJourneys = useMemo(() => {
    if (agentFilter === null) return allAgentJourneys
    return allAgentJourneys.filter(j => {
      const key = journeyAgentMeta.optionForJourney(j).id
      return agentFilter.has(key)
    })
  }, [allAgentJourneys, agentFilter, journeyAgentMeta])

  useEffect(() => {
    if (agentFilter === null) return
    const valid = new Set(agentOptionIds)
    const next = new Set(Array.from(agentFilter).filter(id => valid.has(id)))
    // Keep empty selection as-is so users can intentionally hide all AI runs.
    if (next.size !== agentFilter.size) {
      setAgentFilter(next)
    }
  }, [agentFilter, agentOptionIds])


  useEffect(() => {
    if (!siteId) return
    api.getRatingsSummary(siteId).then(setRatingsSummary).catch(() => {})
  }, [siteId])

  const [humanStepsBySession, setHumanStepsBySession] = useState<Map<string, AgentStep[]>>(new Map())
  const [humanLoading, setHumanLoading] = useState(false)
  const [humanJourneysBySession, setHumanJourneysBySession] = useState<Map<string, HumanTaskJourney[]>>(new Map())

  const sessionIds = sessions.map((s: Session) => s.id).join(',')
useEffect(() => {
  if (sessions.length === 0) return
  setHumanLoading(true)
  let cancelled = false
  Promise.all(
    sessions.map(s =>
      Promise.all([
        api.listEvents(s.id, 500),
        api.listSessionScreenshots(s.id).catch(() => [] as api.ScreenshotMeta[]),
      ])
        .then(([events, metas]) => {
          const flatSteps = getStepsFromSessionEvents(events, siteUrl, metas, s.viewportW, s.viewportH)
          const taskJourneys = getTaskJourneysFromSessionEvents(events, siteUrl, metas, s.viewportW, s.viewportH)
          return [s.id, flatSteps, taskJourneys] as const
        })
        .catch(() => [s.id, [] as AgentStep[], [] as HumanTaskJourney[]] as const)
    )
  ).then(results => {
    if (cancelled) return
    const flatMap = new Map<string, AgentStep[]>()
    const taskMap = new Map<string, HumanTaskJourney[]>()
    for (const [id, flat, tasks] of results) {
      flatMap.set(id, flat)
      taskMap.set(id, tasks)
    }
    setHumanStepsBySession(flatMap)
    setHumanJourneysBySession(taskMap)
    setHumanLoading(false)
  })
  return () => { cancelled = true }
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [sessionIds, siteUrl])

  const humanJourneyMeta = useMemo<{ steps: AgentStep[]; label: string; taskId: string | null }[]>(() => {
    const ids = sessionFilter === null ? sessions.map(s => s.id) : Array.from(sessionFilter)
    const out: { steps: AgentStep[]; label: string; taskId: string | null }[] = []
    ids.forEach(sid => {
      const taskJourneys = humanJourneysBySession.get(sid) ?? []
      const userNum = sessions.findIndex(s => s.id === sid) + 1
      taskJourneys.forEach(tj => {
        if (tj.steps.length === 0) return
        const userLabel = userNum > 0 ? `User #${userNum}` : `Session`
        const taskShort = tj.taskTitle.length > 28 ? tj.taskTitle.slice(0, 27) + '…' : tj.taskTitle
        out.push({
          steps: tj.steps,
          label: taskJourneys.length > 1 ? `${userLabel} · ${taskShort}` : userLabel,
          taskId: tj.taskId,
        })
      })
    })
    return out
  }, [sessionFilter, sessions, humanJourneysBySession])

  const humanJourneySteps = useMemo<AgentStep[][]>(
    () => humanJourneyMeta.map(j => j.steps),
    [humanJourneyMeta],
  )

  // Session-filtered view of the task journey map, used by HeatmapCarousel
  const filteredHumanJourneysBySession = useMemo(() => {
    if (sessionFilter === null) return humanJourneysBySession
    const out = new Map<string, HumanTaskJourney[]>()
    for (const [id, journeys] of humanJourneysBySession) {
      if (sessionFilter.has(id)) out.set(id, journeys)
    }
    return out
  }, [humanJourneysBySession, sessionFilter])

  // Task-filtered variants for linked_flow / horizon_graph / human_vs_ai views
  const sharedTaskFilteredAgentJourneys = useMemo(() => {
    if (heatmapTaskFilter === null) return agentJourneys
    return agentJourneys.filter(j => heatmapTaskFilter.has(j.task_id ?? -1))
  }, [agentJourneys, heatmapTaskFilter])

  const sharedTaskFilteredAgentJourneySteps = useMemo<AgentStep[][]>(
    () => sharedTaskFilteredAgentJourneys.map(j => j.steps as AgentStep[]),
    [sharedTaskFilteredAgentJourneys],
  )
  const sharedTaskFilteredAgentLabels = useMemo(
    () => sharedTaskFilteredAgentJourneys.map((_, i) => `AI Run #${i + 1}`),
    [sharedTaskFilteredAgentJourneys],
  )

  const sharedTaskFilteredHumanJourneyMeta = useMemo(() => {
    if (heatmapTaskFilter === null) return humanJourneyMeta
    return humanJourneyMeta.filter(j => j.taskId !== null && heatmapTaskFilter.has(Number(j.taskId)))
  }, [humanJourneyMeta, heatmapTaskFilter])

  const sharedTaskFilteredHumanJourneySteps = useMemo<AgentStep[][]>(
    () => sharedTaskFilteredHumanJourneyMeta.map(j => j.steps),
    [sharedTaskFilteredHumanJourneyMeta],
  )
  const sharedTaskFilteredHumanLabels = useMemo(
    () => sharedTaskFilteredHumanJourneyMeta.map(j => j.label),
    [sharedTaskFilteredHumanJourneyMeta],
  )

  const allAgentSteps = useMemo<AgentStep[]>(
    () => agentJourneys.flatMap(j => j.steps as AgentStep[]),
    [agentJourneys],
  )

  const sharedTaskFilteredAllAgentSteps = useMemo<AgentStep[]>(
    () => sharedTaskFilteredAgentJourneySteps.flat(),
    [sharedTaskFilteredAgentJourneySteps],
  )
  const sharedTaskFilteredAllHumanSteps = useMemo<AgentStep[]>(
    () => sharedTaskFilteredHumanJourneySteps.flat(),
    [sharedTaskFilteredHumanJourneySteps],
  )
  const sharedTaskFilteredHumanSessionStepCounts = useMemo(
    () => sharedTaskFilteredHumanJourneySteps.map(s => s.length).filter(n => n > 0),
    [sharedTaskFilteredHumanJourneySteps],
  )

  const visibleSessionCount = sessionFilter === null ? sessions.length : sessionFilter.size


  const toggleAgent = useCallback((id: string) => {
    setAgentFilter(prev => {
      const allIds = agentOptionIds
      const current = prev === null ? new Set(allIds) : new Set(prev)
      if (current.has(id)) { current.delete(id); return current }
      else { current.add(id); if (current.size === allIds.length) return null; return current }
    })
  }, [agentOptionIds])
  function toggleSession(id: string) {
    setSessionFilter(prev => {
      const allIds = sessions.map(s => s.id)
      const current = prev === null ? new Set(allIds) : new Set(prev)
      if (current.has(id)) { current.delete(id); return current }
      else { current.add(id); if (current.size === allIds.length) return null; return current }
    })
  }

  function toggleHeatmapTask(id: number) {
    setHeatmapTaskFilter(prev => {
      const allIds = tasks.map(t => t.id)
      const current = prev === null ? new Set(allIds) : new Set(prev)
      if (current.has(id)) {
        current.delete(id)
        return current
      }
      current.add(id)
      if (current.size === allIds.length) return null
      return current
    })
  }

  const humanOptions: SelectOption[] = sessions.map(s => ({
    id: s.id,
    name: `Session ${s.id.slice(0, 8)}`,
    meta: new Date(s.startedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
  }))
  const taskOptions: SelectOption[] = tasks.map(t => ({ id: String(t.id), name: t.title }))
  const taskFilterMode: 'none' | 'single' | 'multi' = activeView === 'aggregate'
    ? 'single'
    : (activeView === 'heatmap' || activeView === 'linked_flow' || activeView === 'human_vs_ai' || activeView === 'horizon_graph')
      ? 'multi'
      : 'none'

  const filtersControl = (
    <SettingsPanel
      agentOptions={agentOptions} sessionOptions={humanOptions}
      agentFilter={agentFilter} sessionFilter={sessionFilter}
      taskOptions={taskOptions}
      taskFilterMode={taskFilterMode}
      aggregateTaskId={aggregateTaskId}
      heatmapTaskFilter={heatmapTaskFilter}
      aggTrajectories={activeView === 'aggregate' ? { showHuman: aggShowHuman, showAi: aggShowAi, showPrev: aggShowPrev } : null}
      prevVersionLabel={hasPrevVersion ? prevVersionLabel : undefined}
      onToggleAgent={toggleAgent}
      onSelectAllAgents={() => setAgentFilter(null)}
      onToggleSession={toggleSession}
      onSelectAllSessions={() => setSessionFilter((prev: Set<string> | null) => prev === null ? new Set<string>() : null)}
      onSelectAggregateTask={setAggregateTaskId}
      onToggleHeatmapTask={toggleHeatmapTask}
      onSelectAllHeatmapTasks={() => setHeatmapTaskFilter(null)}
      onToggleAggTrajectory={which => {
        if (which === 'human') setAggShowHuman(v => !v)
        else if (which === 'ai') setAggShowAi(v => !v)
        else setAggShowPrev(v => !v)
      }}
    />
  )


  return (
    <>
    <div className="proj-dash-layout fade-in">

      {/* ── Main content ── */}
      <main className="proj-dash-main">

        {/* Top bar */}
        <div className="dash-topbar">
          {/* Left: back arrow + view title */}
          <div className="dash-topbar-left">
            <button
              onClick={() => activeView === 'overview' ? navigate(`/projects/${siteId}`) : setActiveView('overview')}
              title={activeView === 'overview' ? 'Back to Project Overview' : 'Back to Action Points'}
              className="dash-topbar-back"
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3L5 8l5 5"/></svg>
            </button>
            <span className="dash-topbar-view-name">
                  {{
                    overview: 'Action Points',
                    aggregate: 'Human Steered Agent',
                    heatmap: 'Heatmap',
                    human_vs_ai: 'Human vs AI',
                    horizon_graph: 'Horizon Graph',
                    linked_flow: 'Flow + Horizon',
                  }[activeView]}
              </span>
          </div>

          {/* Center: project favicon + name (absolutely centered) */}
          <div className="dash-topbar-center">
            {faviconUrl && (
              <img src={faviconUrl} alt="" width={20} height={20}
                style={{ borderRadius: 4, flexShrink: 0 }}
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
              />
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, minWidth: 0 }}>
              {project?.url
                ? <a href={project.url} className="dash-topbar-project-name" target="_blank" rel="noopener noreferrer">{project?.label ?? siteId}</a>
                : <span className="dash-topbar-project-name">{project?.label ?? siteId}</span>
              }
              {hostname && <span className="dash-topbar-hostname">{hostname}</span>}
            </div>
          </div>

          {/* Right: controls */}
          <div className="dash-topbar-right">
            <select
              className="version-select version-select-sm"
              value={selectedVersion}
              onChange={e => setSearchParams(prev => { const p = new URLSearchParams(prev); p.set('version', e.target.value); return p }, { replace: true })}
            >
              {[...versions].reverse().map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
            <button className="btn btn-primary btn-xs" style={{ whiteSpace: 'nowrap' }} onClick={() => {
              if (compareLoading && !window.confirm('Analysis is still running. Start a new evaluation anyway?')) return
              setReEvalOpen(true)
            }}>
              Evaluate Updated Version
            </button>
            <span className="info-tooltip-wrap">
              <span className="info-tooltip-icon">i</span>
              <span className="info-tooltip-bubble">Runs a new evaluation loop with your latest changes — part of the human-in-the-loop workflow.</span>
            </span>
          </div>
        </div>

        {/* ── OVERVIEW ── */}
        <div ref={overviewContainerRef} style={{ flex: 1, display: activeView === 'overview' ? 'flex' : 'none', overflow: 'hidden', minHeight: 0 }}>
            <div style={{ flex: `0 0 ${overviewSplitPct}%`, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
              <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', padding: '12px 16px', display: 'flex', flexDirection: 'column' }}>
                {actionScreenshot ? (
                  <div className="sc-stage" style={{ display: 'flex', flexDirection: 'column', maxHeight: '100%', overflow: 'visible' }}>
                    <div className="sc-chrome">
                      <div className="sc-chrome-dots"><span /><span /><span /></div>
                      <div className="sc-chrome-bar">{actionScreenshot.path ?? ''}</div>
                    </div>
                    <div className="sc-viewport" style={{ overflow: 'visible', position: 'relative' }}>
                      <img src={api.screenshotImageUrl(actionScreenshot.id)} className="sc-real-screenshot" alt="" />
                      {actionAnnotation?.found && actionAnnotation.points.map((pt, i) => {
                        const pinned = overviewPinnedDot === i
                        const visible = overviewHoveredDot === i || pinned
                        return (
                          <div
                            key={i}
                            ref={el => { overviewDotRefs.current[i] = el }}
                            style={{
                              position: 'absolute',
                              left: `${pt.x}%`, top: `${pt.y}%`,
                              transform: 'translate(-50%,-50%)',
                              zIndex: visible ? 30 : 10,
                              cursor: 'pointer',
                            }}
                            onMouseEnter={() => setOverviewHoveredDot(i)}
                            onMouseLeave={() => setOverviewHoveredDot(null)}
                            onClick={() => setOverviewPinnedDot(p => p === i ? null : i)}
                          >
                            <GlyphDot
                              glyph={pt.glyph}
                              open={pinned}
                              animationDelay={`${i * 0.12}s`}
                            />
                            {visible && overviewDotRefs.current[i] && (
                              <AnnotationCard
                                anchor={overviewDotRefs.current[i]!}
                                label={pt.label}
                                interactive={pinned}
                                onClose={() => { setOverviewPinnedDot(null); setOverviewHoveredDot(null) }}
                              />
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : actionPending ? (
                  <div className="sc-stage" style={{ display: 'flex', flexDirection: 'column', maxHeight: '100%', overflow: 'hidden' }}>
                    <div className="sc-chrome">
                      <div className="sc-chrome-dots"><span /><span /><span /></div>
                      <div className="sc-chrome-bar" style={{ color: 'var(--gray400)' }}>Selecting screenshot…</div>
                    </div>
                    <div className="sc-viewport" style={{ overflow: 'hidden', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: 'var(--gray400)' }}>
                        <span style={{ width: 22, height: 22, borderRadius: '50%', border: '2.5px solid var(--gray200)', borderTopColor: 'var(--brand)', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
                        <span style={{ fontSize: 'var(--fs-small)' }}>Finding best screenshot…</span>
                      </div>
                    </div>
                  </div>
                ) : agentIsRunning ? (
                  <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 24px' }}>
                    <div style={{ width: '100%', maxWidth: 420, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 22px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
                      {/* Header row */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <span style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--text-primary)' }}>
                          Task {currentTaskIdx + 1} of {totalTasks}
                        </span>
                        <span style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--brand)' }}>{progress}%</span>
                      </div>
                      {/* Progress bar */}
                      <div style={{ height: 6, background: 'var(--gray200)', borderRadius: 3, overflow: 'hidden', marginBottom: 12 }}>
                        <div style={{ height: '100%', width: `${progress}%`, background: 'var(--brand)', borderRadius: 3, transition: 'width 0.4s ease' }} />
                      </div>
                      {/* Task title */}
                      {runningTaskTitle && (
                        <div style={{ fontSize: 'var(--fs-body)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
                          {runningTaskTitle}
                        </div>
                      )}
                      {/* Live status */}
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, marginTop: 4, background: 'var(--brand)', animation: 'pulse-dot 1.4s ease-in-out infinite' }} />
                        <span style={{ fontSize: 'var(--fs-small)', color: 'var(--gray600)', lineHeight: 1.5 }}>
                          {statusMsg || 'Agent is running… (this may take a few minutes)'}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--gray400)', fontSize: 'var(--fs-body)' }}>
                    {compareLoading ? (
                      <>
                        <span style={{ width: 20, height: 20, border: '2.5px solid var(--gray200)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
                        <span style={{ fontSize: 'var(--fs-small)' }}>Generating analysis…</span>
                      </>
                    ) : (
                      <>
                        <span style={{ fontSize: 'var(--fs-headline)' }}>📸</span>
                        <span style={{ fontSize: 'var(--fs-small)' }}>
                          {compareAnalysis ? 'No matching screenshot for this action point' : 'No journeys recorded yet. Run an agent or record a human session to see screenshots.'}
                        </span>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
            {/* Draggable divider */}
            <div
              onMouseDown={startOverviewDrag}
              style={{ width: 5, flexShrink: 0, cursor: 'col-resize', background: 'var(--border)', transition: 'background 0.15s' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'var(--border)')}
            />
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <ActionPointsList
                siteId={siteId!}
                compareAnalysis={compareAnalysis}
                compareLoading={compareLoading}
                compareError={compareError}
                onRunAnalysis={handleRunComparative}
                onRerunAnalysis={handleRerunComparative}
                analysisRunId={analysisRunId}
                agentJourneyIds={agentJourneys.filter(j => j.id > 0).map(j => j.id)}
                agentJourneys={agentJourneys as api.JourneyResponse[]}
                humanJourneySteps={Array.from(humanStepsBySession.values())}
                taskFilter={null}
                tasks={tasks}
                onNavigateTo={handleNavigateTo}
                ratingsSummary={ratingsSummary}
                compact
                onScreenshotChange={(sc, ann, pending) => { setActionScreenshot(sc); setActionAnnotation(ann); setActionPending(pending) }}
              />
            </div>
          </div>

        {/* ── FLOW + HORIZON (linked) ── */}
        {activeView === 'linked_flow' && (
          <div ref={rightPanelContainerRef} style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* ── Linked flow diagram + horizon strip (left) ── */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
              <SankeyDiagram
                agentJourneys={sharedTaskFilteredAgentJourneySteps}
                humanJourneys={sharedTaskFilteredHumanJourneySteps}
                agentLabels={sharedTaskFilteredAgentLabels}
                humanLabels={sharedTaskFilteredHumanLabels}
                onDivergencesChange={setSankeyDivergences}
                highlight={activeCompareContext?.highlight}
                linkedMode
                rightControl={filtersControl}
              />
            </div>
            {/* Draggable divider */}
            <div
              onMouseDown={startRightPanelDrag}
              style={{ width: 5, flexShrink: 0, cursor: 'col-resize', background: 'var(--border)', transition: 'background 0.15s' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'var(--border)')}
            />
            {/* ── Insights panel (right) ── */}
            <div style={{ width: rightPanelW, flexShrink: 0, borderLeft: 'none', overflowY: 'auto', background: 'var(--surface)' }}>
              <SankeyInsightsPanel
                compareAnalysis={compareAnalysis}
                compareLoading={compareLoading}
                agentJourneys={agentJourneys as api.JourneyResponse[]}
                humanJourneySteps={humanJourneySteps}
                divergences={sankeyDivergences}
                actionContext={activeCompareContext}
                onClearActionContext={() => setCompareContext(null)}
              />
            </div>
          </div>
        )}



        {/* ── AGGREGATE JOURNEYS (Human Steered Agent) ── */}
        {activeView === 'aggregate' && (
          <div ref={rightPanelContainerRef} style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* Left: flow diagram */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
              <AggregateFlowView
                siteId={siteId!}
                siteUrl={siteUrl}
                taskId={aggregateTaskId ?? undefined}
                taskTitle={tasks.find(t => t.id === aggregateTaskId)?.title ?? null}
                hasPrevVersion={hasPrevVersion}
                prevVersionEndsAt={versionFrom}
                prevVersionLabel={prevVersionLabel}
                showHuman={aggShowHuman}
                showAi={aggShowAi}
                showPrev={aggShowPrev}
                rightControl={filtersControl}
              />
            </div>
            {/* Draggable divider */}
            <div
              onMouseDown={startRightPanelDrag}
              style={{ width: 5, flexShrink: 0, cursor: 'col-resize', background: 'var(--border)', transition: 'background 0.15s' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'var(--border)')}
            />
            {/* Right: insights panel */}
            <div style={{ width: rightPanelW, flexShrink: 0, borderLeft: 'none', overflowY: 'auto', background: 'var(--surface)' }}>
              <AggregateInsightsPanel
                compareAnalysis={compareAnalysis}
                compareLoading={compareLoading}
                actionContext={activeCompareContext}
                onClearActionContext={() => setCompareContext(null)}
              />
            </div>
          </div>
        )}

        {/* ── HEATMAP ── */}
        {activeView === 'heatmap' && (
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* Carousel (left) */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
              {agentJourneys.length === 0 && sessions.length === 0 ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, background: 'var(--bg)' }}>
                  <div style={{ fontSize: 'var(--fs-headline)' }}>🔥</div>
                  <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--text-primary)' }}>No data for heatmap</div>
                  <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-muted)' }}>Run an agent or collect human sessions first.</div>
                </div>
              ) : (
                <HeatmapCarousel
                  agentJourneys={agentJourneys as api.JourneyResponse[]}
                  humanJourneysBySession={filteredHumanJourneysBySession}
                  loading={humanLoading}
                  tasks={tasks}
                  taskFilter={heatmapTaskFilter}
                  onTaskChange={setHeatmapActiveTaskId}
                  rightControl={filtersControl}
                />
              )}
            </div>
            {/* Insights panel (right) — matches Sankey tab width */}
            <div style={{ width: 320, flexShrink: 0, borderLeft: '1px solid var(--border)', overflowY: 'auto', background: 'var(--surface)' }}>
              <HeatmapInsightsPanel
                compareAnalysis={compareAnalysis}
                compareLoading={compareLoading}
                highlightText={heatmapHighlightText}
                onClearHighlight={() => setHeatmapHighlightText(null)}
                activeTaskTitle={tasks.find(t => t.id === heatmapActiveTaskId)?.title ?? null}
              />
            </div>
          </div>
        )}

        {/* ── HUMAN VS AI / OLD VS NEW ── */}
        {activeView === 'human_vs_ai' && (() => {
          const legendBar = (
            <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-small)', fontWeight: 700, color: '#0072B2' }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#0072B2' }} />
                AI
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-small)', fontWeight: 700, color: '#E69F00' }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#E69F00' }} />
                Human
              </span>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>{filtersControl}</div>
            </div>
          )
          return (
            <div style={{ flex: 1, overflow: 'hidden' }}>
              {compareMode === 'ai_vs_human' ? (
                humanLoading && sharedTaskFilteredAllHumanSteps.length === 0 ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: '#94a3b8', fontSize: 'var(--fs-body)', gap: 8 }}>
                    <span style={{ width: 16, height: 16, border: '2px solid #e2e8f0', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
                    Loading session data…
                  </div>
                ) : (
                  <ComparePanel
                    agentSteps={sharedTaskFilteredAllAgentSteps}
                    humanSteps={sharedTaskFilteredAllHumanSteps}
                    agentJourneys={sharedTaskFilteredAgentJourneys as api.JourneyResponse[]}
                    humanSessionStepCounts={sharedTaskFilteredHumanSessionStepCounts}
                    humanSessionCount={visibleSessionCount}
                    actionContext={activeCompareContext}
                    onClearActionContext={() => setCompareContext(null)}
                    topBar={legendBar}
                  />
                )
              ) : (
                prevVersionAgentSteps.length === 0 && allAgentSteps.length === 0 ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, flexDirection: 'column', gap: 10, color: 'var(--gray400)', fontSize: 'var(--fs-body)' }}>
                    <span>No agent journeys found for either version.</span>
                    <span style={{ fontSize: 'var(--fs-small)' }}>Run agents on both versions to compare them.</span>
                  </div>
                ) : (
                  <ComparePanel
                    agentSteps={prevVersionAgentSteps}
                    humanSteps={allAgentSteps}
                    agentJourneys={prevVersionAgentJourneys as api.JourneyResponse[]}
                    humanSessionStepCounts={agentJourneys.map(j => j.total_steps)}
                    humanSessionCount={agentJourneys.length}
                    leftLabel={prevVersionLabel}
                    rightLabel={activeVersionEntry?.label ?? 'Current Version'}
                    topBar={legendBar}
                  />
                )
              )}
            </div>
          )
        })()}

        {activeView === 'horizon_graph' && (
          <div ref={rightPanelContainerRef} style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* ── Horizon graph (left) ── */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
              <HorizonGraph
                agentJourneys={sharedTaskFilteredAgentJourneySteps}
                humanJourneys={sharedTaskFilteredHumanJourneySteps}
                agentLabels={sharedTaskFilteredAgentLabels}
                humanLabels={sharedTaskFilteredHumanLabels}
                highlight={activeCompareContext?.highlight}
                rightControl={filtersControl}
              />
            </div>
            {/* Draggable divider */}
            <div
              onMouseDown={startRightPanelDrag}
              style={{ width: 5, flexShrink: 0, cursor: 'col-resize', background: 'var(--border)', transition: 'background 0.15s' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'var(--border)')}
            />
            {/* ── Insights panel (right) ── */}
            <div style={{ width: rightPanelW, flexShrink: 0, borderLeft: 'none', overflowY: 'auto', background: 'var(--surface)' }}>
              <HorizonInsightsPanel
                compareAnalysis={compareAnalysis}
                compareLoading={compareLoading}
                agentJourneys={agentJourneys as api.JourneyResponse[]}
                humanJourneySteps={humanJourneySteps}
                actionContext={activeCompareContext}
                onClearActionContext={() => setCompareContext(null)}
              />
            </div>
          </div>
        )}
    

      </main>
    </div>
    

    {reEvalOpen && <ReEvalModal onClose={() => setReEvalOpen(false)} onConfirm={handleReEvaluate} />}
    </>
  )
}