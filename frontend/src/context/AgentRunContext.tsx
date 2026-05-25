import { createContext, useContext, useState, useRef, type ReactNode } from 'react'
import type { Task, Agent } from '../lib/types'
import type { AgentStep, AgentResult, WsMessage } from '../components/agent/agentTypes'
import * as api from '../lib/api'

export type AgentRunState = 'idle' | 'running' | 'complete' | 'error'

interface AgentRunContextValue {
  // Config (persists across navigation)
  apiKey: string
  setApiKey: (key: string) => void
  provider: 'nvidia' | 'google'
  setProvider: (p: 'nvidia' | 'google') => void

  // Run state
  runState: AgentRunState
  currentTaskIdx: number
  totalTasks: number
  statusMsg: string
  runningTaskTitle: string
  errorMsg: string
  liveStepCount: number
  progress: number
  // Which project+version this run belongs to
  runningSiteId: string | null
  runningVersionId: string | null

  // Actions
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
  wsRef: React.MutableRefObject<WebSocket | null>,
  siteId?: string,
  taskId?: number,
  userToken?: string,
  model?: string,
  agentPersona?: string,
): Promise<AgentResult> {
  return new Promise((resolve, reject) => {
    const wsProtocol = agentUrl.startsWith('https') ? 'wss:' : 'ws:'
    const wsHost = agentUrl.replace(/^https?:\/\//, '')
    const ws = new WebSocket(`${wsProtocol}//${wsHost}/ws/run`)
    wsRef.current = ws

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
      else if (msg.type === 'complete') { resolve(msg.data); ws.close() }
      else if (msg.type === 'error') { reject(new Error(msg.message)); ws.close() }
    }
    ws.onerror = () => reject(new Error('WebSocket connection failed — is the agent backend running?'))
  })
}

export function AgentRunProvider({ children }: { children: ReactNode }) {
  const [apiKey, setApiKeyState] = useState(() => localStorage.getItem('ciphercorgi_apikey') ?? '')
  const [provider, setProviderState] = useState<'nvidia' | 'google'>(() => (localStorage.getItem('ciphercorgi_provider') as 'nvidia' | 'google') ?? 'nvidia')

  function setApiKey(key: string) { setApiKeyState(key); localStorage.setItem('ciphercorgi_apikey', key) }
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

  const wsRef = useRef<WebSocket | null>(null)
  const isRunningRef = useRef(false)

  // Use actual avg steps/task from completed tasks; fall back to 20 until data is available
  const expectedPerTask = currentTaskIdx > 0 ? totalCompletedSteps / currentTaskIdx : 20
  const withinTask = Math.min(liveStepCount / Math.max(expectedPerTask, 1), 0.95)
  const progress = runState === 'complete' ? 100
    : runState === 'idle' || totalTasks === 0 ? 0
    : Math.round(((currentTaskIdx + withinTask) / totalTasks) * 100)

  function stopRun() {
    isRunningRef.current = false
    wsRef.current?.close()
    setRunState('idle')
    setStatusMsg('')
  }

  async function startRun(siteId: string, siteUrl: string, tasks: Task[], versionId?: string, selectedAgents?: Agent[]) {
    if (isRunningRef.current) return
    setErrorMsg('')
    if (!apiKey.trim()) {
      setErrorMsg('Enter an API key above before running agents.')
      return
    }
    if (tasks.length === 0) {
      setErrorMsg('Add at least one task in Step 1 before running agents.')
      return
    }
    isRunningRef.current = true
    setRunningSiteId(siteId)
    setRunningVersionId(versionId ?? null)

    const agentUrl = import.meta.env.VITE_BACKEND_URL ?? import.meta.env.VITE_AGENT_URL ?? window.location.origin
    const allSteps: AgentStep[] = []

    // If specific agents are selected, run all tasks once per agent; otherwise one pass
    const agentRuns: Array<{ name: string; model?: string; persona?: string }> =
      selectedAgents && selectedAgents.length > 0
        ? selectedAgents.map(a => ({ name: a.name, model: a.model || undefined, persona: a.prompt || undefined }))
        : [{ name: 'Agent' }]

    const totalRuns = agentRuns.length * tasks.length
    setRunState('running')
    setTotalTasks(totalRuns)
    setCurrentTaskIdx(0)
    setLiveStepCount(0)
    setTotalCompletedSteps(0)
    setStatusMsg('Initialising…')

    let runIdx = 0
    for (let ai = 0; ai < agentRuns.length; ai++) {
      const agentRun = agentRuns[ai]
      for (let i = 0; i < tasks.length; i++) {
        if (!isRunningRef.current) return
        const task = tasks[i]
        setCurrentTaskIdx(runIdx)
        setLiveStepCount(0)
        setRunningTaskTitle(task.title)
        const agentLabel = agentRuns.length > 1 ? `${agentRun.name} — ` : ''
        setStatusMsg(`${agentLabel}Task ${i + 1}/${tasks.length} — ${task.title}`)

        const userToken = localStorage.getItem('ciphercorgi_token') ?? undefined
        try {
          const focusPart = task.focusAreas && task.focusAreas.length > 0
            ? ` Pay special attention to: ${task.focusAreas.join(', ')}.`
            : ''
          const taskPrompt = `${task.title}${task.description ? '. ' + task.description : ''}${focusPart}`
          const result = await runSingleTask(
            taskPrompt,
            siteUrl,
            provider,
            apiKey.trim(),
            agentUrl,
            (msg) => { if (isRunningRef.current) setStatusMsg(msg) },
            (step) => {
              if (!isRunningRef.current) return
              setLiveStepCount(step.step_number)
              setStatusMsg(`Step ${step.step_number} — ${step.action_type.replace(/_/g, ' ')}`)
            },
            wsRef,
            siteId,
            task.id,
            userToken,
            agentRun.model,
            agentRun.persona,
          )
          allSteps.push(...result.steps)
          setTotalCompletedSteps(prev => prev + result.steps.length)
        } catch (err) {
          if (!isRunningRef.current) return
          isRunningRef.current = false
          setRunState('error')
          setStatusMsg((err as Error).message)
          return
        }
        runIdx++
      }
    }

    if (!isRunningRef.current) return
    isRunningRef.current = false

    try {
      const runKey = versionId ? `ciphercorgi_agent_run_${siteId}_${versionId}` : `ciphercorgi_agent_run_${siteId}`
      localStorage.setItem(
        runKey,
        JSON.stringify({ siteId, steps: allSteps, completedAt: Date.now() }),
      )
    } catch { /* storage quota exceeded */ }

    setRunState('complete')
    setStatusMsg(`Complete — ${allSteps.length} steps across ${agentRuns.length} agent${agentRuns.length !== 1 ? 's' : ''} × ${tasks.length} task${tasks.length !== 1 ? 's' : ''}`)
  }

  return (
    <AgentRunContext.Provider value={{
      apiKey, setApiKey,
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
