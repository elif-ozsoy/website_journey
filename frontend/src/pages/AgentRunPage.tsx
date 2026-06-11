import { debugWarn } from '../lib/debug'
import { storageKeys } from '../lib/storage'
import { useEffect, useState, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useProjectContext } from '../context/ProjectContext'
import * as api from '../lib/api'
import InputForm from '../components/agent/InputForm'
import StatusBar from '../components/agent/StatusBar'
import type { AgentStep, RunConfig, WsMessage, SolutionEval } from '../components/agent/agentTypes'
import { getStepsFromSessionEvents } from '../components/dashboard/screenshotData'

import SankeyDiagram from '../components/agent/SankeyDiagram'
import StepTimeline from '../components/agent/StepTimeline'
import FlowMap from '../components/agent/FlowMap'

type AppState = 'idle' | 'running' | 'complete' | 'error'

function JourneyVisualization({ steps, humanJourneys, isComplete }: { steps: AgentStep[]; humanJourneys: AgentStep[][]; isComplete: boolean }) {
  const [tab, setTab] = useState<'flowmap' | 'sankey' | 'compare' | 'timeline'>('flowmap')
  const [, setSelected] = useState<number | null>(null)
  const TABS = [
    { id: 'flowmap', label: 'Flow Map' },
    { id: 'sankey', label: 'Journey Flow' },
    { id: 'compare', label: 'AI vs Human' },
    { id: 'timeline', label: 'Timeline' },
  ] as const
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#fff' }}>
      <div style={{ borderBottom: '1px solid var(--gray100)', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <nav style={{ display: 'flex', background: 'var(--gray100)', padding: 3, borderRadius: 10, gap: 3 }}>
          {TABS.map(({ id, label }) => (
            <button key={id} onClick={() => setTab(id)}
              style={{ border: 'none', padding: '6px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 700,
                background: tab === id ? '#fff' : 'transparent', color: tab === id ? 'var(--brand)' : 'var(--gray600)',
                boxShadow: tab === id ? '0 1px 6px rgba(0,0,0,.06)' : 'none' }}>
              {label}
            </button>
          ))}
        </nav>
        <div style={{ fontWeight: 700, color: 'var(--brand)', background: 'var(--brand-pale)', padding: '4px 12px', borderRadius: 999 }}>
          {isComplete ? `✓ Recorded ${steps.length} Steps` : `● Live: ${steps.length} Steps`}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {tab === 'flowmap' && <FlowMap steps={steps} />}
        {tab === 'sankey' && <SankeyDiagram agentJourneys={[steps]} />}
        {tab === 'compare' && <SankeyDiagram agentJourneys={[steps]} humanJourneys={humanJourneys} />}
        {tab === 'timeline' && <StepTimeline steps={steps} onSelectStep={setSelected} />}
      </div>
    </div>
  )
}

export default function AgentRunPage() {
  const navigate = useNavigate()
  const { siteId } = useParams<{ siteId: string }>()
  const { siteUrl, tasks, journeys, sessions } = useProjectContext()
  const [appState, setAppState] = useState<AppState>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [steps, setSteps] = useState<AgentStep[]>([])
  const [humanJourneys, setHumanJourneys] = useState<AgentStep[][]>([])
  const [errorMessage, setErrorMessage] = useState('')
  const [solutionEval, setSolutionEval] = useState<SolutionEval | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const isRunningRef = useRef(false)

  useEffect(() => {
    if (appState !== 'idle' || steps.length > 0 || !siteId) return

    async function load() {
      let loaded: AgentStep[] | null = null
      let journeyId: number | null = null

      const stored = localStorage.getItem(storageKeys.agentRun(siteId!))
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as { steps?: AgentStep[] }
          if (parsed.steps?.length) loaded = parsed.steps
        } catch { /* fall through */ }
      }

      if (!loaded) {
        const latestJourney = journeys[0]
        if (latestJourney?.steps?.length) {
          loaded = latestJourney.steps as AgentStep[]
          journeyId = latestJourney.id
        }
      }

      if (!loaded) return

      // Hydrate screenshot_url from DB when base64 is missing
      const missingScreenshot = loaded.some(s => !s.screenshot_base64)
      if (missingScreenshot) {
        const jId = journeyId ?? journeys[0]?.id
        if (jId) {
          try {
            const shots = await api.listJourneyScreenshots(jId)
            let si = 0
            loaded = loaded.map(step => {
              if (step.screenshot_base64 || si >= shots.length) return step
              const url = api.screenshotImageUrl(shots[si++].id)
              return { ...step, screenshot_url: url }
            })
          } catch { /* non-fatal */ }
        }
      }

      setSteps(loaded)
      setAppState('complete')
      setStatusMessage(`Loaded ${loaded.length} saved steps`)
    }

    load()
  }, [appState, journeys, siteId, steps.length])

  useEffect(() => {
    if (!siteId || sessions.length === 0) return
    Promise.all(sessions.map(s => api.listEvents(s.id).then(events => getStepsFromSessionEvents(events, siteUrl))))
      .then(all => setHumanJourneys(all.filter(j => j.length > 0)))
      .catch(() => {})
  }, [siteId, sessions, siteUrl])


  function handleRun(config: RunConfig) {
    wsRef.current?.close()
    isRunningRef.current = true
    setAppState('running')
    setSteps([])
    setErrorMessage('')
    setSolutionEval(null)
    setStatusMessage('Connecting…')

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws/run`)
    wsRef.current = ws

    ws.onopen = () => {
      const userToken = localStorage.getItem(storageKeys.token)
      ws.send(JSON.stringify({ ...config, site_id: siteId ?? null, user_token: userToken ?? null }))
      setStatusMessage('Connected — starting agent…')
    }
    ws.onmessage = (event) => {
      const msg: WsMessage = JSON.parse(event.data)
      if (msg.type === 'status') { setStatusMessage(msg.message) }
      else if (msg.type === 'step') { setSteps((prev) => [...prev, msg.data]); setStatusMessage(`Step ${msg.data.step_number} — ${msg.data.action_type}`) }
      else if (msg.type === 'complete') {
          isRunningRef.current = false; setAppState('complete'); setStatusMessage(`Done — ${msg.data.total_steps} steps recorded`)
          if (msg.data.solution_eval) setSolutionEval(msg.data.solution_eval)
          if (siteId) {
            try { localStorage.setItem(storageKeys.agentRun(siteId), JSON.stringify({ siteId, steps: msg.data.steps, completedAt: Date.now() })) } catch { /* ignore */ }
            api.saveJourney(siteId, config.task, msg.data.steps).catch(() => {/* non-fatal */})
          }
        }
      else if (msg.type === 'error') { isRunningRef.current = false; setAppState('error'); setErrorMessage(msg.message); setStatusMessage('Agent encountered an error') }
      else if (msg.type === 'warning') { debugWarn('[CipherCorgi] Agent run warning:', msg.message) }
    }
    ws.onerror = () => { isRunningRef.current = false; setAppState('error'); setErrorMessage('WebSocket connection failed. Is the agent backend running?') }
    ws.onclose = () => { if (isRunningRef.current) { isRunningRef.current = false; setAppState('error'); setErrorMessage('Connection closed unexpectedly.') } }
  }

  function handleReset() {
    wsRef.current?.close()
    setAppState('idle')
    setSteps([])
    setErrorMessage('')
    setStatusMessage('')
  }

  const defaultUrl = siteUrl
  const defaultTask = tasks[0]?.title ?? ''

  return (
    <div className="agent-run-page fade-in" style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 58px)' }}>
      <div style={{ padding: '10px 22px', borderBottom: '1px solid var(--gray100)', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--white)' }}>
        <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/projects/${siteId}`)}>← Back to Evaluation</button>
        <span style={{ fontWeight: 700, color: 'var(--gray600)' }}>Agent Runner</span>
        {appState !== 'idle' && (
          <button className="btn btn-outline btn-sm" onClick={handleReset} style={{ marginLeft: 'auto' }}>↺ New Session</button>
        )}
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {appState === 'idle' && (
          <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px', display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 40 }}>
            <div>
              <h2 style={{ fontWeight: 800, marginBottom: 8 }}>Deploy your agent.</h2>
              <p style={{ color: 'var(--gray600)', lineHeight: 1.6 }}>Enter a prompt and watch the AI navigate in real-time.</p>
            </div>
            <InputForm onRun={handleRun} defaultUrl={defaultUrl} defaultTask={defaultTask} />
          </div>
        )}

        {appState !== 'idle' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <StatusBar state={appState} message={statusMessage} stepCount={steps.length} errorMessage={errorMessage} />
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              {steps.length > 0 ? (
                <div style={{ height: '100%', overflowY: 'auto' }}>
                  <JourneyVisualization steps={steps} humanJourneys={humanJourneys} isComplete={appState === 'complete'} />
                  {appState === 'complete' && (
                    <div style={{ padding: '32px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: '#fff', border: '1px solid var(--gray200)', borderRadius: 999 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--brand)', display: 'inline-block' }} />
                        <span style={{ fontWeight: 700 }}>Journey Finalized</span>
                      </div>
                      {solutionEval && (
                        <div style={{
                          display: 'flex', flexDirection: 'column', gap: 4,
                          padding: '10px 18px', borderRadius: 10, maxWidth: 480,
                          background: solutionEval.result === 'correct' ? '#dcfce7'
                                    : solutionEval.result === 'partially_correct' ? '#fef3c7'
                                    : '#fee2e2',
                          border: '1px solid',
                          borderColor: solutionEval.result === 'correct' ? '#16a34a'
                                     : solutionEval.result === 'partially_correct' ? '#d97706'
                                     : '#dc2626',
                        }}>
                          <div style={{
                            fontWeight: 700, fontSize: 'var(--fs-body)',
                            color: solutionEval.result === 'correct' ? '#15803d'
                                 : solutionEval.result === 'partially_correct' ? '#b45309'
                                 : '#b91c1c',
                          }}>
                            {solutionEval.result === 'correct' ? '✓ Correct'
                             : solutionEval.result === 'partially_correct' ? '◑ Partially Correct'
                             : '✗ False / Misleading'}
                          </div>
                          <div style={{ fontSize: 'var(--fs-small)', color: 'var(--gray700)', lineHeight: 1.5 }}>
                            {solutionEval.reason}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: '#fff' }}>
                  <div style={{ textAlign: 'center', maxWidth: 340, padding: '0 24px' }}>
                    {appState === 'running' ? (
                      <>
                        <div style={{ width: 48, height: 48, margin: '0 auto 16px', borderRadius: '50%', border: '4px solid var(--brand-pale)', borderTop: '4px solid var(--brand)', animation: 'spin 1s linear infinite' }} />
                        <h3 style={{ fontWeight: 800, marginBottom: 6 }}>Waking up the agent</h3>
                        <p style={{ color: 'var(--gray600)' }}>{statusMessage}</p>
                      </>
                    ) : appState === 'error' ? (
                      <div style={{ padding: 24, background: 'var(--red-pale)', borderRadius: 16 }}>
                        <div style={{ width: 40, height: 40, background: '#fbbaba', color: 'var(--red)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', fontWeight: 800 }}>!</div>
                        <h3 style={{ color: 'var(--red)', fontWeight: 800, marginBottom: 6 }}>Connection Failed</h3>
                        <p style={{ color: '#b03030' }}>{errorMessage}</p>
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
