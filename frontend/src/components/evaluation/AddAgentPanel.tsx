import { useState, useEffect } from 'react'
import type { Agent } from '../../lib/types'
import { MODEL_OPTIONS } from '../../lib/types'

interface Props {
  open: boolean
  onClose: () => void
  onAdd?: (agent: Agent) => void
  onUpdate?: (agent: Agent) => void
  existingIds: string[]
  initialAgent?: Agent
}

function slugify(name: string, existingIds: string[]) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent'
  let candidate = base
  let i = 2
  while (existingIds.includes(candidate)) { candidate = `${base}-${i++}` }
  return candidate
}

export default function AddAgentModal({ open, onClose, onAdd, onUpdate, existingIds, initialAgent }: Props) {
  const [name, setName] = useState('')
  const [model, setModel] = useState(MODEL_OPTIONS[0].value)
  const [prompt, setPrompt] = useState('')

  useEffect(() => {
    if (open) {
      setName(initialAgent?.name ?? '')
      setModel(initialAgent?.model ?? MODEL_OPTIONS[0].value)
      setPrompt(initialAgent?.prompt ?? '')
    }
  // Intentionally keyed on `open` only: re-running on initial-value identity
  // changes mid-edit would clobber the user's typing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function handleSubmit() {
    const trimmed = name.trim()
    if (!trimmed) return
    if (initialAgent) {
      onUpdate?.({ ...initialAgent, name: trimmed, model, prompt: prompt.trim() })
    } else {
      const agent: Agent = {
        id: slugify(trimmed, existingIds),
        name: trimmed,
        model,
        selected: false,
        prompt: prompt.trim(),
        description: 'Custom agent added by the user.',
      }
      onAdd?.(agent)
    }
  }

  if (!open) return null

  const isEditing = !!initialAgent

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-hdr">
          <div>
            <h3 className="modal-title">{isEditing ? 'Edit agent' : 'New AI Agent'}</h3>
            <p className="modal-sub">Define the agent's identity and system prompt.</p>
          </div>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="modal-field-row">
            <div className="modal-field">
              <label className="label">Name</label>
              <input
                className="input"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Careful Shopper"
              />
            </div>
            <div className="modal-field">
              <label className="label">Model</label>
              <select className="input" value={model} onChange={e => setModel(e.target.value)}>
                <optgroup label="NVIDIA NIM (use nvapi- key)">
                  {MODEL_OPTIONS.filter(m => m.provider === 'nvidia').map(m => (
                    <option key={m.value} value={m.value}>{m.label.replace('  (NVIDIA NIM)', '')}</option>
                  ))}
                </optgroup>
                <optgroup label="Google Gemini (use AIza- key)">
                  {MODEL_OPTIONS.filter(m => m.provider === 'google').map(m => (
                    <option key={m.value} value={m.value}>{m.label.replace('  (Google)', '')}</option>
                  ))}
                </optgroup>
              </select>
            </div>
          </div>
          <div className="modal-field" style={{ marginTop: 12 }}>
            <label className="label">System prompt</label>
            <textarea
              className="input"
              style={{ minHeight: 110, resize: 'vertical' }}
              placeholder="Define the agent's role, tone, and evaluation style."
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={handleSubmit} disabled={!name.trim()}>
            {isEditing ? 'Save changes' : 'Create agent'}
          </button>
        </div>
      </div>
    </div>
  )
}
