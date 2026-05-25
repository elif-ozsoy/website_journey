import { useState, useEffect, useRef, useCallback } from 'react'
import * as api from '../../lib/api'
import type { AgentStep } from '../agent/agentTypes'
import SideBySideFlowMap from './SideBySideFlowMap'

// ─── Props ────────────────────────────────────────────────────────────

export interface AggregateFlowViewProps {
  siteId: string
  siteUrl: string
  taskTitle: string | null
  taskId?: number
}

// ─── WS helpers (same pattern as PolicyBotTab) ────────────────────────

function wsUrl(): string {
  const agentUrl = import.meta.env.VITE_AGENT_URL ?? import.meta.env.VITE_BACKEND_URL ?? window.location.origin
  const proto = agentUrl.startsWith('https') ? 'wss' : 'ws'
  const host = agentUrl.replace(/^https?:\/\//, '')
  return `${proto}://${host}/ws/run`
}

const PROVIDER_KEY = 'ciphercorgi_provider'
const APIKEY_KEY = 'ciphercorgi_apikey'

// ─── Main component ───────────────────────────────────────────────────

/**
 * AggregateFlowView displays a side-by-side comparison of:
 * - Left:  Policy bot run guided by aggregated HUMAN decisions
 * - Right: Policy bot run guided by aggregated AI decisions
 *
 * Both sides can be triggered directly from this component via the WS
 * endpoint. Completed runs are persisted with source='policy_bot_human'
 * and source='policy_bot_ai' respectively.
 */
export default function AggregateFlowView({ siteId, siteUrl, taskTitle, taskId }: AggregateFlowViewProps) {
  const [humanFlow, setHumanFlow] = useState<AgentStep[] | null>(null)
  const [aiFlow, setAiFlow] = useState<AgentStep[] | null>(null)
  const [humanLoading, setHumanLoading] = useState(true)
  const [aiLoading, setAiLoading] = useState(true)
  const [humanError, setHumanError] = useState<string | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [humanRunning, setHumanRunning] = useState(false)
  const [aiRunning, setAiRunning] = useState(false)
  const [humanStatus, setHumanStatus] = useState('')
  const [aiStatus, setAiStatus] = useState('')

  const humanWsRef = useRef<WebSocket | null>(null)
  const aiWsRef = useRef<WebSocket | null>(null)

  // ── Load persisted policy bot journeys on mount ──────────────────────
  useEffect(() => {
    const loadSide = (
      source: string,
      setFlow: (s: AgentStep[] | null) => void,
      setErr: (s: string | null) => void,
      setLoading: (b: boolean) => void,
    ) => {
      api.listSiteJourneys(siteId, source)
        .then(journeys => {
          const match = taskId != null
            ? journeys.find(j => j.task_id === taskId)
            : journeys[0]
          if (match?.steps && Array.isArray(match.steps) && match.steps.length > 0) {
            setFlow(match.steps as AgentStep[])
          } else {
            setErr(null) // no data yet — show the "run" prompt instead
          }
        })
        .catch(() => setErr(null))
        .finally(() => setLoading(false))
    }

    loadSide('policy_bot_human', setHumanFlow, setHumanError, setHumanLoading)
    loadSide('policy_bot_ai', setAiFlow, setAiError, setAiLoading)
  }, [siteId, taskId])

  // ── Trigger a policy bot run via WebSocket ───────────────────────────
  const startRun = useCallback((runMode: 'human_policy' | 'ai_policy') => {
    const isHuman = runMode === 'human_policy'
    const wsRef = isHuman ? humanWsRef : aiWsRef
    if (wsRef.current) return // already running
    if (!taskTitle) return

    const provider = (localStorage.getItem(PROVIDER_KEY) ?? 'nvidia') as string
    const apiKey = localStorage.getItem(APIKEY_KEY) ?? ''
    const userToken = localStorage.getItem('ciphercorgi_token') ?? ''

    const setRunning = isHuman ? setHumanRunning : setAiRunning
    const setStatus = isHuman ? setHumanStatus : setAiStatus
    const setFlow = isHuman ? setHumanFlow : setAiFlow
    const setErr = isHuman ? setHumanError : setAiError

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

    ws.onmessage = (evt) => {
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

  const stopRun = useCallback((side: 'human' | 'ai') => {
    const ws = side === 'human' ? humanWsRef.current : aiWsRef.current
    ws?.close()
  }, [])

  // Clean up on unmount
  useEffect(() => () => {
    humanWsRef.current?.close()
    aiWsRef.current?.close()
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
      <SideBySideFlowMap
        humanPolicyFlow={humanFlow}
        aiPolicyFlow={aiFlow}
        humanLoading={humanRunning}
        aiLoading={aiRunning}
        humanError={humanError}
        aiError={aiError}
        humanStatus={humanStatus}
        aiStatus={aiStatus}
        taskTitle={taskTitle}
        onRunHuman={taskTitle ? () => startRun('human_policy') : undefined}
        onRunAi={taskTitle ? () => startRun('ai_policy') : undefined}
        onStopHuman={() => stopRun('human')}
        onStopAi={() => stopRun('ai')}
      />
    </div>
  )
}
