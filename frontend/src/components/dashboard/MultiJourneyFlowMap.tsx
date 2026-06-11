import FlowMap from '../agent/FlowMap'
import type { AgentStep } from '../agent/agentTypes'
import type { Agent, Session } from '../../lib/types'
import type { JourneyResponse } from '../../lib/api'

interface Props {
  agentJourneys: JourneyResponse[]
  humanSessionSteps: Map<string, AgentStep[]>
  agents: Agent[]
  sessions: Session[]
}

interface Lane {
  label: string
  meta: string
  kind: 'agent' | 'human'
  steps: AgentStep[]
}

export default function MultiJourneyFlowMap({ agentJourneys, humanSessionSteps, agents, sessions }: Props) {
  const lanes: Lane[] = [
    ...agentJourneys.map(j => ({
      label: agents.find(a => a.id === j.user_id)?.name ?? `Agent Run #${j.id}`,
      meta: `${j.total_steps} step${j.total_steps !== 1 ? 's' : ''} · ${j.task_title}`,
      kind: 'agent' as const,
      steps: j.steps as AgentStep[],
    })),
    ...[...humanSessionSteps.entries()].map(([sessionId, steps]) => {
      const session = sessions.find(s => s.id === sessionId)
      const dateStr = session ? new Date(session.startedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''
      return {
        label: `Session ${sessionId.slice(0, 6)}`,
        meta: `${steps.length} step${steps.length !== 1 ? 's' : ''}${dateStr ? ' · ' + dateStr : ''}`,
        kind: 'human' as const,
        steps,
      }
    }),
  ]

  if (lanes.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--gray400)', fontSize: 'var(--fs-body)', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 'var(--fs-headline)' }}>↔</span>
        No journeys to compare.
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '10px 16px 6px', borderBottom: '1px solid var(--gray100)', display: 'flex', alignItems: 'center', gap: 16 }}>
        <span style={{ fontSize: 'var(--fs-small)', fontWeight: 700, color: 'var(--gray400)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          All Flows — {lanes.length} journey{lanes.length !== 1 ? 's' : ''}
        </span>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 'var(--fs-small)', color: '#0072B2' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#0072B2', display: 'inline-block' }} />
            Agent
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 'var(--fs-small)', color: '#E69F00' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#E69F00', display: 'inline-block' }} />
            Human
          </span>
        </span>
      </div>

      {lanes.map((lane, i) => {
        const isAgent = lane.kind === 'agent'
        const dotColor = isAgent ? '#0072B2' : '#E69F00'
        const bgTint = isAgent ? 'rgba(0,114,178,0.04)' : 'rgba(230,159,0,0.04)'

        return (
          <div
            key={i}
            style={{ display: 'flex', borderBottom: '1px solid var(--gray100)', minHeight: 270 }}
          >
            {/* Lane label strip */}
            <div style={{
              width: 148,
              flexShrink: 0,
              padding: '14px 12px',
              borderRight: '1px solid var(--gray100)',
              background: bgTint,
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
            }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, display: 'inline-block', flexShrink: 0 }} />
              <span style={{ fontSize: 'var(--fs-small)', fontWeight: 700, color: 'var(--gray700)', lineHeight: 1.35, wordBreak: 'break-all' }}>
                {lane.label}
              </span>
              <span style={{ fontSize: 'var(--fs-small)', color: 'var(--gray400)', lineHeight: 1.4 }}>{lane.meta}</span>
            </div>

            {/* FlowMap for this lane */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {lane.steps.length > 0 ? (
                <FlowMap steps={lane.steps} containerHeight="260px" />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 260, color: 'var(--gray400)', fontSize: 'var(--fs-body)' }}>
                  No steps recorded
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
