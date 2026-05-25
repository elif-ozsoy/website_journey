import { useState } from 'react'
import { useParams } from 'react-router-dom'
import type { Agent } from '../../lib/types'
import { useProjectContext } from '../../context/ProjectContext'
import { useAgentRun } from '../../context/AgentRunContext'
import AgentChip from './AgentCard'
import AddAgentModal from './AddAgentPanel'


export default function AgentGallery({ activeVersionId }: { activeVersionId?: string }) {
  const { siteId } = useParams<{ siteId: string }>()
  const { agents, setAgents, tasks, siteUrl } = useProjectContext()
  const {
    apiKey,
    runState, currentTaskIdx, totalTasks, statusMsg, liveStepCount, progress,
    runningSiteId, runningVersionId,
    startRun, stopRun,
  } = useAgentRun()

  const isThisRun = runningSiteId === siteId && (runningVersionId === (activeVersionId ?? null) || runningVersionId === null)
  const effectiveRunState = isThisRun ? runState : 'idle'

  const [addOpen, setAddOpen] = useState(false)
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null)

  function toggleSelect(id: string) {
    setAgents(agents.map((a) => a.id === id ? { ...a, selected: !a.selected } : a))
  }

  function handleUpdateAgent(updated: Agent) {
    setAgents(agents.map((a) => a.id === updated.id ? updated : a))
    setEditingAgent(null)
  }

  function handleDeleteAgent(id: string) {
    setAgents(agents.filter((a) => a.id !== id))
  }

  function addAgent(agent: Agent) {
    setAgents([...agents, agent])
    setAddOpen(false)
  }

  const selectedCount = agents.filter((a) => a.selected).length
  const canRun = apiKey.trim().length > 0 && tasks.length > 0 && runState !== 'running'

  return (
    <section className="eval-section">
      {/* ── Section header ── */}
      <p className="eval-section-sub" style={{ marginBottom: 12 }}>
        {selectedCount > 0
          ? `${selectedCount} of ${agents.length} agent${agents.length !== 1 ? 's' : ''} selected for evaluation`
          : 'Click an avatar to select agents for evaluation runs.'}
      </p>

      {/* ── Agent chips ── */}
      <div className="agent-rail">
        {agents.map((agent) => (
          <AgentChip
            key={agent.id}
            agent={agent}
            onSelect={() => toggleSelect(agent.id)}
            onEdit={() => setEditingAgent(agent)}
            onDelete={() => handleDeleteAgent(agent.id)}
          />
        ))}
        <div id="agent-add-btn" style={{ display: 'none' }} onClick={() => setAddOpen(true)} />
      </div>

      {/* ── Progress area — only shown when this project+version is running ── */}
      {effectiveRunState !== 'idle' && (
        <div style={{
          marginTop: 16,
          padding: '14px 16px',
          background: 'var(--gray50)',
          border: '1px solid var(--gray200)',
          borderRadius: 10,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: effectiveRunState === 'error' ? 'var(--red)' : effectiveRunState === 'complete' ? 'var(--brand)' : 'var(--gray900)' }}>
              {effectiveRunState === 'complete'
                ? '✓ All tasks complete'
                : effectiveRunState === 'error'
                ? '⚠ Run stopped'
                : `Task ${currentTaskIdx + 1} of ${totalTasks}`}
            </span>
            <span style={{ fontSize: 'var(--fs-body)', color: 'var(--gray400)', fontWeight: 600 }}>{progress}%</span>
          </div>

          <div style={{ height: 5, background: 'var(--gray200)', borderRadius: 3, overflow: 'hidden', marginBottom: 10 }}>
            <div style={{
              height: '100%',
              width: `${progress}%`,
              background: effectiveRunState === 'error' ? 'var(--red)' : 'var(--brand)',
              borderRadius: 3,
              transition: 'width 0.4s ease',
            }} />
          </div>

          {effectiveRunState === 'running' && totalTasks > 1 && tasks[currentTaskIdx] && (
            <div style={{ fontSize: 'var(--fs-small)', color: 'var(--gray400)', marginBottom: 6, fontStyle: 'italic' }}>
              {tasks[currentTaskIdx].title}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%', flexShrink: 0, marginTop: 4,
              background: effectiveRunState === 'error' ? 'var(--red)' : 'var(--brand)',
              animation: effectiveRunState === 'running' ? 'pulse-dot 1.4s ease-in-out infinite' : 'none',
            }} />
            <span style={{ fontSize: 'var(--fs-body)', color: 'var(--gray600)', lineHeight: 1.5 }}>{statusMsg}</span>
          </div>
        </div>
      )}

      <AddAgentModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdd={addAgent}
        existingIds={agents.map((a) => a.id)}
      />

      <AddAgentModal
        open={editingAgent !== null}
        onClose={() => setEditingAgent(null)}
        onUpdate={handleUpdateAgent}
        existingIds={agents.map((a) => a.id).filter(id => id !== editingAgent?.id)}
        initialAgent={editingAgent ?? undefined}
      />
    </section>
  )
}
