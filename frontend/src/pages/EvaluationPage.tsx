import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useProjectContext } from '../context/ProjectContext'
import { useAgentRun } from '../context/AgentRunContext'
import AgentGallery from '../components/evaluation/AgentGrid'
import TaskList, { type TaskListHandle } from '../components/evaluation/TaskList'
import type { Project } from '../lib/types'
import { PROJECTS_STORAGE_KEY } from '../lib/types'
import * as api from '../lib/api'

export const ANALYSIS_STORAGE_KEY = (siteId: string, versionId: string) => `ciphercorgi_comparative_${siteId}_${versionId}`

export const VERSIONS_KEY = (siteId: string) => `ciphercorgi_versions_${siteId}`

export interface VersionEntry {
  id: string
  label: string
  changes: string
  createdAt: string
  testerLink: string
  tasks?: import('../lib/types').Task[]
}

export function getVersions(siteId: string, currentLink: string): VersionEntry[] {
  try {
    const stored = localStorage.getItem(VERSIONS_KEY(siteId))
    if (stored) return JSON.parse(stored)
  } catch { /* ignore */ }
  const seed: VersionEntry[] = [
    { id: 'v1', label: 'Version 1.0', changes: 'Initial version', createdAt: new Date(Date.now() - 86400000 * 3).toISOString(), testerLink: currentLink },
  ]
  localStorage.setItem(VERSIONS_KEY(siteId), JSON.stringify(seed))
  return seed
}

function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="info-tooltip-wrap">
      <span className="info-tooltip-icon">i</span>
      <span className="info-tooltip-bubble">{text}</span>
    </span>
  )
}

const STEPS = [
  { num: 1, label: 'Define Tasks', desc: 'What should testers try to accomplish?' },
  { num: 2, label: 'Add Agents', desc: 'Which AI agents will run your tasks?' },
  { num: 3, label: 'Collect Data', desc: 'Run agents & share the tester link.' },
  { num: 4, label: 'Analysis', desc: 'Review results in the dashboard.' },
]

function WorkflowStepper({ tasksDone, dataDone, analyzeDone, step2Locked, step3Locked }: { tasksDone: boolean; agentsDone: boolean; dataDone: boolean; analyzeDone: boolean; step2Locked: boolean; step3Locked: boolean }) {
  const steps = [
    { id: 'step-1', label: 'Define Tasks', done: tasksDone, locked: false },
    { id: 'step-2', label: 'Collect Data', done: dataDone, locked: step2Locked },
    { id: 'step-4', label: 'Analyze', done: analyzeDone, locked: step3Locked },
  ]
  return (
    <div className="workflow-steps">
      {steps.map((s, i) => (
        <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
          <div className={`workflow-step${s.done && !s.locked ? ' done' : ''}`} onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })} style={{ cursor: 'pointer' }}>
            <span className="workflow-step-num">{i + 1}</span>
            <span className="workflow-step-lbl">{s.label}</span>
          </div>
          {i < steps.length - 1 && <span className="workflow-arrow">→</span>}
        </div>
      ))}
    </div>
  )
}

export default function EvaluationPage() {
  const { siteId } = useParams<{ siteId: string }>()
  const navigate = useNavigate()
  const { testerLink, siteUrl, label, tasks, agents, sessions, journeys, loading, refreshJourneys } = useProjectContext()
  const { apiKey, runState, errorMsg, startRun, stopRun, runningSiteId, runningVersionId } = useAgentRun()
  const taskListRef = useRef<TaskListHandle>(null)

  const [copied, setCopied] = useState(false)
  // websiteType and goals are frontend-only extras stored locally
  const projects: Project[] = JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY) ?? '[]')
  const project = projects.find(p => p.siteId === siteId)
  const hostname = (() => { try { return new URL(project?.url ?? '').hostname } catch { return project?.url ?? '' } })()
  const faviconUrl = hostname ? `https://www.google.com/s2/favicons?domain=${hostname}&sz=128` : null

  const versions = getVersions(siteId!, testerLink)
  const latestVersionId = versions[versions.length - 1]?.id ?? 'v1'
  const VERSION_STORAGE_KEY = `ciphercorgi_last_version_${siteId}`
  const [selectedVersion, setSelectedVersion] = useState(
    () => localStorage.getItem(VERSION_STORAGE_KEY) ?? latestVersionId,
  )

  useEffect(() => {
    if (selectedVersion) localStorage.setItem(VERSION_STORAGE_KEY, selectedVersion)
  }, [selectedVersion])

  // Refresh journey count after a run completes
  useEffect(() => {
    if (runState === 'complete') {
      refreshJourneys()
    }
  }, [runState, refreshJourneys])

  const activeVersionId = selectedVersion
  const activeVersionEntry = versions.find(v => v.id === selectedVersion)


  const activeLink = activeVersionEntry?.testerLink ?? testerLink
  const selectedVersionEntry = activeVersionEntry ?? null

  const isThisRun = runningSiteId === siteId && runningVersionId === activeVersionId
  const effectiveRunState = isThisRun ? runState : 'idle' as const

  const selectedAgentCount = agents.filter(a => a.selected).length

  const activeVersionIdx = versions.findIndex(v => v.id === selectedVersion)
  const versionFrom = activeVersionIdx > 0 ? (versions[activeVersionIdx]?.createdAt ?? null) : null
  const versionTo = versions[activeVersionIdx + 1]?.createdAt ?? null
  const versionedSessions = sessions.filter(s =>
    (!versionFrom || s.startedAt >= versionFrom) && (!versionTo || s.startedAt < versionTo)
  )
  const versionedJourneys = journeys.filter(j =>
    (!versionFrom || j.completed_at >= versionFrom) && (!versionTo || j.completed_at < versionTo)
  )
  const humanJourneys = versionedSessions.length
  const agentJourneys = versionedJourneys.length

  const step1Done = tasks.length > 0
  const step2Done = humanJourneys > 0 || agentJourneys > 0
  const step2Locked = !step1Done
  const step3Locked = !step2Done

  const [analysisRunning, setAnalysisRunning] = useState(false)

  async function handleOpenDashboard() {
    const cacheKey = ANALYSIS_STORAGE_KEY(siteId!, activeVersionId)
    if (localStorage.getItem(cacheKey)) { navigate(`/projects/${siteId}/dashboard`); return }
    // Check if the DB already has a result so we don't recompute
    try {
      const stored = await api.getStoredAnalysis(siteId!, activeVersionId)
      localStorage.setItem(cacheKey, JSON.stringify(stored))
      navigate(`/projects/${siteId}/dashboard`)
      return
    } catch { /* not in DB — compute it */ }
    setAnalysisRunning(true)
    try {
      const result = await api.runComparativeAnalysis(siteId!, undefined, activeVersionId)
      localStorage.setItem(cacheKey, JSON.stringify(result))
    } catch {
      // non-fatal — navigate anyway, dashboard shows the error
    } finally {
      setAnalysisRunning(false)
      navigate(`/projects/${siteId}/dashboard`)
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(activeLink).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2200)
    })
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 58px)', color: 'var(--gray400)' }}>
        Loading project…
      </div>
    )
  }

  return (
    <div className="eval-layout fade-in">

      {/* ── Context bar ── */}
      <div className="eval-ctx-bar">
        <div className="eval-ctx-bar-inner">

          {/* Left: back + view name */}
          <div className="dash-topbar-left">
            <button onClick={() => navigate('/projects')} title="Back to Home" className="dash-topbar-back">
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3L5 8l5 5"/></svg>
            </button>
            <span className="dash-topbar-view-name">Project Overview</span>
          </div>

          <div style={{ flex: 1 }} />

          {/* Center: project favicon + name — absolutely centered like dashboard */}
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

          <div style={{ flex: 1 }} />

          {/* Version + notes */}
          <div className="eval-ctx-version">
            {selectedVersionEntry?.changes && (
              <span className="eval-ctx-vnote" title={selectedVersionEntry.changes}>
                {selectedVersionEntry.changes}
              </span>
            )}
            <select
              className="version-select version-select-sm"
              value={selectedVersion}
              onChange={e => setSelectedVersion(e.target.value)}
              title="Select version"
            >
              {[...versions].reverse().map(v => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </select>
          </div>

        </div>
      </div>

      {/* ── Content ── */}
      <div className="eval-main">

        <WorkflowStepper
          tasksDone={tasks.length > 0}
          agentsDone={selectedAgentCount > 0}
          dataDone={humanJourneys > 0 || agentJourneys > 0}
          analyzeDone={!!localStorage.getItem(ANALYSIS_STORAGE_KEY(siteId!, activeVersionId))}
          step2Locked={step2Locked}
          step3Locked={step3Locked}
        />

        {/* Step 1 — Define Tasks */}
        <div id="step-1" className="eval-flow-step">
          <div className="eval-flow-node eval-flow-node--blue">
            <div className="eval-flow-node-header">
              <span className="eval-flow-badge eval-flow-badge--blue">1</span>
              <span className="eval-section-title">Define Tasks</span>
              <InfoTooltip text="Tasks are the goals you want both AI agents and real users to attempt on your website. Each task should be a clear, concrete action — e.g. 'Find the pricing page'. Agents and human testers will each try to complete every task you define." />
              <div className="eval-node-header-actions">
                <button className="btn btn-primary btn-sm" onClick={() => taskListRef.current?.openAddModal()}>
                  + Add task
                </button>
              </div>
            </div>

            <TaskList ref={taskListRef} />
          </div>
        </div>

        {/* Branch connector */}
        <div className={`eval-branch${step2Locked ? ' eval-step-locked' : ''}`}>
          <div className="eval-branch-line eval-branch-line--down" />
          <div className="eval-branch-split">
            <div className="eval-branch-arm eval-branch-arm--left" />
            <div className="eval-branch-arm eval-branch-arm--right" />
          </div>
        </div>

        {/* Gate: step 2 locked */}
        {step2Locked && (
          <div className="eval-step-gate">
            <p className="eval-step-gate-msg">Add at least one task in Step 1 to unlock data collection.</p>
          </div>
        )}

        {/* Step 2 — Parallel branches */}
        <div id="step-2" className={`eval-flow-parallel${step2Locked ? ' eval-step-locked' : ''}`}>

          {/* Human branch */}
          <div className="eval-flow-node eval-flow-node--orange">
            <div className="eval-flow-node-header">
              <span className="eval-flow-badge eval-flow-badge--orange">2a</span>
              <span className="eval-section-title">Human Testers</span>
              <InfoTooltip text="Share the tester link with real users — anyone who visits it will have their session recorded automatically. Their clicks, navigation path, and time on each page are captured and shown in the dashboard alongside the AI agent data." />
            </div>
            <p className="eval-collect-card-desc">Share this link with real users — every session is recorded automatically.</p>
            <div className="eval-collect-link-row" onClick={handleCopy} title="Click to copy">
              <span className="eval-collect-url">{activeLink.replace(/^https?:\/\//, '')}</span>
              <span className="eval-tester-copy-hint">{copied ? '✓ Copied' : '⎘'}</span>
            </div>
            {humanJourneys > 0 && (
              <span className="eval-collect-status eval-collect-status--blue">✓ {humanJourneys} session{humanJourneys !== 1 ? 's' : ''} recorded</span>
            )}
          </div>

          {/* AI branch */}
          <div className="eval-flow-node eval-flow-node--orange">
            <div className="eval-flow-node-header">
              <span className="eval-flow-badge eval-flow-badge--orange">2b</span>
              <span className="eval-section-title">AI Agents</span>
              <InfoTooltip text="AI agents autonomously browse your website and attempt each task. Select which agents to run, then hit 'Run agents'. Each agent records every step it takes — pages visited, actions performed, and observations — which you can replay in the dashboard." />
              <div className="eval-node-header-actions">
                <button className="btn btn-primary btn-sm" onClick={() => document.getElementById('agent-add-btn')?.click()}>
                  + Add agent
                </button>
              </div>
            </div>
            <AgentGallery activeVersionId={activeVersionId} />
            {effectiveRunState === 'complete' && <span className="eval-collect-status eval-collect-status--blue" style={{ marginBottom: 12 }}>✓ Agent run completed</span>}
            {effectiveRunState === 'idle' && agentJourneys > 0 && <span className="eval-collect-status eval-collect-status--blue" style={{ marginBottom: 12 }}>✓ {agentJourneys} journey{agentJourneys !== 1 ? 's' : ''} recorded</span>}
            <button
              className="btn btn-primary"
              disabled={selectedAgentCount === 0 || !apiKey.trim()}
              onClick={() => {
                if (effectiveRunState === 'running') { stopRun() }
                else { stopRun(); startRun(siteId!, siteUrl, tasks, activeVersionId, agents.filter(a => a.selected)) }
              }}
            >
              {effectiveRunState === 'running' ? '⏹ Stop running'
                : agentJourneys > 0 || effectiveRunState === 'complete' ? 'Re-run agents →'
                : 'Run agents →'}
            </button>
            {selectedAgentCount === 0 && (
              <p className="eval-btn-hint" style={{ textAlign: 'left' }}>Select at least one agent above to run.</p>
            )}
            {!apiKey.trim() && selectedAgentCount > 0 && (
              <p className="eval-btn-hint" style={{ textAlign: 'left' }}>Set your API key in account settings (top right).</p>
            )}
            {errorMsg && (
              <p className="eval-btn-hint" style={{ textAlign: 'left', color: 'var(--red)' }}>{errorMsg}</p>
            )}
          </div>
        </div>

        {/* Merge connector */}
        <div className={`eval-branch eval-branch--merge${step3Locked ? ' eval-step-locked' : ''}`}>
          <div className="eval-branch-split">
            <div className="eval-branch-arm eval-branch-arm--left" />
            <div className="eval-branch-arm eval-branch-arm--right" />
          </div>
          <div className="eval-branch-line eval-branch-line--down" />
        </div>

        {/* Gate: step 3 locked — only show when step 2 is unlocked */}
        {step3Locked && !step2Locked && (
          <div className="eval-step-gate">
            <div className="eval-step-gate-msg">
              <strong>No data collected yet.</strong> To unlock analysis, complete at least one of:
              <ul className="eval-step-gate-list">
                {humanJourneys === 0 && <li>Share the tester link (Step 2a) and collect a human session</li>}
                {agentJourneys === 0 && <li>Run at least one agent (Step 2b)</li>}
              </ul>
            </div>
          </div>
        )}

        {/* Step 3 — Analysis */}
        <div id="step-4" className={`eval-flow-step${step3Locked ? ' eval-step-locked' : ''}`}>
          <div className="eval-flow-node eval-flow-node--blue eval-flow-node--cta">
            <div className="eval-flow-node-header">
              <span className="eval-flow-badge eval-flow-badge--blue">3</span>
              <span className="eval-section-title">Analyze</span>
              <InfoTooltip text="The dashboard overlays AI agent traces and real user journeys side by side. You can see exactly where users got confused, which paths agents took, and get actionable UX recommendations — all derived from the sessions collected in steps 2a and 2b." />
            </div>
            <p className="eval-collect-card-desc">Compare AI agent traces with real user journeys — pinpoint exactly where your UX breaks down.</p>
            <button
              className="btn btn-primary"
              onClick={handleOpenDashboard}
              disabled={analysisRunning}
              style={{ display: 'flex', alignItems: 'center', gap: 7 }}
            >
              {analysisRunning && (
                <span style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
              )}
              {analysisRunning ? 'Running analysis…' : 'Open Dashboard →'}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
