import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Project } from '../lib/types'
import { PROJECTS_STORAGE_KEY } from '../lib/types'
import ProjectGrid from '../components/projects/ProjectGrid'

export default function HomePage() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])

  useEffect(() => {
    const stored = localStorage.getItem(PROJECTS_STORAGE_KEY)
    if (stored) setProjects(JSON.parse(stored))
  }, [])

  return (
    <div className="home-page fade-in">
      <div className="home-hero">
        <svg className="home-hero-logo" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="32" height="32" rx="8" fill="#4f46e5"/>
          <path d="M8 16C8 11.6 11.6 8 16 8s8 3.6 8 8-3.6 8-8 8" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
          <circle cx="16" cy="16" r="3" fill="white"/>
        </svg>
        <h1>Welcome to CipherCorgi</h1>
        <p>Test your website with real users and AI agents. Get actionable UX feedback in minutes.</p>
        <button className="btn btn-primary" onClick={() => navigate('/projects/new')}>+ Create New Project</button>
      </div>

      <div className="section-hdr">
        <h2>Recent Projects</h2>
        <span style={{ color: 'var(--gray400)' }}>{projects.length} project{projects.length !== 1 ? 's' : ''}</span>
      </div>

      <ProjectGrid projects={projects} />
    </div>
  )
}
