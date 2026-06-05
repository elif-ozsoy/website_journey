import { createContext, useContext, useState, useRef, type ReactNode } from 'react'
import type { Task, Agent } from '../lib/types'
import { providerForModel } from '../lib/types'
import type { AgentStep, AgentResult, WsMessage } from '../components/agent/agentTypes'

export type AgentRunState = 'idle' | 'running' | 'complete' | 'error'

interface AgentRunContextValue {
  apiKey: string
  setApiKey: (key: string) => void
  googleApiKey: string
  setGoogleApiKey: (key: string) => void
  provider: 'nvidia' | 'google'
  setProvider: (p: 'nvidia' | 'google') => void

  runState: AgentRunState
  currentTaskIdx: number
  totalTasks: number
  statusMsg: string
  runningTaskTitle: string
  errorMsg: string
  liveStepCount: number
  progress: number
  runningSiteId: string | null
  runningVersionId: string | null

  startRun: (siteId: string, siteUrl: string, tasks: Task[], versionId?: string, selectedAgents?: Agent[]) => void
  stopRun: () => void
}

const AgentRunContext = createContext<AgentRunContextValue | null>(null)

function runSingleTask(
  taskTitle: string,
  siteUrl: string,
  provider: 'nvidia' | 'google',
  apiKey: string,
  agentUrl: string,
  onStatus: (msg: string) => void,
  onStep: (step: AgentStep) => void,
  wsSet: React.MutableRefObject<Set<WebSocket>>,
  siteId?: string,
  taskId?: number,
  userToken?: string,
  model?: string,
  agentPersona?: string,
): Promise<AgentResult> {
  return new Promise((resolve, reject) => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws/run`)
    wsSet.current.add(ws)

    ws.onopen = () => {
      const fullTask = agentPersona ? `[Persona: ${agentPersona}]\n\n${taskTitle}` : taskTitle
      ws.send(JSON.stringify({
        url: siteUrl,
        task: fullTask,
        llm_provider: provider,
        api_key: apiKey,
        model: model ?? null,
        site_id: siteId ?? null,
        task_id: taskId ?? null,
        user_token: userToken ?? null,
      }))
    }
    ws.onmessage = (event) => {
      const msg: WsMessage = JSON.parse(event.data)
      if (msg.type === 'status') onStatus(msg.message)
      else if (msg.type === 'step') onStep(msg.data)
      else if (msg.type === 'complete') { wsSet.current.delete(ws); resolve(msg.data); ws.close() }
      else if (msg.type === 'error') { wsSet.current.delete(ws); reject(new Error(msg.message)); ws.close() }
    }
    ws.onclose = () => wsSet.current.delete(ws)
    ws.onerror = () => { wsSet.current.delete(ws); reject(new Error('WebSocket connection failed — is the agent backend running?')) }
  })
}

export function AgentRunProvider({ children }: { children: ReactNode }) {
  const [apiKey, setApiKeyState] = useState(() => localStorage.getItem('ciphercorgi_apikey') ?? '')
  const [googleApiKey, setGoogleApiKeyState] = useState(() => localStorage.getItem('ciphercorgi_apikey_google') ?? '')
  const [provider, setProviderState] = useState<'nvidia' | 'google'>(() => (localStorage.getItem('ciphercorgi_provider') as 'nvidia' | 'google') ?? 'nvidia')

  function setApiKey(key: string) { setApiKeyState(key); localStorage.setItem('ciphercorgi_apikey', key) }
  function setGoogleApiKey(key: string) { setGoogleApiKeyState(key); localStorage.setItem('ciphercorgi_apikey_google', key) }
  function setProvider(p: 'nvidia' | 'google') { setProviderState(p); localStorage.setItem('ciphercorgi_provider', p) }

  const [runState, setRunState] = useState<AgentRunState>('idle')
  const [currentTaskIdx, setCurrentTaskIdx] = useState(0)
  const [totalTasks, setTotalTasks] = useState(0)
  const [statusMsg, setStatusMsg] = useState('')
  const [runningTaskTitle, setRunningTaskTitle] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [liveStepCount, setLiveStepCount] = useState(0)
  const [totalCompletedSteps, setTotalCompletedSteps] = useState(0)
  const [runningSiteId, setRunningSiteId] = useState<string | null>(null)
  const [runningVersionId, setRunningVersionId] = useState<string | null>(null)

  const wsSetRef = useRef<Set<WebSocket>>(new Set())
  const isRunningRef = useRef(false)
  const completedRunsRef = useRef(0)

  const progress = runState === 'complete' ? 100
    : runState === 'idle' || totalTasks === 0 ? 0
    : Math.min(99, Math.round((currentTaskIdx / totalTasks) * 100))

  function stopRun() {
    isRunningRef.current = false
    for (const ws of wsSetRef.current) ws.close()
    wsSetRef.current.clear()
    setRunState('idle')
    setStatusMsg('')
  }

  async function startRun(siteId: string, siteUrl: string, tasks: Task[], versionId?: string, selectedAgents?: Agent[]) {
    if (isRunningRef.current) return
    setErrorMsg('')
    if (!apiKey.trim() && !googleApiKey.trim()) { setErrorMsg('Enter an API key in settings before running agents.'); return }
    if (tasks.length === 0) { setErrorMsg('Add at least one task in Step 1 before running agents.'); return }

    isRunningRef.current = true
    setRunningSiteId(siteId)
    setRunningVersionId(versionId ?? null)

    const agentUrl = import.meta.env.VITE_BACKEND_URL ?? import.meta.env.VITE_AGENT_URL ?? window.location.origin

    const agentRuns: Array<{ name: string; model?: string; persona?: string }> =
      selectedAgents && selectedAgents.length > 0
        ? selectedAgents.map(a => ({ name: a.name, model: a.model || undefined, persona: a.prompt || undefined }))
        : [{ name: 'Agent' }]

    const totalRuns = agentRuns.length * tasks.length
    completedRunsRef.current = 0

    setRunState('running')
    setTotalTasks(totalRuns)
    setCurrentTaskIdx(0)
    setLiveStepCount(0)
    setTotalCompletedSteps(0)
    setRunningTaskTitle(tasks[0]?.title ?? '')

    const parallel = agentRuns.length > 1
    if (parallel) {
      setStatusMsg(`Starting ${agentRuns.length} agents in parallel…`)
    } else {
      setStatusMsg(`Task 1/${tasks.length} — ${tasks[0]?.title ?? ''}`)
    }

    const userToken = localStorage.getItem('ciphercorgi_token') ?? undefined

    const results = await Promise.allSettled(
      agentRuns.map(async (agentRun, _ai) => {
        const agentSteps: AgentStep[] = []
        for (let i = 0; i < tasks.length; i++) {
          if (!isRunningRef.current) return agentSteps
          const task = tasks[i]
          const focusPart = task.focusAreas?.length ? ` Pay special attention to: ${task.focusAreas.join(', ')}.` : ''
          const taskPrompt = `${task.title}${task.description ? '. ' + task.description : ''}${focusPart}`

          try {
            const rawProvider = agentRun.model ? providerForModel(agentRun.model) : provider
            const agentProvider: 'nvidia' | 'google' = rawProvider === 'local' ? 'nvidia' : rawProvider
            const agentKey = agentProvider === 'google' ? googleApiKey.trim() : apiKey.trim()
            const result = await runSingleTask(
              taskPrompt, siteUrl, agentProvider, agentKey, agentUrl,
              (msg) => {
                if (!isRunningRef.current) return
                if (!parallel) setStatusMsg(msg)
              },
              (step) => {
                if (!isRunningRef.current) return
                if (!parallel) {
                  setLiveStepCount(step.step_number)
                  setStatusMsg(`Step ${step.step_number} — ${step.action_type.replace(/_/g, ' ')}`)
                } else {
                  setLiveStepCount(prev => prev + 1)
                }
              },
              wsSetRef,
              siteId, task.id, userToken, agentRun.model, agentRun.persona,
            )
            agentSteps.push(...result.steps)
            setTotalCompletedSteps(prev => prev + result.steps.length)
          } catch (err) {
            if (!isRunningRef.current) return agentSteps
            if (!parallel) {
              isRunningRef.current = false
              setRunState('error')
              setStatusMsg((err as Error).message)
              return agentSteps
            }
          }

          completedRunsRef.current++
          setCurrentTaskIdx(completedRunsRef.current)
          if (parallel) {
            setStatusMsg(`${completedRunsRef.current} of ${totalRuns} runs complete (${agentRuns.length} agents in parallel)`)
          } else {
            const next = i + 1
            if (next < tasks.length) setStatusMsg(`Task ${next + 1}/${tasks.length} — ${tasks[next].title}`)
          }

          if (!parallel) setRunningTaskTitle(tasks[Math.min(i + 1, tasks.length - 1)].title)
        }
        return agentSteps
      })
    )

    if (!isRunningRef.current) return
    isRunningRef.current = false

    const allSteps = results.flatMap(r => r.status === 'fulfilled' ? (r.value ?? []) : [])

    try {
      const runKey = versionId ? `ciphercorgi_agent_run_${siteId}_${versionId}` : `ciphercorgi_agent_run_${siteId}`
      localStorage.setItem(runKey, JSON.stringify({ siteId, steps: allSteps, completedAt: Date.now() }))
    } catch { /* storage quota exceeded */ }

    setRunState('complete')
    setStatusMsg(`Complete — ${allSteps.length} steps across ${agentRuns.length} agent${agentRuns.length !== 1 ? 's' : ''} × ${tasks.length} task${tasks.length !== 1 ? 's' : ''}`)
  }

  return (
    <AgentRunContext.Provider value={{
      apiKey, setApiKey, googleApiKey, setGoogleApiKey,
      provider, setProvider,
      runState, currentTaskIdx, totalTasks, statusMsg, runningTaskTitle, errorMsg, liveStepCount, progress,
      runningSiteId, runningVersionId,
      startRun, stopRun,
    }}>
      {children}
    </AgentRunContext.Provider>
  )
}

export function useAgentRun() {
  const ctx = useContext(AgentRunContext)
  if (!ctx) throw new Error('useAgentRun must be used inside AgentRunProvider')
  return ctx
}
