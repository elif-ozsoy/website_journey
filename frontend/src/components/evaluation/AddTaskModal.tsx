import { useState, useEffect, useRef } from 'react'
import type { FocusArea, Task } from '../../lib/types'
import { FOCUS_AREA_LABELS } from '../../lib/types'

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (title: string, description: string, focusAreas: FocusArea[]) => Promise<void>
  initialTask?: Task
}

const ALL_FOCUS_AREAS = Object.keys(FOCUS_AREA_LABELS) as FocusArea[]

export default function AddTaskModal({ open, onClose, onSubmit, initialTask }: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [focusAreas, setFocusAreas] = useState<FocusArea[]>([])
  const [saving, setSaving] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setTitle(initialTask?.title ?? '')
      setDescription(initialTask?.description ?? '')
      setFocusAreas(initialTask?.focusAreas ?? [])
      setSaving(false)
      setTimeout(() => titleRef.current?.focus(), 50)
    }
  }, [open])

  if (!open) return null

  function toggleFocus(area: FocusArea) {
    setFocusAreas(prev =>
      prev.includes(area) ? prev.filter(a => a !== area) : [...prev, area]
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    try {
      await onSubmit(title.trim(), description.trim(), focusAreas)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const isEditing = !!initialTask

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{isEditing ? 'Edit task' : 'New task'}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          <div className="modal-field">
            <label className="modal-label">Task description</label>
            <input
              ref={titleRef}
              className="modal-input"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Find the return policy before adding to cart"
              required
            />
          </div>

          <div className="modal-field">
            <label className="modal-label">Side remarks <span className="modal-label-hint">(optional)</span></label>
            <textarea
              className="modal-input modal-textarea"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Any context for testers or agents about this task…"
              rows={3}
            />
          </div>

          <div className="modal-field">
            <label className="modal-label">What to look out for <span className="modal-label-hint">(optional)</span></label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              {ALL_FOCUS_AREAS.map(area => {
                const active = focusAreas.includes(area)
                return (
                  <button
                    key={area}
                    type="button"
                    onClick={() => toggleFocus(area)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 7,
                      padding: '7px 10px',
                      border: '1.5px solid',
                      borderColor: active ? 'var(--accent)' : 'var(--gray200)',
                      borderLeft: active ? '3px solid var(--accent)' : '3px solid transparent',
                      borderRadius: 5,
                      background: active ? 'var(--brand-pale)' : 'var(--gray50)',
                      cursor: 'pointer',
                      transition: 'all 0.13s',
                      textAlign: 'left',
                    }}
                  >
                    <span style={{
                      width: 13, height: 13, borderRadius: 3, flexShrink: 0,
                      border: '1.5px solid',
                      borderColor: active ? 'var(--accent)' : 'var(--gray300)',
                      background: active ? 'var(--accent)' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {active && (
                        <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1.5 5l2.5 2.5 5-5"/>
                        </svg>
                      )}
                    </span>
                    <span style={{ fontSize: 'var(--fs-body)', fontWeight: 600, color: active ? 'var(--accent)' : 'var(--gray600)', letterSpacing: '0.01em' }}>
                      {FOCUS_AREA_LABELS[area]}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving || !title.trim()}>
              {saving ? (isEditing ? 'Saving…' : 'Adding…') : (isEditing ? 'Save changes' : 'Add task')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
