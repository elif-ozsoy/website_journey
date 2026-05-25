import React, { useState, forwardRef, useImperativeHandle } from 'react'
import { useParams } from 'react-router-dom'
import type { Task, FocusArea, Project } from '../../lib/types'
import { PROJECTS_STORAGE_KEY } from '../../lib/types'
import { useProjectContext } from '../../context/ProjectContext'
import * as api from '../../lib/api'
import TaskRow from './TaskRow'
import AddTaskModal from './AddTaskModal'

export interface TaskListHandle {
  generate: () => Promise<void>
  openAddModal: () => void
  generating: boolean
}

// ─── Context-aware task bank ──────────────────────────────────────────────────

const TASK_BANK: Record<string, string[]> = {
  'E-commerce store': [
    'Find the return policy before adding anything to the cart.',
    'Compare two products side-by-side without starting checkout.',
    'Locate shipping cost information before entering payment details.',
    'Search for a specific product and apply a category filter.',
    'Complete the checkout flow from cart to order confirmation.',
    'Find a discount or promo code input during checkout.',
    'Navigate from the homepage to a product page in under 3 clicks.',
    'Find customer reviews or ratings for a product.',
    'Locate the size guide or measurement chart.',
    'Find out how long delivery takes without starting a purchase.',
  ],
  'SaaS / Web app': [
    'Sign up for a free trial without entering payment details.',
    'Find the pricing page and identify the difference between plans.',
    'Locate the documentation or help centre from the main navigation.',
    'Navigate from the homepage to a specific feature page.',
    'Identify where to contact support without using search.',
    'Find where to manage billing or upgrade a subscription.',
    'Discover the key differentiator between Basic and Pro tiers.',
    'Find an integration or API reference page.',
    'Locate the changelog or release notes.',
  ],
  'Marketing / Landing page': [
    'Find the primary call-to-action without scrolling.',
    'Locate a contact form or email address.',
    'Identify the core value proposition in under 10 seconds.',
    'Find social proof — testimonials or logos — on the page.',
    'Locate pricing or cost information.',
    'Find a demo or trial sign-up link.',
  ],
  'Portfolio / Agency': [
    'Find past client work or case studies.',
    'Locate the contact page and find an email address.',
    'Identify the services offered and their scope.',
    'Find the team or about page.',
    'Request a quote or proposal.',
  ],
  'News / Blog': [
    'Find an article about a specific topic using search.',
    'Locate the most recent article in a category.',
    'Find the newsletter sign-up form.',
    'Navigate from an article back to the homepage.',
    'Find the author bio for a given article.',
  ],
  'Local business': [
    'Find the opening hours and physical address.',
    'Locate a phone number or contact form to make an enquiry.',
    'Find the list of services and their pricing.',
    'Book an appointment or request a quote.',
    'Find customer reviews or testimonials.',
    'Get directions from the website.',
  ],
  'Non-profit': [
    'Find how to donate and complete the donation flow.',
    'Locate volunteer opportunities or how to get involved.',
    'Find the organisation\'s mission and impact statement.',
    'Sign up for a newsletter or campaign updates.',
    'Find annual reports or financial transparency information.',
  ],
  'Other': [
    'Find the most important information on the homepage in under 30 seconds.',
    'Locate contact information without using search.',
    'Complete the primary action the site was designed for.',
    'Navigate to the most relevant section for a first-time visitor.',
    'Find help or FAQ content from the main navigation.',
  ],
}

function pickGeneratedTask(project: Project | undefined, existingTasks: Task[]): string {
  const type = project?.websiteType ?? 'Other'
  const bank = TASK_BANK[type] ?? TASK_BANK['Other']
  const existingTitles = new Set(existingTasks.map(t => t.title.toLowerCase()))
  const available = bank.filter(t => !existingTitles.has(t.toLowerCase()))

  if (available.length > 0) {
    return available[Math.floor(Math.random() * available.length)]
  }
  const goals = project?.goals?.trim()
  if (goals) {
    const firstSentence = goals.split(/[.!?]/)[0].trim().toLowerCase()
    if (firstSentence.length > 10) {
      return `As a first-time visitor, try to: ${firstSentence}.`
    }
  }
  return bank[Math.floor(Math.random() * bank.length)]
}

// ─── Component ────────────────────────────────────────────────────────────────

const TaskList = forwardRef<TaskListHandle, object>(function TaskList(_props: object, ref: React.Ref<TaskListHandle>) {
  const { siteId } = useParams<{ siteId: string }>()
  const { tasks, setTasks } = useProjectContext()
  const [generating, setGenerating] = useState(false)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [viewAll, setViewAll] = useState(false)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  function handleDragStart(i: number) { setDragIdx(i) }
  function handleDragOver(i: number) { setDragOverIdx(i) }
  function handleDrop() {
    if (dragIdx === null || dragOverIdx === null || dragIdx === dragOverIdx) {
      setDragIdx(null); setDragOverIdx(null); return
    }
    const reordered = [...tasks]
    const [moved] = reordered.splice(dragIdx, 1)
    reordered.splice(dragOverIdx, 0, moved)
    setTasks(reordered)
    setDragIdx(null)
    setDragOverIdx(null)
  }

  const visibleTasks = viewAll ? tasks : tasks.slice(0, 3)

  async function handleAdd(title: string, description: string, focusAreas: FocusArea[]) {
    const task = await api.createTask(siteId!, title, description || undefined)
    setTasks([...tasks, { ...task, focusAreas }])
  }

  async function handleEditSave(title: string, description: string, focusAreas: FocusArea[]) {
    if (!editingTask) return
    const updated = await api.updateTask(editingTask.id, title, description || undefined)
    setTasks(tasks.map(t => t.id === editingTask.id ? { ...updated, focusAreas } : t))
  }

  async function handleGenerate() {
    setGenerating(true)
    try {
      const projects: Project[] = JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY) ?? '[]')
      const project = projects.find(p => p.siteId === siteId)
      const text = pickGeneratedTask(project, tasks)
      const task = await api.createTask(siteId!, text)
      setTasks([...tasks, task])
    } catch { /* ignore */ }
    finally { setGenerating(false) }
  }

  useImperativeHandle(ref, () => ({
    generate: handleGenerate,
    openAddModal: () => setAddModalOpen(true),
    generating,
  }))

  function handleDelete(id: number) {
    setTasks(tasks.filter(t => t.id !== id))
  }

  function handleUpdate(updated: Task) {
    setTasks(tasks.map(t => t.id === updated.id ? updated : t))
  }

  return (
    <section className="eval-section">
      <p className="eval-section-sub" style={{ marginBottom: 10 }}>
        {tasks.length === 0
          ? 'Define what testers should accomplish — agents and humans both run these.'
          : `${tasks.length} task${tasks.length !== 1 ? 's' : ''} defined · each evaluated by agents and human testers.`}
      </p>

      <div className={tasks.length > 3 && !viewAll ? 'task-list task-list-scroll' : 'task-list'}>
        {tasks.length === 0 ? (
          <div className="task-empty">
            No tasks yet.
          </div>
        ) : visibleTasks.map((task, i) => (
          <TaskRow
            key={task.id}
            task={task}
            index={i}
            onDelete={handleDelete}
            onUpdate={handleUpdate}
            onEdit={t => setEditingTask(t)}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            dragging={dragIdx === i}
            dragOver={dragOverIdx === i}
          />
        ))}
      </div>

      {tasks.length > 3 && (
        <button className="task-view-all-btn" onClick={() => setViewAll(v => !v)}>
          {viewAll ? 'Show less ↑' : `View all ${tasks.length} tasks ↓`}
        </button>
      )}

      <AddTaskModal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onSubmit={handleAdd}
      />

      <AddTaskModal
        open={editingTask !== null}
        onClose={() => setEditingTask(null)}
        onSubmit={handleEditSave}
        initialTask={editingTask ?? undefined}
      />
    </section>
  )
})

export default TaskList
