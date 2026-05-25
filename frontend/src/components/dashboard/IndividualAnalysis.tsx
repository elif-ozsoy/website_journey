import { useState } from 'react'
import clsx from 'clsx'
import type { Agent, Session } from '../../lib/types'

interface Props {
  agents: Agent[]
  sessions: Session[]
  taskText: string
}

type Mode = 'agent' | 'human'

const AGENT_TRACE = [
  'Parses navigation labels and prioritizes likely entry points.',
  'Follows shortest path to target task content with minimal detours.',
  'Generates concise evidence-based recommendations for UX fixes.',
]
const HUMAN_TRACE = [
  'Scans primary navigation and visible CTA labels before acting.',
  'Explores one alternate path when confidence is low.',
  'Confirms task completion after checking detail-level information.',
]

function diffClass(d: string) { return d === 'High' ? 'pill-red' : d === 'Medium' ? 'pill-amber' : 'pill-green' }
function fbClass(f: string) {
  return f === 'Actionable' || f === 'Mostly positive' ? 'pill-green' : f === 'Mixed' ? 'pill-amber' : 'pill-red'
}

export default function IndividualAnalysis({ agents, sessions, taskText }: Props) {
  const [mode, setMode] = useState<Mode>('agent')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  function handleModeChange(m: Mode) { setMode(m); setSelectedId(null) }

  const items = mode === 'agent'
    ? agents.map(a => ({ id: a.id, title: a.name, sub: a.model }))
    : sessions.map(s => ({
        id: s.id,
        title: `Session ${s.id.slice(0, 8)}`,
        sub: new Date(s.startedAt).toLocaleDateString(),
      }))

  const isAgent = mode === 'agent'
  const entity = isAgent
    ? agents.find(a => a.id === selectedId)
    : sessions.find(s => s.id === selectedId)

  const agentEntity = isAgent && entity ? (entity as Agent) : null
  const title = agentEntity ? agentEntity.name : entity ? `Session ${(entity as Session).id.slice(0, 8)}` : null
  const duration = agentEntity
    ? `${agentEntity.id === 'navigator' ? '2.1' : agentEntity.id === 'skeptic' ? '2.8' : '3.2'}s`
    : entity ? '6.4s' : '-'
  const clicks = agentEntity
    ? (agentEntity.id === 'navigator' ? 2 : agentEntity.id === 'skeptic' ? 3 : 4)
    : 5
  const difficulty = isAgent ? (agentEntity?.id === 'first-time-user' ? 'Medium' : 'Low')
    : (clicks >= 6 ? 'High' : clicks >= 5 ? 'Medium' : 'Low')
  const feedback = isAgent ? (agentEntity?.id === 'skeptic' ? 'Critical' : 'Actionable')
    : (clicks >= 6 ? 'Needs support' : 'Mostly positive')
  const traceSteps = isAgent ? AGENT_TRACE : HUMAN_TRACE

  return (
    <section className="dash-section" style={{ borderBottom: 'none' }}>
      <div className="dash-section-hdr">
        <div>
          <h2 className="dash-section-title">Individual Analysis</h2>
          <p className="dash-section-sub">Drill into a single agent or tester's journey for this task.</p>
        </div>
        <div className="dash-mode-toggle">
          <button className={clsx('dash-mode-btn', mode === 'agent' && 'active')} onClick={() => handleModeChange('agent')}>Agents</button>
          <button className={clsx('dash-mode-btn', mode === 'human' && 'active')} onClick={() => handleModeChange('human')}>Human Testers</button>
        </div>
      </div>

      <div className="cmp-chip-list">
        {items.length === 0 ? (
          <span className="cmp-empty">{mode === 'human' ? 'No sessions recorded yet.' : 'No agents configured.'}</span>
        ) : items.map(item => (
          <button
            key={item.id}
            className={clsx('cmp-chip', selectedId === item.id && 'active')}
            onClick={() => setSelectedId(prev => prev === item.id ? null : item.id)}
          >
            <span className="cmp-chip-dot" />
            {item.title}
            <span className="cmp-chip-meta">{item.sub}</span>
          </button>
        ))}
      </div>

      {selectedId && entity && title && (
        <div className="cmp-result" style={{ marginTop: 20 }}>
          <div className="cmp-result-title">{title}</div>
          <p className="cmp-result-sub">{isAgent ? 'Agent analysis' : 'Human tester analysis'} · {taskText || 'Untitled task'}</p>

          <div className="cmp-stats-row">
            <div className="cmp-stat"><div className="cmp-stat-num">{duration}</div><div className="cmp-stat-lbl">Duration</div></div>
            <div className="cmp-stat"><div className="cmp-stat-num">{clicks}</div><div className="cmp-stat-lbl">Clicks</div></div>
            <div className="cmp-stat"><div className="cmp-stat-num">{isAgent ? agentEntity?.model ?? 'Ours' : 'Human'}</div><div className="cmp-stat-lbl">Profile</div></div>
          </div>

          <div className="cmp-trace" style={{ marginTop: 12 }}>
            <div className="cmp-trace-steps">
              {traceSteps.map((step, i) => (
                <div key={i} className="cmp-trace-step">{i + 1}. {step}</div>
              ))}
            </div>
            <div className="cmp-pills" style={{ marginTop: 10 }}>
              <span className={clsx('cmp-pill', diffClass(difficulty))}>Difficulty: {difficulty}</span>
              <span className={clsx('cmp-pill', fbClass(feedback))}>{feedback}</span>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
