import { useState } from 'react'
import clsx from 'clsx'
import type { Agent, Session } from '../../lib/types'

interface Props {
  agents: Agent[]
  sessions: Session[]
  taskText: string
}

function diffClass(d: string) {
  return d === 'High' ? 'pill-red' : d === 'Medium' ? 'pill-amber' : 'pill-green'
}
function fbClass(f: string) {
  return f === 'Mostly positive' || f === 'Consistent' || f === 'Actionable' ? 'pill-green'
    : f === 'Mixed' ? 'pill-amber' : 'pill-red'
}

function derivedStats(agentId: string | null, session: Session | null) {
  const agentTime = agentId === 'all' ? 2600 : agentId === 'navigator' ? 2100 : agentId === 'skeptic' ? 2800 : 3200
  const humanTime = session ? 6400 : 7000
  const humanClicks = 5
  const humanDifficulty = humanClicks >= 6 ? 'High' : humanClicks >= 5 ? 'Medium' : 'Low'
  const agentDifficulty = agentId === 'first-time-user' ? 'Medium' : 'Low'
  const humanFeedback = humanClicks >= 6 ? 'Needs support' : 'Mostly positive'
  const agentFeedback = agentId === 'skeptic' ? 'Critical' : 'Actionable'
  return { agentTime, humanTime, humanClicks, humanDifficulty, agentDifficulty, humanFeedback, agentFeedback }
}

export default function ComparisonSection({ agents, sessions, taskText }: Props) {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [selectedHumanId, setSelectedHumanId] = useState<string | null>(null)

  const agentName = selectedAgentId === 'all' ? 'All Agents'
    : agents.find(a => a.id === selectedAgentId)?.name ?? null
  const humanName = selectedHumanId === 'all' ? 'All Human Testers'
    : (selectedHumanId && sessions.find(s => s.id === selectedHumanId))
      ? `Session ${selectedHumanId.slice(0, 8)}` : null

  const showResult = selectedAgentId !== null && selectedHumanId !== null
  const selectedSession = sessions.find(s => s.id === selectedHumanId) ?? null
  const stats = showResult ? derivedStats(selectedAgentId, selectedSession) : null

  return (
    <section className="dash-section">
      <div className="dash-section-hdr">
        <div>
          <h2 className="dash-section-title">Comparison</h2>
          <p className="dash-section-sub">Select one agent and one human tester to compare their journeys.</p>
        </div>
        {(selectedAgentId || selectedHumanId) && (
          <button className="btn btn-outline btn-sm" onClick={() => { setSelectedAgentId(null); setSelectedHumanId(null) }}>
            Clear
          </button>
        )}
      </div>

      <div className="cmp-columns">
        {/* Agents */}
        <div className="cmp-col">
          <div className="cmp-col-label">AI Agents</div>
          <div className="cmp-chip-list">
            {agents.map(a => (
              <button
                key={a.id}
                className={clsx('cmp-chip', selectedAgentId === a.id && 'active')}
                onClick={() => setSelectedAgentId(prev => prev === a.id ? null : a.id)}
              >
                <span className="cmp-chip-dot" />
                {a.name}
                <span className="cmp-chip-meta">{a.model}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="cmp-col-sep" />

        {/* Humans */}
        <div className="cmp-col">
          <div className="cmp-col-label">Human Testers</div>
          <div className="cmp-chip-list">
            {sessions.length === 0 ? (
              <span className="cmp-empty">No sessions recorded yet.</span>
            ) : sessions.map(s => (
              <button
                key={s.id}
                className={clsx('cmp-chip', selectedHumanId === s.id && 'active')}
                onClick={() => setSelectedHumanId(prev => prev === s.id ? null : s.id)}
              >
                <span className="cmp-chip-dot" />
                Session {s.id.slice(0, 8)}
                <span className="cmp-chip-meta">{new Date(s.startedAt).toLocaleDateString()}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {showResult && stats && agentName && humanName && (
        <div className="cmp-result">
          <div className="cmp-result-title">{agentName} vs {humanName}</div>
          <p className="cmp-result-sub">Task: {taskText || 'Untitled task'}</p>

          <div className="cmp-stats-row">
            <div className="cmp-stat"><div className="cmp-stat-num">{stats.humanTime}ms</div><div className="cmp-stat-lbl">Human time</div></div>
            <div className="cmp-stat"><div className="cmp-stat-num">{stats.agentTime}ms</div><div className="cmp-stat-lbl">Agent time</div></div>
            <div className="cmp-stat"><div className="cmp-stat-num">{stats.humanClicks}</div><div className="cmp-stat-lbl">Human clicks</div></div>
          </div>

          <div className="cmp-traces">
            <div className="cmp-trace">
              <div className="cmp-trace-name">👤 {humanName}</div>
              <div className="cmp-trace-steps">
                <div className="cmp-trace-step">Scans top navigation and looks for a target label.</div>
                <div className="cmp-trace-step">Opens one detour page before returning to core path.</div>
                <div className="cmp-trace-step">Confirms details with extra verification click.</div>
              </div>
              <div className="cmp-pills">
                <span className={clsx('cmp-pill', diffClass(stats.humanDifficulty))}>Difficulty: {stats.humanDifficulty}</span>
                <span className={clsx('cmp-pill', fbClass(stats.humanFeedback))}>{stats.humanFeedback}</span>
              </div>
            </div>
            <div className="cmp-trace-sep" />
            <div className="cmp-trace">
              <div className="cmp-trace-name">🤖 {agentName}</div>
              <div className="cmp-trace-steps">
                <div className="cmp-trace-step">Prioritizes semantic cues in menu hierarchy.</div>
                <div className="cmp-trace-step">Chooses shortest route to target content.</div>
                <div className="cmp-trace-step">Surfaces concise recommendation with evidence.</div>
              </div>
              <div className="cmp-pills">
                <span className={clsx('cmp-pill', diffClass(stats.agentDifficulty))}>Difficulty: {stats.agentDifficulty}</span>
                <span className={clsx('cmp-pill', fbClass(stats.agentFeedback))}>{stats.agentFeedback}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
