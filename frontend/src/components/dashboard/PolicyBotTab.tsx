import { useState, useRef, useCallback, useEffect } from 'react'
import type { AgentStep } from '../agent/agentTypes'
import ScreenshotGallery from '../agent/ScreenshotGallery'
import * as api from '../../lib/api'

interface XaiEntry {
  step: number
  url: string
  path: string
  policy_injected: boolean
  policy_match_type: 'exact' | 'normalized' | 'none'
  human_top_action: string
  human_top_action_frequency: number
  ai_action: string
  ai_followed_policy: boolean
  n_human_sessions: number
}

interface Props {
  siteId: string
  siteUrl: string
  task: string | null
  taskId?: number
}

type RunState = 'idle' | 'running' | 'done' | 'error'
type ViewMode = 'bot' | 'human' | 'both'

function wsUrl(): string {
  const agentUrl = import.meta.env.VITE_AGENT_URL ?? import.meta.env.VITE_BACKEND_URL ?? window.location.origin
  const proto = agentUrl.startsWith('https') ? 'wss' : 'ws'
  const host = agentUrl.replace(/^https?:\/\//, '')
  return `${proto}://${host}/ws/run`
}

const PROVIDER_KEY = 'ciphercorgi_provider'
const APIKEY_KEY = 'ciphercorgi_apikey'
const MODEL_KEY = 'ciphercorgi_model'

// Screenshot modal component
function ScreenshotModal({ step, onClose }: { step: AgentStep | null; onClose: () => void }) {
  if (!step) return null
  const screenshotSrc = step.screenshot_url ?? (step.screenshot_base64 ? `data:image/png;base64,${step.screenshot_base64}` : null)
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 16,
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          maxWidth: '90vw',
          maxHeight: '90vh',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--text-primary)' }}>Step {step.step_number}</div>
            <div style={{ fontSize: 'var(--fs-small)', color: 'var(--text-muted)', marginTop: 2 }}>
              {step.action_type.replace(/_/g, ' ')} · {(() => { try { return new URL(step.url).pathname || '/' } catch { return step.url } })()}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 'var(--fs-headline)',
              cursor: 'pointer',
              color: 'var(--gray400)',
              padding: '4px 8px',
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* Screenshot */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5', padding: 20, overflowY: 'auto' }}>
            {screenshotSrc ? (
              <img src={screenshotSrc} alt="Step screenshot" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 8 }} />
            ) : (
              <div style={{ color: 'var(--gray400)', fontSize: 'var(--fs-body)' }}>No screenshot available</div>
            )}
          </div>

          {/* Details sidebar */}
          <div style={{ width: 320, background: '#fafafa', padding: 16, overflowY: 'auto', borderLeft: '1px solid var(--border)' }}>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 'var(--fs-small)', fontWeight: 700, color: 'var(--gray400)', textTransform: 'uppercase', marginBottom: 6 }}>Action</div>
              <div style={{ fontSize: 'var(--fs-body)', fontWeight: 600, color: 'var(--text-primary)' }}>{step.action_type.replace(/_/g, ' ')}</div>
            </div>

            {step.thought && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 'var(--fs-small)', fontWeight: 700, color: 'var(--gray400)', textTransform: 'uppercase', marginBottom: 6 }}>Bot Reasoning</div>
                <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-secondary)', lineHeight: 1.5, fontStyle: 'italic' }}>{step.thought}</div>
              </div>
            )}

            {!!(step.action_details as Record<string, unknown>)?.element_selector && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 'var(--fs-small)', fontWeight: 700, color: 'var(--gray400)', textTransform: 'uppercase', marginBottom: 6 }}>Target Element</div>
                <div style={{ fontSize: 'var(--fs-small)', color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)', wordBreak: 'break-all', background: '#f0f0f0', padding: 8, borderRadius: 4 }}>
                  {String((step.action_details as Record<string, unknown>).element_selector)}
                </div>
              </div>
            )}

            {!!(step.action_details as Record<string, unknown>)?.input_text && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 'var(--fs-small)', fontWeight: 700, color: 'var(--gray400)', textTransform: 'uppercase', marginBottom: 6 }}>Text Input</div>
                <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-secondary)', background: '#f0f0f0', padding: 8, borderRadius: 4, wordBreak: 'break-word' }}>
                  {String((step.action_details as Record<string, unknown>).input_text)}
                </div>
              </div>
            )}

            <div>
              <div style={{ fontSize: 'var(--fs-small)', fontWeight: 700, color: 'var(--gray400)', textTransform: 'uppercase', marginBottom: 6 }}>URL</div>
              <div style={{ fontSize: 'var(--fs-small)', color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)', wordBreak: 'break-all' }}>
                {step.url}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function PolicyBotTab({ siteId, siteUrl, task, taskId }: Props) {
  const [runState, setRunState] = useState<RunState>('idle')
  const [status, setStatus] = useState('')
  const [steps, setSteps] = useState<AgentStep[]>([])
  const [xaiTrace, setXaiTrace] = useState<XaiEntry[]>([])
  const [selectedStep, setSelectedStep] = useState<AgentStep | null>(null)
  const [modalStep, setModalStep] = useState<AgentStep | null>(null)
  const [activeTab, setActiveTab] = useState<'flow' | 'trajectory' | 'xai'>('flow')
  const [viewMode, setViewMode] = useState<ViewMode>('bot')
  const [humanSteps, setHumanSteps] = useState<AgentStep[]>([])
  const [humanLoading, setHumanLoading] = useState(false)
  const [provider, setProvider] = useState<'nvidia' | 'google' | 'local'>(
    () => (localStorage.getItem(PROVIDER_KEY) ?? 'nvidia') as 'nvidia' | 'google' | 'local'
  )
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(APIKEY_KEY) ?? '')
  const wsRef = useRef<WebSocket | null>(null)

  // Load last saved policy bot journey for this site+task on mount
  useEffect(() => {
    api.listSiteJourneys(siteId, 'policy_bot').then(journeys => {
      const saved = taskId != null
        ? (journeys.find(j => j.task_id === taskId) ?? null)
        : (journeys[0] ?? null)
      if (saved && saved.steps.length > 0) {
        setSteps(saved.steps as AgentStep[])
        setXaiTrace((saved.policy_trace ?? []) as XaiEntry[])
        setRunState('done')
        setStatus(`Last run: ${new Date(saved.completed_at).toLocaleString()} - ${saved.total_steps} steps`)
      }
    }).catch(() => {})

    // Load human sessions data for comparison
    setHumanLoading(true)
    api.listSessions(siteId).then(sessions => {
      if (sessions.length > 0) {
        const promises = sessions.map(s => api.listEvents(s.id).then(events => ({ sessionId: s.id, events })))
        Promise.all(promises).then(results => {
          const allSteps: AgentStep[] = []
          results.forEach(({ events }) => {
            events.forEach((evt, idx) => {
              const d = (() => { try { return JSON.parse(evt.data ?? '{}') } catch { return {} } })()
              allSteps.push({
                step_number: idx + 1,
                url: d.page_url ?? evt.path ?? '',
                title: '',
                action_type: evt.type ?? 'click_element',
                action_details: { element_selector: d.target_selector },
                reasoning: '',
                thought: d.event_type ?? evt.type ?? '',
                next_goal: '',
                screenshot_base64: '',
                element_coordinates: d.click_x && d.click_y ? { x: d.click_x, y: d.click_y, width: 0, height: 0 } : null,
                timestamp: evt.timestamp,
              } as AgentStep)
            })
          })
          setHumanSteps(allSteps)
        }).finally(() => setHumanLoading(false))
      } else {
        setHumanLoading(false)
      }
    }).catch(() => setHumanLoading(false))
  }, [siteId, taskId])

  // Clean up WS on unmount
  useEffect(() => () => { wsRef.current?.close() }, [])

  const startRun = useCallback((runMode: 'bot' | 'human') => {
    if (runState === 'running') return
    if (!task) { setStatus('No task selected.'); return }
    if (provider !== 'local' && !apiKey) { setStatus('API key not configured'); return }

    setRunState('running')
    setStatus(`Starting ${runMode} run...`)
    setSteps([])
    setXaiTrace([])
    setSelectedStep(null)
    setViewMode(runMode)

    const ws = new WebSocket(wsUrl())
    wsRef.current = ws

    ws.onopen = () => {
      const token = localStorage.getItem('ciphercorgi_token') ?? ''
      ws.send(JSON.stringify({
        url: siteUrl,
        task,
        llm_provider: provider,
        api_key: apiKey,
        model: null,
        site_id: siteId,
        task_id: taskId ?? null,
        user_token: token,
        use_policy: true,
        run_mode: runMode,
      }))
    }

    ws.onmessage = (evt) => {
      let msg: { type: string; data?: unknown; message?: string }
      try { msg = JSON.parse(evt.data) } catch { return }

      if (msg.type === 'status') {
        setStatus(msg.message ?? '')
      } else if (msg.type === 'step') {
        setSteps(prev => [...prev, msg.data as AgentStep])
      } else if (msg.type === 'complete') {
        const result = msg.data as { xai_trace?: XaiEntry[]; steps?: AgentStep[] }
        if (result.xai_trace) setXaiTrace(result.xai_trace)
        setRunState('done')
        setStatus(`Completed - ${(result.steps ?? []).length} steps`)
      } else if (msg.type === 'error') {
        setRunState('error')
        setStatus(`Error: ${msg.message}`)
      }
    }

    ws.onerror = () => {
      setRunState('error')
      setStatus('WebSocket connection failed')
    }
    ws.onclose = () => {
      setRunState(prev => prev === 'running' ? 'done' : prev)
    }
  }, [runState, task, provider, apiKey, siteId, siteUrl, taskId])

  const stopRun = useCallback(() => {
    wsRef.current?.close()
    setRunState('idle')
    setStatus('Stopped')
  }, [])

  // XAI summary stats
  const withPolicy = xaiTrace.filter(e => e.policy_injected)
  const followed = withPolicy.filter(e => e.ai_followed_policy)
  const novel = xaiTrace.filter(e => !e.policy_injected)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>

      {/* Header bar */}
      <div style={{ borderBottom: '1px solid var(--gray100)', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 'var(--fs-small)', fontWeight: 700, color: 'var(--gray700)' }}>Policy Bot</div>
          <div style={{ fontSize: 'var(--fs-small)', color: 'var(--gray400)', marginTop: 2 }}>
            {task ? `Task: "${task}"` : 'No task selected'}
          </div>
        </div>

        {runState === 'running' ? (
          <button className="btn btn-outline btn-xs" onClick={stopRun}>Stop</button>
        ) : (
          <>
            <button
              className="btn btn-primary btn-xs"
              disabled={!task}
              onClick={() => startRun('bot')}
              title="Run AI agent with policy guidance"
            >
              Run AI Agent
            </button>
            <button
              className="btn btn-outline btn-xs"
              disabled={!task || humanLoading}
              onClick={() => startRun('human')}
              title="Analyze human user sessions"
            >
              Load Human Data
            </button>
          </>
        )}

        {status && (
          <div style={{ fontSize: 'var(--fs-small)', color: runState === 'error' ? 'var(--red)' : runState === 'running' ? 'var(--brand)' : 'var(--gray500)', maxWidth: 200, textAlign: 'right' }}>
            {runState === 'running' && <span className="inline-spinner" style={{ marginRight: 4 }} />}
            {status}
          </div>
        )}
      </div>

      {/* XAI summary strip — shown after run */}
      {xaiTrace.length > 0 && (
        <div style={{ background: 'var(--gray50)', borderBottom: '1px solid var(--gray100)', padding: '8px 16px', display: 'flex', gap: 24, flexShrink: 0, flexWrap: 'wrap' }}>
          <Stat label="Steps with policy" value={`${withPolicy.length}/${xaiTrace.length}`} />
          <Stat label="Followed human majority" value={withPolicy.length > 0 ? `${followed.length}/${withPolicy.length} (${Math.round(followed.length / withPolicy.length * 100)}%)` : '—'} highlight={followed.length / Math.max(withPolicy.length, 1) >= 0.6} />
          <Stat label="Novel pages" value={novel.length > 0 ? novel.length.toString() : '0'} />
        </div>
      )}

      {/* Sub-tabs: Flow | Trajectory | XAI Trace */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--gray100)', paddingLeft: 16, gap: 0, flexShrink: 0 }}>
        {(['flow', 'trajectory', 'xai'] as const).map(t => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            style={{
              padding: '8px 14px',
              fontSize: 'var(--fs-small)',
              fontWeight: 600,
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              color: activeTab === t ? 'var(--brand)' : 'var(--gray400)',
              borderBottom: activeTab === t ? '2px solid var(--brand)' : '2px solid transparent',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            {t === 'trajectory' ? 'Trajectory' : t === 'flow' ? 'Flow' : `XAI Trace${xaiTrace.length > 0 ? ` (${xaiTrace.length})` : ''}`}
          </button>
        ))}
      </div>

      {/* View mode toggle (shown in flow tab) */}
      {activeTab === 'flow' && steps.length > 0 && (
        <div style={{ background: 'var(--gray50)', borderBottom: '1px solid var(--gray100)', padding: '8px 16px', display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: 'var(--fs-small)', fontWeight: 700, color: 'var(--gray400)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>View:</span>
          {(['bot', 'human', 'both'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              style={{
                padding: '4px 12px',
                fontSize: 'var(--fs-small)',
                fontWeight: 600,
                border: viewMode === mode ? '1px solid var(--brand)' : '1px solid var(--border)',
                background: viewMode === mode ? 'var(--brand-pale)' : 'transparent',
                color: viewMode === mode ? 'var(--brand)' : 'var(--gray600)',
                borderRadius: 6,
                cursor: 'pointer',
                transition: 'all 0.15s',
                textTransform: 'capitalize',
              }}
            >
              {mode === 'bot' ? 'AI Agent' : mode === 'human' ? 'Human Sessions' : 'Comparison'}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {activeTab === 'flow' && (
          <>
            {steps.length === 0 && runState === 'idle' && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 10, color: 'var(--gray400)', fontSize: 'var(--fs-body)' }}>
                <span style={{ fontSize: 'var(--fs-headline)' }}>→</span>
                <span>Click <strong>Run AI Agent</strong> to execute an AI agent guided by human behavior policy.</span>
                <span style={{ fontSize: 'var(--fs-small)', maxWidth: 320, textAlign: 'center', lineHeight: 1.5 }}>
                  Or click <strong>Load Human Data</strong> to view real human user sessions.
                </span>
              </div>
            )}
            {(steps.length > 0 || runState === 'running') && (
              <FlowVisualization
                steps={viewMode === 'human' ? humanSteps : steps}
                xaiTrace={xaiTrace}
                onSelectStep={setModalStep}
              />
            )}
          </>
        )}

        {activeTab === 'trajectory' && (
          <>
            {steps.length === 0 && runState === 'idle' && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 10, color: 'var(--gray400)', fontSize: 'var(--fs-body)' }}>
                <span style={{ fontSize: 'var(--fs-headline)' }}>📸</span>
                <span>Click <strong>Run AI Agent</strong> to capture screenshots.</span>
                <span style={{ fontSize: 'var(--fs-small)', maxWidth: 320, textAlign: 'center', lineHeight: 1.5 }}>
                  Screenshots from each step will appear here.
                </span>
              </div>
            )}
            {(steps.length > 0 || runState === 'running') && (
              <ScreenshotGallery
                steps={steps}
                selectedStep={selectedStep?.step_number ?? null}
                onSelectStep={(n) => setSelectedStep(n != null ? (steps.find(s => s.step_number === n) ?? null) : null)}
              />
            )}
          </>
        )}

        {activeTab === 'xai' && (
          <div style={{ padding: 16 }}>
            {xaiTrace.length === 0 ? (
              <div style={{ color: 'var(--gray400)', fontSize: 'var(--fs-body)', textAlign: 'center', paddingTop: 40 }}>
                XAI trace will appear after the run completes.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-small)' }}>
                <thead>
                  <tr style={{ background: 'var(--gray50)' }}>
                    {['#', 'Path', 'AI action', 'Human top action', 'Match', 'Sessions'].map(h => (
                      <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 700, color: 'var(--gray500)', fontSize: 'var(--fs-small)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--gray100)', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {xaiTrace.map((entry, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--gray50)' }}>
                      <td style={{ padding: '7px 10px', color: 'var(--gray400)', fontWeight: 700 }}>{entry.step}</td>
                      <td style={{ padding: '7px 10px', fontFamily: 'var(--font-sans)', color: 'var(--gray700)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.path || '/'}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--gray700)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.ai_action}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--gray600)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {entry.policy_injected && entry.human_top_action
                          ? `"${entry.human_top_action}" (${Math.round(entry.human_top_action_frequency * 100)}%)`
                          : <span style={{ color: 'var(--gray300)', fontStyle: 'italic' }}>no data</span>
                        }
                      </td>
                      <td style={{ padding: '7px 10px' }}>
                        {!entry.policy_injected ? (
                          <span style={{ fontSize: 'var(--fs-small)', background: 'var(--gray100)', color: 'var(--gray400)', padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>novel</span>
                        ) : entry.ai_followed_policy ? (
                          <span style={{ fontSize: 'var(--fs-small)', background: 'var(--green-pale)', color: 'var(--green)', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>match</span>
                        ) : (
                          <span style={{ fontSize: 'var(--fs-small)', background: 'var(--red-pale)', color: 'var(--red)', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>deviate</span>
                        )}
                      </td>
                      <td style={{ padding: '7px 10px', color: 'var(--gray500)', textAlign: 'right' }}>{entry.n_human_sessions > 0 ? entry.n_human_sessions : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Screenshot Modal */}
      <ScreenshotModal step={modalStep} onClose={() => setModalStep(null)} />
    </div>
  )
}

interface FlowVisualizationProps {
  steps: AgentStep[]
  xaiTrace: XaiEntry[]
  onSelectStep: (step: AgentStep) => void
}

function FlowVisualization({ steps, xaiTrace, onSelectStep }: FlowVisualizationProps) {
  return (
    <div style={{ padding: '16px', overflowX: 'auto' }}>
      <div style={{ display: 'flex', gap: 12, minWidth: 'min-content', paddingBottom: 8, position: 'relative' }}>
        {steps.map((step, i) => {
          const xaiEntry = xaiTrace[i]
          const matchColor = !xaiEntry?.policy_injected ? 'var(--gray500)'
            : xaiEntry.ai_followed_policy ? '#16a34a' : '#dc2626'
          const matchLabel = !xaiEntry?.policy_injected ? 'novel' : xaiEntry.ai_followed_policy ? 'match' : 'deviate'
          const screenshotSrc = step.screenshot_url ?? (step.screenshot_base64 ? `data:image/png;base64,${step.screenshot_base64}` : null)
          
          return (
            <div
              key={i}
              onClick={() => onSelectStep(step)}
              style={{
                flex: '0 0 240px',
                borderRadius: 12,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                overflow: 'hidden',
                boxShadow: '0 2px 8px rgba(26,43,66,0.07)',
                cursor: 'pointer',
                transition: 'all 0.15s',
                position: 'relative',
              }}
              onMouseEnter={e => {
                const el = e.currentTarget as HTMLElement
                el.style.boxShadow = '0 8px 24px rgba(26,43,66,0.15)'
                el.style.transform = 'translateY(-2px)'
              }}
              onMouseLeave={e => {
                const el = e.currentTarget as HTMLElement
                el.style.boxShadow = '0 2px 8px rgba(26,43,66,0.07)'
                el.style.transform = 'translateY(0)'
              }}
            >
              {/* Arrow to next step */}
              {i < steps.length - 1 && (
                <div
                  style={{
                    position: 'absolute',
                    right: -16,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: 16,
                    height: 2,
                    background: step.url === steps[i + 1]?.url ? 'var(--gray400)' : 'var(--brand)',
                    zIndex: 10,
                  }}
                />
              )}

              {/* Screenshot */}
              <div style={{ width: '100%', height: 160, background: '#f5f5f5', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {screenshotSrc ? (
                  <img src={screenshotSrc} alt={`Step ${step.step_number}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ color: 'var(--gray400)', fontSize: 'var(--fs-body)', textAlign: 'center' }}>No screenshot</div>
                )}
              </div>

              {/* Details */}
              <div style={{ padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 6 }}>
                  <div style={{ fontSize: 'var(--fs-small)', fontWeight: 700, color: 'var(--gray500)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Step {step.step_number}
                  </div>
                  <div style={{ fontSize: 'var(--fs-small)', fontWeight: 700, borderRadius: 4, padding: '2px 6px', background: `${matchColor}18`, color: matchColor, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {matchLabel}
                  </div>
                </div>
                <div style={{ fontSize: 'var(--fs-small)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {step.action_type.replace(/_/g, ' ')}
                </div>
                <div style={{ fontSize: 'var(--fs-small)', color: 'var(--gray500)', fontFamily: 'var(--font-sans)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {(() => { try { return new URL(step.url).pathname || '/' } catch { return step.url } })()}
                </div>
                {xaiEntry && (
                  <div style={{ fontSize: 'var(--fs-small)', color: 'var(--gray600)', marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--gray100)' }}>
                    Human: {xaiEntry.human_top_action ? `"${xaiEntry.human_top_action}" (${Math.round(xaiEntry.human_top_action_frequency * 100)}%)` : 'No data'}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--fs-small)', fontWeight: 700, color: 'var(--gray400)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: highlight ? 'var(--green)' : 'var(--gray700)', marginTop: 1 }}>{value}</div>
    </div>
  )
}
