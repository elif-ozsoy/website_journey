import { useState, useRef, useEffect, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'

import { useProjectContext } from '../context/ProjectContext'
import type { Project } from '../lib/types'
import { PROJECTS_STORAGE_KEY } from '../lib/types'
import * as api from '../lib/api'

import SankeyDiagram from '../components/dashboard/SankeyDiagram'


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

import ScreenshotCarousel from '../components/dashboard/ScreenshotCarousel'
import AggregateFlowView from '../components/dashboard/AggregateFlowView'
import ActionPointsList from '../components/dashboard/ActionPointsList'
import HeatmapCarousel from '../components/dashboard/HeatmapCarousel'
import ComparePanel from '../components/dashboard/ComparePanel'
import HorizonGraph from '../components/dashboard/HorizonGraph'
import {
  getStepsFromSessionEvents,
  getTaskJourneysFromSessionEvents,
  loadAgentSteps,
  getAggregatedScreenshots,
  type HumanTaskJourney,
} from '../components/dashboard/screenshotData'
import type { Session, Task } from '../lib/types'
import { ANALYSIS_STORAGE_KEY, VERSIONS_KEY, VersionEntry, getVersions } from './EvaluationPage'
import type { AgentStep } from '../components/agent/agentTypes'

// ─── Shared types ─────────────────────────────────────────────────────────────

interface SelectOption { id: string; name: string; meta?: string }

type ActiveView = 'overview' | 'aggregate' | 'heatmap' | 'details' | 'human_vs_ai' | 'time_event' | 'flow_sankey' | 'horizon_graph'
// ─── Nav item icons ───────────────────────────────────────────────────────────

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

function ToggleRow({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: () => void }) {
  return (
    <div
      onClick={onChange}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, cursor: 'pointer', padding: '6px 0' }}
    >
      <div>
        <div style={{ fontSize: 'var(--fs-body)', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>{label}</div>
        <div style={{ fontSize: 'var(--fs-small)', color: 'var(--text-muted)', lineHeight: 1.4, marginTop: 1 }}>{description}</div>
      </div>
      <div style={{
        width: 32, height: 18, borderRadius: 999, flexShrink: 0,
        background: checked ? 'var(--accent)' : 'var(--gray200)',
        position: 'relative', transition: 'background 0.15s',
      }}>
        <div style={{
          position: 'absolute', top: 2, left: checked ? 16 : 2,
          width: 14, height: 14, borderRadius: '50%',
          background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          transition: 'left 0.15s',
        }} />
      </div>
    </div>
  )
}

function SettingsPanel({
  agentOptions, sessionOptions,
  agentFilter, sessionFilter,
  onToggleAgent, onSelectAllAgents,
  onToggleSession, onSelectAllSessions,
  showHeatmap, onToggleHeatmap,
}: {
  agentOptions: SelectOption[]
  sessionOptions: SelectOption[]
  agentFilter: Set<string> | null
  sessionFilter: Set<string> | null
  onToggleAgent: (id: string) => void
  onSelectAllAgents: () => void
  onToggleSession: (id: string) => void
  onSelectAllSessions: () => void
  showHeatmap: boolean
  onToggleHeatmap: () => void
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
              <FilterPill label="All" active={agentAllSelected} color="var(--accent)" onClick={onSelectAllAgents} />
              {agentOptions.map(o => (
                <FilterPill key={o.id} label={o.name} active={agentAllSelected || agentFilter!.has(o.id)} color="var(--accent)" onClick={() => onToggleAgent(o.id)} />
              ))}
              {agentOptions.length === 0 && <span style={{ fontSize: 'var(--fs-small)', color: 'var(--text-muted)' }}>No agents run yet</span>}
            </div>
          </div>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 'var(--fs-small)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 9 }}>Human Sessions</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <FilterPill label="All" active={sessionAllSelected} color="var(--teal)" onClick={onSelectAllSessions} />
              {sessionOptions.map((o, i) => (
                <FilterPill key={o.id} label={`User ${i + 1}`} active={sessionAllSelected || sessionFilter!.has(o.id)} color="var(--teal)" onClick={() => onToggleSession(o.id)} />
              ))}
              {sessionOptions.length === 0 && <span style={{ fontSize: 'var(--fs-small)', color: 'var(--text-muted)' }}>No sessions yet</span>}
            </div>
          </div>
          <div style={{ padding: '12px 16px' }}>
            <div style={{ fontSize: 'var(--fs-small)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 4 }}>Display</div>
            <ToggleRow label="Click heatmap" description="Overlay click positions on screenshots" checked={showHeatmap} onChange={onToggleHeatmap} />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Trajectory view ──────────────────────────────────────────────────────────

const STEP_ACTION_COLORS: Record<string, string> = {
  click_element: '#185FA5',
  input_text: '#059669',
  go_to_url: '#d97706',
  scroll: '#0891b2',
  go_back: '#f43f5e',
  extract_content: '#7c3aed',
  done: '#16a34a',
}

function TrajectoryView({
  tasks,
  agentJourneys,
  sessions,
  humanStepsBySession,
  humanLoading,
}: {
  tasks: Task[]
  agentJourneys: api.JourneyResponse[]
  sessions: Session[]
  humanStepsBySession: Map<string, AgentStep[]>
  humanLoading: boolean
}) {
  const [taskId, setTaskId] = useState<number | null>(null)
  const [testerKey, setTesterKey] = useState<string | null>(null)
  const [stepIdx, setStepIdx] = useState(0)
  const stepListRef = useRef<HTMLDivElement>(null)

  type TesterOption = {
    key: string
    kind: 'agent' | 'human'
    label: string
    meta: string
    steps: AgentStep[]
  }

  const testerOptions = useMemo<TesterOption[]>(() => {
    const opts: TesterOption[] = []
    let runIdx = 0
    agentJourneys.filter(j => taskId === null || j.task_id === taskId).forEach(j => {
      runIdx++
      opts.push({ key: `agent-${j.id}`, kind: 'agent', label: `AI Run #${runIdx}`, meta: j.task_title || '', steps: (j.steps ?? []) as AgentStep[] })
    })
    sessions.forEach((s, i) => {
      opts.push({ key: `human-${s.id}`, kind: 'human', label: `User ${i + 1}`, meta: new Date(s.startedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), steps: humanStepsBySession.get(s.id) ?? [] })
    })
    return opts
  }, [agentJourneys, sessions, humanStepsBySession, taskId])

  useEffect(() => {
    if (!testerKey || !testerOptions.find(t => t.key === testerKey)) {
      setTesterKey(testerOptions[0]?.key ?? null)
      setStepIdx(0)
    }
  }, [testerOptions]) // eslint-disable-line react-hooks/exhaustive-deps

  const activeTester = testerOptions.find(t => t.key === testerKey) ?? null
  const steps = activeTester?.steps ?? []
  const activeStep = steps[stepIdx] ?? null

  useEffect(() => {
    const container = stepListRef.current
    if (!container) return
    const el = container.querySelector<HTMLElement>(`[data-step="${stepIdx}"]`)
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [stepIdx])

  const screenshotSrc = activeStep
    ? (activeStep.screenshot_url ?? (activeStep.screenshot_base64 ? `data:image/png;base64,${activeStep.screenshot_base64}` : null))
    : null

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      <div style={{ width: 300, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ fontSize: 'var(--fs-small)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray400)', marginBottom: 5 }}>Task</div>
          <select
            style={{ width: '100%', fontSize: 'var(--fs-body)', padding: '5px 8px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-primary)', fontFamily: 'var(--font-sans)', cursor: 'pointer' }}
            value={taskId ?? ''}
            onChange={e => { setTaskId(e.target.value !== '' ? Number(e.target.value) : null); setTesterKey(null); setStepIdx(0) }}
          >
            <option value="">All tasks</option>
            {tasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </div>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ fontSize: 'var(--fs-small)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gray400)', marginBottom: 7 }}>Tester</div>
          {testerOptions.length === 0 ? (
            <div style={{ fontSize: 'var(--fs-small)', color: 'var(--text-muted)', fontStyle: 'italic' }}>{humanLoading ? 'Loading…' : 'No data yet'}</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {testerOptions.map(opt => {
                const isActive = testerKey === opt.key
                const activeColor = opt.kind === 'agent' ? 'var(--accent)' : 'var(--teal)'
                return (
                  <button key={opt.key} onClick={() => { setTesterKey(opt.key); setStepIdx(0) }} title={opt.meta}
                    style={{ padding: '3px 10px', borderRadius: 999, border: 'none', cursor: 'pointer', fontSize: 'var(--fs-small)', fontWeight: 600, fontFamily: 'var(--font-sans)', background: isActive ? activeColor : 'var(--gray100)', color: isActive ? '#fff' : 'var(--text-secondary)', transition: 'background 0.13s, color 0.13s' }}
                  >{opt.label}</button>
                )
              })}
            </div>
          )}
        </div>
        <div ref={stepListRef} style={{ flex: 1, overflowY: 'auto' }}>
          {steps.length === 0 ? (
            <div style={{ padding: 16, fontSize: 'var(--fs-body)', color: 'var(--text-muted)', fontStyle: 'italic', lineHeight: 1.6 }}>
              {!activeTester ? 'Select a tester above.' : humanLoading && activeTester.kind === 'human' ? 'Loading session data…' : 'No steps recorded.'}
            </div>
          ) : steps.map((step, i) => {
            const isActive = i === stepIdx
            let path = step.url
            try { path = new URL(step.url).pathname || '/' } catch { /* ok */ }
            const actionColor = STEP_ACTION_COLORS[step.action_type] ?? '#475569'
            return (
              <div key={i} data-step={i} onClick={() => setStepIdx(i)}
                style={{ padding: '7px 14px', cursor: 'pointer', background: isActive ? 'var(--accent-soft)' : 'transparent', borderLeft: isActive ? '3px solid var(--accent)' : '3px solid transparent', borderBottom: '1px solid var(--gray100)', transition: 'background 0.1s' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 'var(--fs-small)', fontWeight: 700, color: isActive ? 'var(--accent)' : 'var(--gray400)', minWidth: 16, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                  <span style={{ fontSize: 'var(--fs-small)', fontWeight: 700, color: actionColor, background: `${actionColor}18`, padding: '1px 5px', borderRadius: 4 }}>{step.action_type.replace(/_/g, ' ')}</span>
                </div>
                <div style={{ fontSize: 'var(--fs-small)', color: isActive ? 'var(--accent)' : 'var(--text-secondary)', fontFamily: 'var(--font-sans)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginLeft: 22 }}>{path}</div>
                {step.thought && <div style={{ fontSize: 'var(--fs-small)', color: 'var(--text-muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginLeft: 22, lineHeight: 1.4 }}>{step.thought.slice(0, 58)}{step.thought.length > 58 ? '…' : ''}</div>}
              </div>
            )
          })}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#0f172a' }}>
        {!activeTester ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: 'var(--fs-body)', flexDirection: 'column', gap: 10 }}>
            <span style={{ fontSize: 'var(--fs-headline)' }}>↑</span>Select a tester to view their trajectory.
          </div>
        ) : steps.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: 'var(--fs-body)', flexDirection: 'column', gap: 8 }}>
            {humanLoading ? <><span style={{ width: 18, height: 18, border: '2px solid #334155', borderTopColor: '#64748b', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />Loading session data…</> : 'No steps recorded.'}
          </div>
        ) : (
          <>
            <div style={{ padding: '8px 16px', background: '#1e293b', borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button onClick={() => setStepIdx(Math.max(0, stepIdx - 1))} disabled={stepIdx === 0}
                  style={{ background: 'none', border: '1px solid #334155', color: stepIdx === 0 ? '#334155' : '#94a3b8', borderRadius: 6, width: 24, height: 24, cursor: stepIdx === 0 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--fs-small)', flexShrink: 0 }}>‹</button>
                <span style={{ fontSize: 'var(--fs-small)', fontWeight: 600, color: '#64748b', whiteSpace: 'nowrap' }}>{stepIdx + 1} / {steps.length}</span>
                <button onClick={() => setStepIdx(Math.min(steps.length - 1, stepIdx + 1))} disabled={stepIdx === steps.length - 1}
                  style={{ background: 'none', border: '1px solid #334155', color: stepIdx === steps.length - 1 ? '#334155' : '#94a3b8', borderRadius: 6, width: 24, height: 24, cursor: stepIdx === steps.length - 1 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--fs-small)', flexShrink: 0 }}>›</button>
              </div>
              {activeStep && (
                <>
                  <span style={{ fontSize: 'var(--fs-small)', fontWeight: 700, color: STEP_ACTION_COLORS[activeStep.action_type] ?? '#64748b', background: `${STEP_ACTION_COLORS[activeStep.action_type] ?? '#64748b'}20`, padding: '2px 7px', borderRadius: 5 }}>{activeStep.action_type.replace(/_/g, ' ')}</span>
                  <span style={{ fontSize: 'var(--fs-small)', color: '#94a3b8', fontFamily: 'var(--font-sans)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{activeStep.url}</span>
                </>
              )}
            </div>
            <div style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20 }}>
              {screenshotSrc ? (
                <img src={screenshotSrc} alt={`Step ${stepIdx + 1}`} style={{ maxWidth: '100%', borderRadius: 6, boxShadow: '0 6px 28px rgba(0,0,0,0.5)' }} />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 220, color: '#475569', fontSize: 'var(--fs-body)', flexDirection: 'column', gap: 8 }}>
                  <span style={{ fontSize: 'var(--fs-headline)' }}>📷</span>No screenshot for this step
                </div>
              )}
            </div>
            {activeStep && (activeStep.thought || activeStep.next_goal) && (
              <div style={{ flexShrink: 0, background: '#1e293b', borderTop: '1px solid #334155', padding: '10px 16px', maxHeight: 130, overflowY: 'auto' }}>
                {activeStep.thought && <div style={{ marginBottom: activeStep.next_goal ? 8 : 0 }}><span style={{ fontSize: 'var(--fs-small)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#475569' }}>Thought</span><div style={{ fontSize: 'var(--fs-body)', color: '#94a3b8', marginTop: 3, lineHeight: 1.6 }}>{activeStep.thought}</div></div>}
                {activeStep.next_goal && <div><span style={{ fontSize: 'var(--fs-small)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#475569' }}>Next goal</span><div style={{ fontSize: 'var(--fs-body)', color: '#94a3b8', marginTop: 3, lineHeight: 1.6 }}>{activeStep.next_goal}</div></div>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { siteId } = useParams<{ siteId: string }>()
  const navigate = useNavigate()
  const { tasks: contextTasks, agents, sessions: allSessions, journeys: allJourneys, testerLink, siteUrl } = useProjectContext()

  const projects: Project[] = JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY) ?? '[]')
  const project = projects.find(p => p.siteId === siteId)
  const hostname = (() => { try { return new URL(project?.url ?? '').hostname } catch { return project?.url ?? '' } })()
  const faviconUrl = hostname ? `https://www.google.com/s2/favicons?domain=${hostname}&sz=128` : null

  const _versions = getVersions(siteId!, testerLink)

  const [selectedPageIdx] = useState(0)
  const [activeAnnotation, setActiveAnnotation] = useState<number | null>(null)

  const [agentFilter, setAgentFilter] = useState<Set<string> | null>(null)
  const [sessionFilter, setSessionFilter] = useState<Set<string> | null>(null)

  const [searchParams, setSearchParams] = useSearchParams()
  const urlView = searchParams.get('view') ?? 'overview'
  const activeView: ActiveView = (['overview', 'aggregate', 'heatmap', 'details', 'human_vs_ai', 'time_event', 'flow_sankey', 'horizon_graph'] as ActiveView[]).includes(urlView as ActiveView)
    ? (urlView as ActiveView)
    : 'overview'
 
 

  function setActiveView(view: ActiveView) {
    setSearchParams((prev: URLSearchParams) => {
      const p = new URLSearchParams(prev)
      p.set('view', view)
      return p
    }, { replace: true })
  }

  const [aggregateTaskId, setAggregateTaskId] = useState<number | null>(null)
  const [showHeatmap, setShowHeatmap] = useState(true)
  const [overviewSplitPct, setOverviewSplitPct] = useState(80)
  const overviewContainerRef = useRef<HTMLDivElement>(null)

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

  const [ratingsSummary, setRatingsSummary] = useState<api.RatingsSummary | null>(null)
  const [compareAnalysis, setCompareAnalysis] = useState<api.ComparativeAnalysis | null>(null)
  const [compareLoading, setCompareLoading] = useState(false)
  const [compareError, setCompareError] = useState<string | null>(null)
  const [reEvalOpen, setReEvalOpen] = useState(false)

  const versions = _versions
  const latestVersionId = versions[versions.length - 1]?.id ?? 'v1'
  const VERSION_STORAGE_KEY = `ciphercorgi_last_version_${siteId}`
  const savedVersion = localStorage.getItem(VERSION_STORAGE_KEY) ?? latestVersionId
  const selectedVersion = searchParams.get('version') ?? savedVersion

  useEffect(() => {
    if (selectedVersion) localStorage.setItem(VERSION_STORAGE_KEY, selectedVersion)
  }, [selectedVersion])

  const activeVersionIdx = versions.findIndex(v => v.id === selectedVersion)
  const activeVersionId = versions[activeVersionIdx !== -1 ? activeVersionIdx : versions.length - 1]?.id ?? latestVersionId
  const versionFrom = activeVersionIdx > 0 ? (versions[activeVersionIdx]?.createdAt ?? null) : null
  const versionTo = versions[activeVersionIdx + 1]?.createdAt ?? null
  const sessions = allSessions.filter((s: Session) =>
    (!versionFrom || s.startedAt >= versionFrom) && (!versionTo || s.startedAt < versionTo)
  )
  const journeys = allJourneys.filter((j: api.JourneyResponse) =>
    (!versionFrom || j.completed_at >= versionFrom) && (!versionTo || j.completed_at < versionTo)
  )

  const activeVersionEntry = versions[activeVersionIdx]
  const tasks = (activeVersionEntry?.tasks && activeVersionEntry.tasks.length > 0)
    ? activeVersionEntry.tasks
    : contextTasks

  const totalJourneyCount = journeys.length

  useEffect(() => {
    setCompareError(null)
    try {
      const raw = localStorage.getItem(ANALYSIS_STORAGE_KEY(siteId!, activeVersionId))
      if (raw) {
        const parsed = JSON.parse(raw)
        // Invalidate cache if journey count changed since it was saved
        if (parsed._journeyCount !== undefined && totalJourneyCount > 0 && parsed._journeyCount !== totalJourneyCount) {
          localStorage.removeItem(ANALYSIS_STORAGE_KEY(siteId!, activeVersionId))
          autoRunVersionRef.current = null
        } else {
          const { _journeyCount: _, ...analysis } = parsed
          setCompareAnalysis(analysis as api.ComparativeAnalysis)
          return
        }
      }
    } catch { /* ignore */ }
    setCompareAnalysis(null)
    api.getStoredAnalysis(siteId!, activeVersionId)
      .then(result => {
        localStorage.setItem(ANALYSIS_STORAGE_KEY(siteId!, activeVersionId), JSON.stringify({ _journeyCount: totalJourneyCount, ...result }))
        setCompareAnalysis(result)
      })
      .catch(() => {})
  }, [activeVersionId, siteId, totalJourneyCount])

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
    localStorage.removeItem(ANALYSIS_STORAGE_KEY(siteId!, newVersionId))
    localStorage.removeItem(`ciphercorgi_agent_run_${siteId}`)
    setReEvalOpen(false)
    navigate(`/projects/${siteId}`)
  }

  const agentJourneys = useMemo(() => {
    const all = journeys.filter(j => j.is_agent !== false)
    if (all.length === 0) {
      const local = loadAgentSteps(siteId!, activeVersionId)
      if (local && local.length > 0) {
        return [{ id: -1, site_id: siteId!, task_id: null, user_id: null, task_title: '', total_steps: local.length, steps: local, completed_at: '', updated_at: '', llm_analysis: null, is_agent: true, embedding: null, source: 'local' }]
      }
    }
    if (agentFilter !== null) {
      return all.filter(j => j.user_id !== null && agentFilter.has(j.user_id))
    }
    return all
  }, [journeys, siteId, agentFilter])

const agentJourneySteps = useMemo<AgentStep[][]>(() => agentJourneys.map(j => j.steps as AgentStep[]), [agentJourneys])

  const aggFilteredJourneys = useMemo(() =>
    aggregateTaskId !== null ? agentJourneys.filter(j => j.task_id === aggregateTaskId) : agentJourneys,
    [agentJourneys, aggregateTaskId],
  )
  const aggJourneySteps = useMemo<AgentStep[][]>(() => aggFilteredJourneys.map(j => j.steps as AgentStep[]), [aggFilteredJourneys])

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

  const humanJourneyMeta = useMemo<{ steps: AgentStep[]; label: string }[]>(() => {
    const ids = sessionFilter === null ? sessions.map(s => s.id) : Array.from(sessionFilter)
    const out: { steps: AgentStep[]; label: string }[] = []
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
        })
      })
    })
    return out
  }, [sessionFilter, sessions, humanJourneysBySession])
  
  const humanJourneySteps = useMemo<AgentStep[][]>(
    () => humanJourneyMeta.map(j => j.steps),
    [humanJourneyMeta],
  )
 

  const aggregatedScreenshots = useMemo(
    () => getAggregatedScreenshots(agentJourneySteps, humanJourneySteps),
    [agentJourneySteps, humanJourneySteps],
  )

  const allAgentSteps = useMemo<AgentStep[]>(
    () => agentJourneys.flatMap(j => j.steps as AgentStep[]),
    [agentJourneys],
  )

  const allHumanSteps = useMemo<AgentStep[]>(
    () => humanJourneySteps.flat(),
    [humanJourneySteps],
  )

  const humanSessionStepCounts = useMemo(
    () => humanJourneySteps.map(s => s.length).filter(n => n > 0),
    [humanJourneySteps],
  )

  const visibleSessionCount = sessionFilter === null ? sessions.length : sessionFilter.size

  const autoRunVersionRef = useRef<string | null>(null)
  useEffect(() => {
    if (autoRunVersionRef.current === activeVersionId) return
    if (compareLoading || compareAnalysis) return
    const cached = localStorage.getItem(ANALYSIS_STORAGE_KEY(siteId!, activeVersionId))
    if (cached) return
    autoRunVersionRef.current = activeVersionId
    handleRunComparative()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVersionId, compareLoading, compareAnalysis])

  async function handleRunComparative() {
    if (compareLoading) return
    setCompareLoading(true)
    setCompareError(null)
    try {
      const result = await api.runComparativeAnalysis(siteId!, undefined, activeVersionId)
      setCompareAnalysis(result)
      localStorage.setItem(ANALYSIS_STORAGE_KEY(siteId!, activeVersionId), JSON.stringify({ _journeyCount: totalJourneyCount, ...result }))
    } catch (err) {
      setCompareError(err instanceof Error ? err.message : 'Analysis failed')
    } finally {
      setCompareLoading(false)
    }
  }

  function handleRerunComparative() {
    setCompareAnalysis(null)
    localStorage.removeItem(ANALYSIS_STORAGE_KEY(siteId!, activeVersionId))
    handleRunComparative()
  }

  const DIAGRAM_VIEW_MAP: Record<string, ActiveView> = {
    compare: 'human_vs_ai',
    sankey: 'flow_sankey',
    heatmap: 'heatmap',
    multiflow: 'aggregate',
    similarity: 'human_vs_ai',
    comparative: 'overview',
    insights: 'human_vs_ai',
    human_agg: 'aggregate',
    policy: 'overview',
    horizon: 'horizon_graph',
  }

  function handleNavigateTo(_tab: string, view?: string) {
    const target = view ? (DIAGRAM_VIEW_MAP[view] ?? 'aggregate') : 'aggregate'
    setActiveView(target)
  }

  function toggleAgent(id: string) {
    setAgentFilter(prev => {
      const allIds = agents.map(a => a.id)
      const current = prev === null ? new Set(allIds) : new Set(prev)
      if (current.has(id)) { current.delete(id); return current }
      else { current.add(id); if (current.size === allIds.length) return null; return current }
    })
  }
  function toggleSession(id: string) {
    setSessionFilter(prev => {
      const allIds = sessions.map(s => s.id)
      const current = prev === null ? new Set(allIds) : new Set(prev)
      if (current.has(id)) { current.delete(id); return current }
      else { current.add(id); if (current.size === allIds.length) return null; return current }
    })
  }

  const agentOptions: SelectOption[] = agents.map(a => ({ id: a.id, name: a.name, meta: a.model }))
  const humanOptions: SelectOption[] = sessions.map(s => ({
    id: s.id,
    name: `Session ${s.id.slice(0, 8)}`,
    meta: new Date(s.startedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
  }))

  const hasAggData = aggJourneySteps.length > 0

  return (
    <>
    <div className="proj-dash-layout fade-in">

      {/* ── Main content ── */}
      <main className="proj-dash-main">

        {/* Top bar */}
        <div className="dash-topbar">
          {/* Left: back arrow + view title */}
          <div className="dash-topbar-left">
            <button onClick={() => navigate(`/projects/${siteId}`)} title="Back to Project Overview" className="dash-topbar-back">
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3L5 8l5 5"/></svg>
            </button>
            <span className="dash-topbar-view-name">
                  {{
                    overview: 'Action Points',
                    aggregate: 'Aggregate Journeys',
                    heatmap: 'Heatmap',
                    details: 'Journey Flow',
                    human_vs_ai: 'Human vs AI',
                    time_event: 'Time-Event-Overview',
                    flow_sankey: 'Flow Diagram',
                    horizon_graph: 'Horizon Graph',
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
            <SettingsPanel
              agentOptions={agentOptions} sessionOptions={humanOptions}
              agentFilter={agentFilter} sessionFilter={sessionFilter}
              onToggleAgent={toggleAgent}
              onSelectAllAgents={() => setAgentFilter((prev: Set<string> | null) => prev === null ? new Set<string>() : null)}
              onToggleSession={toggleSession}
              onSelectAllSessions={() => setSessionFilter((prev: Set<string> | null) => prev === null ? new Set<string>() : null)}
              showHeatmap={showHeatmap} onToggleHeatmap={() => setShowHeatmap((v: boolean) => !v)}
            />
            <select
              className="version-select version-select-sm"
              value={selectedVersion}
              onChange={e => setSearchParams(prev => { const p = new URLSearchParams(prev); p.set('version', e.target.value); return p }, { replace: true })}
            >
              {[...versions].reverse().map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
            <button className="btn btn-primary btn-xs" style={{ whiteSpace: 'nowrap' }} onClick={() => setReEvalOpen(true)}>
              Evaluate Updated Version
            </button>
            <span className="info-tooltip-wrap">
              <span className="info-tooltip-icon">i</span>
              <span className="info-tooltip-bubble">Runs a new evaluation loop with your latest changes — part of the human-in-the-loop workflow.</span>
            </span>
          </div>
        </div>

        {/* ── OVERVIEW ── */}
        {activeView === 'overview' && (
          <div ref={overviewContainerRef} style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
            <div style={{ flex: `0 0 ${overviewSplitPct}%`, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
              <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {aggregatedScreenshots.length > 0 ? (() => {
                  const shot = aggregatedScreenshots[selectedPageIdx] ?? aggregatedScreenshots[0]
                  return (
                    <ScreenshotCarousel
                      screenshots={[shot]}
                      activeAnnotation={activeAnnotation}
                      onAnnotationClick={(idx: number) => setActiveAnnotation((prev: number | null) => prev === idx ? null : idx)}
                      activePageIndex={0}
                      onPageChange={() => {}}
                      showHeatmap={false}
                    />
                  )
                })() : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10, color: 'var(--gray400)', fontSize: 'var(--fs-body)' }}>
                    <span style={{ fontSize: 'var(--fs-headline)' }}>📸</span>
                    No journeys recorded yet. Run an agent or record a human session to see screenshots.
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
                agentJourneyIds={agentJourneys.filter(j => j.id > 0).map(j => j.id)}
                agentJourneys={agentJourneys as api.JourneyResponse[]}
                humanJourneySteps={Array.from(humanStepsBySession.values())}
                taskFilter={null}
                tasks={tasks}
                onNavigateTo={handleNavigateTo}
                ratingsSummary={ratingsSummary}
                compact
              />
            </div>
          </div>
        )}

        {activeView === 'flow_sankey' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {agentJourneySteps.length === 0 && humanJourneySteps.length === 0 ? (
              <div style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexDirection: 'column', gap: 12, background: 'var(--bg)',
              }}>
                <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--text-primary)' }}>
                  No flow data yet
                </div>
                <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-muted)', maxWidth: 340, textAlign: 'center', lineHeight: 1.6 }}>
                  Run an agent or record a human session to see the flow diagram.
                </div>
              </div>
            ) : (
              <SankeyDiagram
                agentJourneys={agentJourneySteps}
                humanJourneys={humanJourneySteps}
                agentLabels={agentJourneys.map((_, i) => `AI Run #${i + 1}`)}
                humanLabels={humanJourneyMeta.map(j => j.label)}

              />
            )}
          </div>
      )}



        {/* ── HORIZON GRAPH ── */}
        {activeView === 'horizon_graph' && (
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)' }}>
              {agentJourneys.length === 0 && humanJourneySteps.length === 0 ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, background: 'var(--bg)' }}>
                  <div style={{ fontSize: 'var(--fs-headline)' }}>📈</div>
                  <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--text-primary)' }}>No activity data yet</div>
                  <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-muted)', maxWidth: 340, textAlign: 'center', lineHeight: 1.6 }}>Run an agent or record a human session to see the horizon graph.</div>
                </div>
              ) : (
                <HorizonGraph
                  agentJourneys={agentJourneySteps}
                  humanJourneys={humanJourneySteps}
                  agentLabels={agentJourneys.map((_, i) => `AI Run #${i + 1}`)}
                  humanLabels={humanJourneyMeta.map(j => j.label)}
                />
              )}
            </div>
            <div style={{ width: 360, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <ActionPointsList
                siteId={siteId!}
                compareAnalysis={compareAnalysis}
                compareLoading={compareLoading}
                compareError={compareError}
                onRunAnalysis={handleRunComparative}
                onRerunAnalysis={handleRerunComparative}
                agentJourneyIds={agentJourneys.filter(j => j.id > 0).map(j => j.id)}
                agentJourneys={agentJourneys as api.JourneyResponse[]}
                humanJourneySteps={Array.from(humanStepsBySession.values())}
                taskFilter={null}
                tasks={tasks}
                onNavigateTo={handleNavigateTo}
                ratingsSummary={ratingsSummary}
                compact
              />
            </div>
          </div>
        )}

        {/* ── AGGREGATE JOURNEYS (SANKEY) ── */}
        {activeView === 'aggregate' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '7px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 'var(--fs-small)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--gray400)', flexShrink: 0 }}>Task</span>
              <select
                value={aggregateTaskId ?? ''}
                onChange={e => setAggregateTaskId(e.target.value === '' ? null : Number(e.target.value))}
                style={{ fontSize: 'var(--fs-small)', fontWeight: 500, fontFamily: 'var(--font-sans)', padding: '4px 28px 4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-primary)', cursor: 'pointer', appearance: 'none', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%236b7280' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', minWidth: 160, maxWidth: 280 }}
              >
                <option value=''>All tasks</option>
                {tasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </div>
            {!hasAggData ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, background: 'var(--bg)' }}>
                <div style={{ textAlign: 'center', maxWidth: 340 }}>
                  <div style={{ fontSize: 'var(--fs-headline)', marginBottom: 12 }}>🤖</div>
                  <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>No agent journeys yet</div>
                  <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 20 }}>Run the AI agent to see the aggregate Sankey flow.</div>
                  <button className="btn btn-primary" onClick={() => navigate(`/projects/${siteId}/agent-run`)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5,3 13,8 5,13"/></svg>
                    Run Agent
                  </button>
                </div>
              </div>
            ) : (
              <AggregateFlowView
                siteId={siteId!}
                siteUrl={siteUrl}
                taskId={aggregateTaskId ?? undefined}
                taskTitle={tasks.find(t => t.id === aggregateTaskId)?.title ?? null}
              />
            )}
          </div>
        )}

        {/* ── HEATMAP ── */}
        {activeView === 'heatmap' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {agentJourneys.length === 0 && sessions.length === 0 ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, background: 'var(--bg)' }}>
                <div style={{ fontSize: 'var(--fs-headline)' }}>🔥</div>
                <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--text-primary)' }}>No data for heatmap</div>
                <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-muted)' }}>Run an agent or collect human sessions first.</div>
              </div>
            ) : (
              <HeatmapCarousel
                agentJourneys={agentJourneys as api.JourneyResponse[]}
                humanSessionSteps={humanStepsBySession}
                loading={humanLoading}
                tasks={tasks}
              />
            )}
          </div>
        )}

        {/* ── TRAJECTORIES ── */}
        {activeView === 'details' && (
          <TrajectoryView
            tasks={tasks}
            agentJourneys={agentJourneys as api.JourneyResponse[]}
            sessions={sessions}
            humanStepsBySession={humanStepsBySession}
            humanLoading={humanLoading}
          />
        )}

        {/* ── HUMAN VS AI ── */}
        {activeView === 'human_vs_ai' && (
          <div style={{ flex: 1, overflow: 'hidden' }}>
            {humanLoading && allHumanSteps.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: '#94a3b8', fontSize: 'var(--fs-body)', gap: 8 }}>
                <span style={{ width: 16, height: 16, border: '2px solid #e2e8f0', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
                Loading session data…
              </div>
            ) : (
              <ComparePanel
                agentSteps={allAgentSteps}
                humanSteps={allHumanSteps}
                agentJourneys={agentJourneys as api.JourneyResponse[]}
                humanSessionStepCounts={humanSessionStepCounts}
                humanSessionCount={visibleSessionCount}
              />
            )}
          </div>
        )}

        {activeView === 'time_event' && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, background: 'var(--bg)' }}>
            <div style={{ fontSize: 'var(--fs-headline)' }}>⏱</div>
            <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--text-primary)' }}>Time-Event-Overview</div>
            <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-muted)', maxWidth: 340, textAlign: 'center', lineHeight: 1.6 }}>This view is coming soon. It will show a timeline of events across all sessions.</div>
          </div>
        )}

      </main>
    </div>

    {reEvalOpen && <ReEvalModal onClose={() => setReEvalOpen(false)} onConfirm={handleReEvaluate} />}
    </>
  )
}
