import { useRef } from 'react'
import type { AgentStep } from '../agent/agentTypes'
import FlowMap from '../agent/FlowMap'

interface Props {
  humanPolicyFlow: AgentStep[] | null
  aiPolicyFlow: AgentStep[] | null
  humanLoading?: boolean
  aiLoading?: boolean
  humanError?: string | null
  aiError?: string | null
  humanStatus?: string
  aiStatus?: string
  taskTitle?: string | null
  onRunHuman?: () => void
  onRunAi?: () => void
  onStopHuman?: () => void
  onStopAi?: () => void
}

/**
 * Displays two FlowMaps side-by-side:
 * - Left: Policy bot run with human-derived policy injected
 * - Right: Policy bot run with AI-derived policy injected
 *
 * Both use the same FlowMap visualization with arrows, retries, loops, etc.
 */
export default function SideBySideFlowMap({
  humanPolicyFlow,
  aiPolicyFlow,
  humanLoading = false,
  aiLoading = false,
  humanError = null,
  aiError = null,
  humanStatus = '',
  aiStatus = '',
  taskTitle = null,
  onRunHuman,
  onRunAi,
  onStopHuman,
  onStopAi,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={containerRef}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1px 1fr',
        height: '100%',
        overflow: 'hidden',
        gap: 0,
        background: '#fff',
      }}
    >
      {/* ── Human Policy Bot Flow (Left) ── */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {/* Header */}
        <div
          style={{
            padding: '10px 16px',
            background: '#ecfdf5',
            borderBottom: '2px solid #10b981',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <div>
            <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: '#0d9488' }}>
              Policy Bot — Human Policy
            </div>
            <div style={{ fontSize: 'var(--fs-small)', color: 'var(--text-muted)', marginTop: 2 }}>
              Agent guided by aggregated human decisions
            </div>
          </div>
          {humanLoading ? (
            <button
              onClick={onStopHuman}
              style={{ fontSize: 'var(--fs-small)', padding: '4px 10px', borderRadius: 6, border: '1px solid #10b981', background: 'transparent', color: '#0d9488', cursor: 'pointer' }}
            >
              Stop
            </button>
          ) : onRunHuman && (
            <button
              onClick={onRunHuman}
              disabled={!taskTitle}
              style={{ fontSize: 'var(--fs-small)', padding: '4px 10px', borderRadius: 6, border: 'none', background: '#10b981', color: '#fff', cursor: taskTitle ? 'pointer' : 'not-allowed', opacity: taskTitle ? 1 : 0.5 }}
            >
              {humanPolicyFlow ? 'Re-run' : 'Run'}
            </button>
          )}
        </div>

        {/* Flow visualization or loading/error state */}
        <div style={{ flex: 1, overflow: 'hidden', background: 'var(--bg)' }}>
          {humanError ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                gap: 8,
                height: '100%',
                color: 'var(--text-muted)',
              }}
            >
              <span style={{ fontSize: 'var(--fs-headline)' }}>⚠</span>
              <div style={{ fontSize: 'var(--fs-body)', textAlign: 'center', maxWidth: 200 }}>{humanError}</div>
            </div>
          ) : humanLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
              {humanStatus && (
                <div style={{ padding: '8px 16px', fontSize: 'var(--fs-small)', color: '#0d9488', background: '#f0fdf4', borderBottom: '1px solid #d1fae5', flexShrink: 0 }}>
                  {humanStatus}
                </div>
              )}
              {humanPolicyFlow && humanPolicyFlow.length > 0
                ? <FlowMap steps={humanPolicyFlow} containerHeight="100%" />
                : (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 'var(--fs-body)' }}>
                    Running policy bot with human policy…
                  </div>
                )
              }
            </div>
          ) : humanPolicyFlow && humanPolicyFlow.length > 0 ? (
            <FlowMap steps={humanPolicyFlow} containerHeight="100%" />
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                gap: 10,
                height: '100%',
                color: 'var(--text-muted)',
              }}
            >
              <div style={{ fontSize: 'var(--fs-body)', fontWeight: 600, color: 'var(--text-secondary)' }}>No run yet</div>
              <div style={{ fontSize: 'var(--fs-small)', textAlign: 'center', maxWidth: 220, lineHeight: 1.5 }}>
                Click <strong>Run</strong> to launch a browser-use agent guided by the human behavioral policy extracted from recorded sessions.
              </div>
              {onRunHuman && taskTitle && (
                <button
                  onClick={onRunHuman}
                  style={{ marginTop: 4, fontSize: 'var(--fs-body)', padding: '6px 18px', borderRadius: 8, border: 'none', background: '#10b981', color: '#fff', cursor: 'pointer', fontWeight: 600 }}
                >
                  Run Human Policy Bot
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Divider ── */}
      <div style={{ background: 'var(--border)' }} />

      {/* ── AI Policy Bot Flow (Right) ── */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {/* Header */}
        <div
          style={{
            padding: '10px 16px',
            background: 'var(--brand-pale)',
            borderBottom: '2px solid var(--accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <div>
            <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--brand)' }}>
              Policy Bot — AI Policy
            </div>
            <div style={{ fontSize: 'var(--fs-small)', color: 'var(--text-muted)', marginTop: 2 }}>
              Agent guided by aggregated AI agent decisions
            </div>
          </div>
          {aiLoading ? (
            <button
              onClick={onStopAi}
              style={{ fontSize: 'var(--fs-small)', padding: '4px 10px', borderRadius: 6, border: '1px solid var(--accent)', background: 'transparent', color: 'var(--brand)', cursor: 'pointer' }}
            >
              Stop
            </button>
          ) : onRunAi && (
            <button
              onClick={onRunAi}
              disabled={!taskTitle}
              style={{ fontSize: 'var(--fs-small)', padding: '4px 10px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', cursor: taskTitle ? 'pointer' : 'not-allowed', opacity: taskTitle ? 1 : 0.5 }}
            >
              {aiPolicyFlow ? 'Re-run' : 'Run'}
            </button>
          )}
        </div>

        {/* Flow visualization or loading/error state */}
        <div style={{ flex: 1, overflow: 'hidden', background: 'var(--bg)' }}>
          {aiError ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                gap: 8,
                height: '100%',
                color: 'var(--text-muted)',
              }}
            >
              <span style={{ fontSize: 'var(--fs-headline)' }}>⚠</span>
              <div style={{ fontSize: 'var(--fs-body)', textAlign: 'center', maxWidth: 200 }}>{aiError}</div>
            </div>
          ) : aiLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
              {aiStatus && (
                <div style={{ padding: '8px 16px', fontSize: 'var(--fs-small)', color: 'var(--brand)', background: 'var(--brand-pale)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                  {aiStatus}
                </div>
              )}
              {aiPolicyFlow && aiPolicyFlow.length > 0
                ? <FlowMap steps={aiPolicyFlow} containerHeight="100%" />
                : (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 'var(--fs-body)' }}>
                    Running policy bot with AI policy…
                  </div>
                )
              }
            </div>
          ) : aiPolicyFlow && aiPolicyFlow.length > 0 ? (
            <FlowMap steps={aiPolicyFlow} containerHeight="100%" />
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                gap: 10,
                height: '100%',
                color: 'var(--text-muted)',
              }}
            >
              <div style={{ fontSize: 'var(--fs-body)', fontWeight: 600, color: 'var(--text-secondary)' }}>No run yet</div>
              <div style={{ fontSize: 'var(--fs-small)', textAlign: 'center', maxWidth: 220, lineHeight: 1.5 }}>
                Click <strong>Run</strong> to launch a browser-use agent guided by the behavioral policy extracted from previous AI agent journeys.
              </div>
              {onRunAi && taskTitle && (
                <button
                  onClick={onRunAi}
                  style={{ marginTop: 4, fontSize: 'var(--fs-body)', padding: '6px 18px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontWeight: 600 }}
                >
                  Run AI Policy Bot
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
