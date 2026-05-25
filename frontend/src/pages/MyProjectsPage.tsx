import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Project } from '../lib/types'
import { PROJECTS_STORAGE_KEY } from '../lib/types'
import ProjectCard from '../components/projects/ProjectCard'
import * as api from '../lib/api'
import { getUser, clearUser } from './LoginPage'

export default function MyProjectsPage() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>(() => {
    const stored = localStorage.getItem(PROJECTS_STORAGE_KEY)
    return stored ? JSON.parse(stored) : []
  })
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const user = getUser()

  function handleDelete(siteId: string) {
    setConfirmDeleteId(siteId)
  }

  async function confirmDelete() {
    if (!confirmDeleteId) return
    setDeleting(true)
    try {
      await api.deleteSite(confirmDeleteId)
    } catch {
      // proceed with local removal even if backend fails (e.g. site has no user_id)
    }
    const updated = projects.filter((p: Project) => p.siteId !== confirmDeleteId)
    setProjects(updated)
    localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(updated))
    setConfirmDeleteId(null)
    setDeleting(false)
  }

  function handleLogout() {
    clearUser()
    navigate('/')
  }

  useEffect(() => {
    if (!user?.id) return
    api.getUserProjects(user.id).then(apiProjects => {
      const existing: Project[] = JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY) ?? '[]')
      const merged: Project[] = apiProjects.map(p => {
        const local = existing.find(e => e.siteId === p.site_id)
        return {
          siteId: p.site_id,
          label: p.label ?? '',
          url: p.target_url,
          testerLink: p.tester_link,
          createdAt: p.created_at,
          websiteType: local?.websiteType,
          goals: local?.goals,
        }
      })
      localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(merged))
      setProjects(merged)
    }).catch(() => {
      const stored = localStorage.getItem(PROJECTS_STORAGE_KEY)
      if (stored) setProjects(JSON.parse(stored))
    })
  }, [])

  const projectToDelete = projects.find(p => p.siteId === confirmDeleteId)

  return (
    <div className="myprojects-page">
      {confirmDeleteId && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.55)', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--surface)', borderRadius: 'var(--radius-lg)',
            padding: '2rem', maxWidth: 400, width: '90%',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }}>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: 'var(--fs-body)' }}>Delete project?</h3>
            <p style={{ margin: '0 0 1.5rem', color: 'var(--gray400)', fontSize: 'var(--fs-small)' }}>
              <strong style={{ color: 'var(--text)' }}>{projectToDelete?.label || confirmDeleteId}</strong> will be permanently deleted. This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button
                className="btn btn-ghost"
                onClick={() => setConfirmDeleteId(null)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                className="btn"
                style={{ background: 'var(--error, #e53e3e)', color: '#fff', borderColor: 'transparent' }}
                onClick={confirmDelete}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="myprojects-hero">
        <div className="myprojects-hero-inner">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p className="myprojects-greeting">
              {user ? `Welcome back, ${user.name.split(' ')[0]}.` : 'My Projects'}
            </p>
          </div>
          <h1 className="myprojects-headline">
            Your research,{' '}
            <span className="myprojects-headline-accent">all in one place.</span>
          </h1>
          <p className="myprojects-tagline">
            Each project tracks a website across AI agent runs and real tester sessions.
          </p>
        </div>
      </div>

      <div className="myprojects-content">
        <div className="myprojects-content-header">
          <h2 className="myprojects-section-title">
            Projects
            <span className="myprojects-count">{projects.length}</span>
          </h2>
          <button className="myprojects-new-btn" onClick={() => navigate('/projects/new')}>
            New Project <span>→</span>
          </button>
        </div>

        {projects.length === 0 ? (
          <div className="myprojects-empty">
            <p>No projects yet. Create your first one to get started.</p>
          </div>
        ) : (
          <div className="myprojects-grid">
            {projects.map(p => <ProjectCard key={p.siteId} project={p} onDelete={handleDelete} />)}
            <div className="proj-new card-hover" onClick={() => navigate('/projects/new')}>
              <div className="plus">＋</div>
              <p>New Project</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
