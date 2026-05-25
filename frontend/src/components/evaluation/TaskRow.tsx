import { useState } from 'react'
import type { Task } from '../../lib/types'
import { FOCUS_AREA_LABELS } from '../../lib/types'
import * as api from '../../lib/api'

interface Props {
  task: Task
  index: number
  onDelete: (id: number) => void
  onUpdate: (task: Task) => void
  onEdit: (task: Task) => void
  onDragStart: (index: number) => void
  onDragOver: (index: number) => void
  onDrop: () => void
  dragging: boolean
  dragOver: boolean
}

export default function TaskRow({ task, index, onDelete, onUpdate: _onUpdate, onEdit, onDragStart, onDragOver, onDrop, dragging, dragOver }: Props) {
  const [hovered, setHovered] = useState(false)

  async function handleDelete() {
    try {
      await api.deleteTask(task.id)
      onDelete(task.id)
    } catch { /* ignore */ }
  }

  return (
    <div
      className="task-row-flat"
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={e => { e.preventDefault(); onDragOver(index) }}
      onDrop={onDrop}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        opacity: dragging ? 0.4 : 1,
        borderColor: dragOver ? 'var(--brand)' : undefined,
        cursor: 'grab',
      }}
    >
      <div className="task-row-num">{index + 1}</div>

      <div className="task-row-body">
        <span className="task-row-title">{task.title}</span>

        {task.description && (
          <p className="task-row-desc">{task.description}</p>
        )}

        {task.focusAreas && task.focusAreas.length > 0 && (
          <div className="task-row-focus-chips">
            {task.focusAreas.map(area => (
              <span key={area} className="focus-chip focus-chip-sm">{FOCUS_AREA_LABELS[area]}</span>
            ))}
          </div>
        )}
      </div>

      <div className="task-row-actions" style={{ opacity: hovered ? 1 : 0 }}>
        <button className="task-edit-btn" onClick={() => onEdit(task)} title="Edit task">Edit</button>
        <button className="task-delete-btn" onClick={handleDelete} title="Delete task">✕</button>
      </div>
    </div>
  )
}
