import type { Agent } from '../../lib/types'
import clsx from 'clsx'

interface Props {
  agent: Agent
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
}

const ICONS: Record<string, JSX.Element> = {
  navigator: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="3 11 22 2 13 21 11 13 3 11"/>
    </svg>
  ),
  skeptic: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  ),
  'first-time-user': (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
    </svg>
  ),
}

function getIcon(id: string, name: string): JSX.Element {
  if (ICONS[id]) return ICONS[id]
  return <span style={{ fontSize: 'var(--fs-body)', fontWeight: 800 }}>{name.charAt(0).toUpperCase()}</span>
}

export default function AgentChip({ agent, onSelect, onEdit, onDelete }: Props) {
  return (
    <div className={clsx('agent-chip', agent.selected && 'selected')} title={agent.name}>
      <button
        className="agent-chip-avatar"
        onClick={onSelect}
        title={`${agent.selected ? 'Deselect' : 'Select'} ${agent.name}`}
      >
        {getIcon(agent.id, agent.name)}
        {agent.selected && <span className="agent-chip-check">✓</span>}
      </button>
      <span className="agent-chip-name">{agent.name}</span>
      <div className="agent-chip-actions">
        <button className="agent-chip-action-btn" onClick={onEdit} title="Edit agent">Edit</button>
        <button className="agent-chip-action-btn delete" onClick={onDelete} title="Remove agent">✕</button>
      </div>
    </div>
  )
}
