import { useRef, useEffect } from 'react'
import type { Agent } from '../../lib/types'
import { AVAILABLE_MODELS } from '../../lib/types'
import clsx from 'clsx'

interface Props {
  agent: Agent | null
  onClose: () => void
  onUpdate: (agent: Agent) => void
}

export default function AgentDetailModal({ agent, onClose, onUpdate }: Props) {
  const promptRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (agent) setTimeout(() => promptRef.current?.focus(), 50)
  }, [agent])

  if (!agent) return null

  function savePrompt() {
    if (agent && promptRef.current) {
      onUpdate({ ...agent, prompt: promptRef.current.value })
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-hdr">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="agent-detail-avatar">{agent.name.charAt(0).toUpperCase()}</div>
            <div>
              <h3 className="modal-title">{agent.name}</h3>
              <p className="modal-sub">{agent.description ?? 'Custom agent for UX evaluation.'}</p>
            </div>
          </div>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="modal-field-row">
            <div className="modal-field">
              <label className="label">Model</label>
              <select
                className="input"
                value={agent.model}
                onChange={(e) => onUpdate({ ...agent, model: e.target.value })}
              >
                {AVAILABLE_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="modal-field" style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
              <button
                className={clsx('btn btn-sm', agent.selected ? 'btn-primary' : 'btn-outline')}
                style={{ flex: 1 }}
                onClick={() => onUpdate({ ...agent, selected: !agent.selected })}
              >
                {agent.selected ? '✓ Selected for runs' : 'Add to runs'}
              </button>
            </div>
          </div>
          <div className="modal-field" style={{ marginTop: 12 }}>
            <label className="label">System prompt</label>
            <textarea
              ref={promptRef}
              className="input"
              style={{ minHeight: 130, resize: 'vertical' }}
              defaultValue={agent.prompt}
              onBlur={savePrompt}
              placeholder="Define the agent's role, tone, and evaluation style."
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
