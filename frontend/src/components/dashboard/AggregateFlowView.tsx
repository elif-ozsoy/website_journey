import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react'
import * as api from '../../lib/api'
import type { AgentStep } from '../agent/agentTypes'
import MergedPolicyFlowMap from './MergedPolicyFlowMap'

const PREV_POLICY_FLAG_KEY = (siteId: string) => `cc_run_prev_policy_${siteId}`

export interface AggregateFlowViewProps {
  siteId: string
  siteUrl: string
  taskTitle: string | null
  taskId?: number
  hasPrevVersion?: boolean
  prevVersionEndsAt?: string | null
  prevVersionLabel?: string
  showHuman?: boolean
  showAi?: boolean
  showPrev?: boolean
  rightControl?: ReactNode
}

function wsUrl(): string {
  const agentUrl = import.meta.env.VITE_AGENT_URL ?? import.meta.env.VITE_BACKEND_URL ?? window.location.origin
  const proto = agentUrl.startsWith('https') ? 'wss' : 'ws'
  const host = agentUrl.replace(/^https?:\/\//, '')
  return `${proto}://${host}/ws/run`
}

const PROVIDER_KEY = 'ciphercorgi_provider'
const APIKEY_KEY   = 'ciphercorgi_apikey'

export default function AggregateFlowView({ siteId, siteUrl, taskTitle, taskId, hasPrevVersion, prevVersionEndsAt, prevVersionLabel, showHuman = true, showAi = true, showPrev = true, rightControl }: AggregateFlowViewProps) {
  const [humanFlow, setHumanFlow]       = useState<AgentStep[] | null>(null)
  const [aiFlow, setAiFlow]             = useState<AgentStep[] | null>(null)
  const [prevFlow, setPrevFlow]         = useState<AgentStep[] | null>(null)
  const [humanLoading, setHumanLoading] = useState(true)
  const [aiLoading, setAiLoading]       = useState(true)
  const [prevLoading, setPrevLoading]   = useState(false)
  const [humanError, setHumanError]     = useState<string | null>(null)
  const [aiError, setAiError]           = useState<string | null>(null)
  const [prevError, setPrevError]       = useState<string | null>(null)
  const [humanRunning, setHumanRunning] = useState(false)
  const [aiRunning, setAiRunning]       = useState(false)
  const [prevRunning, setPrevRunning]   = useState(false)
  const [humanStatus, setHumanStatus]   = useState('')
  const [aiStatus, setAiStatus]         = useState('')
  const [prevStatus, setPrevStatus]     = useState('')

  const humanWsRef = useRef<WebSocket | null>(null)
  const aiWsRef    = useRef<WebSocket | null>(null)
  const prevWsRef  = useRef<WebSocket | null>(null)

  // Load persisted policy bot journeys on mount
  useEffect(() => {
    const loadSide = (
      source: string,
      setFlow: (s: AgentStep[] | null) => void,
      setErr: (s: string | null) => void,
      setLoading: (b: boolean) => void,
    ) => {
      api.listSiteJourneys(siteId, source, taskId)
        .then(journeys => {
          const match = journeys[0] ?? null
          if (match?.steps && Array.isArray(match.steps) && match.steps.length > 0) {
            setFlow(match.steps as AgentStep[])
          } else {
            setFlow(null)
          }
        })
        .catch(err => setErr(err instanceof Error ? err.message : 'Failed to load'))
        .finally(() => setLoading(false))
    }

    loadSide('policy_bot_human', setHumanFlow, setHumanError, setHumanLoading)
    // Prefer a dedicated ai_policy run; fall back to regular agent runs
    api.listSiteJourneys(siteId, 'policy_bot_ai', taskId)
      .then(journeys => {
        const match = journeys[0] ?? null
        if (match?.steps && Array.isArray(match.steps) && match.steps.length > 0) {
          setAiFlow(match.steps as AgentStep[])
          setAiLoading(false)
        } else {
          loadSide('agent', setAiFlow, setAiError, setAiLoading)
        }
      })
      .catch(() => loadSide('agent', setAiFlow, setAiError, setAiLoading))

    // Load previous policy run if one exists
    api.listSiteJourneys(siteId, 'policy_bot_prev', taskId)
      .then(journeys => {
        const match = journeys[0] ?? null
        if (match?.steps && Array.isArray(match.steps) && match.steps.length > 0) {
          setPrevFlow(match.steps as AgentStep[])
        }
      })
      .catch(() => {})
  }, [siteId, taskId])

  // Trigger a policy bot run via WebSocket
  const startRun = useCallback((runMode: 'human_policy' | 'ai_policy') => {
    const isHuman = runMode === 'human_policy'
    const wsRef   = isHuman ? humanWsRef : aiWsRef
    if (wsRef.current) return
    if (!taskTitle) return

    const provider  = (localStorage.getItem(PROVIDER_KEY) ?? 'nvidia') as string
    const apiKey    = localStorage.getItem(APIKEY_KEY) ?? ''
    const userToken = localStorage.getItem('ciphercorgi_token') ?? ''

    const setRunning = isHuman ? setHumanRunning : setAiRunning
    const setStatus  = isHuman ? setHumanStatus  : setAiStatus
    const setFlow    = isHuman ? setHumanFlow    : setAiFlow
    const setErr     = isHuman ? setHumanError   : setAiError

    setRunning(true)
    setStatus('Connecting…')
    setErr(null)

    const liveSteps: AgentStep[] = []
    const ws = new WebSocket(wsUrl())
    wsRef.current = ws

    ws.onopen = () => {
      setStatus('Starting policy bot…')
      ws.send(JSON.stringify({
        url: siteUrl,
        task: taskTitle,
        llm_provider: provider,
        api_key: apiKey,
        model: null,
        site_id: siteId,
        task_id: taskId ?? null,
        user_token: userToken,
        use_policy: true,
        run_mode: runMode,
      }))
    }

    ws.onmessage = evt => {
      let msg: { type: string; data?: unknown; message?: string }
      try { msg = JSON.parse(evt.data) } catch { return }

      if (msg.type === 'status') {
        setStatus(msg.message ?? '')
      } else if (msg.type === 'step') {
        liveSteps.push(msg.data as AgentStep)
        setFlow([...liveSteps])
      } else if (msg.type === 'complete') {
        const result = msg.data as { steps?: AgentStep[] }
        if (result.steps && result.steps.length > 0) setFlow(result.steps)
        setStatus(`Done — ${liveSteps.length} steps`)
        setRunning(false)
        wsRef.current = null
      } else if (msg.type === 'error') {
        setErr(msg.message ?? 'Run failed')
        setStatus('')
        setRunning(false)
        wsRef.current = null
      }
    }

    ws.onerror = () => {
      setErr('WebSocket connection failed')
      setStatus('')
      setRunning(false)
      wsRef.current = null
    }

    ws.onclose = () => {
      setRunning(false)
      wsRef.current = null
    }
  }, [taskTitle, siteUrl, siteId, taskId])

  const startPrevRun = useCallback((policyBeforeDate?: string) => {
    if (prevWsRef.current) return
    if (!taskTitle) return
    const provider  = (localStorage.getItem(PROVIDER_KEY) ?? 'nvidia') as string
    const apiKey    = localStorage.getItem(APIKEY_KEY) ?? ''
    const userToken = localStorage.getItem('ciphercorgi_token') ?? ''

    setPrevRunning(true)
    setPrevStatus('Connecting…')
    setPrevError(null)

    const liveSteps: AgentStep[] = []
    const ws = new WebSocket(wsUrl())
    prevWsRef.current = ws

    ws.onopen = () => {
      setPrevStatus('Starting prev policy bot…')
      ws.send(JSON.stringify({
        url: siteUrl,
        task: taskTitle,
        llm_provider: provider,
        api_key: apiKey,
        model: null,
        site_id: siteId,
        task_id: taskId ?? null,
        user_token: userToken,
        use_policy: true,
        run_mode: 'prev_policy',
        policy_before_date: policyBeforeDate ?? null,
      }))
    }

    ws.onmessage = evt => {
      let msg: { type: string; data?: unknown; message?: string }
      try { msg = JSON.parse(evt.data) } catch { return }
      if (msg.type === 'status') {
        setPrevStatus(msg.message ?? '')
      } else if (msg.type === 'step') {
        liveSteps.push(msg.data as AgentStep)
        setPrevFlow([...liveSteps])
      } else if (msg.type === 'complete') {
        const result = msg.data as { steps?: AgentStep[] }
        if (result.steps && result.steps.length > 0) setPrevFlow(result.steps)
        setPrevStatus(`Done — ${liveSteps.length} steps`)
        setPrevRunning(false)
        prevWsRef.current = null
      } else if (msg.type === 'error') {
        setPrevError(msg.message ?? 'Run failed')
        setPrevStatus('')
        setPrevRunning(false)
        prevWsRef.current = null
      }
    }

    ws.onerror = () => { setPrevError('WebSocket connection failed'); setPrevStatus(''); setPrevRunning(false); prevWsRef.current = null }
    ws.onclose = () => { setPrevRunning(false); prevWsRef.current = null }
  }, [taskTitle, siteUrl, siteId, taskId])

  const stopRun = useCallback((side: 'human' | 'ai') => {
    const ws = side === 'human' ? humanWsRef.current : aiWsRef.current
    ws?.close()
  }, [])

  const stopPrevRun = useCallback(() => { prevWsRef.current?.close() }, [])

  // Auto-start prev policy run if a flag was set (e.g. from "Evaluate Updated Version")
  useEffect(() => {
    if (!hasPrevVersion) return
    const raw = localStorage.getItem(PREV_POLICY_FLAG_KEY(siteId))
    if (!raw) return
    try {
      const { prevVersionEndsAt: cutoff } = JSON.parse(raw)
      localStorage.removeItem(PREV_POLICY_FLAG_KEY(siteId))
      if (!prevRunning && !prevFlow) startPrevRun(cutoff ?? prevVersionEndsAt ?? undefined)
    } catch {
      localStorage.removeItem(PREV_POLICY_FLAG_KEY(siteId))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, hasPrevVersion])

  useEffect(() => () => {
    humanWsRef.current?.close()
    aiWsRef.current?.close()
    prevWsRef.current?.close()
  }, [])

  const isInitialLoading = humanLoading || aiLoading

  if (isInitialLoading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
        <div style={{ fontSize: 'var(--fs-body)' }}>Loading policy bot flows…</div>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
      <MergedPolicyFlowMap
        humanFlow={humanFlow}
        aiFlow={aiFlow}
        prevFlow={hasPrevVersion ? prevFlow : null}
        showHuman={showHuman}
        showAi={showAi}
        showPrev={showPrev}
        hasPrevVersion={hasPrevVersion}
        prevLabel={prevVersionLabel}
        humanLoading={humanRunning}
        aiLoading={aiRunning}
        prevLoading={prevRunning}
        humanError={humanError}
        aiError={aiError}
        prevError={prevError}
        humanStatus={humanStatus}
        aiStatus={aiStatus}
        prevStatus={prevStatus}
        taskTitle={taskTitle}
        rightControl={rightControl}
        onRunHuman={taskTitle ? () => startRun('human_policy') : undefined}
        onStopHuman={() => stopRun('human')}
        onRunAi={taskTitle ? () => startRun('ai_policy') : undefined}
        onStopAi={() => stopRun('ai')}
        onRunPrev={taskTitle ? () => startPrevRun(prevVersionEndsAt ?? undefined) : undefined}
        onStopPrev={stopPrevRun}
      />
    </div>
  )
}
